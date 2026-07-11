import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("dev OAuth harness HTTPS contract", () => {
  const launcher = read("../scripts/dev-oauth.mjs");
  const proxyHelper = read("../scripts/lib/dev-oauth-https-proxy.mjs");
  const compose = read("../docker/docker-compose.dev-oauth.yml");
  const realm = JSON.parse(read("../docker/keycloak-realm.json"));
  const guide = read("../docs/oauth-browser-pkce.md");

  test("launcher generates an ephemeral CA and only advertises HTTPS OAuth identities", () => {
    expect(launcher).toContain('mkdtempSync(join(tmpdir(), "airmcp-dev-oauth-")');
    expect(launcher).toContain("NODE_EXTRA_CA_CERTS=");
    expect(launcher).toContain("AIRMCP_OAUTH_ISSUER=https://localhost:8443/realms/airmcp");
    expect(launcher).toContain("AIRMCP_OAUTH_AUDIENCE=https://${DEV_OAUTH_PROXY_HOST}:${DEV_OAUTH_PROXY_PORT}/mcp");
    expect(launcher).toContain("--cacert");
    expect(launcher).toContain("This validates Node/curl only");
    expect(launcher).not.toMatch(/AIRMCP_OAUTH_(?:ISSUER|AUDIENCE)=http:\/\//);
  });

  test("resource proxy is fixed to IPv4 loopback on both sides", () => {
    expect(proxyHelper).toContain('DEV_OAUTH_PROXY_HOST = "127.0.0.1"');
    expect(proxyHelper).toContain("DEV_OAUTH_PROXY_PORT = 3443");
    expect(proxyHelper).toContain('DEV_OAUTH_UPSTREAM_ORIGIN = "http://127.0.0.1:3000"');
    expect(proxyHelper).toContain("upstream.hostname !== DEV_OAUTH_PROXY_HOST");
    expect(launcher).toContain("startLoopbackHttpsProxy");
  });

  test("launcher owns proxy, compose, and ephemeral TLS cleanup on every exit path", () => {
    expect(launcher).toContain('"down", "--remove-orphans"');
    expect(launcher).toContain("await proxy?.close()");
    expect(launcher).toContain("await removeComposeResources()");
    expect(launcher).toContain("cleanupTls()");
    expect(launcher).toContain('process.once("exit", cleanupTls)');
    expect(launcher).toContain("onFatalError:");
    expect(launcher).toContain('child.on("error"');
  });

  test("Keycloak disables plaintext transport and binds TLS to loopback", () => {
    expect(compose).toContain("--http-enabled=false");
    expect(compose).toContain("--https-port=8443");
    expect(compose).toContain("--https-certificate-file=");
    expect(compose).toContain("127.0.0.1:8443:8443");
    expect(compose).toContain("KC_HTTP_MANAGEMENT_SCHEME: http");
    expect(compose).not.toContain("8081:8081");
  });

  test("realm-issued tokens carry the HTTPS AirMCP resource audience", () => {
    expect(realm.sslRequired).toBe("all");
    const client = realm.clients.find((candidate) => candidate.clientId === "airmcp-dev");
    const mapper = client.protocolMappers.find((candidate) => candidate.protocolMapper === "oidc-audience-mapper");
    expect(mapper.config["included.custom.audience"]).toBe("https://127.0.0.1:3443/mcp");
    expect(mapper.config["access.token.claim"]).toBe("true");
  });

  test("local-development guide matches the launcher without documenting a bypass", () => {
    const localSection = guide
      .split("## 7. Local development — Node/curl verification loop")[1]
      .split("## 8. Troubleshooting")[0];
    expect(localSection).toContain("NODE_EXTRA_CA_CERTS");
    expect(localSection).toContain("AIRMCP_OAUTH_ISSUER=https://localhost:8443/realms/airmcp");
    expect(localSection).toContain("AIRMCP_OAUTH_AUDIENCE=https://127.0.0.1:3443/mcp");
    expect(localSection).toContain("https://127.0.0.1:3443/.well-known/oauth-protected-resource");
    expect(localSection).not.toMatch(/AIRMCP_OAUTH_(?:ISSUER|AUDIENCE)=http:\/\//);
    expect(localSection).toContain("does not relax AirMCP's rule");
    expect(localSection).toContain("not a browser PKCE harness");
    expect(localSection).not.toContain("switch flows without reconfiguring");
  });
});
