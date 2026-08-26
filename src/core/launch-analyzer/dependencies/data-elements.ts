import { parse } from "@babel/parser";
import * as t from "@babel/types";
import type {
  DataElementReference,
  DependencyGraph,
  DependencyGraphEdge,
  DependencyGraphNode,
  DependencyImpactPath,
  LaunchResource
} from "../model/types";

export interface DependencyImpactAnalysis {
  impacts: DependencyImpactPath[];
  impactsByResourceId: Map<string, DependencyImpactPath[]>;
}

interface DataElementLookup {
  byName: Map<string, LaunchResource>;
}

export function extractPercentTokenReferences(
  value: string,
  sourcePath: string[] = []
): DataElementReference[] {
  const references: DataElementReference[] = [];
  const tokenPattern = /%([^%\n]+)%/g;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(value))) {
    const rawExpression = match[0]!;
    const targetName = match[1]!;

    references.push({
      method: "percent-token",
      rawExpression,
      targetName,
      resolution: "unresolved",
      sourcePath
    });
  }

  return references;
}

export function extractDataElementReferencesFromSource(
  source: string,
  sourcePath: string[] = []
): DataElementReference[] {
  return [
    ...extractPercentTokenReferences(source, sourcePath),
    ...extractSatelliteGetVarReferences(source, sourcePath)
  ];
}

export function annotateDataElementReferences(resources: LaunchResource[]): LaunchResource[] {
  const lookup = buildDataElementLookup(resources);

  return resources.map((resource) => ({
    ...resource,
    dataElementReferences: extractReferencesForResource(resource, lookup)
  }));
}

export function buildDataElementDependencyGraph(resources: LaunchResource[]): DependencyGraph {
  const annotatedResources = annotateDataElementReferences(resources);
  const nodes = annotatedResources.map(resourceToDependencyNode);
  const edges = annotatedResources.flatMap((resource) =>
    resource.dataElementReferences.flatMap((reference) => {
      if (reference.resolution !== "resolved" || !reference.targetResourceId) {
        return [];
      }

      return [
        {
          fromResourceId: resourceGraphId(resource),
          toResourceId: reference.targetResourceId,
          reference
        }
      ];
    })
  );

  return {
    nodes,
    edges
  };
}

export function calculateDependencyImpacts(
  graph: DependencyGraph,
  changedResourceIds: Set<string>
): DependencyImpactAnalysis {
  const edgesBySource = groupEdgesBySource(graph.edges);
  const nodeNames = new Map(graph.nodes.map((node) => [node.resourceId, node.resourceName]));
  const impacts: DependencyImpactPath[] = [];
  const impactsByResourceId = new Map<string, DependencyImpactPath[]>();

  for (const node of graph.nodes) {
    if (changedResourceIds.has(node.resourceId)) {
      continue;
    }

    for (const path of findImpactPaths(node.resourceId, edgesBySource, changedResourceIds)) {
      const changedResourceId = path[path.length - 1]!;
      const impact: DependencyImpactPath = {
        changedResourceId,
        changedResourceName: nodeNames.get(changedResourceId),
        resourceIds: path,
        resourceNames: path.map((resourceId) => nodeNames.get(resourceId) ?? resourceId),
        direct: path.length === 2
      };

      impacts.push(impact);
      impactsByResourceId.set(node.resourceId, [
        ...(impactsByResourceId.get(node.resourceId) ?? []),
        impact
      ]);
    }
  }

  return {
    impacts,
    impactsByResourceId
  };
}

export function resourceGraphId(resource: LaunchResource): string {
  const id = resource.identity.launchResourceId ?? resource.identity.name ?? "unidentified";

  return `${resource.identity.resourceType}:${id}`;
}

function extractReferencesForResource(
  resource: LaunchResource,
  lookup: DataElementLookup
): DataElementReference[] {
  const discovered = dedupeReferences([
    ...extractReferencesFromUnknown(resource.raw, []),
    ...(typeof resource.raw === "string" && resource.normalizedSource
      ? extractDataElementReferencesFromSource(resource.normalizedSource, ["normalizedSource"])
      : [])
  ]);

  return discovered.map((reference) => resolveDataElementReference(reference, lookup));
}

