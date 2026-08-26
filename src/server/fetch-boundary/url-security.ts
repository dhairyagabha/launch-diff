import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { BoundaryFailure, ResolvedAddress, UrlValidationResult } from "./types";

export interface UrlSecurityOptions {
  resolveHostname?: (hostname: string) => Promise<ResolvedAddress[]>;
}

export async function validatePublicHttpUrl(
  rawUrl: string,
  options: UrlSecurityOptions = {}
): Promise<UrlValidationResult> {
  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    return failure("invalid-url", "URL could not be parsed.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return failure("invalid-url", "Only HTTP(S) URLs are supported.");
  }

  if (url.username || url.password) {
    return failure("invalid-url", "URLs with embedded credentials are not supported.");
  }

  if (!url.hostname) {
    return failure("invalid-url", "URL hostname is required.");
  }

  if (isBlockedHostname(url.hostname)) {
    return failure("blocked-destination", "Destination hostname is not public.");
  }

  const addresses = await resolveUrlHostname(url, options.resolveHostname);

  if (addresses.length === 0) {
    return failure("blocked-destination", "Destination did not resolve to a public address.");
  }

  if (addresses.some((address) => !isPublicIpAddress(address.address))) {
    return failure("blocked-destination", "Destination resolved to a non-public address.");
  }

  return {
    ok: true,
    url,
    addresses
  };
}

export function isUrlWithinScopes(
  rawUrl: string,
  scopes: Array<{
    origin: string;
    pathRoot: string;
  }>
): boolean {
  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  return scopes.some(
    (scope) => url.origin === scope.origin && url.pathname.startsWith(scope.pathRoot)
  );
}

export function pathRootForUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  const lastSlash = url.pathname.lastIndexOf("/");

  return lastSlash === -1 ? "/" : url.pathname.slice(0, lastSlash + 1);
}

async function resolveUrlHostname(
  url: URL,
  resolver: UrlSecurityOptions["resolveHostname"]
): Promise<ResolvedAddress[]> {
  const ipVersion = isIP(url.hostname);

  if (ipVersion === 4 || ipVersion === 6) {
    return [
      {
        address: url.hostname,
        family: ipVersion
      }
    ];
  }

  if (resolver) {
    return resolver(url.hostname);
  }

  const results = await lookup(url.hostname, {
    all: true,
    verbatim: true
  });

  return results.flatMap((result) =>
    result.family === 4 || result.family === 6
      ? [
          {
            address: result.address,
            family: result.family
          }
        ]
      : []
  );
}

function isBlockedHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");

  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "metadata.google.internal"
  );
}

function isPublicIpAddress(address: string): boolean {
  const ipVersion = isIP(address);

  if (ipVersion === 4) {
    return isPublicIpv4(address);
  }

  if (ipVersion === 6) {
    return isPublicIpv6(address);
  }

  return false;
}

function isPublicIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  const [first, second, third, fourth] = parts;

  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }

  if (first === 10 || first === 127 || first === 0 || first === 255) {
    return false;
  }

  if (first === 100 && second !== undefined && second >= 64 && second <= 127) {
    return false;
  }

  if (first === 169 && second === 254) {
    return false;
  }

  if (first === 172 && second !== undefined && second >= 16 && second <= 31) {
    return false;
  }

  if (first === 192 && second === 168) {
    return false;
  }

  if (first === 192 && second === 0 && third === 0) {
    return false;
  }

  if (first === 192 && second === 0 && third === 2) {
    return false;
  }

  if (first === 198 && (second === 18 || second === 19)) {
    return false;
  }

  if (first === 198 && second === 51 && third === 100) {
    return false;
  }

  if (first === 203 && second === 0 && third === 113) {
    return false;
  }

  if (first !== undefined && first >= 224) {
    return false;
  }

  return !(first === 169 && second === 254 && third === 169 && fourth === 254);
}

function isPublicIpv6(address: string): boolean {
  const normalized = address.toLowerCase();

  if (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("ff")
  ) {
    return false;
  }

  if (normalized.startsWith("::ffff:")) {
    return isPublicIpv4(normalized.slice("::ffff:".length));
  }

  return true;
}

function failure(category: BoundaryFailure["category"], message: string): UrlValidationResult {
  return {
    ok: false,
    category,
    message
  };
}
