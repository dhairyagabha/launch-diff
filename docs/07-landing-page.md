# 07 — Landing Page

## Goal

Create a polished LaunchDiff product landing page inspired by GitHub's developer-product landing-page style, layout rhythm, color language, typography hierarchy, product demonstrations, and restrained motion.

LaunchDiff branding remains distinct.

Route split:

- `/` — responsive landing page
- `/compare` — desktop-only comparison workspace

## Header

Minimal header:

- `<LD/>` mark + LaunchDiff wordmark
- How it works
- Features
- Privacy
- GitHub repository link once public
- primary CTA: Compare libraries
- theme toggle if appropriate

## Hero

Suggested headline:

**Compare Adobe Launch libraries with confidence.**

Suggested supporting copy:

> See exactly what changed between two deployed Adobe Launch libraries — including Rules, Data Elements, Extensions, deferred resources, custom code, and downstream dependency impact.

Suggested CTAs:

- Compare libraries
- How it works

On mobile, primary CTA communicates desktop requirement, e.g. `Explore on desktop`.

## Product story sections

### 1. See every deployed change

Explain:

- actual deployed CDN artifacts are the source of truth
- generated hashes are not treated as meaningful identities
- deferred Launch resources are resolved
- GitHub-style split diffs expose exact changes

### 2. Understand downstream impact

Explain:

- `%Data Element%` references
- `_satellite.getVar()` references
- direct/transitive impact
- unchanged-but-Impacted resources

### 3. Validate the complete resolved library

Explain:

- canonical + deferred resources
- Resolved Files technical view
- explicit failures/warnings
- retry behavior
- no silent omissions

### 4. Release-ready technical notes

Explain deterministic release notes:

- no AI
- direct changes
- dependency impact
- warnings
- copy/download Markdown

## Trust section

Suggested concise statements:

- No Adobe authentication
- No accounts
- No AI
- No JavaScript execution
- No persistent source storage
- Minimal aggregate engagement measurement only

## Final CTA

Suggested headline:

**Know exactly what changed before you publish.**

CTA: `Compare libraries`

## Mobile behavior

Landing page fully responsive.

`/compare` is desktop-only.

On mobile/narrow tablet, explain that LaunchDiff is designed for detailed side-by-side review and ask user to open on desktop.

## Brand mark

Use a small font-based inline SVG mark, recommended concept:

```text
<LD/>
```

Requirements:

- SVG only
- theme aware
- legible at favicon size
- system/monospace visual language
- no Adobe/GitHub trademark imitation
- optional restrained green accent
- accessible standalone / decorative modes

## Motion

Use restrained explanatory motion only.

Examples:

- reveal changed diff lines
- illuminate dependency path
- connect deferred resources to owners

No continuous decorative animation.

Respect `prefers-reduced-motion` and provide static fallbacks.

## Core generated/product visuals

### Visual 1 — Split diff hero

**Prompt:**

> A polished developer-tool product interface for LaunchDiff, showing two Adobe Launch library resources compared side by side in a professional GitHub-style code review layout, left resource tree with Rules, Data Elements, and Extensions, synchronized old and new line-number gutters, precise green additions and red removals, subtle intra-line highlights, compact developer-tool spacing, dark GitHub Primer-inspired neutral surfaces, crisp realistic UI composition, no logos from GitHub or Adobe, no fake readable paragraphs, wide 16:9 product screenshot illustration, restrained green accent, premium open-source developer tool aesthetic.

### Visual 2 — Dependency impact

**Prompt:**

> A clean technical dependency visualization for LaunchDiff showing one modified Adobe Launch Data Element connected to another Data Element and then to several unchanged analytics Rules, the changed node uses a restrained code-review change treatment and downstream impacted nodes use amber warning styling, thin precise connectors, GitHub Primer-inspired light developer interface, compact labels as abstract UI shapes rather than readable fake text, professional software engineering diagram, high clarity, wide horizontal composition.

### Visual 3 — Resolved library graph

**Prompt:**

> A polished software architecture product visual for LaunchDiff showing one canonical Adobe Launch JavaScript library branching into multiple deferred Launch rule and custom-code resources, every deferred file connecting back to its owning Rule or Data Element, resolved items have subtle success checks and one failed resource has an amber warning, GitHub-style developer tool visual language, neutral dark background, crisp lines and panels, no pixel tracking or unrelated web URLs, modern open-source engineering aesthetic, wide 16:9 composition.

## Image integration guidance

Use generated visuals as responsive static images with optional lightweight reveal motion.

Optimize assets and lazy-load below the fold.
