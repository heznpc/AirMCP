#!/bin/bash
# Verify that a macOS .app bundle has the structure and signature AirMCP
# expects before launch or AppIntents registration.

set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "usage: scripts/verify-bundle-structure.sh <bundle> <bundle-id> <executable>" >&2
  exit 2
fi

BUNDLE_DIR="$1"
BUNDLE_ID="$2"
APP_EXECUTABLE="$3"
PLIST="$BUNDLE_DIR/Contents/Info.plist"
APP_BINARY="$BUNDLE_DIR/Contents/MacOS/$APP_EXECUTABLE"

require_plist_value() {
  local key="$1"
  local expected="$2"
  local actual
  actual="$(/usr/libexec/PlistBuddy -c "Print $key" "$PLIST" 2>/dev/null || true)"
  if [ "$actual" != "$expected" ]; then
    echo "✗ $PLIST has $key=$actual, expected $expected" >&2
    exit 1
  fi
}

if [ ! -x "$APP_BINARY" ]; then
  echo "✗ app executable missing or not executable: $APP_BINARY" >&2
  exit 1
fi

/usr/bin/plutil -lint "$PLIST" >/dev/null
require_plist_value ":CFBundleIdentifier" "$BUNDLE_ID"
require_plist_value ":CFBundleExecutable" "$APP_EXECUTABLE"
require_plist_value ":CFBundlePackageType" "APPL"

if ! codesign --verify --deep --strict "$BUNDLE_DIR" 2>/dev/null; then
  echo "✗ $BUNDLE_DIR did not pass strict code-sign verification" >&2
  exit 1
fi
