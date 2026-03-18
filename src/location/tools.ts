import type { McpServer } from "../shared/mcp.js";
import type { AirMcpConfig } from "../shared/config.js";
import { ok, toolError } from "../shared/result.js";
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
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        return ok(await runSwift<LocationResult>("get-location", "{}"));
      } catch (e) {
        return toolError("get current location", e);
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
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        return ok(await runSwift<LocationPermissionResult>("location-permission", "{}"));
      } catch (e) {
        return toolError("get location permission", e);
      }
    },
  );
}
