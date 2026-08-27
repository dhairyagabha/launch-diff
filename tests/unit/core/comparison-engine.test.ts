import { describe, expect, it } from "vitest";
import {
  compareResolvedLibraries,
  type LaunchChildComponent,
  type LaunchResource,
  type ResolvedLibrary
} from "@/core/launch-analyzer";
import { ANALYZER_MODEL_VERSION } from "@/core/launch-analyzer";
import { calculateCompleteness } from "@/core/launch-analyzer";

describe("comparison engine", () => {
  it("produces exact added, removed, modified, and unchanged classifications", () => {
    const base = library({
      resources: [
        resource("rule", "RL-SAME", "Same", "same"),
        resource("rule", "RL-MOD", "Modified", "old"),
        resource("rule", "RL-REMOVED", "Removed", "removed")
      ]
    });
    const compare = library({
      resources: [
        resource("rule", "RL-SAME", "Same Renamed", "same"),
        resource("rule", "RL-MOD", "Modified", "new"),
        resource("rule", "RL-ADDED", "Added", "added")
      ]
    });
    const result = compareResolvedLibraries(base, compare);

    expect(result.ok).toBe(true);
    const statuses = result.ok
      ? result.comparison.resources.map((comparison) => comparison.status).sort()
      : [];

    expect(statuses).toEqual(["added", "modified", "removed", "unchanged"]);
  });

  it("blocks confirmed property mismatches", () => {
    const result = compareResolvedLibraries(
      library({ propertyId: "PR-BASE", resources: [] }),
      library({ propertyId: "PR-COMPARE", resources: [] })
    );

    expect(result).toMatchObject({
      ok: false,
      reason: "property-mismatch",
      warning: {
        code: "property-mismatch",
        severity: "error"
      }
    });
  });

  it("warns and proceeds when property identity is missing", () => {
    const result = compareResolvedLibraries(
      library({ propertyId: null, resources: [] }),
      library({ propertyId: "PR-COMPARE", resources: [] })
    );

    expect(result.ok).toBe(true);
    expect(result.ok ? result.comparison.warnings.map((warning) => warning.code) : []).toContain(
      "property-identity-missing"
    );
  });

  it("does not classify unmatched resources as added or removed when a counterpart side failed", () => {
    const result = compareResolvedLibraries(
      library({
        resources: [resource("rule", "RL-BASE-ONLY", "Base Only", "base-only")]
      }),
      library({
        resources: [],
        failedFiles: 1
      })
    );

    expect(result.ok).toBe(true);
    expect(result.ok ? result.comparison.resources[0]?.status : undefined).toBe("unknown");
    expect(result.ok ? result.comparison.resources[0]?.structuredChanges[0]?.kind : undefined).toBe(
      "unresolved"
    );
  });

  it("detects meaningful child execution order changes", () => {
    const baseRule = resource("rule", "RL-ORDER", "Order", "same");
    const compareRule = resource("rule", "RL-ORDER", "Order", "same");
    baseRule.children = [child("first"), child("second")];
    compareRule.children = [child("second"), child("first")];
    const result = compareResolvedLibraries(
      library({ resources: [baseRule] }),
      library({ resources: [compareRule] })
    );

    expect(result.ok).toBe(true);
    expect(result.ok ? result.comparison.resources[0]?.status : undefined).toBe("modified");
    expect(
      result.ok ? result.comparison.resources[0]?.structuredChanges.map((change) => change.kind) : []
    ).toContain("ordering");
  });

  it("uses exact file-level fallback for parser-marked unmapped canonical sources", () => {
    const result = compareResolvedLibraries(
      library({ resources: [unmappedCanonicalSource("old-source")] }),
      library({ resources: [unmappedCanonicalSource("new-source")] })
    );

    expect(result.ok).toBe(true);
    expect(result.ok ? result.comparison.resources : []).toHaveLength(1);
    expect(result.ok ? result.comparison.resources[0] : undefined).toMatchObject({
      status: "modified",
      match: {
        method: "file-id-fallback",
        confidence: "certain"
      },
      structuredChanges: [
        {
          kind: "content-modified",
          path: ["files", "canonical"]
        }
      ]
    });
  });

  it("does not file-fallback match arbitrary unmapped container resources", () => {
    const result = compareResolvedLibraries(
      library({ resources: [unmappedContainerProperty("old")] }),
      library({ resources: [unmappedContainerProperty("new")] })
    );

    expect(result.ok).toBe(true);
    const statuses = result.ok
      ? result.comparison.resources.map((comparison) => comparison.status).sort()
      : [];

    expect(statuses).toEqual(["added", "removed"]);
  });

  it("marks unresolved external custom-code sources as unknown instead of a proven content change", () => {
    const baseRule = rule("External Rule", "old-url", {
      actions: [
        {
          settings: {
            source: "/* LaunchDiff: external custom-code source could not be resolved. */",
            isExternal: true
          }
        }
      ]
    });
    const compareRule = rule("External Rule", "fetched-content", {
      actions: [
        {
          settings: {
            source: "function actualExternalCode() {}",
            isExternal: true
          }
        }
      ]
    });
    baseRule.metadata.unresolvedExternalCustomCodeSources = ["actions.0.settings.source"];
    const result = compareResolvedLibraries(
      library({ resources: [baseRule] }),
      library({ resources: [compareRule] })
    );

    expect(result.ok).toBe(true);
    expect(result.ok ? result.comparison.resources[0]?.status : undefined).toBe("unknown");
    expect(
      result.ok ? result.comparison.resources[0]?.structuredChanges.map((change) => change.kind) : []
    ).toEqual(["unresolved"]);
  });

  it("attaches dependency impact to unchanged dependent resources", () => {
    const base = library({
      resources: [
        rule("Rule A", "same", { settings: { source: `_satellite.getVar("Changed DE");` } }),
        dataElement("Changed DE", "old")
      ]
    });
    const compare = library({
      resources: [
        rule("Rule A", "same", { settings: { source: `_satellite.getVar("Changed DE");` } }),
        dataElement("Changed DE", "new")
      ]
    });
    const result = compareResolvedLibraries(base, compare);

    expect(result.ok).toBe(true);
    const ruleComparison = result.ok
      ? result.comparison.resources.find(
          (comparison) => comparison.compare?.identity.name === "Rule A"
        )
      : undefined;

    expect(ruleComparison?.status).toBe("unchanged");
    expect(ruleComparison?.impact).toMatchObject({
      impacted: true,
      paths: [
        {
          changedResourceId: "data-element:Changed DE",
          resourceIds: ["data-element:Changed DE", "rule:Rule A"],
          resourceNames: ["Changed DE", "Rule A"],
          direct: true
        }
      ]
    });
  });

  it("does not treat a modified Rule as a dependency-impact source", () => {
    const base = library({
      resources: [
        rule("Rule A", "old-rule", { settings: { source: `_satellite.getVar("Stable DE");` } }),
        dataElement("Stable DE", "same")
      ]
    });
    const compare = library({
      resources: [
        rule("Rule A", "new-rule", { settings: { source: `_satellite.getVar("Stable DE");` } }),
        dataElement("Stable DE", "same")
      ]
    });
    const result = compareResolvedLibraries(base, compare);
    const ruleComparison = result.ok
      ? result.comparison.resources.find(
          (comparison) => comparison.compare?.identity.name === "Rule A"
        )
      : undefined;

    expect(result.ok).toBe(true);
    expect(ruleComparison?.status).toBe("modified");
    expect(ruleComparison?.impact).toBeUndefined();
    expect(result.ok ? result.comparison.impacts : []).toEqual([]);
  });

  it("attaches dependency impact when a referenced Data Element is added", () => {
    const base = library({
      resources: [
        rule("Rule A", "same", { settings: { source: `_satellite.getVar("New DE");` } })
      ]
    });
    const compare = library({
      resources: [
        rule("Rule A", "same", { settings: { source: `_satellite.getVar("New DE");` } }),
        dataElement("New DE", "added")
      ]
    });
    const result = compareResolvedLibraries(base, compare);
    const ruleComparison = result.ok
      ? result.comparison.resources.find(
          (comparison) => comparison.compare?.identity.name === "Rule A"
        )
      : undefined;

    expect(result.ok).toBe(true);
    expect(ruleComparison?.status).toBe("unchanged");
    expect(ruleComparison?.impact?.paths[0]).toMatchObject({
      changedResourceId: "data-element:New DE",
      direct: true
    });
  });

  it("attaches dependency impact from the base graph when a referenced Data Element is removed", () => {
    const base = library({
      resources: [
        rule("Rule A", "same", { settings: { source: `_satellite.getVar("Removed DE");` } }),
        dataElement("Removed DE", "removed")
      ]
    });
    const compare = library({
      resources: [
        rule("Rule A", "same", { settings: { source: `_satellite.getVar("Removed DE");` } })
      ]
    });
    const result = compareResolvedLibraries(base, compare);
    const ruleComparison = result.ok
      ? result.comparison.resources.find(
          (comparison) => comparison.compare?.identity.name === "Rule A"
        )
      : undefined;

    expect(result.ok).toBe(true);
    expect(ruleComparison?.status).toBe("unchanged");
    expect(ruleComparison?.impact?.paths[0]).toMatchObject({
      changedResourceId: "data-element:Removed DE",
      direct: true
    });
  });
});

