import {
  parseLaunchDiffConfig,
  type LaunchDiffConfig
} from "@/core/launch-analyzer";

const SESSION_CONFIG_KEY = "launchdiff.config";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function saveSessionConfig(
  config: LaunchDiffConfig,
  storage: StorageLike = sessionStorage
): void {
  storage.setItem(SESSION_CONFIG_KEY, JSON.stringify(config));
}

export function loadSessionConfig(storage: StorageLike = sessionStorage): LaunchDiffConfig | undefined {
  const raw = storage.getItem(SESSION_CONFIG_KEY);

  if (!raw) {
    return undefined;
  }

  return parseLaunchDiffConfig(JSON.parse(raw));
}

export function clearSessionConfig(storage: StorageLike = sessionStorage): void {
  storage.removeItem(SESSION_CONFIG_KEY);
}
