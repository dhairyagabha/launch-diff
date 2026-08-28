export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Temporary diagnostic route for tracking down a Vercel env var
// misconfiguration. Reports presence/shape only, never the value.
// Remove once the underlying issue is confirmed and fixed.
export async function GET(): Promise<Response> {
  const secret = process.env.LAUNCHDIFF_TOKEN_SECRET;

  return Response.json({
    hasSecret: typeof secret === "string" && secret.length > 0,
    secretLength: typeof secret === "string" ? secret.length : 0,
    vercelEnv: process.env.VERCEL_ENV ?? null,
    vercelUrl: process.env.VERCEL_URL ?? null,
    gitCommitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    gitCommitRef: process.env.VERCEL_GIT_COMMIT_REF ?? null,
    nodeEnv: process.env.NODE_ENV ?? null
  });
}
