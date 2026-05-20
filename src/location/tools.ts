import type { McpServer } from "../shared/mcp.js";
import { z } from "zod";
import type { AirMcpConfig } from "../shared/config.js";
import { okStructured, okUntrustedStructured, errSwiftFor } from "../shared/result.js";
import { runSwift } from "../shared/swift.js";

interface LocationResult {
  latitude: number;
  longitude: number;
  altitude: number;
  horizontalAccuracy: number;
  verticalAccuracy: number;
  timestamp: string;
}

interface LocationPermissionResult {
  status: string;
  authorized: boolean;
}

export function registerLocationTools(server: McpServer, _config: AirMcpConfig): void {
  server.registerTool(
    "get_current_location",
    {
      title: "Get Current Location",
      description:
        "Get the device's current geographic location (latitude, longitude, altitude). " +
        "Requires Location Services permission. First use triggers a macOS permission dialog.",
      inputSchema: {},
      // Wave 8 outputSchema: matches Swift LocationOutput (Types.swift). The
      // payload describes the user's physical location, so it's emitted via
      // okUntrustedStructured to flag it as user-context data.
      outputSchema: {
        latitude: z.number(),
        longitude: z.number(),
        altitude: z.number(),
        horizontalAccuracy: z.number(),
        verticalAccuracy: z.number(),
        timestamp: z.string(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        return okUntrustedStructured(await runSwift<LocationResult>("get-location", "{}"));
      } catch (e) {
        return errSwiftFor("get current location", e);
      }
    },
  );

  server.registerTool(
    "get_location_permission",
    {
      title: "Get Location Permission",
      description:
        "Check the current Location Services authorization status. " +
        "Returns the permission state (not_determined, authorized_always, denied, restricted).",
      inputSchema: {},
      // Matches Swift LocationPermissionOutput — a fixed status string from
      // CoreLocation and a derived boolean. Not user content; emit plain.
      outputSchema: {
        status: z.string(),
        authorized: z.boolean(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        return okStructured(await runSwift<LocationPermissionResult>("location-permission", "{}"));
      } catch (e) {
        return errSwiftFor("get location permission", e);
      }
    },
  );
}
