import { describe, expect, it } from "vitest";
import {
  AnalysisAlreadyRunningError,
  AnalysisConcurrencyCoordinator,
  type BroadcastChannelLike,
  type LockManagerLike
} from "@/browser/analyzer";

describe("analysis concurrency coordinator", () => {
  it("allows only one same-origin analysis while the Web Lock is held", async () => {
    const locks = new FakeLockManager();
    const first = new AnalysisConcurrencyCoordinator({ lockManager: locks });
    const second = new AnalysisConcurrencyCoordinator({ lockManager: locks });
    let releaseFirst!: () => void;
    const firstRun = first.runExclusive(
      () => new Promise<string>((resolve) => {
        releaseFirst = () => resolve("done");
      })
    );

    await Promise.resolve();
    await expect(second.runExclusive(async () => "second")).rejects.toBeInstanceOf(
      AnalysisAlreadyRunningError
    );

    releaseFirst();
    await expect(firstRun).resolves.toBe("done");
    await expect(second.runExclusive(async () => "after-release")).resolves.toBe("after-release");
  });

  it("broadcasts status only, never source or comparison payloads", async () => {
    const channel = new FakeBroadcastChannel();
    const coordinator = new AnalysisConcurrencyCoordinator({
      channel,
      ownerId: "tab-a",
      now: () => 123
    });

    await coordinator.runExclusive(async () => "done");

    expect(channel.messages).toEqual([
      {
        kind: "analysis-status",
        state: "running",
        ownerId: "tab-a",
        updatedAt: 123
      },
      {
        kind: "analysis-status",
        state: "idle",
        ownerId: "tab-a",
        updatedAt: 123
      }
    ]);
    expect(JSON.stringify(channel.messages)).not.toContain("source");
    expect(JSON.stringify(channel.messages)).not.toContain("comparison");
  });
});

class FakeLockManager implements LockManagerLike {
  private held = false;

  async request<T>(
    _name: string,
    _options: { mode: "exclusive"; ifAvailable: true },
    callback: (lock: unknown | null) => Promise<T> | T
  ): Promise<T> {
    if (this.held) {
      return callback(null);
    }

    this.held = true;

    try {
      return await callback({});
    } finally {
      this.held = false;
    }
  }
}

class FakeBroadcastChannel implements BroadcastChannelLike {
  readonly messages: unknown[] = [];
  closed = false;

  postMessage(message: unknown): void {
    this.messages.push(message);
  }

  close(): void {
    this.closed = true;
  }
}
