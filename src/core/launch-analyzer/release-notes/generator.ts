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
  rules: string[];
  dataElements: string[];
  extensions: string[];
  runtimeAndUnmapped: string[];
  dependencyImpact: string[];
  warnings: string[];
}

export function generateReleaseNotes(
  comparison: ComparisonResult,
  options: GenerateReleaseNotesOptions = {}
): string {
  const sections = buildReleaseNoteSections(comparison, options);
  const lines = [`# ${options.title ?? "Release Notes"}`];

  appendChangesSection(lines, sections);
  appendSection(lines, "Dependency Impact", sections.dependencyImpact);
  appendSection(lines, "Analysis Warnings", sections.warnings);

  if (lines.length === 1) {
    lines.push("", "No release-note entries were generated from this comparison.");
  }

  return `${lines.join("\n")}\n`;
}

function buildReleaseNoteSections(
  comparison: ComparisonResult,
  options: GenerateReleaseNotesOptions
): ReleaseNoteSections {
  return {
    ...directChangeSections(comparison.resources),
    dependencyImpact: dependencyImpactNotes(
      comparison.impacts,
      options.maxImpactedResourcesPerChange ?? 7
    ),
    warnings: warningNotes(comparison)
  };
}

function directChangeSections(comparisons: ResourceComparison[]): Omit<
  ReleaseNoteSections,
  "dependencyImpact" | "warnings"
> {
  const sections = {
    rules: [] as string[],
    dataElements: [] as string[],
    extensions: [] as string[],
    runtimeAndUnmapped: [] as string[]
  };
  const unmappedSummary = {
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
        unmappedSummary[comparison.status as keyof typeof unmappedSummary] += 1;
      }
      continue;
    }

    const note = directResourceNote(comparison);

    if (!note) {
      continue;
    }

    sectionForResourceType(sections, resource.identity.resourceType).push(note);

    for (const referenceNote of dataElementReferenceNotes(comparison)) {
      sectionForResourceType(sections, resource.identity.resourceType).push(referenceNote);
    }
  }

  for (const [status, count] of Object.entries(unmappedSummary)) {
    if (count > 0) {
      sections.runtimeAndUnmapped.push(unmappedSummaryNote(status, count));
    }
  }

  return sections;
}

