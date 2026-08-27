import { ANALYSIS_LIMITS } from "../model/limits";
import { calculateCompleteness } from "../model/completeness";
import { fingerprintUnknown } from "../model/fingerprint";
import { detectCurrentLaunchFormat, parseCurrentLaunchLibrary } from "../parser/current-launch";
import type {
  AnalysisWarning,
  LaunchChildComponent,
  LaunchResource,
  ResolvedFile,
  ResolvedLibrary,
  ResourceOwnerRef
} from "../model/types";
import type { ResourceFetcher, ResourceFetchResult } from "../fetcher/resource-fetcher";

type DeferredLaunchResourceTargetKind =
  | "extension-module-file"
  | "external-custom-code-source";

export interface DeferredLaunchResourceTarget {
  owner: ResourceOwnerRef;
  sourcePath: string[];
  kind: DeferredLaunchResourceTargetKind;
}

export interface DeferredLaunchResourceReference {
  url: string;
  owners: ResourceOwnerRef[];
  sourcePath: string[];
  targets: DeferredLaunchResourceTarget[];
}

export interface ResolveDeferredResourcesInput {
  library: ResolvedLibrary;
  fetcher: ResourceFetcher;
  maxResources?: number;
  maxRecursionDepth?: number;
}

export interface ResolveDeferredResourcesResult {
  library: ResolvedLibrary;
  references: DeferredLaunchResourceReference[];
}

interface ExtensionModuleFilePath {
  extensionName: string;
  extensionDisplayName?: string;
  modulePath: string;
  filePath: string;
  filePathIndex: number;
  hostedLibFilesBaseUrl?: string;
}

interface ResolvedExternalCustomCodeSource {
  reference: DeferredLaunchResourceReference;
  fileId: string;
  source: string;
}

const CUSTOM_CODE_MODULE_PATHS = new Set([
  "core/src/lib/actions/customCode.js",
  "core/src/lib/dataElements/customCode.js"
]);

export function discoverDeferredLaunchResources(
  library: ResolvedLibrary
): DeferredLaunchResourceReference[] {
  const moduleOwners = collectModuleOwners(library);
  const referencesByUrl = new Map<string, DeferredLaunchResourceReference>();

  for (const reference of collectExtensionModuleFilePathReferences(library, moduleOwners)) {
    addOrMergeReference(referencesByUrl, reference);
  }

  for (const reference of collectExternalCustomCodeSourceReferences(library)) {
    addOrMergeReference(referencesByUrl, reference);
  }

  return [...referencesByUrl.values()];
}

function collectExtensionModuleFilePathReferences(
  library: ResolvedLibrary,
  moduleOwners: Map<string, ResourceOwnerRef[]>
): DeferredLaunchResourceReference[] {
  return collectExtensionModuleFilePaths(library).flatMap((moduleFilePath) => {
    const url = resolveDeferredFileUrl(
      moduleFilePath.hostedLibFilesBaseUrl,
      moduleFilePath.filePath
    );

    if (!url) {
      return [];
    }

    const owners = ownersForModuleFilePath(moduleFilePath, moduleOwners);
    const sourcePath = [
      "extensions",
      moduleFilePath.extensionName,
      "modules",
      moduleFilePath.modulePath,
      "filePaths",
      String(moduleFilePath.filePathIndex)
    ];

    return {
      url,
      owners,
      sourcePath,
      targets: owners.map((owner) => ({
        owner,
        sourcePath,
        kind: "extension-module-file" as const
      }))
    };
  });
}

