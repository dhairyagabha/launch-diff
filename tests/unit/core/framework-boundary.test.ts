import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const forbiddenImportPattern =
  /from\s+["'](?:react|next(?:\/[^"']*)?|@primer\/react)["']|require\(["'](?:react|next(?:\/[^"']*)?|@primer\/react)["']\)/;

const forbiddenGlobalPattern = /\b(?:window|document|sessionStorage)\b/;

describe("launch analyzer framework boundary", () => {
  it("does not import React, Next.js, Primer, or browser globals", () => {
    const files = collectTypeScriptFiles(resolve(process.cwd(), "src/core/launch-analyzer"));

    const violations = files.flatMap((file) => {
      const contents = readFileSync(file, "utf8");
      const problems = [];

      if (forbiddenImportPattern.test(contents)) {
        problems.push(`${relativeToProject(file)}: imports framework UI code`);
      }

      if (forbiddenGlobalPattern.test(contents)) {
        problems.push(`${relativeToProject(file)}: references browser globals`);
      }

      return problems;
    });

    expect(violations).toEqual([]);
  });
});

function collectTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = resolve(directory, entry.name);

    if (entry.isDirectory()) {
      return collectTypeScriptFiles(entryPath);
    }

    return entry.isFile() && entry.name.endsWith(".ts") ? [entryPath] : [];
  });
}

function relativeToProject(file: string): string {
  return file.replace(`${process.cwd()}/`, "");
}
