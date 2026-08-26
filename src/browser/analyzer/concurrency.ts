const ANALYSIS_LOCK_NAME = "launch-library-analysis";
const ANALYSIS_CHANNEL_NAME = "launchdiff-analysis-status";

export interface LockManagerLike {
  request<T>(
    name: string,
    options: {
      mode: "exclusive";
      ifAvailable: true;
    },
    callback: (lock: unknown | null) => Promise<T> | T
  ): Promise<T>;
}

export interface BroadcastChannelLike {
  postMessage(message: unknown): void;
  close(): void;
}

export interface AnalysisStatusMessage {
  kind: "analysis-status";
  state: "running" | "idle";
  ownerId: string;
  updatedAt: number;
}

export class AnalysisAlreadyRunningError extends Error {
  constructor() {
    super("Another analysis is already running in this browser origin.");
    this.name = "AnalysisAlreadyRunningError";
  }
}

export class AnalysisConcurrencyCoordinator {
  constructor(
    private readonly options: {
      lockManager?: LockManagerLike;
      channel?: BroadcastChannelLike;
      ownerId?: string;
      now?: () => number;
    } = {}
  ) {}

  async runExclusive<T>(task: () => Promise<T>): Promise<T> {
    const lockManager = this.options.lockManager;

    if (!lockManager) {
      return this.runWithStatus(task);
    }

    const result = await lockManager.request(
      ANALYSIS_LOCK_NAME,
      {
        mode: "exclusive",
        ifAvailable: true
      },
      async (lock) => {
        if (!lock) {
          return {
            acquired: false as const
          };
        }

        return {
          acquired: true as const,
          value: await this.runWithStatus(task)
        };
      }
    );

    if (!result.acquired) {
      throw new AnalysisAlreadyRunningError();
    }

    return result.value;
  }

  close(): void {
    this.options.channel?.close();
  }

  private async runWithStatus<T>(task: () => Promise<T>): Promise<T> {
    this.publish("running");

    try {
      return await task();
    } finally {
      this.publish("idle");
    }
  }

  private publish(state: AnalysisStatusMessage["state"]): void {
    this.options.channel?.postMessage({
      kind: "analysis-status",
      state,
      ownerId: this.options.ownerId ?? "current-tab",
      updatedAt: this.options.now?.() ?? Date.now()
    } satisfies AnalysisStatusMessage);
  }
}

export function createBrowserAnalysisConcurrencyCoordinator(): AnalysisConcurrencyCoordinator {
  const lockManager = (globalThis.navigator as (Navigator & { locks?: LockManagerLike }) | undefined)
    ?.locks;
  const channel =
    typeof BroadcastChannel === "undefined"
      ? undefined
      : new BroadcastChannel(ANALYSIS_CHANNEL_NAME);

  return new AnalysisConcurrencyCoordinator({
    lockManager,
    channel
  });
}
