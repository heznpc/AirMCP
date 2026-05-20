import type { McpServer } from "../shared/mcp.js";
import { z } from "zod";
import type { AirMcpConfig } from "../shared/config.js";
import { okUntrustedStructured, okUntrustedLinkedStructured, errUpstreamFor } from "../shared/result.js";
import { fetchCurrentWeather, fetchDailyForecast, fetchHourlyForecast } from "./api.js";

const dailyForecastDaySchema = z.object({
  date: z.string(),
  weatherCode: z.number(),
  weatherDescription: z.string().max(5000),
  temperatureMax: z.number(),
  temperatureMin: z.number(),
  sunrise: z.string(),
  sunset: z.string(),
  precipitationSum: z.number(),
  precipitationProbabilityMax: z.number().nullable(),
  windSpeedMax: z.number(),
});

const hourlyForecastHourSchema = z.object({
  time: z.string(),
  temperature: z.number(),
  feelsLike: z.number(),
  humidity: z.number(),
  weatherCode: z.number(),
  weatherDescription: z.string().max(5000),
  precipitation: z.number(),
  precipitationProbability: z.number().nullable(),
  windSpeed: z.number(),
  cloudCover: z.number(),
});

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
        return errUpstreamFor("get current weather", e, { retryable: true });
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
      outputSchema: {
        forecast: z.array(dailyForecastDaySchema),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ latitude, longitude, days }) => {
      try {
        const forecast = (await fetchDailyForecast(latitude, longitude, days)) as z.infer<
          typeof dailyForecastDaySchema
        >[];
        return okUntrustedStructured({ forecast });
      } catch (e) {
        return errUpstreamFor("get daily forecast", e, { retryable: true });
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
      outputSchema: {
        forecast: z.array(hourlyForecastHourSchema),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ latitude, longitude, hours }) => {
      try {
        const forecast = (await fetchHourlyForecast(latitude, longitude, hours)) as z.infer<
          typeof hourlyForecastHourSchema
        >[];
        return okUntrustedStructured({ forecast });
      } catch (e) {
        return errUpstreamFor("get hourly forecast", e, { retryable: true });
      }
    },
  );
}
