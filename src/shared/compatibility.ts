/**
 * Module compatibility resolver (RFC 0004 — docs/rfc/0004-macos-compat-matrix.md).
 *
 * This module is **pure and side-effect-free**: given a module's declared
 * compatibility manifest plus the current runtime environment, it returns
 * a decision — should this module register its tools? register with a
 * deprecation warning? be skipped as unsupported? reported as broken?
 *
 * RFC 0004 Phase 1 scope: this file provides the types + resolver. The
 * existing runtime in `src/server/mcp-setup.ts` only uses `minMacosVersion`
 * today; migrating it to use `resolveModuleCompatibility()` is a follow-up
 * PR that doesn't change behaviour (same classification, just via the
 * typed resolver).
 */

/**
 * Minimum macOS major version that exposes the HealthKit framework AirMCP
 * targets. Shared between `getCompatibilityEnv()` (the heuristic gate) and
 * compatibility tests, so changing the threshold in one place updates both.
 */
export const HEALTHKIT_MIN_MACOS = 15 as const;

/** Lifecycle state of a module. */
export type ModuleStatus = "stable" | "beta" | "deprecated" | "broken";

/** Architecture / hardware requirement hint. */
export type HardwareRequirement = "apple-silicon" | "intel" | "healthkit";

/**
 * Deprecation schedule attached to a module or tool.
 *
 * `since` marks the version in which the deprecation was announced.
 * `removeAt` is a *promise* about when the symbol is removed; used by
 * the release checklist to surface breaking changes early.
 */
export interface DeprecationSchedule {
  /** Version where the deprecation was announced, e.g. "2.8.0". */
  since: string;
  /** Version where the module/tool will be removed, e.g. "3.0.0". */
  removeAt: string;
  /** Suggested replacement module or tool. */
  replacement?: string;
  /** Why this was deprecated. */
  reason?: string;
}

/**
 * Compatibility manifest fields attached to a module. All fields are optional;
 * a module with no annotations is treated as `status: "stable"` with no
 * version or hardware constraints.
 */
export interface ModuleCompatibility {
  /** Inclusive minimum macOS major version (e.g. 26). */
  minMacosVersion?: number;
  /** Inclusive maximum macOS major version (e.g. 25 for a tool that was removed in 26). */
  maxMacosVersion?: number;
  /** Lifecycle status. Defaults to "stable". */
  status?: ModuleStatus;
  /**
   * Specific macOS versions where this module is known to be broken.
   * Useful for "macOS 26.1 regressed this app — will re-enable after 26.2".
   */
  brokenOn?: number[];
  /** Hardware requirements. All must be satisfied. */
  requiresHardware?: HardwareRequirement[];
  /**
   * Apple permission strings this module needs, e.g. `["calendar", "contacts"]`.
   * Used by `doctor` to surface what will prompt the user.
   */
  requiresPermissions?: string[];
  /** Deprecation schedule, if any. */
  deprecation?: DeprecationSchedule;
}

/** Runtime environment the resolver evaluates against. */
export interface CompatibilityEnv {
  /** macOS major version (from `getOsVersion()` in config.ts). 0 means non-darwin / unknown. */
  osVersion: number;
  /** Host CPU architecture, e.g. process.arch. */
  cpu?: NodeJS.Architecture | string;
  /** HealthKit availability (Apple Silicon + macOS 15+). */
  healthkitAvailable?: boolean;
}

/** The resolver's classification of a single module. */
export type CompatibilityDecision =
  /** Register normally. */
  | { decision: "register"; reason?: never }
  /** Register, but surface a deprecation warning in doctor + audit. */
  | { decision: "register-with-deprecation"; reason: string }
  /**
   * Skip registration because the module can't possibly work in this env
   * (OS too old/new, hardware missing). Doctor should explain.
   */
  | { decision: "skip-unsupported"; reason: string }
  /** Skip registration because the module is known-broken in this env. */
  | { decision: "skip-broken"; reason: string };

/**
 * Decide what to do with a module given its manifest + the runtime env.
 *
 * Pure function — no side effects, no I/O, no logging. Caller decides how to
 * surface the reason (stderr banner, doctor report, audit log, etc.).
 */
