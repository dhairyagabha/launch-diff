import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseLaunchDiffConfig, validateLaunchDiffConfig } from "@/core/launch-analyzer";

describe("LaunchDiff config", () => {
  it("validates the public example config", () => {
    const examplePath = resolve(process.cwd(), "examples/launchdiff.config.json");
    const example = JSON.parse(readFileSync(examplePath, "utf8")) as unknown;

    expect(() => parseLaunchDiffConfig(example)).not.toThrow();
  });

  it("requires at least two environments per site", () => {
    const result = validateLaunchDiffConfig({
      version: 1,
      sites: [
        {
          name: "Example Site",
          environments: [{ name: "Production", url: "https://example.com/launch.min.js" }]
        }
      ]
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("At least two environments are required.");
  });

  it("rejects non-public URL protocols", () => {
    const result = validateLaunchDiffConfig({
      version: 1,
      sites: [
        {
          name: "Example Site",
          environments: [
            { name: "Development", url: "file:///tmp/launch.js" },
            { name: "Production", url: "https://example.com/launch.min.js" }
          ]
        }
      ]
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Environment URL must use http:// or https://.");
  });
});
