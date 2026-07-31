#!/bin/bash

# Fail closed unless the certificate's complete public subject is the project's
# published Developer ID. Developer ID subjects are embedded in every distributed
# binary, so checking only a secret name would not protect the project's
# public-identity boundary. Expected values live in scripts/lib/signing-identity.sh.

set -euo pipefail

# shellcheck source=scripts/lib/signing-identity.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/signing-identity.sh"

if [ -z "${APPLE_DEVELOPER_ID:-}" ]; then
  echo "signing-identity: APPLE_DEVELOPER_ID is required" >&2
  exit 1
fi

if [ "$APPLE_DEVELOPER_ID" != "$AIRMCP_SIGNING_COMMON_NAME" ]; then
  echo "signing-identity: certificate common name is not the project's published Developer ID" >&2
  exit 1
fi
CERT_TEAM_ID="$AIRMCP_SIGNING_TEAM_ID"

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

if [ "$COMMON_NAME" != "$AIRMCP_SIGNING_COMMON_NAME" ] ||
  [ "$ORGANIZATION" != "$AIRMCP_SIGNING_SUBJECT_NAME" ] ||
  [ "$ORG_UNIT" != "$AIRMCP_SIGNING_TEAM_ID" ]; then
  echo "signing-identity: certificate subject is not the project's published Developer ID" >&2
  exit 1
fi

echo "ok: Developer ID public identity is ${AIRMCP_SIGNING_COMMON_NAME}"
