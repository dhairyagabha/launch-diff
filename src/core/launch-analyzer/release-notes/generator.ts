import { resourceGraphId } from "../dependencies/data-elements";
import type {
  AnalysisWarning,
  ComparisonResult,
  DataElementReference,
  DependencyImpactPath,
  LaunchResource,
  ResourceComparison,
  ResourceType
} from "../model/types";

const RESOURCE_TYPE_ORDER: ResourceType[] = [
  "rule",
  "data-element",
  "extension",
  "runtime",
  "unmapped"
];

export interface GenerateReleaseNotesOptions {
  title?: string;
  maxImpactedResourcesPerChange?: number;
}

interface ReleaseNoteSections {
  summary: string[];
  directChanges: string[];
  referenceChanges: string[];
  dependencyImpact: string[];
  warnings: string[];
}

interface StatusCounts {
  added: number;
  removed: number;
  modified: number;
  unknown: number;
}

export function generateReleaseNotes(
  comparison: ComparisonResult,
  options: GenerateReleaseNotesOptions = {}
): string {
  const sections = buildReleaseNoteSections(comparison, options);
  const lines = [`# ${options.title ?? "LaunchDiff Review Summary"}`];
  const hasReviewEntries =
    sections.directChanges.length > 0 ||
    sections.referenceChanges.length > 0 ||
    sections.dependencyImpact.length > 0 ||
    sections.warnings.length > 0;

  if (!hasReviewEntries) {
    lines.push("", "No deployed changes, dependency impact, or analysis warnings were detected.");
    return `${lines.join("\n")}\n`;
  }

  appendSection(lines, "Summary", sections.summary);
  appendSection(lines, "Direct Changes", sections.directChanges);
  appendSection(lines, "Data Element References", sections.referenceChanges);
  appendSection(lines, "Dependency Impact", sections.dependencyImpact);
  appendSection(lines, "Analysis Warnings", sections.warnings);

  return `${lines.join("\n")}\n`;
}

function buildReleaseNoteSections(
  comparison: ComparisonResult,
  options: GenerateReleaseNotesOptions
): ReleaseNoteSections {
  const warnings = warningNotes(comparison);
  const statusCounts = directStatusCounts(comparison.resources);
  const dependencyImpact = dependencyImpactNotes(
    comparison.impacts,
    options.maxImpactedResourcesPerChange ?? 7
  );

  return {
    summary: summaryNotes({
      statusCounts,
      impactedResourceCount: impactedResourceCount(comparison.impacts),
      warningCount: warnings.length
    }),
    directChanges: directChangeNotes(comparison.resources),
    referenceChanges: dataElementReferenceChangeNotes(comparison.resources),
    dependencyImpact,
    warnings
  };
}

function summaryNotes(input: {
  statusCounts: StatusCounts;
  impactedResourceCount: number;
  warningCount: number;
}): string[] {
  const directTotal =
    input.statusCounts.added +
    input.statusCounts.removed +
    input.statusCounts.modified +
    input.statusCounts.unknown;
  const statusParts = [
    countPhrase(input.statusCounts.modified, "modified"),
    countPhrase(input.statusCounts.added, "added"),
    countPhrase(input.statusCounts.removed, "removed"),
    countPhrase(input.statusCounts.unknown, "needs review")
  ].filter((part): part is string => Boolean(part));
  const notes = [
    directTotal > 0
      ? `Direct changes: ${directTotal} (${statusParts.join(", ")}).`
      : "Direct changes: none."
  ];

  if (input.impactedResourceCount > 0) {
    notes.push(
      `Dependency impact: ${input.impactedResourceCount} ${pluralize(
        "resource",
        input.impactedResourceCount
      )}.`
    );
  }

  if (input.warningCount > 0) {
    notes.push(
      `Analysis warnings: ${input.warningCount} ${pluralize("warning", input.warningCount)}.`
    );
  }

  return notes;
}

