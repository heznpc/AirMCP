import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TIMEOUT, BUFFER, PATHS } from "./constants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BINARY_PATH = resolve(__dirname, PATHS.SWIFT_BRIDGE);

let bridgeChecked = false;
let bridgeError: string | null = null;

export async function checkSwiftBridge(): Promise<string | null> {
  if (bridgeChecked) return bridgeError;
  try {
    await access(BINARY_PATH);
    bridgeError = null;
  } catch {
    bridgeError = "Apple Intelligence requires macOS 26+ with Apple Silicon. Swift bridge not found. Run 'npm run swift-build' to compile.";
  }
  bridgeChecked = true;
  return bridgeError;
}

export async function runSwift<T>(command: string, input: string): Promise<T> {
  const missing = await checkSwiftBridge();
  if (missing) throw new Error(missing);

  return new Promise<T>((resolve, reject) => {
    const child = spawn(BINARY_PATH, [command], {
      timeout: TIMEOUT.SWIFT,
    });

    let stdout = "";
    let stderr = "";
    let size = 0;

    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > BUFFER.SWIFT) {
        child.kill("SIGTERM");
        reject(new Error(`Swift bridge output exceeded ${BUFFER.SWIFT} bytes`));
        return;
      }
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("close", (code, signal) => {
      if (signal === "SIGTERM") {
        reject(new Error(`Swift bridge timed out after ${TIMEOUT.SWIFT / 1000}s`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`Swift bridge exited with code ${code}: ${stderr || stdout}`));
        return;
      }
      const trimmed = stdout.trim();
      if (!trimmed) {
        reject(new Error("Swift bridge returned empty output"));
        return;
      }
      try {
        resolve(JSON.parse(trimmed) as T);
      } catch {
        reject(new Error(`Swift bridge returned invalid JSON: ${trimmed.slice(0, 200)}`));
      }
    });

    child.on("error", reject);

    child.stdin.write(input);
    child.stdin.end();
  });
}
