#!/bin/bash
# Verify an already-built, already-notarized AirMCP.app artifact without
# rebuilding it. This is the final distribution gate after notarization.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
APP_BUNDLE="${APP_BUNDLE_PATH:-$PROJECT_DIR/AirMCP.app}"
APP_EXECUTABLE="AirMCP"
APP_BINARY="$APP_BUNDLE/Contents/MacOS/$APP_EXECUTABLE"
APP_HEALTH_URL="${AIRMCP_APP_HEALTH_URL:-http://127.0.0.1:3847/health}"
APP_RUNTIME_STATE_URL="${AIRMCP_APP_RUNTIME_STATE_URL:-http://127.0.0.1:3847/app/runtime-state}"
APP_MCP_URL="${AIRMCP_APP_MCP_URL:-http://127.0.0.1:3847/mcp}"
RUNTIME_NODE="$APP_BUNDLE/Contents/Resources/airmcp/runtime/bin/node"
RUNTIME_ENTRY="$APP_BUNDLE/Contents/Resources/airmcp/server/dist/index.js"
RUNTIME_COMMAND="$RUNTIME_NODE $RUNTIME_ENTRY --http --port 3847"
EXPECTED_VERSION="$(
  node -e 'const fs = require("fs"); console.log(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).version)' \
    "$PROJECT_DIR/package.json"
)"
STATE_PARENT="${TMPDIR:-/tmp}"
STATE_PARENT="${STATE_PARENT%/}"
STATE_DIR=""
APP_PID=""
RUNTIME_PID=""

pid_matches_prefix() {
  local pid="$1"
  local expected="$2"
  local command
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || return 1
  command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  case "$command" in
    "$expected"|"$expected "*) return 0 ;;
    *) return 1 ;;
  esac
}

terminate_exact_pid() {
  local pid="$1"
  local expected="$2"
  if ! pid_matches_prefix "$pid" "$expected"; then return 0; fi
  kill "$pid" 2>/dev/null || true
  for _ in $(seq 1 50); do
    if ! kill -0 "$pid" 2>/dev/null; then return 0; fi
    sleep 0.1
  done
  if pid_matches_prefix "$pid" "$expected"; then kill -KILL "$pid" 2>/dev/null || true; fi
}

cleanup() {
  local original_status=$?
  # Stop only the exact app instance and authenticated runtime generation this
  # invocation observed. Never sweep another installed AirMCP by process name.
  terminate_exact_pid "$APP_PID" "$APP_BINARY"
  terminate_exact_pid "$RUNTIME_PID" "$RUNTIME_COMMAND"
  if [ -n "$STATE_DIR" ]; then
    case "$STATE_DIR" in
      "$STATE_PARENT"/airmcp-signed-verify.*) rm -rf "$STATE_DIR" ;;
      *) echo "verify-signed-app: refusing to remove unexpected state path" >&2 ;;
    esac
  fi
  trap - EXIT
  exit "$original_status"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [ ! -d "$APP_BUNDLE" ]; then
  echo "verify-signed-app: app bundle not found" >&2
  exit 1
fi

STATE_DIR="$(mktemp -d "$STATE_PARENT/airmcp-signed-verify.XXXXXX")"
chmod 700 "$STATE_DIR"
mkdir -p "$STATE_DIR/home" "$STATE_DIR/audit" "$STATE_DIR/tmp"
chmod 700 "$STATE_DIR/home" "$STATE_DIR/audit" "$STATE_DIR/tmp"

# A final signed distribution must include the widget even when this command is
# run locally rather than under release-app.yml.
if ! AIRMCP_REQUIRE_WIDGET=1 \
  bash "$SCRIPT_DIR/verify-bundle-structure.sh" "$APP_BUNDLE" "com.heznpc.AirMCP" "$APP_EXECUTABLE" \
    >/dev/null 2>&1; then
  echo "verify-signed-app: bundle structure verification failed" >&2
  exit 1
fi

