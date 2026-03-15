/**
 * `npx airmcp init` — interactive setup wizard.
 *
 * 1. Choose modules (toggle-style with presets + recommendations)
 * 2. Write ~/.config/airmcp/config.json
 * 3. Auto-detect and patch MCP client configs (Claude Desktop, Cursor, Windsurf, etc.)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { MODULE_NAMES, STARTER_MODULES, NPM_PACKAGE_NAME } from "../shared/config.js";
import { LOGO_LINES, typeLine, sleep, writeOut } from "../shared/banner.js";
import { selectOne, selectMulti, type SelectOption, type MultiOption } from "./select.js";

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "";

interface McpClient {
  name: string;
  configPath: string;
  serversKey: string;
}

const MCP_CLIENTS: McpClient[] = [
  {
    name: "Claude Desktop",
    configPath: join(HOME, "Library", "Application Support", "Claude", "claude_desktop_config.json"),
    serversKey: "mcpServers",
  },
  {
    name: "Claude Code",
    configPath: join(HOME, ".claude", "mcp.json"),
    serversKey: "mcpServers",
  },
  {
    name: "Cursor",
    configPath: join(HOME, ".cursor", "mcp.json"),
    serversKey: "mcpServers",
  },
  {
    name: "Windsurf",
    configPath: join(HOME, ".codeium", "windsurf", "mcp_config.json"),
    serversKey: "mcpServers",
  },
];

const AIRMCP_CONFIG_DIR = join(HOME, ".config", "airmcp");
const AIRMCP_CONFIG_PATH = join(AIRMCP_CONFIG_DIR, "config.json");

// ── Module metadata ──────────────────────────────────────────────────

interface ModuleMeta {
  label: string;
  desc: string;
  category: "productivity" | "media" | "system" | "advanced" | "cloud";
}

const MODULE_META: Record<string, ModuleMeta> = {
  notes:        { label: "Notes",            desc: "Apple Notes CRUD",            category: "productivity" },
  reminders:    { label: "Reminders",        desc: "Tasks, due dates, lists",     category: "productivity" },
  calendar:     { label: "Calendar",         desc: "Events, schedules",           category: "productivity" },
  contacts:     { label: "Contacts",         desc: "People, email, phone",        category: "productivity" },
  mail:         { label: "Mail",             desc: "Read, send, manage email",    category: "productivity" },
  messages:     { label: "Messages",         desc: "iMessage/SMS",                category: "productivity" },
  music:        { label: "Music",            desc: "Playback, playlists",         category: "media" },
  finder:       { label: "Finder",           desc: "Files, search, organize",     category: "system" },
  safari:       { label: "Safari",           desc: "Tabs, bookmarks, pages",      category: "system" },
  system:       { label: "System",           desc: "Volume, brightness, apps",    category: "system" },
  photos:       { label: "Photos",           desc: "Albums, search, import",      category: "media" },
  shortcuts:    { label: "Shortcuts",        desc: "Run Siri Shortcuts",          category: "system" },
  intelligence: { label: "Intelligence",     desc: "Apple AI (macOS 26+)",        category: "advanced" },
  tv:           { label: "TV",               desc: "Apple TV playback",           category: "media" },
  ui:           { label: "UI Automation",    desc: "Accessibility, click, type",  category: "advanced" },
  screen:       { label: "Screen Capture",   desc: "Screenshot, recording",       category: "system" },
  maps:         { label: "Maps",             desc: "Location, directions",        category: "system" },
  podcasts:     { label: "Podcasts",         desc: "Shows, playback",             category: "media" },
  weather:      { label: "Weather",          desc: "Forecast, conditions",        category: "system" },
  pages:        { label: "Pages",            desc: "Documents",                   category: "productivity" },
  numbers:      { label: "Numbers",          desc: "Spreadsheets",                category: "productivity" },
  keynote:      { label: "Keynote",          desc: "Presentations",               category: "productivity" },
  location:     { label: "Location",         desc: "GPS coordinates",             category: "system" },
  bluetooth:    { label: "Bluetooth",        desc: "BLE scan, connect",           category: "advanced" },
  google:       { label: "Google Workspace", desc: "Gmail, Drive, Sheets, Cal",   category: "cloud" },
};

// ── CLI i18n ─────────────────────────────────────────────────────────

const LANGUAGES = [
  { code: "en", label: "English",    flag: "🇺🇸" },
  { code: "ko", label: "한국어",      flag: "🇰🇷" },
  { code: "ja", label: "日本語",      flag: "🇯🇵" },
  { code: "zh-CN", label: "简体中文", flag: "🇨🇳" },
  { code: "zh-TW", label: "繁體中文", flag: "🇹🇼" },
  { code: "es", label: "Español",    flag: "🇪🇸" },
  { code: "fr", label: "Français",   flag: "🇫🇷" },
  { code: "de", label: "Deutsch",    flag: "🇩🇪" },
  { code: "pt", label: "Português",  flag: "🇧🇷" },
] as const;

type LangCode = (typeof LANGUAGES)[number]["code"];

const I18N: Record<string, Record<LangCode, string>> = {
  wizard_title:   { en: "AirMCP Setup Wizard", ko: "AirMCP 설정 마법사", ja: "AirMCP セットアップ", "zh-CN": "AirMCP 设置向导", "zh-TW": "AirMCP 設定精靈", es: "Asistente de AirMCP", fr: "Assistant AirMCP", de: "AirMCP Einrichtung", pt: "Assistente AirMCP" },
  wizard_sub:     { en: "Connect your Mac to any AI via MCP", ko: "MCP로 Mac을 AI에 연결하세요", ja: "MCPでMacをAIに接続", "zh-CN": "通过MCP将Mac连接到AI", "zh-TW": "透過MCP將Mac連接到AI", es: "Conecta tu Mac a cualquier IA", fr: "Connectez votre Mac à toute IA", de: "Verbinde deinen Mac mit KI", pt: "Conecte seu Mac a qualquer IA" },
  choose_lang:    { en: "Choose language", ko: "언어를 선택하세요", ja: "言語を選択", "zh-CN": "选择语言", "zh-TW": "選擇語言", es: "Elige idioma", fr: "Choisir la langue", de: "Sprache wählen", pt: "Escolha o idioma" },
  choose_modules: { en: "Which modules would you like to enable?", ko: "어떤 모듈을 활성화할까요?", ja: "有効にするモジュールを選んでください", "zh-CN": "要启用哪些模块？", "zh-TW": "要啟用哪些模組？", es: "¿Qué módulos quieres habilitar?", fr: "Quels modules activer ?", de: "Welche Module aktivieren?", pt: "Quais módulos ativar?" },
  commands:       { en: "Commands", ko: "명령어", ja: "コマンド", "zh-CN": "命令", "zh-TW": "指令", es: "Comandos", fr: "Commandes", de: "Befehle", pt: "Comandos" },
  toggle_hint:    { en: "Toggle a module (e.g. \"6\" to toggle Messages)", ko: "모듈 전환 (예: \"6\"으로 Messages 전환)", ja: "モジュール切替（例：\"6\"でMessages）", "zh-CN": "切换模块（如 \"6\" 切换 Messages）", "zh-TW": "切換模組（如 \"6\" 切換 Messages）", es: "Alternar módulo (ej. \"6\")", fr: "Basculer un module (ex. \"6\")", de: "Modul umschalten (z.B. \"6\")", pt: "Alternar módulo (ex. \"6\")" },
  all_modules:    { en: "Enable all 25 modules", ko: "25개 모듈 전부 활성화", ja: "全25モジュール有効化", "zh-CN": "启用全部25个模块", "zh-TW": "啟用全部25個模組", es: "Habilitar los 25 módulos", fr: "Activer les 25 modules", de: "Alle 25 Module aktivieren", pt: "Ativar todos os 25 módulos" },
  starter_hint:   { en: "Reset to recommended 7 modules ★", ko: "추천 7개 모듈로 초기화 ★", ja: "推奨7モジュールにリセット ★", "zh-CN": "重置为推荐的7个模块 ★", "zh-TW": "重置為推薦的7個模組 ★", es: "Restablecer a 7 módulos recomendados ★", fr: "Réinitialiser aux 7 modules recommandés ★", de: "Auf empfohlene 7 Module zurücksetzen ★", pt: "Redefinir para 7 módulos recomendados ★" },
  prod_hint:      { en: "Enable all productivity modules", ko: "생산성 모듈 전부 활성화", ja: "生産性モジュール全て有効化", "zh-CN": "启用所有生产力模块", "zh-TW": "啟用所有生產力模組", es: "Habilitar módulos de productividad", fr: "Activer les modules de productivité", de: "Alle Produktivitätsmodule aktivieren", pt: "Ativar módulos de produtividade" },
  enter_save:     { en: "Done — save and continue", ko: "완료 — 저장 후 계속", ja: "完了 — 保存して続行", "zh-CN": "完成 — 保存并继续", "zh-TW": "完成 — 儲存並繼續", es: "Listo — guardar y continuar", fr: "Terminé — sauvegarder", de: "Fertig — speichern", pt: "Pronto — salvar e continuar" },
  recommended:    { en: "★ = recommended for new users", ko: "★ = 처음 사용자 추천", ja: "★ = 初心者におすすめ", "zh-CN": "★ = 新用户推荐", "zh-TW": "★ = 新使用者推薦", es: "★ = recomendado para nuevos usuarios", fr: "★ = recommandé pour les débutants", de: "★ = empfohlen für neue Nutzer", pt: "★ = recomendado para novos usuários" },
  prompt_hint:    { en: "number / all / starter / prod / Enter to save", ko: "번호 / all / starter / prod / Enter 저장", ja: "番号 / all / starter / prod / Enterで保存", "zh-CN": "数字 / all / starter / prod / Enter保存", "zh-TW": "數字 / all / starter / prod / Enter儲存", es: "número / all / starter / prod / Enter guardar", fr: "numéro / all / starter / prod / Entrée sauver", de: "Nummer / all / starter / prod / Enter speichern", pt: "número / all / starter / prod / Enter salvar" },
  writing_config: { en: "Writing config...", ko: "설정 저장 중...", ja: "設定を保存中...", "zh-CN": "正在保存配置...", "zh-TW": "正在儲存設定...", es: "Guardando configuración...", fr: "Enregistrement...", de: "Konfiguration wird gespeichert...", pt: "Salvando configuração..." },
  setup_complete: { en: "Setup complete!", ko: "설정 완료!", ja: "セットアップ完了！", "zh-CN": "设置完成！", "zh-TW": "設定完成！", es: "¡Configuración completa!", fr: "Configuration terminée !", de: "Einrichtung abgeschlossen!", pt: "Configuração concluída!" },
  next_steps:     { en: "Next steps", ko: "다음 단계", ja: "次のステップ", "zh-CN": "下一步", "zh-TW": "下一步", es: "Próximos pasos", fr: "Étapes suivantes", de: "Nächste Schritte", pt: "Próximos passos" },
};

function t(key: string, lang: LangCode): string {
  return I18N[key]?.[lang] ?? I18N[key]?.en ?? key;
}

const PRESETS: Record<string, { desc: string; modules: string[] }> = {
  starter: {
    desc: "Core essentials (7 modules) — Notes, Calendar, Reminders, System, Shortcuts, Finder, Weather",
    modules: [...STARTER_MODULES],
  },
  productivity: {
    desc: "All productivity apps (10 modules)",
    modules: ["notes", "reminders", "calendar", "contacts", "mail", "messages", "pages", "numbers", "keynote", "shortcuts"],
  },
  all: {
    desc: "Everything (25 modules)",
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
  const langCode = await selectOne(t("choose_lang", "en"), langOptions, 0) as LangCode;
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
    productivity: PRESETS.productivity.modules,
  };

  const selectedModules = await selectMulti(t("choose_modules", lang), moduleOptions, presetMap);
  const enabled = new Set<string>(selectedModules);

  // --- Step 2: Write config.json ---
  const disabledModules = MODULE_NAMES.filter((m) => !enabled.has(m));

  console.log("");
  process.stdout.write(`  ${t("writing_config", lang)}`);

  mkdirSync(AIRMCP_CONFIG_DIR, { recursive: true });
  const configPayload = {
    locale: lang,
    disabledModules,
    includeShared: false,
    allowSendMessages: true,
    allowSendMail: true,
  };
  writeFileSync(AIRMCP_CONFIG_PATH, JSON.stringify(configPayload, null, 2) + "\n");
  console.log(` ${GREEN}✓${RESET} ${AIRMCP_CONFIG_PATH}`);

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
      console.log(` ${GREEN}✓${RESET}`);
      patchedClients++;
    } catch (e) {
      console.log(` ${YELLOW}⚠${RESET} ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (detectedClients.length === 0) {
    console.log(`  ${YELLOW}⚠${RESET} No MCP clients detected.`);
    console.log("");
    console.log("  Add this to your MCP client config manually:");
    console.log(`  ${DIM}${JSON.stringify({ mcpServers: { airmcp: airmcpEntry } }, null, 2)}${RESET}`);
  }

  // --- Done ---
  console.log("");
  console.log(`  ${GREEN}✓${RESET} ${t("setup_complete", lang)} ${BOLD}${enabled.size} modules${RESET} enabled, ${patchedClients} client(s) configured.`);
  if (detectedClients.length > 0) {
    console.log(`  ${DIM}Restart ${detectedClients.join(", ")} to connect AirMCP.${RESET}`);
  }
  console.log("");
  console.log(`  ${DIM}${t("next_steps", lang)}:${RESET}`);
  console.log(`    ${DIM}•${RESET} Run ${BOLD}npx airmcp doctor${RESET} to check everything is working`);
  console.log(`    ${DIM}•${RESET} Re-run ${BOLD}npx airmcp init${RESET} anytime to change modules`);
  console.log(`    ${DIM}•${RESET} Use ${BOLD}npx airmcp --full${RESET} to enable all modules temporarily`);
  console.log("");

}
