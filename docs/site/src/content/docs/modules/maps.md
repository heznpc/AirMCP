---
title: Maps
description: Geocoding, reverse geocoding, directions, location sharing, place search, and pin dropping in Apple Maps.
---

## Tools

| Tool | Description | Read-only |
|------|-------------|-----------|
| `search_location` | Search for a place or location in Apple Maps. | ❌ |
| `get_directions` | Get directions between two locations in Apple Maps. Supports driving, walking, and transit. | ❌ |
| `drop_pin` | Drop a pin at specific coordinates in Apple Maps. | ❌ |
| `open_address` | Open a specific address in Apple Maps. | ❌ |
| `search_nearby` | Search for places near a location in Apple Maps. If no coordinates are given, searches near the current location. | ❌ |
| `share_location` | Generate a shareable Apple Maps link for a location. | ✅ |
| `geocode` | Convert a place name or address to geographic coordinates. Returns up to 5 matching locations. | ✅ |
| `reverse_geocode` | Convert geographic coordinates to a place name and address. | ✅ |

## Quick Examples

```
// Search
"Search for 'Tokyo Tower' on Apple Maps"

// Directions
"Get driving directions from Seoul to Busan"

// Nearby places
"Find coffee shops near my location"

// Geocoding
"What are the coordinates for 1600 Pennsylvania Avenue?"
```

## Permissions

Requires **Automation** permission for Apple Maps. Geocoding uses the Open-Meteo API and does not require an API key. The `search_nearby` tool can use current location if coordinates are omitted.
