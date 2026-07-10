#!/bin/bash
# Verify an already-built, already-notarized AirMCP.app artifact without
# rebuilding it. This is the final distribution gate after notarization.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
APP_BUNDLE="${APP_BUNDLE_PATH:-$PROJECT_DIR/AirMCP.app}"
APP_EXECUTABLE="AirMCP"
APP_HEALTH_URL="${AIRMCP_APP_HEALTH_URL:-http://127.0.0.1:3847/health}"
APP_MCP_URL="${AIRMCP_APP_MCP_URL:-http://127.0.0.1:3847/mcp}"
TOKEN_FILE="$HOME/Library/Application Support/AirMCP/http-token"
EXPECTED_VERSION="$(
  node -e 'const fs = require("fs"); console.log(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).version)' \
    "$PROJECT_DIR/package.json"
)"

if [ ! -d "$APP_BUNDLE" ]; then
  echo "verify-signed-app: $APP_BUNDLE not found" >&2
  exit 1
fi

trap 'pkill -x "$APP_EXECUTABLE" >/dev/null 2>&1 || true' EXIT

bash "$SCRIPT_DIR/verify-bundle-structure.sh" "$APP_BUNDLE" "com.heznpc.AirMCP" "$APP_EXECUTABLE"

echo "verify-signed-app: checking signature tree..."
codesign --verify --deep --strict --verbose=2 "$APP_BUNDLE"

SIGN_INFO="$(codesign -dv --verbose=4 "$APP_BUNDLE" 2>&1)"
if ! echo "$SIGN_INFO" | grep -q "Authority=Developer ID Application:"; then
  echo "verify-signed-app: expected Developer ID Application authority" >&2
  echo "$SIGN_INFO" >&2
  exit 1
fi
if echo "$SIGN_INFO" | grep -q "Signature=adhoc"; then
  echo "verify-signed-app: ad-hoc signature is not a release artifact" >&2
  exit 1
fi
if ! echo "$SIGN_INFO" | grep -Eq "TeamIdentifier=[A-Z0-9]+"; then
  echo "verify-signed-app: missing TeamIdentifier" >&2
  echo "$SIGN_INFO" >&2
  exit 1
fi
if ! echo "$SIGN_INFO" | grep -q "Runtime Version="; then
  echo "verify-signed-app: hardened runtime is missing" >&2
  echo "$SIGN_INFO" >&2
  exit 1
fi

echo "verify-signed-app: checking Gatekeeper..."
spctl --assess --type execute -vvv "$APP_BUNDLE"

echo "verify-signed-app: checking notarization staple..."
xcrun stapler validate "$APP_BUNDLE"

echo "verify-signed-app: launching artifact..."
export AIRMCP_FORCE_APP_RUNTIME=1
open -n "$APP_BUNDLE"

wait_for_http_runtime() {
  local health=""
  for _ in $(seq 1 80); do
    health="$(curl -fsS --max-time 1 "$APP_HEALTH_URL" 2>/dev/null || true)"
    if [ -n "$health" ]; then
      echo "$health"
      return 0
    fi
    sleep 0.25
  done
  return 1
}

HEALTH="$(wait_for_http_runtime)" || {
  echo "verify-signed-app: app-owned runtime did not become healthy at $APP_HEALTH_URL" >&2
  exit 1
}
ACTUAL_VERSION="$(
  node -e 'const health = JSON.parse(process.argv[1]); process.stdout.write(String(health.version ?? ""));' "$HEALTH"
)"
if [ "$ACTUAL_VERSION" != "$EXPECTED_VERSION" ]; then
  echo "verify-signed-app: runtime version mismatch: expected $EXPECTED_VERSION, got $ACTUAL_VERSION" >&2
  exit 1
fi

if [ ! -f "$TOKEN_FILE" ]; then
  echo "verify-signed-app: app-owned runtime token missing: $TOKEN_FILE" >&2
  exit 1
fi
TOKEN_MODE="$(stat -f "%Lp" "$TOKEN_FILE")"
if [ "$TOKEN_MODE" != "600" ]; then
  echo "verify-signed-app: runtime token permissions must be 600, got $TOKEN_MODE" >&2
  exit 1
fi

UNAUTH_STATUS="$(
  curl -sS --max-time 2 -o /dev/null -w "%{http_code}" \
    -X POST "$APP_MCP_URL" \
    -H "Content-Type: application/json" \
    --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"signed-artifact-verify","version":"0"}}}' \
    2>/dev/null || true
)"
if [ "$UNAUTH_STATUS" != "401" ]; then
  echo "verify-signed-app: unauthenticated /mcp request should return 401, got ${UNAUTH_STATUS:-no response}" >&2
  exit 1
fi

TOKEN="$(tr -d "\r\n" < "$TOKEN_FILE")"
node "$SCRIPT_DIR/probe-app-runtime.mjs" \
  --url "$APP_MCP_URL" \
  --token "$TOKEN" \
  --min-tools 100 \
  --timeout-ms 10000 \
  --client-name "airmcp-signed-artifact-verify"

INTENT_PREDICATE="process == \"$APP_EXECUTABLE\" AND (eventMessage CONTAINS[c] \"Error registering app with intents\" OR eventMessage CONTAINS[c] \"linkd.autoShortcut\")"
INTENT_LOGS="$(/usr/bin/log show --style compact --last 60s --predicate "$INTENT_PREDICATE" 2>/dev/null || true)"
if echo "$INTENT_LOGS" | grep -q "Error registering app with intents"; then
  echo "verify-signed-app: AppIntents registration failed in runtime logs" >&2
  echo "$INTENT_LOGS" >&2
  exit 1
fi

echo "verify-signed-app: ✓ signed, notarized, token-gated runtime and AppIntents smoke passed"
