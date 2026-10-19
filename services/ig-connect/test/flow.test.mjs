import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker, { verifyState, b64urlEncode } from '../src/index.js';

// In-memory KV and a stubbed Instagram, to walk the whole flow without the network.
const kv = () => { const m = new Map(); return { m, get: async k => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }, delete: async k => { m.delete(k); } }; };
const env = () => ({ SESSIONS: kv(), IG_APP_ID: 'app', IG_APP_SECRET: 'appsecret', STATE_SECRET: 'st', TOKEN_ENC_KEY: b64urlEncode(new Uint8Array(32).fill(3)), ALLOWED_RETURN_ORIGINS: 'https://jash.github.io' });
const BACK = 'https://jash.github.io/flu/';
const call = (e, path, init) => worker.fetch(new Request('https://w.test' + path, init), e);

let realFetch, accountType, igCalls;
beforeEach(() => {
  realFetch = globalThis.fetch; accountType = 'MEDIA_CREATOR'; igCalls = [];
  globalThis.fetch = async (url, init) => {
    const u = new URL(String(url)); igCalls.push(u.origin + u.pathname);
    const ok = b => new Response(JSON.stringify(b), { status: 200 });
    if (u.pathname === '/oauth/access_token') return ok({ access_token: 'short', user_id: 1 });
    if (u.pathname === '/access_token') return ok({ access_token: 'long', expires_in: 5000000 });
    if (u.pathname === '/me') return ok({ username: 'a', name: 'A', account_type: accountType, followers_count: 5, media_count: 1 });
    if (u.pathname === '/me/media') return ok({ data: [{ id: '1', media_type: 'IMAGE', timestamp: '2026-10-01T10:00:00+0000' }] });
    throw new Error('unexpected ' + url);
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

async function connect(e) {
  const start = await call(e, '/auth/start?return=' + encodeURIComponent(BACK));
  const to = new URL(start.headers.get('location'));
  const cb = await call(e, `/auth/callback?code=igcode&state=${encodeURIComponent(to.searchParams.get('state'))}`);
  return { to, cb, code: new URL(cb.headers.get('location')).hash.replace('#ig=', '') };
}

describe('connect flow', () => {
  test('start redirects to Instagram with a signed state', async () => {
    const { to } = await connect(env());
    assert.equal(to.origin + to.pathname, 'https://www.instagram.com/oauth/authorize');
    assert.equal(to.searchParams.get('scope'), 'instagram_business_basic');
    assert.equal(to.searchParams.get('redirect_uri'), 'https://w.test/auth/callback');
    assert.equal(await verifyState('st', to.searchParams.get('state')), BACK);
  });
  test('start refuses a return URL that is not allowed', async () => {
    assert.equal((await call(env(), '/auth/start?return=' + encodeURIComponent('https://evil.example/'))).status, 400);
  });
  test('callback rejects a forged state', async () => {
    assert.equal((await call(env(), '/auth/callback?code=x&state=nope')).status, 400);
  });
  test('callback stores only an encrypted token under a one-time code and redirects back', async () => {
    const e = env(); const { cb, code } = await connect(e);
    assert.equal(cb.status, 302); assert.ok(cb.headers.get('location').startsWith(BACK + '#ig='));
    const stored = [...e.SESSIONS.m.values()].join('');
    assert.ok(code.length > 20 && !stored.includes('long'));
  });
  test('denied access goes back with ig_error', async () => {
    const e = env();
    const start = await call(e, '/auth/start?return=' + encodeURIComponent(BACK));
    const state = new URL(start.headers.get('location')).searchParams.get('state');
    const cb = await call(e, `/auth/callback?error=access_denied&state=${encodeURIComponent(state)}`);
    assert.equal(cb.headers.get('location'), BACK + '#ig_error=access_denied');
  });
  test('profile consumes the code once, returns a session, and the session refreshes', async () => {
    const e = env(); const { code } = await connect(e);
    const res = await call(e, '/api/profile?code=' + code, { headers: { origin: 'https://jash.github.io' } });
    const body = await res.json();
    assert.equal(res.status, 200); assert.equal(body.username, 'a'); assert.equal(body.media.length, 1); assert.ok(body.session);
    assert.equal(res.headers.get('access-control-allow-origin'), 'https://jash.github.io');
    assert.equal((await call(e, '/api/profile?code=' + code)).status, 401, 'code is single use');
    assert.equal((await call(e, '/api/profile?session=' + body.session)).status, 200);
    await call(e, '/api/disconnect?session=' + body.session, { method: 'POST' });
    assert.equal((await call(e, '/api/profile?session=' + body.session)).status, 401);
  });
  test('personal accounts get 422 account_type and no session is stored', async () => {
    const e = env(); const { code } = await connect(e);
    accountType = 'PERSONAL';
    const res = await call(e, '/api/profile?code=' + code);
    assert.equal(res.status, 422); assert.equal((await res.json()).error, 'account_type');
    assert.ok(![...e.SESSIONS.m.keys()].some(k => k.startsWith('sess:')));
  });
});
