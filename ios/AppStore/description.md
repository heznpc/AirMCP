# App Store Description — AirMCP

> Paste into the "Description" field in App Store Connect. 4000-char limit; current draft is comfortably under.

---

**Your Apple apps, answered in plain language. On-device.**

AirMCP turns "what's on my calendar today?" and "remind me to call mom tomorrow at 5pm" into actions your iPhone already knows how to run — through Apple's on-device AI. No cloud. No sign-in. No tracking.

### Ask in plain language. Get answers from your own apps.

Tap the Shortcut or say "Ask AirMCP" to Siri. The on-device model reads your Calendar, Reminders, Contacts, and Notes and answers — or creates a reminder, or drafts a summary of your day. Every inference runs on your iPhone's Neural Engine.

### Built for privacy from the ground up

- **100% on-device**: Apple's Foundation Models framework does the thinking. Your data never leaves your phone.
- **HealthKit data stays local**: health summaries never travel to a cloud LLM — a hard App Store guideline, honored by design.
- **No account**: AirMCP has no login, no analytics, no tracking domain. Check our privacy manifest.
- **Localhost only**: the embedded MCP server listens only on 127.0.0.1 unless you explicitly enable external access with a token.

### The right bridge to any AI

AirMCP speaks the Model Context Protocol (MCP) — Anthropic's open standard the whole industry adopted in 2025. That means when you connect Claude, ChatGPT, or any MCP-compatible desktop assistant later, they can reach the same 154+ actions with your explicit permission.

### What the AI can do on your phone (today)

- **Calendar** — list today/upcoming events, create, search
- **Reminders** — list overdue, create, mark done
- **Contacts** — search by name/email/phone, read
- **Notes** — search, list folders
- **Health** — request aggregated summaries (steps, heart rate, sleep) — never raw samples
- **Location** — current location with user consent
- **Bluetooth / Battery / Focus** — quick system queries

### Shortcuts, Siri, Spotlight

Every action lands as an App Intent, so you can stack them inside Shortcuts, say them to Siri, or search them in Spotlight. No extra setup.

### Built for developers who want the bridge

- Open source (MIT) — the same npm package that ships for macOS lives at github.com/heznpc/AirMCP
- **269 tools across 29 modules on macOS**, a curated subset on iOS
- Declarative HTTP network policy (RFC 0002), OAuth 2.1 + Resource Indicators (MCP 2025-06-18 spec, RFC 0005)
- Built-in audit log, rate limit (60/min), emergency-stop file for destructive actions

### What's new in this version

- **Ask AirMCP** — natural-language agent wired into Foundation Models
- **154 Siri/Shortcuts/Spotlight actions** auto-generated from the MCP tool manifest
- **Typed drift guards** — the app catches shape changes between the MCP server and the on-device decoder before any answer reaches you

---

**Requires iOS 17.0 or later**. The on-device AI agent requires iOS 26 + Apple Silicon (A-series chips).

---

*AirMCP is not affiliated with Anthropic or Apple. Model Context Protocol is an open standard donated by Anthropic to the Agentic AI Foundation (a Linux Foundation project).*
