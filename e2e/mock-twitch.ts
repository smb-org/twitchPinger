import { createServer } from 'node:http';

// Minimal Twitch stand-in: OAuth authorize/token plus the helix calls the app makes.
const users = new Map<string, string>([['1000', 'sbadmin'], ['2001', 'sbx_tv'], ['2002', 'marblemania']]);
let next = { id: '1000', login: 'sbadmin' };
const follows = [{ broadcaster_id: '2001', broadcaster_login: 'sbx_tv', broadcaster_name: 'sbx_tv' }, { broadcaster_id: '2002', broadcaster_login: 'marblemania', broadcaster_name: 'marblemania' }];
const dto = (id: string, login: string) => ({ id, login, display_name: login });

createServer(async (req, res) => {
  const u = new URL(req.url!, 'http://x');
  const send = (code: number, body: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  let raw = '';
  for await (const c of req) raw += c;

  if (u.pathname === '/mock/next-user') {
    next = JSON.parse(raw);
    users.set(next.id, next.login);
    return send(200, { ok: true });
  }
  if (u.pathname === '/oauth2/authorize') {
    const back = new URL(u.searchParams.get('redirect_uri')!);
    back.searchParams.set('code', `code-${next.id}`);
    back.searchParams.set('state', u.searchParams.get('state')!);
    res.writeHead(302, { location: back.toString() });
    return res.end();
  }
  if (u.pathname === '/oauth2/token') {
    const p = new URLSearchParams(raw);
    const code = p.get('code');
    return send(200, { access_token: code ? `tok-${code.slice(5)}` : 'tok-app', expires_in: 3600, token_type: 'bearer' });
  }
  if (u.pathname === '/helix/users') {
    const bearer = (req.headers.authorization ?? '').replace('Bearer ', '');
    if (bearer !== 'tok-app') {
      const id = bearer.slice(4);
      return users.has(id) ? send(200, { data: [dto(id, users.get(id)!)] }) : send(401, {});
    }
    const ids = u.searchParams.getAll('id');
    const logins = u.searchParams.getAll('login');
    const data = [...users].filter(([id, l]) => ids.includes(id) || logins.includes(l)).map(([id, l]) => dto(id, l));
    return send(200, { data });
  }
  if (u.pathname === '/helix/channels/followed') return send(200, { data: follows, pagination: {} });
  if (u.pathname === '/') return send(200, { ok: true });
  send(404, {});
}).listen(12175, () => console.log('mock twitch on :12175'));