function directStatusCounts(comparisons: ResourceComparison[]): StatusCounts {
  return comparisons.reduce<StatusCounts>(
    (counts, comparison) => {
      if (comparison.status === "added") {
        counts.added += 1;
      } else if (comparison.status === "removed") {
        counts.removed += 1;
      } else if (comparison.status === "modified") {
        counts.modified += 1;
      } else if (comparison.status === "unknown") {
        counts.unknown += 1;
      }

      return counts;
    },
    {
      added: 0,
      removed: 0,
      modified: 0,
      unknown: 0
    }
  );
}

function directChangeNotes(comparisons: ResourceComparison[]): string[] {
  const notes: string[] = [];
  const unmappedSummary: StatusCounts = {
    added: 0,
    removed: 0,
    modified: 0,
    unknown: 0
  };

  for (const comparison of sortComparisons(comparisons)) {
    const resource = comparison.compare ?? comparison.base;

    if (!resource || comparison.status === "unchanged") {
      continue;
    }

    if (resource.identity.resourceType === "unmapped") {
      if (comparison.status in unmappedSummary) {
        unmappedSummary[comparison.status as keyof StatusCounts] += 1;
      }
      continue;
    }

    const note = directResourceNote(comparison);

    if (note) {
      notes.push(note);
    }
  }

  for (const [status, count] of Object.entries(unmappedSummary)) {
    if (count > 0) {
      notes.push(unmappedSummaryNote(status, count));
    }
  }

  return notes;
}

function directResourceNote(comparison: ResourceComparison): string | undefined {
  const resource = comparison.compare ?? comparison.base;

  if (!resource) {
    return undefined;
  }

  const type = titleResourceTypeLabel(resource.identity.resourceType);
  const name = quotedResourceName(resource);

  if (comparison.status === "added") {
    return `${type} ${name} was added.`;
  }

  if (comparison.status === "removed") {
    return `${type} ${name} was removed.`;
  }

  if (comparison.status === "unknown") {
    return `${type} ${name} needs review ${unknownReason(comparison)}.`;
  }

  if (comparison.status !== "modified") {
    return undefined;
  }

  const orderingChanged = comparison.structuredChanges.some((change) => change.kind === "ordering");

  if (orderingChanged && resource.identity.resourceType === "rule") {
    return `${type} ${name} changed execution order.`;
  }

  if (resource.identity.resourceType === "extension") {
    return `${type} ${name} configuration changed.`;
  }

  if (resource.identity.resourceType === "runtime") {
    return "Runtime configuration changed.";
  }

  return `${type} ${name} changed.`;
}

function dataElementReferenceChangeNotes(comparisons: ResourceComparison[]): string[] {
  return sortComparisons(comparisons).flatMap(dataElementReferenceNotes);
}

function dataElementReferenceNotes(comparison: ResourceComparison): string[] {
  if (!comparison.base || !comparison.compare || comparison.status === "unchanged") {
    return [];
  }

  const baseReferences = comparableDataElementReferences(comparison.base.dataElementReferences);
  const compareReferences = comparableDataElementReferences(comparison.compare.dataElementReferences);
  const baseNames = new Set(referenceTargetNames(baseReferences));
  const compareNames = new Set(referenceTargetNames(compareReferences));
  const removed = [...baseNames].filter((name) => !compareNames.has(name));
  const added = [...compareNames].filter((name) => !baseNames.has(name));
  const sameResolvedTarget = removed.flatMap((removedName) =>
    added.filter((addedName) =>
      referencesShareResolvedTarget(baseReferences, compareReferences, removedName, addedName)
    )
  );

  if (removed.length === 0 && added.length === 0) {
    return [];
  }

  const resourceName = `${titleResourceTypeLabel(comparison.compare.identity.resourceType)} ${
    quotedResourceName(comparison.compare)
  }`;

  if (removed.length === 1 && added.length === 1) {
    if (sameResolvedTarget.length === 1) {
      return [
        `${resourceName} changed Data Element reference text from ${quoteName(
          removed[0]!
        )} to ${quoteName(added[0]!)} while resolving to the same Data Element.`
      ];
    }

    return [
      `${resourceName} now references ${quoteName(added[0]!)} instead of ${quoteName(
        removed[0]!
      )}.`
    ];
  }

  const notes: string[] = [];

  if (added.length > 0) {
    notes.push(`${resourceName} now references ${formatNameList(added)}.`);
  }

  if (removed.length > 0) {
    notes.push(`${resourceName} no longer references ${formatNameList(removed)}.`);
  }

  return notes;
}

