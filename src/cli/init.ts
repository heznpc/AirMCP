/**
 * `npx airmcp init` — interactive setup wizard.
 *
 * 1. Choose modules (toggle-style with presets + recommendations)
 * 2. Write ~/.config/airmcp/config.json
 * 3. Ask before patching MCP client configs (Claude Desktop, Cursor, Windsurf, etc.)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import {
  DEFAULT_TOOL_EXPOSURE_BY_PROFILE,
  MODULE_NAMES,
  PRESET_PROFILE_NAMES,
  PROFILE_MODULES,
  STARTER_MODULES,
  normalizeProfileName,
  type AirMcpProfileName,
} from "../shared/config.js";
import { PATHS } from "../shared/constants.js";
import {
  codexDirectManualSetupCommand,
  codexManualSetupCommand,
  directStdioEntry,
  stdioProxyEntry,
} from "./codex-mcp.js";
import { configureMcpClients, type ClientRuntimeMode } from "./client-config.js";
import { LOGO_LINES, typeLine, sleep, writeOut } from "../shared/banner.js";
import { isPlainObject } from "../shared/validate.js";
import { formatError } from "../shared/errors.js";
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
  connect_clients_prompt: {
    en: "Connect AirMCP to detected MCP clients? This writes persistent client settings; clients may start AirMCP when they launch.",
    ko: "AirMCP\uB97C \uAC10\uC9C0\uB41C MCP \uD074\uB77C\uC774\uC5B8\uD2B8\uC5D0 \uC5F0\uACB0\uD560\uAE4C\uC694? \uC601\uAD6C \uD074\uB77C\uC774\uC5B8\uD2B8 \uC124\uC815\uC744 \uAE30\uB85D\uD558\uBA70, \uD074\uB77C\uC774\uC5B8\uD2B8 \uC2DC\uC791 \uC2DC AirMCP\uAC00 \uC2E4\uD589\uB420 \uC218 \uC788\uC2B5\uB2C8\uB2E4.",
    ja: "AirMCP\u3092\u691C\u51FA\u3055\u308C\u305FMCP\u30AF\u30E9\u30A4\u30A2\u30F3\u30C8\u306B\u63A5\u7D9A\u3057\u307E\u3059\u304B\uFF1F\u6C38\u7D9A\u7684\u306A\u30AF\u30E9\u30A4\u30A2\u30F3\u30C8\u8A2D\u5B9A\u304C\u66F8\u304D\u8FBC\u307E\u308C\u3001\u8D77\u52D5\u6642\u306BAirMCP\u304C\u8D77\u52D5\u3059\u308B\u5834\u5408\u304C\u3042\u308A\u307E\u3059\u3002",
    "zh-CN":
      "\u5C06 AirMCP \u8FDE\u63A5\u5230\u68C0\u6D4B\u5230\u7684 MCP \u5BA2\u6237\u7AEF\u5417\uFF1F\u8FD9\u4F1A\u5199\u5165\u6301\u4E45\u5BA2\u6237\u7AEF\u8BBE\u7F6E\uFF0C\u5BA2\u6237\u7AEF\u542F\u52A8\u65F6\u53EF\u80FD\u4F1A\u542F\u52A8 AirMCP\u3002",
    "zh-TW":
      "\u5C07 AirMCP \u9023\u63A5\u5230\u5075\u6E2C\u5230\u7684 MCP \u7528\u6236\u7AEF\u55CE\uFF1F\u9019\u6703\u5BEB\u5165\u6301\u7E8C\u6027\u7528\u6236\u7AEF\u8A2D\u5B9A\uFF0C\u7528\u6236\u7AEF\u555F\u52D5\u6642\u53EF\u80FD\u6703\u555F\u52D5 AirMCP\u3002",
    es: "\u00BFConectar AirMCP a los clientes MCP detectados? Esto escribe una configuraci\u00F3n persistente y puede iniciar AirMCP al abrir el cliente.",
    fr: "Connecter AirMCP aux clients MCP d\u00E9tect\u00E9s ? Cela enregistre une configuration persistante et peut lancer AirMCP au d\u00E9marrage du client.",
    de: "AirMCP mit erkannten MCP-Clients verbinden? Dies schreibt dauerhafte Client-Einstellungen; beim Client-Start kann AirMCP gestartet werden.",
    pt: "Conectar o AirMCP aos clientes MCP detectados? Isso grava configura\u00E7\u00F5es persistentes e pode iniciar o AirMCP ao abrir o cliente.",
  },
  connect_clients_no: {
    en: "No \u2014 leave all MCP client settings unchanged",
    ko: "\uC544\uB2C8\uC694 \u2014 MCP \uD074\uB77C\uC774\uC5B8\uD2B8 \uC124\uC815\uC744 \uBCC0\uACBD\uD558\uC9C0 \uC54A\uC74C",
    ja: "\u3044\u3044\u3048 \u2014 MCP\u30AF\u30E9\u30A4\u30A2\u30F3\u30C8\u8A2D\u5B9A\u3092\u5909\u66F4\u3057\u306A\u3044",
    "zh-CN": "\u5426 \u2014 \u4E0D\u66F4\u6539\u4EFB\u4F55 MCP \u5BA2\u6237\u7AEF\u8BBE\u7F6E",
    "zh-TW": "\u5426 \u2014 \u4E0D\u8B8A\u66F4\u4EFB\u4F55 MCP \u7528\u6236\u7AEF\u8A2D\u5B9A",
    es: "No \u2014 no cambiar la configuraci\u00F3n de clientes MCP",
    fr: "Non \u2014 ne modifier aucun r\u00E9glage de client MCP",
    de: "Nein \u2014 MCP-Client-Einstellungen unver\u00E4ndert lassen",
    pt: "N\u00E3o \u2014 n\u00E3o alterar as configura\u00E7\u00F5es dos clientes MCP",
  },
  connect_clients_yes: {
    en: "Yes \u2014 configure detected MCP clients",
    ko: "\uC608 \u2014 \uAC10\uC9C0\uB41C MCP \uD074\uB77C\uC774\uC5B8\uD2B8 \uC124\uC815",
    ja: "\u306F\u3044 \u2014 \u691C\u51FA\u3055\u308C\u305FMCP\u30AF\u30E9\u30A4\u30A2\u30F3\u30C8\u3092\u8A2D\u5B9A",
    "zh-CN": "\u662F \u2014 \u914D\u7F6E\u68C0\u6D4B\u5230\u7684 MCP \u5BA2\u6237\u7AEF",
    "zh-TW": "\u662F \u2014 \u8A2D\u5B9A\u5075\u6E2C\u5230\u7684 MCP \u7528\u6236\u7AEF",
    es: "S\u00ED \u2014 configurar los clientes MCP detectados",
    fr: "Oui \u2014 configurer les clients MCP d\u00E9tect\u00E9s",
    de: "Ja \u2014 erkannte MCP-Clients konfigurieren",
    pt: "Sim \u2014 configurar os clientes MCP detectados",
  },
  try_asking: {
    en: "Try asking your AI:",
    ko: "AI\uC5D0\uAC8C \uBB3C\uC5B4\uBCF4\uC138\uC694:",
    ja: "AI\u306B\u8A66\u3057\u306B\u805E\u3044\u3066\u307F\u3066:",
    "zh-CN": "\u8BD5\u8BD5\u95EE\u4F60\u7684 AI:",
    "zh-TW": "\u8A66\u8A66\u554F\u4F60\u7684 AI:",
    es: "Prueba preguntando a tu IA:",
    fr: "Essayez de demander \u00E0 votre IA :",
    de: "Frage deine KI:",
    pt: "Experimente perguntar \u00E0 sua IA:",
  },
  prompt_calendar_today: {
    en: "What's on my calendar today?",
    ko: "\uC624\uB298 \uC77C\uC815\uC774 \uBB34\uC5C7\uC778\uAC00\uC694?",
    ja: "\u4ECA\u65E5\u306E\u30B9\u30B1\u30B8\u30E5\u30FC\u30EB\u306F\uFF1F",
    "zh-CN": "\u6211\u4ECA\u5929\u7684\u65E5\u7A0B\u5B89\u6392\u5982\u4F55\uFF1F",
    "zh-TW": "\u6211\u4ECA\u5929\u7684\u884C\u7A0B\u5B89\u6392\u5982\u4F55\uFF1F",
    es: "\u00BFQu\u00E9 hay en mi calendario hoy?",
    fr: "Qu\u2019y a-t-il \u00E0 mon agenda aujourd\u2019hui ?",
    de: "Was steht heute in meinem Kalender?",
    pt: "O que tenho na agenda hoje?",
  },
  prompt_summarize_notes: {
    en: "Read my latest notes and summarize them",
    ko: "\uCD5C\uADFC \uBA54\uBAA8\uB97C \uC77D\uACE0 \uC694\uC57D\uD574\uC8FC\uC138\uC694",
    ja: "\u6700\u8FD1\u306E\u30E1\u30E2\u3092\u8AAD\u3093\u3067\u8981\u7D04\u3057\u3066\u304F\u3060\u3055\u3044",
    "zh-CN": "\u9605\u8BFB\u6700\u8FD1\u7684\u7B14\u8BB0\u5E76\u603B\u7ED3",
    "zh-TW": "\u95B1\u8B80\u6700\u8FD1\u7684\u7B46\u8A18\u4E26\u7E3D\u7D50",
    es: "Lee mis \u00FAltimas notas y res\u00FAmelas",
    fr: "Lis mes derni\u00E8res notes et r\u00E9sume-les",
    de: "Lies meine letzten Notizen und fasse sie zusammen",
    pt: "Leia minhas notas recentes e resuma-as",
  },
  prompt_overdue_reminders: {
    en: "Show overdue reminders and reschedule them to tomorrow",
    ko: "\uC9C0\uB09C \uB9AC\uB9C8\uC778\uB354\uB97C \uBCF4\uC5EC\uC8FC\uACE0 \uB0B4\uC77C\uB85C \uC62E\uACA8\uC8FC\uC138\uC694",
    ja: "\u671F\u9650\u5207\u308C\u306E\u30EA\u30DE\u30A4\u30F3\u30C0\u30FC\u3092\u660E\u65E5\u306B\u518D\u30B9\u30B1\u30B8\u30E5\u30FC\u30EB",
    "zh-CN": "\u663E\u793A\u8FC7\u671F\u63D0\u9192\u5E76\u91CD\u65B0\u5B89\u6392\u5230\u660E\u5929",
    "zh-TW": "\u986F\u793A\u903E\u671F\u63D0\u9192\u4E26\u91CD\u65B0\u5B89\u6392\u5230\u660E\u5929",
    es: "Muestra recordatorios atrasados y reprogr\u00E1malos para ma\u00F1ana",
    fr: "Affiche les rappels en retard et reprogramme-les \u00E0 demain",
    de: "Zeige \u00FCberf\u00E4llige Erinnerungen und verschiebe sie auf morgen",
    pt: "Mostre lembretes atrasados e reagende-os para amanh\u00E3",
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
  "communications-safe": {
    desc: "Starter plus Contacts, Mail, Messages (send actions remain OFF)",
    modules: [...PROFILE_MODULES["communications-safe"]],
  },
  productivity: {
    desc: "All productivity apps (11 modules)",
    modules: [...PROFILE_MODULES.productivity],
  },
  all: {
    desc: `Everything (${MODULE_NAMES.length} modules)`,
    modules: [...MODULE_NAMES],
  },
};

// ── Helpers ──────────────────────────────────────────────────────────

import { DIM, RESET, BOLD, WHITE, GREEN, YELLOW } from "./style.js";

function normalizeClientRuntimeMode(raw: string | undefined): ClientRuntimeMode | null {
  const value = raw?.trim().toLowerCase();
  if (value === "app" || value === "app-owned" || value === "airmcp-app") return "app";
  if (value === "direct" || value === "stdio" || value === "direct-stdio") return "direct";
  return null;
}

function parseClientRuntimeMode(raw: string | undefined): ClientRuntimeMode {
  const mode = normalizeClientRuntimeMode(raw);
  if (!mode) {
    console.error(`[AirMCP] Invalid --client-runtime value: ${raw ?? ""}. Expected "app" or "direct".`);
    process.exit(1);
  }
  return mode;
}

function parseInitArgs(): {
  yes: boolean;
  profile: AirMcpProfileName | null;
  noClients: boolean;
  connectClients: boolean;
  clientRuntime: ClientRuntimeMode;
} {
  const args = process.argv.slice(3);
  let profile: AirMcpProfileName | null = null;
  let yes = false;
  let noClients = false;
  let connectClients = false;
  let clientRuntime: ClientRuntimeMode = "app";
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--yes" || arg === "-y") {
      yes = true;
    } else if (arg === "--no-clients") {
      noClients = true;
    } else if (arg === "--connect-clients") {
      connectClients = true;
    } else if (arg === "--profile") {
      profile = normalizeProfileName(args[i + 1]) ?? null;
      i++;
    } else if (arg?.startsWith("--profile=")) {
      profile = normalizeProfileName(arg.slice("--profile=".length));
    } else if (arg === "--client-runtime") {
      clientRuntime = parseClientRuntimeMode(args[i + 1]);
      i++;
    } else if (arg?.startsWith("--client-runtime=")) {
      clientRuntime = parseClientRuntimeMode(arg.slice("--client-runtime=".length));
    } else if (arg === "--direct-stdio") {
      clientRuntime = "direct";
    }
  }
  return { yes, profile, noClients, connectClients, clientRuntime };
}

function inferProfile(enabled: Set<string>): AirMcpProfileName | "custom" {
  for (const profile of PRESET_PROFILE_NAMES) {
    const modules = PROFILE_MODULES[profile];
    if (modules.length !== enabled.size) continue;
    if (modules.every((moduleName) => enabled.has(moduleName))) return profile;
  }
  return "custom";
}

function readExistingConfig(): Record<string, unknown> {
  if (!existsSync(PATHS.CONFIG)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(PATHS.CONFIG, "utf-8"));
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    console.warn(`\n  ${YELLOW}\u26A0${RESET} Existing config.json is corrupt JSON — overwriting`);
    return {};
  }
}

function writeConfigPayload(payload: Record<string, unknown>): void {
  mkdirSync(PATHS.CONFIG_DIR, { recursive: true });
  writeFileSync(PATHS.CONFIG, JSON.stringify(payload, null, 2) + "\n");
}

function buildConfigPayload(params: {
  existingConfig: Record<string, unknown>;
  locale?: string;
  enabled: Set<string>;
  includeShared: boolean;
  allowSendMessages: boolean;
  allowSendMail: boolean;
  allowRunJavascript: boolean;
  hitlLevel: string;
  features: Record<string, boolean>;
}): Record<string, unknown> {
  const selectedProfile = inferProfile(params.enabled);
  const disabledModules = MODULE_NAMES.filter((m) => !params.enabled.has(m));
  const existingHitl = isPlainObject(params.existingConfig.hitl) ? params.existingConfig.hitl : {};
  const existingFeatures = isPlainObject(params.existingConfig.features) ? params.existingConfig.features : {};
  return {
    ...params.existingConfig,
    ...(params.locale ? { locale: params.locale } : {}),
    profile: selectedProfile,
    toolExposure: selectedProfile === "custom" ? "profile" : DEFAULT_TOOL_EXPOSURE_BY_PROFILE[selectedProfile],
    requireToolSession: true,
    disabledModules,
    includeShared: params.includeShared,
    allowSendMessages: params.allowSendMessages,
    allowSendMail: params.allowSendMail,
    allowRunJavascript: params.allowRunJavascript,
    hitl: { ...existingHitl, level: params.hitlLevel },
    features: {
      ...existingFeatures,
      ...params.features,
    },
  };
}

export async function runInit(): Promise<void> {
  const initArgs = parseInitArgs();
  if (initArgs.yes && initArgs.profile) {
    const enabled = new Set<string>(PROFILE_MODULES[initArgs.profile]);
    const configPayload = buildConfigPayload({
      existingConfig: readExistingConfig(),
      enabled,
      includeShared: false,
      allowSendMessages: false,
      allowSendMail: false,
      allowRunJavascript: false,
      hitlLevel: "sensitive-only",
      features: {
        usageTracking: true,
        auditLog: true,
        semanticToolSearch: true,
        proactiveContext: true,
      },
    });
    try {
      writeConfigPayload(configPayload);
    } catch (err) {
      console.error(`[AirMCP] Failed to write config: ${formatError(err)}`);
      process.exit(1);
    }
    const shouldConnectClients = initArgs.connectClients && !initArgs.noClients;
    const clientResults = shouldConnectClients
      ? configureMcpClients({ includeSkipped: false, runtimeMode: initArgs.clientRuntime })
      : [];
    const patchedClients = clientResults.filter((result) => result.status !== "failed").length;
    console.log(
      `[AirMCP] profile=${String(configPayload.profile)}, toolExposure=${configPayload.toolExposure}, modules=${enabled.size}, clients=${shouldConnectClients ? patchedClients : "skipped"}`,
    );
    console.log(`[AirMCP] wrote ${PATHS.CONFIG}`);
    if (!shouldConnectClients) {
      console.log(
        "[AirMCP] client registration skipped; no MCP client config was changed. Run `npx airmcp connect-clients` when you want to connect them.",
      );
    }
    return;
  }

  // Guard: interactive prompts require a TTY
  if (!process.stdin.isTTY) {
    console.error(
      "[AirMCP] init requires an interactive terminal.\n" +
        "  For non-interactive setup, choose a profile explicitly:\n" +
        "    npx airmcp init --profile starter --yes\n" +
        "    npx airmcp init --profile communications-safe --yes\n" +
        "    npx airmcp init --profile productivity --yes\n" +
        "    npx airmcp init --profile full --yes\n" +
        "  Client registration is skipped by default.\n" +
        "  Add --connect-clients to explicitly patch detected MCP clients.\n" +
        "  Add --client-runtime direct with --connect-clients to write direct stdio entries.\n" +
        "  Add --no-clients to suppress the interactive client-registration question.",
    );
    process.exit(1);
  }

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
    comms: PRESETS["communications-safe"]!.modules,
    productivity: PRESETS.productivity!.modules,
  };

  const selectedModules = await selectMulti(t("choose_modules", lang), moduleOptions, presetMap);
  const enabled = new Set<string>(selectedModules);

  // --- Step 2: Security & privacy settings ---
  console.log("");
  const securityOptions: SelectOption[] = [
    {
      label: "Recommended (sensitive and destructive actions need approval)",
      value: "sensitive-only",
      hint: "default",
    },
    { label: "Minimal (destructive actions only)", value: "destructive-only" },
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
  console.log("");
  process.stdout.write(`  ${t("writing_config", lang)}`);
  const configPayload = buildConfigPayload({
    existingConfig: readExistingConfig(),
    locale: lang,
    enabled,
    includeShared: permSelected.has("includeShared"),
    allowSendMessages: permSelected.has("sendMessages"),
    allowSendMail: permSelected.has("sendMail"),
    allowRunJavascript: permSelected.has("runJavascript"),
    hitlLevel,
    features: {
      usageTracking: featureSelected.has("usageTracking"),
      auditLog: featureSelected.has("auditLog"),
      semanticToolSearch: featureSelected.has("semanticToolSearch"),
      proactiveContext: featureSelected.has("proactiveContext"),
    },
  });
  try {
    writeConfigPayload(configPayload);
  } catch (err) {
    console.error(`\n  ${YELLOW}\u2716${RESET} Failed to write config: ${formatError(err)}`);
    process.exit(1);
  }
  console.log(` ${GREEN}\u2713${RESET} ${PATHS.CONFIG}`);

  // --- Step 5: Ask before detecting or patching MCP client configs ---
  let shouldConnectClients = false;
  if (!initArgs.noClients) {
    const clientConsent = await selectOne(
      t("connect_clients_prompt", lang),
      [
        { label: t("connect_clients_no", lang), value: "no", hint: "default" },
        { label: t("connect_clients_yes", lang), value: "yes" },
      ],
      0,
    );
    shouldConnectClients = clientConsent === "yes";
  }

  const clientResults = shouldConnectClients
    ? configureMcpClients({ includeSkipped: false, runtimeMode: initArgs.clientRuntime })
    : [];
  const detectedClients = clientResults.map((result) => result.name);
  let patchedClients = 0;

  for (const result of clientResults) {
    process.stdout.write(`  Configuring ${result.name}...`);
    if (result.status === "failed") {
      console.log(` ${YELLOW}\u26A0${RESET} ${result.detail}`);
      continue;
    }
    console.log(
      ` ${GREEN}\u2713${RESET}${result.status === "already-configured" ? ` ${DIM}(already connected)${RESET}` : ""}`,
    );
    patchedClients++;
  }

  if (!shouldConnectClients) {
    console.log(`  ${DIM}Client registration skipped; no MCP client config was changed.${RESET}`);
    console.log(`  ${DIM}Run ${BOLD}npx airmcp connect-clients${RESET}${DIM} when you want to connect them.${RESET}`);
  } else if (detectedClients.length === 0) {
    const airmcpEntry = initArgs.clientRuntime === "direct" ? directStdioEntry() : stdioProxyEntry();
    console.log(`  ${YELLOW}\u26A0${RESET} No MCP clients detected.`);
    console.log("");
    console.log("  Add this to your MCP client config manually:");
    console.log(`  ${DIM}${JSON.stringify({ mcpServers: { airmcp: airmcpEntry } }, null, 2)}${RESET}`);
    console.log("");
    console.log("  Codex CLI:");
    console.log(
      `  ${DIM}${initArgs.clientRuntime === "direct" ? codexDirectManualSetupCommand() : codexManualSetupCommand()}${RESET}`,
    );
  }

  // --- Done ---
  console.log("");
  const clientSummary = shouldConnectClients
    ? `${patchedClients} client(s) configured.`
    : "client registration skipped; no MCP client settings changed.";
  console.log(
    `  ${GREEN}\u2713${RESET} ${t("setup_complete", lang)} ${BOLD}${enabled.size} modules${RESET}, profile: ${BOLD}${String(configPayload.profile)}${RESET}, safety: ${BOLD}${hitlLevel}${RESET}, ${clientSummary}`,
  );
  if (shouldConnectClients && detectedClients.length > 0) {
    if (initArgs.clientRuntime === "direct") {
      console.log(`  ${DIM}Restart ${detectedClients.join(", ")} to connect via direct stdio.${RESET}`);
    } else {
      console.log(`  ${DIM}Start AirMCP.app, then restart ${detectedClients.join(", ")} to connect.${RESET}`);
    }
  }
  console.log("");
  console.log(`  ${DIM}${t("next_steps", lang)}:${RESET}`);
  console.log(`    ${DIM}\u2022${RESET} Run ${BOLD}npx airmcp doctor${RESET} to check everything is working`);
  console.log(
    `    ${DIM}\u2022${RESET} Run ${BOLD}npx airmcp doctor --deep${RESET} for audit + Swift bridge + module-load probes`,
  );
  console.log(`    ${DIM}\u2022${RESET} Run ${BOLD}npx airmcp workflows${RESET} to see target workflows and prompts`);
  console.log(`    ${DIM}\u2022${RESET} Re-run ${BOLD}npx airmcp init${RESET} anytime to change modules`);
  console.log(
    `    ${DIM}\u2022${RESET} Use ${BOLD}npx airmcp --full${RESET} to request every installed module temporarily`,
  );
  console.log("");
  console.log(`  ${DIM}${t("try_asking", lang)}${RESET}`);
  console.log(`    ${DIM}\u201c${RESET}${t("prompt_calendar_today", lang)}${DIM}\u201d${RESET}`);
  console.log(`    ${DIM}\u201c${RESET}${t("prompt_summarize_notes", lang)}${DIM}\u201d${RESET}`);
  console.log(`    ${DIM}\u201c${RESET}${t("prompt_overdue_reminders", lang)}${DIM}\u201d${RESET}`);
  console.log("");
}
