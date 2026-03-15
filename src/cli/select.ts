/**
 * Interactive terminal selectors using raw keypress input.
 * Arrow keys to navigate, Space to toggle, Enter to confirm.
 */
import { emitKeypressEvents } from "node:readline";

const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const WHITE = "\x1b[97m";
const GREEN = "\x1b[32m";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const CLEAR_LINE = "\x1b[2K\r";
const MOVE_UP = (n: number) => `\x1b[${n}A`;

// ── Single select (language picker) ──────────────────────────────────

export interface SelectOption {
  label: string;
  value: string;
  hint?: string;
}

export function selectOne(
  title: string,
  options: SelectOption[],
  defaultIndex = 0,
): Promise<string> {
  return new Promise((resolve) => {
    let cursor = defaultIndex;
    const out = process.stdout;

    function render(first = false) {
      if (!first) {
        // Move cursor up to redraw
        out.write(MOVE_UP(options.length));
      }
      for (let i = 0; i < options.length; i++) {
        const opt = options[i];
        const selected = i === cursor;
        const pointer = selected ? `${WHITE}❯${RESET}` : " ";
        const label = selected ? `${BOLD}${opt.label}${RESET}` : `${DIM}${opt.label}${RESET}`;
        const hint = opt.hint ? ` ${DIM}${opt.hint}${RESET}` : "";
        out.write(`${CLEAR_LINE}  ${pointer} ${label}${hint}\n`);
      }
    }

    out.write(`  ${BOLD}${title}${RESET}\n\n`);
    out.write(HIDE_CURSOR);
    render(true);
    out.write(`\n${CLEAR_LINE}  ${DIM}↑↓ move · Enter select${RESET}`);

    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    emitKeypressEvents(stdin);

    const onKeypress = (_ch: string, key: { name: string; ctrl?: boolean }) => {
      if (!key) return;
      if (key.ctrl && key.name === "c") {
        cleanup();
        process.exit(0);
      }
      if (key.name === "up") {
        cursor = (cursor - 1 + options.length) % options.length;
        out.write(MOVE_UP(1)); // move above hint line
        render();
        out.write(`\n${CLEAR_LINE}  ${DIM}↑↓ move · Enter select${RESET}`);
      } else if (key.name === "down") {
        cursor = (cursor + 1) % options.length;
        out.write(MOVE_UP(1));
        render();
        out.write(`\n${CLEAR_LINE}  ${DIM}↑↓ move · Enter select${RESET}`);
      } else if (key.name === "return") {
        cleanup();
        // Clear hint line and show selection
        out.write(`\r${CLEAR_LINE}`);
        out.write(`  ${GREEN}✓${RESET} ${options[cursor].label}\n\n`);
        resolve(options[cursor].value);
      }
    };

    function cleanup() {
      stdin.removeListener("keypress", onKeypress);
      stdin.setRawMode(wasRaw ?? false);
      stdin.pause();
      out.write(SHOW_CURSOR);
    }

    stdin.on("keypress", onKeypress);
  });
}

// ── Multi select (module picker) ─────────────────────────────────────

export interface MultiOption {
  label: string;
  value: string;
  checked: boolean;
  hint?: string;
  star?: boolean;
}

export function selectMulti(
  title: string,
  options: MultiOption[],
  presets?: Record<string, string[]>,
): Promise<string[]> {
  return new Promise((resolve) => {
    let cursor = 0;
    const out = process.stdout;
    // 3 columns layout
    const cols = 3;
    const rows = Math.ceil(options.length / cols);
    const totalLines = rows;

    function render(first = false) {
      if (!first) {
        out.write(MOVE_UP(totalLines));
      }
      for (let r = 0; r < rows; r++) {
        const parts: string[] = [];
        for (let c = 0; c < cols; c++) {
          const idx = r + c * rows;
          if (idx >= options.length) break;
          const opt = options[idx];
          const isCursor = idx === cursor;
          const check = opt.checked ? `${GREEN}✓${RESET}` : " ";
          const star = opt.star ? `${DIM}★${RESET}` : " ";
          const pointer = isCursor ? `${WHITE}❯${RESET}` : " ";
          const label = isCursor ? `${BOLD}${opt.label}${RESET}` : opt.label;
          parts.push(`${pointer}[${check}]${star}${label.padEnd(16)}`);
        }
        out.write(`${CLEAR_LINE}  ${parts.join("")}\n`);
      }
    }

    out.write(`  ${BOLD}${title}${RESET}\n\n`);
    out.write(HIDE_CURSOR);
    render(true);
    const hintText = presets
      ? `↑↓←→ move · Space toggle · a=all · s=starter · p=prod · Enter done`
      : `↑↓←→ move · Space toggle · Enter done`;
    out.write(`\n${CLEAR_LINE}  ${DIM}${hintText}${RESET}`);

    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    emitKeypressEvents(stdin);

    const onKeypress = (_ch: string, key: { name: string; ctrl?: boolean }) => {
      if (!key) return;
      if (key.ctrl && key.name === "c") {
        cleanup();
        process.exit(0);
      }

      let needRender = false;

      if (key.name === "up") {
        cursor = (cursor - 1 + options.length) % options.length;
        needRender = true;
      } else if (key.name === "down") {
        cursor = (cursor + 1) % options.length;
        needRender = true;
      } else if (key.name === "left") {
        cursor = Math.max(0, cursor - rows);
        needRender = true;
      } else if (key.name === "right") {
        cursor = Math.min(options.length - 1, cursor + rows);
        needRender = true;
      } else if (key.name === "space") {
        options[cursor].checked = !options[cursor].checked;
        needRender = true;
      } else if (key.name === "a" && presets?.all) {
        for (const o of options) o.checked = true;
        needRender = true;
      } else if (key.name === "s" && presets?.starter) {
        const set = new Set(presets.starter);
        for (const o of options) o.checked = set.has(o.value);
        needRender = true;
      } else if (key.name === "p" && presets?.productivity) {
        const set = new Set(presets.productivity);
        for (const o of options) o.checked = o.checked || set.has(o.value);
        needRender = true;
      } else if (key.name === "return") {
        cleanup();
        const selected = options.filter((o) => o.checked);
        out.write(`\r${CLEAR_LINE}`);
        out.write(`  ${GREEN}✓${RESET} ${selected.length} modules selected\n\n`);
        resolve(selected.map((o) => o.value));
      }

      if (needRender) {
        out.write(MOVE_UP(1)); // above hint
        render();
        out.write(`\n${CLEAR_LINE}  ${DIM}${hintText}${RESET}`);
      }
    };

    function cleanup() {
      stdin.removeListener("keypress", onKeypress);
      stdin.setRawMode(wasRaw ?? false);
      stdin.pause();
      out.write(SHOW_CURSOR);
    }

    stdin.on("keypress", onKeypress);
  });
}
