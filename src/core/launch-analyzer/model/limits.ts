export const ANALYSIS_LIMITS = {
  maxResourcesPerLibrary: 500,
  maxRecursionDepth: 20,
  maxTextResourceBytes: 10 * 1024 * 1024,
  maxBinaryResourceBytes: 25 * 1024 * 1024,
  maxTotalFetchedBytesPerLibrary: 100 * 1024 * 1024,
  browserFetchConcurrency: 6,
  proxyBatchSize: 8,
  maxRedirects: 5
} as const;
