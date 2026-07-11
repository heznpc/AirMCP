import { describe, expect, test } from "@jest/globals";

const {
  getResourceGovernance,
  isResourceTemplateRegistration,
  resourceRequestMetadata,
  withResourceGovernance,
} = await import("../dist/shared/resource-governance.js");

describe("resource governance metadata boundary", () => {
  test("keeps sensitive classification in a private side channel", () => {
    const original = { description: "Private data", _meta: { vendor: "preserved" } };
    const classified = withResourceGovernance(original, { sensitiveHint: true });

    expect(classified).not.toBe(original);
    expect(classified._meta).toEqual({ vendor: "preserved" });
    expect(JSON.stringify(classified)).not.toContain("sensitiveHint");
    expect(getResourceGovernance(classified)).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      sensitiveHint: true,
      openWorldHint: false,
    });
    expect(getResourceGovernance(original).sensitiveHint).toBe(false);
  });

  test("does not mistake a fixed-resource RequestHandlerExtra for template variables", () => {
    const extra = { requestId: "private", signal: new AbortController().signal };
    extra.circular = extra;

    expect(resourceRequestMetadata([new URL("notes://recent"), extra])).toEqual({ uri: "notes://recent" });
  });

  test("admits only bounded string variables for a real template registration", () => {
    const metadata = resourceRequestMetadata(
      [
        new URL("context://snapshot/full"),
        {
          depth: "x".repeat(600),
          tags: Array.from({ length: 40 }, (_, index) => `tag-${index}`),
          nested: { secret: "drop" },
          callback: () => "drop",
          constructor: "drop",
        },
        { requestId: "also-private" },
      ],
      true,
    );

    expect(metadata.uri).toBe("context://snapshot/full");
    expect(metadata.variables.depth).toHaveLength(500);
    expect(metadata.variables.tags).toHaveLength(32);
    expect(metadata.variables).not.toHaveProperty("nested");
    expect(metadata.variables).not.toHaveProperty("callback");
    expect(metadata.variables).not.toHaveProperty("constructor");
    expect(JSON.stringify(metadata)).not.toContain("also-private");
  });

  test("detects ResourceTemplate shape but not URL or hostile getters", () => {
    expect(isResourceTemplateRegistration({ uriTemplate: { variableNames: ["depth"] } })).toBe(true);
    expect(isResourceTemplateRegistration(new URL("notes://recent"))).toBe(false);
    expect(
      isResourceTemplateRegistration(
        Object.defineProperty({}, "uriTemplate", {
          get() {
            throw new Error("nope");
          },
        }),
      ),
    ).toBe(false);
  });
});
