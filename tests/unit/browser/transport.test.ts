import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiAnalysisTransport } from "@/browser/analyzer";

describe("API analysis transport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls the default browser fetch with the global scope binding", async () => {
    const requestedPaths: string[] = [];

    vi.stubGlobal(
      "fetch",
      function browserFetch(
        this: unknown,
        input: RequestInfo | URL,
        init?: RequestInit
      ): Promise<Response> {
        expect(this).toBe(globalThis);
        requestedPaths.push(String(input));

        if (input === "/api/analysis/start") {
          expect(init?.method).toBe("POST");

          return Promise.resolve(
            jsonResponse({
              token: "signed-token",
              base: {
                source: "base source",
                metadata: {
                  requestedUrl: "https://assets.example.test/base/launch.min.js",
                  finalUrl: "https://assets.example.test/base/launch.min.js",
                  attempts: 1
                }
              },
              compare: {
                source: "compare source",
                metadata: {
                  requestedUrl: "https://assets.example.test/compare/launch.min.js",
                  finalUrl: "https://assets.example.test/compare/launch.min.js",
                  attempts: 1
                }
              }
            })
          );
        }

        if (input === "/api/fetch") {
          expect(init?.method).toBe("POST");

          return Promise.resolve(
            jsonResponse({
              results: [
                {
                  requestedUrl: "https://assets.example.test/compare/deferred.js",
                  ok: true,
                  source: "deferred source",
                  metadata: {
                    requestedUrl: "https://assets.example.test/compare/deferred.js",
                    finalUrl: "https://assets.example.test/compare/deferred.js",
                    contentType: "application/javascript",
                    byteLength: 15,
                    attempts: 1
                  }
                }
              ]
            })
          );
        }

        return Promise.resolve(new Response(null, { status: 404 }));
      }
    );

    const transport = new ApiAnalysisTransport();
    const signal = new AbortController().signal;
    const start = await transport.startAnalysis({
      baseUrl: "https://assets.example.test/base/launch.min.js",
      compareUrl: "https://assets.example.test/compare/launch.min.js",
      signal
    });
    const deferred = await transport.fetchDeferredResource({
      token: start.token,
      url: "https://assets.example.test/compare/deferred.js",
      signal
    });

    expect(start.base.source).toBe("base source");
    expect(start.compare.source).toBe("compare source");
    expect(deferred.ok).toBe(true);
    expect(requestedPaths).toEqual(["/api/analysis/start", "/api/fetch"]);
  });

  it("surfaces side-specific analysis start failures from the API response", async () => {
    const transport = new ApiAnalysisTransport(async () =>
      jsonResponse(
        {
          error: {
            side: "base",
            category: "http-error",
            message: "Remote server returned an unsuccessful status.",
            httpStatus: 404
          }
        },
        502
      )
    );

    await expect(
      transport.startAnalysis({
        baseUrl: "https://assets.example.test/base/launch.min.js",
        compareUrl: "https://assets.example.test/compare/launch.min.js",
        signal: new AbortController().signal
      })
    ).rejects.toThrow(
      "Base library could not be fetched: Remote server returned an unsuccessful status. (HTTP 404)"
    );
  });

  it("surfaces setup failures from the API response", async () => {
    const transport = new ApiAnalysisTransport(async () =>
      jsonResponse(
        {
          error: {
            category: "invalid-token",
            message: "Analysis token secret is not configured."
          }
        },
        500
      )
    );

    await expect(
      transport.startAnalysis({
        baseUrl: "https://assets.example.test/base/launch.min.js",
        compareUrl: "https://assets.example.test/compare/launch.min.js",
        signal: new AbortController().signal
      })
    ).rejects.toThrow("Analysis token secret is not configured.");
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}
