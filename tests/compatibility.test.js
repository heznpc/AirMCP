import { describe, test, expect } from "@jest/globals";

const { resolveModuleCompatibility, summarizeCompatibility } = await import(
  "../dist/shared/compatibility.js"
);

const ENV_MAC26_ARM = { osVersion: 26, cpu: "arm64", healthkitAvailable: true };
const ENV_MAC25_INTEL = { osVersion: 25, cpu: "x64" };
const ENV_LINUX = { osVersion: 0, cpu: "x64" };

describe("resolveModuleCompatibility — defaults", () => {
  test("missing manifest → register", () => {
    const d = resolveModuleCompatibility("notes", undefined, ENV_MAC26_ARM);
    expect(d.decision).toBe("register");
  });

  test("empty manifest → register", () => {
    const d = resolveModuleCompatibility("notes", {}, ENV_MAC26_ARM);
    expect(d.decision).toBe("register");
  });

  test("explicit status:'stable' → register", () => {
    const d = resolveModuleCompatibility("notes", { status: "stable" }, ENV_MAC26_ARM);
    expect(d.decision).toBe("register");
  });
});

describe("macOS version gates", () => {
  test("minMacosVersion unmet → skip-unsupported", () => {
    const d = resolveModuleCompatibility(
      "intelligence",
      { minMacosVersion: 26 },
      ENV_MAC25_INTEL,
    );
    expect(d.decision).toBe("skip-unsupported");
    expect(d.reason).toContain("macOS 26");
    expect(d.reason).toContain("detected 25");
  });

  test("minMacosVersion met → register", () => {
    const d = resolveModuleCompatibility(
      "intelligence",
      { minMacosVersion: 26 },
      ENV_MAC26_ARM,
    );
    expect(d.decision).toBe("register");
  });

  test("maxMacosVersion exceeded → skip-unsupported", () => {
    const d = resolveModuleCompatibility(
      "safari.add_bookmark",
      { maxMacosVersion: 25 },
      ENV_MAC26_ARM,
    );
    expect(d.decision).toBe("skip-unsupported");
    expect(d.reason).toContain("removed after macOS 25");
  });

  test("maxMacosVersion at ceiling → register", () => {
    const d = resolveModuleCompatibility(
      "safari.add_bookmark",
      { maxMacosVersion: 25 },
      ENV_MAC25_INTEL,
    );
    expect(d.decision).toBe("register");
  });

  test("non-darwin host (osVersion=0) bypasses version gates", () => {
    // On CI lint jobs / Linux sandboxes we don't want to hide modules; the
    // runtime elsewhere blocks actual execution.
    const d = resolveModuleCompatibility(
      "intelligence",
      { minMacosVersion: 26 },
      ENV_LINUX,
    );
    expect(d.decision).toBe("register");
  });
});

describe("brokenOn and status:broken", () => {
  test("brokenOn includes current version → skip-broken", () => {
    const d = resolveModuleCompatibility(
      "podcasts",
      { brokenOn: [26] },
      ENV_MAC26_ARM,
    );
    expect(d.decision).toBe("skip-broken");
    expect(d.reason).toContain("known-broken on macOS 26");
  });

  test("brokenOn unrelated version → register", () => {
    const d = resolveModuleCompatibility(
      "podcasts",
      { brokenOn: [24] },
      ENV_MAC26_ARM,
    );
    expect(d.decision).toBe("register");
  });

  test("status:'broken' → skip-broken regardless of OS", () => {
    const d = resolveModuleCompatibility(
      "podcasts",
      { status: "broken" },
      ENV_MAC26_ARM,
    );
    expect(d.decision).toBe("skip-broken");
    expect(d.reason).toContain('status:"broken"');
  });

  test("status:'broken' takes precedence over deprecation", () => {
    const d = resolveModuleCompatibility(
      "old_mod",
      {
        status: "broken",
        deprecation: { since: "2.0.0", removeAt: "3.0.0" },
      },
      ENV_MAC26_ARM,
    );
    expect(d.decision).toBe("skip-broken");
  });
});

