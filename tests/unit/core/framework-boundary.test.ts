import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const forbiddenImportPattern =
  /from\s+["'](?:react|next(?:\/[^"']*)?|@primer\/react)["']|require\(["'](?:react|next(?:\/[^"']*)?|@primer\/react)["']\)/;

const forbiddenGlobalPattern = /\b(?:window|document|sessionStorage)\b/;

describe("launch analyzer framework boundary", () => {
  it("does not import React, Next.js, Primer, or browser globals", () => {
    const files = [
      "src/core/launch-analyzer/index.ts",
      "src/core/launch-analyzer/model/constants.ts",
      "src/core/launch-analyzer/model/limits.ts",
      "src/core/launch-analyzer/model/types.ts",
      "src/core/launch-analyzer/model/config.ts",
      "src/core/launch-analyzer/model/completeness.ts"
    ];

    const violations = files.flatMap((file) => {
      const contents = readFileSync(resolve(process.cwd(), file), "utf8");
      const problems = [];

      if (forbiddenImportPattern.test(contents)) {
        problems.push(`${file}: imports framework UI code`);
      }

      if (forbiddenGlobalPattern.test(contents)) {
        problems.push(`${file}: references browser globals`);
      }

      return problems;
    });

    expect(violations).toEqual([]);
  });
});
