import { describe, expect, test } from "@jest/globals";
import { isOptionalAddonPackageMiss } from "../dist/shared/module-loader.js";

describe("optional add-on package miss classification", () => {
  test("accepts only the exact manifest package missing error", () => {
    const expected = Object.assign(
      new Error(
        "Cannot find package '@heznpc/airmcp-productivity' imported from /tmp/airmcp/dist/shared/module-loader.js",
      ),
      { code: "ERR_MODULE_NOT_FOUND" },
    );
    const nestedDependency = Object.assign(
      new Error(
        "Cannot find package 'some-transitive-package' imported from /tmp/node_modules/@heznpc/airmcp-productivity/dist/pages/tools.js",
      ),
      { code: "ERR_MODULE_NOT_FOUND" },
    );

    expect(isOptionalAddonPackageMiss(expected, "@heznpc/airmcp-productivity")).toBe(true);
    expect(
      isOptionalAddonPackageMiss(
        new Error("Cannot find package '@heznpc/airmcp-productivity' imported from /tmp/airmcp/module-loader.js"),
        "@heznpc/airmcp-productivity",
      ),
    ).toBe(true);
    expect(
      isOptionalAddonPackageMiss(
        new Error(
          "Cannot find module '@heznpc/airmcp-productivity/dist/pages/tools.js' from 'dist/shared/module-loader.js'",
        ),
        "@heznpc/airmcp-productivity",
      ),
    ).toBe(true);
    expect(isOptionalAddonPackageMiss(nestedDependency, "@heznpc/airmcp-productivity")).toBe(false);
    expect(isOptionalAddonPackageMiss(expected, "@heznpc/airmcp-communications")).toBe(false);
    expect(isOptionalAddonPackageMiss(expected, null)).toBe(false);
  });
});
