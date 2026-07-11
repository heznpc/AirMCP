import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { request as httpsRequest } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startLoopbackHttpsProxy } from "../scripts/lib/dev-oauth-https-proxy.mjs";

let certificate;
let privateKey;
let tlsDir;

beforeAll(() => {
  tlsDir = mkdtempSync(join(tmpdir(), "airmcp-dev-oauth-proxy-test-"));
  const certificateFile = join(tlsDir, "localhost.pem");
  const privateKeyFile = join(tlsDir, "localhost-key.pem");
  const result = spawnSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-sha256",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost,IP:127.0.0.1",
      "-addext",
      "basicConstraints=critical,CA:TRUE,pathlen:0",
      "-out",
      certificateFile,
      "-keyout",
      privateKeyFile,
    ],
    { encoding: "utf8" },
  );
  if (result.error || result.status !== 0) {
    throw result.error ?? new Error(result.stderr || `openssl exited with ${result.status}`);
  }
  certificate = readFileSync(certificateFile);
  privateKey = readFileSync(privateKeyFile);
});

afterAll(() => rmSync(tlsDir, { force: true, recursive: true }));

function requestThroughProxy(origin, path, { body, method = "GET" } = {}) {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      `${origin}${path}`,
      {
        ca: certificate,
        headers: body === undefined ? {} : { "content-length": Buffer.byteLength(body) },
        method,
        rejectUnauthorized: true,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            body: Buffer.concat(chunks).toString("utf8"),
            headers: response.headers,
            statusCode: response.statusCode,
          });
        });
      },
    );
    request.once("error", reject);
    request.end(body);
  });
}

describe("local OAuth HTTPS resource proxy", () => {
  test("binds only to IPv4 loopback and forwards discovery to the HTTP AirMCP upstream", async () => {
    let observedRequest;
    const upstream = createHttpServer((request, response) => {
      observedRequest = {
        forwardedHost: request.headers["x-forwarded-host"],
        forwardedProto: request.headers["x-forwarded-proto"],
        host: request.headers.host,
        url: request.url,
      };
      response.writeHead(200, { "content-type": "application/json", "x-airmcp-test": "proxy" });
      response.end(JSON.stringify({ resource: "https://127.0.0.1:3443/mcp" }));
    });
    upstream.listen(0, "127.0.0.1");
    await once(upstream, "listening");
    const upstreamAddress = upstream.address();

    const proxy = await startLoopbackHttpsProxy({
      certificate,
      listenPort: 0,
      privateKey,
      upstreamOrigin: `http://127.0.0.1:${upstreamAddress.port}`,
    });

    try {
      expect(proxy.address.host).toBe("127.0.0.1");
      const response = await requestThroughProxy(proxy.origin, "/.well-known/oauth-protected-resource/mcp?contract=1");
      expect(response.statusCode).toBe(200);
      expect(response.headers["x-airmcp-test"]).toBe("proxy");
      expect(JSON.parse(response.body)).toEqual({ resource: "https://127.0.0.1:3443/mcp" });
      expect(observedRequest).toEqual({
        forwardedHost: `127.0.0.1:${proxy.address.port}`,
        forwardedProto: "https",
        host: `127.0.0.1:${proxy.address.port}`,
        url: "/.well-known/oauth-protected-resource/mcp?contract=1",
      });
    } finally {
      await proxy.close();
      upstream.close();
      await once(upstream, "close");
    }
  });

  test("rejects a non-loopback or hostname-based upstream", async () => {
    await expect(
      startLoopbackHttpsProxy({
        certificate,
        listenPort: 0,
        privateKey,
        upstreamOrigin: "http://localhost:3000",
      }),
    ).rejects.toThrow(/explicit http:\/\/127\.0\.0\.1/);
  });

  test("streams POST bodies and event-stream responses without buffering the protocol shape", async () => {
    let receivedBody = "";
    const upstream = createHttpServer((request, response) => {
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        receivedBody += chunk;
      });
      request.on("end", () => {
        response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
        response.write("event: message\n");
        response.end(`data: ${receivedBody}\n\n`);
      });
    });
    upstream.listen(0, "127.0.0.1");
    await once(upstream, "listening");
    const upstreamAddress = upstream.address();
    const proxy = await startLoopbackHttpsProxy({
      certificate,
      listenPort: 0,
      privateKey,
      upstreamOrigin: `http://127.0.0.1:${upstreamAddress.port}`,
    });

    try {
      const response = await requestThroughProxy(proxy.origin, "/mcp", {
        body: '{"jsonrpc":"2.0"}',
        method: "POST",
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toBe("text/event-stream");
      expect(response.body).toBe('event: message\ndata: {"jsonrpc":"2.0"}\n\n');
    } finally {
      await proxy.close();
      upstream.close();
      await once(upstream, "close");
    }
  });

  test("returns a fixed 502 envelope when the AirMCP upstream is unavailable", async () => {
    const unused = createHttpServer();
    unused.listen(0, "127.0.0.1");
    await once(unused, "listening");
    const unusedPort = unused.address().port;
    unused.close();
    await once(unused, "close");

    const proxy = await startLoopbackHttpsProxy({
      certificate,
      listenPort: 0,
      privateKey,
      upstreamOrigin: `http://127.0.0.1:${unusedPort}`,
    });
    try {
      const response = await requestThroughProxy(proxy.origin, "/.well-known/mcp.json");
      expect(response.statusCode).toBe(502);
      expect(JSON.parse(response.body)).toEqual({ error: "AirMCP HTTP upstream is not reachable" });
      expect(response.body).not.toMatch(/ECONNREFUSED|127\.0\.0\.1:\d+/);
    } finally {
      await proxy.close();
    }
  });

  test("rejects cleanly when the loopback HTTPS port is already occupied", async () => {
    const blocker = createHttpServer();
    blocker.listen(0, "127.0.0.1");
    await once(blocker, "listening");
    const blockerAddress = blocker.address();
    try {
      await expect(
        startLoopbackHttpsProxy({
          certificate,
          listenPort: blockerAddress.port,
          privateKey,
        }),
      ).rejects.toMatchObject({ code: "EADDRINUSE" });
    } finally {
      blocker.close();
      await once(blocker, "close");
    }
  });
});
