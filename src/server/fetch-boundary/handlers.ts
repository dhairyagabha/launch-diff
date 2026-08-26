import { ANALYSIS_LIMITS } from "@/core/launch-analyzer/model/limits";
import { fetchPublicTextResource, type FetchPublicResourceOptions } from "./resource-fetch";
import {
  createAnalysisToken,
  serverTokenSecret,
  verifyAnalysisToken
} from "./token";
import type {
  AllowedFetchScope,
  FetchBatchRequestBody,
  PublicFetchFailure,
  PublicFetchOk,
  StartAnalysisRequestBody
} from "./types";
import { isUrlWithinScopes, pathRootForUrl } from "./url-security";

export interface FetchBoundaryHandlerOptions extends FetchPublicResourceOptions {
  tokenSecret?: string;
  now?: number;
}

interface StartSideResponse {
  source: string;
  metadata: PublicFetchOk["metadata"];
}

interface FetchBatchResult {
  requestedUrl: string;
  ok: boolean;
  source?: string;
  metadata: PublicFetchOk["metadata"] | PublicFetchFailure["metadata"];
  error?: {
    category: PublicFetchFailure["category"];
    message: string;
    httpStatus?: number;
  };
}

export async function handleAnalysisStartRequest(
  request: Request,
  options: FetchBoundaryHandlerOptions = {}
): Promise<Response> {
  const secret = options.tokenSecret ?? serverTokenSecret();

  if (!secret) {
    return jsonError(500, "invalid-token", "Analysis token secret is not configured.");
  }

  const body = await readJsonBody<StartAnalysisRequestBody>(request);

  if (!body.ok) {
    return jsonError(400, "invalid-json", body.message);
  }

  if (typeof body.value.baseUrl !== "string" || typeof body.value.compareUrl !== "string") {
    return jsonError(400, "invalid-json", "baseUrl and compareUrl are required.");
  }

  const [base, compare] = await Promise.all([
    fetchPublicTextResource(body.value.baseUrl, options),
    fetchPublicTextResource(body.value.compareUrl, options)
  ]);

  if (!base.ok) {
    return jsonFetchFailure("base", base);
  }

  if (!compare.ok) {
    return jsonFetchFailure("compare", compare);
  }

  const allowedScopes = uniqueScopes([
    scopeForFetchedArtifact(base),
    scopeForFetchedArtifact(compare)
  ]);
  const token = createAnalysisToken({
    allowedScopes,
    secret,
    now: options.now
  });
  const expiresAt = verifyAnalysisToken({
    token,
    secret,
    now: options.now
  });

  return Response.json({
    token,
    expiresAt: expiresAt.ok ? expiresAt.payload.expiresAt : undefined,
    base: startSideResponse(base),
    compare: startSideResponse(compare),
    limits: {
      proxyBatchSize: ANALYSIS_LIMITS.proxyBatchSize,
      maxTextResourceBytes: ANALYSIS_LIMITS.maxTextResourceBytes,
      maxRedirects: ANALYSIS_LIMITS.maxRedirects
    }
  });
}

export async function handleFetchBatchRequest(
  request: Request,
  options: FetchBoundaryHandlerOptions = {}
): Promise<Response> {
  const secret = options.tokenSecret ?? serverTokenSecret();

  if (!secret) {
    return jsonError(500, "invalid-token", "Analysis token secret is not configured.");
  }

  const body = await readJsonBody<FetchBatchRequestBody>(request);

  if (!body.ok) {
    return jsonError(400, "invalid-json", body.message);
  }

  if (!Array.isArray(body.value.urls) || typeof body.value.token !== "string") {
    return jsonError(400, "invalid-json", "token and urls are required.");
  }

  if (body.value.urls.length > ANALYSIS_LIMITS.proxyBatchSize) {
    return jsonError(400, "batch-limit", "Too many URLs were requested in one batch.");
  }

  if (body.value.urls.some((url) => typeof url !== "string")) {
    return jsonError(400, "invalid-json", "Every requested URL must be a string.");
  }

  const token = verifyAnalysisToken({
    token: body.value.token,
    secret,
    now: options.now
  });

  if (!token.ok) {
    return jsonError(401, "invalid-token", "Analysis token is invalid or expired.");
  }

  const results = await mapWithConcurrency(body.value.urls, ANALYSIS_LIMITS.browserFetchConcurrency, async (url) =>
    fetchBatchUrl(url, token.payload.allowedScopes, options)
  );

  return Response.json({
    results
  });
}

