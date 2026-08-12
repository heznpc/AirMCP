#!/bin/bash
# Copy a macOS Node executable and its non-system dylib dependency closure
# into an app-local runtime directory. Homebrew Node is not self-contained:
# copying only the executable leaves @rpath/libnode and other Homebrew dylibs
# pointing back at the build machine.

set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: scripts/lib/embed-node-runtime.sh <node> <runtime-root>" >&2
  exit 2
fi

NODE_SOURCE="$1"
RUNTIME_ROOT="$2"
NODE_ROOT="$RUNTIME_ROOT/bin"
LIB_ROOT="$RUNTIME_ROOT/lib"
NODE_DEST="$NODE_ROOT/node"

if [ ! -x "$NODE_SOURCE" ]; then
  echo "embed-node-runtime: Node executable missing or not executable: $NODE_SOURCE" >&2
  exit 1
fi
if ! command -v otool >/dev/null 2>&1 || ! command -v install_name_tool >/dev/null 2>&1; then
  echo "embed-node-runtime: otool and install_name_tool are required on macOS" >&2
  exit 1
fi

mkdir -p "$NODE_ROOT" "$LIB_ROOT"
cp "$NODE_SOURCE" "$NODE_DEST"
chmod 755 "$NODE_DEST"

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/airmcp-node-deps.XXXXXX")"
VISITED="$WORK_DIR/visited"
touch "$VISITED"
trap 'rm -rf "$WORK_DIR"' EXIT

is_system_dependency() {
  case "$1" in
    /System/Library/*|/usr/lib/*|/usr/libexec/*) return 0 ;;
    *) return 1 ;;
  esac
}

mach_dependencies() {
  otool -L "$1" | sed -n '2,$p' | sed -E 's/^[[:space:]]+([^[:space:]]+)[[:space:]].*$/\1/'
}

mach_rpaths() {
  otool -l "$1" | awk '
    /cmd LC_RPATH/ { want = 1; next }
    want && $1 == "path" { print $2; want = 0 }
  '
}

expand_loader_path() {
  local path="$1"
  local parent="$2"
  local parent_dir
  local executable_dir
  parent_dir="$(dirname "$parent")"
  executable_dir="$(dirname "$NODE_DEST")"
  case "$path" in
    @loader_path/*) printf '%s/%s\n' "$parent_dir" "${path#@loader_path/}" ;;
    @executable_path/*) printf '%s/%s\n' "$executable_dir" "${path#@executable_path/}" ;;
    *) printf '%s\n' "$path" ;;
  esac
}

resolve_dependency() {
  local parent="$1"
  local dependency="$2"
  local candidate
  local rpath

  if is_system_dependency "$dependency"; then
    return 0
  fi

  case "$dependency" in
    @rpath/*)
      while IFS= read -r rpath; do
        [ -n "$rpath" ] || continue
        candidate="$(expand_loader_path "$rpath" "$parent")/${dependency#@rpath/}"
        if [ -f "$candidate" ]; then
          realpath "$candidate"
          return 0
        fi
      done < <(mach_rpaths "$parent")
      ;;
    @loader_path/*|@executable_path/*)
      candidate="$(expand_loader_path "$dependency" "$parent")"
      if [ -f "$candidate" ]; then
        realpath "$candidate"
        return 0
      fi
      ;;
    /*)
      if [ -f "$dependency" ]; then
        realpath "$dependency"
        return 0
      fi
      ;;
  esac

  echo "embed-node-runtime: cannot resolve non-system dependency '$dependency' from '$parent'" >&2
  exit 1
}

ensure_rpath() {
  local file="$1"
  local rpath="$2"
  if ! otool -l "$file" | awk -v wanted="$rpath" '$1 == "path" && $2 == wanted { found = 1 } END { exit found ? 0 : 1 }'; then
    install_name_tool -add_rpath "$rpath" "$file"
  fi
}

bundle_binary() {
  local source="$1"
  local destination="$2"
  local kind="$3"
  local dependency
  local resolved
  local basename
  local dependency_destination

  if grep -Fqx "$source" "$VISITED"; then return 0; fi
  printf '%s\n' "$source" >> "$VISITED"

  if [ "$kind" = "dylib" ]; then
    install_name_tool -id "@rpath/$(basename "$destination")" "$destination"
    ensure_rpath "$destination" "@loader_path"
  else
    ensure_rpath "$destination" "@loader_path/../lib"
  fi

  while IFS= read -r dependency; do
    [ -n "$dependency" ] || continue
    if is_system_dependency "$dependency"; then continue; fi
    resolved="$(resolve_dependency "$source" "$dependency")"
    basename="$(basename "$resolved")"
    dependency_destination="$LIB_ROOT/$basename"
    if grep -Fqx "$resolved" "$VISITED"; then
      if [ "$dependency" != "@rpath/$basename" ]; then
        install_name_tool -change "$dependency" "@rpath/$basename" "$destination"
      fi
      continue
    fi
    if [ -e "$dependency_destination" ]; then
      if ! cmp -s "$resolved" "$dependency_destination"; then
        echo "embed-node-runtime: dependency name collision for $basename" >&2
        exit 1
      fi
    else
      cp "$resolved" "$dependency_destination"
      chmod 644 "$dependency_destination"
    fi
    if [ "$dependency" != "@rpath/$basename" ]; then
      install_name_tool -change "$dependency" "@rpath/$basename" "$destination"
    fi
    bundle_binary "$resolved" "$dependency_destination" "dylib"
  done < <(mach_dependencies "$source")
}

bundle_binary "$(realpath "$NODE_SOURCE")" "$NODE_DEST" "node"
echo "embed-node-runtime: embedded Node and $(find "$LIB_ROOT" -type f -name '*.dylib' | wc -l | tr -d ' ') non-system dylibs"
