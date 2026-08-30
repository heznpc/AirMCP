/** UI input values must be removed before a row is sealed into the HMAC audit
 * chain. These tests inspect the actual JSONL bytes as well as the verified
 * public history so a read-time-only redaction cannot satisfy the regression. */
import { afterAll, beforeEach, describe, expect, test } from "@jest/globals";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const workDir = await mkdtemp(join(tmpdir(), "airmcp-audit-ui-redaction-"));
process.env.AIRMCP_VECTOR_STORE_DIR = workDir;
process.env.AIRMCP_AUDIT_HMAC_KEY = "audit-ui-redaction-key";
process.env.AIRMCP_AUDIT_LOG = "true";

const audit = await import("../dist/shared/audit.js");
const auditPath = join(workDir, "audit.jsonl");

async function writeRows(entries) {
  for (const entry of entries) {
    audit.auditLog({ timestamp: new Date().toISOString(), status: "ok", ...entry });
  }
  await audit._testFlush();
  const raw = await readFile(auditPath, "utf8");
  return {
    raw,
    rows: raw
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line)),
  };
}

beforeEach(() => audit._testReset());

afterAll(async () => {
  audit._testReset();
  await rm(workDir, { recursive: true, force: true });
});

describe("UI-input audit redaction", () => {
  test("redacts sensitive UI values before sealing while preserving benign context", async () => {
    const secrets = {
      ui_type: "hunter2 secret passphrase",
      ui_perform_action: "s3cr3t-value",
      ui_diff: "SECRET-SNAPSHOT-1234",
    };
    const { raw, rows } = await writeRows([
      { tool: "ui_type", args: { text: secrets.ui_type, appName: "Notes", locator: "AXTextField:Body" } },
      {
        tool: "ui_perform_action",
        args: {
          role: "AXTextField",
          title: "Password",
          action: "setValue",
          actionValue: secrets.ui_perform_action,
        },
      },
      {
        tool: "ui_diff",
        args: { beforeSnapshot: [{ role: "AXStaticText", value: secrets.ui_diff }], app: "Notes" },
      },
    ]);

    for (const secret of Object.values(secrets)) expect(raw).not.toContain(secret);

    const byTool = Object.fromEntries(rows.map((row) => [row.tool, row]));
    expect(byTool.ui_type.args).toEqual({
      text: { _redacted: "ui_input", length: secrets.ui_type.length },
      appName: "Notes",
      locator: "AXTextField:Body",
    });
    expect(byTool.ui_perform_action.args).toEqual({
      role: "AXTextField",
      title: "Password",
      action: "setValue",
      actionValue: { _redacted: "ui_input", length: secrets.ui_perform_action.length },
    });
    expect(byTool.ui_diff.args).toEqual({
      beforeSnapshot: { _redacted: "ui_input" },
      app: "Notes",
    });

    for (const row of rows) {
      expect(row._prev).toMatch(/^[0-9a-f]{64}$/);
      expect(row._hmac).toMatch(/^[0-9a-f]{64}$/);
    }
    const summary = await audit.summarizeAuditEntries({ since: "2020-01-01T00:00:00Z" });
    expect(summary.verified).toBe(true);
    expect(summary.total).toBe(3);
  });

  test("does not redact the same generic key on unrelated tools", async () => {
    const { rows } = await writeRows([{ tool: "create_note", args: { title: "Groceries", text: "milk and eggs" } }]);
    expect(rows.at(-1).args).toEqual({ title: "Groceries", text: "milk and eggs" });
  });
});
