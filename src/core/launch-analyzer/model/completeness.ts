import type { AnalysisCompleteness, AnalysisCompletenessState } from "./types";

export interface CalculateCompletenessInput {
  discovered: number;
  resolved: number;
  failed: number;
  limitReached?: boolean;
  canonicalFailed?: boolean;
}

export function calculateCompleteness(input: CalculateCompletenessInput): AnalysisCompleteness {
  const discovered = nonNegativeInteger(input.discovered, "discovered");
  const resolved = nonNegativeInteger(input.resolved, "resolved");
  const failed = nonNegativeInteger(input.failed, "failed");

  if (resolved + failed > discovered) {
    throw new Error("Resolved and failed counts cannot exceed discovered resources.");
  }

  const failureRate = discovered === 0 ? 0 : failed / discovered;
  const state = completenessState({
    canonicalFailed: input.canonicalFailed ?? false,
    failed,
    failureRate,
    limitReached: input.limitReached ?? false
  });

  return {
    state,
    discovered,
    resolved,
    failed,
    failureRate,
    ...(input.limitReached === undefined ? {} : { limitReached: input.limitReached })
  };
}

function completenessState(input: {
  canonicalFailed: boolean;
  failed: number;
  failureRate: number;
  limitReached: boolean;
}): AnalysisCompletenessState {
  if (input.canonicalFailed) {
    return "failed";
  }

  if (input.limitReached || input.failureRate > 0.1) {
    return "incomplete-retry-recommended";
  }

  if (input.failed > 0) {
    return "complete-with-warnings";
  }

  return "complete";
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }

  return value;
}
