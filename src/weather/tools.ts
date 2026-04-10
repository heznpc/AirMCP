import type { McpServer } from "../shared/mcp.js";
import { z } from "zod";
import type { AirMcpConfig } from "../shared/config.js";
import { okUntrusted, okUntrustedLinkedStructured, toolError } from "../shared/result.js";
import { fetchCurrentWeather, fetchDailyForecast, fetchHourlyForecast } from "./api.js";

export function registerWeatherTools(server: McpServer, _config: AirMcpConfig): void {
  server.registerTool(
    "get_current_weather",
    {
      title: "Get Current Weather",
      description: "Get current weather conditions for a location using coordinates.",
      inputSchema: {
        latitude: z.number().min(-90).max(90).describe("Latitude coordinate"),
        longitude: z.number().min(-180).max(180).describe("Longitude coordinate"),
      },
      outputSchema: {
        temperature: z.number().describe("Current temperature in Celsius"),
        feelsLike: z.number().describe("Apparent temperature in Celsius"),
        humidity: z.number().describe("Relative humidity percentage"),
        weatherCode: z.number().describe("WMO weather code"),
        weatherDescription: z.string().max(5000).describe("Human-readable weather description"),
        windSpeed: z.number().describe("Wind speed in km/h"),
        windDirection: z.number().describe("Wind direction in degrees"),
        precipitation: z.number().describe("Precipitation in mm"),
        cloudCover: z.number().describe("Cloud cover percentage"),
        units: z
          .object({
            temperature: z.string(),
            windSpeed: z.string(),
            precipitation: z.string(),
          })
          .describe("Units for numeric values"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ latitude, longitude }) => {
      try {
        const result = await fetchCurrentWeather(latitude, longitude);
        return okUntrustedLinkedStructured("get_current_weather", result);
      } catch (e) {
        return toolError("get current weather", e);
      }
    },
  );

  server.registerTool(
    "get_daily_forecast",
    {
      title: "Get Daily Forecast",
      description: "Get daily weather forecast for a location.",
      inputSchema: {
        latitude: z.number().min(-90).max(90).describe("Latitude coordinate"),
        longitude: z.number().min(-180).max(180).describe("Longitude coordinate"),
        days: z.number().int().min(1).max(16).optional().default(7).describe("Number of forecast days (default: 7)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ latitude, longitude, days }) => {
      try {
        return okUntrusted(await fetchDailyForecast(latitude, longitude, days));
      } catch (e) {
        return toolError("get daily forecast", e);
      }
    },
  );

  server.registerTool(
    "get_hourly_forecast",
    {
      title: "Get Hourly Forecast",
      description: "Get hourly weather forecast for a location.",
      inputSchema: {
        latitude: z.number().min(-90).max(90).describe("Latitude coordinate"),
        longitude: z.number().min(-180).max(180).describe("Longitude coordinate"),
        hours: z
          .number()
          .int()
          .min(1)
          .max(168)
          .optional()
          .default(24)
          .describe("Number of forecast hours (default: 24)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ latitude, longitude, hours }) => {
      try {
        return okUntrusted(await fetchHourlyForecast(latitude, longitude, hours));
      } catch (e) {
        return toolError("get hourly forecast", e);
      }
    },
  );
}
