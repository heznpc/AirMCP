import type { McpServer } from "../shared/mcp.js";
import { z } from "zod";
import { runJxa } from "../shared/jxa.js";
import type { AirMcpConfig } from "../shared/config.js";
import {
  okStructured,
  okUntrustedStructured,
  okLinkedStructured,
  errJxaFor,
  errUpstreamFor,
} from "../shared/result.js";
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
        query: z.string().max(500).describe("Location or place to search for"),
      },
      // Wave 8 outputSchema: the JXA script echoes the user-supplied
      // `query` string back to the caller, so the structured payload is
      // emitted via the untrusted-aware linked helper.
      outputSchema: {
        searched: z.literal(true),
        query: z.string(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ query }) => {
      try {
        const result = (await runJxa(searchLocationScript(query))) as { searched: true; query: string };
        return okLinkedStructured("search_maps", result);
      } catch (e) {
        return errJxaFor("search location", e);
      }
    },
  );

  server.registerTool(
    "get_directions",
    {
      title: "Get Directions",
      description: "Get directions between two locations in Apple Maps.",
      inputSchema: {
        from: z.string().max(500).describe("Starting location or address"),
        to: z.string().max(500).describe("Destination location or address"),
        transportType: z
          .enum(["driving", "walking", "transit"])
          .optional()
          .default("driving")
          .describe("Mode of transport (default: driving)"),
      },
      // Echoes user-supplied from/to strings — emit as untrusted.
      outputSchema: {
        directions: z.literal(true),
        from: z.string(),
        to: z.string(),
        transportType: z.string(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ from, to, transportType }) => {
      try {
        const result = (await runJxa(getDirectionsScript(from, to, transportType))) as {
          directions: true;
          from: string;
          to: string;
          transportType: string;
        };
        return okUntrustedStructured(result);
      } catch (e) {
        return errJxaFor("get directions", e);
      }
    },
  );

  server.registerTool(
    "drop_pin",
    {
      title: "Drop Pin",
      description: "Drop a pin at specific coordinates in Apple Maps.",
      inputSchema: {
        // Bare `z.number()` accepts ±Infinity (and any finite value) — JXA
        // would receive the literal `Infinity` keyword and silently produce
        // garbage map state. Match `reverse_geocode`'s bounds (line ~174)
        // so every coordinate-shaped input across this module validates the
        // same way; closes the consistency gap flagged in the 2026-05-13
        // audit.
        latitude: z.number().min(-90).max(90).describe("Latitude coordinate (degrees, -90 to 90)"),
        longitude: z.number().min(-180).max(180).describe("Longitude coordinate (degrees, -180 to 180)"),
        label: z.string().max(500).optional().describe("Optional label for the pin"),
      },
      // The script may include `label` only when the caller supplied one,
      // so the field is optional in the structured shape. lat/lng are
      // server-controlled numbers echoed back from the validated input.
      outputSchema: {
        pinned: z.literal(true),
        latitude: z.number(),
        longitude: z.number(),
        label: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ latitude, longitude, label }) => {
      try {
        const result = (await runJxa(dropPinScript(latitude, longitude, label))) as {
          pinned: true;
          latitude: number;
          longitude: number;
          label?: string;
        };
        return okStructured(result);
      } catch (e) {
        return errJxaFor("drop pin", e);
      }
    },
  );

  server.registerTool(
    "open_address",
    {
      title: "Open Address",
      description: "Open a specific address in Apple Maps.",
      inputSchema: {
        address: z.string().max(500).describe("Address to open in Maps"),
      },
      outputSchema: {
        opened: z.literal(true),
        address: z.string(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ address }) => {
      try {
        const result = (await runJxa(openInMapsScript(address))) as { opened: true; address: string };
        return okStructured(result);
      } catch (e) {
        return errJxaFor("open address", e);
      }
    },
  );

  server.registerTool(
    "search_nearby",
    {
      title: "Search Nearby",
      description:
        "Search for places near a location in Apple Maps. If no coordinates are given, searches near the current location.",
      inputSchema: {
        query: z.string().max(500).describe("What to search for (e.g. 'coffee shops', 'gas stations')"),
        // Optional but still bounded — an undefined coordinate falls back to
        // the device's current location; a finite-but-out-of-range one would
        // silently produce nonsense.
        latitude: z.number().min(-90).max(90).optional().describe("Latitude of the center point (degrees, -90 to 90)"),
        longitude: z
          .number()
          .min(-180)
          .max(180)
          .optional()
          .describe("Longitude of the center point (degrees, -180 to 180)"),
      },
      // `near` is emitted only when both coordinates are supplied, so the
      // structured shape marks it optional. `query` is user-supplied and
      // echoed back — flagged via okUntrustedStructured.
      outputSchema: {
        searched: z.literal(true),
        query: z.string(),
        near: z
          .object({
            latitude: z.number(),
            longitude: z.number(),
          })
          .optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ query, latitude, longitude }) => {
      try {
        const result = (await runJxa(searchNearbyScript(query, latitude, longitude))) as {
          searched: true;
          query: string;
          near?: { latitude: number; longitude: number };
        };
        return okUntrustedStructured(result);
      } catch (e) {
        return errJxaFor("search nearby", e);
      }
    },
  );

  server.registerTool(
    "share_location",
    {
      title: "Share Location",
      description: "Generate a shareable Apple Maps link for a location.",
      inputSchema: {
        latitude: z.number().min(-90).max(90).describe("Latitude coordinate (degrees, -90 to 90)"),
        longitude: z.number().min(-180).max(180).describe("Longitude coordinate (degrees, -180 to 180)"),
        label: z.string().max(500).optional().describe("Optional label for the location"),
      },
      // The script only returns a URL string assembled from validated inputs.
      outputSchema: {
        url: z.string(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ latitude, longitude, label }) => {
      try {
        const result = (await runJxa(shareLocationScript(latitude, longitude, label))) as { url: string };
        return okStructured(result);
      } catch (e) {
        return errJxaFor("share location", e);
      }
    },
  );

  server.registerTool(
    "geocode",
    {
      title: "Geocode",
      description:
        "Convert a place name or address to geographic coordinates. Returns up to 5 matching locations with latitude, longitude, country, and timezone.",
      inputSchema: {
        query: z
          .string()
          .min(1)
          .max(500)
          .describe("Place name or address (e.g. 'Seoul', 'Tokyo Tower', '1600 Pennsylvania Ave')"),
      },
      // Results come from the Open-Meteo geocoding service — third-party
      // user-facing strings (names, country names, timezone IDs) are flagged
      // untrusted. Optional fields mirror the API's nullable shape.
      outputSchema: {
        total: z.number().int(),
        results: z.array(
          z.object({
            name: z.string(),
            latitude: z.number(),
            longitude: z.number(),
            country: z.string().optional(),
            countryCode: z.string().optional(),
            admin1: z.string().nullable(),
            elevation: z.number().nullable(),
            timezone: z.string().nullable(),
            population: z.number().nullable(),
          }),
        ),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ query }) => {
      try {
        return okUntrustedStructured(await fetchGeocode(query));
      } catch (e) {
        return errUpstreamFor("geocode", e, { retryable: true });
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
      // Response comes from Nominatim — third-party address text is
      // flagged untrusted. All nested address fields are nullable per
      // fetchReverseGeocode normalisation.
      outputSchema: {
        name: z.string().nullable(),
        displayName: z.string().nullable(),
        latitude: z.number(),
        longitude: z.number(),
        address: z.object({
          road: z.string().nullable(),
          city: z.string().nullable(),
          state: z.string().nullable(),
          country: z.string().nullable(),
          postcode: z.string().nullable(),
        }),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ latitude, longitude }) => {
      try {
        return okUntrustedStructured(await fetchReverseGeocode(latitude, longitude));
      } catch (e) {
        return errUpstreamFor("reverse geocode", e, { retryable: true });
      }
    },
  );
}
