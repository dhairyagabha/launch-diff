# 15 — Validation Checklist

Use this checklist for Phase 15 release-candidate validation. Automated Playwright and axe checks are required, but they do not replace a final manual accessibility and responsiveness pass.

## Required automated gates

- [ ] `npm run verify` passes.
- [ ] `npm run test:e2e` passes without screenshot drift.
- [ ] `npm run build` passes.

## Automated browser coverage

The Playwright suite must cover these LaunchDiff-owned states:

- [ ] landing page desktop product story.
- [ ] landing page mobile copy and compare-workspace handoff.
- [ ] direct URL validation.
- [ ] saved config upload and default site/environment selection.
- [ ] setup screen in light and dark themes.
- [ ] modified JavaScript split diff with line numbers, gutters, syntax, and intra-line highlights.
- [ ] added resource diff.
- [ ] removed resource diff.
- [ ] collapsed unchanged hunk and function folding behavior.
- [ ] Impacted tab.
- [ ] Resolved Files tab with failed deferred resource state.
- [ ] Release Notes preview/raw/copy/download.
- [ ] theme switching.
- [ ] Viewed state and review progress.
- [ ] next/previous resource navigation.
- [ ] desktop-required compare gate below 1024 CSS pixels.
- [ ] representative large comparison responsiveness.

## Manual keyboard pass

Run at `1440x1000` in Chrome, light and dark themes:

- [ ] Tab order enters setup mode controls, URL fields, theme controls, and primary actions predictably.
- [ ] Focus indicators are visible on all buttons, tabs, inputs, selects, toggles, resource-tree items, hunk expanders, and release-note controls.
- [ ] `?` opens keyboard help and `Escape` closes it.
- [ ] `j` / `k` move through resources without trapping focus.
- [ ] `[` / `]` move across result tabs.
- [ ] `f` focuses resource search and `Escape` clears it.
- [ ] `v` toggles Viewed on the selected reviewable resource.
- [ ] Release Notes Copy and Download are reachable and operable from the keyboard.

## Manual accessibility pass

Run before release candidate approval:

- [ ] VoiceOver or equivalent screen reader announces page landmark, workspace landmark, tabs, headings, controls, and status banners intelligibly.
- [ ] Color is not the only indicator for added, removed, modified, impacted, failed, selected, or viewed states.
- [ ] Text contrast meets WCAG 2.2 AA in light and dark themes.
- [ ] Browser zoom at 200% keeps the landing page usable and shows the compare desktop-required message below the workspace breakpoint.
- [ ] `prefers-reduced-motion` does not hide essential content or leave animated states mid-transition.
- [ ] No known keyboard trap exists in setup, diff review, resolved files, release notes, or dialogs.

## Manual visual pass

Review committed screenshots at representative desktop widths:

- [ ] `1280x900`
- [ ] `1440x1000`
- [ ] `1920x1080`

For each width, verify:

- [ ] sticky headers do not cover diff content.
- [ ] line numbers and gutters remain aligned.
- [ ] long resource names and URLs truncate or wrap cleanly.
- [ ] text does not overlap controls or neighboring content.
- [ ] the desktop-required message is polished below 1024 CSS pixels.

## Large-property responsiveness pass

Use sanitized public fixtures where possible and private fixtures only from `test-fixtures-private/`.

- [ ] Large analysis runs through the browser Worker, not the main thread.
- [ ] The UI remains responsive while progress updates stream.
- [ ] The completed large comparison accepts search, Viewed toggle, tab switching, and resource navigation without multi-second stalls.
- [ ] Accuracy rules are unchanged for performance; extra explicit differences remain preferable to risky matches.
- [ ] Private URLs, resource names, source, diffs, and release notes are not logged or persisted during validation.
