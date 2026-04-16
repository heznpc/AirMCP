---
title: Location
description: Location permission status and current location via CoreLocation.
---

## Tools

| Tool | Description | Read-only |
|------|-------------|-----------|
| `get_current_location` | Get the device's current geographic location (latitude, longitude, altitude). First use triggers a macOS permission dialog. | ✅ |
| `get_location_permission` | Check the current Location Services authorization status (not_determined, authorized_always, denied, restricted). | ✅ |

## Quick Examples

```
// Check permission
"Check if location services are enabled"

// Get location
"What's my current location?"
```

## Permissions

Requires **Location Services** permission. The first use of `get_current_location` will trigger a macOS permission dialog. Grant access via System Settings > Privacy & Security > Location Services. Requires the macOS Swift bridge.
