import { describe, expect, test } from "@jest/globals";
import { sanitizedNotaryIssues } from "../scripts/sanitize-notary-log.mjs";

describe("notary log public-output boundary", () => {
  test("keeps issue coordinates without account, certificate, or raw message data", () => {
    const document = {
      id: "11111111-2222-3333-4444-555555555555",
      teamId: "A1B2C3D4E5",
      issues: [
        {
          severity: "error",
          code: "invalid-signature",
          path: "AirMCP.zip/AirMCP.app/Contents/MacOS/AirMCP",
          message: "Developer ID Application: Private Name (A1B2C3D4E5) user@example.com",
        },
      ],
    };
    const output = sanitizedNotaryIssues(document).join("\n");
    expect(output).toBe("notarization error: code=invalid-signature path=AirMCP.app/Contents/MacOS/AirMCP");
    expect(output).not.toContain(document.id);
    expect(output).not.toContain(document.teamId);
    expect(output).not.toContain("Private Name");
    expect(output).not.toContain("user@example.com");
  });

  test("drops home and temporary prefixes and redacts identifiers inside the bundle", () => {
    const output = sanitizedNotaryIssues({
      issues: [
        {
          severity: "warning",
          code: "11111111-2222-3333-8444-555555555555",
          path: "/Users/private-owner/build/AirMCP",
        },
        {
          severity: "error",
          code: "bundle-format",
          path: "/private/var/folders/account-id/T/11111111-2222-3333-8444-555555555555/AirMCP.app/Contents/A1B2C3D4E5/user@example.com/AirMCP",
        },
      ],
    }).join("\n");

    expect(output).toContain("notarization warning: code=unknown path=artifact");
    expect(output).toContain(
      "notarization error: code=bundle-format path=AirMCP.app/Contents/redacted/redacted/AirMCP",
    );
    for (const privateValue of [
      "private-owner",
      "/Users",
      "/private/var/folders",
      "account-id",
      "11111111-2222-3333-8444-555555555555",
      "A1B2C3D4E5",
      "user@example.com",
    ]) {
      expect(output).not.toContain(privateValue);
    }
  });
});