export async function resolveDeferredLaunchResources(
  input: ResolveDeferredResourcesInput
): Promise<ResolveDeferredResourcesResult> {
  const maxResources = input.maxResources ?? ANALYSIS_LIMITS.maxResourcesPerLibrary;
  const maxRecursionDepth = input.maxRecursionDepth ?? ANALYSIS_LIMITS.maxRecursionDepth;
  const referencesByUrl = new Map<string, DeferredLaunchResourceReference>();
  const pendingReferences: Array<{ reference: DeferredLaunchResourceReference; depth: number }> = [];
  const skippedReferences: DeferredLaunchResourceReference[] = [];
  const warnings: AnalysisWarning[] = [];
  const deferredFiles: ResolvedFile[] = [];
  const externalCustomCodeSources: ResolvedExternalCustomCodeSource[] = [];

  for (const reference of discoverDeferredLaunchResources(input.library)) {
    enqueueReference({
      reference,
      depth: 0,
      referencesByUrl,
      pendingReferences,
      skippedReferences,
      maxResources
    });
  }

  while (pendingReferences.length > 0) {
    const next = pendingReferences.shift()!;
    const reference = referencesByUrl.get(next.reference.url) ?? next.reference;
    const result = await input.fetcher.fetchResource({ url: reference.url });
    const resolvedFile = createDeferredResolvedFile(deferredFiles.length, reference, result);

    deferredFiles.push(resolvedFile);

    if (result.ok && result.body.kind === "text" && hasExternalCustomCodeTarget(reference)) {
      externalCustomCodeSources.push({
        reference,
        fileId: resolvedFile.id,
        source: result.body.text
      });
    }

    if (result.ok && result.body.kind === "text" && next.depth < maxRecursionDepth) {
      for (const nestedReference of discoverNestedDeferredReferences(result.body.text, reference.url)) {
        enqueueReference({
          reference: nestedReference,
          depth: next.depth + 1,
          referencesByUrl,
          pendingReferences,
          skippedReferences,
          maxResources
        });
      }
    }
  }

  for (const [index, reference] of skippedReferences.entries()) {
    const warning = createResolverWarning(
      "deferred-resource-limit-reached",
      "A parser-confirmed deferred Launch resource was skipped because the resource limit was reached."
    );
    warnings.push(warning);
    deferredFiles.push(createSkippedLimitFile(index + deferredFiles.length, reference, warning));
  }

  const files = [...input.library.files, ...deferredFiles];
  const failed = files.filter((file) => file.state === "failed").length;
  const resolved = files.filter((file) => file.state === "resolved").length;
  const limitReached = skippedReferences.length > 0;

  return {
    references: [...referencesByUrl.values()],
    library: {
      ...input.library,
      resources: attachResolvedExternalCustomCodeSources(
        input.library.resources,
        externalCustomCodeSources
      ),
      files,
      warnings: [...input.library.warnings, ...warnings],
      completeness: calculateCompleteness({
        discovered: files.length,
        resolved,
        failed,
        limitReached
      })
    }
  };
}

function enqueueReference(input: {
  reference: DeferredLaunchResourceReference;
  depth: number;
  referencesByUrl: Map<string, DeferredLaunchResourceReference>;
  pendingReferences: Array<{ reference: DeferredLaunchResourceReference; depth: number }>;
  skippedReferences: DeferredLaunchResourceReference[];
  maxResources: number;
}): void {
  const existing = input.referencesByUrl.get(input.reference.url);

  if (existing) {
    input.referencesByUrl.set(input.reference.url, mergeReferences(existing, input.reference));
    return;
  }

  input.referencesByUrl.set(input.reference.url, input.reference);

  if (input.referencesByUrl.size > input.maxResources) {
    input.skippedReferences.push(input.reference);
    return;
  }

  input.pendingReferences.push({
    reference: input.reference,
    depth: input.depth
  });
}

function addOrMergeReference(
  referencesByUrl: Map<string, DeferredLaunchResourceReference>,
  reference: DeferredLaunchResourceReference
): void {
  const existing = referencesByUrl.get(reference.url);

  referencesByUrl.set(reference.url, existing ? mergeReferences(existing, reference) : reference);
}

function discoverNestedDeferredReferences(
  source: string,
  canonicalUrl: string
): DeferredLaunchResourceReference[] {
  if (!detectCurrentLaunchFormat(source).detected) {
    return [];
  }

  const nestedLibrary = parseCurrentLaunchLibrary({
    source,
    canonicalUrl
  });

  return discoverDeferredLaunchResources(nestedLibrary);
}

function collectExtensionModuleFilePaths(library: ResolvedLibrary): ExtensionModuleFilePath[] {
  return library.resources.flatMap((resource) => {
    if (resource.identity.resourceType !== "extension") {
      return [];
    }

    const extension = asRecord(resource.raw);
    const modules = asRecord(extension?.modules);
    const extensionName = asString(resource.metadata.extensionName) ?? resource.identity.name;
    const hostedLibFilesBaseUrl =
      asString(resource.metadata.hostedLibFilesBaseUrl) ??
      asString(extension?.hostedLibFilesBaseUrl);

    if (!extensionName || !modules) {
      return [];
    }

    return Object.entries(modules).flatMap(([modulePath, moduleValue]) => {
      const moduleRecord = asRecord(moduleValue);
      const filePaths = asStringArray(moduleRecord?.filePaths);

      return filePaths.map((filePath, filePathIndex) => ({
        extensionName,
        extensionDisplayName: resource.identity.name,
        modulePath,
        filePath,
        filePathIndex,
        hostedLibFilesBaseUrl
      }));
    });
  });
}

