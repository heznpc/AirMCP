#!/usr/bin/env node

function globMatches(pattern, value) {
  let source = "^";
  for (const character of pattern) {
    if (character === "*") source += "[^/]*";
    else if (character === "?") source += "[^/]";
    else source += character.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
  }
  return new RegExp(`${source}$`).test(value);
}

export function assertReleaseEnvironmentProtection(environment, policies, tag) {
  const reviewerRule = environment?.protection_rules?.find((rule) => rule.type === "required_reviewers");
  if (!reviewerRule || !Array.isArray(reviewerRule.reviewers) || reviewerRule.reviewers.length === 0) {
    throw new Error("release environment must require an explicit reviewer");
  }
  if (environment.can_admins_bypass !== false) {
    throw new Error("release environment must disable administrator bypass");
  }
  if (environment.deployment_branch_policy?.custom_branch_policies !== true) {
    throw new Error("release environment must use a custom deployment tag policy");
  }
  const deploymentPolicies = policies?.branch_policies ?? policies ?? [];
  if (!Array.isArray(deploymentPolicies) || deploymentPolicies.some((policy) => policy?.type !== "tag")) {
    throw new Error("release environment deployment policies must allow tags only");
  }
  const tagPolicies = deploymentPolicies.filter((policy) => policy?.type === "tag");
  if (!tagPolicies.some((policy) => typeof policy.name === "string" && globMatches(policy.name, tag))) {
    throw new Error("release environment has no tag policy matching the requested release tag");
  }
  return true;
}

async function githubJson(url, token) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) throw new Error(`GitHub environment API returned HTTP ${response.status}`);
  return response.json();
}

function argument(name, fallback = "") {
  const inline = process.argv.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? "") : fallback;
}

async function main() {
  const repository = argument("--repo", process.env.GITHUB_REPOSITORY ?? "");
  const tag = argument("--tag", process.env.RELEASE_TAG ?? "");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error("--repo owner/name is required");
  if (!/^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/.test(tag)) {
    throw new Error("--tag must be a canonical vMAJOR.MINOR.PATCH release tag");
  }

  const base = `https://api.github.com/repos/${repository}`;
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "";
  const environment = await githubJson(`${base}/environments/release`, token);
  const hasReviewers = environment?.protection_rules?.some(
    (rule) => rule.type === "required_reviewers" && Array.isArray(rule.reviewers) && rule.reviewers.length > 0,
  );
  if (
    !hasReviewers ||
    environment.can_admins_bypass !== false ||
    environment.deployment_branch_policy?.custom_branch_policies !== true
  ) {
    // Fail on the environment invariant itself before querying a custom-policy
    // collection that GitHub returns as 404 when custom policies are disabled.
    assertReleaseEnvironmentProtection(environment, { branch_policies: [] }, tag);
  }
  const policies = await githubJson(`${base}/environments/release/deployment-branch-policies?per_page=100`, token);
  assertReleaseEnvironmentProtection(environment, policies, tag);
  console.log("ok: release environment requires review, disables admin bypass, and restricts deployment to this tag");
}

if (process.argv[1]?.endsWith("verify-release-environment.mjs")) {
  main().catch((error) => {
    console.error(`release-environment: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
