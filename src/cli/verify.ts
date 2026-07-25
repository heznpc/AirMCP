/**
 * `npx airmcp verify` — one-screen honest trust readout for the REAL local
 * audit store (~/.airmcp unless AIRMCP_VECTOR_STORE_DIR overrides).
 *
 * This is the reference consumer of the trust attestation's honesty contract:
 * the one-line verdict it leads with is the key-grade-aware `assurance` tier,
 * never the bare `governed` boolean (which stays true under a re-derivable
 * host-fallback key). When the grade is below operator-attested it prints the
 * exact upgrade path instead of a vague warning.
 *
 * Returns the process exit code: 0 = chain verifies (operator-attested or
 * tamper-evident), 1 = tampered, 2 = audit halted, 3 = verification could not
 * run (store unreadable, writer lock wedged, …) — deliberately distinct from
 * 1 so scripts never mistake an operational failure for tampering.
 */
import { BOLD, DIM, GREEN, RED, RESET, WHITE, YELLOW, SYM } from "./style.js";

export async function runVerify(): Promise<number> {
  // Deferred imports: loading the audit module resolves the chain key and
  // touches the store dir; keep that out of unrelated CLI paths.
  const { buildTrustAttestation } = await import("../shared/resources.js");
  const { operatorKeyFilePath } = await import("../shared/identity-key.js");
  const { PATHS } = await import("../shared/constants.js");

  let config;
  try {
    const { parseConfig } = await import("../shared/config.js");
    config = parseConfig();
  } catch {
    config = undefined; // fresh machine / unreadable config — attest with defaults
  }

  let t;
  try {
    t = await buildTrustAttestation(config);
  } catch (err) {
    console.error(
      `  ${SYM.fail} could not verify: ${err instanceof Error ? err.message : String(err)}\n` +
        `  ${DIM}(store unreadable or audit writer lock unavailable — this is an operational error, NOT a tamper verdict)${RESET}`,
    );
    return 3;
  }

  const line = (label: string, value: string) => console.log(`  ${DIM}${label.padEnd(16)}${RESET}${value}`);

  console.log("");
  console.log(`  ${BOLD}${WHITE}AirMCP verify${RESET} ${DIM}— ${PATHS.VECTOR_STORE}${RESET}`);
  console.log("");

  const assurance =
    t.assurance === "operator-attested"
      ? `${GREEN}operator-attested${RESET}`
      : t.assurance === "tamper-evident"
        ? `${YELLOW}tamper-evident${RESET} ${DIM}(host-derived key — see upgrade below)${RESET}`
        : `${RED}${t.assurance}${RESET}`;
  line("assurance", assurance);

  line(
    "audit chain",
    t.audit.verified
      ? `${GREEN}verified${RESET}`
      : `${RED}BROKEN${RESET} at ${t.audit.firstBreak?.file ?? "?"}:${t.audit.firstBreak?.lineIndex ?? "?"} ${DIM}(${t.audit.firstBreak?.reason ?? "unknown"})${RESET}`,
  );
  if (t.audit.auditDisabled)
    line("audit logging", `${RED}HALTED${RESET} ${DIM}(disk/permission/flush failure)${RESET}`);

  const keySourceDetail =
    t.audit.keySource === "env"
      ? "AIRMCP_AUDIT_HMAC_KEY"
      : t.audit.keySource === "keyfile"
        ? operatorKeyFilePath()
        : "derivable by any local shell";
  line(
    "key",
    `${t.audit.keyGrade === "operator-key" ? GREEN : YELLOW}${t.audit.keyGrade}${RESET} ${DIM}(${t.audit.keySource}: ${keySourceDetail})${RESET}`,
  );

  line("approval", `${t.approval.level} ${DIM}(whitelist ${t.approval.whitelistSize})${RESET}`);
  line("emergency stop", t.rateLimit.emergencyStop ? `${YELLOW}ENGAGED${RESET}` : "off");
  // The boolean is printed last and explicitly demoted: it ignores the key
  // grade, so it must never be quoted as the verdict on its own.
  line("governed", `${t.governed} ${DIM}(ignores key grade — the verdict above is 'assurance')${RESET}`);

  if (t.assurance === "tamper-evident") {
    console.log("");
    console.log(`  ${SYM.warn} ${WHITE}Upgrade to operator-attested:${RESET}`);
    console.log(`    ${DIM}→${RESET} npx airmcp init            ${DIM}generates an operator key file (0600)${RESET}`);
    console.log(
      `    ${DIM}→${RESET} AIRMCP_AUDIT_HMAC_KEY=...  ${DIM}strongest — secret lives outside the store, cross-machine verifiable${RESET}`,
    );
    console.log(
      `    ${DIM}A key change does not re-sign existing rows: archive the current audit*.jsonl + audit.checkpoint first` +
        ` (init refuses to generate a key over a sealed chain), or the old chain will read as tampered.${RESET}`,
    );
  } else if (t.audit.keySource === "keyfile") {
    console.log(
      `  ${DIM}key file is same-user readable — for local non-repudiation move the secret to AIRMCP_AUDIT_HMAC_KEY${RESET}`,
    );
  }
  console.log("");

  return t.assurance === "tampered" ? 1 : t.assurance === "audit-halted" ? 2 : 0;
}
