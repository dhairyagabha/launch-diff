# 09 — Testing Strategy

## Principle

The Launch parser is considered correct because it produces known results against captured current-format builds, not because it happens to work against a live CDN URL today.

## Public fixtures

Store sanitized captured Launch artifacts under:

```text
tests/fixtures/sanitized/
```

Include canonical library plus every deferred Launch resource required by the fixture.

Automated tests must not depend on live Adobe CDN URLs.

## Private fixtures

Support:

```text
test-fixtures-private/
```

This directory must be gitignored.

It may contain real-world private/company Launch builds for local/manual validation.

## Fixture expectations

Each fixture should have an explicit manifest containing expected facts:

- property ID if available
- Rule count
- Data Element count
- Extension count
- deferred resource count
- mapped ownership count
- unmapped count
- Data Element references
- warnings

Example assertions:

```text
Expected 84 Rules, parser returned exactly 84.
Expected 57 Data Elements, parser returned exactly 57.
Expected 31 deferred resources and 31 mapped owners.
```

## Unit tests

Cover:

- Launch container resource extraction
- current-format identification
- deferred-resource reference discovery
- ownership mapping
- `%Data Element%` parsing
- multiple tokens in one string
- `_satellite.getVar("...")`
- dynamic getVar unresolved handling
- formatting normalization
- comments preserved
- known-unordered object normalization
- arrays preserved as ordered
- parser-aware hash suppression
- top-level Launch-ID matching
- child-ID matching
- exact child signatures
- fuzzy child matching
- ambiguous child fallback
- ordering changes
- binary fingerprint behavior
- release-note templates

## Dependency tests

Include:

### Direct

```text
Rule -> DE-A (modified)
```

### Transitive

```text
Rule -> DE-B -> DE-A (modified)
```

### Cycle

```text
DE-A -> DE-B -> DE-C -> DE-A
```

Verify traversal stops and reports valid impacts without infinite recursion.

## Comparison fixture tests

Cover:

- Added
- Removed
- Modified
- Unchanged
- resource rename with same Launch ID
- different ID with nearly identical content -> Added + Removed
- child inserted in sequence
- execution-order changes
- comment-only deployed change
- formatting-only no-change
- deferred filename/hash change with identical deferred contents
- external URL text change
- failed counterpart -> Unknown/Unresolved rather than false Added/Removed

## Resolver/fetch tests

Use mocked server/fetch layer.

Cover:

- canonical fetch
- deferred recursion
- shared deferred file dedupe
- many-to-many ownership
- 404
- 403
- 429 one automatic retry
- 500 one automatic retry
- timeout one automatic retry
- redirect validation
- redirect to private IP blocked
- localhost/private/link-local/metadata blocked
- unsupported protocol
- response-size limit
- resource-count limit
- recursion-depth limit
- total-byte limit
- source map not followed
- pixel/API URL not followed

## Token/proxy tests

- valid signed token accepted
- expired token rejected
- tampered token rejected
- out-of-root URL rejected
- redirect outside allowed root rejected
- generic proxy use prevented

## Progress/cancellation tests

- real counts reported
- no fake percent when total unknown
- cancel aborts outstanding requests
- incomplete library not cached as complete
- completed library remains cacheable
- selected detailed diff receives priority

## Cross-tab concurrency tests

Where browser support allows:

- only one tab acquires analysis lock
- second tab gets busy state
- closing owner releases lock
- BroadcastChannel status updates do not transfer comparison/source payloads

## UI tests

Playwright should cover:

- setup modes
- config upload/validation
- direct URL validation
- property mismatch blocking state
- progress UI
- warning/retry states
- resource filters
- Viewed state
- keyboard shortcuts
- next/previous traversal across resources
- function folding
- Resolved Files
- Release Notes copy/download behavior
- theme switching
- desktop viewport gate
- mobile landing page

## Visual regression

Commit LaunchDiff-owned golden screenshots for both themes.

Representative states:

- setup
- modified JavaScript split diff
- intra-line diff
- added resource
- removed resource
- collapsed hunk
- folded function
- Impacted resource
- warning/incomplete state
- Resolved Files
- Release Notes

Representative viewports:

- 1280x900
- 1440x1000
- 1920x1080

Do not use screenshots copied from GitHub as fixtures.

## Accessibility

Automated axe checks plus manual keyboard/accessibility verification.

Target WCAG 2.2 AA.

Verify:

- color not sole state indicator
- contrast
- focus visibility
- keyboard traversal
- screen-reader labels
- reduced motion
- semantic headings/landmarks
