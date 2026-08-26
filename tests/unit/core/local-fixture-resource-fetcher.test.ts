import { describe, expect, it } from "vitest";
import {
  createLocalFixtureResourceFetcher,
  FIXTURE_FETCHED_AT,
  loadSanitizedFixtureManifest,
  sanitizedFixtureRoot
} from "../../support/fixtures";

describe("local fixture ResourceFetcher", () => {
  it("loads canonical and deferred fixture artifacts without network access", async () => {
    const fixtureRoot = sanitizedFixtureRoot("synthetic-loader-smoke");
    const manifest = loadSanitizedFixtureManifest("synthetic-loader-smoke");
    const fetcher = createLocalFixtureResourceFetcher(fixtureRoot, manifest);
    const library = manifest.libraries[0];

    expect(library).toBeDefined();

    const canonical = await fetcher.fetchResource({ url: library!.canonicalUrl });
    const deferred = await fetcher.fetchResource({
      url: "https://assets.example.test/launch/base/rules/rule-action-analytics.abc123.js"
    });

    expect(canonical).toMatchObject({
      ok: true,
      metadata: {
        requestedUrl: library!.canonicalUrl,
        finalUrl: library!.canonicalUrl,
        fetchedAt: FIXTURE_FETCHED_AT,
        httpStatus: 200,
        contentType: "application/javascript",
        attempts: 1
      }
    });
    expect(canonical.ok && canonical.body.kind === "text" ? canonical.body.text : "").toContain(
      "PR-SYNTHETIC-SMOKE"
    );
    expect(deferred.ok && deferred.body.kind === "text" ? deferred.body.text : "").toContain(
      "_satellite.getVar"
    );
  });

  it("fails closed for URLs that are not listed in the fixture manifest", async () => {
    const fixtureRoot = sanitizedFixtureRoot("synthetic-loader-smoke");
    const manifest = loadSanitizedFixtureManifest("synthetic-loader-smoke");
    const fetcher = createLocalFixtureResourceFetcher(fixtureRoot, manifest);

    const result = await fetcher.fetchResource({
      url: "https://assets.example.test/launch/base/not-in-manifest.js"
    });

    expect(result).toMatchObject({
      ok: false,
      failure: {
        reason: "not-found",
        retriable: false
      },
      metadata: {
        fetchedAt: FIXTURE_FETCHED_AT,
        attempts: 1
      }
    });
  });
});
