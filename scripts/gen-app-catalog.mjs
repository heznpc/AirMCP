#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const OUT_PATH = join(ROOT, "app", "Sources", "AirMCPApp", "Generated", "AppCatalog.swift");
const CHECK = process.argv.includes("--check");

const MODULE_PACKS_PATH = join(ROOT, "dist", "shared", "module-packs.js");
const MODULES_PATH = join(ROOT, "dist", "shared", "modules.js");
if (!existsSync(MODULE_PACKS_PATH) || !existsSync(MODULES_PATH)) {
  fail("dist/shared catalogs missing; run `npm run build` first");
}

const { MODULE_PACK_MANIFEST } = await import(pathToFileURL(MODULE_PACKS_PATH).href);
const { MODULE_MANIFEST } = await import(pathToFileURL(MODULES_PATH).href);
const workflows = JSON.parse(readFileSync(join(ROOT, "src", "shared", "workflows-catalog.json"), "utf8"));

const MODULE_UI = {
  notes: { icon: "note.text" },
  reminders: { icon: "checklist" },
  calendar: { icon: "calendar" },
  contacts: { icon: "person.2" },
  mail: { icon: "envelope" },
  messages: { icon: "bubble.left" },
  music: { icon: "music.note" },
  finder: { icon: "folder" },
  safari: { icon: "safari" },
  system: { icon: "gearshape" },
  photos: { icon: "photo" },
  shortcuts: { icon: "command" },
  intelligence: { icon: "brain" },
  tv: { icon: "tv" },
  ui: { icon: "hand.tap" },
  screen: { icon: "camera.viewfinder", onboardingIcon: "display" },
  maps: { icon: "map" },
  podcasts: { icon: "antenna.radiowaves.left.and.right.circle", onboardingIcon: "headphones" },
  weather: { icon: "cloud.sun" },
  pages: { icon: "doc.richtext" },
  numbers: { icon: "tablecells" },
  keynote: { icon: "play.rectangle" },
  location: { icon: "location" },
  bluetooth: { icon: "wave.3.right", onboardingIcon: "dot.radiowaves.left.and.right" },
  google: { icon: "globe", onboardingIcon: "at" },
  speech: { icon: "waveform" },
  health: { icon: "heart" },
  memory: { icon: "brain.head.profile" },
  audit: { icon: "doc.text.magnifyingglass" },
  spatial_prep: { icon: "visionpro" },
  webhooks: { icon: "link" },
  powerautomate: { icon: "bolt.circle" },
};

const PACK_UI = {
  core: { icon: "square.stack.3d.up", key: "core" },
  communications: { icon: "bubble.left.and.bubble.right", key: "communications" },
  productivity: { icon: "doc.on.doc", key: "productivity" },
  browser: { icon: "safari", key: "browser" },
  media: { icon: "play.rectangle", key: "media" },
  visual: { icon: "photo.on.rectangle", key: "visual" },
  location: { icon: "map", key: "location" },
  device: { icon: "dot.radiowaves.left.and.right", key: "device" },
  intelligence: { icon: "brain", key: "intelligence" },
  "google-workspace": { icon: "globe", key: "google" },
  spatial: { icon: "visionpro", key: "spatial" },
  webhooks: { icon: "link", key: "webhooks" },
  powerautomate: { icon: "bolt.circle", key: "powerautomate" },
};

const WORKFLOW_ICONS = {
  "daily-briefing": "sun.max",
  "inbox-triage": "tray.full",
  "meeting-prep": "person.2.wave.2",
  "project-digest": "folder",
  "focus-blocks": "calendar.badge.clock",
  "research-output": "doc.text.magnifyingglass",
};

const ONBOARDING_MODULE_IDS = [
  "notes",
  "reminders",
  "calendar",
  "contacts",
  "mail",
  "messages",
  "safari",
  "finder",
  "music",
  "photos",
  "tv",
  "podcasts",
  "system",
  "shortcuts",
  "ui",
  "screen",
  "intelligence",
  "memory",
  "audit",
  "weather",
  "location",
  "maps",
  "bluetooth",
  "google",
];

const moduleIds = MODULE_MANIFEST.map((entry) => entry.name);
const moduleIdSet = new Set(moduleIds);

