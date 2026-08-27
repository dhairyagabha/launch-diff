import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { detectCurrentLaunchFormat, parseCurrentLaunchLibrary } from "@/core/launch-analyzer";
import { loadSanitizedFixtureManifest, sanitizedFixtureRoot } from "../../support/fixtures";

const require = createRequire(import.meta.url);

describe("current Launch parser", () => {
  it("tracks Adobe's published Turbine container schema as the fixture reference", () => {
    const schemaPath = require.resolve("@adobe/reactor-turbine-schemas/schemas/container.json");
    const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as {
      properties: {
        rules: { items: { properties: { id: { pattern: string } } } };
        property: { properties: { id: { pattern: string } } };
      };
    };

    expect(schema.properties.rules.items.properties.id.pattern).toBe("RL[a-zA-Z0-9]{32}");
    expect(schema.properties.property.properties.id.pattern).toBe("PR[a-zA-Z0-9]{32}");
  });

  it("detects the documented static _satellite._container format", () => {
    const source = readFixtureSource();

    expect(detectCurrentLaunchFormat(source)).toEqual({
      detected: true,
      reason: "container-object-literal"
    });
  });

  it("detects the window._satellite.container runtime assignment used by deployed builds", () => {
    const source = `window._satellite.container={
      buildInfo:{turbineVersion:"29.0.0",turbineBuildDate:"2026-01-01T00:00:00Z",buildDate:"2026-01-02T00:00:00Z",minified:true},
      company:{orgId:"ABCDEF1234567890ABCDEF12@AdobeOrg",dynamicCdnEnabled:true},
      property:{name:"Property",id:"PR12345678901234567890123456789012",settings:{undefinedVarsReturnEmpty:false,domains:["example.test"],ruleComponentSequencingEnabled:true}},
      environment:{id:"EN12345678901234567890123456789012",stage:"production"},
      rules:[{id:"RL12345678901234567890123456789012",name:"Deployed Rule",events:[],conditions:[],actions:[]}],
      dataElements:{Hostname:{modulePath:"core/src/lib/dataElements/javascriptVariable.js",storageDuration:"pageview"}},
      extensions:{core:{displayName:"Core",modules:{}}}
    };`;
    const library = parseCurrentLaunchLibrary({
      source,
      canonicalUrl: "https://assets.example.test/launch/current/production.min.js"
    });

    expect(detectCurrentLaunchFormat(source)).toEqual({
      detected: true,
      reason: "container-object-literal"
    });
    expect(countResources(library.resources, "runtime")).toBe(1);
    expect(countResources(library.resources, "rule")).toBe(1);
    expect(countResources(library.resources, "data-element")).toBe(1);
    expect(countResources(library.resources, "extension")).toBe(1);
    expect(countResources(library.resources, "unmapped")).toBe(0);
  });

  it("extracts rules, data elements, extensions, child components, and runtime metadata", () => {
    const manifest = loadSanitizedFixtureManifest("current-container-minimal");
    const source = readFixtureSource();
    const library = parseCurrentLaunchLibrary({
      source,
      canonicalUrl: manifest.libraries[0]!.canonicalUrl
    });

    expect(countResources(library.resources, "rule")).toBe(manifest.libraries[0]!.expected.rules);
    expect(countResources(library.resources, "data-element")).toBe(
      manifest.libraries[0]!.expected.dataElements
    );
    expect(countResources(library.resources, "extension")).toBe(
      manifest.libraries[0]!.expected.extensions
    );
    expect(countResources(library.resources, "unmapped")).toBe(
      manifest.libraries[0]!.expected.unmapped
    );
    expect(library.warnings).toHaveLength(manifest.libraries[0]!.expected.warnings);
    expect(library.metadata).toMatchObject({
      propertyId: "PR12345678901234567890123456789012",
      propertyName: "Sanitized Example Property",
      environmentId: "EN12345678901234567890123456789012",
      environmentStage: "development",
      turbineVersion: "29.0.0",
      minified: true
    });

    const rule = library.resources.find((resource) => resource.identity.resourceType === "rule");
    expect(rule?.identity).toMatchObject({
      resourceType: "rule",
      launchResourceId: "RL12345678901234567890123456789012",
      name: "Smoke Rule"
    });
    expect(rule?.children.map((child) => child.componentType)).toEqual(["event", "action"]);
    expect(rule?.children[0]).toMatchObject({
      componentType: "event",
      extensionId: "core",
      moduleType: "core/src/lib/events/pageTop.js",
      order: 50
    });

    const dataElement = library.resources.find(
      (resource) => resource.identity.resourceType === "data-element"
    );
    expect(dataElement?.identity).toMatchObject({
      resourceType: "data-element",
      name: "Hostname"
    });
    expect(dataElement?.metadata).toMatchObject({
      modulePath: "core/src/lib/dataElements/javascriptVariable.js",
      storageDuration: "pageview"
    });

    const extension = library.resources.find(
      (resource) => resource.identity.resourceType === "extension"
    );
    expect(extension?.identity).toMatchObject({
      resourceType: "extension",
      name: "Core"
    });
    expect(extension?.children).toHaveLength(2);
  });

  it("preserves unsupported container properties as unmapped resources", () => {
    const source = `_satellite._container={
      buildInfo:{turbineVersion:"1.0.0",turbineBuildDate:"2026-01-01T00:00:00Z",buildDate:"2026-01-02T00:00:00Z"},
      company:{orgId:"ABCDEF1234567890ABCDEF12@AdobeOrg",dynamicCdnEnabled:true},
      property:{name:"Property",id:"PR12345678901234567890123456789012",settings:{undefinedVarsReturnEmpty:false,domains:["example.test"],ruleComponentSequencingEnabled:true}},
      mystery:{keep:"visible"}
    };`;

    const library = parseCurrentLaunchLibrary({
      source,
      canonicalUrl: "https://assets.example.test/launch/current/unknown.min.js"
    });

    const unmapped = library.resources.find(
      (resource) => resource.identity.resourceType === "unmapped"
    );

    expect(unmapped?.identity.name).toBe("Unmapped container property: mystery");
    expect(unmapped?.raw).toEqual({ keep: "visible" });
    expect(library.warnings.map((warning) => warning.code)).toContain(
      "unmapped-container-property"
    );
  });

  it("falls back to an unmapped source resource when no static container is available", () => {
    const source = `var dynamicContainer = getContainer(); _satellite._container = dynamicContainer;`;
    const library = parseCurrentLaunchLibrary({
      source,
      canonicalUrl: "https://assets.example.test/launch/current/dynamic.min.js"
    });

    expect(detectCurrentLaunchFormat(source)).toEqual({
      detected: false,
      reason: "container-assignment-not-static-object"
    });
    expect(library.resources).toHaveLength(1);
    expect(library.resources[0]?.identity.resourceType).toBe("unmapped");
    expect(library.resources[0]?.metadata).toMatchObject({
      fallbackKind: "canonical-source"
    });
    expect(library.resources[0]?.normalizedSource).toBe(source);
  });
});

function readFixtureSource(): string {
  return readFileSync(
    resolve(
      sanitizedFixtureRoot("current-container-minimal"),
      "artifacts/base/launch-current.min.js"
    ),
    "utf8"
  );
}

function countResources(
  resources: Array<{ identity: { resourceType: string } }>,
  resourceType: string
): number {
  return resources.filter((resource) => resource.identity.resourceType === resourceType).length;
}
