import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import {
  parseFixtureManifest,
  type FixtureArtifact,
  type FixtureManifest,
  type ResourceFetcher,
  type ResourceFetchRequest,
  type ResourceFetchResult
} from "@/core/launch-analyzer";

export const FIXTURE_FETCHED_AT = "1970-01-01T00:00:00.000Z";

export function sanitizedFixtureRoot(fixtureId: string): string {
  return resolve(process.cwd(), "tests/fixtures/sanitized", fixtureId);
}

export function loadSanitizedFixtureManifest(fixtureId: string): FixtureManifest {
  const fixtureRoot = sanitizedFixtureRoot(fixtureId);
  const manifest = JSON.parse(readFileSync(resolve(fixtureRoot, "manifest.json"), "utf8")) as unknown;

  return parseFixtureManifest(manifest);
}

export class LocalFixtureResourceFetcher implements ResourceFetcher {
  private readonly artifactsByUrl: Map<string, FixtureArtifact>;

  constructor(
    private readonly fixtureRoot: string,
    manifest: FixtureManifest
  ) {
    this.artifactsByUrl = buildArtifactUrlMap(manifest);
  }

  async fetchResource(request: ResourceFetchRequest): Promise<ResourceFetchResult> {
    const artifact = this.artifactsByUrl.get(request.url);
    const baseMetadata = {
      requestedUrl: request.url,
      fetchedAt: FIXTURE_FETCHED_AT,
      attempts: 1
    };

    if (!artifact) {
      return {
        ok: false,
        failure: {
          reason: "not-found",
          retriable: false,
          message: "No sanitized fixture artifact is registered for the requested URL."
        },
        metadata: baseMetadata
      };
    }

    const artifactPath = resolveFixtureArtifactPath(this.fixtureRoot, artifact);
    const source = readFileSync(artifactPath, "utf8");
    const byteLength = Buffer.byteLength(source);

    verifyFixtureArtifactIntegrity(artifact, source);

    return {
      ok: true,
      body: {
        kind: "text",
        text: source
      },
      metadata: {
        ...baseMetadata,
        finalUrl: artifact.url,
        httpStatus: 200,
        contentType: artifact.contentType,
        byteLength
      }
    };
  }
}

export function createLocalFixtureResourceFetcher(
  fixtureRoot: string,
  manifest: FixtureManifest
): LocalFixtureResourceFetcher {
  return new LocalFixtureResourceFetcher(fixtureRoot, manifest);
}

function buildArtifactUrlMap(manifest: FixtureManifest): Map<string, FixtureArtifact> {
  const artifactsByUrl = new Map<string, FixtureArtifact>();

  for (const library of manifest.libraries) {
    for (const artifact of library.artifacts) {
      for (const url of [artifact.url, ...artifact.aliases]) {
        if (artifactsByUrl.has(url)) {
          throw new Error("Fixture artifact URLs and aliases must be unique across the manifest.");
        }

        artifactsByUrl.set(url, artifact);
      }
    }
  }

  return artifactsByUrl;
}

function resolveFixtureArtifactPath(fixtureRoot: string, artifact: FixtureArtifact): string {
  const artifactPath = resolve(fixtureRoot, artifact.path);
  const pathFromRoot = relative(fixtureRoot, artifactPath);

  if (pathFromRoot.startsWith("..") || pathFromRoot === "" || pathFromRoot.startsWith("/")) {
    throw new Error("Fixture artifact path escaped the fixture directory.");
  }

  if (!existsSync(artifactPath)) {
    throw new Error(`Fixture artifact is missing: ${artifact.id}`);
  }

  return artifactPath;
}

function verifyFixtureArtifactIntegrity(artifact: FixtureArtifact, source: string): void {
  if (!artifact.sha256) {
    return;
  }

  const actualSha = createHash("sha256").update(source).digest("hex");

  if (actualSha !== artifact.sha256) {
    throw new Error(`Fixture artifact integrity check failed: ${artifact.id}`);
  }
}
