import {
  compareResolvedLibraries,
  createDetailedDiffQueue,
  parseCurrentLaunchLibrary,
  populateComparisonDetailedDiffs,
  resolveDeferredLaunchResources,
  type ResolvedLibrary
} from "@/core/launch-analyzer";
import type { ResourceFetcher } from "@/core/launch-analyzer/fetcher/resource-fetcher";
import { ResolvedLibraryMemoryCache } from "./library-cache";
import type {
  AnalysisTransport,
  BrowserAnalysisInput,
  BrowserAnalysisProgressListener,
  BrowserAnalysisResult
} from "./types";

interface RunOptions {
  refresh: boolean;
}

export class AnalysisCancelledError extends Error {
  constructor() {
    super("Analysis was cancelled.");
    this.name = "AnalysisCancelledError";
  }
}

export class BrowserAnalysisOrchestrator {
  private activeController?: AbortController;

  constructor(
    private readonly transport: AnalysisTransport,
    private readonly cache = new ResolvedLibraryMemoryCache(),
    private readonly onProgress: BrowserAnalysisProgressListener = () => {}
  ) {}

  analyze(input: BrowserAnalysisInput): Promise<BrowserAnalysisResult> {
    return this.runAnalysis(input, { refresh: false });
  }

  retryFailedResources(input: BrowserAnalysisInput): Promise<BrowserAnalysisResult> {
    return this.runAnalysis(input, { refresh: false });
  }

  refreshLibraries(input: BrowserAnalysisInput): Promise<BrowserAnalysisResult> {
    this.cache.delete(input.baseUrl);
    this.cache.delete(input.compareUrl);

    return this.runAnalysis(input, { refresh: true });
  }

  cancel(): void {
    this.activeController?.abort();
  }

  private async runAnalysis(
    input: BrowserAnalysisInput,
    options: RunOptions
  ): Promise<BrowserAnalysisResult> {
    this.cancel();

    const controller = new AbortController();
    this.activeController = controller;

    try {
      const result = await this.performAnalysis(input, options, controller.signal);

      return result;
    } catch (error) {
      if (controller.signal.aborted) {
        throw new AnalysisCancelledError();
      }

      throw error;
    } finally {
      if (this.activeController === controller) {
        this.activeController = undefined;
      }
    }
  }

  private async performAnalysis(
    input: BrowserAnalysisInput,
    options: RunOptions,
    signal: AbortSignal
  ): Promise<BrowserAnalysisResult> {
    const cachedBase = options.refresh ? undefined : this.cache.getComplete(input.baseUrl);
    const cachedCompare = options.refresh ? undefined : this.cache.getComplete(input.compareUrl);

    this.throwIfCancelled(signal);

    if (cachedBase && cachedCompare) {
      this.emitProgress("matching", 1, 1);

      return this.compareLibraries(input, cachedBase, cachedCompare, {
        base: true,
        compare: true
      });
    }

    this.emitProgress("fetching-canonical", 0, 2);
    const start = await this.transport.startAnalysis({
      baseUrl: input.baseUrl,
      compareUrl: input.compareUrl,
      signal
    });
    this.throwIfCancelled(signal);
    this.emitProgress("fetching-canonical", 2, 2);

    const baseLibrary =
      cachedBase ??
      (await this.resolveLibrary({
        source: start.base.source,
        canonicalUrl: start.base.canonicalUrl,
        token: start.token,
        signal,
        side: "base"
      }));
    const compareLibrary =
      cachedCompare ??
      (await this.resolveLibrary({
        source: start.compare.source,
        canonicalUrl: start.compare.canonicalUrl,
        token: start.token,
        signal,
        side: "compare"
      }));

    this.cache.setIfComplete(input.baseUrl, baseLibrary);
    this.cache.setIfComplete(input.compareUrl, compareLibrary);

    return this.compareLibraries(input, baseLibrary, compareLibrary, {
      base: Boolean(cachedBase),
      compare: Boolean(cachedCompare)
    });
  }

  private async resolveLibrary(input: {
    source: string;
    canonicalUrl: string;
    token: string;
    signal: AbortSignal;
    side: "base" | "compare";
  }): Promise<ResolvedLibrary> {
    this.throwIfCancelled(input.signal);
    this.emitProgress("parsing", 0, 1);
    await yieldToMainThread();

    const parsed = parseCurrentLaunchLibrary({
      source: input.source,
      canonicalUrl: input.canonicalUrl
    });

    this.throwIfCancelled(input.signal);
    this.emitProgress("parsing", 1, 1);
    this.emitProgress("resolving-deferred", 0, undefined);

    const resolved = await resolveDeferredLaunchResources({
      library: parsed,
      fetcher: new TransportResourceFetcher(this.transport, input.token, input.signal)
    });

    this.throwIfCancelled(input.signal);
    this.emitProgress("resolving-deferred", resolved.references.length, resolved.references.length);
    this.emitProgress("normalizing", 1, 1);

    return resolved.library;
  }

  private async compareLibraries(
    input: BrowserAnalysisInput,
    baseLibrary: ResolvedLibrary,
    compareLibrary: ResolvedLibrary,
    reusedCache: BrowserAnalysisResult["reusedCache"]
  ): Promise<BrowserAnalysisResult> {
    this.emitProgress("comparing", 0, 1);
    await yieldToMainThread();

    const comparison = compareResolvedLibraries(baseLibrary, compareLibrary);

    if (!comparison.ok) {
      throw new Error(comparison.warning.message);
    }

    this.emitProgress("comparing", 1, 1);
    const detailedDiffQueue = createDetailedDiffQueue(comparison.comparison.resources, {
      selectedResourceKey: input.selectedResourceKey
    });
    this.emitProgress("preparing-diffs", 0, detailedDiffQueue.length);

    const comparisonWithDiffs = populateComparisonDetailedDiffs(comparison.comparison, {
      selectedResourceKey: input.selectedResourceKey
    });

    this.emitProgress("preparing-diffs", detailedDiffQueue.length, detailedDiffQueue.length);
    this.emitProgress("complete", 1, 1);

    return {
      comparison: comparisonWithDiffs,
      baseLibrary,
      compareLibrary,
      reusedCache
    };
  }

  private emitProgress(
    phase: Parameters<BrowserAnalysisProgressListener>[0]["phase"],
    completed: number,
    total: number | undefined
  ): void {
    this.onProgress({
      phase,
      base: {
        completed,
        ...(total === undefined ? {} : { total })
      }
    });
  }

  private throwIfCancelled(signal: AbortSignal): void {
    if (signal.aborted) {
      throw new AnalysisCancelledError();
    }
  }
}

class TransportResourceFetcher implements ResourceFetcher {
  constructor(
    private readonly transport: AnalysisTransport,
    private readonly token: string,
    private readonly signal: AbortSignal
  ) {}

  fetchResource(request: { url: string }) {
    return this.transport.fetchDeferredResource({
      token: this.token,
      url: request.url,
      signal: this.signal
    });
  }
}

function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
