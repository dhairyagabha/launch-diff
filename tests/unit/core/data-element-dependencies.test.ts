import { describe, expect, it } from "vitest";
import {
  annotateDataElementReferences,
  buildDataElementDependencyGraph,
  calculateDependencyImpacts,
  extractDataElementReferencesFromSource,
  extractPercentTokenReferences,
  resourceGraphId,
  type LaunchResource
} from "@/core/launch-analyzer";

describe("Data Element dependency graph", () => {
  it("extracts multiple percent-token references from one string", () => {
    const references = extractPercentTokenReferences(
      "https://%Hostname%%Pathname%?visitor=%Visitor ID%"
    );

    expect(references.map((reference) => reference.targetName)).toEqual([
      "Hostname",
      "Pathname",
      "Visitor ID"
    ]);
    expect(references.every((reference) => reference.method === "percent-token")).toBe(true);
  });

  it("extracts literal getVar references and marks dynamic getVar calls as dynamic", () => {
    const references = extractDataElementReferencesFromSource(
      `_satellite.getVar("Customer ID"); _satellite.getVar(prefix + suffix);`
    );

    expect(references).toMatchObject([
      {
        method: "satellite-get-var",
        targetName: "Customer ID",
        resolution: "unresolved"
      },
      {
        method: "satellite-get-var",
        resolution: "dynamic"
      }
    ]);
  });

  it("resolves fixture references against Data Element resources", () => {
    const resources = annotateDataElementReferences([
      dataElement("Hostname"),
      rule("Rule A", {
        settings: {
          url: "https://%Hostname%",
          source: `_satellite.getVar("Hostname"); _satellite.getVar(dynamicName);`
        }
      })
    ]);
    const ruleResource = resources.find((resource) => resource.identity.resourceType === "rule")!;

    expect(ruleResource.dataElementReferences.map((reference) => reference.resolution)).toEqual([
      "resolved",
      "resolved",
      "dynamic"
    ]);
    expect(ruleResource.dataElementReferences[0]?.targetResourceId).toBe("data-element:Hostname");
  });

  it("builds direct and transitive impact paths", () => {
    const resources = annotateDataElementReferences([
      rule("Rule A", { settings: { source: `_satellite.getVar("DE-B");` } }),
      dataElement("DE-B", { settings: { source: `_satellite.getVar("DE-A");` } }),
      dataElement("DE-A", { settings: { source: "return 'changed';" } })
    ]);
    const graph = buildDataElementDependencyGraph(resources);
    const changed = new Set(["data-element:DE-A"]);
    const impacts = calculateDependencyImpacts(graph, changed);

    expect(impacts.impactsByResourceId.get("rule:Rule A")?.[0]).toMatchObject({
      changedResourceId: "data-element:DE-A",
      resourceIds: ["data-element:DE-A", "data-element:DE-B", "rule:Rule A"],
      resourceNames: ["DE-A", "DE-B", "Rule A"],
      direct: false
    });
    expect(impacts.impactsByResourceId.get("data-element:DE-B")?.[0]).toMatchObject({
      direct: true
    });
  });

  it("terminates safely when dependency cycles exist", () => {
    const resources = annotateDataElementReferences([
      dataElement("DE-A", { settings: { source: `_satellite.getVar("DE-B");` } }),
      dataElement("DE-B", { settings: { source: `_satellite.getVar("DE-C");` } }),
      dataElement("DE-C", { settings: { source: `_satellite.getVar("DE-A");` } }),
      rule("Rule A", { settings: { source: `_satellite.getVar("DE-B");` } })
    ]);
    const graph = buildDataElementDependencyGraph(resources);
    const impacts = calculateDependencyImpacts(graph, new Set(["data-element:DE-C"]));

    expect(impacts.impactsByResourceId.get("rule:Rule A")?.[0]?.resourceIds).toEqual([
      "data-element:DE-C",
      "data-element:DE-B",
      "rule:Rule A"
    ]);
  });

  it("keeps Impacted distinct from Modified status inputs", () => {
    const unchangedDependent = rule("Rule A", {
      settings: { source: `_satellite.getVar("Changed DE");` }
    });
    const changedDataElement = dataElement("Changed DE");
    const graph = buildDataElementDependencyGraph(
      annotateDataElementReferences([unchangedDependent, changedDataElement])
    );
    const impacts = calculateDependencyImpacts(graph, new Set([resourceGraphId(changedDataElement)]));

    expect(impacts.impactsByResourceId.has(resourceGraphId(unchangedDependent))).toBe(true);
    expect(resourceGraphId(unchangedDependent)).toBe("rule:Rule A");
  });
});

function dataElement(name: string, raw: unknown = {}): LaunchResource {
  return resource("data-element", name, raw);
}

function rule(name: string, raw: unknown): LaunchResource {
  return resource("rule", name, raw);
}

function resource(
  resourceType: LaunchResource["identity"]["resourceType"],
  name: string,
  raw: unknown
): LaunchResource {
  return {
    identity: {
      resourceType,
      name
    },
    raw,
    normalized: raw,
    normalizedSource: typeof raw === "string" ? raw : JSON.stringify(raw),
    contentFingerprint: name,
    children: [],
    fileIds: [],
    dataElementReferences: [],
    metadata: {},
    warnings: []
  };
}
