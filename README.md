# LaunchDiff

LaunchDiff is an open-source, desktop-first web application for comparing two deployed Adobe Launch / Adobe Tags web libraries from the same property.

It reconstructs current-format Launch libraries from their public CDN URLs, recursively fetches only deferred Launch resources referenced by those builds, compares resources conservatively, displays changes using a GitHub-style split diff experience, traces downstream Data Element impact, and generates deterministic Markdown release notes.

## Core product principle

> When comparison certainty is insufficient, preserve and expose the potential difference. LaunchDiff may show an extra change, but it must never intentionally suppress a plausible deployed change merely to produce a cleaner diff.

## Key constraints

- Current Adobe Launch / Adobe Tags web builds only.
- Base and Compare libraries must belong to the same Launch property when property identity can be determined.
- Public anonymous HTTP(S) library URLs only.
- No Adobe API integration or Adobe authentication.
- No user accounts, database, or server-side comparison history.
- No AI or LLM dependency.
- No execution of downloaded JavaScript.
- Recursive fetching is limited to parser-confirmed deferred Launch resources.
- Deployed artifacts are authoritative for change classification.
- GitHub Primer is the visual design-system foundation.
- Comparison workspace is desktop-only; landing page is responsive.

## Documentation map

- `AGENTS.md` — Codex operating rules and implementation guardrails.
- `docs/01-product-spec.md` — Product goals, workflows, requirements, and non-goals.
- `docs/02-architecture.md` — Browser, worker, analyzer, and Vercel architecture.
- `docs/03-domain-model.md` — Stable internal TypeScript contracts.
- `docs/04-analysis-semantics.md` — Parsing, matching, normalization, diff, and impact rules.
- `docs/05-fetch-security.md` — Deferred resource resolution, SSRF controls, tokens, retries, limits.
- `docs/06-ui-spec.md` — GitHub-fidelity comparison workspace requirements.
- `docs/07-landing-page.md` — GitHub-inspired LaunchDiff landing page and image prompts.
- `docs/08-release-notes.md` — Deterministic release-note generation rules.
- `docs/09-testing.md` — Fixture-first testing, visual regression, accessibility, E2E.
- `docs/10-implementation-plan.md` — Milestone-by-milestone Codex build sequence.
- `docs/11-acceptance-criteria.md` — v1 completion checklist.
- `docs/12-open-source-repo.md` — Repository, CI, privacy, security, and contribution structure.
- `examples/launchdiff.config.json` — Minimal example site configuration.
- `examples/launchdiff.config.schema.json` — Draft JSON Schema for site configuration.

## Recommended stack

Use a current stable Next.js + React + TypeScript stack, with strict TypeScript enabled. Prefer mature open-source primitives for generic parsing, formatting, diffing, validation, and testing. Launch-specific interpretation and comparison semantics must remain owned by LaunchDiff.

Likely building blocks:

- Next.js / React / TypeScript
- GitHub Primer / Primer React and semantic tokens
- Web Worker for analyzer execution
- `@babel/parser` or equivalent modern JavaScript parser
- Prettier or equivalent deterministic formatter
- Zod for runtime validation
- A mature diff algorithm library for line/intra-line calculation
- Vitest for unit and fixture tests
- Playwright for E2E and visual regression
- axe integration for automated accessibility checks

Do not select a prebuilt diff-view component that constrains GitHub fidelity. Use a generic diff algorithm, but own the diff rendering DOM and styling.
