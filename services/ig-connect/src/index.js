/* LockIn Instagram connect service: a small Cloudflare Worker that does the OAuth dance for the
 * Instagram API with Instagram Login (scope instagram_business_basic) so the app never sees the
 * app secret or a long-lived token. Skeleton for Phase 2; not deployed. See README.md.
 *
 *   GET  /auth/start?return=<app url>   send the user to Instagram
 *   GET  /auth/callback                 swap the code for a token, redirect to <return>#ig=<one-time code>
 *   GET  /api/profile?code=<code>       first fetch: consumes the code, returns the profile and a session id
 *   GET  /api/profile?session=<id>      refresh with a stored session
 *   POST /api/disconnect?session=<id>   forget the stored token
 *
 * Bindings: SESSIONS (KV). Secrets: IG_APP_ID, IG_APP_SECRET, STATE_SECRET, TOKEN_ENC_KEY.
 * Vars: ALLOWED_RETURN_ORIGINS (comma separated, e.g. "https://jash.github.io"). Secrets are
 * set with `wrangler secret put`, never committed. Tokens are encrypted at rest by KV and again
 * with AES-GCM before they are written (PRD rule 4). */

const IG_AUTHORIZE = 'https://www.instagram.com/oauth/authorize';
const IG_TOKEN = 'https://api.instagram.com/oauth/access_token';
const IG_GRAPH = 'https://graph.instagram.com';
const SCOPE = 'instagram_business_basic';
const ACCOUNT_TYPES = ['BUSINESS', 'MEDIA_CREATOR'];
const STATE_TTL_MS = 10 * 60 * 1000;
const CODE_TTL_S = 600;
const SESSION_TTL_S = 60 * 24 * 60 * 60; // long-lived Instagram tokens last 60 days
const PROFILE_FIELDS = 'user_id,username,name,account_type,biography,profile_picture_url,followers_count,follows_count,media_count';
const MEDIA_FIELDS = 'id,caption,media_type,permalink,timestamp,like_count,comments_count';

const enc = new TextEncoder(), dec = new TextDecoder();

// ---------- pure helpers (unit tested) ----------

export function b64urlEncode(bytes) {
  let s = '';
  new Uint8Array(bytes).forEach(b => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(text) {
  const b = atob(String(text).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(b, c => c.charCodeAt(0));
}

export function randomId(bytes = 24) { return b64urlEncode(crypto.getRandomValues(new Uint8Array(bytes))); }

function parseOrigins(list) {
  return String(list || '').split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean);
}

/* True when `returnUrl` is an absolute https URL (http only for localhost) whose origin is on the
 * allow list. Keeps the callback from becoming an open redirect. */
export function isAllowedReturn(returnUrl, allowed) {
  let u;
  try { u = new URL(String(returnUrl)); } catch (e) { return false; }
  if (u.username || u.password) return false;
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return false;
  return parseOrigins(allowed).includes(u.origin);
}

async function hmacKey(secret, usage) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, usage);
}

/* A value the callback can trust without a database: base64url(json).base64url(hmac). It carries
 * the return URL, a random nonce and an expiry. */
export async function signState(secret, returnUrl, now = Date.now()) {
  const body = b64urlEncode(enc.encode(JSON.stringify({ r: returnUrl, n: randomId(9), e: now + STATE_TTL_MS })));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret, ['sign']), enc.encode(body));
  return body + '.' + b64urlEncode(sig);
}

/* Returns the return URL, or null when the signature, shape or expiry is wrong. */
export async function verifyState(secret, state, now = Date.now()) {
  const [body, sig, extra] = String(state || '').split('.');
  if (!body || !sig || extra !== undefined) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret, ['verify']), b64urlDecode(sig), enc.encode(body));
    if (!ok) return null;
    const v = JSON.parse(dec.decode(b64urlDecode(body)));
    return typeof v.r === 'string' && typeof v.e === 'number' && v.e > now ? v.r : null;
  } catch (e) { return null; }
}

async function aesKey(keyB64) {
  const raw = b64urlDecode(keyB64);
  if (raw.length !== 32) throw new Error('TOKEN_ENC_KEY must be 32 random bytes, base64url encoded');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptToken(keyB64, plain) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(keyB64), enc.encode(plain)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv); out.set(ct, iv.length);
  return b64urlEncode(out);
}

export async function decryptToken(keyB64, sealed) {
  const raw = b64urlDecode(sealed);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, await aesKey(keyB64), raw.slice(12));
  return dec.decode(plain);
}

export function corsHeaders(origin, allowed) {
  const h = { vary: 'Origin' };
  if (origin && parseOrigins(allowed).includes(origin)) {
    h['access-control-allow-origin'] = origin;
    h['access-control-allow-methods'] = 'GET, POST, OPTIONS';
    h['access-control-allow-headers'] = 'content-type';
  }
  return h;
}

// ---------- handlers ----------

function json(body, status, cors) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors } });
}

function redirectBack(returnUrl, fragment) {
  const u = new URL(returnUrl);
  u.hash = fragment;
  return new Response(null, { status: 302, headers: { location: u.toString(), 'cache-control': 'no-store' } });
}

