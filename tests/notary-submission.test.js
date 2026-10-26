import { afterEach, describe, expect, test } from "@jest/globals";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { summarizeNotarySubmission } from "../scripts/summarize-notary-submission.mjs";
import { verifyNotaryCredentials } from "../scripts/verify-notary-credentials.mjs";

const directories = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe("notarytool response boundary", () => {
  test("keeps an Accepted JSON response usable when notarytool also emits a stderr warning", () => {
    const directory = mkdtempSync(join(tmpdir(), "airmcp-notary-response-"));
    directories.push(directory);
    const response = { id: "11111111-2222-3333-8444-555555555555", status: "Accepted" };
    writeFileSync(join(directory, "xcrun"), `#!/bin/bash
printf '%s' '${JSON.stringify(response)}'
printf '%s' 'Warning: account private@example.com' >&2
`, { mode: 0o755 });
    const library = new URL("../scripts/lib/notary-submit.sh", import.meta.url).pathname;
    const result = spawnSync("bash", ["-c", 'source "$1"; submit_notarization artifact.zip "$2" --keychain-profile test', "bash", library, directory], {
      encoding: "utf8", env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
    });
    expect(result.status).toBe(0);
    expect(result.stdout + result.stderr).toBe("");
    const stdout = readFileSync(join(directory, "notary-submit.json"), "utf8");
    const stderr = readFileSync(join(directory, "notary-submit.stderr"), "utf8");
    expect(JSON.parse(stdout)).toEqual(response);
    expect(summarizeNotarySubmission(stdout, stderr, result.status)).toBe("notarization accepted");
  });

  test.each([
    ["HTTP status code: 401. Invalid credentials private@example.com", "authentication failed"],
    ["HTTP status code: 403. Forbidden TEAM123456", "authorization failed"],
    ["Apple Developer Program License Agreement must be accepted", "agreement requires attention"],
    ["NSURLErrorDomain Code=-1009 private@example.com", "transport failed"],
    ["unexpected response private@example.com", "does not establish an account or artifact failure"],
  ])("classifies errors without exposing their raw contents", (stderr, diagnosis) => {
    const output = summarizeNotarySubmission("", stderr, 1);
    expect(output).toContain(diagnosis);
    expect(output).not.toContain("private@example.com");
    expect(output).not.toContain("TEAM123456");
  });

  test("distinguishes artifact rejection from an accepted submission whose wait failed", () => {
    const id = "11111111-2222-3333-8444-555555555555";
    expect(summarizeNotarySubmission(JSON.stringify({ id, status: "Invalid" }), "", 0)).toContain("rejected the artifact");
    const output = summarizeNotarySubmission(JSON.stringify({ id, status: "In Progress" }), "timed out", 1);
    expect(output).toContain("submission exists");
    expect(output).not.toContain(id);
    expect(summarizeNotarySubmission("not JSON", "", 0)).not.toBe("notarization accepted");
  });

  test("account preflight fails safely before building when the configured password is rejected", () => {
    const env = { APPLE_ID: "private@example.com", APPLE_ID_PASSWORD: "private-password", APPLE_TEAM_ID: "TEAM123456" };
    const rejected = () => ({ status: 1, stdout: "", stderr: `HTTP status code: 401. Invalid credentials ${env.APPLE_ID} ${env.APPLE_ID_PASSWORD}` });
    expect(() => verifyNotaryCredentials(env, rejected)).toThrow("authentication failed");
    try { verifyNotaryCredentials(env, rejected); } catch (error) {
      for (const secret of Object.values(env)) expect(error.message).not.toContain(secret);
    }
    expect(() => verifyNotaryCredentials(env, () => ({ status: 0, stdout: '{"history":[]}' }))).not.toThrow();
    expect(() => verifyNotaryCredentials(env, () => ({ status: null, error: { code: "ETIMEDOUT", message: "private-password" } })))
      .toThrow("transport failed");
  });
});
