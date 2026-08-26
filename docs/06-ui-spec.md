# 06 — GitHub-Fidelity Comparison Workspace UI

## Visual foundation

Use GitHub Primer / Primer React and Primer semantic tokens as the required design-system foundation.

Goal: reproduce GitHub's code-review experience as closely as practical in:

- spacing
- typography hierarchy
- border treatment
- compact density
- light/dark color behavior
- diff backgrounds
- line/intra-line highlights
- gutters
- hover/focus states
- sticky headers
- controls
- counters/labels

Do not copy GitHub branding or global navigation.

## Themes

Support both light and dark.

Initial theme follows system preference.

Allow manual theme toggle.

Use Primer semantic tokens rather than hardcoded GitHub hex values wherever possible.

## Desktop-only workspace

`/compare` requires at least 1024 CSS pixels width.

At narrower viewport:

- do not render a degraded compare UI
- show polished Desktop Required message
- preserve in-memory analysis if viewport later expands

Optimal layout: 1280px+.

## Application shell

Single-page focused review tool.

No permanent global sidebar/dashboard/account chrome.

Before analysis: spacious setup state.

After analysis: setup controls collapse into a compact comparison header with Edit comparison.

## Setup modes

Top-level switch:

- Saved configuration
- Direct URLs

Saved configuration:

- Upload config
- Replace config
- Site dropdown
- Base environment dropdown
- Compare environment dropdown
- Swap
- Compare libraries

Direct URLs:

- Base URL
- Compare URL
- Swap
- Compare libraries

Perform local validation before analysis; no network calls until user clicks Compare libraries.

## Result tabs

Primary tab bar:

1. Files changed
2. Impacted
3. Resolved files
4. Release notes

Default: Files changed.

## Comparison header

Show explicit direction:

```text
Base Environment -> Compare Environment
```

Include:

- Base label
- Compare label
- swap/edit/refresh controls as appropriate
- change counts
- persistent analysis completeness/status

## Resource tree

Files changed uses a collapsible, resizable left tree.

Features:

- Rules / Data Elements / Extensions / Runtime / Unmapped groupings
- Added / Modified / Removed indicators
- current selection highlight
- search/filter
- Changes only default
- Show unchanged toggle
- Viewed state
- compact density
- keyboard navigation
- collapse sidebar control

Search:

- client-side
- immediate
- case-insensitive substring
- match resource name
- match Launch ID
- optionally component names
- preserve hierarchy

Filters:

- status
- resource type
- combinable

## Diff header

Sticky selected-resource header.

Always show:

- resource type/name
- Base/Compare context
- status
- Previous/Next change
- Viewed toggle
- Expand all / collapse controls where useful

Technical metadata such as resource ID, file provenance, matching method, and source filename belongs under a Details disclosure.

## Diff renderer

Own the rendering layer.

Use a generic open-source diff algorithm but custom DOM/CSS.

Required split-diff behavior:

- Base left / Compare right
- synchronized rows
- old/new line numbers
- `-` / `+` gutters
- GitHub-style line backgrounds
- GitHub-style intra-line highlighting
- syntax highlighting layered underneath diff emphasis
- horizontal code scrolling where required
- sticky resource header
- collapsed unchanged hunks
- per-hunk context expansion
- Expand all
- full-file display for Added/Removed resources

## Syntax highlighting

Support:

- JavaScript
- JSON
- HTML
- CSS
- plain text fallback

Diff emphasis must remain visually dominant and accessible.

## Function folding

AST-aware when parse ranges exist.

- collapse unchanged functions automatically where useful
- changed functions start expanded
- per-function chevrons
- nested folding where practical
- synchronized matched folds
- do not pair/fold uncertain matches
- next/previous change auto-expands destination

## Continuous review navigation

Previous / Next Change traverses:

1. hunks inside current resource
2. next/previous changed resource at boundary

Provide separate next/previous resource keyboard commands.

## Viewed tracking

GitHub-style session-only Viewed state.

- only changed resources count toward main review progress
- Impacted may have separate optional Viewed state
- reset when libraries are refreshed/recomputed
- reviewed resources visually de-emphasized
- show `Reviewed N / M`

## Keyboard shortcuts

Suggested v1 set:

- `j` / `k`: next / previous change
- `n` / `p`: next / previous changed resource
- `v`: toggle Viewed
- `f`: focus resource filter
- `[` / `]`: collapse / expand current fold/region when applicable
- `Esc`: clear transient focus/popover/filter focus context
- `?`: shortcut reference

Do not override important browser-standard shortcuts.

## Impacted tab

Impacted is not a direct change.

Use Primer attention/warning styling rather than red/green diff colors.

Show:

- unique impacted resource count
- direct impacts before transitive
- dependency path(s)
- collapsible path details
- unchanged definition status

If resource is Modified and Impacted, Modified remains primary and impact is supplemental.

## Analysis status

Use persistent GitHub-style status/check banners.

Examples:

- Analysis complete
- Analysis completed with warnings
- Incomplete analysis — retry recommended

Show Base/Compare resolved counts and failure rate.

Provide Retry Failed Resources.

Use modal only for blocking states, e.g. confirmed property mismatch.

## Progress view

Show real phases and counts, never fake percent when totals are unknown.

Examples:

- canonical fetched
- resources parsed
- deferred resources discovered
- `18 / 24 resolved`
- dependency graph built
- `7 / 12 detailed diffs prepared`

Allow Cancel while analysis owns cross-tab lock.

## Resolved files tab

Searchable/filterable technical inventory.

Columns/rows may show:

- status
- filename
- owner(s)
- content type
- size

Filters:

- All
- Failed
- Unmapped

Selecting opens technical details:

- requested/final URL
- status
- content type
- size
- owners
- fetch attempts
- source provenance
- View source
- Retry resource when failed

Use source viewer without presenting unchanged source as a diff.

## Release notes tab

GitHub-style Markdown rendering.

Controls:

- Preview
- Raw Markdown
- Copy
- Download `.md`

## Accessibility

WCAG 2.2 AA required.

- state icons/text in addition to color
- visible focus
- semantic headings/landmarks
- keyboard controls
- screen-reader labels
- sufficient light/dark contrast
- diff remains understandable without syntax colors
- `prefers-reduced-motion`

## Visual regression

Maintain LaunchDiff-owned golden screenshots in both themes for critical states at representative desktop sizes.
