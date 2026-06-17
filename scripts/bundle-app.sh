#!/bin/bash
# Build a proper .app bundle from the SwiftPM output, then optionally run,
# verify, stream logs, or attach LLDB to the bundled macOS app.
#
# A real bundle is required because UNUserNotificationCenter, NSServices, URL
# schemes, and other AppKit features need Info.plist metadata + a bundle ID.

set -euo pipefail

usage() {
  cat <<'USAGE_EOF'
Usage: scripts/bundle-app.sh [bundle|run|verify|verify-appintents|logs|telemetry|debug|widget-debug|widget-release]

Modes:
  bundle     Build AirMCP.app only (default)
  run        Build AirMCP.app and launch it
  verify     Build, launch, and assert that the bundled app process is alive
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
    run|verify|verify-appintents|logs|telemetry|debug) AIRMCP_SKIP_WIDGET=1 ;;
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

echo "Building AirMCPApp..."
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
/usr/libexec/PlistBuddy -c "Add :CFBundleShortVersionString string 2.12.1" "$PLIST"
/usr/libexec/PlistBuddy -c "Delete :LSUIElement" "$PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :LSUIElement bool true" "$PLIST"
/usr/libexec/PlistBuddy -c "Delete :NSMicrophoneUsageDescription" "$PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :NSMicrophoneUsageDescription string AirMCP uses the microphone for speech recognition." "$PLIST"

# Sign the main app after embedding extensions.
codesign --force --sign "$SIGN_IDENTITY" "$BUNDLE_DIR"
if [ -x "$LSREGISTER" ]; then
  "$LSREGISTER" -f "$BUNDLE_DIR" 2>/dev/null || true
fi

launch_app() {
  if pgrep -x "$APP_EXECUTABLE" >/dev/null 2>&1; then
    pkill -x "$APP_EXECUTABLE" || true
    sleep 0.5
  fi
  /usr/bin/open -n "$BUNDLE_DIR"
}

wait_for_pid() {
  local pid=""
  for _ in $(seq 1 40); do
    pid="$(pgrep -x "$APP_EXECUTABLE" | head -n 1 || true)"
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

verify_running() {
  local pid
  if ! codesign --verify --deep --strict "$BUNDLE_DIR" 2>/dev/null; then
    echo "⚠ $BUNDLE_DIR did not pass strict code-sign verification" >&2
  fi
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
