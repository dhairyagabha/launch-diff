import { describe, expect, it } from "vitest";
import {
  ANALYZER_MODEL_VERSION,
  calculateCompleteness,
  type ComparisonResult,
  type LaunchResource,
  type ResourceComparison,
  type ResolvedLibrary,
  type ResolvedFile,
  type ResourceType
} from "@/core/launch-analyzer";
import {
  buildSanitizedDiagnosticReport,
  comparisonCounts,
  comparisonResourceKey,
  completenessBanner,
  fileDisplayName,
  groupResourceComparisons,
  reviewProgress,
  type WorkspaceFilters
} from "@/app/compare/workspace-model";

describe("compare workspace model", () => {
  it("groups resources conservatively while honoring search, status, and type filters", () => {
    const comparisons = [
      comparison("rule", "RL-ORDER", "modified", {
        name: "Checkout Rule",
        childName: "Analytics action"
      }),
      comparison("rule", "RL-SAME", "unchanged", {
        name: "Unchanged Rule"
      }),
      comparison("data-element", "DE-HOST", "unchanged", {
        name: "Hostname",
        impacted: true
      }),
      comparison("extension", "EX-CORE", "added", {
        name: "Core Extension"
      })
    ];

    const grouped = groupResourceComparisons(comparisons, filters());

    expect(grouped.map((group) => group.label)).toEqual(["Rules", "Data Elements", "Extensions"]);
    expect(grouped.flatMap((group) => group.resources.map(comparisonDisplayNameForTest))).toEqual([
      "Checkout Rule",
      "Hostname",
      "Core Extension"
    ]);
    expect(
      groupResourceComparisons(comparisons, filters({ query: "analytics" })).flatMap(
        (group) => group.resources
      )
    ).toHaveLength(1);
    expect(
      groupResourceComparisons(comparisons, filters({ status: "impacted" })).flatMap(
        (group) => group.resources
      )
    ).toHaveLength(1);
    expect(
      groupResourceComparisons(comparisons, filters({ status: "unchanged" })).flatMap((group) =>
        group.resources.map(comparisonDisplayNameForTest)
      )
    ).toEqual(["Unchanged Rule", "Hostname"]);
    expect(
      groupResourceComparisons(comparisons, filters({ type: "data-element" }))[0]?.resources[0]
        ?.status
    ).toBe("unchanged");
  });

  it("counts changes, impact, and viewed review progress", () => {
    const modified = comparison("rule", "RL-ONE", "modified");
    const added = comparison("extension", "EX-ADD", "added", { impacted: true });
    const unchanged = comparison("data-element", "DE-SAME", "unchanged");
    const result = comparisonResult([modified, added, unchanged]);

    expect(comparisonCounts(result)).toMatchObject({
      modified: 1,
      added: 1,
      unchanged: 1,
      impacted: 1,
      changed: 2
    });
    expect(reviewProgress(result, new Set([comparisonResourceKey(modified)]))).toEqual({
      reviewed: 1,
      total: 2
    });
  });

  it("summarizes completeness using the strictest side", () => {
    const complete = calculateCompleteness({ discovered: 10, resolved: 10, failed: 0 });
    const warning = calculateCompleteness({ discovered: 10, resolved: 9, failed: 1 });
    const incomplete = calculateCompleteness({ discovered: 10, resolved: 8, failed: 2 });

    expect(completenessBanner(complete, complete).tone).toBe("success");
    expect(completenessBanner(complete, warning).tone).toBe("warning");
    expect(completenessBanner(warning, incomplete)).toMatchObject({
      tone: "danger",
      title: "Incomplete analysis"
    });
  });

  it("uses the authoritative file URL basename when available", () => {
    const file = resolvedFile("canonical", "https://assets.example.test/path/launch.min.js");

    expect(fileDisplayName(file)).toBe("launch.min.js");
    expect(fileDisplayName({ ...file, authoritativeUrl: "not a url" })).toBe("canonical");
  });

  it("builds a sanitized diagnostic report without URLs, names, config, diffs, or notes", () => {
    const modified = comparison("rule", "RL-SECRET", "modified", {
      name: "Secret Checkout Rule",
      childName: "Private Analytics action"
    });
    const added = comparison("extension", "EX-SECRET", "added", {
      name: "Secret Extension",
      impacted: true
    });
    const result = {
      ...comparisonResult([modified, added]),
      warnings: [
        {
          id: "warning:secret",
          severity: "warning" as const,
          code: "deferred-fetch-failed",
          message: "Secret Checkout Rule failed at https://private.example.test/secret.js"
        }
      ],
      releaseNotes: "Secret Checkout Rule changed private source."
    };
    const report = buildSanitizedDiagnosticReport({
      comparison: result,
      inputMode: "saved-config",
      workspacePhase: "ready",
      activeTab: "files",
      reviewProgress: { reviewed: 1, total: 2 },
      browser: { family: "Chrome", majorVersion: "141" }
    });

    expect(report).toContain('"version": "0.1.0"');
    expect(report).toContain('"saved-config"');
    expect(report).toContain('"deferred-fetch-failed"');
    expect(report).toContain('"Chrome"');
    expect(report).not.toContain("https://");
    expect(report).not.toContain("Secret Checkout Rule");
    expect(report).not.toContain("Secret Extension");
    expect(report).not.toContain("Private Analytics action");
    expect(report).not.toContain("RL-SECRET");
    expect(report).not.toContain("EX-SECRET");
    expect(report).not.toContain("private source");
    expect(report).not.toContain("secret.js");
  });
});

