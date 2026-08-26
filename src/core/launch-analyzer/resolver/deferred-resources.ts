import { ANALYSIS_LIMITS } from "../model/limits";
import { calculateCompleteness } from "../model/completeness";
import { detectCurrentLaunchFormat, parseCurrentLaunchLibrary } from "../parser/current-launch";
import type {
  AnalysisWarning,
  ResolvedFile,
  ResolvedLibrary,
  ResourceOwnerRef
} from "../model/types";
import type { ResourceFetcher, ResourceFetchResult } from "../fetcher/resource-fetcher";

export interface DeferredLaunchResourceReference {
  url: string;
  owners: ResourceOwnerRef[];
  sourcePath: string[];
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

export function discoverDeferredLaunchResources(
  library: ResolvedLibrary
): DeferredLaunchResourceReference[] {
  const moduleOwners = collectModuleOwners(library);
  const referencesByUrl = new Map<string, DeferredLaunchResourceReference>();

  for (const moduleFilePath of collectExtensionModuleFilePaths(library)) {
    const url = resolveDeferredFileUrl(
      moduleFilePath.hostedLibFilesBaseUrl,
      moduleFilePath.filePath
    );

    if (!url) {
      continue;
    }

    const owners = ownersForModuleFilePath(moduleFilePath, moduleOwners);
    const existing = referencesByUrl.get(url);

    if (existing) {
      existing.owners = mergeOwners(existing.owners, owners);
      continue;
    }

    referencesByUrl.set(url, {
      url,
      owners,
      sourcePath: [
        "extensions",
        moduleFilePath.extensionName,
        "modules",
        moduleFilePath.modulePath,
        "filePaths",
        String(moduleFilePath.filePathIndex)
      ]
    });
  }

  return [...referencesByUrl.values()];
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
    existing.owners = mergeOwners(existing.owners, input.reference.owners);
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
