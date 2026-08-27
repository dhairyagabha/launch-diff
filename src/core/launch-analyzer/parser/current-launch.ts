import { parse } from "@babel/parser";
import * as t from "@babel/types";
import { ANALYZER_MODEL_VERSION } from "../model/constants";
import { calculateCompleteness } from "../model/completeness";
import { fingerprintUnknown } from "../model/fingerprint";
import type {
  AnalysisWarning,
  FetchMetadata,
  LaunchChildComponent,
  LaunchResource,
  LibraryMetadata,
  ResolvedFile,
  ResolvedLibrary,
  ResourceType
} from "../model/types";

const CANONICAL_FILE_ID = "canonical";
const KNOWN_CONTAINER_KEYS = new Set([
  "buildInfo",
  "company",
  "dataElements",
  "environment",
  "extensions",
  "property",
  "rules"
]);

export interface CurrentLaunchParseInput {
  source: string;
  canonicalUrl: string;
  fetchMetadata?: FetchMetadata;
  fileId?: string;
}

export type CurrentLaunchFormatDetectionReason =
  | "container-object-literal"
  | "container-assignment-not-found"
  | "container-assignment-not-static-object"
  | "javascript-parse-failed";

export interface CurrentLaunchFormatDetection {
  detected: boolean;
  reason: CurrentLaunchFormatDetectionReason;
}

interface StaticContainerExtraction {
  value?: unknown;
  foundContainerAssignment: boolean;
  foundStaticContainer: boolean;
  parseFailed: boolean;
  warnings: AnalysisWarning[];
}

interface StaticValueContext {
  source: string;
  warnings: AnalysisWarning[];
}

export function detectCurrentLaunchFormat(source: string): CurrentLaunchFormatDetection {
  const extraction = extractStaticContainer(source);

  if (extraction.foundStaticContainer) {
    return {
      detected: true,
      reason: "container-object-literal"
    };
  }

  if (extraction.parseFailed) {
    return {
      detected: false,
      reason: "javascript-parse-failed"
    };
  }

  if (extraction.foundContainerAssignment) {
    return {
      detected: false,
      reason: "container-assignment-not-static-object"
    };
  }

  return {
    detected: false,
    reason: "container-assignment-not-found"
  };
}

export function parseCurrentLaunchLibrary(input: CurrentLaunchParseInput): ResolvedLibrary {
  const fileId = input.fileId ?? CANONICAL_FILE_ID;
  const extraction = extractStaticContainer(input.source);
  const warnings = [...extraction.warnings];
  const file = createCanonicalResolvedFile(input, fileId);

  if (!extraction.foundStaticContainer || !isRecord(extraction.value)) {
    const warning = createParserWarning(
      "current-launch-container-not-found",
      "No static current Launch container object was found. Preserving the canonical artifact as unmapped source."
    );
    warnings.push(warning);

    return createResolvedLibrary({
      canonicalUrl: input.canonicalUrl,
      files: [{ ...file, warningIds: [warning.id] }],
      metadata: createLibraryMetadata(input.canonicalUrl),
      resources: [
        createLaunchResource({
          resourceType: "unmapped",
          name: "Unmapped canonical library",
          raw: input.source,
          normalizedSource: input.source,
          fileIds: [fileId],
          metadata: {
            fallbackKind: "canonical-source"
          },
          warnings: [warning.id]
        })
      ],
      warnings
    });
  }

  const container = extraction.value;
  const resources = [
    createRuntimeResource(container, fileId),
    ...createRuleResources(container, fileId, warnings),
    ...createDataElementResources(container, fileId, warnings),
    ...createExtensionResources(container, fileId, warnings),
    ...createUnmappedContainerResources(container, fileId, warnings)
  ];

  return createResolvedLibrary({
    canonicalUrl: input.canonicalUrl,
    files: [file],
    metadata: createLibraryMetadata(input.canonicalUrl, container, resources.length),
    resources,
    warnings
  });
}