function filters(overrides: Partial<WorkspaceFilters> = {}): WorkspaceFilters {
  return {
    query: "",
    status: "all",
    type: "all",
    showUnchanged: false,
    viewedResourceKeys: new Set(),
    ...overrides
  };
}

function comparisonDisplayNameForTest(resourceComparison: ResourceComparison): string {
  return (
    (resourceComparison.compare ?? resourceComparison.base)?.identity.name ??
    "Unidentified resource"
  );
}

function comparison(
  type: ResourceType,
  id: string,
  status: ResourceComparison["status"],
  options: {
    name?: string;
    childName?: string;
    impacted?: boolean;
  } = {}
): ResourceComparison {
  const resource = launchResource(type, id, options.name ?? id, options.childName);

  return {
    base: status === "added" ? undefined : resource,
    compare: status === "removed" ? undefined : resource,
    status,
    structuredChanges: [],
    impact: options.impacted
      ? {
          impacted: true,
          paths: [
            {
              changedResourceId: id,
              resourceIds: [id],
              resourceNames: [options.name ?? id],
              direct: true
            }
          ]
        }
      : undefined,
    detailedDiffState: "not-started"
  };
}

function launchResource(
  type: ResourceType,
  id: string,
  name: string,
  childName?: string
): LaunchResource {
  return {
    identity: {
      resourceType: type,
      launchResourceId: id,
      name
    },
    raw: {},
    normalized: {},
    contentFingerprint: id,
    children: childName
      ? [
          {
            componentType: "action",
            name: childName,
            raw: {},
            normalized: {}
          }
        ]
      : [],
    fileIds: ["canonical"],
    dataElementReferences: [],
    metadata: {},
    warnings: []
  };
}

function comparisonResult(resources: ResourceComparison[]): ComparisonResult {
  return {
    modelVersion: ANALYZER_MODEL_VERSION,
    base: library("https://assets.example.test/base.js"),
    compare: library("https://assets.example.test/compare.js"),
    resources,
    impacts: [],
    warnings: [],
    releaseNotes: ""
  };
}

function library(canonicalUrl: string): ResolvedLibrary {
  return {
    modelVersion: ANALYZER_MODEL_VERSION,
    metadata: {
      canonicalUrl,
      discoveredResourceCount: 1,
      resolvedResourceCount: 1,
      failedResourceCount: 0
    },
    resources: [],
    files: [resolvedFile("canonical", canonicalUrl)],
    dependencyGraph: {
      nodes: [],
      edges: []
    },
    warnings: [],
    completeness: calculateCompleteness({
      discovered: 1,
      resolved: 1,
      failed: 0
    })
  };
}

function resolvedFile(id: string, authoritativeUrl: string): ResolvedFile {
  return {
    id,
    authoritativeUrl,
    aliases: [],
    state: "resolved",
    fetch: {
      requestedUrl: authoritativeUrl,
      fetchedAt: "1970-01-01T00:00:00.000Z",
      attempts: 1
    },
    owners: [],
    warningIds: []
  };
}
