# Privacy

LaunchDiff is designed to compare public deployed Adobe Launch / Adobe Tags libraries without accounts, databases, server-side history, or AI services.

## Data You Provide

You may provide:

- public Base and Compare library URLs.
- an optional site configuration JSON containing site names, environment names, and public library URLs.

The configuration file is stored only in browser `sessionStorage` for the active tab/session. Closing the tab/session requires re-uploading it.

## Fetching

Canonical library URLs are fetched through the deployed server boundary. Parser-confirmed deferred Launch resources are fetched through a token-scoped server endpoint.

Library source passes transiently through that server boundary so the browser Worker can analyze it. LaunchDiff does not intentionally persist library source.

## What LaunchDiff Does Not Intentionally Persist Or Log

LaunchDiff does not intentionally persist or log:

- library source.
- library URLs in application logs.
- uploaded site configuration.
- resource names.
- diffs.
- comparison results.
- release notes.
- sanitized diagnostic report contents.

## Diagnostics

Diagnostic reports are user-controlled. They are copied only when you choose the diagnostic action and are designed to exclude URLs, names, source, config, diffs, and release notes.

## Aggregate Usage

Minimal aggregate engagement may be collected to understand usage volume, such as aggregate page traffic and request counts for `/api/analysis/start`.

LaunchDiff does not intentionally create persistent visitor identifiers or behavioral event streams in v1.

## Hosting Provider Logs

The hosting provider may retain infrastructure-level information, such as IP address, timestamp, user agent, request path, status code, and platform logs according to its own policies. Configure production logging to avoid source, config, diff, and release-note content.

## Third Parties

LaunchDiff does not require Adobe authentication, Adobe API access, accounts, databases, AI APIs, or automatic client-side error-reporting SaaS for v1.