async function fetchBatchUrl(
  url: string,
  allowedScopes: AllowedFetchScope[],
  options: FetchBoundaryHandlerOptions
): Promise<FetchBatchResult> {
  if (!isUrlWithinScopes(url, allowedScopes)) {
    return {
      requestedUrl: url,
      ok: false,
      metadata: {
        requestedUrl: url,
        attempts: 0,
        redirects: []
      },
      error: {
        category: "token-scope",
        message: "URL is outside token scope."
      }
    };
  }

  if (isSourceMapUrl(url)) {
    return {
      requestedUrl: url,
      ok: false,
      metadata: {
        requestedUrl: url,
        attempts: 0,
        redirects: []
      },
      error: {
        category: "unsupported-content",
        message: "Source maps are outside the v1 recursive fetch boundary."
      }
    };
  }

  const result = await fetchPublicTextResource(url, {
    ...options,
    isUrlAllowed: (redirectedUrl) => isUrlWithinScopes(redirectedUrl, allowedScopes)
  });

  if (result.ok) {
    return {
      requestedUrl: url,
      ok: true,
      source: result.source,
      metadata: result.metadata
    };
  }

  return {
    requestedUrl: url,
    ok: false,
    metadata: result.metadata,
    error: {
      category: result.category,
      message: result.message,
      httpStatus: result.httpStatus
    }
  };
}

function isSourceMapUrl(rawUrl: string): boolean {
  try {
    return new URL(rawUrl).pathname.endsWith(".map");
  } catch {
    return false;
  }
}

function startSideResponse(result: PublicFetchOk): StartSideResponse {
  return {
    source: result.source,
    metadata: result.metadata
  };
}

function scopeForFetchedArtifact(result: PublicFetchOk): AllowedFetchScope {
  const finalUrl = result.metadata.finalUrl ?? result.metadata.requestedUrl;
  const url = new URL(finalUrl);

  return {
    origin: url.origin,
    pathRoot: pathRootForUrl(finalUrl)
  };
}

function uniqueScopes(scopes: AllowedFetchScope[]): AllowedFetchScope[] {
  const byKey = new Map(scopes.map((scope) => [`${scope.origin}${scope.pathRoot}`, scope]));

  return [...byKey.values()];
}

async function readJsonBody<T>(request: Request): Promise<
  | {
      ok: true;
      value: T;
    }
  | {
      ok: false;
      message: string;
    }
> {
  try {
    const value = (await request.json()) as unknown;

    if (!value || typeof value !== "object") {
      return {
        ok: false,
        message: "JSON request body must be an object."
      };
    }

    return {
      ok: true,
      value: value as T
    };
  } catch {
    return {
      ok: false,
      message: "Request body must be valid JSON."
    };
  }
}

function jsonFetchFailure(side: "base" | "compare", failure: PublicFetchFailure): Response {
  return Response.json(
    {
      error: {
        side,
        category: failure.category,
        message: failure.message,
        httpStatus: failure.httpStatus
      }
    },
    {
      status: failure.category === "blocked-destination" ? 400 : 502
    }
  );
}

function jsonError(
  status: number,
  category: string,
  message: string
): Response {
  return Response.json(
    {
      error: {
        category,
        message
      }
    },
    {
      status
    }
  );
}

async function mapWithConcurrency<Input, Output>(
  items: Input[],
  concurrency: number,
  worker: (item: Input) => Promise<Output>
): Promise<Output[]> {
  const results: Output[] = [];
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index]!);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker())
  );

  return results;
}
