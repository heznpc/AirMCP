import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { MODULE_MANIFEST } from "../dist/shared/modules.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODULE_NAMES = MODULE_MANIFEST.map((entry) => entry.name);

const ISSUE_TEMPLATE_EXPECTATIONS = [
  {
    path: ".github/ISSUE_TEMPLATE/bug_report.yml",
    nonModuleOptions: ["other / multiple"],
  },
  {
    path: ".github/ISSUE_TEMPLATE/feature_request.yml",
    nonModuleOptions: ["new module", "cross-module"],
  },
];

function readRepoFile(path) {
  return readFileSync(join(ROOT, path), "utf8");
}

function getIssueTemplateModuleOptions(path) {
  const template = YAML.parse(readRepoFile(path));
  const moduleField = template.body.find((item) => item.type === "dropdown" && item.id === "module");

  if (!moduleField) {
    throw new Error(`${path} is missing a dropdown with id "module"`);
  }

  return moduleField.attributes.options;
}

function getPrTemplateModuleOptions() {
  const template = readRepoFile(".github/PULL_REQUEST_TEMPLATE.md");
  const modulesSection = template.match(/### Modules Affected\n\n[\s\S]*?(?=\n### |\n## |$)/)?.[0];

  if (!modulesSection) {
    throw new Error(".github/PULL_REQUEST_TEMPLATE.md is missing the Modules Affected section");
  }

  return [...modulesSection.matchAll(/^- \[ \] (.+)$/gm)].map((match) => match[1].replaceAll("`", "").trim());
}

describe("contribution template module lists", () => {
  test.each(ISSUE_TEMPLATE_EXPECTATIONS)("$path includes every manifest module", ({ path, nonModuleOptions }) => {
    const options = getIssueTemplateModuleOptions(path);

    expect(options.filter((option) => MODULE_NAMES.includes(option))).toEqual(MODULE_NAMES);
    expect(options.filter((option) => !MODULE_NAMES.includes(option))).toEqual(nonModuleOptions);
  });

  test("pull request template includes every manifest module", () => {
    const options = getPrTemplateModuleOptions();

    expect(options.filter((option) => MODULE_NAMES.includes(option))).toEqual(MODULE_NAMES);
    expect(options.filter((option) => !MODULE_NAMES.includes(option))).toEqual(["Shared / Infrastructure"]);
  });

  test("pull request template does not use stale grouped or non-canonical module labels", () => {
    const options = getPrTemplateModuleOptions();

    expect(options).not.toContain("Pages / Numbers / Keynote");
    expect(options).not.toContain("Semantic");
    expect(options).not.toContain("UI Automation");
  });
});