function extractReferencesFromUnknown(value: unknown, sourcePath: string[]): DataElementReference[] {
  if (typeof value === "string") {
    return extractDataElementReferencesFromSource(value, sourcePath);
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      extractReferencesFromUnknown(item, [...sourcePath, String(index)])
    );
  }

  if (isRecord(value)) {
    return Object.entries(value).flatMap(([key, entryValue]) =>
      extractReferencesFromUnknown(entryValue, [...sourcePath, key])
    );
  }

  return [];
}

function extractSatelliteGetVarReferences(
  source: string,
  sourcePath: string[]
): DataElementReference[] {
  let ast: t.File;

  try {
    ast = parse(source, {
      sourceType: "unambiguous",
      errorRecovery: true
    });
  } catch {
    return [];
  }

  const references: DataElementReference[] = [];

  walkAst(ast, (node) => {
    if (!t.isCallExpression(node) || !isSatelliteGetVarCallee(node.callee)) {
      return;
    }

    const firstArgument = node.arguments[0];
    const rawExpression = sourceForNode(source, node);

    if (t.isStringLiteral(firstArgument)) {
      references.push({
        method: "satellite-get-var",
        rawExpression,
        targetName: firstArgument.value,
        resolution: "unresolved",
        sourcePath
      });
      return;
    }

    references.push({
      method: "satellite-get-var",
      rawExpression,
      resolution: "dynamic",
      sourcePath
    });
  });

  return references;
}

function resolveDataElementReference(
  reference: DataElementReference,
  lookup: DataElementLookup
): DataElementReference {
  if (reference.resolution === "dynamic" || !reference.targetName) {
    return reference;
  }

  const target = lookup.byName.get(reference.targetName);

  if (!target) {
    return {
      ...reference,
      resolution: "unresolved"
    };
  }

  return {
    ...reference,
    targetResourceId: resourceGraphId(target),
    resolution: "resolved"
  };
}

function buildDataElementLookup(resources: LaunchResource[]): DataElementLookup {
  const byName = new Map<string, LaunchResource>();

  for (const resource of resources) {
    if (resource.identity.resourceType === "data-element" && resource.identity.name) {
      byName.set(resource.identity.name, resource);
    }
  }

  return {
    byName
  };
}

function resourceToDependencyNode(resource: LaunchResource): DependencyGraphNode {
  return {
    resourceId: resourceGraphId(resource),
    resourceType: resource.identity.resourceType,
    resourceName: resource.identity.name
  };
}

function findImpactPaths(
  startResourceId: string,
  edgesBySource: Map<string, DependencyGraphEdge[]>,
  changedResourceIds: Set<string>
): string[][] {
  const paths: string[][] = [];
  const queue = [{ resourceId: startResourceId, path: [startResourceId] }];

  while (queue.length > 0) {
    const next = queue.shift()!;
    const edges = edgesBySource.get(next.resourceId) ?? [];

    for (const edge of edges) {
      if (next.path.includes(edge.toResourceId)) {
        continue;
      }

      const path = [...next.path, edge.toResourceId];

      if (changedResourceIds.has(edge.toResourceId)) {
        paths.push(path);
      } else {
        queue.push({
          resourceId: edge.toResourceId,
          path
        });
      }
    }
  }

  return paths;
}

function groupEdgesBySource(edges: DependencyGraphEdge[]): Map<string, DependencyGraphEdge[]> {
  const edgesBySource = new Map<string, DependencyGraphEdge[]>();

  for (const edge of edges) {
    edgesBySource.set(edge.fromResourceId, [...(edgesBySource.get(edge.fromResourceId) ?? []), edge]);
  }

  return edgesBySource;
}

function dedupeReferences(references: DataElementReference[]): DataElementReference[] {
  const referencesByKey = new Map<string, DataElementReference>();

  for (const reference of references) {
    const key = JSON.stringify({
      method: reference.method,
      rawExpression: reference.rawExpression,
      targetName: reference.targetName,
      resolution: reference.resolution,
      sourcePath: reference.sourcePath
    });

    referencesByKey.set(key, reference);
  }

  return [...referencesByKey.values()];
}

function isSatelliteGetVarCallee(callee: t.Expression | t.V8IntrinsicIdentifier): boolean {
  if (!t.isMemberExpression(callee)) {
    return false;
  }

  const object = callee.object;
  const property = callee.property;

  return (
    t.isIdentifier(object, { name: "_satellite" }) &&
    t.isIdentifier(property, { name: "getVar" }) &&
    !callee.computed
  );
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
