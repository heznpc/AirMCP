---
title: Bluetooth
description: Bluetooth state, BLE device discovery, connect, and disconnect.
---

## Tools

| Tool | Description | Read-only |
|------|-------------|-----------|
| `get_bluetooth_state` | Check whether Bluetooth is powered on, off, or unauthorized. | ✅ |
| `scan_bluetooth` | Scan for nearby BLE (Bluetooth Low Energy) devices. Returns device names, UUIDs, and signal strength (RSSI). Default scan duration is 5 seconds. | ✅ |
| `connect_bluetooth` | Connect to a BLE device by its UUID. The connection persists only while the server process is running. | ❌ |
| `disconnect_bluetooth` | Disconnect a BLE device by its UUID. | ❌ |

## Quick Examples

```
// Check status
"Is Bluetooth turned on?"

// Discover devices
"Scan for nearby Bluetooth devices"

// Connect
"Connect to Bluetooth device with UUID xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

## Permissions

Requires **Bluetooth** permission. The first use may trigger a macOS permission dialog. Requires the macOS Swift bridge. Note: BLE connections are limited to the server process lifecycle.
