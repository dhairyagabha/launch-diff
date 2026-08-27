import type {
  AnalysisCompleteness,
  ComparisonResult,
  ResourceComparison,
  ResourceType,
  ResolvedFile
} from "@/core/launch-analyzer";

export type ResultTab = "files" | "impacted" | "resolved" | "notes";
export type StatusFilter = "all" | ResourceComparison["status"] | "impacted";
export type TypeFilter = "all" | ResourceType;

export interface ResourceTreeGroup {
  type: ResourceType;
  label: string;
  resources: ResourceComparison[];
}

export interface WorkspaceFilters {
  query: string;
  status: StatusFilter;
  type: TypeFilter;
  showUnchanged: boolean;
  viewedResourceKeys: Set<string>;
}

export interface SanitizedDiagnosticBrowser {
  family: string;
  majorVersion?: string;
}

export interface SanitizedDiagnosticInput {
  comparison: ComparisonResult;
  inputMode: "direct-url" | "saved-config";
  workspacePhase: "setup" | "running" | "ready";
  activeTab: ResultTab;
  reviewProgress: { reviewed: number; total: number };
  browser: SanitizedDiagnosticBrowser;
}

const RESOURCE_TYPE_ORDER: ResourceType[] = [
  "rule",
  "data-element",
  "extension",
  "runtime",
  "unmapped"
];

export function comparisonResourceKey(comparison: ResourceComparison): string {
  const resource = comparison.compare ?? comparison.base;
  const type = resource?.identity.resourceType ?? "unmapped";
  const id = resource?.identity.launchResourceId ?? resource?.identity.name ?? "unidentified";

  return `${type}:${id}`;
}

export function comparisonDisplayName(comparison: ResourceComparison): string {
  const resource = comparison.compare ?? comparison.base;

  return resource?.identity.name ?? resource?.identity.launchResourceId ?? "Unidentified resource";
}

export function resourceTypeLabel(type: ResourceType): string {
  if (type === "data-element") {
    return "Data Elements";
  }

  if (type === "runtime") {
    return "Runtime";
  }

  return `${type.charAt(0).toUpperCase()}${type.slice(1)}s`;
}

export function statusLabel(status: ResourceComparison["status"]): string {
  return `${status.charAt(0).toUpperCase()}${status.slice(1)}`;
}

