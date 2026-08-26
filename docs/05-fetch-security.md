# 05 — Fetching, Resolution, Security, and Limits

## Supported network model

v1 supports anonymous/public HTTP(S) only.

Not supported:

- authenticated URLs
- browser-cookie forwarding
- Authorization headers
- private/VPN-only hosts
- client certificates

## Canonical handshake

`POST /api/analysis/start` receives Base and Compare URLs.

Server:

1. parse/validate URL
2. reject unsupported protocols
3. reject embedded credentials
4. resolve DNS
5. reject private/reserved/loopback/link-local/metadata destinations
6. fetch canonical artifact
7. revalidate every redirect destination
8. enforce redirect cap and response size
9. perform shallow plausibility validation
10. determine allowed origin/path roots
11. issue signed short-lived analysis token
12. return both sources + metadata + token

The server must not duplicate the authoritative Launch parser.

## Signed analysis token

Use a stateless HMAC/JWT-like signed payload with a Vercel environment secret.

Payload may include:

- allowed origin(s)
- allowed root path(s)
- expiry
- random nonce/session identifier if useful

No database/Redis/session store required.

Recursive `/api/fetch` calls must present the token.

## Prevent generic proxy use

The fetch endpoint must not accept arbitrary unrestricted public URLs.

Every URL must:

- fall within token-authorized origin/root scope
- pass SSRF/public-network validation
- pass redirect validation
- satisfy response limits

## Recursive discovery boundary

The browser worker may request only URLs positively identified by the Launch parser as deferred Launch resources.

Do not recurse into:

- tracking pixels
- fetch/XHR endpoints
- analytics beacons
- images
- arbitrary external scripts
- URLs in comments
- URLs in arbitrary strings
- source maps

Those URLs still remain comparison content when present in code/config.

## Browser-driven wave resolution

1. Parse canonical library.
2. Discover deferred Launch resource URLs.
3. Deduplicate.
4. Send a small batch to `/api/fetch`.
5. Parse returned resources.
6. Discover newly referenced deferred Launch resources.
7. Repeat until no new eligible resources or limit reached.

## Batch fetching

Use small batches, recommended 6–10 URLs.

Server fetch concurrency should be bounded.

Return a granular result per URL so one failure does not fail the entire batch.

## Retries

Automatic retry exactly once for transient errors:

- timeout
- 429
- 5xx

No automatic retry for deterministic errors such as:

- 404
- 403
- invalid URL
- blocked destination
- unsupported content

Manual `Retry Failed Resources` retries all remaining failed eligible resources and then resolves any newly discovered deferred dependencies.

`Refresh Libraries` invalidates Base/Compare cache and reconstructs both from scratch.

## Failure threshold

Evaluate independently for Base and Compare.

```text
failureRate = failedDiscoveredResources / discoveredResources
```

- 0% → Complete
- >0% and <=10% → Complete with warnings
- >10% → Incomplete / retry recommended

Still produce comparison when possible.

## Missing counterpart due to fetch failure

Never classify a resource as Added/Removed solely because its counterpart could not be fetched.

Use an Unknown/Unresolved state or warning when evidence is insufficient.

## Safety limits

Recommended centralized initial constants:

```ts
export const ANALYSIS_LIMITS = {
  maxResourcesPerLibrary: 500,
  maxRecursionDepth: 20,
  maxTextResourceBytes: 10 * 1024 * 1024,
  maxBinaryResourceBytes: 25 * 1024 * 1024,
  maxTotalFetchedBytesPerLibrary: 100 * 1024 * 1024,
  browserFetchConcurrency: 6,
  proxyBatchSize: 8,
  maxRedirects: 5
};
```

These are safety caps, not assumptions about normal Launch builds.

If a limit is hit:

- stop the affected expansion path
- mark incomplete analysis
- record specific reason
- keep available comparison
- never silently truncate

## Deduplication

Deduplicate physical artifacts by authoritative resolved/final URL where safe.

Retain requested URL aliases.

Shared resource is fetched once but keeps all ownership edges.

## Privacy/logging

Application code must not intentionally log:

- URLs
- source contents
- resource names
- config contents
- diffs
- release notes

Operational logging may contain generic categories, status groups, sizes, and timings where needed.

## Minimal aggregate engagement

Allowed:

- aggregate landing traffic
- aggregate `/compare` traffic
- aggregate `/api/analysis/start` count
- aggregate generic server error/usage counts

Forbidden:

- custom user/session profiling
- persistent visitor IDs
- compared URLs
- resource names
- search terms
- Viewed behavior
- copy/download event tracking
- diff contents
