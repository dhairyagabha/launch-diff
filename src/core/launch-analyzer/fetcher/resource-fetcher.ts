import type { FetchMetadata } from "../model/types";

export interface ResourceFetchRequest {
  url: string;
}

export type ResourceFetchBody =
  | {
      kind: "text";
      text: string;
    }
  | {
      kind: "binary";
      bytes: Uint8Array;
    };

export type ResourceFetchFailureReason =
  | "not-found"
  | "blocked"
  | "timeout"
  | "http-error"
  | "network-error"
  | "unsupported"
  | "limit";

export interface ResourceFetchFailure {
  reason: ResourceFetchFailureReason;
  retriable: boolean;
  message: string;
}

export type ResourceFetchResult =
  | {
      ok: true;
      body: ResourceFetchBody;
      metadata: FetchMetadata;
    }
  | {
      ok: false;
      failure: ResourceFetchFailure;
      metadata: FetchMetadata;
    };

export interface ResourceFetcher {
  fetchResource(request: ResourceFetchRequest): Promise<ResourceFetchResult>;
}
