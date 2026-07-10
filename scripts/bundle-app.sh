#!/bin/bash
# Build a proper .app bundle from the SwiftPM output, then optionally run,
# verify, stream logs, or attach LLDB to the bundled macOS app.
#
# A real bundle is required because UNUserNotificationCenter, NSServices, URL
# schemes, and other AppKit features need Info.plist metadata + a bundle ID.

set -euo pipefail

usage() {
  cat <<'USAGE_EOF'
Usage: scripts/bundle-app.sh [bundle|run|verify|verify-governed|verify-appintents|logs|telemetry|debug|widget-debug|widget-release]

Modes:
  bundle     Build AirMCP.app only (default)
  run        Build AirMCP.app and launch it
  verify     Build, launch, and assert the app-owned HTTP runtime contract
  verify-governed
             Prove read, approved/denied writes, emergency stop, and audit integrity
  verify-appintents
             Require a trusted signing identity, then verify AppIntents registration
  logs       Build, launch, and stream logs for the AirMCP process
  telemetry  Build, launch, and stream logs for the AirMCP subsystem
  debug      Build, launch, and attach LLDB to the running app process
  widget-debug
             Build only the widget target in debug mode
  widget-release
             Build only the widget target in release mode

Runtime modes skip the widget extension by default for fast app iteration.
Set AIRMCP_SKIP_WIDGET=0 to force a widget build, or =1 to skip explicitly.
Set AIRMCP_SIGN_IDENTITY to a valid signing identity for Shortcuts/AppIntents
registration; ad-hoc signing is used when it is unset.
USAGE_EOF
}

MODE="${1:-bundle}"
case "$MODE" in
  bundle|--bundle) MODE="bundle" ;;
  run|--run) MODE="run" ;;
  verify|--verify) MODE="verify" ;;
  verify-governed|--verify-governed) MODE="verify-governed" ;;
  verify-appintents|--verify-appintents) MODE="verify-appintents" ;;
  logs|--logs) MODE="logs" ;;
  telemetry|--telemetry) MODE="telemetry" ;;
  debug|--debug) MODE="debug" ;;
  widget-debug|--widget-debug) MODE="widget-debug" ;;
  widget-release|--widget-release) MODE="widget-release" ;;
  -h|--help|help)
    usage
    exit 0
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac

if [ -z "${AIRMCP_SKIP_WIDGET+x}" ]; then
  case "$MODE" in
    run|verify|verify-governed|verify-appintents|logs|telemetry|debug) AIRMCP_SKIP_WIDGET=1 ;;
    *) AIRMCP_SKIP_WIDGET=0 ;;
  esac
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
APP_DIR="$PROJECT_DIR/app"
BUNDLE_ID="com.heznpc.AirMCP"
BUNDLE_DIR="$PROJECT_DIR/AirMCP.app"
APP_EXECUTABLE="AirMCP"
APP_BINARY="$BUNDLE_DIR/Contents/MacOS/$APP_EXECUTABLE"
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
SIGN_IDENTITY="${AIRMCP_SIGN_IDENTITY:--}"
AIRMCP_EMBED_RUNTIME="${AIRMCP_EMBED_RUNTIME:-1}"
if [ "$MODE" = "verify-governed" ]; then
  # This gate claims to exercise the shipping, self-contained app. Never let a
  # developer-shell override silently turn it into an npx/checkout fallback.
  AIRMCP_EMBED_RUNTIME=1
