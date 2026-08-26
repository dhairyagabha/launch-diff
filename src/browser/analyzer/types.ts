import type {
  AnalysisProgress,
  ComparisonResult,
  ResolvedLibrary
} from "@/core/launch-analyzer";
import type { ResourceFetchResult } from "@/core/launch-analyzer/fetcher/resource-fetcher";

export interface BrowserAnalysisInput {
  baseUrl: string;
  compareUrl: string;
  selectedResourceKey?: string;
}

export interface BrowserAnalysisResult {
  comparison: ComparisonResult;
  baseLibrary: ResolvedLibrary;
  compareLibrary: ResolvedLibrary;
  reusedCache: {
    base: boolean;
    compare: boolean;
  };
}

export interface AnalysisStartResult {
  token: string;
  base: {
    source: string;
    canonicalUrl: string;
  };
  compare: {
    source: string;
    canonicalUrl: string;
  };
}

export interface AnalysisTransport {
  startAnalysis(input: {
    baseUrl: string;
    compareUrl: string;
    signal: AbortSignal;
  }): Promise<AnalysisStartResult>;
  fetchDeferredResource(input: {
    token: string;
    url: string;
    signal: AbortSignal;
  }): Promise<ResourceFetchResult>;
}

export type BrowserAnalysisProgress = AnalysisProgress;

export type BrowserAnalysisProgressListener = (progress: BrowserAnalysisProgress) => void;
