# 10 — Codex Implementation Plan

Build LaunchDiff in the following gated milestones.

Do not skip ahead by tightly coupling UI to incomplete analyzer behavior.

## Phase 01 — Project foundation and contracts

### Deliverables

- Next.js + React + strict TypeScript project
- lint/format/test baseline
- Primer installed/configured
- `src/core/launch-analyzer/` isolated
- initial domain types from `03-domain-model.md`
- config schema/types
- CI skeleton

### Acceptance

- strict TypeScript passes
- core analyzer has no React/Next/DOM imports
- config example validates
- unit test runner passes

## Phase 02 — Fixture system

### Deliverables

- sanitized fixture directory layout
- fixture manifest type
- local fixture `ResourceFetcher`
- `test-fixtures-private/` gitignored
- fixture documentation

### Acceptance

- analyzer can load fixture artifacts without network
- expected fixture metadata assertions run deterministically

## Phase 03 — Current Launch parser

### Deliverables

- current-format detection
- extraction of Rules, Data Elements, Extensions, runtime metadata
- child components
- Launch resource IDs
- Unmapped preservation

### Acceptance

- fixture resource counts match exact expected values
- IDs and names extracted correctly
- unknown structures preserved, never silently dropped

## Phase 04 — Deferred Launch resolver

### Deliverables

- parser-confirmed deferred resource discovery
- recursive wave resolution
- dedupe
- ownership graph
- many-to-many ownership
- no arbitrary URL crawling

### Acceptance

- all fixture deferred resources discovered
- pixels/APIs/source maps not fetched
- shared resources fetched once
- all owners retained

## Phase 05 — Normalization and readability

### Deliverables

- JS parse/format path
- conservative text fallback
- JSON normalization
- HTML/CSS/text handling
- binary fingerprinting
- parser-known object key normalization
- parser-aware generated hash suppression
- verified unminified display-source logic

### Acceptance

- formatting-only JS differences compare unchanged
- deployed comments remain meaningful
- unknown arrays preserve order
- arbitrary hash-like string changes remain visible
- unminified file cannot create authoritative change

## Phase 06 — Matching

### Deliverables

- top-level Launch-ID matching only
- child ID matching
- exact signatures
- conservative fuzzy fallback
- ambiguity handling
- provenance/confidence

### Acceptance

- different top-level IDs -> Added + Removed
- same top-level ID -> matched even if renamed
- ambiguous child candidates do not get forced matches
- heuristic results expose provenance/confidence

## Phase 07 — Data Element dependency graph

### Deliverables

- `%...%` token parser
- multiple token handling
- `_satellite.getVar("...")` AST detection
- unresolved/dynamic references
- direct graph
- transitive impacts
- cycle detection

### Acceptance

- all fixture references resolve as expected
- transitive paths retained
- cycles terminate safely
- unchanged dependent resource can be Impacted without Modified

## Phase 08 — Comparison engine

### Deliverables

- Added/Removed/Modified/Unchanged classification
- structured changes
- meaningful execution-order detection
- property ID validation
- completeness/warning propagation
- degraded semantic/file-level fallback

### Acceptance

- fixture comparisons produce exact expected classifications
- property mismatch blocks
- missing property ID warns but proceeds
- failed counterpart does not create false Added/Removed

## Phase 09 — Detailed diff engine

### Deliverables

- line diff
- intra-line diff
- hunk model
- collapsed unchanged context
- full Added/Removed model
- syntax token integration
- AST function ranges/folding model
- progressive queue/cache

### Acceptance

- every changed fixture resource automatically receives detailed diff
- selected queued resource gains priority
- comments/identifiers/literals remain visible
- folding never hides changed functions by default

## Phase 10 — Deterministic release notes

### Deliverables

- structured templates
- direct changes
- Data Element reference wording
- Dependency Impact
- Analysis Warnings
- Markdown output

### Acceptance

- exact snapshot tests
- no AI dependency
- no unsupported business-meaning claims
- incomplete comparison warning always copied into notes

## Phase 11 — Secure Vercel fetch boundary

### Deliverables

- `/api/analysis/start`
- `/api/fetch`
- signed token
- SSRF/public-network controls
- redirect revalidation
- batching
- size/resource limits
- retry result categories
- no-content logging discipline

### Acceptance

- security test suite passes
- generic proxy behavior blocked
- canonical sources returned from start handshake
- token limits recursive access

## Phase 12 — Web Worker orchestration

### Deliverables

- worker adapter
- progress events
- fetch bridge
- cancellation
- in-memory library cache
- session config handling
- Retry Failed Resources
- Refresh Libraries
- Web Lock / BroadcastChannel concurrency

### Acceptance

- main thread remains responsive on large fixture
- only one same-origin tab may analyze
- completed libraries reusable in tab
- incomplete libraries not cached as complete

## Phase 13 — GitHub-style comparison workspace

### Deliverables

- setup UI
- compact post-analysis header
- four result tabs
- resource tree
- filters/search
- custom split diff renderer
- sticky header
- syntax highlighting
- hunks/context expansion
- function folding
- Viewed state
- keyboard shortcuts
- persistent status banners
- Resolved Files
- Release Notes preview/raw/copy/download
- desktop viewport gate

### Acceptance

- visual regression baselines approved
- light/dark parity
- WCAG automated checks pass
- keyboard workflow works end-to-end
- no prebuilt diff viewer compromises layout fidelity

## Phase 14 — Landing page

### Deliverables

- responsive GitHub-inspired product landing page
- `<LD/>` SVG mark
- hero/product sections
- privacy/trust section
- GitHub repo link placeholder/config
- mobile desktop-required messaging
- three product visuals / asset hooks
- reduced-motion behavior

### Acceptance

- mobile/desktop responsive
- strong Core Web Vitals target
- compare CTA behavior correct by viewport
- no marketing dependency blocks application use

## Phase 15 — E2E, visual, accessibility validation

### Deliverables

- complete Playwright suite
- golden screenshots
- axe checks
- keyboard/manual checklist
- representative large-property fixture performance test

### Acceptance

- all CI gates green
- no known WCAG 2.2 AA blocker
- no visual regression drift
- no main-thread freeze in representative large fixture

## Phase 16 — Open-source and deployment hardening

### Deliverables

- README
- MIT license
- SECURITY.md
- PRIVACY.md
- CONTRIBUTING.md
- CODE_OF_CONDUCT.md
- example config/schema
- issue/PR templates
- Dependabot
- CI/security workflows
- Vercel deployment documentation
- sanitized diagnostic report feature

### Acceptance

- repository contains no private fixtures/secrets
- one-command local dev/test setup documented
- production env secrets documented
- public privacy claims match implementation