fi
APP_HTTP_PORT=3847
APP_HEALTH_URL="http://127.0.0.1:$APP_HTTP_PORT/health"
APP_MCP_URL="http://127.0.0.1:$APP_HTTP_PORT/mcp"
TOKEN_FILE="${AIRMCP_APP_RUNTIME_TOKEN_PATH:-$HOME/Library/Application Support/AirMCP/http-token}"
GOVERNED_STATE_DIR=""
GOVERNED_STATE_PARENT="${TMPDIR:-/tmp}"
PROCESS_SHUTDOWN_WAIT_STEPS=70 # 7s, above the server's 5s graceful-shutdown budget
EXPECTED_VERSION="$(
  node -e 'const fs = require("fs"); console.log(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).version)' \
    "$PROJECT_DIR/package.json"
)"
BUILD_NUMBER="${AIRMCP_BUILD_NUMBER:-$(git -C "$PROJECT_DIR" rev-list --count HEAD)}"
if ! [[ "$BUILD_NUMBER" =~ ^[0-9]+$ ]]; then
  echo "✗ AIRMCP_BUILD_NUMBER must be a positive integer, got: $BUILD_NUMBER" >&2
  exit 2
fi

if [ "$MODE" = "verify-appintents" ]; then
  if [ "$SIGN_IDENTITY" = "-" ]; then
    echo "✗ AIRMCP_SIGN_IDENTITY is required for AppIntents registration verification." >&2
    if security find-identity -v -p codesigning | grep -E "[0-9]+\\) [A-F0-9]+ " >/dev/null; then
      echo "  Set it to one of the identities from: security find-identity -v -p codesigning" >&2
    else
      echo "  This machine currently has no trusted signing identity configured." >&2
    fi
    exit 1
  fi
  if ! security find-identity -v -p codesigning | grep -F "$SIGN_IDENTITY" >/dev/null; then
    echo "✗ signing identity not found: $SIGN_IDENTITY" >&2
    exit 1
  fi
fi

if [ "$MODE" = "widget-debug" ] || [ "$MODE" = "widget-release" ]; then
  WIDGET_CONFIG="debug"
  if [ "$MODE" = "widget-release" ]; then
    WIDGET_CONFIG="release"
  fi
  echo "Building AirMCPWidget ($WIDGET_CONFIG)..."
  exec /usr/bin/time -p sh -c "cd \"$APP_DIR/widget\" && swift build -c \"$WIDGET_CONFIG\""
fi

if [ "$AIRMCP_EMBED_RUNTIME" = "1" ]; then
  echo "Building universal AirMCP JavaScript catalog..."
  (cd "$PROJECT_DIR" && npm run build)
  echo "Building AirMcpBridge..."
  (cd "$PROJECT_DIR/swift" && swift build -c release)
  BRIDGE_BUILD_DIR="$(cd "$PROJECT_DIR/swift" && swift build -c release --show-bin-path)"
fi

echo "Building AirMCPApp..."
PREVIOUS_APP_BUILD_DIR="$(cd "$APP_DIR" && swift build -c release --show-bin-path)"
# SwiftPM can leave removed .lproj directories in an incremental resource
# bundle. Recreate that generated bundle so renamed locales cannot leak into
# the packaged app.
rm -rf "$PREVIOUS_APP_BUILD_DIR/AirMCPApp_AirMCPApp.bundle"
(cd "$APP_DIR" && swift build -c release)
BUILD_DIR="$(cd "$APP_DIR" && swift build -c release --show-bin-path)"

echo "Creating app bundle..."
rm -rf "$BUNDLE_DIR"
mkdir -p "$BUNDLE_DIR/Contents/MacOS"
mkdir -p "$BUNDLE_DIR/Contents/Resources"

# Copy binary
cp "$BUILD_DIR/AirMCPApp" "$APP_BINARY"

# Copy icons
for icon in AppIcon@2x.png AppIcon.png MenuBarIcon.png; do
  if [ -f "$APP_DIR/Sources/AirMCPApp/Resources/$icon" ]; then
    cp "$APP_DIR/Sources/AirMCPApp/Resources/$icon" "$BUNDLE_DIR/Contents/Resources/"
  fi
done

# Also copy the SwiftPM resource bundle (contains Bundle.module resources)
RESOURCE_BUNDLE="$BUILD_DIR/AirMCPApp_AirMCPApp.bundle"
if [ -d "$RESOURCE_BUNDLE" ]; then
  cp -R "$RESOURCE_BUNDLE" "$BUNDLE_DIR/Contents/Resources/"
