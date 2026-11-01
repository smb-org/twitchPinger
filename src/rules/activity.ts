export const ACTIVITY_WINDOW_MS = 30 * 60_000; // longest selectable window; users are kept this long
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
      // Map order doubles as LRU: re-insert moves a user to the end, a full map drops the oldest.
      if (!entries.delete(userId) && entries.size >= CHATTER_LIMIT) entries.delete(entries.keys().next().value!);
      entries.set(userId, t);
    },
    count(channelId: string, windowMin = 10): number {
      const entries = channels.get(channelId);
      if (!entries) return 0;
      const t = now();
      prune(entries, t);
      if (!entries.size) channels.delete(channelId);
      let n = 0;
      for (const seenAt of entries.values()) if (seenAt > t - windowMin * 60_000) n++;
      return n;
    },
    retain(channelIds: Iterable<string>): void {
      const retained = new Set(channelIds);
      for (const channelId of channels.keys()) if (!retained.has(channelId)) channels.delete(channelId);
    },
    channelCount(): number { return channels.size; },
  };
}