function extractStaticContainer(source: string): StaticContainerExtraction {
  const warnings: AnalysisWarning[] = [];
  let ast: t.File;

  try {
    ast = parse(source, {
      sourceType: "unambiguous",
      errorRecovery: true
    });
  } catch {
    return {
      foundContainerAssignment: false,
      foundStaticContainer: false,
      parseFailed: true,
      warnings: [
        createParserWarning(
          "javascript-parse-failed",
          "The canonical artifact could not be parsed as JavaScript. Preserving it as unmapped source."
        )
      ]
    };
  }

  const context: StaticValueContext = { source, warnings };
  let foundContainerAssignment = false;
  let foundStaticContainer = false;
  let value: unknown;

  walkAst(ast, (node) => {
    if (foundStaticContainer || !t.isAssignmentExpression(node)) {
      return;
    }

    if (!isContainerMemberExpression(node.left)) {
      return;
    }

    foundContainerAssignment = true;

    if (!t.isObjectExpression(node.right)) {
      warnings.push(
        createParserWarning(
          "container-assignment-not-static-object",
          "A Launch container assignment was found, but its value was not a static object literal."
        )
      );
      return;
    }

    foundStaticContainer = true;
    value = staticValueFromExpression(node.right, context, ["_satellite", "_container"]);
  });

  return {
    value,
    foundContainerAssignment,
    foundStaticContainer,
    parseFailed: false,
    warnings
  };
}

function createRuntimeResource(container: Record<string, unknown>, fileId: string): LaunchResource {
  const property = asRecord(container.property);
  const raw = {
    buildInfo: container.buildInfo,
    company: container.company,
    environment: container.environment,
    property: container.property
  };

  return createLaunchResource({
    resourceType: "runtime",
    launchResourceId: asString(property?.id),
    name: "Library / Runtime Configuration",
    raw,
    normalized: createComparableRuntimeConfiguration(raw),
    fileIds: [fileId],
    metadata: {
      propertyId: asString(property?.id),
      propertyName: asString(property?.name)
    }
  });
}

function createRuleResources(
  container: Record<string, unknown>,
  fileId: string,
  warnings: AnalysisWarning[]
): LaunchResource[] {
  if (container.rules === undefined) {
    return [];
  }

  if (!Array.isArray(container.rules)) {
    warnings.push(
      createParserWarning("rules-not-array", "The Launch container rules value was not an array.")
    );
    return [
      createLaunchResource({
        resourceType: "unmapped",
        name: "Unmapped rules container",
        raw: container.rules,
        fileIds: [fileId]
      })
    ];
  }

  return container.rules.map((rule, index) => {
    const ruleRecord = asRecord(rule);
    const ruleId = asString(ruleRecord?.id);
    const ruleName = asString(ruleRecord?.name) ?? `Rule ${index + 1}`;

    if (!ruleRecord || !ruleId) {
      warnings.push(
        createParserWarning(
          "rule-id-missing",
          "A rule did not include a static Launch rule ID. It will remain conservatively identifiable by type and name only."
        )
      );
    }

    return createLaunchResource({
      resourceType: "rule",
      launchResourceId: ruleId,
      name: ruleName,
      raw: rule,
      children: ruleRecord ? createRuleChildren(ruleRecord) : [],
      fileIds: [fileId],
      metadata: {
        sequence: index
      }
    });
  });
}

function createDataElementResources(
  container: Record<string, unknown>,
  fileId: string,
  warnings: AnalysisWarning[]
): LaunchResource[] {
  if (container.dataElements === undefined) {
    return [];
  }

  const dataElements = asRecord(container.dataElements);

  if (!dataElements) {
    warnings.push(
      createParserWarning(
        "data-elements-not-object",
        "The Launch container dataElements value was not an object."
      )
    );
    return [
      createLaunchResource({
        resourceType: "unmapped",
        name: "Unmapped dataElements container",
        raw: container.dataElements,
        fileIds: [fileId]
      })
    ];
  }

  return Object.entries(dataElements).map(([name, raw]) => {
    const dataElement = asRecord(raw);

    return createLaunchResource({
      resourceType: "data-element",
      name,
      raw,
      fileIds: [fileId],
      metadata: {
        modulePath: asString(dataElement?.modulePath),
        storageDuration: asString(dataElement?.storageDuration)
      }
    });
  });
}

