# 11 — LaunchDiff v1 Acceptance Criteria

LaunchDiff v1 is complete only when all mandatory criteria below are satisfied.

## Input/config

- [ ] Direct public Base/Compare URL mode works.
- [ ] JSON configuration upload works.
- [ ] Config contains no required IDs.
- [ ] Site/environment names and URLs validate with human-readable errors.
- [ ] Config is stored only for active session/tab.
- [ ] Example config and JSON Schema are downloadable/viewable.
- [ ] Base and Compare are explicit and swappable.

## Canonical validation

- [ ] Both canonical artifacts fetched through secure start handshake.
- [ ] Current Launch parser handles supported fixtures.
- [ ] Confirmed property mismatch blocks comparison.
- [ ] Missing property identity warns but can proceed.

## Deferred resolution

- [ ] Only parser-confirmed deferred Launch resources are recursively fetched.
- [ ] Pixel/API/vendor/source-map URLs are never recursively fetched.
- [ ] Shared deferred resources are fetched once.
- [ ] All owners are retained.
- [ ] Every discovered resource has explicit final state.

## Security

- [ ] Public HTTP(S) only.
- [ ] localhost/private/link-local/reserved/metadata targets blocked.
- [ ] redirects revalidated.
- [ ] signed short-lived token scopes `/api/fetch`.
- [ ] generic proxy use prevented.
- [ ] configured resource/size/depth limits enforced.
- [ ] application does not intentionally log source/config/diff/release-note contents.

## Comparison semantics

- [ ] Top-level resources match only by Launch resource ID and type.
- [ ] Different top-level IDs produce Added/Removed.
- [ ] Child fallback matching is conservative and provenance-aware.
- [ ] Ambiguous child matches fall back to enclosing diff.
- [ ] Formatting-only normalization does not hide comments/identifiers/literals.
- [ ] Generated hash suppression is parser-aware only.
- [ ] meaningful ordering changes are Modified.
- [ ] ordinary metadata noise does not create resource modifications.

## Data Elements / impact

- [ ] `%Data Element%` references resolved.
- [ ] multiple tokens per string resolved.
- [ ] literal `_satellite.getVar()` resolved.
- [ ] dynamic getVar references remain unresolved.
- [ ] direct impact works.
- [ ] transitive impact works.
- [ ] cycles are safe.
- [ ] Impacted is distinct from Modified.

## Failures/retries

- [ ] 429/timeout/5xx get one automatic retry.
- [ ] 403/404 do not auto retry.
- [ ] manual Retry Failed Resources works.
- [ ] Refresh Libraries reconstructs full snapshots.
- [ ] <=10% failure yields warnings.
- [ ] >10% failure yields retry-recommended incomplete state.
- [ ] comparison still produced when possible.
- [ ] unresolved counterpart never creates false Added/Removed.

## Diff

- [ ] exact deployed artifact is authoritative.
- [ ] verified unminified counterpart is display-only.
- [ ] source maps not used.
- [ ] GitHub-style split view.
- [ ] line numbers/gutters.
- [ ] line highlights.
- [ ] intra-line highlights.
- [ ] syntax highlighting.
- [ ] collapsed unchanged hunks.
- [ ] expandable context.
- [ ] full Added/Removed view.
- [ ] AST-aware function folding.
- [ ] changed functions expanded by default.
- [ ] detailed diffs auto-generate after classification.
- [ ] selected queued diff is prioritized.

## UI/review

- [ ] Primer foundation.
- [ ] light/dark themes.
- [ ] compact GitHub-like workspace density.
- [ ] Files changed / Impacted / Resolved files / Release notes tabs.
- [ ] collapsible/resizable resource tree.
- [ ] search/status/type filters.
- [ ] persistent completeness banners.
- [ ] Viewed tracking.
- [ ] continuous Previous/Next change navigation.
- [ ] keyboard shortcuts.
- [ ] Resolved Files technical inventory.
- [ ] Release Notes Preview/Raw/Copy/Download.
- [ ] desktop-only workspace gate <1024px.

## Release notes

- [ ] deterministic Markdown only.
- [ ] direct changes included.
- [ ] dependency impact included.
- [ ] analysis warnings included.
- [ ] ordinary build metadata excluded.
- [ ] arbitrary custom code is not overinterpreted.

## Concurrency/cache

- [ ] one same-origin analysis at a time across tabs/windows.
- [ ] Web Lock released on owner close/end.
- [ ] source/comparison payloads not broadcast across tabs.
- [ ] resolved library cache is browser-memory only.
- [ ] config is sessionStorage only.

## Landing page

- [ ] responsive GitHub-inspired landing page.
- [ ] LaunchDiff `<LD/>` SVG mark.
- [ ] three product story visuals.
- [ ] mobile asks user to use desktop for compare workspace.
- [ ] trust/privacy messaging matches implementation.
- [ ] reduced-motion support.

## Accessibility/performance

- [ ] WCAG 2.2 AA target met.
- [ ] color is not sole state indicator.
- [ ] keyboard workflow complete.
- [ ] visual regression in light/dark.
- [ ] analyzer dependencies lazy-load.
- [ ] CPU-heavy analysis stays off main thread.
- [ ] large diff DOM is bounded/virtualized where needed.
- [ ] accuracy is never weakened for performance.

## Open source

- [ ] MIT license.
- [ ] public fixtures sanitized.
- [ ] private fixtures gitignored.
- [ ] SECURITY.md / PRIVACY.md / CONTRIBUTING.md present.
- [ ] CI gates TypeScript, tests, visual/accessibility checks as appropriate.
- [ ] no secrets or private source committed.
