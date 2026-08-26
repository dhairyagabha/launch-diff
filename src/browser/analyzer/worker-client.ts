import type {
  AnalyzerWorkerCommand,
  AnalyzerWorkerMessage
} from "./worker-protocol";
import type { BrowserAnalysisInput, BrowserAnalysisProgressListener } from "./types";
import type { ComparisonResult } from "@/core/launch-analyzer";

export interface WorkerLike {
  postMessage(message: AnalyzerWorkerCommand): void;
  terminate(): void;
  addEventListener(
    type: "message",
    listener: (event: { data: AnalyzerWorkerMessage }) => void
  ): void;
}

export class AnalyzerWorkerClient {
  private nextId = 0;
  private readonly pending = new Map<
    string,
    {
      resolve: (comparison: ComparisonResult) => void;
      reject: (error: Error) => void;
      onProgress?: BrowserAnalysisProgressListener;
    }
  >();

  constructor(private readonly worker: WorkerLike) {
    this.worker.addEventListener("message", (event) => this.handleMessage(event.data));
  }

  analyze(
    input: BrowserAnalysisInput,
    onProgress?: BrowserAnalysisProgressListener
  ): Promise<ComparisonResult> {
    return this.sendAnalysisCommand("analyze", input, onProgress);
  }

  retryFailedResources(
    input: BrowserAnalysisInput,
    onProgress?: BrowserAnalysisProgressListener
  ): Promise<ComparisonResult> {
    return this.sendAnalysisCommand("retry-failed", input, onProgress);
  }

  refreshLibraries(
    input: BrowserAnalysisInput,
    onProgress?: BrowserAnalysisProgressListener
  ): Promise<ComparisonResult> {
    return this.sendAnalysisCommand("refresh", input, onProgress);
  }

  cancel(): void {
    this.worker.postMessage({
      id: "cancel",
      type: "cancel"
    });
  }

  terminate(): void {
    this.worker.terminate();
    this.pending.clear();
  }

  private sendAnalysisCommand(
    type: Extract<AnalyzerWorkerCommand["type"], "analyze" | "retry-failed" | "refresh">,
    input: BrowserAnalysisInput,
    onProgress: BrowserAnalysisProgressListener | undefined
  ): Promise<ComparisonResult> {
    const id = `analysis:${this.nextId}`;
    this.nextId += 1;

    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve,
        reject,
        onProgress
      });
      this.worker.postMessage({
        id,
        type,
        input
      });
    });
  }

  private handleMessage(message: AnalyzerWorkerMessage): void {
    const pending = this.pending.get(message.id);

    if (!pending) {
      return;
    }

    if (message.type === "progress") {
      pending.onProgress?.(message.progress);
      return;
    }

    this.pending.delete(message.id);

    if (message.type === "result") {
      pending.resolve(message.comparison);
      return;
    }

    if (message.type === "cancelled") {
      pending.reject(new Error("Analysis was cancelled."));
      return;
    }

    pending.reject(new Error(message.message));
  }
}
