import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  compareResolvedLibraries,
  discoverDeferredLaunchResources,
  parseCurrentLaunchLibrary,
  resolveDeferredLaunchResources,
  type ResourceFetcher,
  type ResourceFetchRequest,
  type ResourceFetchResult
} from "@/core/launch-analyzer";
import {
  createLocalFixtureResourceFetcher,
  loadSanitizedFixtureManifest,
  sanitizedFixtureRoot
} from "../../support/fixtures";

describe("deferred Launch resource resolver", () => {
  it("discovers only parser-confirmed Turbine filePaths and retains all owners", () => {
    const { library } = parseDeferredFixture();
    const references = discoverDeferredLaunchResources(library);

    expect(references.map((reference) => reference.url)).toEqual([
      "https://assets.example.test/extensions/core/rules/shared-helper.js",
      "https://assets.example.test/extensions/core/rules/action-only.js"
    ]);
    expect(references).toHaveLength(2);
    expect(totalOwners(references)).toBe(6);
    expect(references[0]?.owners.map((owner) => owner.resourceType).sort()).toEqual([
      "data-element",
      "extension",
      "extension",
      "rule"
    ]);
  });

  it("fetches shared deferred resources once and never follows source text URLs", async () => {
    const { library, manifest, fixtureRoot } = parseDeferredFixture();
    const fetcher = createLocalFixtureResourceFetcher(fixtureRoot, manifest);
    const recordingFetcher = new RecordingFetcher(fetcher);
    const result = await resolveDeferredLaunchResources({
      library,
      fetcher: recordingFetcher
    });

    expect(recordingFetcher.requestedUrls).toEqual([
      "https://assets.example.test/extensions/core/rules/shared-helper.js",
      "https://assets.example.test/extensions/core/rules/action-only.js",
      "https://assets.example.test/extensions/core/rules/nested-helper.js"
    ]);
    expect(recordingFetcher.requestedUrls.some((url) => url.includes("pixel.gif"))).toBe(false);
    expect(recordingFetcher.requestedUrls.some((url) => url.endsWith(".map"))).toBe(false);
    expect(result.references).toHaveLength(manifest.libraries[0]!.expected.deferredResources);
    expect(totalOwners(result.references)).toBe(manifest.libraries[0]!.expected.mappedOwners);
    expect(result.library.files.filter((file) => file.state === "resolved")).toHaveLength(4);
    expect(
      result.library.files.find((file) =>
        file.authoritativeUrl.endsWith("/rules/shared-helper.js")
      )?.owners
    ).toHaveLength(4);
  });

  it("fetches parser-confirmed external custom-code source URLs and attaches readable source", async () => {
    const sourceUrl = "https://assets.example.test/rules/external-source.js";
    const source = `_satellite._container={
      buildInfo:{turbineVersion:"29.0.0",turbineBuildDate:"2026-06-01T00:00:00Z",buildDate:"2026-06-13T01:22:12Z",minified:true},
      company:{orgId:"ABCDEF1234567890ABCDEF12@AdobeOrg",dynamicCdnEnabled:true},
      property:{name:"Property",id:"PR12345678901234567890123456789012",settings:{undefinedVarsReturnEmpty:false,domains:["example.test"],ruleComponentSequencingEnabled:true}},
      environment:{id:"EN12345678901234567890123456789012",stage:"development"},
      dataElements:{},
      extensions:{},
      rules:[{id:"RL12345678901234567890123456789012",name:"External Source Rule",events:[],conditions:[],actions:[{
        modulePath:"core/src/lib/actions/customCode.js",
        settings:{source:${JSON.stringify(sourceUrl)},language:"javascript",isExternal:true},
        timeout:2000,
        delayNext:true
      }]}]
    };`;
    const library = parseCurrentLaunchLibrary({
      source,
      canonicalUrl: "https://assets.example.test/launch/current.min.js"
    });
    const fetcher = new StaticFetcher({
      [sourceUrl]: `function checkout(){return "external";}`
    });
    const result = await resolveDeferredLaunchResources({
      library,
      fetcher
    });
    const rule = result.library.resources.find(
      (resource) => resource.identity.name === "External Source Rule"
    );
    const rawRule = rule?.raw as {
      actions: Array<{ settings: { source: string; isExternal: boolean } }>;
    };

    expect(fetcher.requestedUrls).toEqual([sourceUrl]);
    expect(result.references[0]?.sourcePath).toEqual(["actions", "0", "settings", "source"]);
    expect(result.references[0]?.targets[0]).toMatchObject({
      kind: "external-custom-code-source",
      sourcePath: ["actions", "0", "settings", "source"]
    });
    expect(rawRule.actions[0]?.settings).toMatchObject({
      source: `function checkout(){return "external";}`,
      isExternal: true
    });
    expect(rule?.normalizedSource).toContain("function checkout(){return");
    expect(rule?.fileIds).toEqual(["canonical", "deferred:1"]);
  });

  it("compares external custom-code sources by fetched content rather than URL text", async () => {
    const baseSourceUrl = "https://assets.example.test/rules/source-a.js";
    const compareSourceUrl = "https://assets.example.test/rules/source-b.js";
    const embeddedSource = `document.addEventListener("ubxBasicConfigured", function(){_satellite.getVar('User_Registration_Type');});`;
    const fetcher = new StaticFetcher({
      [baseSourceUrl]: registeredScript(baseSourceUrl, embeddedSource),
      [compareSourceUrl]: registeredScript(compareSourceUrl, embeddedSource)
    });
    const base = await resolveDeferredLaunchResources({
      library: externalCustomCodeLibrary(baseSourceUrl, "https://assets.example.test/base.js"),
      fetcher
    });
    const compare = await resolveDeferredLaunchResources({
      library: externalCustomCodeLibrary(compareSourceUrl, "https://assets.example.test/compare.js"),
      fetcher
    });
    const result = compareResolvedLibraries(base.library, compare.library);

    expect(result.ok).toBe(true);
    expect(
      result.ok
        ? result.comparison.resources.find(
            (comparison) => comparison.compare?.identity.name === "External Source Rule"
          )?.status
        : undefined
    ).toBe("unchanged");
    expect(
      (compare.library.resources.find(
        (resource) => resource.identity.name === "External Source Rule"
      )?.raw as { actions: Array<{ settings: { source: string } }> }).actions[0]?.settings.source
    ).toBe(embeddedSource);
  });

  it("compares external HTML custom-code source URLs by fetched content", async () => {
    const baseSourceUrl =
      "https://assets.adobedtm.com/7e08552ade3f/cd31470b7293/ae45bd66c665/RCf92-source.js";
    const compareSourceUrl =
      "https://assets.adobedtm.com/7e08552ade3f/cd31470b7293/ad97f2c3959c/RCf92-source.js";
    const htmlSource = `<script>window.ubxUtilities.consoleDebug();</script>`;
    const fetcher = new StaticFetcher({
      [baseSourceUrl]: htmlSource,
      [compareSourceUrl]: htmlSource
    });
    const base = await resolveDeferredLaunchResources({
      library: externalCustomCodeLibrary(baseSourceUrl, "https://assets.example.test/base.js", {
        language: "html"
      }),
      fetcher
    });
    const compare = await resolveDeferredLaunchResources({
      library: externalCustomCodeLibrary(
        compareSourceUrl,
        "https://assets.example.test/compare.js",
        {
          language: "html"
        }
      ),
      fetcher
    });
    const result = compareResolvedLibraries(base.library, compare.library);

    expect(fetcher.requestedUrls).toEqual([baseSourceUrl, compareSourceUrl]);
    expect(result.ok).toBe(true);
    expect(
      result.ok
        ? result.comparison.resources.find(
            (comparison) => comparison.compare?.identity.name === "External Source Rule"
          )?.status
        : undefined
    ).toBe("unchanged");
    expect(
      (compare.library.resources.find(
        (resource) => resource.identity.name === "External Source Rule"
      )?.raw as { actions: Array<{ settings: { source: string; language: string } }> }).actions[0]
        ?.settings
    ).toMatchObject({
      source: htmlSource,
      language: "html"
    });
  });

  it("marks matched resources unknown when external custom-code content cannot be fetched", async () => {
    const base = await resolveDeferredLaunchResources({
      library: externalCustomCodeLibrary(
        "https://assets.example.test/rules/base-missing-source.js",
        "https://assets.example.test/base.js"
      ),
      fetcher: new StaticFetcher({})
    });
    const compare = await resolveDeferredLaunchResources({
      library: externalCustomCodeLibrary(
        "https://assets.example.test/rules/compare-missing-source.js",
        "https://assets.example.test/compare.js"
      ),
      fetcher: new StaticFetcher({})
    });
    const result = compareResolvedLibraries(base.library, compare.library);

    expect(result.ok).toBe(true);
    expect(
      result.ok
        ? result.comparison.resources.find(
            (comparison) => comparison.compare?.identity.name === "External Source Rule"
          )?.status
        : undefined
    ).toBe("unknown");
  });

  it("records unresolved external custom-code sources on the owning resource", async () => {
    const sourceUrl = "https://assets.example.test/rules/missing-source.js";
    const source = `_satellite._container={
      buildInfo:{turbineVersion:"29.0.0",turbineBuildDate:"2026-06-01T00:00:00Z",buildDate:"2026-06-13T01:22:12Z",minified:true},
      company:{orgId:"ABCDEF1234567890ABCDEF12@AdobeOrg",dynamicCdnEnabled:true},
      property:{name:"Property",id:"PR12345678901234567890123456789012",settings:{undefinedVarsReturnEmpty:false,domains:["example.test"],ruleComponentSequencingEnabled:true}},
      environment:{id:"EN12345678901234567890123456789012",stage:"development"},
      dataElements:{},
      extensions:{},
      rules:[{id:"RL12345678901234567890123456789012",name:"Missing External Source Rule",events:[],conditions:[],actions:[{
        modulePath:"core/src/lib/actions/customCode.js",
        settings:{source:${JSON.stringify(sourceUrl)},language:"javascript",isExternal:true},
        timeout:2000,
        delayNext:true
      }]}]
    };`;
    const library = parseCurrentLaunchLibrary({
      source,
      canonicalUrl: "https://assets.example.test/launch/current.min.js"
    });
    const result = await resolveDeferredLaunchResources({
      library,
      fetcher: new StaticFetcher({})
    });
    const rule = result.library.resources.find(
      (resource) => resource.identity.name === "Missing External Source Rule"
    );
    const rawRule = rule?.raw as { actions: Array<{ settings: { source: string } }> };

    expect(result.library.files.find((file) => file.id === "deferred:1")?.state).toBe("failed");
    expect(rawRule.actions[0]?.settings.source).not.toBe(sourceUrl);
    expect(rule?.metadata.unresolvedExternalCustomCodeSources).toEqual([
      "actions.0.settings.source"
    ]);
  });

  it("keeps a known failed state for parser-confirmed deferred resources that cannot be loaded", async () => {
    const { library, manifest, fixtureRoot } = parseDeferredFixture();
    const fetcher = createLocalFixtureResourceFetcher(fixtureRoot, manifest);
    const failingFetcher: ResourceFetcher = {
      async fetchResource(request: ResourceFetchRequest): Promise<ResourceFetchResult> {
        if (request.url.endsWith("/rules/action-only.js")) {
          return {
            ok: false,
            failure: {
              reason: "not-found",
              retriable: false,
              message: "Fixture intentionally failed this deferred resource."
            },
            metadata: {
              requestedUrl: request.url,
              fetchedAt: "1970-01-01T00:00:00.000Z",
              attempts: 1
            }
          };
        }

        return fetcher.fetchResource(request);
      }
    };

    const result = await resolveDeferredLaunchResources({
      library,
      fetcher: failingFetcher
    });
    const failedFile = result.library.files.find((file) => file.state === "failed");

    expect(failedFile?.authoritativeUrl).toBe(
      "https://assets.example.test/extensions/core/rules/action-only.js"
    );
    expect(result.library.completeness).toMatchObject({
      state: "incomplete-retry-recommended",
      failed: 1
    });
  });
});

