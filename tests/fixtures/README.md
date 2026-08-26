# LaunchDiff Fixtures

Automated tests use sanitized local fixtures only. They must not fetch live Adobe CDN URLs or any other network resource.

## Layout

Public fixtures live under:

```text
tests/fixtures/sanitized/<fixture-id>/
├── manifest.json
└── artifacts/
    └── ...
```

Private real-world fixtures may be kept locally under `test-fixtures-private/`. That directory is gitignored and must never be used by CI.

## Manifest Contract

Each fixture has a `manifest.json` validated by `fixtureManifestSchema`.

The manifest records:

- fixture identity and sanitization status
- one or more libraries
- canonical and deferred artifact URLs
- local artifact paths
- content types and optional SHA-256 checksums
- expected parser facts such as rule, data element, extension, deferred resource, owner, unmapped, reference, and warning counts

Phase 02 verifies fixture loading and metadata expectations only. Parser milestones are responsible for asserting that parsed Launch resources match the expected counts.
