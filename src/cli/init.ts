/**
 * `npx airmcp init` — interactive setup wizard.
 *
 * 1. Choose modules (toggle-style with presets + recommendations)
 * 2. Write ~/.config/airmcp/config.json
 * 3. Auto-detect and patch MCP client configs (Claude Desktop, Cursor, Windsurf, etc.)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { MODULE_NAMES, STARTER_MODULES, NPM_PACKAGE_NAME, MCP_CLIENTS } from "../shared/config.js";
import { PATHS } from "../shared/constants.js";
import { LOGO_LINES, typeLine, sleep, writeOut } from "../shared/banner.js";
import { selectOne, selectMulti, type SelectOption, type MultiOption } from "./select.js";

// ── Module metadata ──────────────────────────────────────────────────

interface ModuleMeta {
  label: string;
  desc: string;
  category: "productivity" | "media" | "system" | "advanced" | "cloud";
}

const MODULE_META: Record<string, ModuleMeta> = {
  notes: { label: "Notes", desc: "Apple Notes CRUD", category: "productivity" },
  reminders: { label: "Reminders", desc: "Tasks, due dates, lists", category: "productivity" },
  calendar: { label: "Calendar", desc: "Events, schedules", category: "productivity" },
  contacts: { label: "Contacts", desc: "People, email, phone", category: "productivity" },
  mail: { label: "Mail", desc: "Read, send, manage email", category: "productivity" },
  messages: { label: "Messages", desc: "iMessage/SMS", category: "productivity" },
  music: { label: "Music", desc: "Playback, playlists", category: "media" },
  finder: { label: "Finder", desc: "Files, search, organize", category: "system" },
  safari: { label: "Safari", desc: "Tabs, bookmarks, pages", category: "system" },
  system: { label: "System", desc: "Volume, brightness, apps", category: "system" },
  photos: { label: "Photos", desc: "Albums, search, import", category: "media" },
  shortcuts: { label: "Shortcuts", desc: "Run Siri Shortcuts", category: "system" },
  intelligence: { label: "Intelligence", desc: "Apple AI (macOS 26+)", category: "advanced" },
  tv: { label: "TV", desc: "Apple TV playback", category: "media" },
  ui: { label: "UI Automation", desc: "Accessibility, click, type", category: "advanced" },
  screen: { label: "Screen Capture", desc: "Screenshot, recording", category: "system" },
  maps: { label: "Maps", desc: "Location, directions", category: "system" },
  podcasts: { label: "Podcasts", desc: "Shows, playback", category: "media" },
  weather: { label: "Weather", desc: "Forecast, conditions", category: "system" },
  pages: { label: "Pages", desc: "Documents", category: "productivity" },
  numbers: { label: "Numbers", desc: "Spreadsheets", category: "productivity" },
  keynote: { label: "Keynote", desc: "Presentations", category: "productivity" },
  location: { label: "Location", desc: "GPS coordinates", category: "system" },
  bluetooth: { label: "Bluetooth", desc: "BLE scan, connect", category: "advanced" },
  google: { label: "Google Workspace", desc: "Gmail, Drive, Sheets, Cal", category: "cloud" },
};

// ── CLI i18n ─────────────────────────────────────────────────────────

const LANGUAGES = [
  { code: "en", label: "English", flag: "\u{1F1FA}\u{1F1F8}" },
  { code: "ko", label: "\uD55C\uAD6D\uC5B4", flag: "\u{1F1F0}\u{1F1F7}" },
  { code: "ja", label: "\u65E5\u672C\u8A9E", flag: "\u{1F1EF}\u{1F1F5}" },
  { code: "zh-CN", label: "\u7B80\u4F53\u4E2D\u6587", flag: "\u{1F1E8}\u{1F1F3}" },
  { code: "zh-TW", label: "\u7E41\u9AD4\u4E2D\u6587", flag: "\u{1F1F9}\u{1F1FC}" },
  { code: "es", label: "Espa\u00F1ol", flag: "\u{1F1EA}\u{1F1F8}" },
  { code: "fr", label: "Fran\u00E7ais", flag: "\u{1F1EB}\u{1F1F7}" },
  { code: "de", label: "Deutsch", flag: "\u{1F1E9}\u{1F1EA}" },
  { code: "pt", label: "Portugu\u00EAs", flag: "\u{1F1E7}\u{1F1F7}" },
] as const;

type LangCode = (typeof LANGUAGES)[number]["code"];

const I18N: Record<string, Record<LangCode, string>> = {
  wizard_title: {
    en: "AirMCP Setup Wizard",
    ko: "AirMCP \uC124\uC815 \uB9C8\uBC95\uC0AC",
    ja: "AirMCP \u30BB\u30C3\u30C8\u30A2\u30C3\u30D7",
    "zh-CN": "AirMCP \u8BBE\u7F6E\u5411\u5BFC",
    "zh-TW": "AirMCP \u8A2D\u5B9A\u7CBE\u9748",
    es: "Asistente de AirMCP",
    fr: "Assistant AirMCP",
    de: "AirMCP Einrichtung",
    pt: "Assistente AirMCP",
  },
  wizard_sub: {
    en: "Connect your Mac to any AI via MCP",
    ko: "MCP\uB85C Mac\uC744 AI\uC5D0 \uC5F0\uACB0\uD558\uC138\uC694",
    ja: "MCP\u3067Mac\u3092AI\u306B\u63A5\u7D9A",
    "zh-CN": "\u901A\u8FC7MCP\u5C06Mac\u8FDE\u63A5\u5230AI",
    "zh-TW": "\u900F\u904EMCP\u5C07Mac\u9023\u63A5\u5230AI",
    es: "Conecta tu Mac a cualquier IA",
    fr: "Connectez votre Mac \u00E0 toute IA",
    de: "Verbinde deinen Mac mit KI",
    pt: "Conecte seu Mac a qualquer IA",
  },
  choose_lang: {
    en: "Choose language",
    ko: "\uC5B8\uC5B4\uB97C \uC120\uD0DD\uD558\uC138\uC694",
    ja: "\u8A00\u8A9E\u3092\u9078\u629E",
    "zh-CN": "\u9009\u62E9\u8BED\u8A00",
    "zh-TW": "\u9078\u64C7\u8A9E\u8A00",
    es: "Elige idioma",
    fr: "Choisir la langue",
    de: "Sprache w\u00E4hlen",
    pt: "Escolha o idioma",
  },
  choose_modules: {
    en: "Which modules would you like to enable?",
    ko: "\uC5B4\uB5A4 \uBAA8\uB4C8\uC744 \uD65C\uC131\uD654\uD560\uAE4C\uC694?",
    ja: "\u6709\u52B9\u306B\u3059\u308B\u30E2\u30B8\u30E5\u30FC\u30EB\u3092\u9078\u3093\u3067\u304F\u3060\u3055\u3044",
    "zh-CN": "\u8981\u542F\u7528\u54EA\u4E9B\u6A21\u5757\uFF1F",
    "zh-TW": "\u8981\u555F\u7528\u54EA\u4E9B\u6A21\u7D44\uFF1F",
    es: "\u00BFQu\u00E9 m\u00F3dulos quieres habilitar?",
    fr: "Quels modules activer ?",
    de: "Welche Module aktivieren?",
    pt: "Quais m\u00F3dulos ativar?",
  },
  commands: {
    en: "Commands",
    ko: "\uBA85\uB839\uC5B4",
    ja: "\u30B3\u30DE\u30F3\u30C9",
    "zh-CN": "\u547D\u4EE4",
    "zh-TW": "\u6307\u4EE4",
    es: "Comandos",
    fr: "Commandes",
    de: "Befehle",
    pt: "Comandos",
  },
  toggle_hint: {
    en: 'Toggle a module (e.g. "6" to toggle Messages)',
    ko: '\uBAA8\uB4C8 \uC804\uD658 (\uC608: "6"\uC73C\uB85C Messages \uC804\uD658)',
    ja: '\u30E2\u30B8\u30E5\u30FC\u30EB\u5207\u66FF\uFF08\u4F8B\uFF1A"6"\u3067Messages\uFF09',
    "zh-CN": '\u5207\u6362\u6A21\u5757\uFF08\u5982 "6" \u5207\u6362 Messages\uFF09',
    "zh-TW": '\u5207\u63DB\u6A21\u7D44\uFF08\u5982 "6" \u5207\u63DB Messages\uFF09',
    es: 'Alternar m\u00F3dulo (ej. "6")',
    fr: 'Basculer un module (ex. "6")',
    de: 'Modul umschalten (z.B. "6")',
    pt: 'Alternar m\u00F3dulo (ex. "6")',
  },
  all_modules: {
    en: `Enable all ${MODULE_NAMES.length} modules`,
    ko: `${MODULE_NAMES.length}\uAC1C \uBAA8\uB4C8 \uC804\uBD80 \uD65C\uC131\uD654`,
    ja: `\u5168${MODULE_NAMES.length}\u30E2\u30B8\u30E5\u30FC\u30EB\u6709\u52B9\u5316`,
    "zh-CN": `\u542F\u7528\u5168\u90E8${MODULE_NAMES.length}\u4E2A\u6A21\u5757`,
    "zh-TW": `\u555F\u7528\u5168\u90E8${MODULE_NAMES.length}\u500B\u6A21\u7D44`,
    es: `Habilitar los ${MODULE_NAMES.length} m\u00F3dulos`,
    fr: `Activer les ${MODULE_NAMES.length} modules`,
    de: `Alle ${MODULE_NAMES.length} Module aktivieren`,
    pt: `Ativar todos os ${MODULE_NAMES.length} m\u00F3dulos`,
  },
  starter_hint: {
    en: "Reset to recommended 7 modules \u2605",
    ko: "\uCD94\uCC9C 7\uAC1C \uBAA8\uB4C8\uB85C \uCD08\uAE30\uD654 \u2605",
    ja: "\u63A8\u59687\u30E2\u30B8\u30E5\u30FC\u30EB\u306B\u30EA\u30BB\u30C3\u30C8 \u2605",
    "zh-CN": "\u91CD\u7F6E\u4E3A\u63A8\u8350\u76847\u4E2A\u6A21\u5757 \u2605",
    "zh-TW": "\u91CD\u7F6E\u70BA\u63A8\u85A6\u76847\u500B\u6A21\u7D44 \u2605",
    es: "Restablecer a 7 m\u00F3dulos recomendados \u2605",
    fr: "R\u00E9initialiser aux 7 modules recommand\u00E9s \u2605",
    de: "Auf empfohlene 7 Module zur\u00FCcksetzen \u2605",
    pt: "Redefinir para 7 m\u00F3dulos recomendados \u2605",
  },
  prod_hint: {
    en: "Enable all productivity modules",
    ko: "\uC0DD\uC0B0\uC131 \uBAA8\uB4C8 \uC804\uBD80 \uD65C\uC131\uD654",
    ja: "\u751F\u7523\u6027\u30E2\u30B8\u30E5\u30FC\u30EB\u5168\u3066\u6709\u52B9\u5316",
    "zh-CN": "\u542F\u7528\u6240\u6709\u751F\u4EA7\u529B\u6A21\u5757",
    "zh-TW": "\u555F\u7528\u6240\u6709\u751F\u7522\u529B\u6A21\u7D44",
    es: "Habilitar m\u00F3dulos de productividad",
    fr: "Activer les modules de productivit\u00E9",
    de: "Alle Produktivit\u00E4tsmodule aktivieren",
    pt: "Ativar m\u00F3dulos de produtividade",
  },
  enter_save: {
    en: "Done \u2014 save and continue",
    ko: "\uC644\uB8CC \u2014 \uC800\uC7A5 \uD6C4 \uACC4\uC18D",
    ja: "\u5B8C\u4E86 \u2014 \u4FDD\u5B58\u3057\u3066\u7D9A\u884C",
    "zh-CN": "\u5B8C\u6210 \u2014 \u4FDD\u5B58\u5E76\u7EE7\u7EED",
    "zh-TW": "\u5B8C\u6210 \u2014 \u5132\u5B58\u4E26\u7E7C\u7E8C",
    es: "Listo \u2014 guardar y continuar",
    fr: "Termin\u00E9 \u2014 sauvegarder",
    de: "Fertig \u2014 speichern",
    pt: "Pronto \u2014 salvar e continuar",
  },
  recommended: {
    en: "\u2605 = recommended for new users",
    ko: "\u2605 = \uCC98\uC74C \uC0AC\uC6A9\uC790 \uCD94\uCC9C",
    ja: "\u2605 = \u521D\u5FC3\u8005\u306B\u304A\u3059\u3059\u3081",
    "zh-CN": "\u2605 = \u65B0\u7528\u6237\u63A8\u8350",
    "zh-TW": "\u2605 = \u65B0\u4F7F\u7528\u8005\u63A8\u85A6",
    es: "\u2605 = recomendado para nuevos usuarios",
    fr: "\u2605 = recommand\u00E9 pour les d\u00E9butants",
    de: "\u2605 = empfohlen f\u00FCr neue Nutzer",
    pt: "\u2605 = recomendado para novos usu\u00E1rios",
  },
  prompt_hint: {
    en: "number / all / starter / prod / Enter to save",
    ko: "\uBC88\uD638 / all / starter / prod / Enter \uC800\uC7A5",
    ja: "\u756A\u53F7 / all / starter / prod / Enter\u3067\u4FDD\u5B58",
    "zh-CN": "\u6570\u5B57 / all / starter / prod / Enter\u4FDD\u5B58",
    "zh-TW": "\u6578\u5B57 / all / starter / prod / Enter\u5132\u5B58",
    es: "n\u00FAmero / all / starter / prod / Enter guardar",
    fr: "num\u00E9ro / all / starter / prod / Entr\u00E9e sauver",
    de: "Nummer / all / starter / prod / Enter speichern",
    pt: "n\u00FAmero / all / starter / prod / Enter salvar",
  },
  writing_config: {
    en: "Writing config...",
    ko: "\uC124\uC815 \uC800\uC7A5 \uC911...",
    ja: "\u8A2D\u5B9A\u3092\u4FDD\u5B58\u4E2D...",
    "zh-CN": "\u6B63\u5728\u4FDD\u5B58\u914D\u7F6E...",
    "zh-TW": "\u6B63\u5728\u5132\u5B58\u8A2D\u5B9A...",
    es: "Guardando configuraci\u00F3n...",
    fr: "Enregistrement...",
    de: "Konfiguration wird gespeichert...",
    pt: "Salvando configura\u00E7\u00E3o...",
  },
  setup_complete: {
    en: "Setup complete!",
    ko: "\uC124\uC815 \uC644\uB8CC!",
    ja: "\u30BB\u30C3\u30C8\u30A2\u30C3\u30D7\u5B8C\u4E86\uFF01",
    "zh-CN": "\u8BBE\u7F6E\u5B8C\u6210\uFF01",
    "zh-TW": "\u8A2D\u5B9A\u5B8C\u6210\uFF01",
    es: "\u00A1Configuraci\u00F3n completa!",
    fr: "Configuration termin\u00E9e !",
    de: "Einrichtung abgeschlossen!",
    pt: "Configura\u00E7\u00E3o conclu\u00EDda!",
  },
  next_steps: {
    en: "Next steps",
    ko: "\uB2E4\uC74C \uB2E8\uACC4",
    ja: "\u6B21\u306E\u30B9\u30C6\u30C3\u30D7",
    "zh-CN": "\u4E0B\u4E00\u6B65",
    "zh-TW": "\u4E0B\u4E00\u6B65",
    es: "Pr\u00F3ximos pasos",
    fr: "\u00C9tapes suivantes",
    de: "N\u00E4chste Schritte",
    pt: "Pr\u00F3ximos passos",
  },
};

function t(key: string, lang: LangCode): string {
  return I18N[key]?.[lang] ?? I18N[key]?.en ?? key;
}

const PRESETS: Record<string, { desc: string; modules: string[] }> = {
  starter: {
    desc: "Core essentials (7 modules) \u2014 Notes, Calendar, Reminders, System, Shortcuts, Finder, Weather",
    modules: [...STARTER_MODULES],
  },
  productivity: {
    desc: "All productivity apps (10 modules)",
    modules: [
      "notes",
      "reminders",
      "calendar",
      "contacts",
      "mail",
      "messages",
      "pages",
      "numbers",
      "keynote",
      "shortcuts",
    ],
  },
  all: {
    desc: `Everything (${MODULE_NAMES.length} modules)`,
    modules: [...MODULE_NAMES],
  },
};

// ── Helpers ──────────────────────────────────────────────────────────

import { DIM, RESET, BOLD, WHITE, GREEN, YELLOW } from "./style.js";

export async function runInit(): Promise<void> {
  // Animated logo
  writeOut("\n");
  for (const line of LOGO_LINES) {
    await typeLine(line, 3, "stdout");
  }
  writeOut("\n");
  await typeLine(`  ${BOLD}${WHITE}AirMCP Setup Wizard${RESET}`, 10, "stdout");
  writeOut("\n");
  await sleep(200);

  // --- Step 0: Language selection (arrow keys) ---
  const langOptions: SelectOption[] = LANGUAGES.map((l) => ({
    label: `${l.flag}  ${l.label}`,
    value: l.code,
    hint: l.code === "en" ? "(default)" : undefined,
  }));
  const langCode = (await selectOne(t("choose_lang", "en"), langOptions, 0)) as LangCode;
  const lang: LangCode = LANGUAGES.some((l) => l.code === langCode) ? langCode : "en";

  await typeLine(`  ${DIM}${t("wizard_sub", lang)}${RESET}`, 5, "stdout");
  writeOut("\n");

  // --- Step 1: Module selection (arrow keys + space toggle) ---
  const moduleOptions: MultiOption[] = MODULE_NAMES.map((name) => {
    const meta = MODULE_META[name];
    return {
      label: meta?.label ?? name,
      value: name,
      checked: STARTER_MODULES.has(name),
      hint: meta?.desc,
      star: STARTER_MODULES.has(name),
    };
  });

  const presetMap = {
    all: [...MODULE_NAMES],
    starter: [...STARTER_MODULES],
    productivity: PRESETS.productivity!.modules,
  };

  const selectedModules = await selectMulti(t("choose_modules", lang), moduleOptions, presetMap);
  const enabled = new Set<string>(selectedModules);

  // --- Step 2: Security & privacy settings ---
  console.log("");
  const securityOptions: SelectOption[] = [
    { label: "Recommended (destructive actions need approval)", value: "destructive-only", hint: "default" },
    { label: "Strict (all write operations need approval)", value: "all-writes" },
    { label: "Maximum (every tool call needs approval)", value: "all" },
    { label: "Off (no confirmations)", value: "off" },
  ];
  const hitlLevel = await selectOne("  Safety level — when should AirMCP ask for confirmation?", securityOptions, 0);

  const permOptions: MultiOption[] = [
    { label: "Allow sending iMessages", value: "sendMessages", checked: false, hint: "Messages app" },
    { label: "Allow sending emails", value: "sendMail", checked: false, hint: "Mail app" },
    { label: "Allow running JavaScript in Safari", value: "runJavascript", checked: false, hint: "Safari tabs" },
    { label: "Include shared Notes/folders", value: "includeShared", checked: false, hint: "collaborative" },
  ];
  const permSelected = new Set(await selectMulti("  Permissions — these are OFF by default for safety:", permOptions));

  // --- Step 3: Intelligence features ---
  const featureOptions: MultiOption[] = [
    { label: "Usage pattern learning", value: "usageTracking", checked: true, hint: "tool recommendations" },
    { label: "Audit log", value: "auditLog", checked: true, hint: "~/.airmcp/audit.jsonl" },
    { label: "Semantic tool search", value: "semanticToolSearch", checked: true, hint: "requires Gemini API key" },
    { label: "Proactive suggestions", value: "proactiveContext", checked: true, hint: "time-based context" },
  ];
  const featureSelected = new Set(
    await selectMulti("  Intelligence features — all ON by default, disable what you don't need:", featureOptions),
  );

  // --- Step 4: Write config.json ---
  const disabledModules = MODULE_NAMES.filter((m) => !enabled.has(m));

  console.log("");
  process.stdout.write(`  ${t("writing_config", lang)}`);

  mkdirSync(PATHS.CONFIG_DIR, { recursive: true });
  const configPayload = {
    locale: lang,
    disabledModules,
    includeShared: permSelected.has("includeShared"),
    allowSendMessages: permSelected.has("sendMessages"),
    allowSendMail: permSelected.has("sendMail"),
    allowRunJavascript: permSelected.has("runJavascript"),
    hitl: { level: hitlLevel },
    features: {
      usageTracking: featureSelected.has("usageTracking"),
      auditLog: featureSelected.has("auditLog"),
      semanticToolSearch: featureSelected.has("semanticToolSearch"),
      proactiveContext: featureSelected.has("proactiveContext"),
    },
  };
  writeFileSync(PATHS.CONFIG, JSON.stringify(configPayload, null, 2) + "\n");
  console.log(` ${GREEN}\u2713${RESET} ${PATHS.CONFIG}`);

  // --- Step 3: Auto-detect and patch MCP client configs ---
  const airmcpEntry = {
    command: "npx",
    args: ["-y", NPM_PACKAGE_NAME],
  };

  let patchedClients = 0;
  const detectedClients: string[] = [];

  for (const client of MCP_CLIENTS) {
    const configExists = existsSync(client.configPath);
    const parentExists = existsSync(join(client.configPath, ".."));

    // Only patch if the config file or its parent directory already exists (client is installed)
    if (!configExists && !parentExists) continue;

    detectedClients.push(client.name);
    process.stdout.write(`  Configuring ${client.name}...`);

    try {
      let existing: Record<string, unknown> = {};
      if (configExists) {
        existing = JSON.parse(readFileSync(client.configPath, "utf-8"));
      }

      const servers = (existing[client.serversKey] as Record<string, unknown>) ?? {};
      servers.airmcp = airmcpEntry;
      existing[client.serversKey] = servers;

      mkdirSync(join(client.configPath, ".."), { recursive: true });
      writeFileSync(client.configPath, JSON.stringify(existing, null, 2) + "\n");
      console.log(` ${GREEN}\u2713${RESET}`);
      patchedClients++;
    } catch (e) {
      console.log(` ${YELLOW}\u26A0${RESET} ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (detectedClients.length === 0) {
    console.log(`  ${YELLOW}\u26A0${RESET} No MCP clients detected.`);
    console.log("");
    console.log("  Add this to your MCP client config manually:");
    console.log(`  ${DIM}${JSON.stringify({ mcpServers: { airmcp: airmcpEntry } }, null, 2)}${RESET}`);
  }

  // --- Done ---
  console.log("");
  console.log(
    `  ${GREEN}\u2713${RESET} ${t("setup_complete", lang)} ${BOLD}${enabled.size} modules${RESET}, safety: ${BOLD}${hitlLevel}${RESET}, ${patchedClients} client(s) configured.`,
  );
  if (detectedClients.length > 0) {
    console.log(`  ${DIM}Restart ${detectedClients.join(", ")} to connect AirMCP.${RESET}`);
  }
  console.log("");
  console.log(`  ${DIM}${t("next_steps", lang)}:${RESET}`);
  console.log(`    ${DIM}\u2022${RESET} Run ${BOLD}npx airmcp doctor${RESET} to check everything is working`);
  console.log(`    ${DIM}\u2022${RESET} Re-run ${BOLD}npx airmcp init${RESET} anytime to change modules`);
  console.log(`    ${DIM}\u2022${RESET} Use ${BOLD}npx airmcp --full${RESET} to enable all modules temporarily`);
  console.log("");
}
