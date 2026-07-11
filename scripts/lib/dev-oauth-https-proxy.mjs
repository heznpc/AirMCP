import { request as httpRequest } from "node:http";
import { createServer as createHttpsServer } from "node:https";

export const DEV_OAUTH_PROXY_HOST = "127.0.0.1";
export const DEV_OAUTH_PROXY_PORT = 3443;
export const DEV_OAUTH_UPSTREAM_ORIGIN = "http://127.0.0.1:3000";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function forwardedHeaders(headers) {
  const connectionValue = Array.isArray(headers.connection) ? headers.connection.join(",") : headers.connection;
  const connectionHeaders = new Set(
    (connectionValue ?? "")
      .split(",")
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean),
  );
  const forwarded = {};
  for (const [name, value] of Object.entries(headers)) {
    const lowerName = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lowerName) || connectionHeaders.has(lowerName) || lowerName.startsWith("x-forwarded-")) {
      continue;
    }
    if (value !== undefined) forwarded[lowerName] = value;
  }
  return forwarded;
}

function requestPath(rawUrl) {
  const parsed = new URL(rawUrl || "/", "http://airmcp.local");
  return `${parsed.pathname}${parsed.search}`;
}

/**
 * Expose the local HTTP AirMCP dev server through a fixed loopback-only HTTPS
 * resource URL. The upstream is also required to be IPv4 loopback, so this
 * helper cannot become an open proxy through configuration drift.
 */
export async function startLoopbackHttpsProxy({
  certificate,
  privateKey,
  listenPort = DEV_OAUTH_PROXY_PORT,
  upstreamOrigin = DEV_OAUTH_UPSTREAM_ORIGIN,
  onFatalError = () => {},
}) {
  const upstream = new URL(upstreamOrigin);
  if (upstream.protocol !== "http:" || upstream.hostname !== DEV_OAUTH_PROXY_HOST || !upstream.port) {
    throw new Error("dev OAuth HTTPS proxy upstream must be an explicit http://127.0.0.1:<port> URL");
  }
  if (!Number.isInteger(listenPort) || listenPort < 0 || listenPort > 65_535) {
    throw new Error("dev OAuth HTTPS proxy port must be an integer between 0 and 65535");
  }

  let listening = false;
  let publicPort = listenPort;
  const server = createHttpsServer({ cert: certificate, key: privateKey }, (request, response) => {
    let path;
    try {
      path = requestPath(request.url);
    } catch {
      response.writeHead(400, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: "Invalid request target" }));
      return;
    }

    const headers = forwardedHeaders(request.headers);
    headers.host = `${DEV_OAUTH_PROXY_HOST}:${publicPort}`;
    headers["x-forwarded-for"] = request.socket.remoteAddress ?? DEV_OAUTH_PROXY_HOST;
    headers["x-forwarded-host"] = headers.host;
    headers["x-forwarded-proto"] = "https";

    const upstreamRequest = httpRequest(
      {
        headers,
        hostname: upstream.hostname,
        method: request.method,
        path,
        port: upstream.port,
        protocol: "http:",
      },
      (upstreamResponse) => {
        const responseHeaders = forwardedHeaders(upstreamResponse.headers);
        response.writeHead(upstreamResponse.statusCode ?? 502, responseHeaders);
        upstreamResponse.pipe(response);
        upstreamResponse.once("error", (error) => response.destroy(error));
        response.once("close", () => {
          if (!response.writableEnded) upstreamResponse.destroy();
        });
      },
    );

    upstreamRequest.once("error", (error) => {
      if (response.headersSent) {
        response.destroy(error);
        return;
      }
      response.writeHead(502, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: "AirMCP HTTP upstream is not reachable" }));
    });
    request.once("aborted", () => upstreamRequest.destroy());
    request.once("error", (error) => upstreamRequest.destroy(error));
    request.pipe(upstreamRequest);
  });

  server.on("clientError", (_error, socket) => socket.destroy());

  await new Promise((resolve, reject) => {
    const startError = (error) => reject(error);
    server.once("error", startError);
    server.listen({ exclusive: true, host: DEV_OAUTH_PROXY_HOST, port: listenPort }, () => {
      server.off("error", startError);
      listening = true;
      server.on("error", onFatalError);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("dev OAuth HTTPS proxy did not expose a TCP address");
  }
  publicPort = address.port;

  let closePromise;
  const close = () => {
    if (closePromise) return closePromise;
    closePromise = new Promise((resolve, reject) => {
      if (!listening || !server.listening) {
        resolve();
        return;
      }
      listening = false;
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections?.();
    });
    return closePromise;
  };

  return {
    address: { host: address.address, port: address.port },
    close,
    origin: `https://${DEV_OAUTH_PROXY_HOST}:${address.port}`,
    server,
  };
}
