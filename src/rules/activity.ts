export const ACTIVITY_WINDOW_MS = 10 * 60_000;
const CHATTER_LIMIT = 10_000;

export function createActivityTracker(now: () => number) {
  const channels = new Map<string, Map<string, number>>();
  const prunedAt = new Map<string, number>();
  const prune = (entries: Map<string, number>, t: number) => {
    for (const [id, seenAt] of entries) if (seenAt <= t - ACTIVITY_WINDOW_MS) entries.delete(id);
  };
  return {
    record(channelId: string, userId: string, text: string): void {
      if (text.trimStart().startsWith('!')) return;
      const t = now();
      let entries = channels.get(channelId);
      if (!entries) channels.set(channelId, (entries = new Map()));
      if (entries.size >= CHATTER_LIMIT && t - (prunedAt.get(channelId) ?? -ACTIVITY_WINDOW_MS) >= 60_000) {
        prune(entries, t);
        prunedAt.set(channelId, t);
      }
      if (entries.size < CHATTER_LIMIT || entries.has(userId)) entries.set(userId, t);
    },
    count(channelId: string): number {
      const entries = channels.get(channelId);
      if (!entries) return 0;
      const t = now();
      prune(entries, t);
      prunedAt.set(channelId, t);
      return entries.size;
    },
  };
}
