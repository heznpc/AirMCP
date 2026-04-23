# Screenshot Shot List

Apple requires screenshots at specific device sizes. As of 2026 spring (App Store Connect spec):

| Required device | Resolution | How many |
|---|---|---|
| iPhone 6.9" (15 Pro Max / 16 Pro Max) | 1290 × 2796 | 3 min, 10 max |
| iPhone 6.7" (legacy) | 1284 × 2778 | Optional, strongly recommended |
| iPad 13" | 2064 × 2752 | 3 min, 10 max |

Upload each shot **without** status bar (Xcode's "Simulator → File → Save Screen" leaves status bar; clean it in Figma/Sketch).

## Shot list (5 shots, ordered for the listing carousel)

### 1. "Ask AirMCP" answer card
- Setting: Shortcuts app showing the "Ask AirMCP" action running.
- Prompt visible: "What's on my schedule today?"
- Response: bulleted event list with 3–5 events.
- **Caption overlay**: *On-device AI answers from your own apps.*

### 2. Main dashboard
- Setting: AirMCP iOS root screen.
- State: "Running — 18 tools" (or whatever the current iOS module count is).
- Modules list expanded: Calendar, Reminders, Contacts, Location, Health.
- **Caption overlay**: *154 Apple actions, one bridge.*

### 3. Privacy emphasis
- Setting: Airplane Mode badge visible in status bar (status bar kept for this shot only).
- "Ask AirMCP" answer still rendering.
- **Caption overlay**: *100% on-device. Works with no internet.*

### 4. Siri + Spotlight
- Split composite: left half Siri ("Ask AirMCP about my day"), right half Spotlight search result showing AirMCP app intents.
- **Caption overlay**: *Works everywhere your phone does.*

### 5. Shortcuts integration
- Setting: Shortcuts app with an AirMCP action inside a multi-step automation ("When I open Calendar → Ask AirMCP for today's agenda → Send to Notes").
- **Caption overlay**: *Stackable with Shortcuts.*

## Asset production

- Use real (simulated) data in the screenshots — reviewers reject mock-up screens that don't match the running app.
- Caption overlay typography: SF Pro Display Bold, 120pt, white on the top 30% of the image.
- Background: `docs/` branding gradient (see `brand-colors.md` if it exists, else sample from the existing `icons/airmcp-icon-256.png`).

## Preview video (optional)

Apple allows a 15–30s app preview video per device size. For v1:
- Screen-record the demo from `review-notes.md` with QuickTime.
- Add the same captions as the still shots.
- Music: silent, rely on captions (safer against copyright flagging).