function library(input: {
  propertyId?: string | null;
  resources: LaunchResource[];
  failedFiles?: number;
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
      ...(input.propertyId === null ? {} : { propertyId: input.propertyId ?? "PR-SAME" }),
      canonicalUrl: "https://assets.example.test/launch/library.js",
      discoveredResourceCount: input.resources.length,
      resolvedResourceCount: input.resources.length,
      failedResourceCount: failedFiles
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

function rule(name: string, fingerprint: string, raw: unknown): LaunchResource {
  return resource("rule", name, name, fingerprint, raw);
}

function dataElement(name: string, fingerprint: string): LaunchResource {
  return resource("data-element", name, name, fingerprint, {});
}

function unmappedCanonicalSource(fingerprint: string): LaunchResource {
  return {
    identity: {
      resourceType: "unmapped",
      name: "Unmapped canonical library"
    },
    raw: fingerprint,
    normalized: fingerprint,
    normalizedSource: fingerprint,
    contentFingerprint: fingerprint,
    children: [],
    fileIds: ["canonical"],
    dataElementReferences: [],
    metadata: {
      fallbackKind: "canonical-source"
    },
    warnings: []
  };
}

function unmappedContainerProperty(fingerprint: string): LaunchResource {
  return {
    identity: {
      resourceType: "unmapped",
      name: "Unmapped container property: mystery"
    },
    raw: fingerprint,
    normalized: fingerprint,
    normalizedSource: fingerprint,
    contentFingerprint: fingerprint,
    children: [],
    fileIds: ["canonical"],
    dataElementReferences: [],
    metadata: {
      containerPath: ["mystery"]
    },
    warnings: []
  };
}

function resource(
  resourceType: LaunchResource["identity"]["resourceType"],
  launchResourceId: string,
  name: string,
  fingerprint: string,
  raw: unknown = { name }
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
    fileIds: [],
    dataElementReferences: [],
    metadata: {},
    warnings: []
  };
}

function child(moduleType: string): LaunchChildComponent {
  return {
    componentType: "action",
    moduleType,
    raw: {},
    normalized: {},
    normalizedSource: moduleType
  };
}
