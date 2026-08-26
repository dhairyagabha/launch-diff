import { z } from "zod";

const httpUrlSchema = z
  .string()
  .url()
  .refine((value) => value.startsWith("http://") || value.startsWith("https://"), {
    message: "Fixture URLs must use http:// or https://."
  });

const relativeArtifactPathSchema = z
  .string()
  .min(1)
  .refine((value) => {
    const pathSegments = value.split(/[\\/]+/);

    return !value.startsWith("/") && !/^[a-zA-Z]:/.test(value) && !pathSegments.includes("..");
  }, {
    message: "Fixture artifact paths must stay inside the fixture directory."
  });

export const fixtureExpectedCountsSchema = z
  .object({
    rules: z.number().int().nonnegative(),
    dataElements: z.number().int().nonnegative(),
    extensions: z.number().int().nonnegative(),
    deferredResources: z.number().int().nonnegative(),
    mappedOwners: z.number().int().nonnegative(),
    unmapped: z.number().int().nonnegative(),
    dataElementReferences: z.number().int().nonnegative(),
    warnings: z.number().int().nonnegative()
  })
  .strict();

export const fixtureArtifactSchema = z
  .object({
    id: z.string().min(1),
    role: z.enum(["canonical", "deferred", "unminified", "other"]),
    url: httpUrlSchema,
    aliases: z.array(httpUrlSchema).default([]),
    path: relativeArtifactPathSchema,
    contentType: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/).optional()
  })
  .strict();

export const fixtureLibrarySchema = z
  .object({
    label: z.enum(["base", "compare", "single"]),
    canonicalUrl: httpUrlSchema,
    propertyId: z.string().min(1).optional(),
    artifacts: z.array(fixtureArtifactSchema).min(1),
    expected: fixtureExpectedCountsSchema
  })
  .strict()
  .superRefine((library, context) => {
    const canonicalArtifacts = library.artifacts.filter((artifact) => artifact.role === "canonical");
    const canonicalArtifact = canonicalArtifacts[0];

    if (canonicalArtifacts.length !== 1) {
      context.addIssue({
        code: "custom",
        message: "Each fixture library must include exactly one canonical artifact.",
        path: ["artifacts"]
      });
    } else if (canonicalArtifact.url !== library.canonicalUrl) {
      context.addIssue({
        code: "custom",
        message: "The canonical artifact URL must match the library canonicalUrl.",
        path: ["canonicalUrl"]
      });
    }

    const artifactIds = new Set<string>();
    const artifactUrls = new Set<string>();

    for (const [index, artifact] of library.artifacts.entries()) {
      if (artifactIds.has(artifact.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate fixture artifact id: ${artifact.id}`,
          path: ["artifacts", index, "id"]
        });
      }

      artifactIds.add(artifact.id);

      for (const url of [artifact.url, ...artifact.aliases]) {
        if (artifactUrls.has(url)) {
          context.addIssue({
            code: "custom",
            message: "Fixture artifact URLs and aliases must be unique within a library.",
            path: ["artifacts", index, "url"]
          });
        }

        artifactUrls.add(url);
      }
    }
  });

export const fixtureManifestSchema = z
  .object({
    version: z.literal(1),
    id: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1).optional(),
    sanitized: z.literal(true),
    libraries: z.array(fixtureLibrarySchema).min(1),
    notes: z.array(z.string().min(1)).default([])
  })
  .strict();

export type FixtureExpectedCounts = z.output<typeof fixtureExpectedCountsSchema>;
export type FixtureArtifact = z.output<typeof fixtureArtifactSchema>;
export type FixtureLibrary = z.output<typeof fixtureLibrarySchema>;
export type FixtureManifest = z.output<typeof fixtureManifestSchema>;

export function parseFixtureManifest(input: unknown): FixtureManifest {
  return fixtureManifestSchema.parse(input);
}

export function validateFixtureManifest(input: unknown) {
  return fixtureManifestSchema.safeParse(input);
}
