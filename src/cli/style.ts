/**
 * Shared CLI style constants + spinner utility.
 * All CLI output goes through these for a consistent look.
 */

// ── ANSI codes ───────────────────────────────────────────────────────

export const DIM = "\x1b[2m";
export const RESET = "\x1b[0m";
export const BOLD = "\x1b[1m";
export const WHITE = "\x1b[97m";
export const GREEN = "\x1b[32m";
export const RED = "\x1b[31m";
export const YELLOW = "\x1b[33m";
export const CYAN = "\x1b[36m";
export const HIDE_CURSOR = "\x1b[?25l";
export const SHOW_CURSOR = "\x1b[?25h";
export const CLEAR_LINE = "\x1b[2K\r";
export const MOVE_UP = (n: number) => `\x1b[${n}A`;

// ── Symbols ──────────────────────────────────────────────────────────

export const SYM = {
  ok:   `${GREEN}✓${RESET}`,
  fail: `${RED}✗${RESET}`,
  warn: `${YELLOW}⚠${RESET}`,
  dot:  `${DIM}·${RESET}`,
  arr:  `${WHITE}❯${RESET}`,
  bar:  `${DIM}│${RESET}`,
} as const;

// ── Box drawing ──────────────────────────────────────────────────────

export function heading(text: string): string {
  return `\n  ${BOLD}${WHITE}${text}${RESET}\n`;
}

export function subheading(text: string): string {
  return `  ${BOLD}${text}${RESET}`;
}

export function line(icon: string, label: string, detail: string, labelWidth = 22): string {
  return `  ${icon} ${label.padEnd(labelWidth)} ${DIM}${detail}${RESET}`;
}

export function divider(): string {
  return `  ${DIM}${"─".repeat(50)}${RESET}`;
}

// ── Spinner ──────────────────────────────────────────────────────────

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export class Spinner {
  private interval: ReturnType<typeof setInterval> | null = null;
  private frame = 0;
  private text: string;

  constructor(text: string) {
    this.text = text;
  }

  start(): this {
    process.stdout.write(HIDE_CURSOR);
    this.interval = setInterval(() => {
      const f = SPINNER_FRAMES[this.frame % SPINNER_FRAMES.length];
      process.stdout.write(`${CLEAR_LINE}  ${CYAN}${f}${RESET} ${this.text}`);
      this.frame++;
    }, 80);
    return this;
  }

  update(text: string): void {
    this.text = text;
  }

  succeed(text?: string): void {
    this.stop();
    console.log(`  ${SYM.ok} ${text ?? this.text}`);
  }

  fail(text?: string): void {
    this.stop();
    console.log(`  ${SYM.fail} ${text ?? this.text}`);
  }

  warn(text?: string): void {
    this.stop();
    console.log(`  ${SYM.warn} ${text ?? this.text}`);
  }

  private stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    process.stdout.write(`${CLEAR_LINE}${SHOW_CURSOR}`);
  }
}

export function spinner(text: string): Spinner {
  return new Spinner(text).start();
}

// ── Sleep ────────────────────────────────────────────────────────────

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
