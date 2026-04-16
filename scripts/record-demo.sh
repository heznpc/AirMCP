#!/bin/bash
# record-demo.sh — Generate a GIF demo of AirMCP using VHS.
# https://github.com/charmbracelet/vhs
#
# Usage:  ./scripts/record-demo.sh
# Output: docs/demo.gif

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TAPE_FILE="$SCRIPT_DIR/demo.tape"
OUTPUT="$PROJECT_DIR/docs/demo.gif"

# ── Pre-flight checks ────────────────────────────────────────────────

if ! command -v vhs &>/dev/null; then
  echo "Error: vhs is not installed."
  echo ""
  echo "Install it with Homebrew:"
  echo "  brew install vhs"
  echo ""
  echo "Or see https://github.com/charmbracelet/vhs#installation"
  exit 1
fi

if ! command -v ffmpeg &>/dev/null; then
  echo "Error: ffmpeg is not installed (required by vhs)."
  echo ""
  echo "Install it with Homebrew:"
  echo "  brew install ffmpeg"
  exit 1
fi

if [ ! -f "$TAPE_FILE" ]; then
  echo "Error: tape file not found at $TAPE_FILE"
  exit 1
fi

# Ensure dist/ exists so npx airmcp commands work
if [ ! -f "$PROJECT_DIR/dist/index.js" ]; then
  echo "Building project first (dist/ not found)..."
  (cd "$PROJECT_DIR" && npm run build)
fi

# ── Record ────────────────────────────────────────────────────────────

echo "Recording demo..."
echo ""

# Run from project root so npx airmcp resolves correctly
cd "$PROJECT_DIR"
vhs "$TAPE_FILE"

# ── Result ────────────────────────────────────────────────────────────

if [ -f "$OUTPUT" ]; then
  SIZE=$(du -h "$OUTPUT" | cut -f1)
  echo ""
  echo "Done! Demo saved to docs/demo.gif ($SIZE)"
  echo ""
  echo "Preview it:"
  echo "  open $OUTPUT"
  echo ""
  echo "Add it to README.md:"
  echo '  ![AirMCP demo](docs/demo.gif)'
else
  echo "Error: expected output not found at $OUTPUT"
  echo "Check vhs output above for errors."
  exit 1
fi
