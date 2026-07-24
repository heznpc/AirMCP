import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import type { McpServer } from "../shared/mcp.js";
import { errInvalidInput, errNotFound, errUpstream, okStructured } from "../shared/result.js";
import {
  FRONT_DOOR_TOOLS,
  PROFILE_DESCRIPTIONS,
  PROFILE_MODULES,
  PROFILE_NAMES,
  type AirMcpConfig,
} from "../shared/config.js";
import {
  CORE_MODULE_PACK_NAME,
  MODULE_PACK_MANIFEST,
  getModulePackNameForModule,
  resolveModulePackSelection,
  type ModulePackName,
} from "../shared/module-packs.js";
import type { ToolRegistry } from "../shared/tool-registry.js";
import { shouldRequireApproval } from "../shared/hitl-guard.js";
import { requiredScopeFor } from "../shared/oauth-scope.js";
import { getRateLimitStatus } from "../shared/rate-limit.js";
import { toolSessions } from "../shared/tool-sessions.js";
import { WORKFLOWS, findWorkflow, summarizeWorkflowsReadiness, type WorkflowReadiness } from "../shared/workflows.js";
import type { HarnessAdapterPolicy } from "../shared/task-adapters.js";
import { PATHS } from "../shared/constants.js";
import {
  createAddonPackageOperation,
  executeAddonPackageOperation,
  formatShellCommand,
  type ModulePackAddonStatus,
  writeModulePackConfig,
} from "../shared/addon-operations.js";
import { isPlainObject } from "../shared/validate.js";

export interface MissingPackInstallHint {
  pack: ModulePackName;
  packageName: string;
  installSpec: string;
  modules: string[];
  command: string;
  message: string;
}

export interface ModulePackInstallIssue {
  pack: string;
  packageName: string;
  installStatus: string;
  installedVersion: string | null;
  expectedVersion: string;
  command: string | null;
  message: string;
}

export interface RegisterFrontDoorToolsOptions {
  toolRegistry: ToolRegistry;
  config: AirMcpConfig;
  harness: HarnessAdapterPolicy;
  version: string;
  enabledModules: string[];
  disabledModules: string[];
  modulePacksAvailable: string[];
  modulePackInstallStatuses: ModulePackAddonStatus[];
  modulePackInstallIssues: ModulePackInstallIssue[];
  modulesMissingPacks: string[];
  missingAddonPackageModules: string[];
  missingPackInstallHints: MissingPackInstallHint[];
  buildWorkflowReadiness: () => WorkflowReadiness[];
}

export function buildMissingPackInstallHints(
  modulesMissingPacks: string[],
  missingAddonPackageModules: string[],
  version: string,
): MissingPackInstallHint[] {
  const missingByPack = new Map<ModulePackName, string[]>();
  for (const moduleName of [...modulesMissingPacks, ...missingAddonPackageModules]) {
    const packName = getModulePackNameForModule(moduleName);
    if (!packName || packName === CORE_MODULE_PACK_NAME) continue;
    const current = missingByPack.get(packName) ?? [];
    if (!current.includes(moduleName)) current.push(moduleName);
    missingByPack.set(packName, current);
  }

  return MODULE_PACK_MANIFEST.filter((pack) => missingByPack.has(pack.name)).map((pack) => {
    const modules = missingByPack.get(pack.name) ?? [];
    const command = `npx airmcp modules enable ${pack.name} --install`;
    return {
      pack: pack.name,
      packageName: pack.packageName,
      installSpec: `${pack.packageName}@${version}`,
      modules,
      command,
      message: `Install and activate the ${pack.name} add-on to use ${modules.join(", ")}: ${command}. Restart AirMCP after installation.`,
    };
  });
}