async function igGet(path, params) {
  const res = await fetch(`${IG_GRAPH}${path}?${new URLSearchParams(params)}`);
  if (!res.ok) { const e = new Error('instagram ' + res.status); e.status = res.status; throw e; }
  return res.json();
}

async function authStart(url, env) {
  const back = url.searchParams.get('return');
  if (!isAllowedReturn(back, env.ALLOWED_RETURN_ORIGINS)) return new Response('return URL is not allowed', { status: 400 });
  const q = new URLSearchParams({
    client_id: env.IG_APP_ID, redirect_uri: `${url.origin}/auth/callback`, scope: SCOPE, response_type: 'code',
    state: await signState(env.STATE_SECRET, back)
  });
  return Response.redirect(`${IG_AUTHORIZE}?${q}`, 302);
}

async function authCallback(url, env) {
  const back = await verifyState(env.STATE_SECRET, url.searchParams.get('state'));
  if (!back || !isAllowedReturn(back, env.ALLOWED_RETURN_ORIGINS)) return new Response('Invalid or expired state. Start again from the app.', { status: 400 });
  const code = url.searchParams.get('code');
  if (!code) return redirectBack(back, 'ig_error=' + encodeURIComponent(url.searchParams.get('error') || 'denied'));
  try {
    const short = await fetch(IG_TOKEN, {
      method: 'POST',
      body: new URLSearchParams({ client_id: env.IG_APP_ID, client_secret: env.IG_APP_SECRET, grant_type: 'authorization_code', redirect_uri: `${url.origin}/auth/callback`, code })
    });
    if (!short.ok) return redirectBack(back, 'ig_error=exchange_failed');
    const { access_token } = await short.json();
    const long = await igGet('/access_token', { grant_type: 'ig_exchange_token', client_secret: env.IG_APP_SECRET, access_token });
    const oneTime = randomId();
    await env.SESSIONS.put('code:' + oneTime, await encryptToken(env.TOKEN_ENC_KEY, long.access_token), { expirationTtl: CODE_TTL_S });
    return redirectBack(back, 'ig=' + oneTime);
  } catch (e) {
    return redirectBack(back, 'ig_error=exchange_failed');
  }
}

async function fetchProfile(token) {
  const me = await igGet('/me', { fields: PROFILE_FIELDS, access_token: token });
  if (!ACCOUNT_TYPES.includes(me.account_type)) return { me, media: null };
  let media = [];
  try { media = (await igGet('/me/media', { fields: MEDIA_FIELDS, limit: '30', access_token: token })).data || []; } catch (e) { /* profile alone is still useful */ }
  return { me, media };
}

function shape(me, media, session) {
  const { username, name, account_type, biography, profile_picture_url, followers_count, follows_count, media_count } = me;
  return { username, name, account_type, biography, profile_picture_url, followers_count, follows_count, media_count, media, session };
}

async function apiProfile(url, env, cors) {
  const code = url.searchParams.get('code'), session = url.searchParams.get('session');
  let token, sessionId = session;
  if (code) {
    const sealed = await env.SESSIONS.get('code:' + code);
    if (!sealed) return json({ error: 'expired' }, 401, cors);
    await env.SESSIONS.delete('code:' + code); // one use only
    token = await decryptToken(env.TOKEN_ENC_KEY, sealed);
  } else if (session) {
    const sealed = await env.SESSIONS.get('sess:' + session);
    if (!sealed) return json({ error: 'expired' }, 401, cors);
    token = await decryptToken(env.TOKEN_ENC_KEY, sealed);
  } else return json({ error: 'missing code or session' }, 400, cors);

  let result;
  try { result = await fetchProfile(token); } catch (e) {
    if (session && (e.status === 400 || e.status === 401)) await env.SESSIONS.delete('sess:' + session);
    return json({ error: e.status === 400 || e.status === 401 ? 'expired' : 'instagram' }, e.status === 400 || e.status === 401 ? 401 : 502, cors);
  }
  if (!result.media) return json({ error: 'account_type', account_type: result.me.account_type }, 422, cors); // token is dropped, never stored
  if (code) {
    sessionId = randomId();
    await env.SESSIONS.put('sess:' + sessionId, await encryptToken(env.TOKEN_ENC_KEY, token), { expirationTtl: SESSION_TTL_S });
  }
  return json(shape(result.me, result.media, sessionId), 200, cors);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request.headers.get('origin'), env.ALLOWED_RETURN_ORIGINS);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      if (request.method === 'GET' && url.pathname === '/auth/start') return await authStart(url, env);
      if (request.method === 'GET' && url.pathname === '/auth/callback') return await authCallback(url, env);
      if (request.method === 'GET' && url.pathname === '/api/profile') return await apiProfile(url, env, cors);
      if (request.method === 'POST' && url.pathname === '/api/disconnect') {
        const s = url.searchParams.get('session');
        if (s) await env.SESSIONS.delete('sess:' + s);
        return json({ ok: true }, 200, cors);
      }
      return json({ error: 'not found' }, 404, cors);
    } catch (e) {
      return json({ error: 'server' }, 500, cors);
    }
  }
};
