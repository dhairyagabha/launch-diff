import { ANALYZER_MODEL_VERSION } from "../model/constants";
import {
  annotateDataElementReferences,
  buildDataElementDependencyGraph,
  calculateDependencyImpacts,
  resourceGraphId
} from "../dependencies/data-elements";
import { enqueueDetailedDiffs } from "../diff/detailed-diff";
import { matchLaunchResources } from "../matcher/resources";
import { generateReleaseNotes } from "../release-notes/generator";
import type {
  AnalysisWarning,
  ComparisonResult,
  DependencyImpactPath,
  LaunchResource,
  ResourceComparison,
  ResolvedLibrary,
  StructuredChange
} from "../model/types";

export type PropertyValidationResult =
  | {
      ok: true;
      warnings: AnalysisWarning[];
    }
  | {
      ok: false;
      warning: AnalysisWarning;
    };

export type CompareResolvedLibrariesResult =
  | {
      ok: true;
      comparison: ComparisonResult;
    }
  | {
      ok: false;
      reason: "property-mismatch";
      warning: AnalysisWarning;
    };

export function validateComparableProperties(
  base: ResolvedLibrary,
  compare: ResolvedLibrary
): PropertyValidationResult {
  const basePropertyId = base.metadata.propertyId;
  const comparePropertyId = compare.metadata.propertyId;

  if (basePropertyId && comparePropertyId && basePropertyId !== comparePropertyId) {
    return {
      ok: false,
      warning: createComparisonWarning(
        "property-mismatch",
        "Base and Compare libraries have different Launch property IDs."
      )
    };
  }

  if (!basePropertyId || !comparePropertyId) {
    return {
      ok: true,
      warnings: [
        createComparisonWarning(
          "property-identity-missing",
          "One or both libraries are missing property identity. Comparison can proceed, but same-property validation is incomplete."
        )
      ]
    };
  }

  return {
    ok: true,
    warnings: []
  };
}

export function compareResolvedLibraries(
  base: ResolvedLibrary,
  compare: ResolvedLibrary
): CompareResolvedLibrariesResult {
  const propertyValidation = validateComparableProperties(base, compare);

  if (!propertyValidation.ok) {
    return {
      ok: false,
      reason: "property-mismatch",
      warning: propertyValidation.warning
    };
  }

  const baseResources = annotateDataElementReferences(base.resources);
  const compareResources = annotateDataElementReferences(compare.resources);
  const rawComparisons = applyFileLevelFallback(
    matchLaunchResources(baseResources, compareResources)
  );
  const comparisons = applyComparisonSemantics(rawComparisons, {
    baseHasUnresolvedFiles: hasUnresolvedFiles(base),
    compareHasUnresolvedFiles: hasUnresolvedFiles(compare)
  });
  const changedCompareResourceIds = new Set(
    comparisons
      .filter((comparison) => comparison.status === "modified" && comparison.compare)
      .map((comparison) => resourceGraphId(comparison.compare!))
  );
  const dependencyGraph = buildDataElementDependencyGraph(compareResources);
  const impactAnalysis = calculateDependencyImpacts(dependencyGraph, changedCompareResourceIds);
  const comparisonsWithImpact = enqueueDetailedDiffs(
    comparisons.map((comparison) => attachImpact(comparison, impactAnalysis.impactsByResourceId))
  );

  const comparisonResult: ComparisonResult = {
    modelVersion: ANALYZER_MODEL_VERSION,
    base: {
      ...base,
      resources: baseResources
    },
    compare: {
      ...compare,
      resources: compareResources,
      dependencyGraph
    },
    resources: comparisonsWithImpact,
    impacts: impactAnalysis.impacts,
    warnings: [
      ...base.warnings,
      ...compare.warnings,
      ...propertyValidation.warnings,
      ...warningsForCompleteness(base, "base"),
      ...warningsForCompleteness(compare, "compare")
    ],
    releaseNotes: ""
  };

  return {
    ok: true,
    comparison: {
      ...comparisonResult,
      releaseNotes: generateReleaseNotes(comparisonResult)
    }
  };
}

function applyComparisonSemantics(
  comparisons: ResourceComparison[],
  context: {
    baseHasUnresolvedFiles: boolean;
    compareHasUnresolvedFiles: boolean;
  }
): ResourceComparison[] {
  return comparisons.map((comparison) => {
    if (comparison.status === "added" && context.baseHasUnresolvedFiles) {
      return unknownBecauseCounterpartMayBeMissing(comparison, "base");
    }

    if (comparison.status === "removed" && context.compareHasUnresolvedFiles) {
      return unknownBecauseCounterpartMayBeMissing(comparison, "compare");
    }

    if (comparison.base && comparison.compare) {
      return addMatchedResourceStructuredChanges(comparison);
    }

    return comparison;
  });
}

