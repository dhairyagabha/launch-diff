import { describe, expect, it } from "vitest";
import {
  ANALYZER_MODEL_VERSION,
  compareResolvedLibraries,
  generateReleaseNotes,
  type LaunchResource,
  type ResolvedLibrary
} from "@/core/launch-analyzer";
import { calculateCompleteness } from "@/core/launch-analyzer";

describe("deterministic release notes", () => {
  it("generates exact Markdown for direct rule changes", () => {
    const result = compareResolvedLibraries(
      library({
        resources: [
          rule("RL-CHECKOUT", "Checkout", "old"),
          rule("RL-LEGACY", "Legacy", "removed")
        ]
      }),
      library({
        resources: [
          rule("RL-CHECKOUT", "Checkout", "new"),
          rule("RL-SEARCH", "Search", "added")
        ]
      })
    );

    expect(result.ok ? result.comparison.releaseNotes : "").toMatchInlineSnapshot(`
      "# LaunchDiff Review Summary

      ## Summary
      - Direct changes: 3 (1 modified, 1 added, 1 removed).

      ## Direct Changes
      - Rule "Checkout" changed.
      - Rule "Legacy" was removed.
      - Rule "Search" was added.
      "
    `);
  });

  it("describes changed Data Element references without business interpretation", () => {
    const result = compareResolvedLibraries(
      library({
        resources: [
          rule("RL-GLOBAL", "Global - Page View", "old", {
            settings: {
              source: '_satellite.getVar("Legacy Customer ID");'
            }
          }),
          dataElement("DE-LEGACY", "Legacy Customer ID", "same")
        ]
      }),
      library({
        resources: [
          rule("RL-GLOBAL", "Global - Page View", "new", {
            settings: {
              source: '_satellite.getVar("Customer ID");'
            }
          }),
          dataElement("DE-CUSTOMER", "Customer ID", "same")
        ]
      })
    );

    expect(result.ok ? result.comparison.releaseNotes : "").toContain(
      'Rule "Global - Page View" now references "Customer ID" instead of "Legacy Customer ID".'
    );
    expect(result.ok ? result.comparison.releaseNotes : "").not.toContain("purchase");
  });

  it("does not imply a different target when a renamed Data Element keeps the same ID", () => {
    const result = compareResolvedLibraries(
      library({
        resources: [
          rule("RL-GLOBAL", "Global - Page View", "old", {
            settings: {
              source: '_satellite.getVar("Legacy Customer ID");'
            }
          }),
          dataElement("DE-CUSTOMER", "Legacy Customer ID", "old-name")
        ]
      }),
      library({
        resources: [
          rule("RL-GLOBAL", "Global - Page View", "new", {
            settings: {
              source: '_satellite.getVar("Customer ID");'
            }
          }),
          dataElement("DE-CUSTOMER", "Customer ID", "new-name")
        ]
      })
    );

    expect(result.ok ? result.comparison.releaseNotes : "").toContain(
      'Rule "Global - Page View" changed Data Element reference text from "Legacy Customer ID" to "Customer ID" while resolving to the same Data Element.'
    );
  });

  it("includes dependency impact for unchanged dependent resources", () => {
    const result = compareResolvedLibraries(
      library({
        resources: [
          rule("RL-A", "Rule A", "same", {
            settings: {
              source: '_satellite.getVar("Changed DE");'
            }
          }),
          dataElement("DE-CHANGED", "Changed DE", "old")
        ]
      }),
      library({
        resources: [
          rule("RL-A", "Rule A", "same", {
            settings: {
              source: '_satellite.getVar("Changed DE");'
            }
          }),
          dataElement("DE-CHANGED", "Changed DE", "new")
        ]
      })
    );

    expect(result.ok ? result.comparison.releaseNotes : "").toMatchInlineSnapshot(`
      "# LaunchDiff Review Summary

      ## Summary
      - Direct changes: 1 (1 modified).
      - Dependency impact: 1 resource.

      ## Direct Changes
      - Data Element "Changed DE" changed.

      ## Dependency Impact
      - Data Element "Changed DE" impacts 1 resource: "Rule A".
      "
    `);
  });

  it("includes incomplete-analysis warnings and excludes ordinary build metadata", () => {
    const result = compareResolvedLibraries(
      library({
        resources: [],
        metadata: {
          buildDate: "2026-01-01T00:00:00Z",
          environmentId: "EN-BUILD-METADATA"
        }
      }),
      library({
        resources: [],
        failedFiles: 1,
        metadata: {
          buildDate: "2026-02-01T00:00:00Z",
          environmentId: "EN-COMPARE"
        }
      })
    );

    expect(result.ok ? result.comparison.releaseNotes : "").toMatchInlineSnapshot(`
      "# LaunchDiff Review Summary

      ## Summary
      - Direct changes: none.
      - Analysis warnings: 2 warnings.

      ## Analysis Warnings
      - Compare library: 1 of 2 resources could not be retrieved. Results may not represent every deployed change.
      - Comparison is incomplete and retry is recommended before relying on these release notes.
      "
    `);
    expect(result.ok ? result.comparison.releaseNotes : "").not.toContain("EN-COMPARE");
    expect(result.ok ? result.comparison.releaseNotes : "").not.toContain("2026-02-01");
  });

  it("can generate standalone Markdown from an existing comparison result", () => {
    const result = compareResolvedLibraries(
      library({ resources: [rule("RL-SAME", "Same", "same")] }),
      library({ resources: [rule("RL-SAME", "Same", "same")] })
    );

    expect(result.ok ? generateReleaseNotes(result.comparison) : "").toBe(
      "# LaunchDiff Review Summary\n\nNo deployed changes, dependency impact, or analysis warnings were detected.\n"
    );
  });
});

