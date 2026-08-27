export type ResourceType = "rule" | "data-element" | "extension" | "runtime" | "unmapped";

export type ResourceKey = `${ResourceType}:${string}`;

export interface ResourceIdentity {
  resourceType: ResourceType;
  launchResourceId?: string;
  name?: string;
}

export interface FetchMetadata {
  requestedUrl: string;
  finalUrl?: string;
  fetchedAt: string;
  httpStatus?: number;
  contentType?: string;
  byteLength?: number;
  attempts: number;
}

export type ResolvedFileState = "resolved" | "failed" | "skipped-limit" | "unsupported";

export type DisplaySourceOrigin = "deployed" | "verified-unminified" | "pretty-printed-deployed";

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

export interface ResourceOwnerRef {
  resourceType: ResourceType;
  resourceId?: string;
  resourceName?: string;
  childPath?: string[];
}

export interface DiscoveryProvenance {
  sourceFileId?: string;
  sourceResource?: ResourceOwnerRef;
  method: "canonical" | "parser-confirmed-deferred";
  sourcePath?: string[];
}

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

export type DataElementReferenceMethod = "percent-token" | "satellite-get-var";

export interface DataElementReference {
  method: DataElementReferenceMethod;
  rawExpression: string;
  targetName?: string;
  targetResourceId?: string;
  resolution: "resolved" | "unresolved" | "dynamic";
  sourcePath?: string[];
}

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

export interface DependencyGraph {
  nodes: DependencyGraphNode[];
  edges: DependencyGraphEdge[];
}

export interface DependencyGraphNode {
  resourceId: string;
  resourceType: ResourceType;
  resourceName?: string;
}

export interface DependencyGraphEdge {
  fromResourceId: string;
  toResourceId: string;
  reference: DataElementReference;
}

export interface AnalysisWarning {
  id: string;
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
  resourceId?: string;
  fileId?: string;
}

export type AnalysisCompletenessState =
  "complete" | "complete-with-warnings" | "incomplete-retry-recommended" | "failed";

export interface AnalysisCompleteness {
  state: AnalysisCompletenessState;
  discovered: number;
  resolved: number;
  failed: number;
  failureRate: number;
  limitReached?: boolean;
}

export interface ResolvedLibrary {
  modelVersion: number;
  metadata: LibraryMetadata;
  resources: LaunchResource[];
  files: ResolvedFile[];
  dependencyGraph: DependencyGraph;
  warnings: AnalysisWarning[];
  completeness: AnalysisCompleteness;
}

export type ChangeStatus = "added" | "removed" | "modified" | "unchanged" | "unknown";

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

export interface StructuredChange {
  id: string;
  kind:
    | "resource-added"
    | "resource-removed"
    | "content-modified"
    | "metadata"
    | "ordering"
    | "dependency-impact"
    | "unresolved";
  path: string[];
  description: string;
  baseValue?: unknown;
  compareValue?: unknown;
}

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

export interface DetailedDiff {
  fileId: string;
  language: "javascript" | "json" | "html" | "css" | "text" | "binary" | "unknown";
  baseDisplaySource?: string;
  compareDisplaySource?: string;
  hunks: DiffHunk[];
  binaryChanged?: boolean;
  functionFolds: FunctionFold[];
}

export interface DiffHunk {
  id: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
  rows: SplitDiffRow[];
  hiddenRows?: SplitDiffRow[];
  collapsed: boolean;
}

export interface SplitDiffRow {
  id: string;
  base?: DiffLine;
  compare?: DiffLine;
  changed: boolean;
}

export type DiffSide = "base" | "compare";

export interface DiffLine {
  id: string;
  type: "context" | "added" | "removed";
  side?: DiffSide;
  oldLineNumber?: number;
  newLineNumber?: number;
  content: string;
  tokens?: DiffToken[];
  syntaxTokens?: SyntaxToken[];
}

export interface DiffToken {
  value: string;
  changed: boolean;
}

export interface SyntaxToken {
  value: string;
  kind:
    | "comment"
    | "identifier"
    | "keyword"
    | "literal"
    | "number"
    | "operator"
    | "punctuation"
    | "string"
    | "tag"
    | "text"
    | "whitespace";
}

export interface FunctionFold {
  id: string;
  name?: string;
  kind: "function" | "arrow-function" | "class-method" | "object-method";
  baseRange?: SourceLineRange;
  compareRange?: SourceLineRange;
  containsChanges: boolean;
  collapsedByDefault: boolean;
  children: FunctionFold[];
}

export interface SourceLineRange {
  startLine: number;
  endLine: number;
}

export interface ComparisonResult {
  modelVersion: number;
  base: ResolvedLibrary;
  compare: ResolvedLibrary;
  resources: ResourceComparison[];
  impacts: DependencyImpactPath[];
  warnings: AnalysisWarning[];
  releaseNotes: string;
}

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
  base?: AnalysisProgressCount;
  compare?: AnalysisProgressCount;
  detailedDiffs?: { completed: number; total: number };
  message?: string;
}

export interface AnalysisProgressCount {
  completed: number;
  total?: number;
}

export interface LaunchDiffConfig {
  version: 1;
  sites: LaunchDiffConfigSite[];
}

export interface LaunchDiffConfigSite {
  name: string;
  environments: LaunchDiffConfigEnvironment[];
}

export interface LaunchDiffConfigEnvironment {
  name: string;
  url: string;
}