function createExtensionResources(
  container: Record<string, unknown>,
  fileId: string,
  warnings: AnalysisWarning[]
): LaunchResource[] {
  if (container.extensions === undefined) {
    return [];
  }

  const extensions = asRecord(container.extensions);

  if (!extensions) {
    warnings.push(
      createParserWarning(
        "extensions-not-object",
        "The Launch container extensions value was not an object."
      )
    );
    return [
      createLaunchResource({
        resourceType: "unmapped",
        name: "Unmapped extensions container",
        raw: container.extensions,
        fileIds: [fileId]
      })
    ];
  }

  return Object.entries(extensions).map(([extensionName, raw]) => {
    const extension = asRecord(raw);

    return createLaunchResource({
      resourceType: "extension",
      name: asString(extension?.displayName) ?? extensionName,
      raw,
      children: createExtensionModuleChildren(extension),
      fileIds: [fileId],
      metadata: {
        extensionName,
        hostedLibFilesBaseUrl: asString(extension?.hostedLibFilesBaseUrl)
      }
    });
  });
}

function createUnmappedContainerResources(
  container: Record<string, unknown>,
  fileId: string,
  warnings: AnalysisWarning[]
): LaunchResource[] {
  return Object.entries(container).flatMap(([key, raw]) => {
    if (KNOWN_CONTAINER_KEYS.has(key)) {
      return [];
    }

    const warning = createParserWarning(
      "unmapped-container-property",
      "An unsupported Launch container property was preserved as unmapped data."
    );
    warnings.push(warning);

    return [
      createLaunchResource({
        resourceType: "unmapped",
        name: `Unmapped container property: ${key}`,
        raw,
        fileIds: [fileId],
        metadata: {
          containerPath: [key]
        },
        warnings: [warning.id]
      })
    ];
  });
}

function createRuleChildren(rule: Record<string, unknown>): LaunchChildComponent[] {
  return [
    ...createRuleComponentChildren(rule.events, "event"),
    ...createRuleComponentChildren(rule.conditions, "condition"),
    ...createRuleComponentChildren(rule.actions, "action")
  ];
}

function createRuleComponentChildren(
  components: unknown,
  componentType: "event" | "condition" | "action"
): LaunchChildComponent[] {
  if (!Array.isArray(components)) {
    return [];
  }

  return components.map((component, index) => {
    const componentRecord = asRecord(component);
    const modulePath = asString(componentRecord?.modulePath);

    return {
      componentType,
      extensionId: extensionNameFromModulePath(modulePath),
      moduleType: modulePath,
      name: modulePath,
      order: asNumber(componentRecord?.ruleOrder) ?? index,
      raw: component,
      normalized: component,
      normalizedSource: JSON.stringify(component)
    };
  });
}

function createExtensionModuleChildren(extension: Record<string, unknown> | undefined) {
  const modules = asRecord(extension?.modules);

  if (!modules) {
    return [];
  }

  return Object.entries(modules).map(([modulePath, raw]) => {
    const extensionModule = asRecord(raw);

    return {
      componentType: "module" as const,
      extensionId: extensionNameFromModulePath(modulePath),
      moduleType: modulePath,
      name: asString(extensionModule?.displayName) ?? asString(extensionModule?.name) ?? modulePath,
      raw,
      normalized: raw,
      normalizedSource: JSON.stringify(raw)
    };
  });
}

function createLaunchResource(input: {
  resourceType: ResourceType;
  launchResourceId?: string;
  name?: string;
  raw: unknown;
  normalized?: unknown;
  normalizedSource?: string;
  children?: LaunchChildComponent[];
  fileIds: string[];
  metadata?: Record<string, unknown>;
  warnings?: string[];
}): LaunchResource {
  return {
    ...createLaunchResourceContent(input.raw, input.normalized, input.normalizedSource),
    identity: {
      resourceType: input.resourceType,
      ...(input.launchResourceId ? { launchResourceId: input.launchResourceId } : {}),
      ...(input.name ? { name: input.name } : {})
    },
    children: input.children ?? [],
    fileIds: input.fileIds,
    dataElementReferences: [],
    metadata: input.metadata ?? {},
    warnings: input.warnings ?? []
  };
}