function readConfigFile(): Record<string, unknown> {
  if (!existsSync(PATHS.CONFIG)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(PATHS.CONFIG, "utf-8"));
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function sortedPackList(packs: ReadonlySet<ModulePackName>): ModulePackName[] {
  return MODULE_PACK_MANIFEST.map((pack) => pack.name).filter((name) => packs.has(name));
}

function findEditableModulePack(packName: string) {
  const pack = MODULE_PACK_MANIFEST.find((candidate) => candidate.name === packName);
  if (!pack || pack.name === CORE_MODULE_PACK_NAME) return null;
  return pack;
}

function planModulePackConfig(packName: ModulePackName, enabled: boolean) {
  const config = readConfigFile();
  const selection = resolveModulePackSelection(config.modulePacks as string | string[] | undefined);
  const next =
    config.modulePacks === undefined ? new Set<ModulePackName>([CORE_MODULE_PACK_NAME]) : new Set(selection.packs);
  if (enabled) next.add(packName);
  else next.delete(packName);
  next.add(CORE_MODULE_PACK_NAME);
  return { config, activePacks: sortedPackList(next) };
}

const workflowReadinessIssueSchema = z.object({
  code: z.string(),
  severity: z.enum(["info", "warning", "blocker"]),
  message: z.string(),
  module: z.string().optional(),
  pack: z.string().optional(),
  tool: z.string().optional(),
  command: z.string().optional(),
});

const workflowReadinessSchema = z.object({
  id: z.string(),
  title: z.string(),
  prompt: z.string(),
  requiredModules: z.array(z.string()),
  tools: z.array(z.string()),
  status: z.enum(["ready", "partial", "blocked"]),
  ready: z.boolean(),
  summary: z.string(),
  issues: z.array(workflowReadinessIssueSchema),
});

export function registerFrontDoorTools(server: McpServer, options: RegisterFrontDoorToolsOptions): void {
  const {
    toolRegistry,
    config,
    harness,
    version,
    enabledModules,
    disabledModules,
    modulePacksAvailable,
    modulePackInstallStatuses,
    modulePackInstallIssues,
    modulesMissingPacks,
    missingAddonPackageModules,
    missingPackInstallHints,
    buildWorkflowReadiness,
  } = options;

  server.registerTool(
    "list_profiles",
    {
      title: "List Profiles",
      description:
        "List AirMCP runtime profiles. Profiles choose which modules load; toolExposure chooses how much of that surface appears in tools/list.",
      inputSchema: {},
      outputSchema: {
        profiles: z.array(
          z.object({
            name: z.string(),
            description: z.string(),
            modules: z.array(z.string()),
            defaultToolExposure: z.string(),
          }),
        ),
        active: z.string(),
        toolExposure: z.string(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const profiles = PROFILE_NAMES.map((name) => ({
        name,
        description: PROFILE_DESCRIPTIONS[name],
        modules: [...PROFILE_MODULES[name]],
        defaultToolExposure: name === "full" ? "full" : name === "productivity" ? "profile" : "progressive",
      }));
      return okStructured({ profiles, active: config.profile, toolExposure: config.toolExposure });
    },
  );

  server.registerTool(
    "list_module_packs",
    {
      title: "List Module Packs",
      description:
        "List DLC-like AirMCP module packs and whether each pack is available in the current runtime configuration.",
      inputSchema: {},
      outputSchema: {
        configured: z.boolean(),
        active: z.array(z.string()),
        packs: z.array(
          z.object({
            name: z.string(),
            packageName: z.string(),
            title: z.string(),
            description: z.string(),
            modules: z.array(z.string()),
            available: z.boolean(),
            required: z.boolean(),
            installed: z.boolean(),
            installedVersion: z.string().nullable(),
            expectedVersion: z.string(),
            installedSizeBytes: z.number().nullable(),
            installStatus: z.enum(["required", "not-installed", "installed", "version-mismatch"]),
            updateAvailable: z.boolean(),
            installSpec: z.string().nullable(),
            installCommand: z.string().nullable(),
            updateCommand: z.string().nullable(),
            repairCommand: z.string().nullable(),
            uninstallCommand: z.string().nullable(),
          }),
        ),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      return okStructured({
        configured: config.modulePacksConfigured,
        active: modulePacksAvailable,
        packs: modulePackInstallStatuses,
      });
    },
  );

  server.registerTool(
    "install_module_pack",
    {
      title: "Install Module Pack",
      description:
        "Install, repair, update, or uninstall one AirMCP add-on package after explicit user confirmation. Use dryRun first to preview the npm command.",
      inputSchema: {
        pack: z
          .string()
          .min(1)
          .max(80)
          .describe("Non-core module pack name, for example productivity, communications, media, or spatial"),
        action: z
          .enum(["install", "uninstall"])
          .optional()
          .describe("install repairs or updates the exact matching add-on version; uninstall removes it"),
        dryRun: z.boolean().optional().describe("Preview the npm command and config change without writing anything"),
        confirm: z
          .boolean()
          .optional()
          .describe("Required true for real install/uninstall because this runs npm and edits AirMCP config"),
      },
      outputSchema: {
        pack: z.string(),
        action: z.enum(["install", "uninstall"]),
        packageName: z.string(),
        installSpec: z.string(),
        command: z.string(),
        dryRun: z.boolean(),
        skipped: z.boolean(),
        confirmed: z.boolean(),
        configPath: z.string(),
        activePacks: z.array(z.string()),
        restartRequired: z.boolean(),
        message: z.string(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ pack, action, dryRun, confirm }) => {
      const selectedPack = findEditableModulePack(pack);
      if (!selectedPack) {
        return errInvalidInput(`Unknown or non-editable module add-on "${pack}". Use list_module_packs first.`);
      }
      const requested = new Set<ModulePackName>([selectedPack.name]);
      const effectiveAction = action ?? "install";
      const previewOnly = dryRun === true;
      if (!previewOnly && confirm !== true) {
        return errInvalidInput("Set confirm:true to install or uninstall a module add-on. Run with dryRun:true first.");
      }

      const operation = createAddonPackageOperation(effectiveAction, requested, version, { dryRun: previewOnly });
      const { config: currentConfig, activePacks } = planModulePackConfig(
        selectedPack.name,
        effectiveAction === "install",
      );

      if (!previewOnly) {
        try {
          executeAddonPackageOperation(operation);
          writeModulePackConfig(currentConfig, activePacks, PATHS.CONFIG);
        } catch (error) {
          return errUpstream(
            `Failed to ${effectiveAction} ${selectedPack.packageName}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      const command = formatShellCommand(operation.command);
      return okStructured({
        pack: selectedPack.name,
        action: effectiveAction,
        packageName: selectedPack.packageName,
        installSpec: `${selectedPack.packageName}@${version}`,
        command,
        dryRun: previewOnly,
        skipped: operation.skipped,
        confirmed: confirm === true,
        configPath: PATHS.CONFIG,
        activePacks,
        restartRequired: !previewOnly,
        message: previewOnly
          ? `Dry run only. To apply, call install_module_pack with pack:${selectedPack.name}, action:${effectiveAction}, confirm:true.`
          : `${selectedPack.name} add-on ${effectiveAction === "install" ? "installed/activated" : "uninstalled/disabled"}. Restart AirMCP to apply.`,
      });
    },
  );

  server.registerTool(
    "profile_status",
    {
      title: "Profile Status",
      description:
        "Show the active AirMCP profile, module set, tool exposure mode, exposed tool count, and total registered tool count.",
      inputSchema: {},
      outputSchema: {
        profile: z.string(),
        toolExposure: z.string(),
        modulePacksConfigured: z.boolean(),
        modulePacksAvailable: z.array(z.string()),
        modulesMissingPacks: z.array(z.string()),
        modulesMissingAddonPackages: z.array(z.string()),
        modulePackInstallIssues: z.array(
          z.object({
            pack: z.string(),
            packageName: z.string(),
            installStatus: z.string(),
            installedVersion: z.string().nullable(),
            expectedVersion: z.string(),
            command: z.string().nullable(),
            message: z.string(),
          }),
        ),
        missingPackInstallHints: z.array(
          z.object({
            pack: z.string(),
            packageName: z.string(),
            installSpec: z.string(),
            modules: z.array(z.string()),
            command: z.string(),
            message: z.string(),
          }),
        ),
        requireToolSession: z.boolean(),
        harnessAdapter: z.string(),
        modulesEnabled: z.array(z.string()),
        modulesDisabled: z.array(z.string()),
        toolsExposed: z.number(),
        toolsRegistered: z.number(),
        toolSessionsActive: z.number(),
        frontDoorTools: z.array(z.string()),
        workflowReadiness: z.object({
          total: z.number(),
          ready: z.number(),
          partial: z.number(),
          blocked: z.number(),
        }),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const workflowReadiness = buildWorkflowReadiness();
      return okStructured({
        profile: config.profile,
        toolExposure: config.toolExposure,
        modulePacksConfigured: config.modulePacksConfigured,
        modulePacksAvailable,
        modulesMissingPacks,
        modulesMissingAddonPackages: missingAddonPackageModules,
        modulePackInstallIssues,
        missingPackInstallHints,
        requireToolSession: config.requireToolSession,
        harnessAdapter: harness.name,
        modulesEnabled: enabledModules,
        modulesDisabled: disabledModules,
        toolsExposed: toolRegistry.getExposedToolCount(),
        toolsRegistered: toolRegistry.getToolCount(),
        toolSessionsActive: toolSessions.activeCount(),
        frontDoorTools: [...FRONT_DOOR_TOOLS],
        workflowReadiness: summarizeWorkflowsReadiness(workflowReadiness),
      });
    },
  );

  server.registerTool(
    "workflow_readiness",
    {
      title: "Workflow Readiness",
      description:
        "Explain whether curated AirMCP workflows are ready in the active runtime, including missing modules, add-ons, tools, and write opt-ins.",
      inputSchema: {
        id: z
          .string()
          .min(1)
          .max(120)
          .optional()
          .describe("Optional workflow id, for example daily-briefing or meeting-prep"),
      },
      outputSchema: {
        activeProfile: z.string(),
        toolExposure: z.string(),
        workflows: z.array(workflowReadinessSchema),
        summary: z.object({
          total: z.number(),
          ready: z.number(),
          partial: z.number(),
          blocked: z.number(),
        }),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ id }) => {
      const workflows = buildWorkflowReadiness();
      if (id) {
        if (!findWorkflow(id)) {
          return errNotFound(`Unknown workflow "${id}". Known workflows: ${WORKFLOWS.map((w) => w.id).join(", ")}`);
        }
        const readiness = workflows.find((workflow) => workflow.id === id);
        if (!readiness) return errNotFound(`Unknown workflow "${id}".`);
        return okStructured({
          activeProfile: config.profile,
          toolExposure: config.toolExposure,
          workflows: [readiness],
          summary: summarizeWorkflowsReadiness([readiness]),
        });
      }

      return okStructured({
        activeProfile: config.profile,
        toolExposure: config.toolExposure,
        workflows,
        summary: summarizeWorkflowsReadiness(workflows),
      });
    },
  );

  server.registerTool(
    "preview_action",
    {
      title: "Preview Action",
      description:
        "Dry-run governance preview of a tool call WITHOUT executing it. Validates the args against the tool's real " +
        "input schema, reports its risk annotations, whether it would require per-call human approval at the current " +
        "HITL level, its required OAuth scope, the exact PII-scrubbed record the audit log would write, and the live " +
        "rate-limit / emergency-stop posture. The target handler is never invoked — zero side effect. Use it to see " +
        "what a destructive call would record and whether it would be gated, before committing to run it.",
      inputSchema: {
        tool: z.string().min(1).max(120).describe("Tool name to preview, for example delete_reminder or move_note."),
        args: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Arguments you would pass. Validated against the tool's real input schema; never executed."),
      },
      outputSchema: {
        tool: z.string(),
        exists: z.boolean(),
        exposed: z.boolean().optional(),
        annotations: z
          .object({ destructive: z.boolean(), readOnly: z.boolean(), sensitive: z.boolean() })
          .optional(),
        argsValid: z.boolean().optional(),
        validationError: z.string().optional(),
        wouldRequireApproval: z.boolean().optional(),
        hitlLevel: z.string(),
        requiredScope: z.string().optional(),
        auditPreview: z
          .object({
            tool: z.string(),
            status: z.string(),
            actor: z.string(),
            args: z.record(z.string(), z.unknown()),
          })
          .optional(),
        rateLimit: z.object({
          emergencyStop: z.boolean(),
          globalRemaining: z.number(),
          destructiveRemaining: z.number(),
        }),
        sideEffect: z.string(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ tool, args }) => {
      const preview = toolRegistry.previewCall(tool, (args ?? {}) as Record<string, unknown>);
      const rate = getRateLimitStatus();
      const rateLimit = {
        emergencyStop: rate.emergencyStop,
        globalRemaining: rate.globalRemaining,
        destructiveRemaining: rate.destructiveRemaining,
      };
      if (!preview.exists || !preview.annotations) {
        return okStructured({
          tool,
          exists: false,
          hitlLevel: config.hitl.level,
          rateLimit,
          sideEffect: "none — unknown tool, handler not invoked",
        });
      }
      const ann = preview.annotations;
      const wouldRequireApproval = shouldRequireApproval(
        config.hitl.level,
        { destructiveHint: ann.destructive, readOnlyHint: ann.readOnly, sensitiveHint: ann.sensitive },
        config.hitl.whitelist,
        tool,
      );
      return okStructured({
        tool,
        exists: true,
        exposed: preview.exposed,
        annotations: ann,
        argsValid: preview.argsValid,
        ...(preview.validationError ? { validationError: preview.validationError } : {}),
        wouldRequireApproval,
        hitlLevel: config.hitl.level,
        requiredScope: requiredScopeFor({ toolName: tool, isReadOnly: ann.readOnly, isDestructive: ann.destructive }),
        auditPreview: { tool, status: "would-run", actor: "caller", args: preview.auditArgs ?? {} },
        rateLimit,
        sideEffect: "none — handler not invoked",
      });
    },
  );
}