function directResourceNote(comparison: ResourceComparison): string | undefined {
  const resource = comparison.compare ?? comparison.base;

  if (!resource) {
    return undefined;
  }

  const name = quotedResourceName(resource);

  if (comparison.status === "added") {
    return `Added ${name} ${resourceTypeLabel(resource.identity.resourceType)}.`;
  }

  if (comparison.status === "removed") {
    return `Removed ${name} ${resourceTypeLabel(resource.identity.resourceType)}.`;
  }

  if (comparison.status === "unknown") {
    return `Could not determine whether ${name} ${resourceTypeLabel(
      resource.identity.resourceType
    )} was added or removed because a counterpart resource is unresolved.`;
  }

  if (comparison.status !== "modified") {
    return undefined;
  }

  const orderingChanged = comparison.structuredChanges.some((change) => change.kind === "ordering");

  if (orderingChanged && resource.identity.resourceType === "rule") {
    return `Updated execution order in ${name} rule.`;
  }

  if (resource.identity.resourceType === "extension") {
    return `Updated configuration for ${name} extension.`;
  }

  if (resource.identity.resourceType === "runtime") {
    return "Updated runtime configuration.";
  }

  return `Updated ${name} ${resourceTypeLabel(resource.identity.resourceType)}.`;
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

  const resourceName = quotedResourceName(comparison.compare);

  if (removed.length === 1 && added.length === 1) {
    if (sameResolvedTarget.length === 1) {
      return [
        `Updated Data Element reference text in ${resourceName} from ${quoteName(
          removed[0]!
        )} to ${quoteName(added[0]!)} while resolving to the same data element.`
      ];
    }

    return [
      `Updated Data Element references in ${resourceName}: now references ${quoteName(
        added[0]!
      )} instead of ${quoteName(removed[0]!)}.`
    ];
  }

  const notes: string[] = [];

  if (added.length > 0) {
    notes.push(
      `Updated Data Element references in ${resourceName}: now references ${formatNameList(added)}.`
    );
  }

  if (removed.length > 0) {
    notes.push(
      `Updated Data Element references in ${resourceName}: no longer references ${formatNameList(
        removed
      )}.`
    );
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

  return [...byChangedResource.entries()].flatMap(([changedResourceId, impactPaths]) => {
    const changedName = impactPaths[0]?.changedResourceName ?? changedResourceId;
    const impactedResources = unique(
      impactPaths.map((impact) => impact.resourceNames[0] ?? impact.resourceIds[0]!)
    );
    const hiddenCount = Math.max(0, impactedResources.length - maxImpactedResourcesPerChange);
    const lines = [
      `${codeName(changedName)} was modified and is referenced directly or indirectly by ${
        impactedResources.length
      } ${pluralize("resource", impactedResources.length)}.`
    ];

    for (const impactedResource of impactedResources.slice(0, maxImpactedResourcesPerChange)) {
      lines.push(`  - ${codeName(impactedResource)}`);
    }

    if (hiddenCount > 0) {
      lines.push(`  - ${hiddenCount} more ${pluralize("resource", hiddenCount)} not listed.`);
    }

    return lines;
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
      `${completeness.failed} of ${completeness.discovered} ${side}-library resources could not be retrieved. Results may not represent every deployed change.`
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

function appendChangesSection(lines: string[], sections: ReleaseNoteSections): void {
  const hasChanges =
    sections.rules.length > 0 ||
    sections.dataElements.length > 0 ||
    sections.extensions.length > 0 ||
    sections.runtimeAndUnmapped.length > 0;

  if (!hasChanges) {
    return;
  }

  lines.push("", "## Changes");
  appendSubsection(lines, "Rules", sections.rules);
  appendSubsection(lines, "Data Elements", sections.dataElements);
  appendSubsection(lines, "Extensions", sections.extensions);
  appendSubsection(lines, "Runtime / Unmapped", sections.runtimeAndUnmapped);
}

function appendSection(lines: string[], title: string, entries: string[]): void {
  if (entries.length === 0) {
    return;
  }

  lines.push(
    "",
    `## ${title}`,
    ...entries.map((entry) => (entry.startsWith("  - ") ? entry : `- ${entry}`))
  );
}

function appendSubsection(lines: string[], title: string, entries: string[]): void {
  if (entries.length === 0) {
    return;
  }

  lines.push("", `### ${title}`, ...entries.map((entry) => `- ${entry}`));
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

function sectionForResourceType(
  sections: Omit<ReleaseNoteSections, "dependencyImpact" | "warnings">,
  resourceType: ResourceType
): string[] {
  if (resourceType === "rule") {
    return sections.rules;
  }

  if (resourceType === "data-element") {
    return sections.dataElements;
  }

  if (resourceType === "extension") {
    return sections.extensions;
  }

  return sections.runtimeAndUnmapped;
}

function resourceTypeLabel(resourceType: ResourceType): string {
  if (resourceType === "data-element") {
    return "data element";
  }

  return resourceType;
}

function unmappedSummaryNote(status: string, count: number): string {
  return `${unmappedSummaryVerb(status)} ${count} unmapped ${pluralize(
    "library resource",
    count
  )}. Review the comparison for details.`;
}

function unmappedSummaryVerb(status: string): string {
  if (status === "added") {
    return "Added";
  }

  if (status === "removed") {
    return "Removed";
  }

  if (status === "unknown") {
    return "Could not classify";
  }

  return "Modified";
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

function quoteName(value: string): string {
  return `"${value.replaceAll("\"", "\\\"")}"`;
}

function codeName(value: string): string {
  return `\`${value.replaceAll("`", "\\`")}\``;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function pluralize(noun: string, count: number): string {
  return count === 1 ? noun : `${noun}s`;
}