fi

# Embed a fixed Node runtime, the universal JS server, production dependencies,
# and the Swift bridge. The signed app therefore does not depend on npx, a
# global npm install, or a developer checkout at runtime.
if [ "$AIRMCP_EMBED_RUNTIME" = "1" ]; then
  RUNTIME_ROOT="$BUNDLE_DIR/Contents/Resources/airmcp"
  SERVER_ROOT="$RUNTIME_ROOT/server"
  NODE_ROOT="$RUNTIME_ROOT/runtime/bin"
  BRIDGE_ROOT="$RUNTIME_ROOT/bin"
  NODE_SOURCE="${AIRMCP_BUNDLED_NODE:-$(command -v node || true)}"
  if [ -z "$NODE_SOURCE" ] || [ ! -x "$NODE_SOURCE" ]; then
    echo "✗ a Node executable is required to build the self-contained app" >&2
    exit 1
  fi
  mkdir -p "$SERVER_ROOT" "$NODE_ROOT" "$BRIDGE_ROOT"
  cp -R "$PROJECT_DIR/dist" "$SERVER_ROOT/dist"
  cp "$PROJECT_DIR/package.json" "$PROJECT_DIR/package-lock.json" "$SERVER_ROOT/"
  if [ -f "$PROJECT_DIR/LICENSE" ]; then cp "$PROJECT_DIR/LICENSE" "$SERVER_ROOT/"; fi
  npm ci --omit=dev --ignore-scripts --no-audit --no-fund --prefix "$SERVER_ROOT"
  cp "$NODE_SOURCE" "$NODE_ROOT/node"
  chmod 755 "$NODE_ROOT/node"
  cp "$BRIDGE_BUILD_DIR/AirMcpBridge" "$BRIDGE_ROOT/AirMcpBridge"
  chmod 755 "$BRIDGE_ROOT/AirMcpBridge"
  echo "  ✓ Embedded Node runtime, universal server, production dependencies, and Swift bridge"
fi

# Copy Info.plist with services declarations
if [ -f "$APP_DIR/Sources/AirMCPApp/Resources/Info.plist" ]; then
  cp "$APP_DIR/Sources/AirMCPApp/Resources/Info.plist" "$BUNDLE_DIR/Contents/Info.plist"
fi

# ── Build and embed WidgetKit extension ──
WIDGET_DIR="$APP_DIR/widget"
if [ "$AIRMCP_SKIP_WIDGET" = "1" ]; then
  echo "Skipping AirMCPWidget extension (AIRMCP_SKIP_WIDGET=1)."
elif [ -f "$WIDGET_DIR/Package.swift" ]; then
  echo "Building AirMCPWidget extension..."
  widget_built=0
  (cd "$WIDGET_DIR" && swift build -c release) 2>&1 && widget_built=1 || {
    echo "⚠ Widget build failed — skipping widget extension"
  }

  if [ "$widget_built" -eq 1 ]; then
    WIDGET_BUILD_DIR="$(cd "$WIDGET_DIR" && swift build -c release --show-bin-path)"
    WIDGET_BIN="$WIDGET_BUILD_DIR/AirMCPWidget"
  else
    WIDGET_BIN=""
  fi

  if [ -n "$WIDGET_BIN" ] && [ -f "$WIDGET_BIN" ]; then
    APPEX_DIR="$BUNDLE_DIR/Contents/PlugIns/AirMCPWidget.appex/Contents"
    mkdir -p "$APPEX_DIR/MacOS"

    cp "$WIDGET_BIN" "$APPEX_DIR/MacOS/AirMCPWidget"
    cp "$WIDGET_DIR/Info.plist" "$APPEX_DIR/Info.plist"
    /usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $EXPECTED_VERSION" "$APPEX_DIR/Info.plist"
    /usr/libexec/PlistBuddy -c "Set :CFBundleVersion $BUILD_NUMBER" "$APPEX_DIR/Info.plist"

    # Copy resource bundle (localization strings)
    WIDGET_RESOURCE="$WIDGET_BUILD_DIR/AirMCPWidget_AirMCPWidget.bundle"
    if [ -d "$WIDGET_RESOURCE" ]; then
      mkdir -p "$APPEX_DIR/Resources"
      cp -R "$WIDGET_RESOURCE" "$APPEX_DIR/Resources/"
    fi

    # Sign the widget extension (required for WidgetKit).
    codesign --force --sign "$SIGN_IDENTITY" --entitlements /dev/stdin "$APPEX_DIR/../" <<'ENTITLEMENTS_EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>com.apple.security.app-sandbox</key>
	<false/>
	<key>com.apple.security.personal-information.calendars</key>
	<true/>
	<key>com.apple.security.personal-information.reminders</key>
	<true/>