export function groupResourceComparisons(
  comparisons: ResourceComparison[],
  filters: WorkspaceFilters
): ResourceTreeGroup[] {
  const query = filters.query.trim().toLowerCase();
  const filtered = comparisons.filter((comparison) => {
    const resource = comparison.compare ?? comparison.base;
    const key = comparisonResourceKey(comparison);
    const searchable = [
      comparisonDisplayName(comparison),
      resource?.identity.launchResourceId,
      resource?.identity.resourceType,
      ...(resource?.children.map((child) => child.name ?? child.moduleType ?? "") ?? [])
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    if (
      !filters.showUnchanged &&
      comparison.status === "unchanged" &&
      !comparison.impact?.impacted
    ) {
      return false;
    }

    if (filters.status === "impacted" && !comparison.impact?.impacted) {
      return false;
    }

    if (
      filters.status !== "all" &&
      filters.status !== "impacted" &&
      comparison.status !== filters.status
    ) {
      return false;
    }

    if (filters.type !== "all" && resource?.identity.resourceType !== filters.type) {
      return false;
    }

    if (query && !searchable.includes(query) && !key.toLowerCase().includes(query)) {
      return false;
    }

    return true;
  });

  return RESOURCE_TYPE_ORDER.map((type) => ({
    type,
    label: resourceTypeLabel(type),
    resources: filtered
      .filter(
        (comparison) => (comparison.compare ?? comparison.base)?.identity.resourceType === type
      )
      .sort((left, right) =>
        comparisonDisplayName(left).localeCompare(comparisonDisplayName(right))
      )
  })).filter((group) => group.resources.length > 0);
}

export function comparisonCounts(
  comparison: ComparisonResult
): Record<ResourceComparison["status"] | "impacted" | "changed", number> {
  const counts = {
    added: 0,
    removed: 0,
    modified: 0,
    unchanged: 0,
    unknown: 0,
    impacted: 0,
    changed: 0
  };

  for (const resource of comparison.resources) {
    counts[resource.status] += 1;

    if (
      resource.status === "added" ||
      resource.status === "removed" ||
      resource.status === "modified"
    ) {
      counts.changed += 1;
    }

    if (resource.impact?.impacted) {
      counts.impacted += 1;
    }
  }

  return counts;
}

export function reviewProgress(
  comparison: ComparisonResult,
  viewedResourceKeys: Set<string>
): { reviewed: number; total: number } {
  const changed = comparison.resources.filter(
    (resource) =>
      resource.status === "added" || resource.status === "removed" || resource.status === "modified"
  );

  return {
    reviewed: changed.filter((resource) => viewedResourceKeys.has(comparisonResourceKey(resource)))
      .length,
    total: changed.length
  };
}

export function completenessBanner(
  base: AnalysisCompleteness,
  compare: AnalysisCompleteness
): {
  tone: "success" | "warning" | "danger";
  title: string;
  description: string;
} {
  const states = [base.state, compare.state];

  if (states.includes("failed") || states.includes("incomplete-retry-recommended")) {
    return {
      tone: "danger",
      title: "Incomplete analysis",
      description: "Retry failed resources before relying on this comparison."
    };
  }

  if (states.includes("complete-with-warnings")) {
    return {
      tone: "warning",
      title: "Analysis completed with warnings",
      description: "Some resources failed, but the comparison includes all available evidence."
    };
  }

  return {
    tone: "success",
    title: "Analysis complete",
    description: "All discovered resources were resolved."
  };
}

export function fileDisplayName(file: ResolvedFile): string {
  try {
    const url = new URL(file.authoritativeUrl);
    const parts = url.pathname.split("/").filter(Boolean);

    return parts.at(-1) ?? url.hostname;
  } catch {
    return file.id;
  }
}

export function buildSanitizedDiagnosticReport(input: SanitizedDiagnosticInput): string {
  const resourceCounts = comparisonCounts(input.comparison);

  return JSON.stringify(
    {
      launchDiff: {
        version: "0.1.0",
        analyzerModelVersion: input.comparison.modelVersion
      },
      browser: {
        family: input.browser.family,
        ...(input.browser.majorVersion ? { majorVersion: input.browser.majorVersion } : {})
      },
      analysis: {
        inputMode: input.inputMode,
        workspacePhase: input.workspacePhase,
        activeTab: input.activeTab
      },
      completeness: {
        base: sanitizeCompleteness(input.comparison.base.completeness),
        compare: sanitizeCompleteness(input.comparison.compare.completeness)
      },
      resources: {
        counts: resourceCounts,
        byType: countByResourceType(input.comparison.resources),
        detailedDiffStates: countBy(input.comparison.resources, (comparison) => comparison.detailedDiffState),
        structuredChangeKinds: countStructuredChangeKinds(input.comparison.resources)
      },
      review: input.reviewProgress,
      files: {
        base: summarizeFiles(input.comparison.base.files),
        compare: summarizeFiles(input.comparison.compare.files)
      },
      warnings: {
        total: input.comparison.warnings.length,
        bySeverity: countBy(input.comparison.warnings, (warning) => warning.severity),
        byCode: countBy(input.comparison.warnings, (warning) => warning.code)
      },
      matching: {
        byMethod: countBy(input.comparison.resources, (comparison) => comparison.match?.method ?? "unmatched"),
        byConfidence: countBy(
          input.comparison.resources,
          (comparison) => comparison.match?.confidence ?? "unmatched"
        )
      },
      degradation: {
        unknownResources: resourceCounts.unknown,
        unmappedResources: countUnmappedResources(input.comparison.resources),
        impactedResources: resourceCounts.impacted,
        unresolvedDetailedDiffs: input.comparison.resources.filter(
          (comparison) => comparison.detailedDiffState !== "ready"
        ).length
      }
    },
    null,
    2
  );
}

function sanitizeCompleteness(completeness: AnalysisCompleteness): AnalysisCompleteness {
  return {
    state: completeness.state,
    discovered: completeness.discovered,
    resolved: completeness.resolved,
    failed: completeness.failed,
    failureRate: completeness.failureRate,
    ...(completeness.limitReached === undefined ? {} : { limitReached: completeness.limitReached })
  };
}

function summarizeFiles(files: ResolvedFile[]): {
  total: number;
  byState: Record<string, number>;
  failureCategories: Record<string, number>;
} {
  return {
    total: files.length,
    byState: countBy(files, (file) => file.state),
    failureCategories: countBy(
      files.filter((file) => file.state !== "resolved"),
      (file) => failureCategory(file)
    )
  };
}

function failureCategory(file: ResolvedFile): string {
  if (file.state === "skipped-limit" || file.state === "unsupported") {
    return file.state;
  }

  const status = file.fetch.httpStatus;

  if (status === undefined) {
    return "unknown";
  }

  if (status === 429) {
    return "http-429";
  }

  if (status >= 500) {
    return "http-5xx";
  }

  if (status >= 400) {
    return "http-4xx";
  }

  return "http-other";
}

function countByResourceType(resources: ResourceComparison[]): Record<ResourceType, number> {
  return RESOURCE_TYPE_ORDER.reduce(
    (counts, type) => ({
      ...counts,
      [type]: resources.filter(
        (comparison) => (comparison.compare ?? comparison.base)?.identity.resourceType === type
      ).length
    }),
    {} as Record<ResourceType, number>
  );
}

function countStructuredChangeKinds(resources: ResourceComparison[]): Record<string, number> {
  return countBy(
    resources.flatMap((comparison) => comparison.structuredChanges),
    (change) => change.kind
  );
}

function countUnmappedResources(resources: ResourceComparison[]): number {
  return resources.filter(
    (comparison) => (comparison.compare ?? comparison.base)?.identity.resourceType === "unmapped"
  ).length;
}

function countBy<T>(items: T[], keyForItem: (item: T) => string): Record<string, number> {
  return items.reduce<Record<string, number>>((counts, item) => {
    const key = keyForItem(item);
    counts[key] = (counts[key] ?? 0) + 1;

    return counts;
  }, {});
}