function applyFileLevelFallback(comparisons: ResourceComparison[]): ResourceComparison[] {
  const retained: ResourceComparison[] = [];
  const baseByFallbackFileId = new Map<string, ResourceComparison[]>();
  const compareByFallbackFileId = new Map<string, ResourceComparison[]>();

  for (const comparison of comparisons) {
    const baseFileId =
      comparison.status === "removed" && comparison.base
        ? fileLevelFallbackFileId(comparison.base)
        : undefined;
    const compareFileId =
      comparison.status === "added" && comparison.compare
        ? fileLevelFallbackFileId(comparison.compare)
        : undefined;

    if (baseFileId) {
      baseByFallbackFileId.set(baseFileId, [
        ...(baseByFallbackFileId.get(baseFileId) ?? []),
        comparison
      ]);
      continue;
    }

    if (compareFileId) {
      compareByFallbackFileId.set(compareFileId, [
        ...(compareByFallbackFileId.get(compareFileId) ?? []),
        comparison
      ]);
      continue;
    }

    retained.push(comparison);
  }

  for (const fileId of new Set([
    ...baseByFallbackFileId.keys(),
    ...compareByFallbackFileId.keys()
  ])) {
    const baseMatches = baseByFallbackFileId.get(fileId) ?? [];
    const compareMatches = compareByFallbackFileId.get(fileId) ?? [];

    if (baseMatches.length === 1 && compareMatches.length === 1) {
      retained.push(
        createFileLevelFallbackComparison(
          baseMatches[0]!.base!,
          compareMatches[0]!.compare!,
          fileId
        )
      );
      continue;
    }

    retained.push(...baseMatches, ...compareMatches);
  }

  return retained;
}

function addMatchedResourceStructuredChanges(comparison: ResourceComparison): ResourceComparison {
  const base = comparison.base!;
  const compare = comparison.compare!;
  const structuredChanges: StructuredChange[] = [...comparison.structuredChanges];

  if (meaningfulChildOrderChanged(base, compare)) {
    structuredChanges.push({
      id: `${resourceGraphId(compare)}:ordering`,
      kind: "ordering",
      path: ["children"],
      description: "Launch child component execution order changed."
    });
  }

  const status =
    comparison.status === "modified" || structuredChanges.length > 0 ? "modified" : "unchanged";

  return {
    ...comparison,
    status,
    structuredChanges
  };
}

function unknownBecauseCounterpartMayBeMissing(
  comparison: ResourceComparison,
  counterpartSide: "base" | "compare"
): ResourceComparison {
  const resource = comparison.base ?? comparison.compare;

  return {
    ...comparison,
    status: "unknown",
    structuredChanges: [
      {
        id: `${resource ? resourceGraphId(resource) : "resource"}:unresolved-counterpart`,
        kind: "unresolved",
        path: [],
        description: `The ${counterpartSide} library has unresolved files, so LaunchDiff cannot prove whether the counterpart resource is missing.`
      }
    ]
  };
}

function createFileLevelFallbackComparison(
  base: LaunchResource,
  compare: LaunchResource,
  fileId: string
): ResourceComparison {
  const unchanged = base.contentFingerprint === compare.contentFingerprint;

  return {
    base,
    compare,
    status: unchanged ? "unchanged" : "modified",
    match: {
      method: "file-id-fallback",
      confidence: "certain",
      notes: [
        "Exact parser-marked file fallback was used; no Launch resource relationship was inferred."
      ]
    },
    structuredChanges: unchanged
      ? []
      : [
          {
            id: `file-fallback:${fileId}:content`,
            kind: "content-modified",
            path: ["files", fileId],
            description:
              "Unmapped file content changed; semantic Launch resource reconstruction was unavailable."
          }
        ],
    detailedDiffState: "not-started"
  };
}

function attachImpact(
  comparison: ResourceComparison,
  impactsByResourceId: Map<string, DependencyImpactPath[]>
): ResourceComparison {
  const compareResource = comparison.compare;

  if (!compareResource) {
    return comparison;
  }

  const paths = impactsByResourceId.get(resourceGraphId(compareResource)) ?? [];

  if (paths.length === 0) {
    return comparison;
  }

  return {
    ...comparison,
    impact: {
      impacted: true,
      paths
    }
  };
}

function meaningfulChildOrderChanged(base: LaunchResource, compare: LaunchResource): boolean {
  const baseSignature = base.children.map(orderSignature);
  const compareSignature = compare.children.map(orderSignature);

  if (baseSignature.length !== compareSignature.length) {
    return false;
  }

  const baseSorted = [...baseSignature].sort();
  const compareSorted = [...compareSignature].sort();

  return (
    baseSorted.every((signature, index) => signature === compareSorted[index]) &&
    baseSignature.some((signature, index) => signature !== compareSignature[index])
  );
}

function orderSignature(resource: {
  childId?: string;
  componentType: string;
  moduleType?: string;
}): string {
  return JSON.stringify({
    childId: resource.childId,
    componentType: resource.componentType,
    moduleType: resource.moduleType
  });
}

function fileLevelFallbackFileId(resource: LaunchResource): string | undefined {
  if (
    resource.identity.resourceType !== "unmapped" ||
    resource.identity.launchResourceId ||
    resource.metadata.fallbackKind !== "canonical-source" ||
    resource.fileIds.length !== 1
  ) {
    return undefined;
  }

  return resource.fileIds[0];
}

function hasUnresolvedFiles(library: ResolvedLibrary): boolean {
  return library.files.some(
    (file) =>
      file.state === "failed" ||
      file.state === "skipped-limit" ||
      file.state === "unsupported"
  );
}

function warningsForCompleteness(
  library: ResolvedLibrary,
  side: "base" | "compare"
): AnalysisWarning[] {
  if (library.completeness.state === "complete") {
    return [];
  }

  return [
    createComparisonWarning(
      `${side}-library-${library.completeness.state}`,
      `${side} library analysis is ${library.completeness.state}.`
    )
  ];
}

function createComparisonWarning(code: string, message: string): AnalysisWarning {
  return {
    id: `comparison:${code}`,
    severity: code === "property-mismatch" ? "error" : "warning",
    code,
    message
  };
}