APP_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP_BUNDLE/Contents/Info.plist" 2>/dev/null)" || {
  echo "verify-signed-app: bundle version could not be inspected" >&2
  exit 1
}
if [ "$APP_VERSION" != "$EXPECTED_VERSION" ]; then
  echo "verify-signed-app: bundle version does not match the checked-out release source" >&2
  exit 1
fi

echo "verify-signed-app: checking signature tree..."
if ! codesign --verify --deep --strict --verbose=2 "$APP_BUNDLE" >/dev/null 2>&1; then
  echo "verify-signed-app: signature verification failed" >&2
  exit 1
fi

SIGN_INFO="$(codesign -dv --verbose=4 "$APP_BUNDLE" 2>&1)"
SIGN_AUTHORITY="$(printf '%s\n' "$SIGN_INFO" | sed -nE 's/^Authority=(Developer ID Application:.*)$/\1/p' | head -1)"
SIGN_TEAM="$(printf '%s\n' "$SIGN_INFO" | sed -nE 's/^TeamIdentifier=([A-Z0-9]+)$/\1/p' | head -1)"
if [[ ! "$SIGN_AUTHORITY" =~ ^Developer\ ID\ Application:\ Heznpc\ \(([A-Z0-9]{10})\)$ ]]; then
  echo "verify-signed-app: signing authority is outside the Heznpc public identity" >&2
  exit 1
fi
if [ "$SIGN_TEAM" != "${BASH_REMATCH[1]}" ]; then
  echo "verify-signed-app: signing team does not match the verified authority" >&2
  exit 1
fi
if printf '%s\n' "$SIGN_INFO" | grep -q "Signature=adhoc"; then
  echo "verify-signed-app: ad-hoc signature is not a release artifact" >&2
  exit 1
fi
if ! printf '%s\n' "$SIGN_INFO" | grep -q "Runtime Version="; then
  echo "verify-signed-app: hardened runtime is missing" >&2
  exit 1
fi

echo "verify-signed-app: checking Gatekeeper..."
if ! spctl --assess --type execute -vvv "$APP_BUNDLE" >/dev/null 2>&1; then
  echo "verify-signed-app: Gatekeeper rejected the artifact" >&2
  exit 1
fi

echo "verify-signed-app: checking notarization staple..."
if ! xcrun stapler validate "$APP_BUNDLE" >/dev/null 2>&1; then
  echo "verify-signed-app: notarization staple validation failed" >&2
  exit 1
fi

EXISTING_APP_PIDS="$STATE_DIR/existing-app-pids"
: > "$EXISTING_APP_PIDS"
while read -r pid command; do
  case "$command" in
    "$APP_BINARY"|"$APP_BINARY "*) echo "$pid" >> "$EXISTING_APP_PIDS" ;;
  esac
done < <(ps -axo pid=,command=)

CONFIG_FILE="$STATE_DIR/config.json"
umask 077
cat > "$CONFIG_FILE" <<'CONFIG_EOF'
{
  "profile": "full",
  "toolExposure": "full",
  "disabledModules": [],
  "requireToolSession": false,
  "hitl": { "level": "off", "whitelist": [], "timeout": 5 }
}
CONFIG_EOF

