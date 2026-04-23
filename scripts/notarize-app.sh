#!/bin/bash
# Codesign + notarize + staple AirMCP.app for release-quality distribution
# outside the App Store. Turns an ad-hoc-signed bundle from
# scripts/bundle-app.sh into something Gatekeeper accepts on a fresh Mac
# without a right-click-Open override.
#
# Required environment (set in GitHub Actions secrets for the CD workflow):
#   APPLE_DEVELOPER_ID          — Developer ID Application certificate
#                                 common name, e.g. "Developer ID Application:
#                                 Jane Doe (A1B2C3D4E5)"
#   APPLE_ID                    — Apple ID email for notarytool
#   APPLE_ID_PASSWORD           — app-specific password
#                                 (appleid.apple.com → sign-in and security)
#   APPLE_TEAM_ID               — 10-char team ID
#
# Optional environment:
#   APP_BUNDLE_PATH             — default: AirMCP.app (relative to repo root)
#   SKIP_NOTARIZATION=1         — codesign + staple only; useful for local
#                                 smoke tests when notarytool credentials
#                                 aren't available.
#
# Usage:
#   bash scripts/notarize-app.sh
#   SKIP_NOTARIZATION=1 bash scripts/notarize-app.sh  # sign only, no net
#
# Outputs (when notarization succeeds):
#   AirMCP.app — re-signed with Developer ID + stapled notarization ticket
#
# Exit codes:
#   0  success
#   1  missing env / bundle / signing failure
#   2  notarization rejected by Apple

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
APP_BUNDLE="${APP_BUNDLE_PATH:-$PROJECT_DIR/AirMCP.app}"

# ── Preconditions ────────────────────────────────────────────────────
if [ ! -d "$APP_BUNDLE" ]; then
  echo "notarize-app: $APP_BUNDLE not found — run scripts/bundle-app.sh first" >&2
  exit 1
fi

need_var() {
  if [ -z "${!1:-}" ]; then
    echo "notarize-app: required env var $1 is unset" >&2
    exit 1
  fi
}
need_var APPLE_DEVELOPER_ID

if [ "${SKIP_NOTARIZATION:-}" != "1" ]; then
  need_var APPLE_ID
  need_var APPLE_ID_PASSWORD
  need_var APPLE_TEAM_ID
fi

# ── Codesign with Developer ID (replaces the ad-hoc sign) ────────────
# --deep signs embedded plugins/frameworks too (AirMCP.app carries
# AirMCPWidget.appex). --options=runtime enables hardened runtime,
# which notarytool requires. --timestamp embeds a trusted timestamp
# (notarization rejects un-timestamped signatures).
echo "notarize-app: codesigning with $APPLE_DEVELOPER_ID …"

# Strip ad-hoc signatures first so codesign --force doesn't trip on
# signature format mismatch between the widget extension (ad-hoc) and
# the replacement Developer ID.
find "$APP_BUNDLE" -name "*.appex" -print0 | while IFS= read -r -d '' appex; do
  codesign --remove-signature "$appex" 2>/dev/null || true
done
codesign --remove-signature "$APP_BUNDLE" 2>/dev/null || true

# Sign embedded extensions first (innermost-out). Each appex needs the
# matching entitlements — the bundle script wrote them with ad-hoc sig,
# so we re-extract from the existing sig when available.
find "$APP_BUNDLE" -name "*.appex" -print0 | while IFS= read -r -d '' appex; do
  echo "  signing $appex"
  codesign --force --options=runtime --timestamp \
    --sign "$APPLE_DEVELOPER_ID" \
    "$appex"
done

# Finally sign the outer bundle. --deep catches anything the explicit
# extension loop missed.
codesign --force --deep --options=runtime --timestamp \
  --sign "$APPLE_DEVELOPER_ID" \
  "$APP_BUNDLE"

# ── Verify signature before submitting to Apple ─────────────────────
echo "notarize-app: verifying signature …"
codesign --verify --deep --strict --verbose=2 "$APP_BUNDLE" || {
  echo "notarize-app: codesign verification failed — refusing to submit" >&2
  exit 1
}

if [ "${SKIP_NOTARIZATION:-}" = "1" ]; then
  echo "notarize-app: SKIP_NOTARIZATION=1 — signed but not notarized"
  exit 0
fi

# ── Notarize via notarytool ─────────────────────────────────────────
# notarytool needs a .zip or .dmg, not an .app directory directly.
ZIP_PATH="$PROJECT_DIR/AirMCP-notarize.zip"
echo "notarize-app: zipping $APP_BUNDLE → $ZIP_PATH"
rm -f "$ZIP_PATH"
ditto -c -k --keepParent "$APP_BUNDLE" "$ZIP_PATH"

echo "notarize-app: submitting to Apple (this takes 2-10 minutes) …"
SUBMIT_OUTPUT="$(
  xcrun notarytool submit "$ZIP_PATH" \
    --apple-id "$APPLE_ID" \
    --password "$APPLE_ID_PASSWORD" \
    --team-id "$APPLE_TEAM_ID" \
    --wait 2>&1
)"
echo "$SUBMIT_OUTPUT"

# notarytool --wait prints "status: Accepted" on success. Anything else
# (Rejected / Invalid) is a hard fail; we surface the log URL so a
# human can read the rejection reasons.
if ! echo "$SUBMIT_OUTPUT" | grep -q "status: Accepted"; then
  echo "notarize-app: notarization failed — see log URL above" >&2
  SUBMISSION_ID="$(echo "$SUBMIT_OUTPUT" | awk '/id:/{print $2; exit}')"
  if [ -n "$SUBMISSION_ID" ]; then
    echo "notarize-app: fetching detailed log for submission $SUBMISSION_ID …" >&2
    xcrun notarytool log "$SUBMISSION_ID" \
      --apple-id "$APPLE_ID" \
      --password "$APPLE_ID_PASSWORD" \
      --team-id "$APPLE_TEAM_ID" >&2 || true
  fi
  exit 2
fi

# ── Staple the ticket onto the .app so Gatekeeper works offline ─────
# Without stapling, first-launch requires an internet connection to
# fetch the notarization verdict from Apple. Stapling embeds the
# verdict so the app opens on a fresh Mac with no network.
echo "notarize-app: stapling notarization ticket …"
xcrun stapler staple "$APP_BUNDLE"
xcrun stapler validate "$APP_BUNDLE"

rm -f "$ZIP_PATH"
echo "notarize-app: ✓ $APP_BUNDLE signed, notarized, and stapled"