</dict>
</plist>
ENTITLEMENTS_EOF
    echo "  ✓ Widget extension embedded"
  fi
fi

# Add minimal required keys to Info.plist if it exists, or create one
PLIST="$BUNDLE_DIR/Contents/Info.plist"
if [ ! -f "$PLIST" ]; then
  cat > "$PLIST" << 'PLIST_EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
</dict>
</plist>
PLIST_EOF
fi

# Ensure required keys exist
/usr/libexec/PlistBuddy -c "Delete :CFBundleIdentifier" "$PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string $BUNDLE_ID" "$PLIST"
/usr/libexec/PlistBuddy -c "Delete :CFBundleExecutable" "$PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :CFBundleExecutable string $APP_EXECUTABLE" "$PLIST"
/usr/libexec/PlistBuddy -c "Delete :CFBundleName" "$PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :CFBundleName string $APP_EXECUTABLE" "$PLIST"
/usr/libexec/PlistBuddy -c "Delete :CFBundlePackageType" "$PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :CFBundlePackageType string APPL" "$PLIST"
/usr/libexec/PlistBuddy -c "Delete :CFBundleShortVersionString" "$PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :CFBundleShortVersionString string 2.16.0" "$PLIST"
/usr/libexec/PlistBuddy -c "Delete :CFBundleVersion" "$PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :CFBundleVersion string $BUILD_NUMBER" "$PLIST"
/usr/libexec/PlistBuddy -c "Delete :LSUIElement" "$PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :LSUIElement bool true" "$PLIST"
/usr/libexec/PlistBuddy -c "Delete :NSMicrophoneUsageDescription" "$PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :NSMicrophoneUsageDescription string AirMCP uses the microphone for speech recognition." "$PLIST"

# Sign embedded executable code before signing the main app.
if [ "$AIRMCP_EMBED_RUNTIME" = "1" ]; then
  codesign --force --sign "$SIGN_IDENTITY" "$BUNDLE_DIR/Contents/Resources/airmcp/runtime/bin/node"
  codesign --force --sign "$SIGN_IDENTITY" "$BUNDLE_DIR/Contents/Resources/airmcp/bin/AirMcpBridge"
fi

# Sign the main app after embedding extensions and runtime executables.
codesign --force --sign "$SIGN_IDENTITY" "$BUNDLE_DIR"
"$SCRIPT_DIR/verify-bundle-structure.sh" "$BUNDLE_DIR" "$BUNDLE_ID" "$APP_EXECUTABLE"
if [ -x "$LSREGISTER" ]; then
  "$LSREGISTER" -f "$BUNDLE_DIR" 2>/dev/null || true
fi

find_matching_commands() {
  local match_mode="$1"
  local target="$2"
  local pid
  local command

  while read -r pid command; do
    case "$match_mode" in
      exact)
        if [ "$command" = "$target" ]; then echo "$pid $command"; fi
        ;;
      prefix)
        case "$command" in
          "$target"|"$target "*) echo "$pid $command" ;;
        esac
        ;;
      contains)
        case "$command" in
          *"$target"*) echo "$pid $command" ;;
        esac
        ;;
    esac
  done < <(ps -axo pid=,command=)
}