function dependencyImpactNotes(
  impacts: DependencyImpactPath[],
  maxImpactedResourcesPerChange: number
): string[] {
  const byChangedResource = new Map<string, DependencyImpactPath[]>();

  for (const impact of impacts) {
    byChangedResource.set(impact.changedResourceId, [
      ...(byChangedResource.get(impact.changedResourceId) ?? []),
      impact
    ]);
  }

  return [...byChangedResource.entries()]
    .sort(([leftId, leftImpacts], [rightId, rightImpacts]) =>
      changedResourceDisplayName(leftId, leftImpacts).localeCompare(
        changedResourceDisplayName(rightId, rightImpacts)
      )
    )
    .map(([changedResourceId, impactPaths]) => {
      const changedName = changedResourceDisplayName(changedResourceId, impactPaths);
      const impactedResources = unique(
        impactPaths
          .map((impact) => last(impact.resourceNames) ?? last(impact.resourceIds))
          .filter((name): name is string => Boolean(name))
      );
      const impactedSummary = formatNameSummary(
        impactedResources,
        maxImpactedResourcesPerChange
      );

      return `${changedName} impacts ${impactedResources.length} ${pluralize(
        "resource",
        impactedResources.length
      )}${impactedSummary ? `: ${impactedSummary}` : ""}.`;
    });
}

function warningNotes(comparison: ComparisonResult): string[] {
  const warnings = [
    ...completenessWarnings("Base", comparison.base.completeness),
    ...completenessWarnings("Compare", comparison.compare.completeness),
    ...comparison.warnings
      .filter((warning) => !isCompletenessComparisonWarning(warning))
      .map((warning) => warning.message)
  ];

  return unique(warnings);
}

function completenessWarnings(
  side: "Base" | "Compare",
  completeness: ComparisonResult["base"]["completeness"]
): string[] {
  const warnings: string[] = [];

  if (completeness.failed > 0) {
    warnings.push(
      `${side} library: ${completeness.failed} of ${completeness.discovered} resources could not be retrieved. Results may not represent every deployed change.`
    );
  }

  if (
    completeness.state === "incomplete-retry-recommended" ||
    completeness.state === "failed"
  ) {
    warnings.push(
      "Comparison is incomplete and retry is recommended before relying on these release notes."
    );
  }

  return warnings;
}

function appendSection(lines: string[], title: string, entries: string[]): void {
  if (entries.length === 0) {
    return;
  }

  lines.push("", `## ${title}`, ...entries.map((entry) => `- ${entry}`));
}

function sortComparisons(comparisons: ResourceComparison[]): ResourceComparison[] {
  return [...comparisons].sort((left, right) => {
    const leftResource = left.compare ?? left.base;
    const rightResource = right.compare ?? right.base;
    const typeDelta =
      resourceTypeRank(leftResource?.identity.resourceType) -
      resourceTypeRank(rightResource?.identity.resourceType);

    if (typeDelta !== 0) {
      return typeDelta;
    }

    return displayName(leftResource).localeCompare(displayName(rightResource));
  });
}

function resourceTypeRank(resourceType: ResourceType | undefined): number {
  const index = resourceType ? RESOURCE_TYPE_ORDER.indexOf(resourceType) : -1;

  return index === -1 ? RESOURCE_TYPE_ORDER.length : index;
}

function titleResourceTypeLabel(resourceType: ResourceType): string {
  if (resourceType === "data-element") {
    return "Data Element";
  }

  if (resourceType === "rule") {
    return "Rule";
  }

  if (resourceType === "extension") {
    return "Extension";
  }

  if (resourceType === "runtime") {
    return "Runtime";
  }

  return "Unmapped resource";
}

function unmappedSummaryNote(status: string, count: number): string {
  return `${count} unmapped ${pluralize("library resource", count)} ${unmappedStatusPhrase(
    status
  )}. Review the detailed comparison for the exact file-level changes.`;
}