function collectExternalCustomCodeSourceReferences(
  library: ResolvedLibrary
): DeferredLaunchResourceReference[] {
  return library.resources.flatMap((resource) => {
    if (resource.identity.resourceType === "rule") {
      return collectRuleExternalCustomCodeSourceReferences(resource);
    }

    if (resource.identity.resourceType === "data-element") {
      return collectDataElementExternalCustomCodeSourceReference(resource);
    }

    return [];
  });
}

function collectRuleExternalCustomCodeSourceReferences(
  resource: LaunchResource
): DeferredLaunchResourceReference[] {
  const rule = asRecord(resource.raw);

  if (!rule) {
    return [];
  }

  return [
    ...collectRuleComponentExternalCustomCodeSourceReferences(resource, rule, "events"),
    ...collectRuleComponentExternalCustomCodeSourceReferences(resource, rule, "conditions"),
    ...collectRuleComponentExternalCustomCodeSourceReferences(resource, rule, "actions")
  ];
}

function collectRuleComponentExternalCustomCodeSourceReferences(
  resource: LaunchResource,
  rule: Record<string, unknown>,
  collectionName: "events" | "conditions" | "actions"
): DeferredLaunchResourceReference[] {
  const components = Array.isArray(rule[collectionName]) ? rule[collectionName] : [];

  return components.flatMap((component, index) => {
    const url = externalCustomCodeSourceUrl(component);

    if (!url) {
      return [];
    }

    const componentRecord = asRecord(component);
    const modulePath = asString(componentRecord?.modulePath) ?? "custom-code";
    const owner: ResourceOwnerRef = {
      resourceType: "rule",
      resourceId: resource.identity.launchResourceId,
      resourceName: resource.identity.name,
      childPath: [collectionName, String(index), modulePath]
    };
    const sourcePath = [collectionName, String(index), "settings", "source"];

    return createExternalCustomCodeSourceReference(url, owner, sourcePath);
  });
}

function collectDataElementExternalCustomCodeSourceReference(
  resource: LaunchResource
): DeferredLaunchResourceReference[] {
  const url = externalCustomCodeSourceUrl(resource.raw);

  if (!url) {
    return [];
  }

  const owner: ResourceOwnerRef = {
    resourceType: "data-element",
    resourceId: resource.identity.launchResourceId,
    resourceName: resource.identity.name,
    childPath: ["settings", "source"]
  };
  const sourcePath = ["settings", "source"];

  return createExternalCustomCodeSourceReference(url, owner, sourcePath);
}

function createExternalCustomCodeSourceReference(
  url: string,
  owner: ResourceOwnerRef,
  sourcePath: string[]
): DeferredLaunchResourceReference[] {
  return [
    {
      url,
      owners: [owner],
      sourcePath,
      targets: [
        {
          owner,
          sourcePath,
          kind: "external-custom-code-source"
        }
      ]
    }
  ];
}

function externalCustomCodeSourceUrl(value: unknown): string | undefined {
  const record = asRecord(value);
  const modulePath = asString(record?.modulePath);
  const settings = asRecord(record?.settings);
  const source = asString(settings?.source);
  const language = asString(settings?.language);

  if (
    !modulePath ||
    !CUSTOM_CODE_MODULE_PATHS.has(modulePath) ||
    settings?.isExternal !== true ||
    !source ||
    (language !== undefined && language !== "javascript")
  ) {
    return undefined;
  }

  return normalizeExternalCustomCodeUrl(source);
}

