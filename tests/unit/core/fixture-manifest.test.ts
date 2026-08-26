import { describe, expect, it } from "vitest";
import { validateFixtureManifest } from "@/core/launch-analyzer";
import { loadSanitizedFixtureManifest } from "../../support/fixtures";

describe("fixture manifest", () => {
  it("validates the synthetic loader smoke fixture", () => {
    const manifest = loadSanitizedFixtureManifest("synthetic-loader-smoke");

    expect(manifest).toMatchObject({
      version: 1,
      id: "synthetic-loader-smoke",
      sanitized: true
    });
    expect(manifest.libraries[0]?.expected).toEqual({
      rules: 1,
      dataElements: 1,
      extensions: 1,
      deferredResources: 1,
      mappedOwners: 1,
      unmapped: 0,
      dataElementReferences: 2,
      warnings: 0
    });
  });

  it("requires the canonical artifact URL to match the library canonical URL", () => {
    const result = validateFixtureManifest({
      version: 1,
      id: "bad-canonical-url",
      title: "Bad canonical URL",
      sanitized: true,
      libraries: [
        {
          label: "single",
          canonicalUrl: "https://assets.example.test/launch/library.min.js",
          artifacts: [
            {
              id: "canonical",
              role: "canonical",
              url: "https://assets.example.test/launch/other-library.min.js",
              path: "artifacts/library.min.js",
              contentType: "application/javascript"
            }
          ],
          expected: {
            rules: 0,
            dataElements: 0,
            extensions: 0,
            deferredResources: 0,
            mappedOwners: 0,
            unmapped: 0,
            dataElementReferences: 0,
            warnings: 0
          }
        }
      ]
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      "The canonical artifact URL must match the library canonicalUrl."
    );
  });
});
