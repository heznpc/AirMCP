import { describe, expect, test } from "@jest/globals";
import { assertPublishedIdentity, sha512Sri, waitForPublishedIdentity } from "../scripts/lib/publish-identity.mjs";

const local = {
  name: "airmcp",
  version: "2.16.0",
  integrity: "sha512-local",
};
const expectedGitHead = "a".repeat(40);

describe("immutable npm publish identity", () => {
  test("computes standard SHA-512 SRI", () => {
    expect(sha512Sri(Buffer.from("AirMCP", "utf8"))).toBe(
      "sha512-2MAfBQjNpQLbRj2pdEynk7JYyYejB99LsORYli7glCEL6DglRYPAi74KEdA9KbFPh71lrHt3ZRDZfdEBQ1tDug==",
    );
  });

  test("allows an idempotent skip only for exact version, SRI, and gitHead", () => {
    expect(
      assertPublishedIdentity({
        local,
        expectedGitHead,
        published: { version: local.version, integrity: local.integrity, gitHead: expectedGitHead },
      }),
    ).toBe(true);
  });

  test.each([
    ["version", { version: "2.15.0", integrity: local.integrity, gitHead: expectedGitHead }],
    ["SRI", { version: local.version, integrity: "sha512-other", gitHead: expectedGitHead }],
    ["gitHead", { version: local.version, integrity: local.integrity, gitHead: "b".repeat(40) }],
  ])("fails closed on %s mismatch", (_label, published) => {
    expect(() => assertPublishedIdentity({ local, published, expectedGitHead })).toThrow();
  });

  test("bounded post-publish retry tolerates network, missing, and incomplete metadata", () => {
    let clock = 0;
    const responses = [
      new Error("temporary registry failure"),
      null,
      { version: local.version, integrity: local.integrity },
      { version: local.version, integrity: local.integrity, gitHead: expectedGitHead },
    ];
    const published = waitForPublishedIdentity({
      local,
      expectedGitHead,
      timeoutMs: 30,
      retryDelayMs: 10,
      now: () => clock,
      sleep: (milliseconds) => {
        clock += milliseconds;
      },
      query: () => {
        const response = responses.shift();
        if (response instanceof Error) throw response;
        return response;
      },
    });
    expect(published.gitHead).toBe(expectedGitHead);
    expect(clock).toBe(30);
  });

  test("post-publish retry never waits through a complete identity mismatch", () => {
    let sleeps = 0;
    expect(() =>
      waitForPublishedIdentity({
        local,
        expectedGitHead,
        timeoutMs: 60_000,
        query: () => ({ version: local.version, integrity: "sha512-other", gitHead: expectedGitHead }),
        sleep: () => {
          sleeps += 1;
        },
      }),
    ).toThrow(/SRI/);
    expect(sleeps).toBe(0);
  });
});
