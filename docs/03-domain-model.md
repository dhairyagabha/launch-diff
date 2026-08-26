# 03 — Domain Model

The analyzer model is a stable, typed, internally versioned contract.

```ts
export const ANALYZER_MODEL_VERSION = 1;
```

Names below are illustrative but should be preserved conceptually.

## Resource identity

```ts
export type ResourceType =
  | "rule"
  | "data-element"
  | "extension"
  | "runtime"
  | "unmapped";

export interface ResourceIdentity {
  resourceType: ResourceType;
  launchResourceId?: string;
  name?: string;
}
```

Top-level match key when ID exists:

```ts
type ResourceKey = `${ResourceType}:${string}`;
```

## Fetch metadata

```ts
export interface FetchMetadata {
  requestedUrl: string;
  finalUrl?: string;
  fetchedAt: string;
  httpStatus?: number;
  contentType?: string;
  byteLength?: number;
  attempts: number;
}
```

This metadata is informational and generally excluded from semantic change classification.

## Resolved file

```ts
export type ResolvedFileState =
  | "resolved"
  | "failed"
  | "skipped-limit"
  | "unsupported";

export type DisplaySourceOrigin =
  | "deployed"
  | "verified-unminified"
  | "pretty-printed-deployed";

export interface ResolvedFile {
  id: string;
  authoritativeUrl: string;
  aliases: string[];
  state: ResolvedFileState;
  fetch: FetchMetadata;
  deployedSource?: string;
  displaySource?: string;
  displaySourceOrigin?: DisplaySourceOrigin;
  owners: ResourceOwnerRef[];
  discoveredBy?: DiscoveryProvenance;
  warningIds: string[];
}
```

## Ownership

```ts
export interface ResourceOwnerRef {
  resourceType: ResourceType;
  resourceId?: string;
  resourceName?: string;
  childPath?: string[];
}
```

A file may have many owners; an owner may reference many files.

## Launch resource

```ts
export interface LaunchResource {
  identity: ResourceIdentity;
  parentId?: string;
  raw: unknown;
  normalized: unknown;
  normalizedSource?: string;
  contentFingerprint: string;
  children: LaunchChildComponent[];
  fileIds: string[];
  dataElementReferences: DataElementReference[];
  metadata: Record<string, unknown>;
  warnings: string[];
}
```

## Child component

```ts
export interface LaunchChildComponent {
  childId?: string;
  componentType: "event" | "condition" | "action" | "module" | "other";
  extensionId?: string;
  moduleType?: string;
  name?: string;
  order?: number;
  raw: unknown;
  normalized: unknown;
  normalizedSource?: string;
}
```

## Match provenance

```ts
export type MatchMethod =
  | "launch-resource-id"
  | "launch-child-id"
  | "exact-signature"
  | "file-id-fallback"
  | "fuzzy"
  | "unmatched";

export type MatchConfidence = "certain" | "high" | "ambiguous";

export interface MatchProvenance {
  method: MatchMethod;
  confidence: MatchConfidence;
  score?: number;
  notes?: string[];
}
```

Top-level matched resources must use `launch-resource-id` only.
`file-id-fallback` is reserved for parser-marked unmapped canonical-source resources and must not
be used to imply a semantic Launch resource relationship.

## Data Element reference

```ts
export type DataElementReferenceMethod =
  | "percent-token"
  | "satellite-get-var";

export interface DataElementReference {
  method: DataElementReferenceMethod;
  rawExpression: string;
  targetName?: string;
  targetResourceId?: string;
  resolution: "resolved" | "unresolved" | "dynamic";
  sourcePath?: string[];
}
```

## Library metadata

```ts
export interface LibraryMetadata {
  propertyId?: string;
  propertyName?: string;
  environmentId?: string;
  environmentName?: string;
  environmentStage?: string;
  buildDate?: string;
  turbineBuildDate?: string;
  turbineVersion?: string;
  minified?: boolean;
  canonicalUrl: string;
  discoveredResourceCount: number;
  resolvedResourceCount: number;
  failedResourceCount: number;
}
```

Metadata is shown in UI but ordinary environment/build differences do not automatically produce resource modifications.

## Resolved library

```ts
export interface ResolvedLibrary {
  modelVersion: number;
  metadata: LibraryMetadata;
  resources: LaunchResource[];
  files: ResolvedFile[];
  dependencyGraph: DependencyGraph;
  warnings: AnalysisWarning[];
  completeness: AnalysisCompleteness;
}
```

## Comparison status

```ts
export type ChangeStatus =
  | "added"
  | "removed"
  | "modified"
  | "unchanged"
  | "unknown";

export interface ResourceComparison {
  base?: LaunchResource;
  compare?: LaunchResource;
  status: ChangeStatus;
  match?: MatchProvenance;
  structuredChanges: StructuredChange[];
  impact?: ResourceImpact;
  detailedDiffState: "not-started" | "queued" | "running" | "ready" | "failed";
  detailedDiff?: DetailedDiff;
}
```

`unknown` means LaunchDiff cannot prove Added/Removed because a counterpart side has unresolved,
skipped, or unsupported files.

## Impact

```ts
export interface ResourceImpact {
  impacted: boolean;
  paths: DependencyImpactPath[];
}

export interface DependencyImpactPath {
  changedResourceId: string;
  changedResourceName?: string;
  resourceIds: string[];
  resourceNames: string[];
  direct: boolean;
}
```

## Analysis completeness

```ts
export type AnalysisCompletenessState =
  | "complete"
  | "complete-with-warnings"
  | "incomplete-retry-recommended"
  | "failed";

export interface AnalysisCompleteness {
  state: AnalysisCompletenessState;
  discovered: number;
  resolved: number;
  failed: number;
  failureRate: number;
  limitReached?: boolean;
}
```

Evaluate independently for Base and Compare.

## Comparison result

```ts
export interface ComparisonResult {
  modelVersion: number;
  base: ResolvedLibrary;
  compare: ResolvedLibrary;
  resources: ResourceComparison[];
  impacts: DependencyImpactPath[];
  warnings: AnalysisWarning[];
  releaseNotes: string;
}
```

## Progress

```ts
export type AnalysisPhase =
  | "fetching-canonical"
  | "parsing"
  | "resolving-deferred"
  | "normalizing"
  | "matching"
  | "dependency-analysis"
  | "comparing"
  | "preparing-diffs"
  | "complete";

export interface AnalysisProgress {
  phase: AnalysisPhase;
  base?: { completed: number; total?: number };
  compare?: { completed: number; total?: number };
  detailedDiffs?: { completed: number; total: number };
  message?: string;
}
```

Never invent a fake percent when total work is not yet known.
