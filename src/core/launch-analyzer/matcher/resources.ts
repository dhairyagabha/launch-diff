import type {
  LaunchChildComponent,
  LaunchResource,
  MatchProvenance,
  ResourceComparison,
  ResourceKey
} from "../model/types";

export interface ChildComponentComparison {
  base?: LaunchChildComponent;
  compare?: LaunchChildComponent;
  match: MatchProvenance;
}

interface IndexedChild {
  component: LaunchChildComponent;
  index: number;
}

interface FuzzyCandidate {
  base: IndexedChild;
  compare: IndexedChild;
  score: number;
  notes: string[];
}

export function matchLaunchResources(
  baseResources: LaunchResource[],
  compareResources: LaunchResource[]
): ResourceComparison[] {
  const comparisons: ResourceComparison[] = [];
  const baseByKey = indexMatchableTopLevelResources(baseResources);
  const compareByKey = indexMatchableTopLevelResources(compareResources);
  const consumedBase = new Set<LaunchResource>();
  const consumedCompare = new Set<LaunchResource>();

  for (const [key, baseMatches] of baseByKey.entries()) {
    const compareMatches = compareByKey.get(key) ?? [];

    if (baseMatches.length === 1 && compareMatches.length === 1) {
      const base = baseMatches[0]!;
      const compare = compareMatches[0]!;
      consumedBase.add(base);
      consumedCompare.add(compare);
      comparisons.push(createMatchedResourceComparison(base, compare));
    }
  }

  for (const resource of baseResources) {
    if (!consumedBase.has(resource)) {
      comparisons.push(createUnmatchedResourceComparison(resource, "removed"));
    }
  }

  for (const resource of compareResources) {
    if (!consumedCompare.has(resource)) {
      comparisons.push(createUnmatchedResourceComparison(resource, "added"));
    }
  }

  return comparisons;
}

export function matchLaunchChildComponents(
  baseChildren: LaunchChildComponent[],
  compareChildren: LaunchChildComponent[]
): ChildComponentComparison[] {
  const comparisons: ChildComponentComparison[] = [];
  const baseRemaining = new Map(baseChildren.map((component, index) => [index, { component, index }]));
  const compareRemaining = new Map(
    compareChildren.map((component, index) => [index, { component, index }])
  );

  matchChildrenById(comparisons, baseRemaining, compareRemaining);
  matchChildrenByExactSignature(comparisons, baseRemaining, compareRemaining);
  matchChildrenByConservativeFuzzyFallback(comparisons, baseRemaining, compareRemaining);

  for (const base of baseRemaining.values()) {
    comparisons.push({
      base: base.component,
      match: {
        method: "unmatched",
        confidence: "certain"
      }
    });
  }

  for (const compare of compareRemaining.values()) {
    comparisons.push({
      compare: compare.component,
      match: {
        method: "unmatched",
        confidence: "certain"
      }
    });
  }

  return comparisons;
}

function matchChildrenById(
  comparisons: ChildComponentComparison[],
  baseRemaining: Map<number, IndexedChild>,
  compareRemaining: Map<number, IndexedChild>
): void {
  const baseById = groupChildren(baseRemaining, (child) => child.component.childId);
  const compareById = groupChildren(compareRemaining, (child) => child.component.childId);

  for (const [childId, baseMatches] of baseById.entries()) {
    const compareMatches = compareById.get(childId) ?? [];

    if (baseMatches.length === 1 && compareMatches.length === 1) {
      acceptChildMatch(comparisons, baseRemaining, compareRemaining, baseMatches[0]!, compareMatches[0]!, {
        method: "launch-child-id",
        confidence: "certain"
      });
    }
  }
}

function matchChildrenByExactSignature(
  comparisons: ChildComponentComparison[],
  baseRemaining: Map<number, IndexedChild>,
  compareRemaining: Map<number, IndexedChild>
): void {
  const baseBySignature = groupChildren(baseRemaining, exactChildSignature);
  const compareBySignature = groupChildren(compareRemaining, exactChildSignature);

  for (const [signature, baseMatches] of baseBySignature.entries()) {
    const compareMatches = compareBySignature.get(signature) ?? [];

    if (baseMatches.length === 1 && compareMatches.length === 1) {
      acceptChildMatch(comparisons, baseRemaining, compareRemaining, baseMatches[0]!, compareMatches[0]!, {
        method: "exact-signature",
        confidence: "certain"
      });
    } else if (baseMatches.length > 0 && compareMatches.length > 0) {
      recordAmbiguousChildCandidates(comparisons, baseMatches, compareMatches, "exact-signature");
    }
  }
}

function matchChildrenByConservativeFuzzyFallback(
  comparisons: ChildComponentComparison[],
  baseRemaining: Map<number, IndexedChild>,
  compareRemaining: Map<number, IndexedChild>
): void {
  const candidates = buildFuzzyCandidates([...baseRemaining.values()], [...compareRemaining.values()]);

  for (const base of [...baseRemaining.values()]) {
    const baseCandidates = candidates
      .filter((candidate) => candidate.base.index === base.index)
      .sort((left, right) => right.score - left.score);
    const best = baseCandidates[0];

    if (!best || best.score < 5) {
      continue;
    }

    const tiedBest = baseCandidates.filter((candidate) => candidate.score === best.score);
    const compareCompetingBest = candidates.filter(
      (candidate) => candidate.compare.index === best.compare.index && candidate.score >= best.score
    );

    if (tiedBest.length === 1 && compareCompetingBest.length === 1) {
      acceptChildMatch(comparisons, baseRemaining, compareRemaining, best.base, best.compare, {
        method: "fuzzy",
        confidence: "high",
        score: best.score,
        notes: best.notes
      });
    } else {
      comparisons.push({
        base: base.component,
        match: {
          method: "fuzzy",
          confidence: "ambiguous",
          score: best.score,
          notes: [
            "Multiple child candidates had equal or competing fuzzy scores; no child match was forced."
          ]
        }
      });
    }
  }
}

