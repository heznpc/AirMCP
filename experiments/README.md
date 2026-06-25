# experiments/ — ablation experiment code (UNSHIPPED)

This tree is **experiment / companion-layer** code for the defended-vs-undefended ASR
ablation. It is **not** part of the AirMCP product:

- It lives **outside `src/`**, so it never compiles into `dist/`.
- `package.json` publishes only `dist` (`files: ["dist"]`) and the `.mcpb` bundle copies only
  `dist`, so nothing here ships to npm or MCPB. (Enforced by
  `tests/experiment-bypass-tripwire.test.js`.)

## Status: runner-zero (dry plumbing only)

`ablation/` currently contains **measurement-plumbing integrity** only — no evaluation:

- `plan.mjs` — load the ratified baseline instances, build a **static run matrix** (no
  execution), carry each arm's `re_verified` / `sole_primary_data_source`, and flag cells that
  need an installability/safety re-check right before they run (`pre_run_recheck_required`).
- `trial-record.mjs` — the **trial-record format** + metadata fields (outcome buckets,
  `block_source` enum, oracle channels, bypass-in-effect, baseline snapshot). Validated against
  `docs/experiments/schemas/trial-record.schema.json`.

**Explicitly NOT here (still `proposed`):** model calls, real app automation, scenario
execution, scoring, the experiment-layer bypass implementation, and any ASR / result numbers.
Goal of this stage is plumbing integrity, not evaluation results.
