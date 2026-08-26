import type {
  FetchMetadata,
  ResourceFetchFailureReason
} from "@/core/launch-analyzer";
import type { ResourceFetchResult } from "@/core/launch-analyzer/fetcher/resource-fetcher";
import type { AnalysisStartResult, AnalysisTransport } from "./types";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface StartApiResponse {
  token: string;
  base: {
    source: string;
    metadata: FetchMetadataLike;
  };
  compare: {
    source: string;
    metadata: FetchMetadataLike;
  };
}

interface FetchApiResponse {
  results: Array<{
    requestedUrl: string;
    ok: boolean;
    source?: string;
    metadata: FetchMetadataLike;
    error?: {
      category: string;
      message: string;
      httpStatus?: number;
    };
  }>;
}

interface FetchMetadataLike {
  requestedUrl: string;
  finalUrl?: string;
  httpStatus?: number;
  contentType?: string;
  byteLength?: number;
  attempts: number;
}

export class ApiAnalysisTransport implements AnalysisTransport {
  constructor(private readonly fetchImpl: FetchLike = fetch) {}

  async startAnalysis(input: {
    baseUrl: string;
    compareUrl: string;
    signal: AbortSignal;
  }): Promise<AnalysisStartResult> {
    const response = await this.fetchImpl("/api/analysis/start", {
      method: "POST",
      signal: input.signal,
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        baseUrl: input.baseUrl,
        compareUrl: input.compareUrl
      })
    });

    if (!response.ok) {
      throw new Error("Analysis start request failed.");
    }

    const body = (await response.json()) as StartApiResponse;

    return {
      token: body.token,
      base: {
        source: body.base.source,
        canonicalUrl: body.base.metadata.finalUrl ?? body.base.metadata.requestedUrl
      },
      compare: {
        source: body.compare.source,
        canonicalUrl: body.compare.metadata.finalUrl ?? body.compare.metadata.requestedUrl
      }
    };
  }

  async fetchDeferredResource(input: {
    token: string;
    url: string;
    signal: AbortSignal;
  }): Promise<ResourceFetchResult> {
    const response = await this.fetchImpl("/api/fetch", {
      method: "POST",
      signal: input.signal,
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        token: input.token,
        urls: [input.url]
      })
    });

    if (!response.ok) {
      return fetchFailure(input.url, {
        reason: "network-error",
        retriable: true,
        message: "Deferred resource fetch request failed."
      });
    }

    const body = (await response.json()) as FetchApiResponse;
    const result = body.results[0];

    if (!result) {
      return fetchFailure(input.url, {
        reason: "network-error",
        retriable: true,
        message: "Deferred resource fetch response was empty."
      });
    }

    if (result.ok && result.source !== undefined) {
      return {
        ok: true,
        body: {
          kind: "text",
          text: result.source
        },
        metadata: fetchMetadataFromApi(result.metadata)
      };
    }

    return {
      ok: false,
      failure: {
        reason: fetchFailureReason(result.error?.category),
        retriable: isRetriableApiCategory(result.error?.category, result.error?.httpStatus),
        message: result.error?.message ?? "Deferred resource could not be fetched."
      },
      metadata: fetchMetadataFromApi(result.metadata)
    };
  }
}

function fetchFailure(
  url: string,
  failure: {
    reason: ResourceFetchFailureReason;
    retriable: boolean;
    message: string;
  }
): ResourceFetchResult {
  return {
    ok: false,
    failure,
    metadata: {
      requestedUrl: url,
      fetchedAt: new Date(0).toISOString(),
      attempts: 1
    }
  };
}

function fetchMetadataFromApi(metadata: FetchMetadataLike): FetchMetadata {
  return {
    requestedUrl: metadata.requestedUrl,
    finalUrl: metadata.finalUrl,
    httpStatus: metadata.httpStatus,
    contentType: metadata.contentType,
    byteLength: metadata.byteLength,
    attempts: metadata.attempts,
    fetchedAt: new Date().toISOString()
  };
}

function fetchFailureReason(category: string | undefined): ResourceFetchFailureReason {
  if (category === "blocked-destination" || category === "token-scope" || category === "invalid-url") {
    return "blocked";
  }

  if (category === "timeout") {
    return "timeout";
  }

  if (category === "response-too-large") {
    return "limit";
  }

  if (category === "unsupported-content") {
    return "unsupported";
  }

  return "http-error";
}

function isRetriableApiCategory(category: string | undefined, httpStatus: number | undefined): boolean {
  return category === "timeout" || httpStatus === 429 || (httpStatus ?? 0) >= 500;
}
