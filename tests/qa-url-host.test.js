import { describe, expect, test } from "@jest/globals";
import { hasExactHostname } from "../scripts/lib/url-host.mjs";

describe("QA URL host matching", () => {
  test("accepts the exact example.com host regardless of path", () => {
    expect(hasExactHostname("https://example.com", "example.com")).toBe(true);
    expect(hasExactHostname("https://example.com/airmcp?next=1", "example.com")).toBe(true);
  });

  test("rejects lookalike hosts and non-URL input", () => {
    expect(hasExactHostname("https://evil.example/example.com", "example.com")).toBe(false);
    expect(hasExactHostname("https://example.com.evil.example", "example.com")).toBe(false);
    expect(hasExactHostname("https://evil-example.com", "example.com")).toBe(false);
    expect(hasExactHostname("not a URL containing example.com", "example.com")).toBe(false);
  });
});