function createLaunchResourceContent(
  raw: unknown,
  normalized = raw,
  normalizedSource = JSON.stringify(normalized)
) {
  return {
    raw,
    normalized,
    normalizedSource,
    contentFingerprint: fingerprintUnknown(normalized)
  };
}

function createComparableRuntimeConfiguration(raw: {
  buildInfo: unknown;
  company: unknown;
  environment: unknown;
  property: unknown;
}): Record<string, unknown> {
  return compactRecord({
    buildInfo: omitRecordKeys(raw.buildInfo, ["buildDate", "minified"]),
    company: raw.company,
    property: raw.property
  });
}

function createResolvedLibrary(input: {
  canonicalUrl: string;
  files: ResolvedFile[];
  metadata: LibraryMetadata;
  resources: LaunchResource[];
  warnings: AnalysisWarning[];
}): ResolvedLibrary {
  const completeness = calculateCompleteness({
    discovered: input.resources.length,
    resolved: input.resources.length,
    failed: 0
  });

  return {
    modelVersion: ANALYZER_MODEL_VERSION,
    metadata: {
      ...input.metadata,
      discoveredResourceCount: input.resources.length,
      resolvedResourceCount: input.resources.length,
      failedResourceCount: 0
    },
    resources: input.resources,
    files: input.files,
    dependencyGraph: {
      nodes: [],
      edges: []
    },
    warnings: input.warnings,
    completeness
  };
}

function createLibraryMetadata(
  canonicalUrl: string,
  container?: Record<string, unknown>,
  resourceCount = 0
): LibraryMetadata {
  const property = asRecord(container?.property);
  const environment = asRecord(container?.environment);
  const buildInfo = asRecord(container?.buildInfo);

  return {
    propertyId: asString(property?.id),
    propertyName: asString(property?.name),
    environmentId: asString(environment?.id),
    environmentStage: asString(environment?.stage),
    buildDate: asString(buildInfo?.buildDate),
    turbineBuildDate: asString(buildInfo?.turbineBuildDate),
    turbineVersion: asString(buildInfo?.turbineVersion),
    minified: asBoolean(buildInfo?.minified),
    canonicalUrl,
    discoveredResourceCount: resourceCount,
    resolvedResourceCount: resourceCount,
    failedResourceCount: 0
  };
}

function createCanonicalResolvedFile(input: CurrentLaunchParseInput, fileId: string): ResolvedFile {
  return {
    id: fileId,
    authoritativeUrl: input.canonicalUrl,
    aliases: [],
    state: "resolved",
    fetch:
      input.fetchMetadata ??
      {
        requestedUrl: input.canonicalUrl,
        finalUrl: input.canonicalUrl,
        fetchedAt: "1970-01-01T00:00:00.000Z",
        attempts: 1,
        byteLength: input.source.length
      },
    deployedSource: input.source,
    displaySource: input.source,
    displaySourceOrigin: "deployed",
    owners: [],
    discoveredBy: {
      method: "canonical"
    },
    warningIds: []
  };
}

function staticValueFromExpression(
  node: t.Node | null | undefined,
  context: StaticValueContext,
  path: string[]
): unknown {
  if (!node) {
    return null;
  }

  if (t.isStringLiteral(node) || t.isNumericLiteral(node) || t.isBooleanLiteral(node)) {
    return node.value;
  }

  if (t.isNullLiteral(node)) {
    return null;
  }

  if (t.isUnaryExpression(node) && node.operator === "-" && t.isNumericLiteral(node.argument)) {
    return -node.argument.value;
  }

  if (t.isArrayExpression(node)) {
    return node.elements.map((element, index) =>
      staticValueFromExpression(element, context, [...path, String(index)])
    );
  }

  if (t.isObjectExpression(node)) {
    return staticObjectFromExpression(node, context, path);
  }

  if (t.isTemplateLiteral(node) && node.expressions.length === 0) {
    return node.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw).join("");
  }

  if (t.isFunctionExpression(node) || t.isArrowFunctionExpression(node)) {
    return sourceForNode(context.source, node);
  }

  context.warnings.push(
    createParserWarning(
      "unsupported-static-value",
      "A Launch container value could not be converted to structured data and was preserved as source text."
    )
  );

  return {
    unsupportedStaticValue: true,
    nodeType: node.type,
    path,
    source: sourceForNode(context.source, node)
  };
}

