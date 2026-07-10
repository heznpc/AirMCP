import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const bundle = readFileSync(new URL("../scripts/bundle-app.sh", import.meta.url), "utf8");
const probe = readFileSync(new URL("../scripts/verify-governed-workflow.mjs", import.meta.url), "utf8");
const constants = readFileSync(new URL("../src/shared/constants.ts", import.meta.url), "utf8");
const tokenNode = readFileSync(new URL("../src/shared/app-runtime-token.ts", import.meta.url), "utf8");
const tokenSwift = readFileSync(new URL("../app/Sources/AirMCPApp/AppRuntimeToken.swift", import.meta.url), "utf8");
const app = readFileSync(new URL("../app/Sources/AirMCPApp/AirMCPApp.swift", import.meta.url), "utf8");

describe("governed app-owned acceptance wiring", () => {
  test("exposes one explicit local acceptance command", () => {
    expect(pkg.scripts["app:verify:governed"]).toBe("./scripts/bundle-app.sh verify-governed");
    expect(bundle).toContain("setup_governed_environment");
    expect(bundle).toContain("verify_governed_workflow");
    expect(bundle).toContain("verify-governed-workflow.mjs");
    expect(bundle).toMatch(/if \[ "\$MODE" = "verify-governed" \]; then[\s\S]*AIRMCP_EMBED_RUNTIME=1/);
  });

  test("uses real MCP elicitation instead of an auto-approval server hook", () => {
    expect(probe).toContain("StreamableHTTPClientTransport");
    expect(probe).toContain("ElicitRequestSchema");
    expect(probe).toContain('{ action: "accept", content: { approve: true } }');
    expect(probe).toContain('{ action: "decline" }');
    expect(probe).not.toMatch(/AUTO.?APPROVE/i);
    expect(bundle).not.toMatch(/AUTO.?APPROVE/i);
    expect(probe).toContain('"X-AirMCP-Run-ID": runId');
  });

  test("proves write isolation, emergency stop, and HMAC-chain verification", () => {
    for (const tool of ["memory_stats", "memory_put", "memory_forget", "audit_log", "audit_summary"]) {
      expect(probe).toContain(`"${tool}"`);
    }
    expect(probe).toContain("correlationId: runId");
    expect(probe).toContain('approvalDecision: "approved"');
    expect(probe).toContain('approvalDecision: "denied"');
    expect(probe).toContain('gate: "emergency_stop"');
    expect(probe).toContain("summary?.verified === true");
    expect(probe).toContain("summary?.auditDisabled === false");
    expect(bundle).toContain('AIRMCP_HITL_LEVEL="sensitive-only"');
    expect(bundle).toContain('AIRMCP_RATE_LIMIT="true"');
    expect(bundle).not.toContain('AIRMCP_TEST_MODE="1"');
  });

  test("shares isolated memory, HITL, config, and token paths across runtimes", () => {
    expect(constants).toContain('envStr("AIRMCP_MEMORY_STORE_PATH"');
    expect(constants).toContain('envStr("AIRMCP_HITL_SOCKET_PATH"');
    expect(tokenNode).toContain("process.env.AIRMCP_APP_RUNTIME_TOKEN_PATH");
    expect(tokenSwift).toContain('environment["AIRMCP_APP_RUNTIME_TOKEN_PATH"]');
    expect(bundle).toContain('AIRMCP_VECTOR_STORE_DIR="$GOVERNED_STATE_DIR/audit"');
    expect(bundle).toContain('AIRMCP_EMERGENCY_STOP_PATH="$GOVERNED_STATE_DIR/emergency-stop"');
    expect(bundle).toContain('CFFIXED_USER_HOME="$GOVERNED_STATE_DIR/home"');
  });

  test("does not request notification permission when the app-side HITL listener is off", () => {
    const setup = app.match(/private func setupHitl\(\)[\s\S]*?\n    }/)?.[0] ?? "";
    expect(setup).toMatch(
      /if configManager\.hitlLevel != \.off \{[\s\S]*HitlManager\.requestNotificationPermission\(\)/,
    );
  });

  test("waits through production shutdown and asserts process/temp cleanup", () => {
    const waitSteps = Number(bundle.match(/PROCESS_SHUTDOWN_WAIT_STEPS=(\d+)/)?.[1] ?? 0);
    expect(waitSteps).toBeGreaterThanOrEqual(60);
    expect(bundle).toContain("assert_no_bundle_processes");
    expect(bundle).toContain('terminate_matching_command contains "$PROJECT_DIR modules list --json"');
    expect(bundle).toContain('if [ -e "$state_dir" ]');
    expect(bundle).toContain("trap - EXIT");
    // Never sweep the many legitimate current-checkout MCP proxy processes.
    expect(bundle).not.toContain('terminate_matching_command contains "$PROJECT_DIR"\n');
  });
});
