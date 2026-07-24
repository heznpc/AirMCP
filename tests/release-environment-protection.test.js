import { describe, expect, test } from "@jest/globals";
import { assertReleaseEnvironmentProtection } from "../scripts/verify-release-environment.mjs";

const protectedEnvironment = {
  can_admins_bypass: false,
  protection_rules: [{ type: "required_reviewers", reviewers: [{ type: "User" }] }],
  deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
};
const policies = { branch_policies: [{ name: "v*.*.*", type: "tag" }] };

describe("signed release environment gate", () => {
  test("accepts reviewed, no-bypass, tag-restricted configuration", () => {
    expect(assertReleaseEnvironmentProtection(protectedEnvironment, policies, "v2.16.0")).toBe(true);
  });

  test.each([
    ["missing reviewers", { ...protectedEnvironment, protection_rules: [] }, policies],
    ["admin bypass", { ...protectedEnvironment, can_admins_bypass: true }, policies],
    ["open deployment refs", { ...protectedEnvironment, deployment_branch_policy: null }, policies],
    ["branch policy instead of tag", protectedEnvironment, { branch_policies: [{ name: "v*.*.*", type: "branch" }] }],
    [
      "mixed branch and tag policies",
      protectedEnvironment,
      { branch_policies: [{ name: "v*.*.*", type: "tag" }, { name: "main", type: "branch" }] },
    ],
    ["nonmatching tag policy", protectedEnvironment, { branch_policies: [{ name: "release-*", type: "tag" }] }],
  ])("fails closed for %s", (_label, environment, branchPolicies) => {
    expect(() => assertReleaseEnvironmentProtection(environment, branchPolicies, "v2.16.0")).toThrow();
  });
});