function staticObjectFromExpression(
  node: t.ObjectExpression,
  context: StaticValueContext,
  path: string[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [index, property] of node.properties.entries()) {
    if (t.isSpreadElement(property)) {
      context.warnings.push(
        createParserWarning(
          "object-spread-unsupported",
          "An object spread inside the Launch container was preserved as source text."
        )
      );
      result[`__unmappedSpread${index}`] = sourceForNode(context.source, property);
      continue;
    }

    const key = staticPropertyKey(property);

    if (!key) {
      context.warnings.push(
        createParserWarning(
          "computed-property-unsupported",
          "A computed Launch container property could not be statically named."
        )
      );
      result[`__unmappedProperty${index}`] = sourceForNode(context.source, property);
      continue;
    }

    if (t.isObjectMethod(property)) {
      result[key] = sourceForNode(context.source, property);
      continue;
    }

    result[key] = staticValueFromExpression(property.value, context, [...path, key]);
  }

  return result;
}

function staticPropertyKey(property: t.ObjectMethod | t.ObjectProperty): string | undefined {
  if (property.computed) {
    return undefined;
  }

  if (t.isIdentifier(property.key)) {
    return property.key.name;
  }

  if (t.isStringLiteral(property.key) || t.isNumericLiteral(property.key)) {
    return String(property.key.value);
  }

  return undefined;
}

function omitRecordKeys(value: unknown, keys: string[]): unknown {
  const record = asRecord(value);

  if (!record) {
    return value;
  }

  const omittedKeys = new Set(keys);

  return Object.fromEntries(
    Object.entries(record).filter(([key]) => !omittedKeys.has(key))
  );
}

function compactRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => {
      if (value === undefined) {
        return false;
      }

      if (isRecord(value) && Object.keys(value).length === 0) {
        return false;
      }

      return true;
    })
  );
}

function isContainerMemberExpression(node: t.Node): boolean {
  const path = memberExpressionPath(node);

  return (
    pathMatches(path, ["_satellite", "_container"]) ||
    pathMatches(path, ["window", "_satellite", "_container"]) ||
    pathMatches(path, ["_satellite", "container"]) ||
    pathMatches(path, ["window", "_satellite", "container"])
  );
}

function pathMatches(path: string[], expected: string[]): boolean {
  return path.length === expected.length && path.every((segment, index) => segment === expected[index]);
}

function memberExpressionPath(node: t.Node): string[] {
  if (t.isIdentifier(node)) {
    return [node.name];
  }

  if (!t.isMemberExpression(node)) {
    return [];
  }

  const objectPath = memberExpressionPath(node.object);
  const propertyName = memberPropertyName(node);

  return propertyName ? [...objectPath, propertyName] : [];
}

function memberPropertyName(node: t.MemberExpression): string | undefined {
  if (t.isIdentifier(node.property) && !node.computed) {
    return node.property.name;
  }

  if (t.isStringLiteral(node.property)) {
    return node.property.value;
  }

  return undefined;
}

function walkAst(node: t.Node, visit: (node: t.Node) => void): void {
  visit(node);

  for (const [key, value] of Object.entries(node)) {
    if (key === "loc" || key === "leadingComments" || key === "innerComments" || key === "trailingComments") {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        if (isNodeLike(item)) {
          walkAst(item, visit);
        }
      }
    } else if (isNodeLike(value)) {
      walkAst(value, visit);
    }
  }
}

function isNodeLike(value: unknown): value is t.Node {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}

function sourceForNode(source: string, node: t.Node): string {
  return typeof node.start === "number" && typeof node.end === "number"
    ? source.slice(node.start, node.end)
    : `[${node.type}]`;
}

function createParserWarning(code: string, message: string): AnalysisWarning {
  return {
    id: `parser:${code}`,
    severity: "warning",
    code,
    message
  };
}

function extensionNameFromModulePath(modulePath: string | undefined): string | undefined {
  return modulePath?.split("/")[0];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}