terminate_matching_command() {
  local match_mode="$1"
  local target="$2"
  local pids=""
  local pid
  local command

  while read -r pid command; do
    if [ -n "$pid" ]; then pids="$pids $pid"; fi
  done < <(find_matching_commands "$match_mode" "$target")

  if [ -z "$pids" ]; then return 0; fi
  for pid in $pids; do kill "$pid" 2>/dev/null || true; done
  for _ in $(seq 1 "$PROCESS_SHUTDOWN_WAIT_STEPS"); do
    local any_running=0
    for pid in $pids; do
      if kill -0 "$pid" 2>/dev/null; then any_running=1; fi
    done
    if [ "$any_running" -eq 0 ]; then return 0; fi
    sleep 0.1
  done
  for pid in $pids; do
    if kill -0 "$pid" 2>/dev/null; then kill -KILL "$pid" 2>/dev/null || true; fi
  done
}

stop_bundle_processes() {
  local bundled_runtime="$BUNDLE_DIR/Contents/Resources/airmcp/runtime/bin/node $BUNDLE_DIR/Contents/Resources/airmcp/server/dist/index.js --http --port $APP_HTTP_PORT"
  local bundled_bridge="$BUNDLE_DIR/Contents/Resources/airmcp/bin/AirMcpBridge"
  terminate_matching_command prefix "$APP_BINARY"
  terminate_matching_command exact "$bundled_runtime"
  terminate_matching_command prefix "$bundled_bridge"
  # App startup also refreshes add-on status through one short-lived npx
  # subprocess. Match the full current-checkout operation so unrelated Codex /
  # MCP proxy processes using the same checkout are never touched.
  terminate_matching_command contains "$PROJECT_DIR modules list --json"
}

assert_no_bundle_processes() {
  local bundled_runtime="$BUNDLE_DIR/Contents/Resources/airmcp/runtime/bin/node $BUNDLE_DIR/Contents/Resources/airmcp/server/dist/index.js --http --port $APP_HTTP_PORT"
  local bundled_bridge="$BUNDLE_DIR/Contents/Resources/airmcp/bin/AirMcpBridge"
  local remaining=""
  remaining="$({
    find_matching_commands prefix "$APP_BINARY"
    find_matching_commands exact "$bundled_runtime"
    find_matching_commands prefix "$bundled_bridge"
    find_matching_commands contains "$PROJECT_DIR modules list --json"
  } | sed '/^[[:space:]]*$/d')"
  if [ -n "$remaining" ]; then
    echo "✗ governed verification left current-checkout processes running:" >&2
    echo "$remaining" >&2
    return 1
  fi
}

launch_app() {
  # Limit cleanup to this checkout's generated app/runtime. A different
  # installed AirMCP build must not be terminated merely because its process
  # name is also AirMCP.
  stop_bundle_processes
  export AIRMCP_NPM_PACKAGE_SPECIFIER="${AIRMCP_NPM_PACKAGE_SPECIFIER:-$PROJECT_DIR}"
  case "$MODE" in
    verify|verify-governed|verify-appintents) export AIRMCP_FORCE_APP_RUNTIME=1 ;;
  esac
  /usr/bin/open -n "$BUNDLE_DIR"
}