export function resolveModuleCompatibility(
  name: string,
  compat: ModuleCompatibility | undefined,
  env: CompatibilityEnv,
): CompatibilityDecision {
  const c = compat ?? {};
  const { osVersion } = env;

  // osVersion === 0 means "not macOS" — on non-Darwin hosts (CI lint jobs,
  // Linux sandboxes) we treat all version checks as passing. The runtime
  // elsewhere already blocks actual tool execution in that environment.
  const osKnown = osVersion > 0;

  if (c.status === "broken") {
    return {
      decision: "skip-broken",
      reason: `${name} is marked status:"broken" in its manifest`,
    };
  }

  if (osKnown && c.brokenOn?.includes(osVersion)) {
    return {
      decision: "skip-broken",
      reason: `${name} is known-broken on macOS ${osVersion}`,
    };
  }

  if (osKnown && c.minMacosVersion !== undefined && osVersion < c.minMacosVersion) {
    return {
      decision: "skip-unsupported",
      reason: `${name} requires macOS ${c.minMacosVersion}+ (detected ${osVersion})`,
    };
  }

  if (osKnown && c.maxMacosVersion !== undefined && osVersion > c.maxMacosVersion) {
    return {
      decision: "skip-unsupported",
      reason: `${name} was removed after macOS ${c.maxMacosVersion} (detected ${osVersion})`,
    };
  }

  if (c.requiresHardware && c.requiresHardware.length > 0) {
    const missing = c.requiresHardware.filter((h) => !isHardwareAvailable(h, env));
    if (missing.length > 0) {
      return {
        decision: "skip-unsupported",
        reason: `${name} requires ${missing.join(", ")}`,
      };
    }
  }

  if (c.status === "deprecated" || c.deprecation) {
    const since = c.deprecation?.since ?? "unknown";
    const removeAt = c.deprecation?.removeAt ?? "unscheduled";
    const replacement = c.deprecation?.replacement ? ` Use ${c.deprecation.replacement} instead.` : "";
    const why = c.deprecation?.reason ? ` (${c.deprecation.reason})` : "";
    return {
      decision: "register-with-deprecation",
      reason: `${name} is deprecated since v${since}, removal scheduled for v${removeAt}.${replacement}${why}`,
    };
  }

  return { decision: "register" };
}

/** Is a single hardware requirement satisfied? */
function isHardwareAvailable(req: HardwareRequirement, env: CompatibilityEnv): boolean {
  switch (req) {
    case "apple-silicon":
      return env.cpu === "arm64" || env.cpu === "aarch64";
    case "intel":
      return env.cpu === "x64" || env.cpu === "x86_64";
    case "healthkit":
      return env.healthkitAvailable === true;
  }
}

/**
 * Aggregate a set of modules into counts per decision, for doctor / banners.
 *
 * The shape is intentionally plain (not a Map) so it JSON-serialises cleanly
 * for `.well-known/mcp.json` exposure later.
 */
export interface CompatibilitySummary {
  register: string[];
  deprecated: Array<{ name: string; reason: string }>;
  unsupported: Array<{ name: string; reason: string }>;
  broken: Array<{ name: string; reason: string }>;
}

export function summarizeCompatibility(
  modules: Array<{ name: string; compatibility?: ModuleCompatibility }>,
  env: CompatibilityEnv,
): CompatibilitySummary {
  const out: CompatibilitySummary = {
    register: [],
    deprecated: [],
    unsupported: [],
    broken: [],
  };
  for (const m of modules) {
    const d = resolveModuleCompatibility(m.name, m.compatibility, env);
    switch (d.decision) {
      case "register":
        out.register.push(m.name);
        break;
      case "register-with-deprecation":
        out.deprecated.push({ name: m.name, reason: d.reason });
        out.register.push(m.name); // deprecated modules still register
        break;
      case "skip-unsupported":
        out.unsupported.push({ name: m.name, reason: d.reason });
        break;
      case "skip-broken":
        out.broken.push({ name: m.name, reason: d.reason });
        break;
    }
  }
  return out;
}
