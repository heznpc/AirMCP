import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { createHmac } from 'node:crypto';

// Integration-style but fully hermetic: we start a real loopback listener on an
// ephemeral port (0) and drive it with the process's global fetch. No network
// beyond 127.0.0.1, no external services.
const {
  startWebhookListener,
  stopWebhookListener,
  getWebhookListenerStatus,
  _resetWebhookListenerForTests,
} = await import('../dist/webhooks/listener.js');
const { eventBus } = await import('../dist/shared/event-bus.js');

function sign(secret, body) {
  return createHmac('sha256', secret).update(Buffer.from(body)).digest('hex');
}

async function startOnEphemeral(overrides = {}) {
  return startWebhookListener({
    endpointPath: '/webhook',
    port: 0,
    bindHost: '127.0.0.1',
    maxBodyBytes: 1024 * 1024,
    ...overrides,
  });
}

describe('webhook listener', () => {
  afterEach(async () => {
    await stopWebhookListener();
    _resetWebhookListenerForTests();
  });

  test('valid POST emits webhook_received and returns 202', async () => {
    const status = await startOnEphemeral();
    expect(status.running).toBe(true);
    const port = status.boundPort;

    const events = [];
    const onEvent = (e) => events.push(e);
    eventBus.on('webhook_received', onEvent);

    const res = await fetch(`http://127.0.0.1:${port}/webhook`, {
      method: 'POST',
      body: JSON.stringify({ hello: 'world' }),
    });
    // let the event loop flush the emit
    await new Promise((r) => setTimeout(r, 10));
    eventBus.off('webhook_received', onEvent);

    expect(res.status).toBe(202);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('webhook_received');
    expect(events[0].data.path).toBe('/webhook');
    expect(JSON.parse(events[0].data.body)).toEqual({ hello: 'world' });
    expect(getWebhookListenerStatus().hits).toBe(1);
  });

  test('wrong path or method returns 404 and emits nothing', async () => {
    const status = await startOnEphemeral();
    const port = status.boundPort;
    const events = [];
    const onEvent = (e) => events.push(e);
    eventBus.on('webhook_received', onEvent);

    const wrongPath = await fetch(`http://127.0.0.1:${port}/nope`, { method: 'POST', body: '{}' });
    const wrongMethod = await fetch(`http://127.0.0.1:${port}/webhook`, { method: 'GET' });
    await new Promise((r) => setTimeout(r, 10));
    eventBus.off('webhook_received', onEvent);

    expect(wrongPath.status).toBe(404);
    expect(wrongMethod.status).toBe(404);
    expect(events).toHaveLength(0);
  });

  test('HMAC: valid signature accepted, missing/invalid rejected with 401', async () => {
    const secret = 'x'.repeat(40);
    const status = await startOnEphemeral({ expectedSecret: secret });
    const port = status.boundPort;
    expect(status.hmac).toBe(true);

    const events = [];
    const onEvent = (e) => events.push(e);
    eventBus.on('webhook_received', onEvent);

    const body = JSON.stringify({ ok: true });

    const noSig = await fetch(`http://127.0.0.1:${port}/webhook`, { method: 'POST', body });
    expect(noSig.status).toBe(401);

    const badSig = await fetch(`http://127.0.0.1:${port}/webhook`, {
      method: 'POST',
      headers: { 'x-airmcp-signature': 'deadbeef' },
      body,
    });
    expect(badSig.status).toBe(401);

    const goodSig = await fetch(`http://127.0.0.1:${port}/webhook`, {
      method: 'POST',
      headers: { 'x-airmcp-signature': sign(secret, body) },
      body,
    });
    expect(goodSig.status).toBe(202);

    await new Promise((r) => setTimeout(r, 10));
    eventBus.off('webhook_received', onEvent);
    expect(events).toHaveLength(1);
  });

  test('oversize body returns 413 and emits nothing', async () => {
    const status = await startOnEphemeral({ maxBodyBytes: 1024 });
    const port = status.boundPort;
    const events = [];
    const onEvent = (e) => events.push(e);
    eventBus.on('webhook_received', onEvent);

    const res = await fetch(`http://127.0.0.1:${port}/webhook`, {
      method: 'POST',
      body: 'a'.repeat(4096),
    });
    await new Promise((r) => setTimeout(r, 10));
    eventBus.off('webhook_received', onEvent);

    expect(res.status).toBe(413);
    expect(events).toHaveLength(0);
  });

  test('signature and authorization headers are redacted from the event payload', async () => {
    const secret = 'y'.repeat(40);
    const status = await startOnEphemeral({ expectedSecret: secret });
    const port = status.boundPort;
    const events = [];
    const onEvent = (e) => events.push(e);
    eventBus.on('webhook_received', onEvent);

    const body = JSON.stringify({ a: 1 });
    await fetch(`http://127.0.0.1:${port}/webhook`, {
      method: 'POST',
      headers: {
        'x-airmcp-signature': sign(secret, body),
        authorization: 'Bearer super-secret',
        'x-custom': 'keep-me',
      },
      body,
    });
    await new Promise((r) => setTimeout(r, 10));
    eventBus.off('webhook_received', onEvent);

    const headers = events[0].data.headers;
    expect(headers['x-airmcp-signature']).toBeUndefined();
    expect(headers['authorization']).toBeUndefined();
    expect(headers['x-custom']).toBe('keep-me');
  });

  test('non-loopback bind without a secret is refused', async () => {
    await expect(
      startWebhookListener({
        endpointPath: '/webhook',
        port: 0,
        bindHost: '0.0.0.0',
        maxBodyBytes: 1024,
      }),
    ).rejects.toThrow(/requires expectedSecret|without an HMAC secret/i);
    expect(getWebhookListenerStatus().running).toBe(false);
  });

  test('starting a second listener while one runs is rejected', async () => {
    await startOnEphemeral();
    await expect(startOnEphemeral()).rejects.toThrow(/already running/i);
  });

  test('two concurrent starts: exactly one wins, the survivor stays running', async () => {
    const results = await Promise.allSettled([startOnEphemeral(), startOnEphemeral()]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(getWebhookListenerStatus().running).toBe(true);
  });

  test('stop is idempotent', async () => {
    await startOnEphemeral();
    const a = await stopWebhookListener();
    const b = await stopWebhookListener();
    expect(a.running).toBe(false);
    expect(b.running).toBe(false);
  });

  test('stop() during the start window does not orphan a live listener', async () => {
    // Fire start but do NOT await it — stop() lands while `starting` is true and
    // `server` is still null (mid-bind). The pending listen callback must honor
    // the stop and close the socket rather than coming up live and untracked.
    const startP = startOnEphemeral();
    const stopResult = await stopWebhookListener();
    const startStatus = await startP;
    // give the listen callback a tick to run its stopRequested branch
    await new Promise((r) => setTimeout(r, 20));

    expect(stopResult.running).toBe(false);
    expect(startStatus.running).toBe(false);
    expect(getWebhookListenerStatus().running).toBe(false);
  });
});