setup_governed_environment() {
  local env_name
  local config_path

  # A host profile/module override would make the acceptance surface depend on
  # the developer's shell. Clear inherited AirMCP settings after the bundle is
  # built, then install only the isolated contract below.
  for env_name in $(env | awk -F= '/^AIRMCP_/ { print $1 }'); do
    unset "$env_name"
  done

  GOVERNED_STATE_PARENT="${GOVERNED_STATE_PARENT%/}"
  GOVERNED_STATE_DIR="$(mktemp -d "$GOVERNED_STATE_PARENT/airmcp-governed.XXXXXX")"
  mkdir -p "$GOVERNED_STATE_DIR/home" "$GOVERNED_STATE_DIR/audit" "$GOVERNED_STATE_DIR/tmp"
  config_path="$GOVERNED_STATE_DIR/config.json"
  node -e '
    const fs = require("fs");
    const path = process.argv[1];
    const config = {
      profile: "full",
      toolExposure: "full",
      requireToolSession: false,
      hitl: { level: "off", whitelist: [], timeout: 5 }
    };
    fs.writeFileSync(path, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  ' "$config_path"

  # Swift reads the temp config and keeps its notification/socket UI off. The
  # Node child deliberately overrides HITL back to sensitive-only so the MCP
  # elicitation client exercises the production approval gate.
  export HOME="$GOVERNED_STATE_DIR/home"
  # Foundation's NSHomeDirectory ignores HOME on macOS. This supported test
  # override moves the app's fixed home-relative surfaces (including its HITL
  # socket cleanup) under the same disposable root.
  export CFFIXED_USER_HOME="$GOVERNED_STATE_DIR/home"
  export AIRMCP_CONFIG_PATH="$config_path"
  export AIRMCP_PROFILE="full"
  export AIRMCP_TOOL_EXPOSURE="full"
  export AIRMCP_REQUIRE_TOOL_SESSION="false"
  export AIRMCP_HITL_LEVEL="sensitive-only"
  export AIRMCP_HITL_SOCKET_PATH="$GOVERNED_STATE_DIR/hitl.sock"
  export AIRMCP_APP_RUNTIME_TOKEN_PATH="$GOVERNED_STATE_DIR/http-token"
  export AIRMCP_MEMORY_STORE_PATH="$GOVERNED_STATE_DIR/memory.json"
  export AIRMCP_VECTOR_STORE_DIR="$GOVERNED_STATE_DIR/audit"
  export AIRMCP_USAGE_PROFILE_PATH="$GOVERNED_STATE_DIR/usage.json"
  export AIRMCP_EMERGENCY_STOP_PATH="$GOVERNED_STATE_DIR/emergency-stop"
  export AIRMCP_TEMP_DIR="$GOVERNED_STATE_DIR/tmp"
  export AIRMCP_AUDIT_LOG="true"
  export AIRMCP_AUDIT_FLUSH_INTERVAL="25"
  export AIRMCP_AUDIT_HMAC_KEY
  AIRMCP_AUDIT_HMAC_KEY="$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')"
  export AIRMCP_RATE_LIMIT="true"
  export AIRMCP_ELICITATION_DISABLE="false"
  export AIRMCP_FORCE_APP_RUNTIME="1"
  export AIRMCP_NPM_PACKAGE_SPECIFIER="$PROJECT_DIR"
  TOKEN_FILE="$AIRMCP_APP_RUNTIME_TOKEN_PATH"
}

verify_governed_workflow() {
  local token
  local output
  token="$(tr -d "\r\n" < "$TOKEN_FILE")"
  if ! output="$(
    node "$SCRIPT_DIR/verify-governed-workflow.mjs" \
      --url "$APP_MCP_URL" \
      --token "$token" \
      --memory-store "$AIRMCP_MEMORY_STORE_PATH" \
      --audit-dir "$AIRMCP_VECTOR_STORE_DIR" \
      --emergency-stop "$AIRMCP_EMERGENCY_STOP_PATH" \
      --timeout-ms 10000 2>&1
  )"; then
    echo "✗ governed workflow acceptance failed" >&2
    echo "$output" >&2
    exit 1
  fi
  echo "✓ $output"
}

wait_for_pid() {
  local pid=""
  local candidate
  local command
  for _ in $(seq 1 40); do
    pid=""
    while read -r candidate command; do
      case "$command" in
        "$APP_BINARY"|"$APP_BINARY "*)
          pid="$candidate"
          break
          ;;
      esac
    done < <(ps -axo pid=,command=)
    if [ -n "$pid" ]; then
      echo "$pid"
      return 0
    fi
    sleep 0.25
  done
  return 1
}

