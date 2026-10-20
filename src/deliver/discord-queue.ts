const DISCORD_REQUEST_INTERVAL_MS = 40;

export interface DiscordRequestQueue {
  request<T>(operation: () => Promise<T>, onResult?: (result: T) => void): Promise<T>;
  pause(ms: number): void;
}

export function createDiscordRequestQueue(options: { now?: () => number; sleep?: (ms: number) => Promise<void> } = {}): DiscordRequestQueue {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let tail: Promise<void> = Promise.resolve();
  let nextRequestAt = 0;
  let pausedUntil = 0;

  async function waitForTurn(): Promise<void> {
    while (true) {
      const delay = Math.max(nextRequestAt, pausedUntil) - now();
      if (delay <= 0) return;
      await sleep(delay);
    }
  }

  return {
    request<T>(operation: () => Promise<T>, onResult?: (result: T) => void): Promise<T> {
      const result = tail.then(async () => {
        await waitForTurn();
        nextRequestAt = now() + DISCORD_REQUEST_INTERVAL_MS;
        const value = await operation();
        onResult?.(value);
        return value;
      });
      tail = result.then(() => undefined, () => undefined);
      return result;
    },
    pause(ms) {
      if (ms > 0) pausedUntil = Math.max(pausedUntil, now() + ms);
    },
  };
}

export const sharedDiscordRequestQueue = createDiscordRequestQueue();
