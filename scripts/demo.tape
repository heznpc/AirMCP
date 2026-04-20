# AirMCP terminal demo — VHS tape file
# https://github.com/charmbracelet/vhs
#
# Usage:  vhs scripts/demo.tape
# Output: docs/demo.gif
#
# Story arc (≈35s):
#   1. --version / --help  — quick proof it installs and runs
#   2. doctor              — highlights the new Compatibility + HTTP
#                            network-policy sections added in v2.10
#   3. server banner       — shows tool + module + event counts
#
# Record with: ./scripts/record-demo.sh
# Prerequisites: `brew install vhs ffmpeg` and a local `npm run build`.

Output docs/demo.gif

Set FontSize 14
Set Width 1000
Set Height 680
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Padding 24

# ── Version ────────────────────────────────────────────────────────────
Type "npx airmcp --version"
Enter
Sleep 1500ms

# ── Help ───────────────────────────────────────────────────────────────
Type "clear"
Enter
Type "npx airmcp --help"
Enter
Sleep 5s

# ── Doctor — showcases the new v2.10 HTTP + Compatibility sections ─────
# The output grew in v2.10 to include:
#   - [Compatibility]  per-module resolver decisions (RFC 0004)
#   - [HTTP network policy]  effective allowNetwork + token/origin state
# Give the viewer ~10s to absorb the full screen.
Type "clear"
Enter
Type "npx airmcp doctor"
Enter
Sleep 10s

# ── Banner — tool / module / prompt / skill counts front-and-centre ────
# Start stdio server briefly so the banner flashes (shows "X tools across
# Y modules, Z skills, W events"), then Ctrl-C out of it.
Type "clear"
Enter
Type "npx airmcp"
Enter
Sleep 4s
Ctrl+C
Sleep 1s