describe("hardware requirements", () => {
  test("requires apple-silicon but host is intel → skip-unsupported", () => {
    const d = resolveModuleCompatibility(
      "intelligence",
      { requiresHardware: ["apple-silicon"] },
      ENV_MAC25_INTEL,
    );
    expect(d.decision).toBe("skip-unsupported");
    expect(d.reason).toContain("apple-silicon");
  });

  test("multiple hardware reqs, all met → register", () => {
    const d = resolveModuleCompatibility(
      "health",
      { requiresHardware: ["apple-silicon", "healthkit"] },
      ENV_MAC26_ARM,
    );
    expect(d.decision).toBe("register");
  });

  test("healthkit required, unavailable → skip-unsupported", () => {
    const d = resolveModuleCompatibility(
      "health",
      { requiresHardware: ["healthkit"] },
      { osVersion: 26, cpu: "arm64", healthkitAvailable: false },
    );
    expect(d.decision).toBe("skip-unsupported");
  });

  test("requires intel on arm host → skip-unsupported", () => {
    const d = resolveModuleCompatibility(
      "legacy_intel_only",
      { requiresHardware: ["intel"] },
      ENV_MAC26_ARM,
    );
    expect(d.decision).toBe("skip-unsupported");
  });
});

describe("deprecation", () => {
  test("deprecation schedule present → register-with-deprecation", () => {
    const d = resolveModuleCompatibility(
      "safari.add_bookmark",
      {
        deprecation: {
          since: "2.8.0",
          removeAt: "3.0.0",
          replacement: "safari.open_url",
          reason: "Apple removed the bookmarks API in macOS 26",
        },
      },
      ENV_MAC26_ARM,
    );
    expect(d.decision).toBe("register-with-deprecation");
    expect(d.reason).toContain("deprecated since v2.8.0");
    expect(d.reason).toContain("v3.0.0");
    expect(d.reason).toContain("safari.open_url");
    expect(d.reason).toContain("Apple removed");
  });

  test("status:'deprecated' without schedule still surfaces warning", () => {
    const d = resolveModuleCompatibility(
      "old",
      { status: "deprecated" },
      ENV_MAC26_ARM,
    );
    expect(d.decision).toBe("register-with-deprecation");
    expect(d.reason).toContain("deprecated since vunknown");
  });

  test("unsupported OS beats deprecation", () => {
    const d = resolveModuleCompatibility(
      "old",
      {
        minMacosVersion: 30,
        deprecation: { since: "2.0.0", removeAt: "3.0.0" },
      },
      ENV_MAC26_ARM,
    );
    expect(d.decision).toBe("skip-unsupported");
  });
});

describe("summarizeCompatibility", () => {
  test("classifies a mixed batch correctly", () => {
    const modules = [
      { name: "notes" },
      { name: "intelligence", compatibility: { minMacosVersion: 26, status: "beta" } },
      { name: "safari_old", compatibility: { maxMacosVersion: 25 } },
      { name: "broken_mod", compatibility: { status: "broken" } },
      {
        name: "soon_gone",
        compatibility: {
          deprecation: { since: "2.8.0", removeAt: "3.0.0" },
        },
      },
    ];
    const summary = summarizeCompatibility(modules, ENV_MAC26_ARM);

    expect(summary.register).toEqual(
      expect.arrayContaining(["notes", "intelligence", "soon_gone"]),
    );
    expect(summary.unsupported.map((u) => u.name)).toContain("safari_old");
    expect(summary.broken.map((b) => b.name)).toContain("broken_mod");
    expect(summary.deprecated.map((d) => d.name)).toContain("soon_gone");

    // Deprecated modules also appear in register — they still run.
    expect(summary.register).toContain("soon_gone");
  });

  test("output is JSON-serialisable (for .well-known/mcp.json)", () => {
    const summary = summarizeCompatibility(
      [{ name: "notes" }, { name: "intelligence", compatibility: { minMacosVersion: 26 } }],
      ENV_MAC25_INTEL,
    );
    // Should not throw.
    const json = JSON.parse(JSON.stringify(summary));
    expect(json.register).toContain("notes");
    expect(json.unsupported[0].name).toBe("intelligence");
  });
});
