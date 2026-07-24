#!/bin/bash

# Fail closed unless the certificate's complete public subject uses Heznpc.
# Developer ID subjects are embedded in every distributed binary, so checking
# only a secret name would not protect the project's public-identity boundary.

set -euo pipefail

if [ -z "${APPLE_DEVELOPER_ID:-}" ]; then
  echo "signing-identity: APPLE_DEVELOPER_ID is required" >&2
  exit 1
fi

if [[ ! "$APPLE_DEVELOPER_ID" =~ ^Developer\ ID\ Application:\ Heznpc\ \(([A-Z0-9]{10})\)$ ]]; then
  echo "signing-identity: certificate common name is outside the Heznpc public identity" >&2
  exit 1
fi
CERT_TEAM_ID="${BASH_REMATCH[1]}"

if [ -n "${APPLE_TEAM_ID:-}" ] && [ "$APPLE_TEAM_ID" != "$CERT_TEAM_ID" ]; then
  echo "signing-identity: configured team does not match the certificate identity" >&2
  exit 1
fi

SECURITY_ARGS=(find-certificate -c "$APPLE_DEVELOPER_ID" -p)
if [ -n "${AIRMCP_SIGNING_KEYCHAIN:-}" ]; then
  SECURITY_ARGS+=("$AIRMCP_SIGNING_KEYCHAIN")
fi
CERT_PEM="$(security "${SECURITY_ARGS[@]}" 2>/dev/null)" || {
  echo "signing-identity: configured certificate was not found" >&2
  exit 1
}

SUBJECT="$(printf '%s' "$CERT_PEM" | openssl x509 -noout -subject -nameopt multiline 2>/dev/null)" || {
  echo "signing-identity: certificate subject could not be inspected" >&2
  exit 1
}
COMMON_NAME="$(printf '%s\n' "$SUBJECT" | sed -nE 's/^[[:space:]]*commonName[[:space:]]*=[[:space:]]*(.*)$/\1/p' | head -1)"
ORGANIZATION="$(printf '%s\n' "$SUBJECT" | sed -nE 's/^[[:space:]]*organizationName[[:space:]]*=[[:space:]]*(.*)$/\1/p' | head -1)"
ORG_UNIT="$(printf '%s\n' "$SUBJECT" | sed -nE 's/^[[:space:]]*organizationalUnitName[[:space:]]*=[[:space:]]*(.*)$/\1/p' | head -1)"

if [ "$COMMON_NAME" != "$APPLE_DEVELOPER_ID" ] || [ "$ORGANIZATION" != "Heznpc" ] || [ "$ORG_UNIT" != "$CERT_TEAM_ID" ]; then
  echo "signing-identity: certificate subject contains a public identity other than Heznpc" >&2
  exit 1
fi

echo "ok: Developer ID public identity is Heznpc"