# Clear developer-shell AirMCP overrides, then provide a complete disposable
# runtime state. This makes a pre-existing same-version listener fail rather
# than becoming evidence for the artifact under test.
for env_name in $(env | awk -F= '/^AIRMCP_/ { print $1 }'); do unset "$env_name"; done
export HOME="$STATE_DIR/home"
export CFFIXED_USER_HOME="$STATE_DIR/home"
export AIRMCP_CONFIG_PATH="$CONFIG_FILE"
export AIRMCP_PROFILE="full"
export AIRMCP_TOOL_EXPOSURE="full"
export AIRMCP_REQUIRE_TOOL_SESSION="false"
export AIRMCP_HITL_LEVEL="off"
export AIRMCP_HITL_SOCKET_PATH="$STATE_DIR/hitl.sock"
export AIRMCP_APP_RUNTIME_TOKEN_PATH="$STATE_DIR/http-token"
export AIRMCP_APP_RUNTIME_OWNER_PATH="$STATE_DIR/runtime-owner-secret"
export AIRMCP_MEMORY_STORE_PATH="$STATE_DIR/memory.json"
export AIRMCP_VECTOR_STORE_DIR="$STATE_DIR/audit"
export AIRMCP_USAGE_PROFILE_PATH="$STATE_DIR/usage.json"
export AIRMCP_EMERGENCY_STOP_PATH="$STATE_DIR/emergency-stop"
export AIRMCP_TEMP_DIR="$STATE_DIR/tmp"
export AIRMCP_AUDIT_LOG="false"
export AIRMCP_FORCE_APP_RUNTIME="1"

echo "verify-signed-app: launching isolated artifact generation..."
if ! open -n \
  --env "HOME=$HOME" \
  --env "CFFIXED_USER_HOME=$CFFIXED_USER_HOME" \
  --env "AIRMCP_CONFIG_PATH=$AIRMCP_CONFIG_PATH" \
  --env "AIRMCP_PROFILE=$AIRMCP_PROFILE" \
  --env "AIRMCP_TOOL_EXPOSURE=$AIRMCP_TOOL_EXPOSURE" \
  --env "AIRMCP_REQUIRE_TOOL_SESSION=$AIRMCP_REQUIRE_TOOL_SESSION" \
  --env "AIRMCP_HITL_LEVEL=$AIRMCP_HITL_LEVEL" \
  --env "AIRMCP_HITL_SOCKET_PATH=$AIRMCP_HITL_SOCKET_PATH" \
  --env "AIRMCP_APP_RUNTIME_TOKEN_PATH=$AIRMCP_APP_RUNTIME_TOKEN_PATH" \
  --env "AIRMCP_APP_RUNTIME_OWNER_PATH=$AIRMCP_APP_RUNTIME_OWNER_PATH" \
  --env "AIRMCP_MEMORY_STORE_PATH=$AIRMCP_MEMORY_STORE_PATH" \
  --env "AIRMCP_VECTOR_STORE_DIR=$AIRMCP_VECTOR_STORE_DIR" \
  --env "AIRMCP_USAGE_PROFILE_PATH=$AIRMCP_USAGE_PROFILE_PATH" \
  --env "AIRMCP_EMERGENCY_STOP_PATH=$AIRMCP_EMERGENCY_STOP_PATH" \
  --env "AIRMCP_TEMP_DIR=$AIRMCP_TEMP_DIR" \
  --env "AIRMCP_AUDIT_LOG=$AIRMCP_AUDIT_LOG" \
  --env "AIRMCP_FORCE_APP_RUNTIME=$AIRMCP_FORCE_APP_RUNTIME" \
  "$APP_BUNDLE" >/dev/null 2>&1; then
  echo "verify-signed-app: isolated artifact launch request failed" >&2
  exit 1
fi

for _ in $(seq 1 80); do
  while read -r pid command; do
    case "$command" in
      "$APP_BINARY"|"$APP_BINARY "*)
        if ! grep -Fxq "$pid" "$EXISTING_APP_PIDS"; then APP_PID="$pid"; break; fi
        ;;
    esac
  done < <(ps -axo pid=,command=)
  [ -n "$APP_PID" ] && break
  sleep 0.25
done
if [ -z "$APP_PID" ] || ! pid_matches_prefix "$APP_PID" "$APP_BINARY"; then
  echo "verify-signed-app: the requested app artifact did not launch" >&2
  exit 1
fi

TOKEN_FILE="$AIRMCP_APP_RUNTIME_TOKEN_PATH"
OWNER_FILE="$AIRMCP_APP_RUNTIME_OWNER_PATH"
HEALTH_FILE="$STATE_DIR/health.json"
RUNTIME_STATE_FILE="$STATE_DIR/runtime-state.json"

