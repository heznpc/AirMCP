import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import { createMockServer } from './helpers/mock-server.js';
import { createMockConfig } from './helpers/mock-config.js';

const mockFetch = jest.fn();
global.fetch = mockFetch;

const { triggerCloudFlow, CloudFlowError } = await import('../dist/powerautomate/api.js');
const { registerPowerAutomateTools } = await import('../dist/powerautomate/tools.js');

beforeEach(() => {
  mockFetch.mockReset();
});

describe('triggerCloudFlow (api)', () => {
  test('sends OAuth bearer header and returns parsed body', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ runId: 'abc' }), {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
      }),
    );

    const result = await triggerCloudFlow({
      url: 'https://example.logic.azure.com/flow',
      auth: { type: 'oauth', bearer: 'token123' },
      body: { items: [1, 2] },
      timeoutMs: 5000,
      maxResponseBytes: 1024 * 1024,
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ runId: 'abc' });

    const [, init] = mockFetch.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe('Bearer token123');
    expect(JSON.parse(init.body)).toEqual({ items: [1, 2] });
  });

  test('SAS auth sends no authorization header', async () => {
    mockFetch.mockResolvedValue(new Response('{}', { status: 200, statusText: 'OK' }));
    await triggerCloudFlow({
      url: 'https://example.logic.azure.com/flow?sig=xyz',
      auth: { type: 'sas' },
      timeoutMs: 5000,
      maxResponseBytes: 1024 * 1024,
    });
    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers.authorization).toBeUndefined();
  });

  test('caps an oversized response body and flags truncation', async () => {
    const big = 'a'.repeat(5000);
    mockFetch.mockResolvedValue(new Response(big, { status: 200, statusText: 'OK' }));

    const result = await triggerCloudFlow({
      url: 'https://example.logic.azure.com/flow',
      auth: { type: 'sas' },
      timeoutMs: 5000,
      maxResponseBytes: 1000,
    });

    expect(result.truncated).toBe(true);
    expect(typeof result.body).toBe('string');
    expect(result.body.length).toBe(1000);
  });

  test('non-2xx status is returned, not thrown', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: 'bad' }), { status: 400, statusText: 'Bad Request' }),
    );
    const result = await triggerCloudFlow({
      url: 'https://example.logic.azure.com/flow',
      auth: { type: 'sas' },
      timeoutMs: 5000,
      maxResponseBytes: 1024,
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
  });

  test('network failure throws CloudFlowError (aborted=false)', async () => {
    mockFetch.mockRejectedValue(new TypeError('fetch failed'));
    await expect(
      triggerCloudFlow({
        url: 'https://example.logic.azure.com/flow',
        auth: { type: 'sas' },
        timeoutMs: 5000,
        maxResponseBytes: 1024,
      }),
    ).rejects.toBeInstanceOf(CloudFlowError);
  });

  test('an unparseable URL fails generically without leaking the sig secret', async () => {
    // Bypasses the tool's Zod url() guard (as another caller could): a URL that
    // fails WHATWG parsing must not echo its sig into the error message.
    const leaky = 'http://exa mple.com/flow?sig=SUPERSECRET';
    let caught;
    try {
      await triggerCloudFlow({
        url: leaky,
        auth: { type: 'sas' },
        timeoutMs: 1000,
        maxResponseBytes: 1024,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(CloudFlowError);
    expect(caught.message).toBe('Invalid Cloud Flow URL');
    expect(caught.message).not.toContain('SUPERSECRET');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('abort surfaces as CloudFlowError with aborted=true', async () => {
    mockFetch.mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const e = new Error('aborted');
          e.name = 'AbortError';
          reject(e);
        });
      });
    });
    const p = triggerCloudFlow({
      url: 'https://example.logic.azure.com/flow',
      auth: { type: 'sas' },
      timeoutMs: 20,
      maxResponseBytes: 1024,
    });
    await expect(p).rejects.toMatchObject({ aborted: true });
  });
});

describe('cloudflow_trigger (tool)', () => {
  let server, config;
  beforeEach(() => {
    server = createMockServer();
    config = createMockConfig();
    registerPowerAutomateTools(server, config);
  });

  test('registers cloudflow_trigger with destructive/openWorld annotations', () => {
    const tool = server._tools.get('cloudflow_trigger');
    expect(tool).toBeDefined();
    expect(tool.opts.annotations.destructiveHint).toBe(true);
    expect(tool.opts.annotations.openWorldHint).toBe(true);
  });

  test('success returns a non-error result carrying the status', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ runId: 'r1' }), { status: 202, statusText: 'Accepted' }),
    );
    const result = await server.callTool('cloudflow_trigger', {
      url: 'https://example.logic.azure.com/flow',
      auth: { type: 'sas' },
      timeoutMs: 5000,
      maxResponseBytes: 1024 * 1024,
    });
    expect(result.isError).toBeFalsy();
    expect(JSON.stringify(result)).toContain('202');
  });

  test('non-2xx flow response yields an error result', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: 'nope' }), { status: 403, statusText: 'Forbidden' }),
    );
    const result = await server.callTool('cloudflow_trigger', {
      url: 'https://example.logic.azure.com/flow',
      auth: { type: 'sas' },
      timeoutMs: 5000,
      maxResponseBytes: 1024,
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('403');
  });
});
