# AirMCP iOS — App Store Submission Assets

This folder holds the material needed to push AirMCP to the iOS App Store. Code
lives under `../Sources/`; this tree is **only** the submission-side inputs:
store listing copy, keywords, privacy questionnaire answers, screenshot specs,
and reviewer notes.

The actual submission happens in App Store Connect — nothing here uploads on
its own. Treat each file as a checked-in draft of the form field content.

## Submission flow

1. `cd ios && swift build` clean.
2. Open the Xcode project (shipped separately — SwiftPM alone can't produce a
   signed `.ipa`; see `../Package.swift` comment).
3. Archive → Organizer → Distribute → App Store Connect.
4. In App Store Connect, paste copy from the files below verbatim.
5. Attach screenshots from the specs in `screenshots.md`.

## Files

| File | Purpose |
|---|---|
| `description.md` | Long-form store description (4000 char limit). Paste into the "Description" field. |
| `keywords.txt` | Comma-separated keyword list (100 char limit, sorted by search weight). |
| `promotional-text.md` | 170-char promotional text (changes independently of the build). |
| `privacy-questionnaire.md` | App Privacy "nutrition label" answers mapped to Apple's questionnaire. |
| `review-notes.md` | Notes for the App Review team — test account, how to demo, why HealthKit etc. |
| `screenshots.md` | Screenshot shot list with required device sizes. |

## Privacy manifest

The actual `PrivacyInfo.xcprivacy` lives at
`../Sources/AirMCPiOS/Resources/PrivacyInfo.xcprivacy` — it ships inside the
bundle. That file is machine-read by Apple; this folder's
`privacy-questionnaire.md` is the human-read version the reviewer sees.
