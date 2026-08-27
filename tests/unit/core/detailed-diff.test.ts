import { describe, expect, it } from "vitest";
import {
  ANALYZER_MODEL_VERSION,
  buildDetailedDiff,
  compareResolvedLibraries,
  comparisonResourceKey,
  createDetailedDiffQueue,
  populateComparisonDetailedDiffs,
  tokenizeSyntaxLine,
  type LaunchResource,
  type ResolvedLibrary,
  type ResourceComparison
} from "@/core/launch-analyzer";
import { calculateCompleteness } from "@/core/launch-analyzer";

describe("detailed diff engine", () => {
  it("builds split rows with intra-line highlights while preserving comments and literals", () => {
    const diff = buildDetailedDiff({
      baseSource: "const answer = 41;\n// deployed comment",
      compareSource: "const answer = 42;\n// deployed comment",
      language: "javascript",
      contextLineCount: 1
    });
    const rows = diff.hunks.flatMap((hunk) => hunk.rows);
    const changedRow = rows.find((row) => row.changed);
    const commentRow = rows.find((row) => row.base?.content.includes("deployed comment"));

    expect(changedRow?.base?.oldLineNumber).toBe(1);
    expect(changedRow?.compare?.newLineNumber).toBe(1);
    expect(
      changedRow?.base?.tokens?.filter((token) => token.changed).map((token) => token.value)
    ).toContain("41");
    expect(
      changedRow?.compare?.tokens?.filter((token) => token.changed).map((token) => token.value)
    ).toContain("42");
    expect(commentRow?.base?.content).toBe("// deployed comment");
    expect(commentRow?.base?.syntaxTokens?.map((token) => token.kind)).toContain("comment");
  });

  it("collapses unchanged gaps outside requested context", () => {
    const baseSource = ["a", "old", "b", "c", "d", "e", "f", "old-again", "g"].join("\n");
    const compareSource = ["a", "new", "b", "c", "d", "e", "f", "new-again", "g"].join("\n");
    const diff = buildDetailedDiff({
      baseSource,
      compareSource,
      language: "text",
      contextLineCount: 0
    });

    expect(diff.hunks.some((hunk) => hunk.collapsed && hunk.oldLines > 0)).toBe(true);
    expect(diff.hunks.filter((hunk) => !hunk.collapsed)).toHaveLength(2);
    expect(diff.hunks.find((hunk) => hunk.collapsed)?.hiddenRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          changed: false
        })
      ])
    );
  });

  it("uses full-file rows for added and removed resources", () => {
    const added = buildDetailedDiff({
      compareSource: "first\nsecond",
      language: "text"
    });
    const removed = buildDetailedDiff({
      baseSource: "first\nsecond",
      language: "text"
    });

    expect(added.hunks).toHaveLength(1);
    expect(added.hunks[0]?.oldStart).toBe(0);
    expect(added.hunks[0]?.newLines).toBe(2);
    expect(added.hunks[0]?.rows.every((row) => row.compare?.type === "added")).toBe(true);
    expect(removed.hunks[0]?.oldLines).toBe(2);
    expect(removed.hunks[0]?.rows.every((row) => row.base?.type === "removed")).toBe(true);
  });

  it("tokenizes syntax separately from diff emphasis", () => {
    const tokens = tokenizeSyntaxLine('const name = "Launch"; // keep', "javascript");

    expect(tokens).toEqual(
      expect.arrayContaining([
        { value: "const", kind: "keyword" },
        { value: "name", kind: "identifier" },
        { value: '"Launch"', kind: "string" },
        { value: "// keep", kind: "comment" }
      ])
    );
  });

  it("detects function folds and keeps changed functions expanded by default", () => {
    const baseSource = [
      "function changed() {",
      "  return 1;",
      "}",
      "function stable() {",
      "  return 2;",
      "}"
    ].join("\n");
    const compareSource = [
      "function changed() {",
      "  return 3;",
      "}",
      "function stable() {",
      "  return 2;",
      "}"
    ].join("\n");
    const diff = buildDetailedDiff({
      baseSource,
      compareSource,
      language: "javascript"
    });
    const changed = diff.functionFolds.find((fold) => fold.name === "changed");
    const stable = diff.functionFolds.find((fold) => fold.name === "stable");

    expect(changed).toMatchObject({
      containsChanges: true,
      collapsedByDefault: false,
      baseRange: {
        startLine: 1,
        endLine: 3
      },
      compareRange: {
        startLine: 1,
        endLine: 3
      }
    });
    expect(stable).toMatchObject({
      containsChanges: false,
      collapsedByDefault: true
    });
  });

  it("queues changed comparisons, prioritizes the selected resource, and populates cached diffs", () => {
    const first = comparison("RL-FIRST", "old", "new");
    const selected = comparison("RL-SELECTED", "before", "after");
    const unchanged = comparison("RL-SAME", "same", "same", "unchanged");
    const comparisons = [first, selected, unchanged];
    const queue = createDetailedDiffQueue(comparisons, {
      selectedResourceKey: comparisonResourceKey(selected)
    });
    const cache = new Map();
    const populated = populateComparisonDetailedDiffs(
      {
        modelVersion: ANALYZER_MODEL_VERSION,
        base: library([]),
        compare: library([]),
        resources: comparisons,
        impacts: [],
        warnings: [],
        releaseNotes: ""
      },
      {
        selectedResourceKey: comparisonResourceKey(selected),
        cache
      }
    );

    expect(queue.map((item) => item.resourceKey)[0]).toBe("rule:RL-SELECTED");
    expect(populated.resources[0]?.detailedDiffState).toBe("ready");
    expect(populated.resources[1]?.detailedDiffState).toBe("ready");
    expect(populated.resources[2]?.detailedDiffState).toBe("not-started");
    expect(cache.size).toBe(2);
  });

  it("renders resource diffs from a readable resource view instead of compact normalized source", () => {
    const base = readableResource("RL-READABLE", {
      id: "RL-READABLE",
      name: "Readable Rule",
      actions: [
        {
          modulePath: "core/src/lib/actions/customCode.js",
          settings: {
            source: 'function checkout(){_satellite.getVar("Marketing Source");return false;}'
          }
        }
      ]
    });
    const compare = readableResource("RL-READABLE", {
      id: "RL-READABLE",
      name: "Readable Rule",
      actions: [
        {
          modulePath: "core/src/lib/actions/customCode.js",
          settings: {
            source: 'function checkout(){_satellite.getVar("Marketing Source");return true;}'
          }
        }
      ]
    });
    const populated = populateComparisonDetailedDiffs({
      modelVersion: ANALYZER_MODEL_VERSION,
      base: library([base]),
      compare: library([compare]),
      resources: [
        {
          base,
          compare,
          status: "modified",
          match: {
            method: "launch-resource-id",
            confidence: "certain"
          },
          structuredChanges: [],
          detailedDiffState: "queued"
        }
      ],
      impacts: [],
      warnings: [],
      releaseNotes: ""
    });
    const renderedLines =
      populated.resources[0]?.detailedDiff?.hunks.flatMap((hunk) =>
        hunk.rows.flatMap((row) => [row.base?.content, row.compare?.content])
      ) ?? [];
    const trimmedLines = renderedLines.map((line) => line?.trim());

    expect(trimmedLines).toContain("function checkout() {");
    expect(trimmedLines).toContain('_satellite.getVar("Marketing Source");');
    expect(trimmedLines).toContain("return false;");
    expect(trimmedLines).toContain("return true;");
    expect(renderedLines).not.toContain(JSON.stringify(base.normalized));
  });

  it("comparison results automatically queue changed resources for detailed diffs", () => {
    const result = compareResolvedLibraries(
      library([resource("RL-MOD", "old"), resource("RL-SAME", "same")]),
      library([resource("RL-MOD", "new"), resource("RL-SAME", "same"), resource("RL-ADD", "added")])
    );

    expect(result.ok).toBe(true);
    const queued = result.ok
      ? result.comparison.resources.filter(
          (comparison) => comparison.detailedDiffState === "queued"
        )
      : [];
    const ready = result.ok ? populateComparisonDetailedDiffs(result.comparison) : undefined;

    expect(queued.map((comparison) => comparison.status).sort()).toEqual(["added", "modified"]);
    expect(
      ready?.resources
        .filter((comparison) => comparison.status === "added" || comparison.status === "modified")
        .every((comparison) => comparison.detailedDiffState === "ready" && comparison.detailedDiff)
    ).toBe(true);
  });
});

