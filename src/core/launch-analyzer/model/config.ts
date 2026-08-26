import { z } from "zod";

export const launchDiffConfigEnvironmentSchema = z.object({
  name: z.string().trim().min(1, "Environment name is required."),
  url: z
    .string()
    .trim()
    .url("Environment URL must be a valid URL.")
    .refine((value) => value.startsWith("http://") || value.startsWith("https://"), {
      message: "Environment URL must use http:// or https://."
    })
});

export const launchDiffConfigSiteSchema = z.object({
  name: z.string().trim().min(1, "Site name is required."),
  environments: z
    .array(launchDiffConfigEnvironmentSchema)
    .min(2, "At least two environments are required.")
});

export const launchDiffConfigSchema = z
  .object({
    version: z.literal(1),
    sites: z.array(launchDiffConfigSiteSchema).min(1, "At least one site is required.")
  })
  .strict();

export type LaunchDiffConfigInput = z.input<typeof launchDiffConfigSchema>;
export type LaunchDiffConfig = z.output<typeof launchDiffConfigSchema>;

export function parseLaunchDiffConfig(input: unknown): LaunchDiffConfig {
  return launchDiffConfigSchema.parse(input);
}

export function validateLaunchDiffConfig(input: unknown) {
  return launchDiffConfigSchema.safeParse(input);
}
