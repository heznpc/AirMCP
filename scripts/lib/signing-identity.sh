#!/bin/bash
# Single source of truth for the Developer ID this project publishes under.
#
# The subject of a Developer ID certificate is embedded in every distributed
# binary, so it is a public identity boundary, not a secret. Both
# verify-signing-identity.sh (pre-signing, checks the imported certificate) and
# verify-signed-app.sh (post-signing, checks the sealed bundle) fail closed
# unless the identity matches these values exactly.
#
# The account is an INDIVIDUAL Apple Developer account, so Apple issues the
# subject with the member's legal name rather than an organisation name:
#
#   commonName             = Developer ID Application: <name> (<team id>)
#   organizationName       = <name>
#   organizationalUnitName = <team id>
#
# An earlier revision hard-coded organizationName="Heznpc" — the GitHub owner
# handle — which no certificate could ever satisfy, because Apple does not put a
# handle in the subject. That mismatch is why the first real signing run failed
# after the secrets were configured: the guard was asserting an identity that
# does not exist.
#
# Changing either value below changes what the public can verify a release
# against, so treat an edit here as a release-identity change and not a typo fix.
# The team ID is the strongest anchor: Apple assigns it and it cannot be chosen.

AIRMCP_SIGNING_TEAM_ID="XS7HJJN7GC"
AIRMCP_SIGNING_SUBJECT_NAME="Yoon Jiyeon"
AIRMCP_SIGNING_COMMON_NAME="Developer ID Application: ${AIRMCP_SIGNING_SUBJECT_NAME} (${AIRMCP_SIGNING_TEAM_ID})"
