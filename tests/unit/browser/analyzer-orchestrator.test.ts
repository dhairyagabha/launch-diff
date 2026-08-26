import { describe, expect, it } from "vitest";
import {
  AnalysisCancelledError,
  BrowserAnalysisOrchestrator,
  ResolvedLibraryMemoryCache,
  clearSessionConfig,
  loadSessionConfig,
  saveSessionConfig,
  type AnalysisTransport,
  type BrowserAnalysisProgress
} from "@/browser/analyzer";
import type { ResourceFetchResult } from "@/core/launch-analyzer/fetcher/resource-fetcher";

describe("browser analysis orchestrator", () => {
  it("reuses fully complete resolved libraries from browser memory", async () => {
    const transport = new FakeTransport({
      baseSource: launchSource("old"),
      compareSource: launchSource("new")
    });
    const orchestrator = new BrowserAnalysisOrchestrator(
      transport,
      new ResolvedLibraryMemoryCache()
    );
    const input = analysisInput();
    const first = await orchestrator.analyze(input);
    const second = await orchestrator.analyze(input);

    expect(first.reusedCache).toEqual({ base: false, compare: false });
    expect(second.reusedCache).toEqual({ base: true, compare: true });
    expect(transport.startCalls).toBe(1);
  });

  it("does not cache incomplete libraries as reusable complete entries", async () => {
    const transport = new FakeTransport({
      baseSource: launchSource("same", { deferred: true }),
      compareSource: launchSource("same", { deferred: true }),
      deferredResult: failedFetchResult("https://assets.example.test/launch/deferred.js")
    });
    const orchestrator = new BrowserAnalysisOrchestrator(
      transport,
      new ResolvedLibraryMemoryCache()
    );
    const input = analysisInput();

    await orchestrator.analyze(input);
    await orchestrator.analyze(input);

    expect(transport.startCalls).toBe(2);
  });

  it("retries failed resources by rebuilding incomplete sides and then caches completed retry output", async () => {
    const transport = new FakeTransport({
      baseSource: launchSource("same", { deferred: true }),
      compareSource: launchSource("same", { deferred: true }),
      deferredResult: failedFetchResult("https://assets.example.test/launch/deferred.js")
    });
    const orchestrator = new BrowserAnalysisOrchestrator(
      transport,
      new ResolvedLibraryMemoryCache()
    );
    const input = analysisInput();

    await orchestrator.analyze(input);
    transport.deferredResult = okFetchResult("https://assets.example.test/launch/deferred.js");
    await orchestrator.retryFailedResources(input);
    await orchestrator.analyze(input);

    expect(transport.startCalls).toBe(2);
  });

  it("refreshes libraries by invalidating completed cache entries", async () => {
    const transport = new FakeTransport({
      baseSource: launchSource("old"),
      compareSource: launchSource("new")
    });
    const orchestrator = new BrowserAnalysisOrchestrator(
      transport,
      new ResolvedLibraryMemoryCache()
    );
    const input = analysisInput();

    await orchestrator.analyze(input);
    transport.compareSource = launchSource("newer");
    const refreshed = await orchestrator.refreshLibraries(input);

    expect(transport.startCalls).toBe(2);
    expect(refreshed.reusedCache).toEqual({ base: false, compare: false });
    expect(refreshed.comparison.releaseNotes).toContain('Updated "Smoke Rule" rule.');
  });

  it("reports real progress counts and prioritizes selected detailed diffs", async () => {
    const progress: BrowserAnalysisProgress[] = [];
    const transport = new FakeTransport({
      baseSource: launchSource("old"),
      compareSource: launchSource("new")
    });
    const orchestrator = new BrowserAnalysisOrchestrator(
      transport,
      new ResolvedLibraryMemoryCache(),
      (event) => progress.push(event)
    );
    const result = await orchestrator.analyze({
      ...analysisInput(),
      selectedResourceKey: "rule:RL11111111111111111111111111111111"
    });

    expect(progress.map((event) => event.phase)).toEqual(
      expect.arrayContaining([
        "fetching-canonical",
        "parsing",
        "resolving-deferred",
        "comparing",
        "preparing-diffs",
        "complete"
      ])
    );
    expect(progress.some((event) => event.phase === "resolving-deferred" && event.base?.total === undefined)).toBe(
      true
    );
    expect(
      result.comparison.resources.some(
        (comparison) =>
          comparison.status === "modified" && comparison.detailedDiffState === "ready"
      )
    ).toBe(true);
  });

  it("cancels outstanding work", async () => {
    const transport = new NeverResolvingTransport();
    const orchestrator = new BrowserAnalysisOrchestrator(
      transport,
      new ResolvedLibraryMemoryCache()
    );
    const promise = orchestrator.analyze(analysisInput());

    await Promise.resolve();
    orchestrator.cancel();

    await expect(promise).rejects.toBeInstanceOf(AnalysisCancelledError);
    expect(transport.signal?.aborted).toBe(true);
  });

  it("stores config only in provided session storage", () => {
    const storage = new MemoryStorage();
    const config = {
      version: 1 as const,
      sites: [
        {
          name: "Example",
          environments: [
            { name: "Base", url: "https://assets.example.test/base.js" },
            { name: "Compare", url: "https://assets.example.test/compare.js" }
          ]
        }
      ]
    };

    saveSessionConfig(config, storage);

    expect(loadSessionConfig(storage)).toEqual(config);

    clearSessionConfig(storage);

    expect(loadSessionConfig(storage)).toBeUndefined();
  });
});

