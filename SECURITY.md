# Security Policy

LaunchDiff compares public deployed Adobe Launch / Adobe Tags libraries. Its security model is intentionally narrow: fetched JavaScript is treated as data, never as executable code.

## Supported Versions

Security fixes are applied to the `main` branch until versioned releases are introduced.

## Reporting A Vulnerability

Please do not open a public issue for suspected vulnerabilities. Use the repository's private vulnerability reporting feature if available, or contact the maintainers through a private channel listed by the project owner.

Include:

- affected route or feature.
- reproduction steps using sanitized public URLs or synthetic fixtures.
- expected and observed behavior.
- impact assessment.

Do not include private Launch library source, private URLs, private site configuration, diffs, release notes, credentials, cookies, tokens, or customer data.

## Security Boundaries

- LaunchDiff accepts public anonymous HTTP(S) library URLs only.
- Canonical fetches go through `/api/analysis/start`.
- Deferred fetches go through `/api/fetch` with a short-lived signed token scoped to parser-confirmed Launch resources.
- SSRF controls block localhost, private, loopback, link-local, reserved, metadata, unsupported protocol, and invalid redirect targets.
- Redirect destinations are revalidated before content is returned.
- Resource size, total byte, depth, count, timeout, and retry limits are enforced.
- Fetched JavaScript is never evaluated through `eval`, `Function`, VM execution, script injection, or browser execution.
- Source maps, pixels, analytics endpoints, arbitrary external scripts, and arbitrary URLs found in strings/comments are not recursively fetched.

## Sanitization Expectations

Issues, pull requests, fixtures, screenshots, and diagnostics must be sanitized before publication.

Allowed diagnostic data:

- LaunchDiff version.
- browser family/version.
- analysis mode/state.
- resolved/failed counts.
- failure categories.
- parser support/degradation state.
- generic provenance/confidence summaries.

Forbidden diagnostic data:

- URLs.
- resource, site, property, or environment names.
- source code.
- uploaded configuration.
- diffs.
- release notes.
- credentials, cookies, tokens, or private identifiers.
