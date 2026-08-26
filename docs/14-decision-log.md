# 14 — Agreed Decision Log

This is a compact record of the decisions made while scoping LaunchDiff. Detailed rules live in the other documents.

## Product

- Name: LaunchDiff.
- Goal: compare two deployed Adobe Launch / Adobe Tags libraries and present changes like GitHub code review.
- Same Launch property only.
- User explicitly selects Base and Compare; direction is never inferred.
- No Adobe Launch API integration.
- Input is public canonical library URLs.
- Current Launch formats only; no historical compatibility requirement.

## Configuration

- Users may compare direct URLs or upload a portable JSON site/environment config.
- Config contains site names, environment names, URLs, and `version` only; no user-authored IDs required.
- Runtime alphanumeric IDs may be assigned internally.
- Config is file-only; no in-app config editor.
- Config is stored in temporary tab/session browser storage and must be re-uploaded on a future session.
- Example config and schema should be available.

## Resolution

- Recursively fetch only deferred Launch resources positively identified by the Launch parser.
- Do not fetch pixel URLs, arbitrary API endpoints, arbitrary external scripts, or source maps.
- External URLs still remain meaningful diff content.
- No JavaScript execution; analysis is static only.
- Shared deferred artifacts are fetched/diffed once and associated with every owner.
- Deployed artifact is authoritative.
- Verified unminified equivalent may aid readability only.
- Do not fetch/interpret source maps.

## Comparison

- Top-level resource identity: Launch resource ID only, scoped by resource type.
- Different top-level IDs produce Added/Removed, even with similar names/content.
- Child components may use conservative fuzzy matching only as fallback inside an already-matched parent.
- Ambiguous child matching must not be forced.
- Prefer extra visible change over a false negative.
- Formatting-only normalization.
- Comments present in deployed artifact are meaningful.
- Do not attempt semantic equivalence.
- Suppress generated hash/filename noise only when parser-confirmed as a generated deferred-resource reference.
- Execution ordering is meaningful.
- Unknown arrays remain ordered by default.
- Unknown/unmapped resources are shown rather than discarded.

## Data Elements and impact

- Parse `%Data Element Name%` tokens.
- Parse literal `_satellite.getVar("Data Element Name")` calls statically.
- Dynamic getVar expressions remain unresolved.
- Resolve references back to Launch Data Element resources.
- Calculate direct and transitive impact.
- Retain dependency paths and detect cycles.
- Impacted is distinct from Modified.

## Failures

- Produce partial comparison when possible.
- 0% failure: Complete.
- >0% to 10% failure: Complete with warnings.
- >10% failure on either side: Incomplete / retry recommended.
- One automatic retry for timeout, 429, and 5xx.
- No automatic retry for 403/404.
- Manual Retry Failed Resources.
- Refresh Libraries reconstructs from scratch.
- A fetch failure must not masquerade as Added/Removed.
- Parser failure degrades toward partial semantic or file-level comparison rather than automatically discarding all evidence.

## Performance / hosting

- Target lightweight/free Vercel hosting architecture.
- Vercel server performs secure network fetching only.
- Browser/Web Worker performs parsing, normalization, matching, impact, comparison, diffing, release notes.
- Batch deferred fetches.
- Cache fully resolved libraries in browser memory for the active session.
- Detailed diffs are progressively prepared automatically after classification.
- No manual action is required to start detailed diff computation.
- User-selected pending diff gets priority.
- Performance optimizations may not weaken accuracy.

## Concurrency

- Only one analysis at a time across same-origin tabs/windows in a browser profile.
- Prefer Web Locks plus BroadcastChannel for coordination.
- Do not share source/comparison payloads across tabs.

## Server security

- Public anonymous HTTP(S) only.
- Strong SSRF protections.
- Validate redirects.
- Reject private/reserved/loopback/link-local/metadata destinations.
- Use short-lived stateless signed analysis token.
- Token scopes recursive requests to approved URL origin/path roots.
- Fetch proxy must not become a generic public proxy.
- Use generous centralized resource/size/depth limits and warn when hit.

## Release notes

- No AI.
- Deterministic, human-readable technical Markdown.
- Include direct changes, dependency impact, and analysis warnings.
- Do not overinterpret arbitrary custom JavaScript.
- Copy and Download `.md`.
- Preview and Raw Markdown views.

## Workspace UI

- GitHub code-review UI is the visual/interaction reference to very high fidelity.
- Use GitHub Primer as the design-system foundation.
- Support GitHub-like light and dark themes.
- Single-page, compact desktop review workspace.
- Large setup state before analysis; compact header after analysis.
- Tabs: Files changed, Impacted, Resolved files, Release notes.
- Files changed is default.
- Collapsible/resizable left resource tree.
- GitHub-style split diff renderer owned by LaunchDiff.
- Old/new line numbers, gutters, line highlights, intra-line highlights.
- GitHub-style collapsed unchanged hunks and context expansion.
- Syntax highlighting for JS/JSON/HTML/CSS; plain-text fallback.
- AST-aware function folding.
- Previous/Next Change traverses continuously across resources.
- Session-only Viewed tracking and review progress.
- Impacted uses attention/amber semantics, not red/green change semantics.
- Persistent status/check banners for completeness/warnings.
- Resolved Files provides searchable technical inventory and source/details panel.
- Resource search plus status/type filters.
- Keyboard-first review shortcuts.
- Real analysis phase/count progress; no fake percentages.
- WCAG 2.2 AA acceptance criterion.
- Visual regression tests required.

## Browser/viewport

- Current desktop Chrome, Edge, Firefox, Safari.
- Compare workspace desktop-only.
- Minimum comparison workspace width approximately 1024 CSS pixels.
- Landing page responsive on mobile/tablet/desktop.
- Mobile landing page asks user to use desktop to explore the actual tool.

## Landing page / brand

- Distinct LaunchDiff branding but GitHub landing-page-like style, design rhythm, and colors.
- Minimal font-based SVG logo, recommended `<LD/>`.
- Theme-aware landing page.
- GitHub repository link when project is public.
- Product visuals: split diff, dependency impact, resolved Launch resource graph.
- Polished technical copy; avoid generic SaaS language.
- Subtle explanatory motion only; respect reduced motion.

## Open source / privacy

- Open source.
- MIT license.
- Sanitized fixtures public; real/private fixtures gitignored.
- Minimal aggregate engagement data only, enough to understand usage volume.
- No behavioral telemetry or user profiling.
- No automatic error-reporting SaaS.
- User-controlled sanitized diagnostic report for GitHub issues.
- Privacy-by-default/no-content-logging.
