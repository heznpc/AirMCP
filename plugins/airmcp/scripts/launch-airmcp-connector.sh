#!/bin/sh

set -eu

app_path=/Applications/AirMCP.app
node_path="$app_path/Contents/Resources/airmcp/runtime/bin/node"
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
connector_path="$script_dir/airmcp-app-stdio.mjs"

if [ ! -f "$node_path" ] || [ ! -x "$node_path" ] || [ ! -f "$connector_path" ]; then
  echo "[AirMCP plugin] signed app runtime or connector is missing" >&2
  exit 1
fi

app_requirement='anchor apple generic and identifier "app.airmcp" and certificate leaf[subject.OU] = "XS7HJJN7GC"'
if ! /usr/bin/codesign --verify --deep --strict --requirement "$app_requirement" "$app_path" >/dev/null 2>&1; then
  echo "[AirMCP plugin] AirMCP.app failed strict signature verification" >&2
  exit 1
fi

signature_details=$(/usr/bin/codesign -dvvv "$app_path" 2>&1)
case "$signature_details" in
  *"Identifier=app.airmcp"*"TeamIdentifier=XS7HJJN7GC"*) ;;
  *)
    echo "[AirMCP plugin] AirMCP.app has an unexpected signing identity" >&2
    exit 1
    ;;
esac

exec /usr/bin/env -i \
  PATH=/usr/bin:/bin:/usr/sbin:/sbin \
  "$node_path" \
  "$connector_path"
