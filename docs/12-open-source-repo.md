# 12 — Open-Source Repository and Governance

## License

MIT.

## Recommended structure

```text
launchdiff/
├── .github/
│   ├── ISSUE_TEMPLATE/
│   ├── PULL_REQUEST_TEMPLATE.md
│   ├── workflows/
│   │   ├── ci.yml
│   │   └── security.yml
│   └── dependabot.yml
├── docs/
├── examples/
├── public/
│   └── landing-page-assets/
├── src/
│   ├── app/
│   ├── components/
│   ├── core/
│   │   └── launch-analyzer/
│   └── workers/
├── tests/
│   ├── unit/
│   ├── comparisons/
│   ├── fixtures/
│   │   └── sanitized/
│   └── e2e/
├── test-fixtures-private/  # gitignored
├── AGENTS.md
├── CONTRIBUTING.md
├── SECURITY.md
├── PRIVACY.md
├── CODE_OF_CONDUCT.md
├── LICENSE
└── README.md
```

## CI

Pull requests should be gated by:

- package install integrity
- TypeScript
- lint
- unit tests
- fixture tests
- comparison tests
- security/proxy tests
- Playwright as project matures
- visual regression as project matures
- accessibility automation as project matures

## Contribution rules

Parser changes must include:

- sanitized fixture or focused synthetic fixture
- failing test that demonstrates the unsupported/current structure
- implementation
- passing regression suite

Do not accept parser heuristics that weaken conservative change detection without an explicit specification change.

## Privacy documentation

`PRIVACY.md` should state clearly:

- supplied public URLs are fetched through the deployed server proxy
- source passes transiently through that proxy
- LaunchDiff does not intentionally persist source/config/diff/release-note content
- only minimal aggregate engagement is collected
- hosting provider may retain infrastructure-level information according to its own policies

## Security documentation

`SECURITY.md` should cover:

- responsible disclosure
- SSRF/security boundary
- no runtime execution of fetched code
- signed analysis token
- public-resource-only model
- sanitization expectations for issue attachments

## Diagnostics

Provide a user-controlled `Copy diagnostic report` action.

Report may contain:

- LaunchDiff version
- browser family/version
- analysis mode/state
- resolved/failed counts
- failure categories
- parser support/degradation state
- generic provenance/confidence summaries

Must not contain:

- URLs
- resource/site/environment names
- source
- config
- diffs
- release notes

## GitHub presence

Landing-page header should link to repository when public.

README should include:

- product screenshot
- concise feature list
- privacy/security principles
- local development
- fixture development
- Vercel deployment
- contribution guide
