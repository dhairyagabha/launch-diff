import { ANALYSIS_LIMITS } from "@/core/launch-analyzer/model/limits";
import type { BoundaryFailure, PublicFetchMetadata, PublicFetchResult } from "./types";
import { validatePublicHttpUrl, type UrlSecurityOptions } from "./url-security";

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface FetchPublicResourceOptions extends UrlSecurityOptions {
  fetch?: FetchLike;
  isUrlAllowed?: (url: string) => boolean;
  maxBytes?: number;
  maxRedirects?: number;
  timeoutMs?: number;
}

type FetchAttemptResult =
  | {
      ok: true;
      source: string;
      metadata: PublicFetchMetadata;
    }
  | {
      ok: false;
      metadata: PublicFetchMetadata;
      failure: BoundaryFailure;
    };

const DEFAULT_TIMEOUT_MS = 10_000;

export async function fetchPublicTextResource(
  rawUrl: string,
  options: FetchPublicResourceOptions = {}
): Promise<PublicFetchResult> {
  let attempts = 0;
  let latestMetadata = createMetadata(rawUrl, 0, []);
  let latestFailure: BoundaryFailure | undefined;

  while (attempts < 2) {
    attempts += 1;
    const attempt = await fetchPublicTextResourceOnce(rawUrl, attempts, options);
    latestMetadata = attempt.metadata;

    if (attempt.ok) {
      return {
        ok: true,
        source: attempt.source,
        metadata: attempt.metadata
      };
    }

    latestFailure = attempt.failure;

    if (!latestFailure || !isTransientFailure(latestFailure) || attempts >= 2) {
      break;
    }
  }

  return {
    ok: false,
    requestedUrl: rawUrl,
    category: latestFailure?.category ?? "network-error",
    message: latestFailure?.message ?? "Resource could not be fetched.",
    httpStatus: latestFailure?.httpStatus,
    attempts,
    metadata: {
      ...latestMetadata,
      attempts
    }
  };
}

async function fetchPublicTextResourceOnce(
  rawUrl: string,
  attempts: number,
  options: FetchPublicResourceOptions
): Promise<FetchAttemptResult> {
  const redirects: string[] = [];
  let currentUrl = rawUrl;

  for (
    let redirectCount = 0;
    redirectCount <= (options.maxRedirects ?? ANALYSIS_LIMITS.maxRedirects);
    redirectCount += 1
  ) {
    const allowed = options.isUrlAllowed?.(currentUrl) ?? true;

    if (!allowed) {
      return failedAttempt(
        rawUrl,
        attempts,
        redirects,
        "token-scope",
        "URL is outside token scope."
      );
    }

    const validation = await validatePublicHttpUrl(currentUrl, options);

    if (!validation.ok) {
      return failedAttempt(
        rawUrl,
        attempts,
        redirects,
        validation.category,
        validation.message,
        validation.httpStatus
      );
    }

    const response = await fetchWithTimeout(validation.url.href, options, attempts, redirects);

    if (!("value" in response)) {
      return response;
    }

    const { value } = response;
    const status = value.status;
    const metadata = createMetadata(rawUrl, attempts, redirects, validation.url.href, value);

    if (isRedirectStatus(status)) {
      const location = value.headers.get("location");

      if (!location) {
        return {
          ok: false,
          metadata,
          failure: failure(
            "http-error",
            "Redirect response did not include a Location header.",
            status
          )
        };
      }

      const redirectedUrl = new URL(location, validation.url).href;
      redirects.push(redirectedUrl);
      currentUrl = redirectedUrl;
      continue;
    }

    if (status === 429 || status >= 500) {
      return {
        ok: false,
        metadata,
        failure: failure("http-error", "Remote server returned a transient status.", status)
      };
    }

    if (!value.ok) {
      return {
        ok: false,
        metadata,
        failure: failure("http-error", "Remote server returned an unsuccessful status.", status)
      };
    }

    const contentLength = Number(value.headers.get("content-length") ?? 0);
    const maxBytes = options.maxBytes ?? ANALYSIS_LIMITS.maxTextResourceBytes;

    if (contentLength > maxBytes) {
      return {
        ok: false,
        metadata,
        failure: failure(
          "response-too-large",
          "Resource exceeded the configured size limit.",
          status
        )
      };
    }

    const body = new Uint8Array(await value.arrayBuffer());
    const bodyMetadata = {
      ...metadata,
      byteLength: body.byteLength,
      contentType: value.headers.get("content-type") ?? undefined
    };

    if (body.byteLength > maxBytes) {
      return {
        ok: false,
        metadata: bodyMetadata,
        failure: failure(
          "response-too-large",
          "Resource exceeded the configured size limit.",
          status
        )
      };
    }

    if (!isSupportedTextResponse(bodyMetadata.contentType, body)) {
      return {
        ok: false,
        metadata: bodyMetadata,
        failure: failure("unsupported-content", "Resource is not a supported text artifact.", status)
      };
    }

    return {
      ok: true,
      source: new TextDecoder().decode(body),
      metadata: bodyMetadata
    };
  }

  return failedAttempt(
    rawUrl,
    attempts,
    redirects,
    "redirect-limit",
    "Redirect limit exceeded."
  );
}

