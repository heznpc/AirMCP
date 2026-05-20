/**
 * Regression test for the toolError → errJxaFor / errAppleScriptFor
 * migration in the 5 modules called out by the 2026-05-13 audit:
 *
 *   safari, messages, pages, keynote, podcasts
 *
 * Before the migration, every catch block in these modules returned
 * `toolError("action", e)` which classifies the error by message text
 * alone — no `cause.origin` field. The audit asked to migrate to
 * `errJxaFor` / `errAppleScriptFor` so each tool's structuredContent
 * carries `cause.origin: "jxa"` or `"applescript"`. That tag lets
 * audit / telemetry / log analysers split bridge failures by dialect,
 * which the catch-all `toolError` path obscured.
 *
 * This test forces each handler's catch path (by mocking runJxa /
 * runAppleScript to reject) and asserts the structured envelope has
 * the right origin tag. If a future refactor accidentally drops the
 * `For` suffix or reverts to `toolError`, the assertion fires.
 *
 * audit/tools.ts deliberately keeps `toolError()` — its catch wraps
 * pure-JS work (`readAuditEntries`, `summarizeAuditEntries`), not a
 * bridge call. A negative-space assertion in this file would couple
 * to private internals; the migration grep in the docs covers that
 * boundary instead.
 */
import { describe, test, expect, jest, beforeEach } from '@jest/globals';

const mockRunJxa = jest.fn();
const mockRunAppleScript = jest.fn();
jest.unstable_mockModule('../dist/shared/jxa.js', () => ({
  runJxa: mockRunJxa,
  runAppleScript: mockRunAppleScript,
}));

// send_file / send_message gate themselves behind this env. Open it so
// the catch path is reachable.
process.env.AIRMCP_ALLOW_SEND_MESSAGES = 'true';

const { registerSafariTools } = await import('../dist/safari/tools.js');
const { registerMessagesTools } = await import('../dist/messages/tools.js');
const { registerPagesTools } = await import('../dist/pages/tools.js');
const { registerKeynoteTools } = await import('../dist/keynote/tools.js');
const { registerPodcastsTools } = await import('../dist/podcasts/tools.js');

function createMockServer() {
  const tools = new Map();
  return {
    registerTool(name, config, handler) {
      tools.set(name, { config, handler });
    },
    tools,
    async callTool(name, args = {}) {
      const tool = tools.get(name);
      if (!tool) throw new Error(`Tool ${name} not registered`);
      return tool.handler(args);
    },
  };
}

/**
 * Drive every JXA-bound tool in a module and assert origin tagging.
 * Returns immediately if the module exposes zero tools — the helper is
 * defensive against future module renames.
 */
async function assertOriginForModule({ register, expectedOrigin, sampleArgs, mock }) {
  const server = createMockServer();
  register(server, {});
  expect(server.tools.size).toBeGreaterThan(0);
  let asserted = 0;
  for (const [name, { handler }] of server.tools) {
    // Force the bridge to throw so we land in the JXA/AppleScript catch
    // path. The catch is the contract we're pinning — earlier exits
    // (zod failure, allowed-network refusal, errPermission, errDeprecated,
    // errInvalidInput) deliberately don't carry `cause.origin` because
    // they never reached the bridge.
    mock.mockReset();
    mock.mockRejectedValue(new Error(`forced ${expectedOrigin} failure for ${name}`));
    const args = sampleArgs[name] ?? {};
    let result;
    try {
      result = await handler(args);
    } catch (e) {
      throw new Error(`${name}: handler threw instead of returning structured error: ${e.message ?? e}`);
    }
    // Only assert when the bridge was actually reached. A handler that
    // returned isError BEFORE invoking the mock fell through a pre-flight
    // gate — origin tagging doesn't apply to that path.
    if (!result?.isError) continue;
    if (mock.mock.calls.length === 0) continue;
    const origin = result.structuredContent?.error?.cause?.origin;
    expect(origin).toBe(expectedOrigin);
    asserted++;
  }
  // Guard against the whole module silently bypassing the bridge — if
  // zero handlers reached the catch, the test would pass vacuously and
  // miss a regression where every handler short-circuited.
  expect(asserted).toBeGreaterThan(0);
}

beforeEach(() => {
  mockRunJxa.mockReset();
  mockRunAppleScript.mockReset();
});