check_gatekeeper() {
  /usr/sbin/spctl --assess --type execute -vv "$BUNDLE_DIR" >/dev/null 2>&1
}

wait_for_http_runtime() {
  local health=""
  for _ in $(seq 1 60); do
    health="$(curl -fsS --max-time 1 "$APP_HEALTH_URL" 2>/dev/null || true)"
    if [ -n "$health" ]; then
      echo "$health"
      return 0
    fi
    sleep 0.25
  done
  return 1
}

verify_app_owned_runtime() {
  local health
  local actual_version
  local token_mode
  local unauth_status
  local token

  health="$(wait_for_http_runtime)" || {
    echo "✗ app-owned HTTP runtime did not become healthy at $APP_HEALTH_URL" >&2
    exit 1
  }

  actual_version="$(
    node -e 'const health = JSON.parse(process.argv[1]); process.stdout.write(String(health.version ?? ""));' "$health"
  )"
  if [ "$actual_version" != "$EXPECTED_VERSION" ]; then
    echo "✗ app-owned runtime version mismatch: expected $EXPECTED_VERSION, got $actual_version" >&2
    exit 1
  fi
  echo "✓ App-owned runtime is healthy (v$actual_version)"

  if [ ! -f "$TOKEN_FILE" ]; then
    echo "✗ app-owned runtime token missing: $TOKEN_FILE" >&2
    exit 1
  fi
  token_mode="$(stat -f "%Lp" "$TOKEN_FILE")"
  if [ "$token_mode" != "600" ]; then
    echo "✗ app-owned runtime token permissions must be 600, got $token_mode" >&2
    exit 1
  fi
  echo "✓ App-owned runtime token is private (0600)"

  unauth_status="$(
    curl -sS --max-time 2 -o /dev/null -w "%{http_code}" \
      -X POST "$APP_MCP_URL" \
      -H "Content-Type: application/json" \
      --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"bundle-verify","version":"0"}}}' \
      2>/dev/null || true
  )"
  if [ "$unauth_status" != "401" ]; then
    echo "✗ unauthenticated /mcp request should return 401, got ${unauth_status:-no response}" >&2
    exit 1
  fi
  echo "✓ Unauthenticated /mcp request is rejected (401)"

  token="$(tr -d "\r\n" < "$TOKEN_FILE")"
  local probe_output
  if ! probe_output="$(
    node "$SCRIPT_DIR/probe-app-runtime.mjs" \
      --url "$APP_MCP_URL" \
      --token "$token" \
      --min-tools 1 \
      --timeout-ms 5000 2>&1
  )"; then
    echo "✗ token-authenticated MCP initialize/tools-list failed" >&2
    echo "$probe_output" >&2
    exit 1
  fi
  echo "✓ Token-authenticated MCP initialize + tools/list passes ($probe_output)"
}

verify_running() {
  local pid
  if ! check_gatekeeper; then
    echo "⚠ Gatekeeper rejected this local build." >&2
    echo "  AppIntents/Shortcuts registration may fail with ad-hoc signing." >&2
    echo "  Set AIRMCP_SIGN_IDENTITY to a valid signing identity for full verification." >&2
  fi

  launch_app
  pid="$(wait_for_pid)" || {
    echo "✗ $APP_EXECUTABLE did not start from $BUNDLE_DIR" >&2
    exit 1
  }

  echo "✓ $APP_EXECUTABLE is running (pid $pid)"
  ps -p "$pid" -o pid=,comm=,etime=

  local intent_predicate
  local intent_logs
  intent_predicate="process == \"$APP_EXECUTABLE\" AND "
  intent_predicate="$intent_predicate(eventMessage CONTAINS[c] \"Error registering app with intents\""
  intent_predicate="$intent_predicate OR eventMessage CONTAINS[c] \"linkd.autoShortcut\")"
  intent_logs="$(/usr/bin/log show --style compact --last 30s --predicate "$intent_predicate" 2>/dev/null || true)"
  if echo "$intent_logs" | grep -q "Error registering app with intents"; then
    echo "⚠ AppIntents registration failed in runtime logs." >&2
    echo "  This commonly happens for unsigned/ad-hoc local bundles." >&2
  fi

  verify_app_owned_runtime
}

