#!/bin/bash
# Keep notarytool JSON separate from warnings/errors. A warning on stderr must
# never turn an Accepted JSON response into a purported credential failure.
# The caller supplies a private temporary directory and removes it on exit.
submit_notarization() {
  local archive="$1"
  local output_dir="$2"
  shift 2
  xcrun notarytool submit "$archive" "$@" --wait --output-format json \
    > "$output_dir/notary-submit.json" 2> "$output_dir/notary-submit.stderr"
}
