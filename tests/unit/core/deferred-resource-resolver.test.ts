import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
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

function totalOwners(references: Array<{ owners: unknown[] }>): number {
  return references.reduce((sum, reference) => sum + reference.owners.length, 0);
}
