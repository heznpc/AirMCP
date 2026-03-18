import type { McpServer } from "../shared/mcp.js";
import { z } from "zod";
import type { AirMcpConfig } from "../shared/config.js";
import { ok, toolError } from "../shared/result.js";
import { runSwift } from "../shared/swift.js";

interface BluetoothStateResult {
  state: string;
  powered: boolean;
}

interface BluetoothDevice {
  name: string | null;
  identifier: string;
  rssi: number;
}

interface BluetoothScanResult {
  total: number;
  devices: BluetoothDevice[];
}

interface BluetoothConnectResult {
  success: boolean;
  identifier: string;
  name: string | null;
}

export function registerBluetoothTools(server: McpServer, _config: AirMcpConfig): void {
  server.registerTool(
    "get_bluetooth_state",
    {
      title: "Get Bluetooth State",
      description: "Check whether Bluetooth is powered on, off, or unauthorized.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        return ok(await runSwift<BluetoothStateResult>("bluetooth-state", "{}"));
      } catch (e) {
        return toolError("get bluetooth state", e);
      }
    },
  );

  server.registerTool(
    "scan_bluetooth",
    {
      title: "Scan Bluetooth",
      description:
        "Scan for nearby BLE (Bluetooth Low Energy) devices. Returns device names, UUIDs, and signal strength (RSSI). " +
        "Default scan duration is 5 seconds.",
      inputSchema: {
        duration: z
          .number()
          .min(1)
          .max(30)
          .optional()
          .default(5)
          .describe("Scan duration in seconds (1-30, default: 5)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ duration }) => {
      try {
        return ok(await runSwift<BluetoothScanResult>("scan-bluetooth", JSON.stringify({ duration })));
      } catch (e) {
        return toolError("scan bluetooth", e);
      }
    },
  );

  server.registerTool(
    "connect_bluetooth",
    {
      title: "Connect Bluetooth",
      description:
        "Connect to a BLE device by its UUID. The UUID can be obtained from scan_bluetooth results. " +
        "Note: the connection persists only while the server process is running.",
      inputSchema: {
        identifier: z.string().uuid().describe("Peripheral UUID from scan results"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ identifier }) => {
      try {
        return ok(await runSwift<BluetoothConnectResult>("connect-bluetooth", JSON.stringify({ identifier })));
      } catch (e) {
        return toolError("connect bluetooth", e);
      }
    },
  );

  server.registerTool(
    "disconnect_bluetooth",
    {
      title: "Disconnect Bluetooth",
      description: "Disconnect a BLE device by its UUID.",
      inputSchema: {
        identifier: z.string().uuid().describe("Peripheral UUID to disconnect"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ identifier }) => {
      try {
        return ok(await runSwift<BluetoothConnectResult>("disconnect-bluetooth", JSON.stringify({ identifier })));
      } catch (e) {
        return toolError("disconnect bluetooth", e);
      }
    },
  );
}