class RecordingFetcher implements ResourceFetcher {
  readonly requestedUrls: string[] = [];

  constructor(private readonly delegate: ResourceFetcher) {}

  async fetchResource(request: ResourceFetchRequest): Promise<ResourceFetchResult> {
    this.requestedUrls.push(request.url);

    return this.delegate.fetchResource(request);
  }
}

class StaticFetcher implements ResourceFetcher {
  readonly requestedUrls: string[] = [];

  constructor(private readonly sourcesByUrl: Record<string, string>) {}

  async fetchResource(request: ResourceFetchRequest): Promise<ResourceFetchResult> {
    this.requestedUrls.push(request.url);

    const source = this.sourcesByUrl[request.url];

    if (source === undefined) {
      return {
        ok: false,
        failure: {
          reason: "not-found",
          retriable: false,
          message: "No static source was registered for this URL."
        },
        metadata: {
          requestedUrl: request.url,
          fetchedAt: "1970-01-01T00:00:00.000Z",
          attempts: 1
        }
      };
    }

    return {
      ok: true,
      body: {
        kind: "text",
        text: source
      },
      metadata: {
        requestedUrl: request.url,
        finalUrl: request.url,
        fetchedAt: "1970-01-01T00:00:00.000Z",
        attempts: 1,
        byteLength: source.length
      }
    };
  }
}

