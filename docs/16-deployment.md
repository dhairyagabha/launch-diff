# 16 — Deployment

LaunchDiff is designed for Vercel with a thin server boundary and browser Worker analysis.

## Architecture Summary

- `/` and `/compare` are static app routes.
- `/api/analysis/start` performs the canonical fetch handshake and issues a signed short-lived analysis token.
- `/api/fetch` fetches parser-confirmed deferred Launch resources within the signed token scope.
- Browser Worker code performs parsing, deferred discovery orchestration, normalization, matching, dependency impact, comparison, detailed diffs, and deterministic release notes.

## Required Environment Variables

### `LAUNCHDIFF_TOKEN_SECRET`

High-entropy secret used to sign short-lived tokens for `/api/fetch`.

Production requirements:

- set in every deployed environment.
- do not commit it.
- rotate if exposed.
- use different values for preview and production deployments.

## Optional Environment Variables

### `NEXT_PUBLIC_GITHUB_REPOSITORY_URL`

Public repository URL used by the landing-page GitHub link.

If unset, the landing page uses a placeholder repository URL.

## Vercel Setup

1. Import the repository into Vercel.
2. Use the default Next.js build command: `npm run build`.
3. Set `LAUNCHDIFF_TOKEN_SECRET` in project environment variables.
4. Optionally set `NEXT_PUBLIC_GITHUB_REPOSITORY_URL`.
5. Deploy preview branches and production from `main`.

## Logging Discipline

Production logging must not intentionally include:

- library source.
- library URLs.
- site configuration.
- resource names.
- diffs.
- comparison results.
- release notes.
- diagnostic report contents.

Minimal aggregate engagement is acceptable, such as aggregate page traffic and `/api/analysis/start` request counts.

## Deployment Verification

Before promoting a production deployment:

- [ ] `npm run verify` passes.
- [ ] `npm run test:e2e` passes.
- [ ] `npm run build` passes.
- [ ] `/` renders the landing page.
- [ ] `/compare` renders on desktop and shows the desktop-required message below `1024` CSS pixels.
- [ ] `/api/analysis/start` rejects invalid/private targets.
- [ ] `/api/fetch` rejects missing, expired, tampered, and out-of-scope tokens.
- [ ] sanitized diagnostic copy excludes URLs, names, source, config, diffs, and release notes.
