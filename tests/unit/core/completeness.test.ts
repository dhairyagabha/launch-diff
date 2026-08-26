import { describe, expect, it } from "vitest";
import { calculateCompleteness } from "@/core/launch-analyzer";

describe("analysis completeness", () => {
  it("reports complete when every discovered resource resolves", () => {
    expect(calculateCompleteness({ discovered: 10, resolved: 10, failed: 0 })).toMatchObject({
      state: "complete",
      failureRate: 0
    });
  });

  it("reports warnings when failures are present but at or below ten percent", () => {
    expect(calculateCompleteness({ discovered: 10, resolved: 9, failed: 1 })).toMatchObject({
      state: "complete-with-warnings",
      failureRate: 0.1
    });
  });

  it("recommends retry when failures exceed ten percent", () => {
    expect(calculateCompleteness({ discovered: 10, resolved: 8, failed: 2 })).toMatchObject({
      state: "incomplete-retry-recommended",
      failureRate: 0.2
    });
  });

  it("treats canonical failure as failed regardless of resource counts", () => {
    expect(
      calculateCompleteness({ discovered: 0, resolved: 0, failed: 0, canonicalFailed: true })
    ).toMatchObject({
      state: "failed"
    });
  });
});