function unmappedStatusPhrase(status: string): string {
  if (status === "added") {
    return "were added";
  }

  if (status === "removed") {
    return "were removed";
  }

  if (status === "unknown") {
    return "need review";
  }

  return "changed";
}

function comparableDataElementReferences(
  references: DataElementReference[]
): DataElementReference[] {
  return references.filter(
    (reference) =>
      reference.resolution !== "dynamic" &&
      reference.targetName !== undefined &&
      reference.rawExpression.trim() !== ""
  );
}

function referenceTargetNames(references: DataElementReference[]): string[] {
  return references
    .map((reference) => reference.targetName)
    .filter((name): name is string => Boolean(name));
}

function referencesShareResolvedTarget(
  baseReferences: DataElementReference[],
  compareReferences: DataElementReference[],
  baseName: string,
  compareName: string
): boolean {
  const baseTargets = new Set(
    baseReferences
      .filter((reference) => reference.targetName === baseName)
      .map((reference) => reference.targetResourceId)
      .filter((target): target is string => Boolean(target))
  );
  const compareTargets = new Set(
    compareReferences
      .filter((reference) => reference.targetName === compareName)
      .map((reference) => reference.targetResourceId)
      .filter((target): target is string => Boolean(target))
  );

  return [...baseTargets].some((target) => compareTargets.has(target));
}

function isCompletenessComparisonWarning(warning: AnalysisWarning): boolean {
  return /^comparison:(base|compare)-library-/.test(warning.id);
}

function unknownReason(comparison: ResourceComparison): string {
  const unresolvedChange = comparison.structuredChanges.find((change) => change.kind === "unresolved");

  if (unresolvedChange?.id.includes("external-custom-code-unresolved")) {
    return "because external custom-code source content could not be resolved";
  }

  if (unresolvedChange?.id.includes("unresolved-counterpart")) {
    return "because unresolved files may hide the counterpart resource";
  }

  return "because LaunchDiff could not prove the resource state";
}

function changedResourceDisplayName(
  changedResourceId: string,
  impactPaths: DependencyImpactPath[]
): string {
  const changedName = impactPaths[0]?.changedResourceName ?? changedResourceId;
  const resourceType = resourceTypeFromGraphId(changedResourceId);

  return resourceType
    ? `${titleResourceTypeLabel(resourceType)} ${quoteName(changedName)}`
    : quoteName(changedName);
}

function resourceTypeFromGraphId(value: string): ResourceType | undefined {
  const resourceType = value.split(":")[0];

  return RESOURCE_TYPE_ORDER.includes(resourceType as ResourceType)
    ? (resourceType as ResourceType)
    : undefined;
}

function impactedResourceCount(impacts: DependencyImpactPath[]): number {
  return unique(
    impacts.map((impact) => last(impact.resourceIds)).filter((id): id is string => Boolean(id))
  ).length;
}

function last<T>(values: T[]): T | undefined {
  return values[values.length - 1];
}

function quotedResourceName(resource: LaunchResource): string {
  return quoteName(displayName(resource));
}

function displayName(resource: LaunchResource | undefined): string {
  if (!resource) {
    return "Unidentified resource";
  }

  return resource.identity.name ?? resource.identity.launchResourceId ?? resourceGraphId(resource);
}

function formatNameList(names: string[]): string {
  return names.map(quoteName).join(", ");
}

function formatNameSummary(names: string[], maxNames: number): string {
  const visibleNames = names.slice(0, maxNames);
  const hiddenCount = Math.max(0, names.length - visibleNames.length);
  const formattedNames = visibleNames.map(quoteName);

  if (hiddenCount === 0) {
    return formattedNames.join(", ");
  }

  return `${formattedNames.join(", ")} and ${hiddenCount} more`;
}

function quoteName(value: string): string {
  return `"${value.replaceAll("\"", "\\\"")}"`;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function countPhrase(count: number, label: string): string | undefined {
  return count > 0 ? `${count} ${label}` : undefined;
}

function pluralize(noun: string, count: number): string {
  return count === 1 ? noun : `${noun}s`;
}
