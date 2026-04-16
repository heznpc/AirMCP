---
title: Health
description: Read-only HealthKit data -- steps, heart rate, sleep, active energy, exercise minutes, and combined health dashboard.
---

## Tools

| Tool | Description | Read-only |
|------|-------------|-----------|
| `health_summary` | Get a combined health dashboard: today's steps, 7-day average heart rate, last night's sleep, active energy burned, and exercise minutes. | ✅ |
| `health_today_steps` | Get aggregated step count for today from HealthKit. | ✅ |
| `health_heart_rate` | Get average resting heart rate over the last 7 days (bpm) from HealthKit. | ✅ |
| `health_sleep` | Get total sleep hours for a given date (defaults to last night). Only counts actual sleep stages, not time in bed. | ✅ |
| `health_authorize` | Request read-only HealthKit authorization. Call this first if other health tools return permission errors. | ❌ |

## Quick Examples

```
// Daily dashboard
"Show my health summary"

// Steps
"How many steps have I taken today?"

// Sleep
"How many hours did I sleep last night?"

// Heart rate
"What's my average resting heart rate this week?"
```

## Permissions

Requires **HealthKit** authorization. Call `health_authorize` first to request read-only access. All data is aggregated (no raw samples or timestamps are exposed). Requires the macOS Swift bridge.
