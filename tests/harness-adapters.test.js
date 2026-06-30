import { afterEach, describe, expect, test } from "@jest/globals";

const { resolveHarnessAdapter } = await import("../dist/shared/task-adapters.js");

function config(requireToolSession) {
  return {
    requireToolSession,
  };
}

describe("harness adapters", () => {
  const savedAppOwned = process.env.AIRMCP_APP_OWNED_RUNTIME;
  const savedAdapter = process.env.AIRMCP_HARNESS_ADAPTER;
  const savedDefaultTtl = process.env.AIRMCP_TOOL_SESSION_DEFAULT_TTL_SECONDS;
  const savedMaxTtl = process.env.AIRMCP_TOOL_SESSION_MAX_TTL_SECONDS;

  afterEach(() => {
    if (savedAppOwned === undefined) delete process.env.AIRMCP_APP_OWNED_RUNTIME;
    else process.env.AIRMCP_APP_OWNED_RUNTIME = savedAppOwned;
    if (savedAdapter === undefined) delete process.env.AIRMCP_HARNESS_ADAPTER;
    else process.env.AIRMCP_HARNESS_ADAPTER = savedAdapter;
    if (savedDefaultTtl === undefined) delete process.env.AIRMCP_TOOL_SESSION_DEFAULT_TTL_SECONDS;
    else process.env.AIRMCP_TOOL_SESSION_DEFAULT_TTL_SECONDS = savedDefaultTtl;
    if (savedMaxTtl === undefined) delete process.env.AIRMCP_TOOL_SESSION_MAX_TTL_SECONDS;
    else process.env.AIRMCP_TOOL_SESSION_MAX_TTL_SECONDS = savedMaxTtl;
  });

  test("keeps no-config stdio compatible when strict sessions are not requested", () => {
    delete process.env.AIRMCP_APP_OWNED_RUNTIME;
    delete process.env.AIRMCP_HARNESS_ADAPTER;
    const policy = resolveHarnessAdapter(config(false));
    expect(policy.name).toBe("compatible");
    expect(policy.requireSessionForHiddenTools).toBe(false);
  });

  test("uses strict adapter when config requires tool sessions", () => {
    delete process.env.AIRMCP_APP_OWNED_RUNTIME;
    delete process.env.AIRMCP_HARNESS_ADAPTER;
    const policy = resolveHarnessAdapter(config(true));
    expect(policy.name).toBe("strict");
    expect(policy.requireSessionForHiddenTools).toBe(true);
  });

  test("infers app-runtime adapter from the app-owned runtime env", () => {
    process.env.AIRMCP_APP_OWNED_RUNTIME = "1";
    delete process.env.AIRMCP_HARNESS_ADAPTER;
    const policy = resolveHarnessAdapter(config(false));
    expect(policy.name).toBe("app-runtime");
    expect(policy.requireSessionForHiddenTools).toBe(true);
  });

  test("allows explicit adapter override", () => {
    process.env.AIRMCP_APP_OWNED_RUNTIME = "1";
    process.env.AIRMCP_HARNESS_ADAPTER = "compatible";
    const policy = resolveHarnessAdapter(config(false));
    expect(policy.name).toBe("compatible");
    expect(policy.requireSessionForHiddenTools).toBe(false);
  });

  test("keeps default session ttl inside adapter max ttl", () => {
    process.env.AIRMCP_TOOL_SESSION_DEFAULT_TTL_SECONDS = "900";
    process.env.AIRMCP_TOOL_SESSION_MAX_TTL_SECONDS = "120";
    const policy = resolveHarnessAdapter(config(true));
    expect(policy.defaultSessionTtlSeconds).toBe(120);
    expect(policy.maxSessionTtlSeconds).toBe(120);
  });
});
