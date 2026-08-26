# 01 — Product Specification

## Product name

**LaunchDiff**

Suggested compact SVG wordmark mark: `<LD/>`.

## Purpose

LaunchDiff compares two deployed Adobe Launch / Adobe Tags web libraries from the same property using their public canonical CDN URLs.

Its goal is to answer:

1. What Launch resources changed between Base and Compare?
2. What exact deployed code/configuration changed?
3. Which otherwise-unchanged resources may be impacted by those changes?
4. Were all deferred Launch resources successfully accounted for?
5. What deterministic technical release notes describe the release?

## Primary workflow

1. Open `/compare` on desktop.
2. Choose input mode:
   - Saved configuration JSON
   - Direct URLs
3. Explicitly select Base and Compare.
4. Start comparison.
5. LaunchDiff fetches both canonical libraries.
6. LaunchDiff statically parses current Launch structure.
7. LaunchDiff recursively resolves only parser-confirmed deferred Launch resources.
8. LaunchDiff normalizes presentation noise without erasing meaningful content.
9. LaunchDiff matches resources and classifies Added / Removed / Modified / Unchanged.
10. LaunchDiff calculates dependency impacts.
11. Results appear as soon as classification is available.
12. Detailed GitHub-style diffs are automatically prepared in the background.
13. User reviews resources, marks them Viewed, traverses changes, validates resolved files, and reviews impacts.
14. User copies or downloads deterministic Markdown release notes.

## Base and Compare semantics

Direction is explicit and never inferred from environment names.

- Exists only in Compare → Added
- Exists only in Base → Removed
- Same matched resource with meaningful difference → Modified
- Same matched resource with equivalent authoritative normalized content → Unchanged

Release notes describe the transition from Base to Compare.

## Input modes

### Direct URLs

User provides:

- Base public HTTP(S) Launch library URL
- Compare public HTTP(S) Launch library URL

### Saved configuration JSON

User uploads a portable config file containing sites and named environments.

No IDs are required in the file. Runtime alphanumeric IDs may be generated internally.

Example:

```json
{
  "version": 1,
  "sites": [
    {
      "name": "Example Site",
      "environments": [
        {
          "name": "Development",
          "url": "https://example.com/launch-development.min.js"
        },
        {
          "name": "Production",
          "url": "https://example.com/launch-production.min.js"
        }
      ]
    }
  ]
}
```

Config is stored in `sessionStorage` only for the active tab/session. Closing the tab/session requires re-uploading the file next time.

There is no in-app config editor in v1.

## Supported resource classes

Primary semantic buckets:

- Rules
  - Events
  - Conditions
  - Actions
  - deferred/custom code
- Data Elements
  - configured values
  - custom/deferred code
- Extensions
  - version/configuration
  - extension modules/resources where identifiable
- Library / Runtime Configuration
- Unmapped Resources
- Resolved Files technical inventory

## Resource statuses

Direct change status:

- Added
- Removed
- Modified
- Unchanged

Dependency status:

- Impacted

`Impacted` is separate from `Modified`. A resource may be unchanged yet impacted because it directly or transitively depends on a modified resource.

## Failure states

- Complete: all discoverable resources resolved.
- Complete with warnings: some resources failed, failure rate <=10% per side.
- Incomplete / retry recommended: failure rate >10% on either Base or Compare.
- Failed: canonical library could not be fetched or parsed enough to perform meaningful comparison.

Always produce usable partial comparison evidence when possible.

## Release notes

Release notes are deterministic and technical-human-readable, not AI-generated.

Include:

- direct changes
- dependency impact
- analysis warnings

Exclude ordinary build/environment metadata noise.

Support:

- Copy to clipboard
- Download `.md`
- Preview / Raw Markdown toggle

## Performance philosophy

Optimize responsiveness, not absolute wall-clock completion.

- CPU-heavy work occurs in a Web Worker.
- Classification appears before all detailed diffs finish.
- Detailed diffs automatically continue preparing after results display.
- Opening a not-yet-prepared resource reprioritizes that diff.
- Never sacrifice comparison accuracy for speed.

## Privacy philosophy

- No accounts.
- No database.
- No persistent source storage.
- No source/diff/config logging.
- No AI API.
- Minimal aggregate engagement only.

## v1 non-goals

- Adobe Launch API integration
- Adobe authentication
- historical Launch build support
- cross-property comparison
- accounts or workspace sharing
- database/history
- mobile comparison workspace
- authenticated/private URLs
- arbitrary URL crawling
- source maps
- runtime execution
- semantic-equivalence proof for arbitrary JavaScript
- top-level fuzzy resource matching
- comparison export/import
- in-app site config editor
- automatic error-reporting SaaS
- behavioral telemetry/profiling