verify_appintents() {
  if ! check_gatekeeper; then
    echo "✗ Gatekeeper rejected $BUNDLE_DIR; AppIntents registration is not trustworthy." >&2
    exit 1
  fi

  launch_app
  wait_for_pid >/dev/null || {
    echo "✗ $APP_EXECUTABLE did not start from $BUNDLE_DIR" >&2
    exit 1
  }
  verify_app_owned_runtime
  sleep 2

  local intent_predicate
  local intent_logs
  intent_predicate="process == \"$APP_EXECUTABLE\" AND "
  intent_predicate="$intent_predicate(eventMessage CONTAINS[c] \"Error registering app with intents\""
  intent_predicate="$intent_predicate OR eventMessage CONTAINS[c] \"linkd.autoShortcut\")"
  intent_logs="$(/usr/bin/log show --style compact --last 30s --predicate "$intent_predicate" 2>/dev/null || true)"
  if echo "$intent_logs" | grep -q "Error registering app with intents"; then
    echo "✗ AppIntents registration failed in runtime logs." >&2
    echo "$intent_logs" >&2
    exit 1
  fi

  echo "✓ AppIntents registration did not emit runtime errors."
}

cleanup_verification() {
  local original_status=$?
  local cleanup_failed=0
  local state_dir="$GOVERNED_STATE_DIR"

  stop_bundle_processes
  if ! assert_no_bundle_processes; then cleanup_failed=1; fi

  if [ -n "$state_dir" ]; then
    case "$state_dir" in
      "$GOVERNED_STATE_PARENT"/airmcp-governed.*)
        if ! rm -rf "$state_dir"; then cleanup_failed=1; fi
        if [ -e "$state_dir" ]; then
          echo "✗ governed verification left temporary state behind: $state_dir" >&2
          cleanup_failed=1
        fi
        ;;
      *)
        echo "✗ Refusing to remove unexpected governed state path: $state_dir" >&2
        cleanup_failed=1
        ;;
    esac
  fi

  trap - EXIT
  if [ "$original_status" -ne 0 ]; then exit "$original_status"; fi
  if [ "$cleanup_failed" -ne 0 ]; then exit 1; fi
  exit 0
}

case "$MODE" in
  verify|verify-governed|verify-appintents)
    # Verification is non-interactive: never leave an app-owned Node process
    # listening after success or an early failure.
    trap cleanup_verification EXIT
    ;;
esac

echo ""
echo "✓ AirMCP.app created at: $BUNDLE_DIR"
echo "  Run with: open $BUNDLE_DIR"
echo "  Or:       $APP_BINARY"

case "$MODE" in
  bundle)
    ;;
  run)
    launch_app
    echo "✓ Launched $APP_EXECUTABLE"
    ;;
  verify)
    verify_running
    ;;
  verify-governed)
    setup_governed_environment
    verify_running
    verify_governed_workflow
    ;;
  verify-appintents)
    verify_appintents
    ;;
  logs)
    launch_app
    wait_for_pid >/dev/null || {
      echo "✗ $APP_EXECUTABLE did not start from $BUNDLE_DIR" >&2
      exit 1
    }
    /usr/bin/log stream --info --style compact --predicate "process == \"$APP_EXECUTABLE\""
    ;;
  telemetry)
    launch_app
    wait_for_pid >/dev/null || {
      echo "✗ $APP_EXECUTABLE did not start from $BUNDLE_DIR" >&2
      exit 1
    }
    /usr/bin/log stream --info --style compact --predicate "subsystem == \"$BUNDLE_ID\""
    ;;
  debug)
    pid="$(verify_running | awk '/is running/ {print $6}' | tr -d ')')" || exit 1
    exec lldb -p "$pid"
    ;;
esac