for (const moduleId of moduleIds) {
  if (!MODULE_UI[moduleId]) fail(`missing app UI metadata for module ${moduleId}`);
}
for (const pack of MODULE_PACK_MANIFEST) {
  if (!PACK_UI[pack.name]) fail(`missing app UI metadata for module pack ${pack.name}`);
  for (const moduleId of pack.modules) {
    if (!moduleIdSet.has(moduleId)) fail(`module pack ${pack.name} references unknown module ${moduleId}`);
  }
}
for (const workflow of workflows) {
  if (!WORKFLOW_ICONS[workflow.id]) fail(`missing app icon metadata for workflow ${workflow.id}`);
  for (const moduleId of workflow.requiredModules) {
    if (!moduleIdSet.has(moduleId)) fail(`workflow ${workflow.id} references unknown module ${moduleId}`);
  }
}
for (const moduleId of ONBOARDING_MODULE_IDS) {
  if (!moduleIdSet.has(moduleId)) fail(`onboarding references unknown module ${moduleId}`);
}

const toolCounts = new Map(moduleIds.map((moduleId) => [moduleId, countModuleTools(moduleId)]));

const source = renderSwift();
if (CHECK) {
  if (!existsSync(OUT_PATH)) fail(`${OUT_PATH} missing; run \`npm run gen:app-catalog\``);
  const current = readFileSync(OUT_PATH, "utf8");
  if (current !== source) {
    writeFileSync("/tmp/airmcp-app-catalog-expected.swift", source);
    fail("drift detected in AppCatalog.swift; expected output written to /tmp/airmcp-app-catalog-expected.swift");
  }
  console.error(`[gen-app-catalog --check] OK - ${moduleIds.length} modules, ${MODULE_PACK_MANIFEST.length} packs`);
} else {
  mkdirSync(join(ROOT, "app", "Sources", "AirMCPApp", "Generated"), { recursive: true });
  writeFileSync(OUT_PATH, source);
  console.error(`[gen-app-catalog] wrote ${OUT_PATH} - ${moduleIds.length} modules, ${MODULE_PACK_MANIFEST.length} packs`);
}

