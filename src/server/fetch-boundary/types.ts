export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export interface UrlValidationOk {
  ok: true;
  url: URL;
  addresses: ResolvedAddress[];
}

export interface BoundaryFailure {
  ok: false;
  category:
    | "invalid-json"
    | "invalid-token"
    | "invalid-url"
    | "blocked-destination"
    | "redirect-limit"
    | "response-too-large"
    | "unsupported-content"
    | "http-error"
    | "timeout"
    | "network-error"
    | "token-scope"
    | "batch-limit";
  message: string;
  httpStatus?: number;
  attempts?: number;
}

export type UrlValidationResult = UrlValidationOk | BoundaryFailure;

export interface PublicFetchMetadata {
  requestedUrl: string;
  finalUrl?: string;
  httpStatus?: number;
  contentType?: string;
  byteLength?: number;
  attempts: number;
  redirects: string[];
}

export interface PublicFetchOk {
  ok: true;
  source: string;
  metadata: PublicFetchMetadata;
}

export interface PublicFetchFailure extends BoundaryFailure {
  requestedUrl: string;
  metadata: PublicFetchMetadata;
}

export type PublicFetchResult = PublicFetchOk | PublicFetchFailure;

export interface AllowedFetchScope {
  origin: string;
  pathRoot: string;
}

export interface AnalysisTokenPayload {
  version: 1;
  expiresAt: number;
  allowedScopes: AllowedFetchScope[];
  nonce: string;
}

export interface StartAnalysisRequestBody {
  baseUrl: string;
  compareUrl: string;
}

export interface FetchBatchRequestBody {
  token: string;
  urls: string[];
}