function parseDeferredFixture() {
  const fixtureRoot = sanitizedFixtureRoot("deferred-filepaths");
  const manifest = loadSanitizedFixtureManifest("deferred-filepaths");
  const source = readFileSync(resolve(fixtureRoot, "artifacts/base/launch-deferred.min.js"), "utf8");
  const library = parseCurrentLaunchLibrary({
    source,
    canonicalUrl: manifest.libraries[0]!.canonicalUrl
  });

  return {
    fixtureRoot,
    manifest,
    library
  };
}

function externalCustomCodeLibrary(
  sourceUrl: string,
  canonicalUrl: string,
  options: { language?: "javascript" | "html" } = {}
) {
  const language = options.language ?? "javascript";

  return parseCurrentLaunchLibrary({
    source: `_satellite._container={
      buildInfo:{turbineVersion:"29.0.0",turbineBuildDate:"2026-06-01T00:00:00Z",buildDate:"2026-06-13T01:22:12Z",minified:true},
      company:{orgId:"ABCDEF1234567890ABCDEF12@AdobeOrg",dynamicCdnEnabled:true},
      property:{name:"Property",id:"PR12345678901234567890123456789012",settings:{undefinedVarsReturnEmpty:false,domains:["example.test"],ruleComponentSequencingEnabled:true}},
      environment:{id:"EN12345678901234567890123456789012",stage:"development"},
      dataElements:{},
      extensions:{},
      rules:[{id:"RL12345678901234567890123456789012",name:"External Source Rule",events:[],conditions:[],actions:[{
        modulePath:"core/src/lib/actions/customCode.js",
        settings:{source:${JSON.stringify(sourceUrl)},language:${JSON.stringify(language)},isExternal:true},
        timeout:2000,
        delayNext:true
      }]}]
    };`,
    canonicalUrl
  });
}

function registeredScript(sourceUrl: string, source: string): string {
  return `_satellite.__registerScript(${JSON.stringify(sourceUrl)}, ${JSON.stringify(source)});`;
}

function totalOwners(references: Array<{ owners: unknown[] }>): number {
  return references.reduce((sum, reference) => sum + reference.owners.length, 0);
}