function normalizeExternalCustomCodeUrl(value: string): string | undefined {
  if (value.endsWith(".map")) {
    return undefined;
  }

  try {
    const url = new URL(value);

    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function collectModuleOwners(library: ResolvedLibrary): Map<string, ResourceOwnerRef[]> {
  const ownersByModulePath = new Map<string, ResourceOwnerRef[]>();

  for (const resource of library.resources) {
    if (resource.identity.resourceType === "rule") {
      for (const [index, child] of resource.children.entries()) {
        if (!child.moduleType) {
          continue;
        }

        addOwner(ownersByModulePath, child.moduleType, {
          resourceType: "rule",
          resourceId: resource.identity.launchResourceId,
          resourceName: resource.identity.name,
          childPath: [child.componentType, String(index), child.moduleType]
        });
      }
    }

    if (resource.identity.resourceType === "data-element") {
      const modulePath = asString(resource.metadata.modulePath);

      if (modulePath) {
        addOwner(ownersByModulePath, modulePath, {
          resourceType: "data-element",
          resourceId: resource.identity.launchResourceId,
          resourceName: resource.identity.name,
          childPath: ["modulePath", modulePath]
        });
      }
    }

    if (resource.identity.resourceType === "extension") {
      for (const child of resource.children) {
        if (!child.moduleType) {
          continue;
        }

        addOwner(ownersByModulePath, child.moduleType, {
          resourceType: "extension",
          resourceId: resource.identity.launchResourceId,
          resourceName: resource.identity.name,
          childPath: ["modules", child.moduleType]
        });
      }
    }
  }

  return ownersByModulePath;
}

function ownersForModuleFilePath(
  moduleFilePath: ExtensionModuleFilePath,
  moduleOwners: Map<string, ResourceOwnerRef[]>
): ResourceOwnerRef[] {
  const owners = moduleOwners.get(moduleFilePath.modulePath);

  if (owners?.length) {
    return owners;
  }

  return [
    {
      resourceType: "extension",
      resourceName: moduleFilePath.extensionDisplayName ?? moduleFilePath.extensionName,
      childPath: ["modules", moduleFilePath.modulePath]
    }
  ];
}

function resolveDeferredFileUrl(baseUrl: string | undefined, filePath: string): string | undefined {
  if (!baseUrl || isAbsoluteOrProtocolRelativeUrl(filePath) || filePath.endsWith(".map")) {
    return undefined;
  }

  return new URL(filePath, ensureTrailingSlash(baseUrl)).href;
}

function attachResolvedExternalCustomCodeSources(
  resources: LaunchResource[],
  sources: ResolvedExternalCustomCodeSource[]
): LaunchResource[] {
  if (sources.length === 0) {
    return resources;
  }

  return resources.map((resource) => {
    const resourceSources = sources.flatMap((source) =>
      source.reference.targets
        .filter((target) => target.kind === "external-custom-code-source")
        .filter((target) => targetMatchesResource(target, resource))
        .map((target) => ({
          ...source,
          target
        }))
    );

    if (resourceSources.length === 0) {
      return resource;
    }

    const raw = resourceSources.reduce<unknown>(
      (currentRaw, source) => setValueAtPath(currentRaw, source.target.sourcePath, source.source),
      resource.raw
    );
    const children = resourceSources.reduce(
      (currentChildren, source) =>
        patchChildExternalCustomCodeSource(
          currentChildren,
          source.target.sourcePath,
          source.source
        ),
      resource.children
    );
    const fileIds = [
      ...new Set([...resource.fileIds, ...resourceSources.map((source) => source.fileId)])
    ];

    return {
      ...resource,
      raw,
      normalized: raw,
      normalizedSource: JSON.stringify(raw),
      contentFingerprint: fingerprintUnknown(raw),
      children,
      fileIds
    };
  });
}

function hasExternalCustomCodeTarget(reference: DeferredLaunchResourceReference): boolean {
  return reference.targets.some((target) => target.kind === "external-custom-code-source");
}

function targetMatchesResource(
  target: DeferredLaunchResourceTarget,
  resource: LaunchResource
): boolean {
  if (target.owner.resourceType !== resource.identity.resourceType) {
    return false;
  }

  if (target.owner.resourceId) {
    return target.owner.resourceId === resource.identity.launchResourceId;
  }

  return target.owner.resourceName === resource.identity.name;
}

function setValueAtPath(value: unknown, path: string[], nextValue: unknown): unknown {
  if (path.length === 0) {
    return nextValue;
  }

  const [segment, ...remainingPath] = path;

  if (Array.isArray(value)) {
    const index = Number(segment);

    if (!Number.isInteger(index) || index < 0 || index >= value.length) {
      return value;
    }

    return value.map((item, itemIndex) =>
      itemIndex === index ? setValueAtPath(item, remainingPath, nextValue) : item
    );
  }

  const record = asRecord(value);

  if (!record || segment === undefined || !(segment in record)) {
    return value;
  }

  return {
    ...record,
    [segment]: setValueAtPath(record[segment], remainingPath, nextValue)
  };
}

function patchChildExternalCustomCodeSource(
  children: LaunchChildComponent[],
  sourcePath: string[],
  source: string
): LaunchChildComponent[] {
  const [collectionName, indexValue, ...componentPath] = sourcePath;
  const componentType = componentTypeForCollection(collectionName);
  const componentIndex = Number(indexValue);

  if (!componentType || !Number.isInteger(componentIndex)) {
    return children;
  }

  let seenComponentIndex = -1;

  return children.map((child) => {
    if (child.componentType !== componentType) {
      return child;
    }

    seenComponentIndex += 1;

    if (seenComponentIndex !== componentIndex) {
      return child;
    }

    const raw = setValueAtPath(child.raw, componentPath, source);

    return {
      ...child,
      raw,
      normalized: raw,
      normalizedSource: JSON.stringify(raw)
    };
  });
}

function componentTypeForCollection(
  collectionName: string | undefined
): LaunchChildComponent["componentType"] | undefined {
  if (collectionName === "events") {
    return "event";
  }

  if (collectionName === "conditions") {
    return "condition";
  }

  if (collectionName === "actions") {
    return "action";
  }
}

function createDeferredResolvedFile(
  index: number,
  reference: DeferredLaunchResourceReference,
  result: ResourceFetchResult
): ResolvedFile {
  const base = {
    id: `deferred:${index + 1}`,
    authoritativeUrl: result.metadata.finalUrl ?? reference.url,
    aliases:
      result.metadata.finalUrl && result.metadata.finalUrl !== reference.url ? [reference.url] : [],
    fetch: result.metadata,
    owners: reference.owners,
    discoveredBy: {
      method: "parser-confirmed-deferred" as const,
      sourceResource: reference.owners[0],
      sourcePath: reference.sourcePath
    }
  };

  if (!result.ok) {
    return {
      ...base,
      state: "failed",
      warningIds: []
    };
  }

  return {
    ...base,
    state: "resolved",
    deployedSource: result.body.kind === "text" ? result.body.text : undefined,
    displaySource: result.body.kind === "text" ? result.body.text : undefined,
    displaySourceOrigin: result.body.kind === "text" ? "deployed" : undefined,
    warningIds: []
  };
}

function createSkippedLimitFile(
  index: number,
  reference: DeferredLaunchResourceReference,
  warning: AnalysisWarning
): ResolvedFile {
  return {
    id: `deferred:${index + 1}`,
    authoritativeUrl: reference.url,
    aliases: [],
    state: "skipped-limit",
    fetch: {
      requestedUrl: reference.url,
      fetchedAt: "1970-01-01T00:00:00.000Z",
      attempts: 0
    },
    owners: reference.owners,
    discoveredBy: {
      method: "parser-confirmed-deferred",
      sourceResource: reference.owners[0],
      sourcePath: reference.sourcePath
    },
    warningIds: [warning.id]
  };
}

function addOwner(
  ownersByModulePath: Map<string, ResourceOwnerRef[]>,
  modulePath: string,
  owner: ResourceOwnerRef
): void {
  const existing = ownersByModulePath.get(modulePath) ?? [];
  ownersByModulePath.set(modulePath, mergeOwners(existing, [owner]));
}

function mergeOwners(existing: ResourceOwnerRef[], incoming: ResourceOwnerRef[]): ResourceOwnerRef[] {
  const ownersByKey = new Map(existing.map((owner) => [ownerKey(owner), owner]));

  for (const owner of incoming) {
    ownersByKey.set(ownerKey(owner), owner);
  }

  return [...ownersByKey.values()];
}

function mergeReferences(
  existing: DeferredLaunchResourceReference,
  incoming: DeferredLaunchResourceReference
): DeferredLaunchResourceReference {
  return {
    ...existing,
    owners: mergeOwners(existing.owners, incoming.owners),
    targets: mergeTargets(existing.targets, incoming.targets)
  };
}

function mergeTargets(
  existing: DeferredLaunchResourceTarget[],
  incoming: DeferredLaunchResourceTarget[]
): DeferredLaunchResourceTarget[] {
  const targetsByKey = new Map(existing.map((target) => [targetKey(target), target]));

  for (const target of incoming) {
    targetsByKey.set(targetKey(target), target);
  }

  return [...targetsByKey.values()];
}

function targetKey(target: DeferredLaunchResourceTarget): string {
  return JSON.stringify(target);
}

function ownerKey(owner: ResourceOwnerRef): string {
  return JSON.stringify(owner);
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function isAbsoluteOrProtocolRelativeUrl(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value) || value.startsWith("//");
}

function createResolverWarning(code: string, message: string): AnalysisWarning {
  return {
    id: `resolver:${code}`,
    severity: "warning",
    code,
    message
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
