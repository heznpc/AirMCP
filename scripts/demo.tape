# AirMCP terminal demo — VHS tape file
# https://github.com/charmbracelet/vhs
#
# Usage:  vhs scripts/demo.tape
# Output: docs/demo.gif
#
# Story arc (≈30s) — the GOVERNANCE story, not catalog size:
#   1. --version                  — quick proof it installs and runs
#   2. governed-flow.mjs          — the real round-trip a client sees:
#        identity asserted → airmcp://trust `governed:true` →
#        preview a destructive call (zero side effect) → tamper-evident
#        audit with provenance. Every line is real server output.
#
# Record with: ./scripts/record-demo.sh
# Prerequisites: `brew install vhs ffmpeg` and a local `npm run build`
# (record-demo.sh runs the build for you).

Output docs/demo.gif

Set FontSize 14
Set Width 1000
Set Height 700
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Padding 24

# ── Install proof ──────────────────────────────────────────────────────
Type "npx airmcp --version"
Enter
Sleep 1500ms

# ── The governed flow — the differentiator, on message, count-free ─────
# Drives the real built server over stdio and prints the identity + trust
# attestation + a zero-side-effect destructive preview + the audit verdict.
Type "clear"
Enter
Type "node scripts/demo/governed-flow.mjs"
Enter
Sleep 9s
