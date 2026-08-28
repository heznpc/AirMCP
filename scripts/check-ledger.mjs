#!/usr/bin/env node
/**
 * Ledger integrity gate.
 *
 * docs/ledger.md is the single TODO of record. This check is BLOCKING because
 * this repo already ran the experiment: every item guarded by a CI `--check`
 * is accurate, and every item guarded only by written discipline is stale
 * (docs/RELEASE_CHECKLIST.md §2.5 mandates RFC index upkeep; the index has
 * disagreed with its own RFC bodies since 2026-07-11).
 *
 * It enforces structure, not truth — a ledger entry can still lie. What it
 * does prevent is the failure this ledger replaced: work items regrowing in
 * strategy documents, and entries that cannot be acted on because they carry
 * no runnable verification or no owner default.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LEDGER = join(ROOT, "docs/ledger.md");

const DISPOSITIONS = ["LAND", "FIX", "KILL", "ESCALATE", "AUTOMATE"];
const ACTIVE_LIMIT = 20;

/** Surfaces that previously carried work items and must not carry them again. */
const SINGLETON_SCOPE = [
  "README.md",
  "docs/direction.md",
  "docs/state.md",
  ...(existsSync(join(ROOT, "docs/rfc"))
    ? readdirSync(join(ROOT, "docs/rfc"))
        .filter((f) => f.endsWith(".md"))
        .map((f) => `docs/rfc/${f}`)
    : []),
];

const BACKLOG_HEADING = /^#{2,3}\s*(로드맵|백로그|할\s*일|TODO|Roadmap|Backlog|Todo)\b/im;

const errors = [];
const warnings = [];

function fail(msg) {
  errors.push(msg);
}
function warn(msg) {
  warnings.push(msg);
}

// ---------------------------------------------------------------- ledger file

if (!existsSync(LEDGER)) {
  console.error("✗ docs/ledger.md is missing — it is the TODO of record.");
  process.exit(1);
}

const text = readFileSync(LEDGER, "utf8");
const lines = text.split("\n");

