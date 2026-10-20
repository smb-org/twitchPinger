export interface TwitchConfig {
  clientId: string;
  clientSecret: string;
  authBase: string;
  helixBase: string;
  fetch?: typeof fetch;
  now?: () => number;
}

export interface TwitchUser { id: string; login: string; displayName: string; avatarUrl: string | null }

const FOLLOW_CAP = 500;

export type Twitch = ReturnType<typeof createTwitch>;

export function createTwitch(cfg: TwitchConfig) {
  const f = cfg.fetch ?? fetch;
  const now = cfg.now ?? Date.now;
  let app: { token: string; expiresAt: number } | null = null;

  async function json(res: Response, what: string): Promise<any> {
    if (!res.ok) throw new Error(`twitch ${what} failed: ${res.status}`);
    return res.json();
  }

  async function appToken(): Promise<string> {
    if (app && app.expiresAt > now() + 60_000) return app.token;
    const body = new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: 'client_credentials' });
    const j = await json(await f(`${cfg.authBase}/oauth2/token`, { method: 'POST', body }), 'app token');
    app = { token: j.access_token, expiresAt: now() + j.expires_in * 1000 };
    return app.token;
  }

  const toUser = (u: any): TwitchUser => ({
    id: String(u.id), login: String(u.login), displayName: String(u.display_name),
    avatarUrl: typeof u.profile_image_url === 'string' && u.profile_image_url ? u.profile_image_url : null,
  });

  async function helix(path: string, token: string): Promise<any> {
    return json(await f(`${cfg.helixBase}${path}`, { headers: { Authorization: `Bearer ${token}`, 'Client-Id': cfg.clientId } }), path);
  }

  async function users(query: string): Promise<TwitchUser[]> {
    const j = await helix(`/users?${query}`, await appToken());
    return (j.data as any[]).map(toUser);
  }

  return {
    authorizeUrl(state: string, redirectUri: string): string {
      const q = new URLSearchParams({ client_id: cfg.clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'user:read:follows', state });
      return `${cfg.authBase}/oauth2/authorize?${q}`;
    },
    async exchangeCode(code: string, redirectUri: string): Promise<string> {
      const body = new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, code, grant_type: 'authorization_code', redirect_uri: redirectUri });
      const j = await json(await f(`${cfg.authBase}/oauth2/token`, { method: 'POST', body }), 'code exchange');
      return j.access_token as string;
    },
    async getUserByToken(token: string): Promise<TwitchUser> {
      const j = await helix('/users', token);
      if (!j.data?.[0]) throw new Error('twitch user missing');
      return toUser(j.data[0]);
    },
    /** Followed channels, capped at 500. */
    async getFollowedChannels(token: string, userId: string): Promise<TwitchUser[]> {
      const out: TwitchUser[] = [];
      let cursor = '';
      while (out.length < FOLLOW_CAP) {
        const j = await helix(`/channels/followed?user_id=${encodeURIComponent(userId)}&first=100${cursor ? `&after=${encodeURIComponent(cursor)}` : ''}`, token);
        for (const c of j.data as any[]) out.push({ id: String(c.broadcaster_id), login: String(c.broadcaster_login), displayName: String(c.broadcaster_name), avatarUrl: null });
        cursor = j.pagination?.cursor ?? '';
        if (!cursor || !(j.data as any[]).length) break;
      }
      return out.slice(0, FOLLOW_CAP);
    },
    async getUsersByLogin(logins: string[]): Promise<TwitchUser[]> {
      const out: TwitchUser[] = [];
      for (let i = 0; i < logins.length; i += 100) out.push(...await users(logins.slice(i, i + 100).map((l) => `login=${encodeURIComponent(l)}`).join('&')));
      return out;
    },
    async getUsersById(ids: string[]): Promise<TwitchUser[]> {
      const out: TwitchUser[] = [];
      for (let i = 0; i < ids.length; i += 100) out.push(...await users(ids.slice(i, i + 100).map((l) => `id=${encodeURIComponent(l)}`).join('&')));
      return out;
    },
  };
}
