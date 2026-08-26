# 04 — Analysis Semantics

## Static analysis only

Never execute fetched JavaScript.

Use static parsing to understand current Launch container/build output.

If JavaScript parsing fails, fall back conservatively to text formatting/comparison where possible.

## Current Launch format only

v1 targets current/recent Adobe Launch / Adobe Tags web-library output.

No historical format adapters.

Unknown structures must degrade to Unmapped or file-level comparison rather than being silently ignored.

## Top-level resource matching

Match only by:

1. resource type
2. Launch resource ID

Do not match by name, content fingerprint, similarity, or position.

Different IDs mean explicit Added + Removed even when names/content are nearly identical.

## Child matching

Inside already-matched parents:

1. Stable child Launch ID when available.
2. Exact structural/signature match.
3. Conservative sequence-aware fuzzy matching.
4. If ambiguous, do not force a match; show enclosing-resource diff.

Fuzzy score may consider:

- same component category
- same extension/module identity
- same normalized settings
- similar normalized settings
- same label/name
- nearby sequence position

Confidence must be unambiguous before a heuristic child match is accepted.

## Formatting-only normalization

Goal: make diff readable while preserving meaning.

Normalize:

- line endings
- indentation
- safe formatter output
- parseable syntax presentation
- known-unordered object-key order

Preserve:

- comments present in deployed artifacts
- identifiers
- string/number/boolean literals
- statements
- control flow
- arrays/ordered collections by default
- Launch execution order
- arbitrary hash-like strings

Do not attempt semantic-equivalence proofs.

## Comments

Comment changes are meaningful if the comments exist in the authoritative deployed artifact.

If minification stripped comments, unminified-source-only comment differences do not affect deployed change classification.

## Generated hashes and filenames

Never globally ignore hash-looking strings.

Suppress generated hash/filename noise only when the Launch parser has positively classified a value as a generated deferred-resource reference.

The referenced file contents, not the generated filename, determine whether that deferred code changed.

## Ordering

Meaningful ordering is functional.

Examples that count as Modified:

- rule order/priority change
- event/condition/action sequence change
- child execution sequence reorder

Incidental object serialization order may be normalized only when semantics are known to be unordered.

Unknown arrays remain ordered.

## Resource ownership

Deferred files must be associated with every Launch owner.

A shared file is fetched/diffed once but may cause context under multiple owners.

## Data Element token parsing

Recognize every `%...%` token in applicable configured strings.

Example:

```text
https://%Hostname%%Pathname%?visitor=%Visitor ID%
```

Resolve each token independently to a Data Element resource when possible.

Preserve the raw string exactly for comparison.

## `_satellite.getVar()` parsing

Recognize literal forms such as:

```js
_satellite.getVar("Customer ID")
```

Resolve statically to the named Data Element.

Dynamic forms such as:

```js
_satellite.getVar(prefix + suffix)
```

must be marked dynamic/unresolved. Never execute code to determine the value.

## Dependency impact

Build dependency edges from referencing resource to referenced Data Element.

Calculate:

- direct impact
- transitive impact
- full impact path
- cycle detection

Example:

```text
Rule A -> Data Element B -> Data Element C (modified)
```

Rule A and Data Element B are Impacted even if unchanged.

Impacted never means Modified unless the resource itself also changed.

## Property validation

If both reliable property IDs are available:

- equal → proceed
- different → blocking validation error

If property identity is unavailable on one/both sides, proceed with warning.

## Metadata treatment

Extract and present contextual metadata such as:

- property ID/name
- environment ID/name/stage
- build dates
- Turbine version
- minified state
- canonical/final URL
- resource counts

Ordinary environment/build-instance metadata does not create direct resource changes or release notes.

## Unminified readability aid

Always analyze the exact deployed artifact.

Optionally fetch an obvious unminified equivalent solely for display.

Use it only if reliably verified as corresponding to the deployed artifact. Otherwise pretty-print the deployed source.

Possible source provenance:

- deployed
- verified-unminified
- pretty-printed-deployed

## Source maps

Do not fetch or interpret source maps in v1.

## Non-JavaScript resources

- JavaScript: parse when possible, format, diff.
- JSON: parse and stable pretty-print.
- HTML/CSS/plain text: normalize line endings and diff textually.
- Unknown text: plain-text diff.
- Binary: content fingerprint/change detection only; no byte diff.

Use response content type plus URL/content hints; do not rely solely on extension.

## Diff generation

Detailed diffs are fundamental and automatically generated.

Phase 1 produces classification quickly.

Phase 2 immediately queues every changed resource for GitHub-style detailed diff generation.

User-selected resource gets queue priority.

Detailed diff requirements:

- split Base/Compare
- matching line alignment
- old/new line numbers
- addition/removal gutters
- line highlighting
- intra-line highlighting
- collapsed unchanged hunks
- expandable context
- full display for Added/Removed

## Function folding

Where JavaScript AST ranges are available:

- detect function declarations/expressions
- arrow functions
- class methods
- object methods
- nested callbacks where practical

Rules:

- functions containing changes start expanded
- unchanged functions may collapse automatically
- user can collapse/expand detected functions
- matched Base/Compare folds remain synchronized
- uncertain/unmatched functions are never folded together as if corresponding
- next/previous change automatically expands destination

## Progressive degradation

Level 1: full semantic comparison.

Level 2: partial semantic comparison plus Unmapped resources and warnings.

Level 3: file-level fallback if Launch resource reconstruction is insufficient.

Never invent semantic relationships in degraded mode.
