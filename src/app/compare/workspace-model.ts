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
