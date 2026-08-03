#!/usr/bin/env node
/**
 * Remove test-fixture residue from a usage profile (~/.airmcp/profile.json).
 *
 * Historical test/harness runs that escaped disk isolation left fixture tool
 * names (tool_a, tool_b, foo, test_tool, tool_0…) inside a real user
 * profile's `frequency` / `sequences` / `hourly` maps, and the tracker's
 * merge-on-load cycle preserves them forever. Source-side isolation now
 * prevents new leaks (usage-tracker.ts test-mode guard + clean-boot-env);
 * this script cleans up profiles contaminated before that fix.
 *
 * Usage:
 *   node scripts/clean-profile-residue.mjs [path] [--apply]
 *
 *   path     profile to clean (default: ~/.airmcp/profile.json, or
 *            $AIRMCP_USAGE_PROFILE_PATH when set)
 *   --apply  actually rewrite the file (atomic tmp+rename). Without it the
 *            script is a dry run: it only prints what would be removed.
 *
 * Exit codes: 0 = clean or cleaned, 1 = usage / IO / parse error.
 */
import { readFileSync, writeFileSync, renameSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname, basename } from "node:path";

// Fixture names used by the repo's own tests and harnesses. `tool_<simple>`
// deliberately requires a single [a-z0-9] run after the underscore so real
// tools like `tool_session_status` (extra underscore) can never match.
const RESIDUE_RE = /^(tool_[a-z0-9]+|test_tool|foo)$/;
const isResidue = (name) => RESIDUE_RE.test(name);
const sequenceHasResidue = (key) => key.split(" → ").some((part) => isResidue(part.trim()));

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const positional = args.filter((a) => a !== "--apply");
if (positional.length > 1) {
  console.error("usage: node scripts/clean-profile-residue.mjs [path] [--apply]");
  process.exit(1);
}
const profilePath =
  positional[0] ?? process.env.AIRMCP_USAGE_PROFILE_PATH ?? join(homedir(), ".airmcp", "profile.json");

let profile;
try {
  profile = JSON.parse(readFileSync(profilePath, "utf-8"));
} catch (err) {
  console.error(`cannot read profile at ${profilePath}: ${err?.message ?? err}`);
  process.exit(1);
}

const removed = { frequency: [], sequences: [], hourly: [] };
for (const key of Object.keys(profile.frequency ?? {})) {
  if (isResidue(key)) {
    removed.frequency.push(`${key} (${profile.frequency[key]})`);
    delete profile.frequency[key];
  }
}
for (const key of Object.keys(profile.sequences ?? {})) {
  if (sequenceHasResidue(key)) {
    removed.sequences.push(`${key} (${profile.sequences[key]})`);
    delete profile.sequences[key];
  }
}
for (const key of Object.keys(profile.hourly ?? {})) {
  if (isResidue(key)) {
    removed.hourly.push(key);
    delete profile.hourly[key];
  }
}

const totalRemoved = removed.frequency.length + removed.sequences.length + removed.hourly.length;
if (totalRemoved === 0) {
  console.log(`${profilePath}: no test residue found — nothing to do`);
  process.exit(0);
}

console.log(`${profilePath}: ${apply ? "removing" : "would remove (dry run — pass --apply)"}`);
for (const [section, keys] of Object.entries(removed)) {
  for (const key of keys) console.log(`  ${section}: ${key}`);
}

if (apply) {
  const mode = (() => {
    try {
      return statSync(profilePath).mode & 0o777;
    } catch {
      return 0o600;
    }
  })();
  // Atomic same-directory replacement so a crash can never leave a torn file.
  const tempPath = join(dirname(profilePath), `.${basename(profilePath)}.clean.${process.pid}.tmp`);
  writeFileSync(tempPath, JSON.stringify(profile, null, 2), { encoding: "utf-8", mode });
  renameSync(tempPath, profilePath);
  console.log(`cleaned ${totalRemoved} residue entr${totalRemoved === 1 ? "y" : "ies"}`);
}
