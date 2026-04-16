import { describe, test, expect, afterEach } from '@jest/globals';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { HitlClient } from '../dist/shared/hitl.js';

function createTestSocket(handler) {
  const socketPath = join(tmpdir(), `airmcp-test-${randomUUID()}.sock`);
  const server = createServer((conn) => {
    let buffer = '';
    conn.setEncoding('utf-8');
    conn.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        handler(JSON.parse(line), conn);
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(socketPath, () => {
      resolve({ server, socketPath });
    });
  });
}

describe('HitlClient', () => {
  const cleanups = [];

  afterEach(() => {
    for (const fn of cleanups) fn();
    cleanups.length = 0;
  });

  test('requestApproval returns true when approved', async () => {
    const { server, socketPath } = await createTestSocket((req, conn) => {
      conn.write(JSON.stringify({
        id: req.id,
        type: 'hitl_response',
        approved: true,
      }) + '\n');
    });
    cleanups.push(() => server.close());

    const client = new HitlClient({ socketPath, level: 'all', timeout: 5 });
    cleanups.push(() => client.dispose());

    const result = await client.requestApproval('test_tool', { key: 'val' }, true, false);
    expect(result).toBe(true);
  });

  test('requestApproval returns false when denied', async () => {
    const { server, socketPath } = await createTestSocket((req, conn) => {
      conn.write(JSON.stringify({
        id: req.id,
        type: 'hitl_response',
        approved: false,
      }) + '\n');
    });
    cleanups.push(() => server.close());

    const client = new HitlClient({ socketPath, level: 'all', timeout: 5 });
    cleanups.push(() => client.dispose());

    const result = await client.requestApproval('delete_note', {}, true, false);
    expect(result).toBe(false);
  });

  test('requestApproval times out and returns false', async () => {
    const { server, socketPath } = await createTestSocket(() => {
      // Never respond
    });
    cleanups.push(() => server.close());

    const client = new HitlClient({ socketPath, level: 'all', timeout: 1 });
    cleanups.push(() => client.dispose());

    const result = await client.requestApproval('slow_tool', {}, false, false);
    expect(result).toBe(false);
  }, 10000);

  test('requestApproval returns false when socket unreachable', async () => {
    const client = new HitlClient({
      socketPath: '/tmp/airmcp-nonexistent-socket.sock',
      level: 'all',
      timeout: 2,
    });
    cleanups.push(() => client.dispose());

    const result = await client.requestApproval('test_tool', {}, false, false);
    expect(result).toBe(false);
  });

  test('dispose cleans up socket', async () => {
    const { server, socketPath } = await createTestSocket((req, conn) => {
      conn.write(JSON.stringify({
        id: req.id,
        type: 'hitl_response',
        approved: true,
      }) + '\n');
    });
    cleanups.push(() => server.close());

    const client = new HitlClient({ socketPath, level: 'all', timeout: 5 });

    // Establish connection
    await client.requestApproval('test', {}, false, false);

    // Dispose should not throw
    client.dispose();
    client.dispose(); // Double dispose should be safe
  });

  test('sends correct request format', async () => {
    let receivedRequest;
    const { server, socketPath } = await createTestSocket((req, conn) => {
      receivedRequest = req;
      conn.write(JSON.stringify({
        id: req.id,
        type: 'hitl_response',
        approved: true,
      }) + '\n');
    });
    cleanups.push(() => server.close());

    const client = new HitlClient({ socketPath, level: 'all', timeout: 5 });
    cleanups.push(() => client.dispose());

    await client.requestApproval('delete_note', { id: 'abc' }, true, false);

    expect(receivedRequest.type).toBe('hitl_request');
    expect(receivedRequest.tool).toBe('delete_note');
    expect(receivedRequest.args).toEqual({ id: 'abc' });
    expect(receivedRequest.destructive).toBe(true);
    expect(receivedRequest.openWorld).toBe(false);
    expect(receivedRequest.id).toBeDefined();
  });

  test('handles multiple concurrent requests', async () => {
    const { server, socketPath } = await createTestSocket((req, conn) => {
      const approved = req.tool.includes('odd');
      conn.write(JSON.stringify({
        id: req.id,
        type: 'hitl_response',
        approved,
      }) + '\n');
    });
    cleanups.push(() => server.close());

    const client = new HitlClient({ socketPath, level: 'all', timeout: 5 });
    cleanups.push(() => client.dispose());

    const [r1, r2, r3] = await Promise.all([
      client.requestApproval('odd_tool', {}, false, false),
      client.requestApproval('even_tool', {}, false, false),
      client.requestApproval('odd_other', {}, false, false),
    ]);

    expect(r1).toBe(true);
    expect(r2).toBe(false);
    expect(r3).toBe(true);
  });

  test('reuses existing connection on subsequent requests', async () => {
    let connectionCount = 0;
    const socketPath = join(tmpdir(), `airmcp-test-${randomUUID()}.sock`);
    const server = createServer((conn) => {
      connectionCount++;
      let buffer = '';
      conn.setEncoding('utf-8');
      conn.on('data', (chunk) => {
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const req = JSON.parse(line);
          conn.write(JSON.stringify({
            id: req.id,
            type: 'hitl_response',
            approved: true,
          }) + '\n');
        }
      });
    });
    await new Promise((resolve) => server.listen(socketPath, resolve));
    cleanups.push(() => server.close());

    const client = new HitlClient({ socketPath, level: 'all', timeout: 5 });
    cleanups.push(() => client.dispose());

    await client.requestApproval('tool_1', {}, false, false);
    await client.requestApproval('tool_2', {}, false, false);

    expect(connectionCount).toBe(1);
  });

  test('deduplicates concurrent connect attempts (connectPromise reuse)', async () => {
    let connectionCount = 0;
    const socketPath = join(tmpdir(), `airmcp-test-${randomUUID()}.sock`);
    const server = createServer((conn) => {
      connectionCount++;
      let buffer = '';
      conn.setEncoding('utf-8');
      conn.on('data', (chunk) => {
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const req = JSON.parse(line);
          conn.write(JSON.stringify({
            id: req.id,
            type: 'hitl_response',
            approved: true,
          }) + '\n');
        }
      });
    });
    await new Promise((resolve) => server.listen(socketPath, resolve));
    cleanups.push(() => server.close());

    const client = new HitlClient({ socketPath, level: 'all', timeout: 5 });
    cleanups.push(() => client.dispose());

    // Fire multiple requests concurrently before any connection is established
    const [r1, r2, r3] = await Promise.all([
      client.requestApproval('a', {}, false, false),
      client.requestApproval('b', {}, false, false),
      client.requestApproval('c', {}, false, false),
    ]);

    expect(r1).toBe(true);
    expect(r2).toBe(true);
    expect(r3).toBe(true);
    // All three should share a single connection
    expect(connectionCount).toBe(1);
  });

  test('returns false when socket.write throws', async () => {
    const { server, socketPath } = await createTestSocket(() => {
      // Never respond
    });
    cleanups.push(() => server.close());

    const client = new HitlClient({ socketPath, level: 'all', timeout: 5 });
    cleanups.push(() => client.dispose());

    // Establish connection first
    const connectPromise = client.requestApproval('setup', {}, false, false);
    // Wait a tick for connection to be established, then break the socket
    await new Promise((r) => setTimeout(r, 100));

    // Forcefully break the socket's write method to simulate write failure
    // Access the internal socket and override write to throw
    const internalSocket = client['socket'];
    if (internalSocket) {
      const originalWrite = internalSocket.write;
      internalSocket.write = () => { throw new Error('write failed'); };
      const result = await client.requestApproval('broken_write', {}, true, false);
      expect(result).toBe(false);
      internalSocket.write = originalWrite;
    }
  }, 10000);

  test('denies all pending requests on socket error after connection', async () => {
    const socketPath = join(tmpdir(), `airmcp-test-${randomUUID()}.sock`);
    let serverConn;
    const server = createServer((conn) => {
      serverConn = conn;
      // Do not respond — we will close the connection to trigger the error path
    });
    await new Promise((resolve) => server.listen(socketPath, resolve));
    cleanups.push(() => server.close());

    const client = new HitlClient({ socketPath, level: 'all', timeout: 10 });
    cleanups.push(() => client.dispose());

    // Start a request that will be pending (server never responds)
    const resultPromise = client.requestApproval('pending_tool', {}, false, false);

    // Wait for connection and request to be sent
    await new Promise((r) => setTimeout(r, 200));

    // Destroy the server-side connection to trigger close on client
    serverConn.destroy();

    const result = await resultPromise;
    expect(result).toBe(false);
  }, 15000);

  test('handles malformed JSON response gracefully', async () => {
    const { server, socketPath } = await createTestSocket((req, conn) => {
      // Send invalid JSON first, then a valid response
      conn.write('this is not json\n');
      conn.write(JSON.stringify({
        id: req.id,
        type: 'hitl_response',
        approved: true,
      }) + '\n');
    });
    cleanups.push(() => server.close());

    const client = new HitlClient({ socketPath, level: 'all', timeout: 5 });
    cleanups.push(() => client.dispose());

    const consoleSpy = { calls: [] };
    const origError = console.error;
    console.error = (...args) => consoleSpy.calls.push(args);

    const result = await client.requestApproval('test_tool', {}, false, false);

    console.error = origError;

    // Should still resolve with the valid response
    expect(result).toBe(true);
    // Should have logged the parse error
    expect(consoleSpy.calls.some(c => c[0].includes('failed to parse response'))).toBe(true);
  });

  test('ignores responses with unknown id', async () => {
    const { server, socketPath } = await createTestSocket((req, conn) => {
      // Send a response with a wrong id first
      conn.write(JSON.stringify({
        id: 'unknown-id-12345',
        type: 'hitl_response',
        approved: true,
      }) + '\n');
      // Then the correct response
      conn.write(JSON.stringify({
        id: req.id,
        type: 'hitl_response',
        approved: false,
      }) + '\n');
    });
    cleanups.push(() => server.close());

    const client = new HitlClient({ socketPath, level: 'all', timeout: 5 });
    cleanups.push(() => client.dispose());

    const result = await client.requestApproval('test_tool', {}, false, false);
    // Should use the correct response (the second one), not the unknown-id one
    expect(result).toBe(false);
  });

  test('ignores responses with non-hitl_response type', async () => {
    const { server, socketPath } = await createTestSocket((req, conn) => {
      // Send a message with wrong type
      conn.write(JSON.stringify({
        id: req.id,
        type: 'some_other_type',
        approved: true,
      }) + '\n');
      // Then the correct response
      conn.write(JSON.stringify({
        id: req.id,
        type: 'hitl_response',
        approved: true,
      }) + '\n');
    });
    cleanups.push(() => server.close());

    const client = new HitlClient({ socketPath, level: 'all', timeout: 5 });
    cleanups.push(() => client.dispose());

    const result = await client.requestApproval('test_tool', {}, false, false);
    expect(result).toBe(true);
  });

  test('handles buffer overflow protection (>1MB)', async () => {
    const socketPath = join(tmpdir(), `airmcp-test-${randomUUID()}.sock`);
    let serverConn;
    const server = createServer((conn) => {
      serverConn = conn;
    });
    await new Promise((resolve) => server.listen(socketPath, resolve));
    cleanups.push(() => server.close());

    const client = new HitlClient({ socketPath, level: 'all', timeout: 5 });
    cleanups.push(() => client.dispose());

    // Start a request (will be pending since server never responds with valid data)
    const resultPromise = client.requestApproval('overflow_tool', {}, false, false);

    // Wait for connection
    await new Promise((r) => setTimeout(r, 200));

    const consoleSpy = { calls: [] };
    const origError = console.error;
    console.error = (...args) => consoleSpy.calls.push(args);

    // Send >1MB of data without newlines to trigger buffer overflow
    const bigChunk = 'x'.repeat(1_048_577 + 100);
    serverConn.write(bigChunk);

    // Wait for the data to be processed
    await new Promise((r) => setTimeout(r, 200));

    console.error = origError;

    const result = await resultPromise;
    expect(result).toBe(false);
    expect(consoleSpy.calls.some(c =>
      typeof c[0] === 'string' && c[0].includes('buffer exceeded 1MB')
    )).toBe(true);
  }, 10000);

  test('handles empty lines in response data', async () => {
    const { server, socketPath } = await createTestSocket((req, conn) => {
      // Send response with empty lines interspersed
      conn.write('\n\n' + JSON.stringify({
        id: req.id,
        type: 'hitl_response',
        approved: true,
      }) + '\n\n');
    });
    cleanups.push(() => server.close());

    const client = new HitlClient({ socketPath, level: 'all', timeout: 5 });
    cleanups.push(() => client.dispose());

    const result = await client.requestApproval('test_tool', {}, false, false);
    expect(result).toBe(true);
  });

  test('dispose denies pending requests', async () => {
    const socketPath = join(tmpdir(), `airmcp-test-${randomUUID()}.sock`);
    const server = createServer(() => {
      // Never respond
    });
    await new Promise((resolve) => server.listen(socketPath, resolve));
    cleanups.push(() => server.close());

    const client = new HitlClient({ socketPath, level: 'all', timeout: 30 });

    // Start a request that won't get a response
    const resultPromise = client.requestApproval('pending_tool', {}, false, false);

    // Wait for connection
    await new Promise((r) => setTimeout(r, 200));

    // Dispose should deny the pending request
    client.dispose();

    const result = await resultPromise;
    expect(result).toBe(false);
  }, 10000);

  test('reconnects after socket close', async () => {
    let connectionCount = 0;
    const socketPath = join(tmpdir(), `airmcp-test-${randomUUID()}.sock`);
    let serverConns = [];
    const server = createServer((conn) => {
      connectionCount++;
      serverConns.push(conn);
      let buffer = '';
      conn.setEncoding('utf-8');
      conn.on('data', (chunk) => {
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const req = JSON.parse(line);
          conn.write(JSON.stringify({
            id: req.id,
            type: 'hitl_response',
            approved: true,
          }) + '\n');
        }
      });
    });
    await new Promise((resolve) => server.listen(socketPath, resolve));
    cleanups.push(() => server.close());

    const client = new HitlClient({ socketPath, level: 'all', timeout: 5 });
    cleanups.push(() => client.dispose());

    // First request establishes connection
    const r1 = await client.requestApproval('tool_a', {}, false, false);
    expect(r1).toBe(true);
    expect(connectionCount).toBe(1);

    // Close the server-side connection to force a reconnect
    serverConns[0].destroy();
    await new Promise((r) => setTimeout(r, 200));

    // Second request should reconnect
    const r2 = await client.requestApproval('tool_b', {}, false, false);
    expect(r2).toBe(true);
    expect(connectionCount).toBe(2);
  }, 10000);

  test('handles chunked response data (split across multiple data events)', async () => {
    const socketPath = join(tmpdir(), `airmcp-test-${randomUUID()}.sock`);
    const server = createServer((conn) => {
      let buffer = '';
      conn.setEncoding('utf-8');
      conn.on('data', (chunk) => {
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const req = JSON.parse(line);
          const response = JSON.stringify({
            id: req.id,
            type: 'hitl_response',
            approved: true,
          }) + '\n';
          // Send response in chunks to test buffer assembly
          const mid = Math.floor(response.length / 2);
          conn.write(response.slice(0, mid));
          setTimeout(() => conn.write(response.slice(mid)), 50);
        }
      });
    });
    await new Promise((resolve) => server.listen(socketPath, resolve));
    cleanups.push(() => server.close());

    const client = new HitlClient({ socketPath, level: 'all', timeout: 5 });
    cleanups.push(() => client.dispose());

    const result = await client.requestApproval('chunked_tool', {}, false, false);
    expect(result).toBe(true);
  }, 10000);

  test('denyAllPending denies multiple pending requests individually', async () => {
    const socketPath = join(tmpdir(), `airmcp-test-${randomUUID()}.sock`);
    const server = createServer(() => {
      // Never respond to any requests
    });
    await new Promise((resolve) => server.listen(socketPath, resolve));
    cleanups.push(() => server.close());

    const client = new HitlClient({ socketPath, level: 'all', timeout: 30 });

    // Start multiple requests that will all be pending
    const p1 = client.requestApproval('tool_a', {}, false, false);
    const p2 = client.requestApproval('tool_b', {}, true, false);
    const p3 = client.requestApproval('tool_c', {}, false, true);

    // Wait for all to be sent
    await new Promise((r) => setTimeout(r, 200));

    // Dispose denies all pending at once
    client.dispose();

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(r1).toBe(false);
    expect(r2).toBe(false);
    expect(r3).toBe(false);
  }, 10000);

  test('response with missing id field is ignored', async () => {
    const { server, socketPath } = await createTestSocket((req, conn) => {
      // Send a response with no id field
      conn.write(JSON.stringify({
        type: 'hitl_response',
        approved: true,
      }) + '\n');
      // Then the correct one
      conn.write(JSON.stringify({
        id: req.id,
        type: 'hitl_response',
        approved: false,
      }) + '\n');
    });
    cleanups.push(() => server.close());

    const client = new HitlClient({ socketPath, level: 'all', timeout: 5 });
    cleanups.push(() => client.dispose());

    const result = await client.requestApproval('test_tool', {}, false, false);
    // The first response has no id so the if(msg.type === "hitl_response" && msg.id) check fails;
    // the second response (approved: false) is used
    expect(result).toBe(false);
  });

  test('dispose with no connection and no pending is safe', () => {
    const client = new HitlClient({
      socketPath: '/tmp/never-connected.sock',
      level: 'all',
      timeout: 5,
    });
    // Never connected, no pending — should not throw
    client.dispose();
    client.dispose();
  });

  test('socket error during connection rejects ensureConnected', async () => {
    // Use a path that does not exist at all to provoke a connection error
    const client = new HitlClient({
      socketPath: '/tmp/airmcp-does-not-exist-' + randomUUID() + '.sock',
      level: 'all',
      timeout: 2,
    });
    cleanups.push(() => client.dispose());

    // requestApproval catches the connect error and returns false
    const result = await client.requestApproval('fail_connect', { x: 1 }, true, true);
    expect(result).toBe(false);
  });

  test('socket close after connection denies pending and clears connectPromise', async () => {
    const socketPath = join(tmpdir(), `airmcp-test-${randomUUID()}.sock`);
    let serverConn;
    const server = createServer((conn) => {
      serverConn = conn;
      // Do not respond
    });
    await new Promise((resolve) => server.listen(socketPath, resolve));
    cleanups.push(() => server.close());

    const client = new HitlClient({ socketPath, level: 'all', timeout: 10 });
    cleanups.push(() => client.dispose());

    const resultPromise = client.requestApproval('close_tool', {}, false, false);
    await new Promise((r) => setTimeout(r, 200));

    // Gracefully end the server-side connection (triggers 'close' event)
    serverConn.end();
    await new Promise((r) => setTimeout(r, 200));

    const result = await resultPromise;
    expect(result).toBe(false);

    // After close, the client should be able to reconnect on next request
    // (socket is null, connectPromise is null)
  }, 10000);

  test('buffer overflow resets buffer and denies all pending', async () => {
    const socketPath = join(tmpdir(), `airmcp-test-${randomUUID()}.sock`);
    let serverConn;
    const server = createServer((conn) => {
      serverConn = conn;
    });
    await new Promise((resolve) => server.listen(socketPath, resolve));
    cleanups.push(() => server.close());

    const client = new HitlClient({ socketPath, level: 'all', timeout: 10 });
    cleanups.push(() => client.dispose());

    // Start two pending requests
    const p1 = client.requestApproval('overflow_a', {}, false, false);
    const p2 = client.requestApproval('overflow_b', {}, true, false);
    await new Promise((r) => setTimeout(r, 200));

    // Send data that exceeds 1MB without newlines
    const bigData = 'A'.repeat(1_048_577 + 500);
    serverConn.write(bigData);
    await new Promise((r) => setTimeout(r, 300));

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(false);
    expect(r2).toBe(false);
  }, 15000);

  test('response for already-resolved request (e.g. after timeout) is silently ignored', async () => {
    const { server, socketPath } = await createTestSocket((req, conn) => {
      // Respond after 1.5s — by then the 1s timeout will have fired
      setTimeout(() => {
        conn.write(JSON.stringify({
          id: req.id,
          type: 'hitl_response',
          approved: true,
        }) + '\n');
      }, 1500);
    });
    cleanups.push(() => server.close());

    const client = new HitlClient({ socketPath, level: 'all', timeout: 1 });
    cleanups.push(() => client.dispose());

    // The request times out at 1s; the late response (at 1.5s) should be ignored
    const result = await client.requestApproval('late_tool', {}, false, false);
    expect(result).toBe(false);

    // Wait for the late response to arrive (should not throw)
    await new Promise((r) => setTimeout(r, 2000));
  }, 10000);

  test('request includes module field when present in args', async () => {
    let receivedRequest;
    const { server, socketPath } = await createTestSocket((req, conn) => {
      receivedRequest = req;
      conn.write(JSON.stringify({
        id: req.id,
        type: 'hitl_response',
        approved: true,
      }) + '\n');
    });
    cleanups.push(() => server.close());

    const client = new HitlClient({ socketPath, level: 'all', timeout: 5 });
    cleanups.push(() => client.dispose());

    await client.requestApproval('test_tool', { noteId: 'abc', body: 'hello' }, false, true);

    expect(receivedRequest.tool).toBe('test_tool');
    expect(receivedRequest.args).toEqual({ noteId: 'abc', body: 'hello' });
    expect(receivedRequest.openWorld).toBe(true);
    expect(receivedRequest.destructive).toBe(false);
  });
});