for _ in $(seq 1 100); do
  if [ -s "$TOKEN_FILE" ] && [ -s "$OWNER_FILE" ]; then
    curl -fsS --max-time 1 "$APP_HEALTH_URL" -o "$HEALTH_FILE" 2>/dev/null || true
    node --input-type=module - "$TOKEN_FILE" "$APP_RUNTIME_STATE_URL" "$RUNTIME_STATE_FILE" <<'NODE' >/dev/null 2>&1 || true
      import { readFileSync, writeFileSync } from "node:fs";
      const token = readFileSync(process.argv[2], "utf8").trim();
      const response = await fetch(process.argv[3], {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(1_000),
      });
      if (!response.ok) process.exit(2);
      writeFileSync(process.argv[4], JSON.stringify(await response.json()), { mode: 0o600 });
NODE
    if [ -s "$HEALTH_FILE" ] && [ -s "$RUNTIME_STATE_FILE" ]; then break; fi
  fi
  sleep 0.25
done

for private_file in "$TOKEN_FILE" "$OWNER_FILE"; do
  if [ ! -s "$private_file" ] || [ "$(stat -f '%Lp' "$private_file")" != "600" ]; then
    echo "verify-signed-app: isolated runtime credentials are missing or not owner-only" >&2
    exit 1
  fi
done

RUNTIME_PID="$(node - "$HEALTH_FILE" "$RUNTIME_STATE_FILE" "$OWNER_FILE" "$EXPECTED_VERSION" <<'NODE'
  const { createHash } = require("crypto");
  const { readFileSync } = require("fs");
  const [healthPath, statePath, ownerPath, expectedVersion] = process.argv.slice(2);
  const health = JSON.parse(readFileSync(healthPath, "utf8"));
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  const owner = readFileSync(ownerPath, "utf8").trim();
  const fingerprint = createHash("sha256").update(`airmcp-app-owner-v1\n${owner}`, "utf8").digest("hex");
  if (health.status !== "ok" || health.version !== expectedVersion || health.appOwned !== true) process.exit(2);
  if (state.status !== "ok" || state.version !== expectedVersion || state.appOwned !== true) process.exit(3);
  if (!Number.isSafeInteger(state.pid) || state.pid < 2 || state.ownerFingerprint !== fingerprint) process.exit(4);
  process.stdout.write(String(state.pid));
NODE
)" || {
  echo "verify-signed-app: runtime state does not belong to this artifact generation" >&2
  exit 1
}

if ! pid_matches_prefix "$RUNTIME_PID" "$RUNTIME_COMMAND"; then
  echo "verify-signed-app: authenticated runtime PID does not match the embedded artifact" >&2
  exit 1
fi
if ! pid_matches_prefix "$APP_PID" "$APP_BINARY"; then
  echo "verify-signed-app: app exited before runtime verification completed" >&2
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
  echo "verify-signed-app: unauthenticated MCP request was not rejected" >&2
  exit 1
fi

node "$SCRIPT_DIR/probe-app-runtime.mjs" \
  --url "$APP_MCP_URL" \
  --token-file "$TOKEN_FILE" \
  --min-tools 100 \
  --timeout-ms 10000 \
  --client-name "airmcp-signed-artifact-verify"

INTENT_PREDICATE="processIdentifier == $APP_PID AND (eventMessage CONTAINS[c] \"Error registering app with intents\" OR eventMessage CONTAINS[c] \"linkd.autoShortcut\")"
INTENT_LOGS="$(/usr/bin/log show --style compact --last 60s --predicate "$INTENT_PREDICATE" 2>/dev/null || true)"
if printf '%s\n' "$INTENT_LOGS" | grep -q "Error registering app with intents"; then
  echo "verify-signed-app: AppIntents registration failed" >&2
  exit 1
fi

echo "verify-signed-app: ✓ exact signed artifact, owner generation, token gate, and AppIntents smoke passed"
