export const ACTIVITY_WINDOW_MS = 10 * 60_000;
const CHATTER_LIMIT = 10_000;

export function createActivityTracker(now: () => number) {
  const channels = new Map<string, Map<string, number>>();
  let lastSweepAt = Number.NEGATIVE_INFINITY;
  const prune = (entries: Map<string, number>, t: number) => {
    for (const [id, seenAt] of entries) if (seenAt <= t - ACTIVITY_WINDOW_MS) entries.delete(id);
  };
  const sweep = (t: number) => {
    if (t - lastSweepAt < 60_000) return;
    lastSweepAt = t;
    for (const [channelId, entries] of channels) {
      prune(entries, t);
      if (!entries.size) channels.delete(channelId);
    }
  };
  return {
    record(channelId: string, userId: string, text: string): void {
      const t = now();
      sweep(t);
      if (text.trimStart().startsWith('!')) return;
      let entries = channels.get(channelId);
      if (!entries) channels.set(channelId, (entries = new Map()));
      if (entries.size < CHATTER_LIMIT || entries.has(userId)) entries.set(userId, t);
    },
    count(channelId: string): number {
      const entries = channels.get(channelId);
      if (!entries) return 0;
      const t = now();
      prune(entries, t);
      if (!entries.size) channels.delete(channelId);
      return entries.size;
    },
    retain(channelIds: Iterable<string>): void {
      const retained = new Set(channelIds);
      for (const channelId of channels.keys()) if (!retained.has(channelId)) channels.delete(channelId);
    },
    channelCount(): number { return channels.size; },
  };
}
