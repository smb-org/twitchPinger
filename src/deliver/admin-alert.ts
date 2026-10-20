import { toNtfy } from './format.ts';
import { trustedPost } from './ssrf.ts';

// The URL is operator config (often the internal ntfy service), so it defaults to trustedPost, not the SSRF-guarded post.
export function createAdminAlert(deps: { url: string | null; token: string | null; post?: typeof trustedPost }) {
  const post = deps.post ?? trustedPost;
  return {
    async send(title: string, text: string): Promise<void> {
      if (!deps.url) return;
      try {
        const { headers, body } = toNtfy({ title, text, url: '' }, 'high');
        delete headers.Click;
        if (deps.token) headers.Authorization = `Bearer ${deps.token}`;
        await post(deps.url, { headers, body, timeoutMs: 5000 });
      } catch { /* alerts must never throw */ }
    },
  };
}
