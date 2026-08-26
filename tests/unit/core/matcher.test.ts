import { describe, expect, it } from "vitest";
import {
  matchLaunchChildComponents,
  matchLaunchResources,
  type LaunchChildComponent,
  type LaunchResource
} from "@/core/launch-analyzer";

describe("Launch resource matcher", () => {
  it("treats different top-level Launch IDs as explicit added and removed resources", () => {
    const base = resource("rule", "RL11111111111111111111111111111111", "Checkout Rule", "same");
    const compare = resource("rule", "RL22222222222222222222222222222222", "Checkout Rule", "same");
    const comparisons = matchLaunchResources([base], [compare]);

    expect(comparisons.map((comparison) => comparison.status).sort()).toEqual(["added", "removed"]);
    expect(comparisons.every((comparison) => comparison.match?.method === "unmatched")).toBe(true);
  });

  it("matches the same top-level Launch ID even when the resource is renamed", () => {
    const base = resource("rule", "RL11111111111111111111111111111111", "Old Name", "old");
    const compare = resource("rule", "RL11111111111111111111111111111111", "New Name", "new");
    const comparisons = matchLaunchResources([base], [compare]);

    expect(comparisons).toHaveLength(1);
    expect(comparisons[0]).toMatchObject({
      status: "modified",
      match: {
        method: "launch-resource-id",
        confidence: "certain"
      }
    });
    expect(comparisons[0]?.base?.identity.name).toBe("Old Name");
    expect(comparisons[0]?.compare?.identity.name).toBe("New Name");
  });

  it("matches child components by stable child ID first", () => {
    const base = child({ childId: "RC-1", moduleType: "core/action.js", normalizedSource: "old" });
    const compare = child({ childId: "RC-1", moduleType: "core/action.js", normalizedSource: "new" });

    expect(matchLaunchChildComponents([base], [compare])).toEqual([
      {
        base,
        compare,
        match: {
          method: "launch-child-id",
          confidence: "certain"
        }
      }
    ]);
  });

  it("matches child components by exact structural signature when no child ID exists", () => {
    const base = child({ moduleType: "core/action.js", normalizedSource: "same" });
    const compare = child({ moduleType: "core/action.js", normalizedSource: "same" });

    expect(matchLaunchChildComponents([base], [compare])[0]?.match).toEqual({
      method: "exact-signature",
      confidence: "certain"
    });
  });

  it("uses conservative fuzzy fallback with provenance when evidence is unambiguous", () => {
    const base = child({
      componentType: "action",
      extensionId: "core",
      moduleType: "core/custom-code.js",
      name: "Custom Code",
      normalizedSource: "return 1;"
    });
    const compare = child({
      componentType: "action",
      extensionId: "core",
      moduleType: "core/custom-code.js",
      name: "Custom Code",
      normalizedSource: "return 2;"
    });

    const comparisons = matchLaunchChildComponents([base], [compare]);

    expect(comparisons[0]).toMatchObject({
      base,
      compare,
      match: {
        method: "fuzzy",
        confidence: "high",
        score: 8
      }
    });
    expect(comparisons[0]?.match.notes).toContain("same module type");
  });

  it("does not force ambiguous child candidates", () => {
    const base = child({
      componentType: "action",
      extensionId: "core",
      moduleType: "core/custom-code.js",
      name: "Custom Code",
      normalizedSource: "return 1;"
    });
    const compareA = child({
      componentType: "action",
      extensionId: "core",
      moduleType: "core/custom-code.js",
      name: "Custom Code",
      normalizedSource: "return 2;"
    });
    const compareB = child({
      componentType: "action",
      extensionId: "core",
      moduleType: "core/custom-code.js",
      name: "Custom Code",
      normalizedSource: "return 3;"
    });

    const comparisons = matchLaunchChildComponents([base], [compareA, compareB]);

    expect(comparisons.some((comparison) => comparison.base && comparison.compare)).toBe(false);
    expect(comparisons[0]?.match).toMatchObject({
      method: "fuzzy",
      confidence: "ambiguous"
    });
  });
});

function resource(
  resourceType: LaunchResource["identity"]["resourceType"],
  launchResourceId: string,
  name: string,
  fingerprint: string
): LaunchResource {
  return {
    identity: {
      resourceType,
      launchResourceId,
      name
    },
    raw: { name },
    normalized: { name },
    normalizedSource: name,
    contentFingerprint: fingerprint,
    children: [],
    fileIds: [],
    dataElementReferences: [],
    metadata: {},
    warnings: []
  };
}

function child(input: Partial<LaunchChildComponent>): LaunchChildComponent {
  return {
    componentType: input.componentType ?? "action",
    extensionId: input.extensionId ?? "core",
    moduleType: input.moduleType,
    name: input.name,
    childId: input.childId,
    raw: {},
    normalized: {},
    normalizedSource: input.normalizedSource
  };
}
