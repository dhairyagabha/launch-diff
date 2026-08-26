import { describe, expect, it } from "vitest";
import {
  handleAnalysisStartRequest,
  handleFetchBatchRequest
} from "@/server/fetch-boundary/handlers";
import { fetchPublicTextResource } from "@/server/fetch-boundary/resource-fetch";
import { createAnalysisToken, verifyAnalysisToken } from "@/server/fetch-boundary/token";
import { validatePublicHttpUrl } from "@/server/fetch-boundary/url-security";
import type { ResolvedAddress } from "@/server/fetch-boundary/types";

const TOKEN_SECRET = "test-secret-that-is-long-enough";
const PUBLIC_ADDRESS: ResolvedAddress = {
  address: "93.184.216.34",
  family: 4
};

describe("secure fetch boundary", () => {
  it("rejects unsupported protocols, embedded credentials, and private destinations", async () => {
    await expect(validatePublicHttpUrl("file:///etc/passwd")).resolves.toMatchObject({
      ok: false,
      category: "invalid-url"
    });
    await expect(validatePublicHttpUrl("https://user:pass@example.test/library.js")).resolves.toMatchObject({
      ok: false,
      category: "invalid-url"
    });
    await expect(validatePublicHttpUrl("http://127.0.0.1/library.js")).resolves.toMatchObject({
      ok: false,
      category: "blocked-destination"
    });
    await expect(validatePublicHttpUrl("https://assets.example.test/library.js", {
      resolveHostname: async () => [{ address: "10.0.0.5", family: 4 }]
    })).resolves.toMatchObject({
      ok: false,
      category: "blocked-destination"
    });
  });

  it("retries transient statuses exactly once but does not retry deterministic 404s", async () => {
    const transientCalls: string[] = [];
    const transient = await fetchPublicTextResource("https://assets.example.test/launch/library.js", {
      resolveHostname: publicResolver,
      fetch: async (url) => {
        transientCalls.push(url);

        return transientCalls.length === 1
          ? textResponse("try again", 500)
          : textResponse("ok", 200);
      }
    });
    const notFoundCalls: string[] = [];
    const notFound = await fetchPublicTextResource("https://assets.example.test/launch/missing.js", {
      resolveHostname: publicResolver,
      fetch: async (url) => {
        notFoundCalls.push(url);

        return textResponse("missing", 404);
      }
    });

    expect(transient).toMatchObject({
      ok: true,
      metadata: {
        attempts: 2
      }
    });
    expect(notFound).toMatchObject({
      ok: false,
      category: "http-error",
      httpStatus: 404,
      attempts: 1
    });
    expect(notFoundCalls).toHaveLength(1);
  });

  it("revalidates redirect destinations before following them", async () => {
    const result = await fetchPublicTextResource("https://assets.example.test/launch/library.js", {
      resolveHostname: publicResolver,
      fetch: async () =>
        new Response(null, {
          status: 302,
          headers: {
            location: "http://127.0.0.1/internal.js"
          }
        })
    });

    expect(result).toMatchObject({
      ok: false,
      category: "blocked-destination"
    });
  });

  it("enforces response size limits", async () => {
    const result = await fetchPublicTextResource("https://assets.example.test/launch/library.js", {
      resolveHostname: publicResolver,
      maxBytes: 5,
      fetch: async () => textResponse("0123456789", 200)
    });

    expect(result).toMatchObject({
      ok: false,
      category: "response-too-large"
    });
  });

  it("blocks generic proxy use outside the signed token scope", async () => {
    const token = createAnalysisToken({
      secret: TOKEN_SECRET,
      now: 1_000,
      allowedScopes: [
        {
          origin: "https://assets.example.test",
          pathRoot: "/launch/"
        }
      ]
    });
    const response = await handleFetchBatchRequest(
      jsonRequest("https://launchdiff.test/api/fetch", {
        token,
        urls: ["https://other.example.test/launch/library.js"]
      }),
      {
        tokenSecret: TOKEN_SECRET,
        now: 2_000,
        fetch: async () => {
          throw new Error("fetch should not be called for out-of-scope URLs");
        }
      }
    );
    const body = (await response.json()) as {
      results: Array<{ ok: boolean; error?: { category: string } }>;
    };

    expect(response.status).toBe(200);
    expect(body.results[0]).toMatchObject({
      ok: false,
      error: {
        category: "token-scope"
      }
    });
  });

  it("does not fetch source maps even when they are under the token root", async () => {
    const token = createAnalysisToken({
      secret: TOKEN_SECRET,
      now: 1_000,
      allowedScopes: [
        {
          origin: "https://assets.example.test",
          pathRoot: "/launch/"
        }
      ]
    });
    const response = await handleFetchBatchRequest(
      jsonRequest("https://launchdiff.test/api/fetch", {
        token,
        urls: ["https://assets.example.test/launch/library.js.map"]
      }),
      {
        tokenSecret: TOKEN_SECRET,
        now: 2_000,
        fetch: async () => {
          throw new Error("fetch should not be called for source maps");
        }
      }
    );
    const body = (await response.json()) as {
      results: Array<{ ok: boolean; error?: { category: string } }>;
    };

    expect(body.results[0]).toMatchObject({
      ok: false,
      error: {
        category: "unsupported-content"
      }
    });
  });

  it("returns canonical sources and a scoped token from the start handshake", async () => {
    const response = await handleAnalysisStartRequest(
      jsonRequest("https://launchdiff.test/api/analysis/start", {
        baseUrl: "https://assets.example.test/launch/base/library.js",
        compareUrl: "https://assets.example.test/launch/compare/library.js"
      }),
      {
        tokenSecret: TOKEN_SECRET,
        now: 1_000,
        resolveHostname: publicResolver,
        fetch: async (url) => textResponse(`source:${url}`, 200)
      }
    );
    const body = (await response.json()) as {
      token: string;
      base: { source: string };
      compare: { source: string };
    };
    const token = verifyAnalysisToken({
      token: body.token,
      secret: TOKEN_SECRET,
      now: 2_000
    });

    expect(response.status).toBe(200);
    expect(body.base.source).toBe("source:https://assets.example.test/launch/base/library.js");
    expect(body.compare.source).toBe("source:https://assets.example.test/launch/compare/library.js");
    expect(token).toMatchObject({
      ok: true,
      payload: {
        allowedScopes: [
          {
            origin: "https://assets.example.test",
            pathRoot: "/launch/base/"
          },
          {
            origin: "https://assets.example.test",
            pathRoot: "/launch/compare/"
          }
        ]
      }
    });
  });
});

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

function textResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "content-length": String(Buffer.byteLength(body))
    }
  });
}

async function publicResolver(): Promise<ResolvedAddress[]> {
  return [PUBLIC_ADDRESS];
}