function comparison(
  launchResourceId: string,
  baseFingerprint: string,
  compareFingerprint: string,
  status: ResourceComparison["status"] = "modified"
): ResourceComparison {
  const base = resource(launchResourceId, baseFingerprint);
  const compare = resource(launchResourceId, compareFingerprint);

  return {
    base,
    compare,
    status,
    match: {
      method: "launch-resource-id",
      confidence: "certain"
    },
    structuredChanges: [],
    detailedDiffState: "not-started"
  };
}

function library(resources: LaunchResource[]): ResolvedLibrary {
  return {
    modelVersion: ANALYZER_MODEL_VERSION,
    metadata: {
      propertyId: "PR-SAME",
      canonicalUrl: "https://assets.example.test/launch/library.js",
      discoveredResourceCount: resources.length,
      resolvedResourceCount: resources.length,
      failedResourceCount: 0
    },
    resources,
    files: [
      {
        id: "canonical",
        authoritativeUrl: "https://assets.example.test/launch/library.js",
        aliases: [],
        state: "resolved",
        fetch: {
          requestedUrl: "https://assets.example.test/launch/library.js",
          fetchedAt: "1970-01-01T00:00:00.000Z",
          attempts: 1
        },
        owners: [],
        warningIds: []
      }
    ],
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

function readableResource(launchResourceId: string, normalized: unknown): LaunchResource {
  const compact = JSON.stringify(normalized);

  return {
    identity: {
      resourceType: "rule",
      launchResourceId,
      name: launchResourceId
    },
    raw: normalized,
    normalized,
    normalizedSource: compact,
    contentFingerprint: compact,
    children: [],
    fileIds: ["canonical"],
    dataElementReferences: [],
    metadata: {},
    warnings: []
  };
}

function resource(launchResourceId: string, source: string): LaunchResource {
  return {
    identity: {
      resourceType: "rule",
      launchResourceId,
      name: launchResourceId
    },
    raw: source,
    normalized: source,
    normalizedSource: source,
    contentFingerprint: source,
    children: [],
    fileIds: ["canonical"],
    dataElementReferences: [],
    metadata: {},
    warnings: []
  };
}
