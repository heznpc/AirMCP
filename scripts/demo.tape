# AirMCP terminal demo — VHS tape file
# https://github.com/charmbracelet/vhs
#
# Usage:  vhs scripts/demo.tape
# Output: docs/demo.gif

Output docs/demo.gif

Set FontSize 14
Set Width 900
Set Height 600
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Padding 20

# --- Version ---
Type "npx airmcp --version"
Enter
Sleep 2s

# --- Help ---
Type "npx airmcp --help"
Enter
Sleep 4s

# --- Doctor ---
Type "npx airmcp doctor"
Enter
Sleep 8s

# --- Start server (show banner, then Ctrl-C) ---
Type "npx airmcp"
Enter
Sleep 3s
Ctrl+C
Sleep 1s
