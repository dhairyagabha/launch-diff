# 02 — Architecture

## High-level design

LaunchDiff is client-heavy so it can remain practical on a free/lightweight Vercel deployment.

```text
Browser
  ├─ Next.js / React / Primer UI
  ├─ Web Worker
  │    └─ framework-independent launch-analyzer
  ├─ in-memory resolved-library cache
  ├─ sessionStorage site config
  └─ review state / generated diffs

Vercel
  ├─ static/application delivery
  ├─ POST /api/analysis/start
  └─ POST /api/fetch

Public CDN / self-hosted public Launch artifacts
```

## Server responsibilities

The server is a secure networking boundary, not the analyzer.

### `/api/analysis/start`

Input:

```json
{
  "baseUrl": "https://...",
  "compareUrl": "https://..."
}
```

Responsibilities:

1. Validate both URLs.
2. Enforce public HTTP(S) only.
3. Apply SSRF/DNS/redirect controls.
4. Fetch both canonical library artifacts.
5. Reject obvious invalid binary/non-JS inputs.
6. Allow ambiguous JavaScript through so the authoritative client parser can decide.
7. Establish allowed deferred-resource origin/path roots.
8. Issue a short-lived signed analysis token.
9. Return canonical sources and fetch metadata.

### `/api/fetch`

Input:

- signed analysis token
- small batch of deferred Launch resource URLs

Responsibilities:

1. Verify token signature/expiry.
2. Verify requested URLs are allowed by token scope.
3. Re-run public-network safety validation.
4. Revalidate redirect destinations.
5. Enforce per-resource and batch size limits.
6. Fetch resources with bounded concurrency.
7. Return per-resource success/failure results.
8. Do no Launch parsing.

## Browser worker responsibilities

The worker orchestrates analysis:

1. Parse canonical current-format Launch libraries.
2. Discover parser-confirmed deferred Launch resource references.
3. Request deferred resources from `/api/fetch` in small batches.
4. Parse returned resources.
5. Discover any further deferred Launch resources.
6. Deduplicate resolved artifacts.
7. Construct ownership graph.
8. Normalize resources.
9. Match resources.
10. Build Data Element dependency graph.
11. Compare Base vs Compare.
12. Calculate direct/transitive impact.
13. Prepare structured changes.
14. Automatically generate detailed diffs progressively.
15. Generate deterministic release notes.

## Framework-independent analyzer

Proposed structure:

```text
src/core/launch-analyzer/
├── model/
├── parser/
├── resolver/
├── normalizer/
├── matcher/
├── dependencies/
├── comparison/
├── diff/
├── release-notes/
└── index.ts
```

No React/Next/browser DOM imports in this directory.

## Web Worker adapter

```text
src/workers/analyzer.worker.ts
```

Responsibilities:

- receive analysis commands
- call core analyzer
- proxy fetch requests through browser/server adapter
- report progress
- support cancellation
- prioritize user-selected detailed diff
- maintain current analysis state only

## One-analysis-at-a-time rule

Only one analysis may run at a time across same-origin browser tabs/windows.

Preferred implementation:

- Web Locks API: exclusive lock named `launch-library-analysis`
- BroadcastChannel: cross-tab status only

Do not share source/comparison payloads across tabs.

## Session caching

### `sessionStorage`

- uploaded config only
- input mode preference if desired

### Browser memory

- fully resolved Base/Compare libraries
- detailed diff cache
- comparison model
- review/View state

Do not cache incomplete libraries as reusable completed entries.

## Cancellation

Starting a new analysis while the current tab owns the lock should cancel/supersede the active analysis.

Cancel should:

- abort outstanding requests
- stop scheduling resources
- stop worker work
- discard incomplete library snapshots
- preserve fully completed library cache entries

## Snapshot semantics

Each analysis is an immutable snapshot.

Once a resource resolves successfully, its bytes are fixed for that run. Re-fetch only when:

- Retry Failed Resources
- Refresh Libraries

## Progressive result availability

Phase 1:

- resolve
- parse
- normalize
- match
- classify
- impact analysis
- present results

Phase 2 automatically starts immediately:

- detailed line/intra-line diff generation for all changed resources
- cache results
- update progress
- reprioritize selected resources
