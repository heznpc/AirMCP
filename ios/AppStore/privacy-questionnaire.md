# App Privacy Questionnaire (App Store Connect)

Maps Apple's "App Privacy" questionnaire to AirMCP iOS's actual behavior. The machine-read version is at `../Sources/AirMCPiOS/Resources/PrivacyInfo.xcprivacy`; this file is for the human reviewer + for keeping the questionnaire's answers consistent across submissions.

## Summary

**Data Collected**: None.
**Data Linked to You**: None.
**Data Used to Track You**: None.

AirMCP iOS runs the whole request/response loop on-device. HealthKit and personal data stay on the device. The embedded HTTP server listens on localhost only by default, with a token-gated opt-in for external access that the user configures manually.

## Per-category answers

### Contact Info
> Name, email, phone, physical address, other user contact info

**Do we collect this?** No.
Contacts data is **read** from the user's Contacts database at request time and returned only to the AI agent running on-device. It is never transmitted off the device, never persisted by AirMCP beyond the one request, and never linked to an advertising or analytics identifier.

### Health and Fitness

**Do we collect this?** No.
HealthKit data is **read** aggregated (steps today, 7-day resting heart rate average, sleep hours) via the Foundation Models Bridge. Raw samples never leave `HKHealthStore`. Per App Store Guideline 5.1.2, no health data is transmitted to any cloud LLM — AirMCP forbids this at the code layer by routing health reads only through the on-device `FoundationModelsBridge.run()` path.

### Financial Info
**Do we collect this?** No. AirMCP does not access any financial data.

### Location
**Do we collect this?** No.
Location can be **read** (current coarse-or-precise location, user-gated by `CLLocationManager`) and returned to the on-device AI agent. Never transmitted off-device, never logged.

### Sensitive Info
**Do we collect this?** No.

### Contacts
See "Contact Info" above.

### User Content

Calendar events, reminders, notes, emails, messages — all **read** only to answer the user's own request. Writes (e.g. "create a reminder to call mom") go through the platform's standard permission prompts. No content is transmitted off-device.

### Browsing History
**Do we collect this?** No.

### Search History
**Do we collect this?** No.

### Identifiers
**Do we collect this?** No.
AirMCP does not access the IDFA or any vendor identifier and does not persist its own installation ID.

### Purchases
**Do we collect this?** No.

### Usage Data
**Do we collect this?** No.
The `usageTracker` mentioned in AirMCP docs is a macOS-only, **on-device** file under `~/.airmcp/profile.json` that personalizes `_links` suggestions inside MCP responses. It ships on macOS via the npm binary; **on iOS it is not active**.

### Diagnostics
**Do we collect this?** No. No crash reporters, no third-party analytics.

### Other Data
**Do we collect this?** No.

## Third-party SDK data practices

AirMCP iOS uses the following open-source Swift packages, all audited:
- `hummingbird` (Apache-2.0): HTTP server, localhost-only by default.
- `swift-nio`, `swift-nio-ssl`, `swift-crypto`: transport primitives; each ships its own `PrivacyInfo.xcprivacy`.
- Apple frameworks: `FoundationModels`, `AppIntents`, `EventKit`, `Contacts`, `CoreLocation`, `HealthKit`.

None of these SDKs collect data on our behalf.

## Contact

- Privacy questions: see `docs/PRIVACY_POLICY.md` in the open-source repository at https://github.com/heznpc/AirMCP.
- Security disclosures: `SECURITY.md` in the same repository.
