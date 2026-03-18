import type { McpServer } from "../shared/mcp.js";
import { z } from "zod";
import { runJxa } from "../shared/jxa.js";
import type { AirMcpConfig } from "../shared/config.js";
import { ok, toolError } from "../shared/result.js";
import {
  searchLocationScript,
  getDirectionsScript,
  dropPinScript,
  openInMapsScript,
  searchNearbyScript,
  shareLocationScript,
} from "./scripts.js";
import { fetchGeocode, fetchReverseGeocode } from "./api.js";

export function registerMapsTools(server: McpServer, _config: AirMcpConfig): void {
  server.registerTool(
    "search_location",
    {
      title: "Search Location",
      description: "Search for a place or location in Apple Maps.",
      inputSchema: {
        query: z.string().describe("Location or place to search for"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ query }) => {
      try {
        return ok(await runJxa(searchLocationScript(query)));
      } catch (e) {
        return toolError("search location", e);
      }
    },
  );

  server.registerTool(
    "get_directions",
    {
      title: "Get Directions",
      description: "Get directions between two locations in Apple Maps.",
      inputSchema: {
        from: z.string().describe("Starting location or address"),
        to: z.string().describe("Destination location or address"),
        transportType: z
          .enum(["driving", "walking", "transit"])
          .optional()
          .default("driving")
          .describe("Mode of transport (default: driving)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ from, to, transportType }) => {
      try {
        return ok(await runJxa(getDirectionsScript(from, to, transportType)));
      } catch (e) {
        return toolError("get directions", e);
      }
    },
  );

  server.registerTool(
    "drop_pin",
    {
      title: "Drop Pin",
      description: "Drop a pin at specific coordinates in Apple Maps.",
      inputSchema: {
        latitude: z.number().describe("Latitude coordinate"),
        longitude: z.number().describe("Longitude coordinate"),
        label: z.string().optional().describe("Optional label for the pin"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ latitude, longitude, label }) => {
      try {
        return ok(await runJxa(dropPinScript(latitude, longitude, label)));
      } catch (e) {
        return toolError("drop pin", e);
      }
    },
  );

  server.registerTool(
    "open_address",
    {
      title: "Open Address",
      description: "Open a specific address in Apple Maps.",
      inputSchema: {
        address: z.string().describe("Address to open in Maps"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ address }) => {
      try {
        return ok(await runJxa(openInMapsScript(address)));
      } catch (e) {
        return toolError("open address", e);
      }
    },
  );

  server.registerTool(
    "search_nearby",
    {
      title: "Search Nearby",
      description: "Search for places near a location in Apple Maps. If no coordinates are given, searches near the current location.",
      inputSchema: {
        query: z.string().describe("What to search for (e.g. 'coffee shops', 'gas stations')"),
        latitude: z.number().optional().describe("Latitude of the center point"),
        longitude: z.number().optional().describe("Longitude of the center point"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ query, latitude, longitude }) => {
      try {
        return ok(await runJxa(searchNearbyScript(query, latitude, longitude)));
      } catch (e) {
        return toolError("search nearby", e);
      }
    },
  );

  server.registerTool(
    "share_location",
    {
      title: "Share Location",
      description: "Generate a shareable Apple Maps link for a location.",
      inputSchema: {
        latitude: z.number().describe("Latitude coordinate"),
        longitude: z.number().describe("Longitude coordinate"),
        label: z.string().optional().describe("Optional label for the location"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ latitude, longitude, label }) => {
      try {
        return ok(await runJxa(shareLocationScript(latitude, longitude, label)));
      } catch (e) {
        return toolError("share location", e);
      }
    },
  );

  server.registerTool(
    "geocode",
    {
      title: "Geocode",
      description: "Convert a place name or address to geographic coordinates. Returns up to 5 matching locations with latitude, longitude, country, and timezone.",
      inputSchema: {
        query: z.string().min(1).describe("Place name or address (e.g. 'Seoul', 'Tokyo Tower', '1600 Pennsylvania Ave')"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ query }) => {
      try {
        return ok(await fetchGeocode(query));
      } catch (e) {
        return toolError("geocode", e);
      }
    },
  );

  server.registerTool(
    "reverse_geocode",
    {
      title: "Reverse Geocode",
      description: "Convert geographic coordinates to a place name and address.",
      inputSchema: {
        latitude: z.number().min(-90).max(90).describe("Latitude coordinate"),
        longitude: z.number().min(-180).max(180).describe("Longitude coordinate"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ latitude, longitude }) => {
      try {
        return ok(await fetchReverseGeocode(latitude, longitude));
      } catch (e) {
        return toolError("reverse geocode", e);
      }
    },
  );
}
