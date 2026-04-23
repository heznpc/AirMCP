// `.well-known/mcp.json` discovery card shape tests.
//
// The card is how registry crawlers (Anthropic MCP Registry, Smithery,
// PulseMCP, Glama) build their catalog without connecting. A silent
// shape regression breaks crawler parsing upstream — pin the contract.

import { describe, test, expect } from "@jest/globals";
import { buildServerCard, SCHEMA_VERSION } from "../dist/server/well-known-card.js";

const baseInput = () => ({
  name: "airmcp",
  version: "2.11.0",
  description: "MCP server for the entire Apple ecosystem",
  license: "MIT",
  homepage: "https://github.com/heznpc/AirMCP",
  websiteUrl: "https://github.com/heznpc/AirMCP",
  icon: "https://example.com/icon.png",
  allowNetwork: "loopback-only",
  allowedOrigins: [],
  tools: { count: 270, names: ["list_events", "read_note", "search_contacts"] },
  modules: ["calendar", "notes", "contacts"],
});

describe("buildServerCard — required fields", () => {
  test("always emits name / version / schema_version / transport / capabilities", () => {
    const card = buildServerCard(baseInput());
    expect(card.name).toBe("airmcp");
    expect(card.version).toBe("2.11.0");
    expect(card.schema_version).toBe(SCHEMA_VERSION);
    expect(card.transport).toEqual({ type: "streamable-http", url: "/mcp" });
    expect(card.capabilities).toEqual({
      tools: { listChanged: true },
      prompts: { listChanged: true },
      resources: { listChanged: true },
    });
  });

  test("SCHEMA_VERSION matches MCP spec 2025-11-25", () => {
    // Const-assertion pinning — if the spec date changes, update here
    // intentionally so crawlers know we re-audited the card shape.
    expect(SCHEMA_VERSION).toBe("2025-11-25");
  });

  test("network_policy is always present (RFC 0002 contract)", () => {
    const card = buildServerCard(baseInput());
    expect(card.network_policy).toBe("loopback-only");
  });
});

describe("buildServerCard — tool + module inventory (registry discovery)", () => {
  test("tools object carries count + full name list", () => {
    const card = buildServerCard(baseInput());
    expect(card.tools).toEqual({
      count: 270,
      names: ["list_events", "read_note", "search_contacts"],
    });
  });

  test("modules array is verbatim", () => {
    const card = buildServerCard(baseInput());
    expect(card.modules).toEqual(["calendar", "notes", "contacts"]);
  });

  test("empty inventory still renders a well-formed card (fresh install edge case)", () => {
    const card = buildServerCard({
      ...baseInput(),
      tools: { count: 0, names: [] },
      modules: [],
    });
    expect(card.tools).toEqual({ count: 0, names: [] });
    expect(card.modules).toEqual([]);
  });
});

describe("buildServerCard — icons", () => {
  test("accepts a string icon URL", () => {
    const card = buildServerCard(baseInput());
    expect(card.icons).toEqual(["https://example.com/icon.png"]);
  });

  test("accepts an MCP-spec icon descriptor object", () => {
    const card = buildServerCard({
      ...baseInput(),
      icon: { src: "data:image/svg+xml;base64,abc", mimeType: "image/svg+xml", sizes: ["any"] },
    });
    expect(card.icons).toEqual([
      { src: "data:image/svg+xml;base64,abc", mimeType: "image/svg+xml", sizes: ["any"] },
    ]);
  });
});

describe("buildServerCard — optional field emission", () => {
  test("omits description when absent", () => {
    const card = buildServerCard({ ...baseInput(), description: undefined });
    expect("description" in card).toBe(false);
  });

  test("omits license / homepage when absent", () => {
    const card = buildServerCard({ ...baseInput(), license: undefined, homepage: undefined });
    expect("license" in card).toBe(false);
    expect("homepage" in card).toBe(false);
  });

  test("emits authorization bearer when httpToken present", () => {
    const card = buildServerCard({ ...baseInput(), httpToken: "secret" });
    expect(card.authorization).toEqual({ type: "bearer" });
  });

  test("omits authorization when no token (stdio/loopback)", () => {
    const card = buildServerCard(baseInput());
    expect("authorization" in card).toBe(false);
  });

  test("emits allowed_origins when non-empty", () => {
    const card = buildServerCard({
      ...baseInput(),
      allowedOrigins: ["https://claude.ai", "https://cursor.com"],
    });
    expect(card.allowed_origins).toEqual(["https://claude.ai", "https://cursor.com"]);
  });

  test("omits allowed_origins when empty (default loopback)", () => {
    const card = buildServerCard(baseInput());
    expect("allowed_origins" in card).toBe(false);
  });
});

describe("buildServerCard — network policy flags", () => {
  test("loopback-only: no auth flag, no security flag", () => {
    const card = buildServerCard(baseInput());
    expect(card.network_policy).toBe("loopback-only");
    expect("authorization" in card).toBe(false);
    expect("security" in card).toBe(false);
  });

  test("with-token: emits authorization when token is set", () => {
    const card = buildServerCard({
      ...baseInput(),
      allowNetwork: "with-token",
      httpToken: "secret",
    });
    expect(card.network_policy).toBe("with-token");
    expect(card.authorization).toEqual({ type: "bearer" });
  });

  test("unauthenticated: adds security: insecure flag", () => {
    const card = buildServerCard({
      ...baseInput(),
      allowNetwork: "unauthenticated",
    });
    expect(card.network_policy).toBe("unauthenticated");
    expect(card.security).toBe("insecure");
  });
});

describe("buildServerCard — JSON round-trip", () => {
  test("full card serializes cleanly (no circular refs, no undefined leaves)", () => {
    const card = buildServerCard({
      ...baseInput(),
      httpToken: "x",
      allowedOrigins: ["https://claude.ai"],
      allowNetwork: "with-token+origin",
    });
    const serialized = JSON.stringify(card);
    expect(() => JSON.parse(serialized)).not.toThrow();
    const parsed = JSON.parse(serialized);
    expect(parsed.name).toBe("airmcp");
    expect(parsed.tools.count).toBe(270);
  });
});
