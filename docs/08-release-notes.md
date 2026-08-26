# 08 — Deterministic Release Notes

## Goal

Generate useful technical release notes without AI, subscriptions, or semantic guessing about arbitrary custom JavaScript.

## Output format

Markdown.

Default structure:

```md
# Release Notes

## Changes

### Rules
- ...

### Data Elements
- ...

### Extensions
- ...

### Runtime / Unmapped
- ...

## Dependency Impact
- ...

## Analysis Warnings
- ...
```

Omit empty sections.

## Direct-change wording

Prefer structured parser facts.

Examples:

- `Added "Search - Results" rule.`
- `Removed "Legacy Link Tracking" rule.`
- `Updated the "Adobe Analytics - Set Variables" action in "Global - Page View".`
- `Updated custom code in "Checkout - Purchase".`
- `Updated "Customer ID" data element.`
- `Added "Login State" data element.`
- `Updated configuration for "Adobe Analytics" extension.`

Do not attempt to explain arbitrary custom JavaScript business behavior.

## Data Element reference wording

When structured evidence exists:

```text
Updated eVar12 in "Global - Page View" to reference the "Customer ID" data element instead of "Legacy Customer ID".
```

If both token names changed but resolve to the same Launch Data Element ID because of a rename, describe the rename/change fact without implying a different target resource.

## Dependency Impact section

Impacted resources are unchanged resources that directly or transitively depend on modified resources.

Example:

```md
## Dependency Impact

- `Customer ID` was modified and is referenced directly or indirectly by 7 resources.
  - `Visitor Profile`
  - `Global - Page View`
  - `Purchase`
```

For large sets, use concise listing; detailed paths remain in UI.

## Analysis warnings

Always include incomplete-analysis warnings in copied/downloaded notes.

Examples:

```text
2 of 48 Compare-library resources could not be retrieved. Results may not represent every deployed change.
```

If >10% failure rate on either side:

```text
Comparison is incomplete and retry is recommended before relying on these release notes.
```

## Exclusions

Do not include ordinary build/environment metadata such as:

- build date
- environment ID/stage
- minified flag
- generated filenames/hashes
- canonical URL

unless specifically promoted by a future structured rule.

## Unmapped changes

Do not silently omit.

Example:

```text
Modified 1 unmapped library resource. Review the comparison for details.
```

## UI actions

- Preview
- Raw Markdown
- Copy
- Download `.md`