describe('toolError migration — cause.origin tagging', () => {
  test('safari/tools.ts: every JXA catch returns origin="jxa"', async () => {
    await assertOriginForModule({
      register: registerSafariTools,
      expectedOrigin: 'jxa',
      mock: mockRunJxa,
      // Most safari tools take {windowIndex, tabIndex, url, ...}. Pass a
      // generous default so zod doesn't short-circuit before the bridge.
      sampleArgs: {
        read_page_content: { windowIndex: 1, tabIndex: 1 },
        open_url: { url: 'https://example.com' },
        close_tab: { windowIndex: 1, tabIndex: 1 },
        activate_tab: { windowIndex: 1, tabIndex: 1 },
        run_javascript: { code: 'null', windowIndex: 1, tabIndex: 1 },
        search_tabs: { query: 'x' },
        add_to_reading_list: { url: 'https://example.com' },
      },
    });
  });

  test('messages/tools.ts: JXA tools tag "jxa", AppleScript tools tag "applescript"', async () => {
    // JXA half — list_chats / read_chat / search_chats / list_participants.
    // `allowSendMessages` is captured from config at registration time —
    // open it here so the send_* handlers reach the AppleScript catch
    // path rather than short-circuiting on `errPermission`.
    const jxaServer = createMockServer();
    registerMessagesTools(jxaServer, { allowSendMessages: true });
    let jxaAsserted = 0;
    for (const name of ['list_chats', 'read_chat', 'search_chats', 'list_participants']) {
      mockRunJxa.mockReset();
      mockRunJxa.mockRejectedValue(new Error(`forced jxa failure for ${name}`));
      const { handler } = jxaServer.tools.get(name);
      const args = name === 'list_chats' ? { limit: 5 } : { chatId: 'x', query: 'x', limit: 5 };
      const result = await handler(args);
      if (!result?.isError || mockRunJxa.mock.calls.length === 0) continue;
      expect(result.structuredContent?.error?.cause?.origin).toBe('jxa');
      jxaAsserted++;
    }
    expect(jxaAsserted).toBeGreaterThan(0);
    // AppleScript half — send_message / send_file. These pass through
    // resolveAndGuard for the filePath case, which would reject /tmp/x
    // BEFORE reaching the AppleScript bridge. Point send_file at a path
    // inside HOME so the symlink guard passes and the bridge mock fires.
    const homePathInsideHome = `${process.env.HOME}/.airmcp_test_marker_${Date.now()}`;
    let asAsserted = 0;
    for (const name of ['send_message', 'send_file']) {
      mockRunAppleScript.mockReset();
      mockRunAppleScript.mockRejectedValue(new Error(`forced applescript failure for ${name}`));
      const { handler } = jxaServer.tools.get(name);
      const args =
        name === 'send_message'
          ? { target: '+15555550100', text: 'hi' }
          : { target: '+15555550100', filePath: homePathInsideHome };
      const result = await handler(args);
      if (!result?.isError || mockRunAppleScript.mock.calls.length === 0) continue;
      expect(result.structuredContent?.error?.cause?.origin).toBe('applescript');
      asAsserted++;
    }
    expect(asAsserted).toBeGreaterThan(0);
  });

  test('pages/tools.ts: every JXA catch returns origin="jxa"', async () => {
    await assertOriginForModule({
      register: registerPagesTools,
      expectedOrigin: 'jxa',
      mock: mockRunJxa,
      sampleArgs: {
        open_pages_document: { path: '/tmp/x.pages' },
        get_pages_body_text: { document: 'x' },
        set_pages_body_text: { document: 'x', text: 'y' },
        export_pages_to_pdf: { document: 'x', outputPath: '/tmp/x.pdf' },
        close_pages_document: { document: 'x', saving: 'yes' },
      },
    });
  });

  test('keynote/tools.ts: every JXA catch returns origin="jxa"', async () => {
    await assertOriginForModule({
      register: registerKeynoteTools,
      expectedOrigin: 'jxa',
      mock: mockRunJxa,
      sampleArgs: {
        list_keynote_slides: { document: 'x' },
        get_keynote_slide: { document: 'x', slideNumber: 1 },
        add_keynote_slide: { document: 'x' },
        set_keynote_presenter_notes: { document: 'x', slideNumber: 1, notes: 'n' },
        export_keynote_to_pdf: { document: 'x', outputPath: '/tmp/x.pdf' },
        start_keynote_slideshow: { document: 'x' },
        close_keynote_document: { document: 'x', saving: 'yes' },
      },
    });
  });

  test('podcasts/tools.ts: every JXA catch returns origin="jxa"', async () => {
    await assertOriginForModule({
      register: registerPodcastsTools,
      expectedOrigin: 'jxa',
      mock: mockRunJxa,
      sampleArgs: {
        list_podcast_episodes: { showName: 'x', limit: 5 },
        control_podcast_playback: { action: 'play' },
        play_podcast_episode: { episodeName: 'x', showName: 'y' },
        search_podcast_episodes: { query: 'x', limit: 5 },
      },
    });
  });
});
