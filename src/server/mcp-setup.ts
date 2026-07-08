/**
 * MCP server creation — module loading, tool/prompt/resource registration,
 * and banner metadata collection.
 */

import { McpServer as SdkMcpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer as LightMcpServer } from "../shared/mcp.js";
import { registerCrossPrompts } from "../cross/prompts.js";
import { registerCrossTools } from "../cross/tools.js";
import { registerSemanticTools } from "../semantic/tools.js";
import { registerResources } from "../shared/resources.js";
import { registerSetupTools } from "../shared/setup.js";
import { registerSkillEngine } from "../skills/index.js";
import { log, errToCtx } from "../shared/logger.js";
import { registerApps } from "../apps/tools.js";
import { getCompatibilityEnv, isModuleEnabled, NPM_PACKAGE_NAME, type AirMcpConfig } from "../shared/config.js";
import { getModulePackPlan, loadModuleRegistry, setModuleRegistry } from "../shared/modules.js";
import { getMissingAddonPackageModules } from "../shared/module-loader.js";
import { resolveModuleCompatibility } from "../shared/compatibility.js";
import { registerDynamicShortcutTools } from "../shortcuts/tools.js";
import { HitlClient } from "../shared/hitl.js";
import { installHitlGuard } from "../shared/hitl-guard.js";
import { toolRegistry } from "../shared/tool-registry.js";
import { indexToolDescriptions } from "../shared/tool-search.js";
import { isCompactMode } from "../shared/tool-filter.js";
import { resolveHarnessAdapter } from "../shared/task-adapters.js";
import { assessWorkflowsReadiness } from "../shared/workflows.js";
import type { BannerInfo } from "../shared/banner.js";
import { SERVER_ICON, WEBSITE_URL } from "../shared/icons.js";
import { withAddonInstallStatus } from "../shared/addon-operations.js";
import { buildMissingPackInstallHints, registerFrontDoorTools } from "./front-door-tools.js";
import { registerToolSessionTools } from "./tool-session-tools.js";
import { registerEventTools } from "./event-tools.js";

export interface CreateServerOptions {
  config: AirMcpConfig;
  hitlClient: HitlClient | null;
  osVersion: number;
  pkg: { version: string; description?: string; license?: string; homepage?: string };
}

