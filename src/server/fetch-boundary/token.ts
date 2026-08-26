import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { AnalysisTokenPayload } from "./types";

const TOKEN_VERSION = 1;
const DEFAULT_TOKEN_TTL_MS = 15 * 60 * 1000;

export interface CreateAnalysisTokenInput {
  allowedScopes: AnalysisTokenPayload["allowedScopes"];
  secret: string;
  now?: number;
  ttlMs?: number;
  nonce?: string;
}

export interface VerifyAnalysisTokenInput {
  token: string;
  secret: string;
  now?: number;
}

export type VerifyAnalysisTokenResult =
  | {
      ok: true;
      payload: AnalysisTokenPayload;
    }
  | {
      ok: false;
      reason: "malformed" | "signature" | "expired";
    };

export function createAnalysisToken(input: CreateAnalysisTokenInput): string {
  const payload: AnalysisTokenPayload = {
    version: TOKEN_VERSION,
    expiresAt: (input.now ?? Date.now()) + (input.ttlMs ?? DEFAULT_TOKEN_TTL_MS),
    allowedScopes: input.allowedScopes,
    nonce: input.nonce ?? randomBytes(16).toString("base64url")
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = signPayload(encodedPayload, input.secret);

  return `${encodedPayload}.${signature}`;
}

export function verifyAnalysisToken(
  input: VerifyAnalysisTokenInput
): VerifyAnalysisTokenResult {
  const [encodedPayload, signature, extra] = input.token.split(".");

  if (!encodedPayload || !signature || extra !== undefined) {
    return {
      ok: false,
      reason: "malformed"
    };
  }

  const expectedSignature = signPayload(encodedPayload, input.secret);

  if (!safeEqual(signature, expectedSignature)) {
    return {
      ok: false,
      reason: "signature"
    };
  }

  let payload: AnalysisTokenPayload;

  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload)) as AnalysisTokenPayload;
  } catch {
    return {
      ok: false,
      reason: "malformed"
    };
  }

  if (
    payload.version !== TOKEN_VERSION ||
    !Array.isArray(payload.allowedScopes) ||
    typeof payload.expiresAt !== "number" ||
    typeof payload.nonce !== "string"
  ) {
    return {
      ok: false,
      reason: "malformed"
    };
  }

  if (payload.expiresAt <= (input.now ?? Date.now())) {
    return {
      ok: false,
      reason: "expired"
    };
  }

  return {
    ok: true,
    payload
  };
}

export function serverTokenSecret(): string | undefined {
  return process.env.LAUNCHDIFF_TOKEN_SECRET;
}

function signPayload(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}