function countModuleTools(moduleId) {
  const path = join(ROOT, "src", moduleId, "tools.ts");
  if (!existsSync(path)) return 0;
  const src = readFileSync(path, "utf8");
  return (src.match(/\bserver\.registerTool\(/g) ?? []).length;
}

function renderSwift() {
  return `// Generated by scripts/gen-app-catalog.mjs.
// Source of truth: src/shared/modules.ts, src/shared/module-packs.ts, src/shared/workflows-catalog.json.
// Do not edit by hand. Run \`npm run gen:app-catalog\`.

import Foundation

struct ModuleInfo: Identifiable {
    let id: String
    let nameKey: String
    let descKey: String
    let icon: String
    let toolCount: Int
    let minMacosVersion: Int?

    init(id: String, icon: String, toolCount: Int, minMacosVersion: Int? = nil) {
        self.id = id
        self.nameKey = "module.\\(id)"
        self.descKey = "module.\\(id).desc"
        self.icon = icon
        self.toolCount = toolCount
        self.minMacosVersion = minMacosVersion
    }

    var localizedName: String { L(nameKey) }
    var localizedDescription: String { L(descKey) }

    var isAvailableOnCurrentOS: Bool {
        guard let required = minMacosVersion else { return true }
        return Self.currentMacOSVersion >= required
    }

    private static let currentMacOSVersion = ProcessInfo.processInfo.operatingSystemVersion.majorVersion
}

struct ModulePackInfo: Identifiable {
    let id: String
    let titleKey: String
    let descKey: String
    let packageName: String
    let icon: String
    let required: Bool

    var localizedTitle: String { L(titleKey) }
    var localizedDescription: String { L(descKey) }
    var installCommand: String { "npx airmcp modules enable \\(id) --install" }
}

struct WorkflowInfo: Identifiable {
    let id: String
    let titleKey: String
    let descKey: String
    let promptKey: String
    let safetyKey: String
    let siriKey: String?
    let icon: String
    let tools: [String]

    var title: String { L(titleKey) }
    var localizedDescription: String { L(descKey) }
    var prompt: String { L(promptKey) }
    var safety: String { L(safetyKey) }
    var siriPhrase: String? {
        guard let siriKey else { return nil }
        return L(siriKey)
    }
}

struct OnboardingModule: Identifiable {
    let id: String
    let icon: String

    var localizedName: String { L("module.\\(id)") }
    var localizedDescription: String { L("module.\\(id).desc") }
}

struct OnboardingWorkflow: Identifiable {
    let id: String
    let titleKey: String
    let descKey: String
    let promptKey: String
    let safetyKey: String
    let accessKey: String
    let siriKey: String?
    let icon: String
    let requiredModules: Set<String>

    var title: String { L(titleKey) }
    var localizedDescription: String { L(descKey) }
    var prompt: String { L(promptKey) }
    var safety: String { L(safetyKey) }
    var accessSummary: String { L(accessKey) }
    var siriPhrase: String? {
        guard let siriKey else { return nil }
        return L(siriKey)
    }
}

let allModules: [ModuleInfo] = [
${indent(moduleIds.map(renderModule).join(",\n"), 4)}
]

let allModulePacks: [ModulePackInfo] = [
${indent(MODULE_PACK_MANIFEST.map(renderPack).join(",\n"), 4)}
]

let allModulePackIds = Set(allModulePacks.map(\\.id))

let featuredWorkflows: [WorkflowInfo] = [
${indent(workflows.map(renderWorkflow).join(",\n"), 4)}
]

let onboardingModules: [OnboardingModule] = [
${indent(ONBOARDING_MODULE_IDS.map(renderOnboardingModule).join(",\n"), 4)}
]

let onboardingModuleIds = Set(onboardingModules.map(\\.id))

let onboardingWorkflows: [OnboardingWorkflow] = [
${indent(workflows.map(renderOnboardingWorkflow).join(",\n"), 4)}
]
`;
}

function renderModule(moduleId) {
  const manifest = MODULE_MANIFEST.find((entry) => entry.name === moduleId);
  const ui = MODULE_UI[moduleId];
  const args = [
    `id: ${swiftString(moduleId)}`,
    `icon: ${swiftString(ui.icon)}`,
    `toolCount: ${toolCounts.get(moduleId) ?? 0}`,
  ];
  if (manifest.minMacosVersion) args.push(`minMacosVersion: ${manifest.minMacosVersion}`);
  return `ModuleInfo(${args.join(", ")})`;
}

function renderPack(pack) {
  const ui = PACK_UI[pack.name];
  return `ModulePackInfo(
    id: ${swiftString(pack.name)},
    titleKey: ${swiftString(`addon.${ui.key}`)},
    descKey: ${swiftString(`addon.${ui.key}.desc`)},
    packageName: ${swiftString(pack.packageName)},
    icon: ${swiftString(ui.icon)},
    required: ${pack.required === true ? "true" : "false"}
)`;
}

function renderWorkflow(workflow) {
  const key = workflowKey(workflow.id);
  return `WorkflowInfo(
    id: ${swiftString(workflow.id)},
    titleKey: ${swiftString(`workflow.${key}`)},
    descKey: ${swiftString(`workflow.${key}.desc`)},
    promptKey: ${swiftString(`workflow.${key}.prompt`)},
    safetyKey: ${swiftString(`workflow.${key}.safety`)},
    siriKey: ${workflow.siri ? swiftString(`workflow.${key}.siri`) : "nil"},
    icon: ${swiftString(WORKFLOW_ICONS[workflow.id])},
    tools: ${swiftArray(workflow.tools)}
)`;
}

function renderOnboardingModule(moduleId) {
  const ui = MODULE_UI[moduleId];
  return `OnboardingModule(id: ${swiftString(moduleId)}, icon: ${swiftString(ui.onboardingIcon ?? ui.icon)})`;
}

function renderOnboardingWorkflow(workflow) {
  const key = workflowKey(workflow.id);
  return `OnboardingWorkflow(
    id: ${swiftString(workflow.id)},
    titleKey: ${swiftString(`workflow.${key}`)},
    descKey: ${swiftString(`workflow.${key}.desc`)},
    promptKey: ${swiftString(`workflow.${key}.prompt`)},
    safetyKey: ${swiftString(`workflow.${key}.safety`)},
    accessKey: ${swiftString(`workflow.${key}.access`)},
    siriKey: ${workflow.siri ? swiftString(`workflow.${key}.siri`) : "nil"},
    icon: ${swiftString(WORKFLOW_ICONS[workflow.id])},
    requiredModules: ${swiftArray(workflow.requiredModules)}
)`;
}

function workflowKey(id) {
  return id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function swiftArray(values) {
  return `[${values.map(swiftString).join(", ")}]`;
}

function swiftString(value) {
  return JSON.stringify(value);
}

function indent(text, spaces) {
  const prefix = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line.length > 0 ? prefix + line : line))
    .join("\n");
}

function fail(message) {
  console.error(`[gen-app-catalog] ${message}`);
  process.exit(1);
}