function analysisInput() {
  return {
    baseUrl: "https://assets.example.test/launch/base/library.js",
    compareUrl: "https://assets.example.test/launch/compare/library.js"
  };
}

function launchSource(
  ruleSource: string,
  options: {
    deferred?: boolean;
  } = {}
): string {
  const extensions = options.deferred
    ? `extensions:{
        core:{
          displayName:"Core",
          hostedLibFilesBaseUrl:"https://assets.example.test/launch/",
          modules:{
            "core/src/lib/actions/customCode.js":{
              displayName:"Custom Code",
              filePaths:["deferred.js"]
            }
          }
        }
      }`
    : "extensions:{}";

  return `_satellite._container={
    buildInfo:{turbineVersion:"1.0.0",buildDate:"2026-01-01T00:00:00Z"},
    company:{orgId:"ABCDEF1234567890ABCDEF12@AdobeOrg",dynamicCdnEnabled:true},
    property:{id:"PR11111111111111111111111111111111",name:"Property"},
    environment:{id:"EN11111111111111111111111111111111",stage:"development"},
    rules:[{
      id:"RL11111111111111111111111111111111",
      name:"Smoke Rule",
      events:[],
      conditions:[],
      actions:[{modulePath:"core/src/lib/actions/customCode.js",settings:{source:${JSON.stringify(ruleSource)}}}]
    }],
    dataElements:{},
    ${extensions}
  };`;
}

class FakeTransport implements AnalysisTransport {
  startCalls = 0;
  baseSource: string;
  compareSource: string;
  deferredResult: ResourceFetchResult;

  constructor(input: {
    baseSource: string;
    compareSource: string;
    deferredResult?: ResourceFetchResult;
  }) {
    this.baseSource = input.baseSource;
    this.compareSource = input.compareSource;
    this.deferredResult =
      input.deferredResult ?? okFetchResult("https://assets.example.test/launch/deferred.js");
  }

  async startAnalysis() {
    this.startCalls += 1;

    return {
      token: "token",
      base: {
        source: this.baseSource,
        canonicalUrl: analysisInput().baseUrl
      },
      compare: {
        source: this.compareSource,
        canonicalUrl: analysisInput().compareUrl
      }
    };
  }

  async fetchDeferredResource() {
    return this.deferredResult;
  }
}

class NeverResolvingTransport implements AnalysisTransport {
  signal?: AbortSignal;

  startAnalysis(input: { signal: AbortSignal }) {
    this.signal = input.signal;

    return new Promise<never>((_resolve, reject) => {
      input.signal.addEventListener("abort", () => reject(new Error("aborted")));
    });
  }

  async fetchDeferredResource(): Promise<ResourceFetchResult> {
    throw new Error("fetchDeferredResource should not be reached");
  }
}

function okFetchResult(url: string): ResourceFetchResult {
  return {
    ok: true,
    body: {
      kind: "text",
      text: "console.log('deferred');"
    },
    metadata: {
      requestedUrl: url,
      fetchedAt: "1970-01-01T00:00:00.000Z",
      attempts: 1
    }
  };
}

function failedFetchResult(url: string): ResourceFetchResult {
  return {
    ok: false,
    failure: {
      reason: "network-error",
      retriable: true,
      message: "failed"
    },
    metadata: {
      requestedUrl: url,
      fetchedAt: "1970-01-01T00:00:00.000Z",
      attempts: 1
    }
  };
}

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}