function createMatchedResourceComparison(
  base: LaunchResource,
  compare: LaunchResource
): ResourceComparison {
  const unchanged = base.contentFingerprint === compare.contentFingerprint;

  return {
    base,
    compare,
    status: unchanged ? "unchanged" : "modified",
    match: {
      method: "launch-resource-id",
      confidence: "certain"
    },
    structuredChanges: unchanged
      ? []
      : [
          {
            id: resourceComparisonId(base, compare, "content"),
            kind: "content-modified",
            path: [],
            description: "Matched Launch resource content changed."
          }
        ],
    detailedDiffState: "not-started"
  };
}

function createUnmatchedResourceComparison(
  resource: LaunchResource,
  status: "added" | "removed"
): ResourceComparison {
  return {
    ...(status === "removed" ? { base: resource } : { compare: resource }),
    status,
    match: {
      method: "unmatched",
      confidence: "certain"
    },
    structuredChanges: [
      {
        id: resourceComparisonId(resource, undefined, status),
        kind: status === "removed" ? "resource-removed" : "resource-added",
        path: [],
        description: `Launch resource was ${status}.`
      }
    ],
    detailedDiffState: "not-started"
  };
}

function indexMatchableTopLevelResources(resources: LaunchResource[]): Map<ResourceKey, LaunchResource[]> {
  const byKey = new Map<ResourceKey, LaunchResource[]>();

  for (const resource of resources) {
    const id = resource.identity.launchResourceId;

    if (!id) {
      continue;
    }

    const key: ResourceKey = `${resource.identity.resourceType}:${id}`;
    byKey.set(key, [...(byKey.get(key) ?? []), resource]);
  }

  return byKey;
}

function acceptChildMatch(
  comparisons: ChildComponentComparison[],
  baseRemaining: Map<number, IndexedChild>,
  compareRemaining: Map<number, IndexedChild>,
  base: IndexedChild,
  compare: IndexedChild,
  match: MatchProvenance
): void {
  if (!baseRemaining.has(base.index) || !compareRemaining.has(compare.index)) {
    return;
  }

  comparisons.push({
    base: base.component,
    compare: compare.component,
    match
  });
  baseRemaining.delete(base.index);
  compareRemaining.delete(compare.index);
}

function recordAmbiguousChildCandidates(
  comparisons: ChildComponentComparison[],
  baseMatches: IndexedChild[],
  compareMatches: IndexedChild[],
  method: "exact-signature" | "fuzzy"
): void {
  for (const base of baseMatches) {
    comparisons.push({
      base: base.component,
      match: {
        method,
        confidence: "ambiguous",
        notes: [
          `${compareMatches.length} child candidates matched the same ${method} evidence; no child match was forced.`
        ]
      }
    });
  }
}

function buildFuzzyCandidates(
  baseChildren: IndexedChild[],
  compareChildren: IndexedChild[]
): FuzzyCandidate[] {
  return baseChildren.flatMap((base) =>
    compareChildren.map((compare) => {
      const result = fuzzyScore(base, compare);

      return {
        base,
        compare,
        score: result.score,
        notes: result.notes
      };
    })
  );
}

function fuzzyScore(base: IndexedChild, compare: IndexedChild): { score: number; notes: string[] } {
  let score = 0;
  const notes: string[] = [];

  if (base.component.componentType === compare.component.componentType) {
    score += 2;
    notes.push("same component type");
  }

  if (base.component.extensionId && base.component.extensionId === compare.component.extensionId) {
    score += 2;
    notes.push("same extension");
  }

  if (base.component.moduleType && base.component.moduleType === compare.component.moduleType) {
    score += 2;
    notes.push("same module type");
  }

  if (
    base.component.normalizedSource &&
    base.component.normalizedSource === compare.component.normalizedSource
  ) {
    score += 2;
    notes.push("same normalized source");
  }

  if (base.component.name && base.component.name === compare.component.name) {
    score += 1;
    notes.push("same name");
  }

  if (Math.abs(base.index - compare.index) <= 1) {
    score += 1;
    notes.push("nearby sequence position");
  }

  return { score, notes };
}

function groupChildren(
  childrenByIndex: Map<number, IndexedChild>,
  keyForChild: (child: IndexedChild) => string | undefined
): Map<string, IndexedChild[]> {
  const groups = new Map<string, IndexedChild[]>();

  for (const child of childrenByIndex.values()) {
    const key = keyForChild(child);

    if (!key) {
      continue;
    }

    groups.set(key, [...(groups.get(key) ?? []), child]);
  }

  return groups;
}

function exactChildSignature(child: IndexedChild): string {
  return JSON.stringify({
    componentType: child.component.componentType,
    extensionId: child.component.extensionId,
    moduleType: child.component.moduleType,
    normalizedSource: child.component.normalizedSource
  });
}

function resourceComparisonId(
  base: LaunchResource,
  compare: LaunchResource | undefined,
  suffix: string
): string {
  const identity = compare?.identity ?? base.identity;
  const id = identity.launchResourceId ?? identity.name ?? "unidentified";

  return `${identity.resourceType}:${id}:${suffix}`;
}
