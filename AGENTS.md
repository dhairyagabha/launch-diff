# AGENTS.md — LaunchDiff Codex Instructions

This file defines mandatory operating rules for any coding agent working on LaunchDiff.

## 1. Mission

Build LaunchDiff exactly as defined in the repository specification. LaunchDiff is a conservative Adobe Launch / Adobe Tags deployed-library comparator whose primary obligation is to avoid hiding plausible changes.

## 2. Highest-priority engineering rule

> Prefer an explicit extra difference over an incorrect match that could hide a real change.

Never weaken this rule to make tests pass, improve visual cleanliness, or reduce diff volume.

## 3. Work milestone-by-milestone

Follow `docs/10-implementation-plan.md` in order unless the user explicitly directs otherwise.

For each milestone:

1. Read the relevant specification documents.
2. Implement the smallest coherent vertical slice for that milestone.
3. Add or update tests before declaring completion.
4. Run the milestone acceptance tests.
5. Do not continue to the next milestone while required acceptance criteria fail.
6. Do not delete, skip, relax, or rewrite tests merely to obtain a passing run.

## 4. Keep the core analyzer framework-independent

Everything under `src/core/launch-analyzer/` must remain independent of:

- React
- Next.js
- `window`
- `document`
- `sessionStorage`
- browser DOM APIs
- Vercel-specific APIs

Network access must be injected through interfaces such as `ResourceFetcher`.

Use pure functions wherever possible after the fetch boundary.

## 5. Never execute downloaded library code

Fetched JavaScript is data only.

Forbidden:

- `eval`
- `Function(...)`
- VM execution of downloaded resources
- script injection
- headless-browser execution of user-supplied Launch code

All analysis must be static.

## 6. Recursive fetching boundary

Recursive fetching is allowed only for URLs that the current Launch parser positively identifies as deferred Launch resources.

Never recursively fetch URLs merely because they appear in source text.

Do not follow:

- tracking pixels
- analytics collection endpoints
- arbitrary `fetch()` or XHR URLs
- image URLs
- arbitrary external SDK URLs
- source maps
- links in comments or strings

External URLs still participate normally in diffs.

## 7. Change classification authority

The exact deployed artifact is authoritative.

A verified unminified counterpart may be used only as a readability aid. It must never introduce a change that does not exist in the deployed artifact.

Source maps are out of scope.

## 8. Resource identity rules

Top-level Launch resources are matched only by Launch resource ID plus resource type.

Do not fuzzy-match top-level Rules, Data Elements, or Extensions.

Different Launch IDs mean Added + Removed even when names or content are similar.

Child components inside an already-matched parent may use conservative fuzzy matching as a fallback, but only when the result is unambiguous. Ambiguous matching must fall back to an enclosing-resource diff rather than forcing a match.

Every heuristic match must retain provenance and confidence in the domain model.

## 9. Normalization rules

Normalize presentation only.

Allowed examples:

- line endings
- indentation
- parseable pretty-printing
- safe formatting noise
- parser-known unordered object-key serialization

Do not normalize away:

- comments present in deployed source
- identifiers
- literals
- executable statements
- meaningful Launch execution ordering
- unknown array ordering
- arbitrary hash-looking strings

Generated hash/filename differences may be suppressed only when the Launch parser has positively classified the value as a generated deferred-resource reference.

## 10. Data Element references

Recognize and resolve:

- `%Data Element Name%`
- literal `_satellite.getVar("Data Element Name")`

Support multiple `%...%` tokens inside a single string.

Do not execute dynamic `getVar()` expressions. Mark them unresolved when they cannot be determined statically.

Build direct and transitive dependency impact graphs with cycle detection.

## 11. Failure behavior

Never silently omit discovered resources.

Every discovered resource must end in a known state:

- resolved
- failed
- skipped because of a documented safety limit
- unsupported/unmapped

If canonical libraries can be fetched and parsed enough to compare, produce the best available comparison even when some deferred resources fail.

Failure rate is evaluated independently for Base and Compare:

- 0%: Complete
- >0% and <=10%: Complete with warnings
- >10%: Incomplete / retry recommended

Retry transient failures once automatically (`429`, timeout, `5xx`). Do not automatically retry deterministic failures such as `404` or `403`. Manual Retry Failed Resources retries remaining failures.

A missing counterpart caused by a failed fetch must never be misclassified as Added/Removed solely because the resource could not be retrieved. Use Unknown/Unresolved where appropriate.

## 12. Vercel/free-tier architecture

Keep server work thin.

Server responsibilities:

- canonical fetch handshake
- URL security validation
- short-lived signed analysis token issuance
- batched public-resource fetch proxy
- redirect revalidation
- response-size/security enforcement

Browser Worker responsibilities:

- Launch parsing
- recursive discovery orchestration
- normalization
- matching
- dependency graph
- comparison
- detailed diff generation
- deterministic release notes

Only one analysis may execute at a time across same-origin browser tabs/windows. Prefer Web Locks, with BroadcastChannel for status coordination.

## 13. Privacy

Do not intentionally persist or log:

- library source
- library URLs in application logs
- site config contents
- resource names
- diffs
- comparison results
- release notes

Minimal aggregate engagement is allowed only to understand usage volume, such as aggregate page traffic and `/api/analysis/start` request counts. Do not create persistent visitor identifiers or behavioral event streams.

No automatic client-side error-reporting SaaS. Provide a user-controlled sanitized diagnostic report instead.

## 14. UI fidelity

Use GitHub Primer as the design-system foundation.

The comparison workspace should reproduce GitHub code-review interaction patterns as closely as practical, including:

- light/dark themes
- compact density
- split diff
- line numbers and gutters
- addition/removal backgrounds
- intra-line highlights
- collapsed unchanged hunks
- expandable context
- syntax highlighting
- sticky file/resource headers
- resource tree
- Viewed tracking
- keyboard navigation
- function folding where AST ranges allow it

Own the diff renderer. Do not accept a prebuilt viewer that prevents GitHub-level fidelity.

## 15. Accessibility

WCAG 2.2 AA is a release requirement.

Color may never be the sole status indicator. Preserve keyboard accessibility, semantic structure, visible focus, contrast, screen-reader text, and `prefers-reduced-motion` behavior.

## 16. Desktop-only comparison workspace

The landing page is responsive and mobile-friendly.

The actual `/compare` workspace requires a desktop viewport of at least 1024 CSS pixels. On narrower viewports, show a polished desktop-required message. Do not implement a degraded mobile diff experience in v1.

## 17. Test discipline

Parser changes must be fixture-backed.

Do not rely on live CDN URLs for automated tests.

Use sanitized captured current Launch builds for public fixtures. Keep real/private fixtures in a gitignored `test-fixtures-private/` directory.

Add visual regression baselines for core UI states in both light and dark themes.

## 18. Out of scope

Do not add these unless explicitly requested:

- Adobe Launch API integration
- Adobe auth
- accounts
- database
- server-side history
- AI/LLM features
- source-map support
- runtime code execution
- legacy Launch-format compatibility
- cross-property comparison
- authenticated/private library fetching
- arbitrary crawling
- generic proxy behavior
- in-app site-config editor
- comparison export/import
- mobile compare experience
- business-impact interpretation of arbitrary custom JavaScript

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