function library(input: {
  resources: LaunchResource[];
  failedFiles?: number;
  metadata?: Partial<ResolvedLibrary["metadata"]>;
}): ResolvedLibrary {
  const failedFiles = input.failedFiles ?? 0;
  const files = [
    {
      id: "canonical",
      authoritativeUrl: "https://assets.example.test/launch/library.js",
      aliases: [],
      state: "resolved" as const,
      fetch: {
        requestedUrl: "https://assets.example.test/launch/library.js",
        fetchedAt: "1970-01-01T00:00:00.000Z",
        attempts: 1
      },
      owners: [],
      warningIds: []
    },
    ...Array.from({ length: failedFiles }, (_, index) => ({
      id: `failed:${index}`,
      authoritativeUrl: `https://assets.example.test/launch/failed-${index}.js`,
      aliases: [],
      state: "failed" as const,
      fetch: {
        requestedUrl: `https://assets.example.test/launch/failed-${index}.js`,
        fetchedAt: "1970-01-01T00:00:00.000Z",
        attempts: 1
      },
      owners: [],
      warningIds: []
    }))
  ];

  return {
    modelVersion: ANALYZER_MODEL_VERSION,
    metadata: {
      propertyId: "PR-SAME",
      canonicalUrl: "https://assets.example.test/launch/library.js",
      discoveredResourceCount: input.resources.length,
      resolvedResourceCount: input.resources.length,
      failedResourceCount: failedFiles,
      ...input.metadata
    },
    resources: input.resources,
    files,
    dependencyGraph: {
      nodes: [],
      edges: []
    },
    warnings: [],
    completeness: calculateCompleteness({
      discovered: files.length,
      resolved: files.length - failedFiles,
      failed: failedFiles
    })
  };
}

function rule(
  launchResourceId: string,
  name: string,
  fingerprint: string,
  raw: unknown = { name }
): LaunchResource {
  return resource("rule", launchResourceId, name, fingerprint, raw);
}

function dataElement(
  launchResourceId: string,
  name: string,
  fingerprint: string
): LaunchResource {
  return resource("data-element", launchResourceId, name, fingerprint, { name });
}

function resource(
  resourceType: LaunchResource["identity"]["resourceType"],
  launchResourceId: string,
  name: string,
  fingerprint: string,
  raw: unknown
): LaunchResource {
  return {
    identity: {
      resourceType,
      launchResourceId,
      name
    },
    raw,
    normalized: raw,
    normalizedSource: typeof raw === "string" ? raw : JSON.stringify(raw),
    contentFingerprint: fingerprint,
    children: [],
    fileIds: ["canonical"],
    dataElementReferences: [],
    metadata: {},
    warnings: []
  };
}
