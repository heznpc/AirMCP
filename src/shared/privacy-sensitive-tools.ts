/**
 * Single source of truth for privacy-sensitive READ classification.
 *
 * A "privacy readout" is a read-only tool that returns private user data
 * crossing a privacy boundary — clipboard contents, mail/message content,
 * chat participants (phone/email handles), photo content + EXIF GPS,
 * HealthKit data, precise location, the personal memory store, and the
 * screen / accessibility tree. These must carry `sensitiveHint: true` so
 * they gate under the default `sensitive-only` HITL level.
 *
 * WHY THIS FILE EXISTS — drift control. Per-file annotation edits
 * repeatedly missed siblings (smart_clipboard, memory_query, the mail /
 * photo / chat readers) because the privacy-readout list lived as a
 * hand-maintained array in one test and was sampled, not derived.
 * Centralizing here + the drift-guard tests in
 * tests/safety-annotations.test.js closes that gap:
 *   - forward:    every name here that is registered must be gated;
 *   - reverse:    every registered read-only + sensitive tool must be here
 *                 (so a new sensitive read cannot be added without landing
 *                 in this list);
 *   - anti-drift: any registered read-only tool whose NAME matches an
 *                 obvious privacy pattern below must be here (so a new
 *                 clipboard / photo / health / message reader added
 *                 unmarked fails CI — the smart_clipboard miss).
 *
 * This set is intended to also back the OAuth scope gate once the
 * sensitive→scope propagation (review finding #6) is ratified.
 */
export const PRIVACY_READOUT_TOOLS: ReadonlySet<string> = new Set([
  // clipboard
  "get_clipboard",
  "smart_clipboard",
  // screen / windows / accessibility tree
  "list_all_windows",
  "list_windows",
  "ui_read",
  "ui_traverse",
  "ui_diff",
  "ui_accessibility_query",
  // health (HealthKit reads; registered only where HealthKit is available)
  "health_summary",
  "health_today_steps",
  "health_heart_rate",
  "health_sleep",
  // precise location
  "get_current_location",
  // personal memory store
  "memory_query",
  // mail content
  "read_message",
  "search_messages",
  "list_messages",
  // photos: content + EXIF GPS
  "get_photo_info",
  "search_photos",
  "list_photos",
  "list_favorites",
  "query_photos",
  // messages: chat metadata / participant handles (PII / social graph)
  "list_chats",
  "read_chat",
  "search_chats",
  "list_participants",
]);

/**
 * Tight name patterns for the anti-drift guard. The test asserts every
 * registered READ-ONLY tool whose name matches one of these is present in
 * PRIVACY_READOUT_TOOLS (i.e. curated + gated). A new clipboard / photo /
 * health / location / mail / chat reader added unmarked therefore fails.
 *
 * Deliberately NOT exhaustive — non-obvious readers (memory_query, the ui_*
 * tree) are covered by the explicit set above, and benign read-only tools
 * (memory_stats, get_screen_info) must NOT match here. Keep patterns
 * specific enough that the matched set stays a subset of PRIVACY_READOUT_TOOLS.
 */
export const PRIVACY_READOUT_NAME_PATTERNS: readonly RegExp[] = [
  /clipboard/i,
  /photo/i,
  /(^|_)location(_|$)/i,
  /(^|_)health_/i,
  /(^|_)(message|messages|chat|chats|participant|participants)(_|$)/i,
  /(^|_)(all_)?windows?(_|$)/i,
  /^ui_(read|traverse|diff|accessibility)/i,
];

/**
 * Read-only tools whose NAME matches a privacy pattern above but which are
 * confirmed NOT privacy readouts — keeping the patterns broad (good
 * anti-drift coverage) without false-positive failures. Each entry needs a
 * one-line justification; do not add a tool here to silence a real gap.
 */
export const PRIVACY_PATTERN_EXEMPT: ReadonlySet<string> = new Set([
  "ai_chat", // FoundationModels chat completion — not the Messages chat store
  "share_location", // formats an Apple Maps URL from caller-supplied coords; reads nothing
  "get_location_permission", // returns the CoreLocation authorization flag, not a location
]);
