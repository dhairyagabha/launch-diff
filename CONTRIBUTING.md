# Contributing

Thank you for helping improve LaunchDiff. This project is intentionally conservative because its primary job is to avoid hiding plausible deployed changes.

## Development Setup

```bash
npm ci
npm run verify
npm run test:e2e
npm run build
```

Run the local app:

```bash
npm run dev
```

## Required Standards

- Keep `src/core/launch-analyzer/` framework-independent.
- Never execute downloaded Launch JavaScript.
- Preserve unknown structures and unmapped resources.
- Prefer an explicit extra difference over an incorrect match that could hide a real change.
- Do not add accounts, databases, Adobe API integration, source maps, AI/LLM features, or authenticated/private library fetching unless the specification changes.

## Parser And Analyzer Changes

Parser, resolver, normalizer, matcher, dependency, comparison, and diff changes must include focused tests.

Parser changes require:

- a sanitized fixture or focused synthetic fixture.
- a failing test that demonstrates the unsupported structure.
- implementation that preserves unknown data.
- passing unit and fixture tests.

Do not weaken fixture expectations, matching rules, or normalization rules to reduce diff volume.

## Fixtures

- Public fixtures belong in `tests/fixtures/sanitized/`.
- Private/manual fixtures belong in `test-fixtures-private/`.
- Do not commit private Launch source, private URLs, customer names, resource names, credentials, cookies, or tokens.

## Pull Requests

Before opening a pull request:

- run `npm run verify`.
- run `npm run test:e2e` when UI, accessibility, visual, release-note, or workflow behavior changes.
- run `npm run build`.
- update docs and examples when behavior or configuration changes.
- include screenshots for meaningful UI changes.

## Security And Privacy

Security-sensitive reports should follow `SECURITY.md`. Public issues and pull requests must not include private source, URLs, config, diffs, release notes, credentials, cookies, tokens, or customer data.
