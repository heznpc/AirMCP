# App Review Notes — AirMCP iOS

> Goes into App Store Connect's "Notes" field for the review team. Keep concise; the goal is to make reviewers' path to a "natural-language answer comes from on-device AI" demo as obvious as possible.

---

Thank you for reviewing AirMCP iOS.

## What the app does

AirMCP exposes Calendar / Reminders / Contacts / Notes / HealthKit / Location to Apple Intelligence on-device, via the Model Context Protocol (MCP) — an open standard Anthropic donated to the Agentic AI Foundation in 2025.

The **"Ask AirMCP"** App Intent routes a natural-language prompt through the Foundation Models framework with AirMCP tools registered. The model calls the tools to answer. Everything runs on the device's Neural Engine; there is no outbound network request.

## Demo path (≤ 60 seconds)

1. Open the app. The main screen shows "Running — X tools" once the embedded MCP server starts.
2. Swipe to Shortcuts app → New Shortcut → "Ask AirMCP".
3. Type "What's on my calendar today?" → Play.
4. Result is produced locally. (Offline mode: toggle Airplane Mode first to verify.)

Alternative: Siri → "Ask AirMCP what reminders are overdue" on iOS 26.

## Why HealthKit is requested

The `health_summary` tool returns **aggregated** health data (today's steps, 7-day resting heart rate, last night's sleep, active energy, exercise minutes) to the on-device agent. **No raw samples, no timestamps, no location, no identifiers**. Per App Store Guideline 5.1.2, no health data leaves the device. This is enforced in code at `FoundationModelsBridge.swift` — the health tools are only reachable through the on-device `LanguageModelSession`.

## Why we request local-network

We don't, by default. The app runs an embedded HTTP server on `127.0.0.1:3847` for MCP clients that prefer HTTP over stdio (same as the macOS version). The `NSLocalNetworkUsageDescription` key covers users who later enable `--bind-all` for home-lab scenarios; out of the box, the listener is loopback-only and token-authenticated.

## Why no login

AirMCP has no account system. The data model is "user's own data on user's own device"; there's nothing we'd store server-side.

## Open source

The iOS app and the MCP server share `AirMCPKit` (Swift) with the macOS/npm version at https://github.com/heznpc/AirMCP. That repo is MIT-licensed, reviewed continuously, and tracks RFC-based governance for public-contract changes (`docs/rfc/`). The privacy manifest is at `ios/Sources/AirMCPiOS/Resources/PrivacyInfo.xcprivacy`.

## Contact

- Support: see `SECURITY.md` in the repo for the disclosure channel.
- Developer: heznpc (see `CODEOWNERS`).