/** Split the ledger into `### L-NNN · title` blocks, ignoring §5 (closed). */
const closedStart = lines.findIndex((l) => /^##\s*§5\b/.test(l));
const body = closedStart === -1 ? lines : lines.slice(0, closedStart);

const entries = [];
let current = null;
for (const line of body) {
  const head = line.match(/^###\s+(L-\d{3})\s*·\s*(.+?)\s*$/);
  if (head) {
    current = { id: head[1], title: head[2], lines: [] };
    entries.push(current);
    continue;
  }
  if (/^##\s/.test(line)) current = null;
  if (current) current.lines.push(line);
}

if (entries.length === 0) {
  fail("원장에 활성 항목이 하나도 파싱되지 않았습니다 — §0.2 형식을 확인하세요.");
}

const seen = new Set();
for (const e of entries) {
  const blob = e.lines.join("\n");
  const at = `${e.id} (${e.title})`;

  if (seen.has(e.id)) fail(`${at}: 중복된 항목 ID입니다.`);
  seen.add(e.id);

  const field = (name) => {
    const m = blob.match(new RegExp(`\\*\\*${name}\\*\\*\\s*:\\s*([^\\n·]+)`));
    return m ? m[1].trim() : null;
  };

  const disposition = field("처분");
  if (!disposition) {
    fail(`${at}: **처분** 필드가 없습니다.`);
  } else if (!DISPOSITIONS.includes(disposition)) {
    fail(`${at}: 처분 "${disposition}"은 ${DISPOSITIONS.join("/")} 중 하나가 아닙니다.`);
  }

  const gate = field("게이트");
  if (!gate) fail(`${at}: **게이트** 필드가 없습니다.`);
  else if (!/^G[1-4]$/.test(gate)) fail(`${at}: 게이트 "${gate}"는 G1~G4가 아닙니다.`);

  if (!/\*\*기한\*\*/.test(blob)) fail(`${at}: **기한** 필드가 없습니다.`);

  // 근거: must cite something searchable, not a bare line number.
  const evidence = blob.match(/\*\*근거\*\*\s*:\s*([\s\S]*?)(?=\n-\s\*\*|\n*$)/);
  if (!evidence) {
    fail(`${at}: **근거** 필드가 없습니다.`);
  } else {
    const ev = evidence[1];
    if (!/`[^`]+`/.test(ev)) {
      fail(`${at}: 근거에 검색 가능한 심볼·문자열이 백틱으로 없습니다. ` + `줄번호 단독 인용은 §0.2가 금지합니다.`);
    }
    if (/:\d+/.test(ev) && !/`[^`]*[A-Za-z_][^`]*`/.test(ev)) {
      fail(`${at}: 근거가 줄번호에만 의존합니다. 심볼명이나 파일명을 함께 적으세요.`);
    }
  }

  // 검증: must be a runnable command.
  const verify = blob.match(/\*\*검증\*\*\s*:\s*`?\$?\s*([^\n`]*)/);
  if (!verify) {
    fail(`${at}: **검증** 필드가 없습니다 — 그대로 돌릴 수 있는 명령이어야 합니다.`);
  } else if (!/\*\*검증\*\*\s*:\s*`\$/.test(blob)) {
    fail(`${at}: 검증 명령은 백틱 안에서 \`$\`로 시작해야 합니다.`);
  } else if (verify[1].trim().length < 5) {
    fail(`${at}: 검증 명령이 비어 있습니다.`);
  }

  // ESCALATE contract: question + default + deadline.
  if (disposition === "ESCALATE") {
    if (!/\*\*질문\*\*/.test(blob)) fail(`${at}: ESCALATE에 **질문**이 없습니다 (§0.3).`);
    if (!/\*\*기본값\*\*/.test(blob)) fail(`${at}: ESCALATE에 **기본값**이 없습니다 (§0.3).`);
    const deadline = blob.match(/\*\*기한\*\*\s*:\s*([^\n·]+)/);
    if (deadline && /^\s*-\s*$/.test(deadline[1])) {
      fail(`${at}: ESCALATE의 기한이 "-"입니다. 날짜나 "상주"를 적으세요 (§0.3).`);
    }
  }
}

if (entries.length > ACTIVE_LIMIT) {
  warn(`활성 항목이 ${entries.length}개로 상한 ${ACTIVE_LIMIT}을 넘었습니다 (§0.7). ` + `차단하지는 않습니다.`);
}

// ---------------------------------------------------- cross-reference integrity

const known = new Set(entries.map((e) => e.id));
for (const m of text.matchAll(/\bL-\d{3}\b/g)) {
  if (!known.has(m[0]) && !text.includes(`### ${m[0]} ·`)) {
    fail(`존재하지 않는 항목 ${m[0]}을 참조합니다.`);
  }
}

// ------------------------------------------------------- singleton enforcement

for (const rel of SINGLETON_SCOPE) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) continue;
  const content = readFileSync(abs, "utf8");
  const hit = content.split("\n").find((l) => BACKLOG_HEADING.test(l));
  if (hit) {
    fail(`${rel}: 작업 항목 절이 다시 생겼습니다 — "${hit.trim()}". ` + `TODO는 docs/ledger.md에만 존재합니다 (§6.4).`);
  }
}

// --------------------------------------------------------- numbers discipline

const statsScript = join(ROOT, "scripts/count-stats.mjs");
if (existsSync(statsScript)) {
  const stats = readFileSync(statsScript, "utf8");
  for (const rel of ["docs/direction.md", "docs/state.md"]) {
    const abs = join(ROOT, rel);
    if (!existsSync(abs)) continue;
    const content = readFileSync(abs, "utf8");
    // A markdown table row whose cell is a bare 2-4 digit count reads as a stat table.
    const statRow = content.split("\n").find((l) => /^\|[^|]+\|\s*\d{2,4}\s*(\(|\|)/.test(l));
    if (statRow && !stats.includes(rel)) {
      fail(
        `${rel}: 수치표가 있는데 count-stats.mjs의 syncFile 대상이 아닙니다 — ` +
          `"${statRow.trim().slice(0, 60)}". 수치를 지우거나 syncFile에 등록하세요 (§6.3).`,
      );
    }
  }
}

// -------------------------------------------------------------------- report

for (const w of warnings) console.warn(`⚠ ${w}`);

if (errors.length > 0) {
  console.error(`\n✗ 원장 검사 실패 — ${errors.length}건\n`);
  for (const e of errors) console.error(`  · ${e}`);
  console.error(`\n규칙: ${relative(ROOT, LEDGER)} §0\n`);
  process.exit(1);
}

console.log(`✓ 원장 검사 통과 — 활성 ${entries.length}건, 단일 정본 ${SINGLETON_SCOPE.length}개 표면 확인`);