export async function createServer(
  options: CreateServerOptions,
): Promise<{ server: SdkMcpServer; bannerInfo: BannerInfo; cleanupEventListeners: () => void }> {
  const { config, hitlClient, osVersion, pkg } = options;
  const harness = resolveHarnessAdapter(config);

  const server = new SdkMcpServer({
    name: NPM_PACKAGE_NAME,
    version: pkg.version,
    description: pkg.description,
    websiteUrl: WEBSITE_URL,
    icons: [SERVER_ICON],
  });
  // Cast to lightweight McpServer for module registration (avoids heavy generic inference)
  const lServer = server as unknown as LightMcpServer;

  // Install tool/prompt registry FIRST so its interception runs as the
  // innermost wrapper. The HITL guard then re-patches registerTool, becoming
  // the outermost wrapper. Order matters: when a module calls registerTool,
  // HITL wraps the callback first, then the registry wraps that HITL-wrapped
  // handler with audit/usage tracking and stores it in its map. This makes
  // the stored handler `audit(HITL(callback))` so that skill execution via
  // toolRegistry.callTool() also goes through HITL approval.
  toolRegistry.configureExposure({
    mode: config.toolExposure,
    exposedToolNames: config.toolExposure === "progressive" ? config.progressiveTools : undefined,
  });
  toolRegistry.installOn(lServer);

  if (hitlClient && config.hitl.level !== "off") {
    installHitlGuard(lServer, hitlClient, config);
  }

  // Dynamic module loading — disabled modules are filtered before import so
  // opt-in surfaces stay zero-cost at startup.
  const MODULE_REGISTRY = await loadModuleRegistry(config);
  setModuleRegistry(MODULE_REGISTRY);
  const modulePackPlan = getModulePackPlan(config);
  const modulePacksAvailable = modulePackPlan.packs.filter((pack) => pack.available).map((pack) => pack.name);
  const modulePackInstallStatuses = modulePackPlan.packs.map((pack) => withAddonInstallStatus(pack, pkg.version));
  const modulePackInstallIssues = modulePackInstallStatuses
    .filter((pack) => pack.updateAvailable)
    .map((pack) => ({
      pack: pack.name,
      packageName: pack.packageName,
      installStatus: pack.installStatus,
      installedVersion: pack.installedVersion,
      expectedVersion: pack.expectedVersion,
      command: pack.repairCommand,
      message: `${pack.name} add-on is installed at ${pack.installedVersion ?? "unknown"}, but AirMCP expects ${pack.expectedVersion}. Run ${pack.repairCommand} and restart AirMCP.`,
    }));
  const modulesMissingPacks = modulePackPlan.modulesMissingPacks;
  const missingAddonPackageModules = getMissingAddonPackageModules();
  const missingPackInstallHints = buildMissingPackInstallHints(
    modulesMissingPacks,
    missingAddonPackageModules,
    pkg.version,
  );

  // RFC 0004: route every module through the compatibility resolver. The
  // resolver folds in minMacosVersion (legacy gate), maxMacosVersion, brokenOn,
  // requiresHardware, status:"broken", and deprecation schedules into a single
  // typed decision. We keep the legacy minMacosVersion field as a fallback for
  // modules that haven't been annotated yet.
  const compatEnv = getCompatibilityEnv();
  const enabled: string[] = [];
  const disabled: string[] = [];
  const osBlocked: string[] = [];
  const deprecated: string[] = [];
  const broken: string[] = [];
  let shortcutsEnabled = false;
  for (const mod of MODULE_REGISTRY) {
    // Synthesise a manifest when the module only has the legacy field set.
    const compatManifest =
      mod.compatibility ?? (mod.minMacosVersion ? { minMacosVersion: mod.minMacosVersion } : undefined);
    const decision = resolveModuleCompatibility(mod.name, compatManifest, compatEnv);

    if (decision.decision === "skip-unsupported") {
      osBlocked.push(`${mod.name} (${decision.reason})`);
      continue;
    }
    if (decision.decision === "skip-broken") {
      broken.push(`${mod.name} (${decision.reason})`);
      continue;
    }

    if (!isModuleEnabled(config, mod.name)) {
      disabled.push(mod.name);
      continue;
    }

    try {
      mod.tools(lServer, config);
      mod.prompts?.(lServer);
    } catch (e) {
      log.error("failed to register module", { module: mod.name, err: errToCtx(e) });
      disabled.push(mod.name);
      continue;
    }
    enabled.push(mod.name);
    if (mod.name === "shortcuts") shortcutsEnabled = true;

    if (decision.decision === "register-with-deprecation") {
      deprecated.push(mod.name);
      log.warn("module registered with deprecation notice", { module: mod.name, reason: decision.reason });
    }
  }

  let dynamicShortcutCount = 0;
  if (shortcutsEnabled) {
    dynamicShortcutCount = await registerDynamicShortcutTools(lServer);
  }

  registerCrossPrompts(lServer);
  registerCrossTools(lServer, config);
  registerSemanticTools(lServer, config);
  registerResources(lServer, config);
  registerSetupTools(lServer, config);

  const skillCounts = await registerSkillEngine(lServer);

  registerApps(lServer, {
    calendar: enabled.includes("calendar"),
    music: enabled.includes("music"),
    // Timeline fuses calendar + reminders into a single day-axis view, so
    // we only register it when both modules are enabled.
    timeline: enabled.includes("calendar") && enabled.includes("reminders"),
  });

  const buildWorkflowReadiness = () =>
    assessWorkflowsReadiness({
      enabledModules: enabled,
      modulesMissingPacks,
      modulesMissingAddonPackages: missingAddonPackageModules,
      registeredTools: toolRegistry.getToolNames(),
      allowSendMail: config.allowSendMail,
      allowSendMessages: config.allowSendMessages,
    });

  registerFrontDoorTools(lServer, {
    config,
    harness,
    version: pkg.version,
    enabledModules: enabled,
    disabledModules: disabled,
    modulePacksAvailable,
    modulePackInstallStatuses,
    modulePackInstallIssues,
    modulesMissingPacks,
    missingAddonPackageModules,
    missingPackInstallHints,
    buildWorkflowReadiness,
  });
  registerToolSessionTools(lServer, { config, harness });
  const cleanupEventListeners = registerEventTools(lServer, {
    notifyResourceListChanged: () => server.sendResourceListChanged(),
  });

  toolRegistry.pruneStaleRegistrations();

  if (config.features.semanticToolSearch) {
    indexToolDescriptions().catch((e) => {
      log.error("semantic tool index failed", { err: errToCtx(e) });
    });
  }

  const toolCount = toolRegistry.getExposedToolCount();
  const promptCount = toolRegistry.getPromptCount();

  const bannerInfo: BannerInfo = {
    version: pkg.version,
    transport: "stdio",
    modulesEnabled: enabled,
    modulesDisabled: disabled,
    modulesOsBlocked: osBlocked,
    modulesDeprecated: deprecated,
    modulesBroken: broken,
    toolCount,
    promptCount,
    dynamicShortcuts: dynamicShortcutCount,
    skillsBuiltin: skillCounts.builtinCount,
    skillsUser: skillCounts.userCount,
    hitlLevel: config.hitl.level,
    macosVersion: osVersion,
    nodeVersion: process.version.slice(1),
    sendMessages: config.allowSendMessages,
    sendMail: config.allowSendMail,
    compactTools: isCompactMode(),
  };

  return { server, bannerInfo, cleanupEventListeners };
}
