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
RUNTIME_ROOT="$BUNDLE_DIR/Contents/Resources/airmcp"
BUNDLED_NODE="$RUNTIME_ROOT/runtime/bin/node"
BUNDLED_SERVER="$RUNTIME_ROOT/server/dist/index.js"
BUNDLED_BRIDGE="$RUNTIME_ROOT/bin/AirMcpBridge"
LOCALIZATION_BUNDLE="$BUNDLE_DIR/Contents/Resources/AirMCPApp_AirMCPApp.bundle"
SUPPORTED_LOCALES="de en es fr ja ko pt-BR zh-Hans zh-Hant"

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
require_plist_value ":CFBundleDevelopmentRegion" "en"
require_plist_value ":CFBundleAllowMixedLocalizations" "true"

PLIST_LOCALIZATIONS="$(/usr/libexec/PlistBuddy -c "Print :CFBundleLocalizations" "$PLIST" 2>/dev/null || true)"
for locale in $SUPPORTED_LOCALES; do
  if ! grep -Eq "^[[:space:]]*$locale$" <<<"$PLIST_LOCALIZATIONS"; then
    echo "✗ $PLIST does not declare localization $locale" >&2
    exit 1
  fi
  strings_file="$LOCALIZATION_BUNDLE/$locale.lproj/Localizable.strings"
  if [ ! -f "$strings_file" ]; then
    echo "✗ packaged localization missing: $strings_file" >&2
    exit 1
  fi
  /usr/bin/plutil -lint "$strings_file" >/dev/null
done
for locale_dir in "$LOCALIZATION_BUNDLE"/*.lproj; do
  packaged_locale="$(basename "$locale_dir" .lproj)"
  if ! tr '[:upper:]' '[:lower:]' <<<" $SUPPORTED_LOCALES " | grep -Fq " $(tr '[:upper:]' '[:lower:]' <<<"$packaged_locale") "; then
    echo "✗ packaged localization is not declared: $locale_dir" >&2
    exit 1
  fi
done

MAIN_VERSION="$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$PLIST")"
MAIN_BUILD="$(/usr/libexec/PlistBuddy -c "Print :CFBundleVersion" "$PLIST")"
if [ -z "$MAIN_VERSION" ] || ! [[ "$MAIN_BUILD" =~ ^[0-9]+$ ]]; then
  echo "✗ app version/build metadata is missing or invalid" >&2
  exit 1
fi

for path in "$BUNDLED_NODE" "$BUNDLED_SERVER" "$BUNDLED_BRIDGE"; do
  if [ ! -e "$path" ]; then
    echo "✗ self-contained runtime artifact missing: $path" >&2
    exit 1
  fi
done
if [ ! -x "$BUNDLED_NODE" ] || [ ! -x "$BUNDLED_BRIDGE" ]; then
  echo "✗ bundled Node and Swift bridge must be executable" >&2
  exit 1
fi

RUNTIME_VERSION="$("$BUNDLED_NODE" "$BUNDLED_SERVER" --version)"
if [ "$RUNTIME_VERSION" != "$MAIN_VERSION" ]; then
  echo "✗ bundled runtime version $RUNTIME_VERSION does not match app $MAIN_VERSION" >&2
  exit 1
fi

NODE_MAJOR="$("$BUNDLED_NODE" -p 'Number(process.versions.node.split(".")[0])')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "✗ bundled Node major must be >=20, got $NODE_MAJOR" >&2
  exit 1
fi

APP_ARCHS="$(lipo -archs "$APP_BINARY")"
for executable in "$BUNDLED_NODE" "$BUNDLED_BRIDGE"; do
  EXEC_ARCHS="$(lipo -archs "$executable")"
  for arch in $APP_ARCHS; do
    if [[ " $EXEC_ARCHS " != *" $arch "* ]]; then
      echo "✗ $executable lacks app architecture $arch (has: $EXEC_ARCHS)" >&2
      exit 1
    fi
  done
done

WIDGET_PLIST="$BUNDLE_DIR/Contents/PlugIns/AirMCPWidget.appex/Contents/Info.plist"
if [ -f "$WIDGET_PLIST" ]; then
  WIDGET_VERSION="$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$WIDGET_PLIST")"
  WIDGET_BUILD="$(/usr/libexec/PlistBuddy -c "Print :CFBundleVersion" "$WIDGET_PLIST")"
  if [ "$WIDGET_VERSION" != "$MAIN_VERSION" ] || [ "$WIDGET_BUILD" != "$MAIN_BUILD" ]; then
    echo "✗ widget version/build ($WIDGET_VERSION/$WIDGET_BUILD) differs from app ($MAIN_VERSION/$MAIN_BUILD)" >&2
    exit 1
  fi
fi

if ! codesign --verify --deep --strict "$BUNDLE_DIR" 2>/dev/null; then
  echo "✗ $BUNDLE_DIR did not pass strict code-sign verification" >&2
  exit 1
fi
