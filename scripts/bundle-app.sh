#!/bin/bash
# Create a proper .app bundle from the SwiftPM build output.
# This is required because UNUserNotificationCenter, NSServices, and
# other AppKit features need a valid bundle with Info.plist + bundle ID.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
APP_DIR="$PROJECT_DIR/app"
BUILD_DIR="$APP_DIR/.build/release"
BUNDLE_DIR="$PROJECT_DIR/AirMCP.app"

echo "Building AirMCPApp..."
cd "$APP_DIR" && swift build -c release

echo "Creating app bundle..."
rm -rf "$BUNDLE_DIR"
mkdir -p "$BUNDLE_DIR/Contents/MacOS"
mkdir -p "$BUNDLE_DIR/Contents/Resources"

# Copy binary
cp "$BUILD_DIR/AirMCPApp" "$BUNDLE_DIR/Contents/MacOS/AirMCP"

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
/usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string com.heznpc.AirMCP" "$PLIST"
/usr/libexec/PlistBuddy -c "Delete :CFBundleExecutable" "$PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :CFBundleExecutable string AirMCP" "$PLIST"
/usr/libexec/PlistBuddy -c "Delete :CFBundleName" "$PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :CFBundleName string AirMCP" "$PLIST"
/usr/libexec/PlistBuddy -c "Delete :CFBundlePackageType" "$PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :CFBundlePackageType string APPL" "$PLIST"
/usr/libexec/PlistBuddy -c "Delete :CFBundleShortVersionString" "$PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :CFBundleShortVersionString string 2.6.3" "$PLIST"
/usr/libexec/PlistBuddy -c "Delete :LSUIElement" "$PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :LSUIElement bool true" "$PLIST"
/usr/libexec/PlistBuddy -c "Delete :NSMicrophoneUsageDescription" "$PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :NSMicrophoneUsageDescription string AirMCP uses the microphone for speech recognition." "$PLIST"

echo ""
echo "✓ AirMCP.app created at: $BUNDLE_DIR"
echo "  Run with: open $BUNDLE_DIR"
echo "  Or:       $BUNDLE_DIR/Contents/MacOS/AirMCP"