async function fetchWithTimeout(
  url: string,
  options: FetchPublicResourceOptions,
  attempts: number,
  redirects: string[]
): Promise<
  | {
      ok: true;
      value: Response;
    }
  | FetchAttemptResult
> {
  const fetchImpl = options.fetch ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    return {
      ok: true,
      value: await fetchImpl(url, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        signal: controller.signal,
        headers: {
          accept: "text/javascript, application/javascript, application/json, text/plain, */*"
        }
      })
    };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";

    return failedAttempt(
      url,
      attempts,
      redirects,
      timedOut ? "timeout" : "network-error",
      timedOut ? "Resource fetch timed out." : "Network request failed."
    );
  } finally {
    clearTimeout(timeout);
  }
}

function failedAttempt(
  requestedUrl: string,
  attempts: number,
  redirects: string[],
  category: BoundaryFailure["category"],
  message: string,
  httpStatus?: number
): FetchAttemptResult {
  return {
    ok: false,
    metadata: createMetadata(requestedUrl, attempts, redirects),
    failure: failure(category, message, httpStatus)
  };
}

function createMetadata(
  requestedUrl: string,
  attempts: number,
  redirects: string[],
  finalUrl?: string,
  response?: Response
): PublicFetchMetadata {
  return {
    requestedUrl,
    finalUrl,
    httpStatus: response?.status,
    contentType: response?.headers.get("content-type") ?? undefined,
    byteLength: Number(response?.headers.get("content-length") ?? 0) || undefined,
    attempts,
    redirects: [...redirects]
  };
}

function failure(
  category: BoundaryFailure["category"],
  message: string,
  httpStatus?: number
): BoundaryFailure {
  return {
    ok: false,
    category,
    message,
    httpStatus
  };
}

function isTransientFailure(failureResult: BoundaryFailure): boolean {
  return (
    failureResult.category === "timeout" ||
    (failureResult.category === "http-error" &&
      (failureResult.httpStatus === 429 || (failureResult.httpStatus ?? 0) >= 500))
  );
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function isSupportedTextResponse(contentType: string | undefined, body: Uint8Array): boolean {
  const normalized = contentType?.toLowerCase() ?? "";

  if (
    normalized.startsWith("image/") ||
    normalized.startsWith("audio/") ||
    normalized.startsWith("video/") ||
    normalized.startsWith("font/") ||
    normalized.includes("application/pdf") ||
    normalized.includes("application/zip")
  ) {
    return false;
  }

  return !body.slice(0, 512).some((byte) => byte === 0);
}
