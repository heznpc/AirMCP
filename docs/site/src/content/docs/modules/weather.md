---
title: Weather
description: Current weather, daily forecast, and hourly forecast via Open-Meteo API.
---

## Tools

| Tool | Description | Read-only |
|------|-------------|-----------|
| `get_current_weather` | Get current weather conditions for a location using coordinates. Returns temperature, humidity, wind, precipitation, and cloud cover. | ✅ |
| `get_daily_forecast` | Get daily weather forecast for a location (up to 16 days). | ✅ |
| `get_hourly_forecast` | Get hourly weather forecast for a location (up to 168 hours). | ✅ |

## Quick Examples

```
// Current conditions
"What's the weather like at latitude 37.5665, longitude 126.9780?" (Seoul)

// Forecast
"Get the 7-day forecast for Tokyo (35.6762, 139.6503)"

// Hourly
"Show hourly weather for the next 12 hours in San Francisco"
```

## Permissions

No macOS permissions required. Uses the **Open-Meteo API** which is free and requires no API key. Coordinates (latitude/longitude) must be provided -- combine with the `geocode` tool from the Maps module to look up coordinates by place name.
