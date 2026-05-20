import type { McpServer } from "../shared/mcp.js";
import { z } from "zod";
import type { AirMcpConfig } from "../shared/config.js";
import { okStructured, okUntrustedStructured, errSwiftFor } from "../shared/result.js";
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

// Per-device summary returned by Swift `scan-bluetooth` (BluetoothDeviceInfo).
// Names are advertised by nearby peripherals and are attacker-controlled
// text, which is why the scan result is emitted untrusted.
const bluetoothDeviceSchema = z.object({
  name: z.string().nullable(),
  identifier: z.string(),
  rssi: z.number().int(),
});

export function registerBluetoothTools(server: McpServer, _config: AirMcpConfig): void {
  server.registerTool(
    "get_bluetooth_state",
    {
      title: "Get Bluetooth State",
      description: "Check whether Bluetooth is powered on, off, or unauthorized.",
      inputSchema: {},
      // Wave 8 outputSchema: matches Swift BluetoothStateOutput. Fixed
      // status string + boolean, not user-controlled.
      outputSchema: {
        state: z.string(),
        powered: z.boolean(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        return okStructured(await runSwift<BluetoothStateResult>("bluetooth-state", "{}"));
      } catch (e) {
        return errSwiftFor("get bluetooth state", e);
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
      // Device names come from third-party BLE advertisements — untrusted.
      // Matches Swift BluetoothScanOutput { total, devices[] }.
      outputSchema: {
        total: z.number().int(),
        devices: z.array(bluetoothDeviceSchema),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ duration }) => {
      try {
        return okUntrustedStructured(
          await runSwift<BluetoothScanResult>("scan-bluetooth", JSON.stringify({ duration })),
        );
      } catch (e) {
        return errSwiftFor("scan bluetooth", e);
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
      // Matches Swift BluetoothConnectOutput. `name` is the peripheral's
      // advertised name (third-party text) — flag as untrusted.
      outputSchema: {
        success: z.boolean(),
        identifier: z.string(),
        name: z.string().nullable(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ identifier }) => {
      try {
        return okUntrustedStructured(
          await runSwift<BluetoothConnectResult>("connect-bluetooth", JSON.stringify({ identifier })),
        );
      } catch (e) {
        return errSwiftFor("connect bluetooth", e);
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
      // Same shape as connect — Swift reuses BluetoothConnectOutput. The
      // peripheral name is third-party advertised text → untrusted.
      outputSchema: {
        success: z.boolean(),
        identifier: z.string(),
        name: z.string().nullable(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ identifier }) => {
      try {
        return okUntrustedStructured(
          await runSwift<BluetoothConnectResult>("disconnect-bluetooth", JSON.stringify({ identifier })),
        );
      } catch (e) {
        return errSwiftFor("disconnect bluetooth", e);
      }
    },
  );
}
