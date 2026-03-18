/**
 * MCP server creation — module loading, tool/prompt/resource registration,
 * and banner metadata collection.
 */

import { McpServer as SdkMcpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer as LightMcpServer } from "../shared/mcp.js";
import { z } from "zod";
import { ok, err } from "../shared/result.js";
import { registerCrossPrompts } from "../cross/prompts.js";
import { registerCrossTools } from "../cross/tools.js";
import { registerSemanticTools } from "../semantic/tools.js";
import { registerResources } from "../shared/resources.js";
import { registerSetupTools } from "../shared/setup.js";
import { registerSkillEngine } from "../skills/index.js";
import { registerApps } from "../apps/tools.js";
import { isModuleEnabled, NPM_PACKAGE_NAME, type AirMcpConfig } from "../shared/config.js";
import { loadModuleRegistry, setModuleRegistry } from "../shared/modules.js";
import { registerDynamicShortcutTools } from "../shortcuts/tools.js";
import { HitlClient } from "../shared/hitl.js";
import { installHitlGuard } from "../shared/hitl-guard.js";
import { toolRegistry } from "../shared/tool-registry.js";
import type { BannerInfo } from "../shared/banner.js";

export interface CreateServerOptions {
  config: AirMcpConfig;
  hitlClient: HitlClient | null;
  osVersion: number;
  pkg: { version: string };
}

export async function createServer(
  options: CreateServerOptions,
): Promise<{ server: SdkMcpServer; bannerInfo: BannerInfo }> {
  const { config, hitlClient, osVersion, pkg } = options;

  const server = new SdkMcpServer({
    name: NPM_PACKAGE_NAME,
    version: pkg.version,
  });
  // Cast to lightweight McpServer for module registration (avoids heavy generic inference)
  const lServer = server as unknown as LightMcpServer;

  // Install HITL guard before any tool registrations
  if (hitlClient && config.hitl.level !== "off") {
    installHitlGuard(lServer, hitlClient, config);
  }

  // Install tool/prompt registry — intercepts all registrations transparently.
  // Must come after HITL guard so the stored handlers include the HITL wrapper.
  toolRegistry.installOn(lServer);

  // Dynamic module loading — only imports modules at startup
  const MODULE_REGISTRY = await loadModuleRegistry();
  setModuleRegistry(MODULE_REGISTRY);

  const enabled: string[] = [];
  const disabled: string[] = [];
  const osBlocked: string[] = [];
  let shortcutsEnabled = false;
  for (const mod of MODULE_REGISTRY) {
    if (mod.minMacosVersion && osVersion > 0 && osVersion < mod.minMacosVersion) {
      osBlocked.push(`${mod.name} (requires macOS ${mod.minMacosVersion}+)`);
    } else if (isModuleEnabled(config, mod.name)) {
      try {
        mod.tools(lServer, config);
        mod.prompts?.(lServer);
      } catch (e) {
        console.error(`[AirMCP] Failed to register module ${mod.name}: ${e instanceof Error ? e.message : String(e)}`);
        disabled.push(mod.name);
        continue;
      }
      enabled.push(mod.name);
      if (mod.name === "shortcuts") shortcutsEnabled = true;
    } else {
      disabled.push(mod.name);
    }
  }
  // Dynamic shortcut tools: auto-discover and register individual shortcuts
  let dynamicShortcutCount = 0;
  if (shortcutsEnabled) {
    dynamicShortcutCount = await registerDynamicShortcutTools(lServer);
  }

  // Cross-module workflows
  registerCrossPrompts(lServer);
  registerCrossTools(lServer, config);

  // Semantic search (on-device embeddings via Swift bridge)
  registerSemanticTools(lServer, config);

  // MCP Resources
  registerResources(lServer, config);

  // Setup & diagnostics
  registerSetupTools(lServer, config);

  // Personal Skills Engine (YAML-based workflows)
  await registerSkillEngine(lServer);

  // MCP Apps — interactive UI views (Calendar week, Music player)
  registerApps(lServer, {
    calendar: enabled.includes("calendar"),
    music: enabled.includes("music"),
  });

  // get_workflow: expose prompt handlers as a tool for autonomous agents (Cowork, etc.)
  lServer.registerTool(
    "get_workflow",
    {
      title: "Get Workflow",
      description:
        "Retrieve a registered MCP prompt by name and return its workflow instructions as text. " +
        "Useful in autonomous/Cowork environments where prompts cannot be invoked directly.",
      inputSchema: {
        name: z.string().min(1).describe("Prompt name (e.g. 'daily-briefing', 'dev-session')"),
        args: z
          .record(z.string())
          .optional()
          .describe("Prompt arguments as key-value pairs"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ name, args }) => {
      const callback = toolRegistry.getPromptCallback(name);
      if (!callback) {
        const available = toolRegistry.getPromptNames().sort();
        return err(`Unknown prompt "${name}". Available: ${available.join(", ")}`);
      }
      try {
        const result = await callback(args ?? {}, {});
        const text = result?.messages?.[0]?.content?.text ?? JSON.stringify(result);
        return ok({ prompt: name, description: result?.description, workflow: text });
      } catch (e) {
        return err(`Failed to get workflow: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  // Collect banner info for startup display
  const toolCount = toolRegistry.getToolCount();
  const promptCount = toolRegistry.getPromptCount();

  const bannerInfo: BannerInfo = {
    version: pkg.version,
    transport: "stdio",
    modulesEnabled: enabled,
    modulesDisabled: disabled,
    modulesOsBlocked: osBlocked,
    toolCount,
    promptCount,
    dynamicShortcuts: dynamicShortcutCount,
    skillsBuiltin: 3,
    skillsUser: 0,
    hitlLevel: config.hitl.level,
    macosVersion: osVersion,
    nodeVersion: process.version.slice(1),
    sendMessages: config.allowSendMessages,
    sendMail: config.allowSendMail,
  };

  return { server, bannerInfo };
}
