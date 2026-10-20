export interface DiscordConfig {
  clientId: string;
  clientSecret: string;
  botToken?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

export interface DiscordUser { id: string; username: string }

export interface DiscordOAuth {
  enabled: boolean;
  authorizeUrl(state: string, redirectUri: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<string>;
  getUserByToken(token: string): Promise<DiscordUser>;
}

const API_VERSION = '/api/v10';

export function createDiscord(cfg: DiscordConfig): DiscordOAuth {
  const f = cfg.fetch ?? fetch;
  const base = (cfg.baseUrl ?? 'https://discord.com').replace(/\/+$/, '');
  const enabled = Boolean(cfg.clientId && cfg.clientSecret && cfg.botToken);

  async function json(res: Response, action: string): Promise<any> {
    if (!res.ok) throw new Error(`Discord ${action} failed: ${res.status}`);
    return res.json();
  }

  return {
    enabled,
    authorizeUrl(state: string, redirectUri: string): string {
      const q = new URLSearchParams({
        client_id: cfg.clientId,
        response_type: 'code',
        redirect_uri: redirectUri,
        scope: 'identify applications.commands',
        state,
        integration_type: '1',
      });
      return `${base}/oauth2/authorize?${q}`;
    },
    async exchangeCode(code: string, redirectUri: string): Promise<string> {
      const body = new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      });
      const j = await json(await f(`${base}${API_VERSION}/oauth2/token`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(5000),
      }), 'code exchange');
      if (typeof j.access_token !== 'string' || !j.access_token) throw new Error('Discord access token missing');
      return j.access_token;
    },
    async getUserByToken(token: string): Promise<DiscordUser> {
      const j = await json(await f(`${base}${API_VERSION}/users/@me`, {
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000),
      }), 'current user');
      if (typeof j.id !== 'string' || typeof j.username !== 'string') throw new Error('Discord user fields missing');
      return { id: j.id, username: j.username };
    },
  };
}
