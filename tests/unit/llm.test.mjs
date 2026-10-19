import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { Llm, Studio, Router, root, cfg, appCfg, Engine as E, at } from './helpers.mjs';

const S = appCfg.studio;
const PROMPT_DIR = path.join(root, 'prompts/studio');
const prompts = Object.fromEntries(readdirSync(PROMPT_DIR).filter(f => f.endsWith('.md')).map(f => [f.slice(0, -3), readFileSync(path.join(PROMPT_DIR, f), 'utf8').trim()]));
const REQ = { agent: 'thread', system: 'fallback system', input: { text: 'my dosa', lang: 'en' }, schema: { type: 'object' } };
const reply = (body, status = 200) => async () => new Response(JSON.stringify(body), { status });
const mk = (f, over = {}) => Llm.create({ base: 'https://ai.test/', fetch: f, clientId: 'client-abcdef12', header: 'x-lockin-client', timeoutMs: 200, prompts, studio: S, defaultRetryAfterS: 60, ...over });
const code = p => p.then(() => null, e => e.code);

describe('llm client request', () => {
  test('posts agent, system, input, schema to /v1/complete with the client id header', async () => {
    let seen;
    const out = await mk(async (u, i) => { seen = { u, i }; return new Response(JSON.stringify({ json: { platform: 'x', posts: ['a'] } })); }).complete(REQ);
    assert.deepEqual(out, { platform: 'x', posts: ['a'] });
    assert.equal(seen.u, 'https://ai.test/v1/complete');
    assert.equal(seen.i.method, 'POST');
    assert.equal(seen.i.headers['x-lockin-client'], 'client-abcdef12');
    assert.equal(seen.i.credentials, 'omit');
    const b = JSON.parse(seen.i.body);
    assert.equal(b.agent, 'thread'); assert.deepEqual(b.input, REQ.input); assert.deepEqual(b.schema, REQ.schema);
    assert.ok(!('system' in b));
    assert.ok(!/api[-_ ]?key|goog|authorization/i.test(JSON.stringify(seen.i)), 'no key anywhere');
  });
  test('clientId may be a function', async () => {
    let h;
    await mk(async (u, i) => { h = i.headers['x-lockin-client']; return new Response('{"json":{"a":1}}'); }, { clientId: () => 'fn-client-0001' }).complete(REQ);
    assert.equal(h, 'fn-client-0001');
  });
});

describe('llm client failures all throw', () => {
  test('network error, http error, non-JSON, non-object json', async () => {
    assert.equal(await code(mk(async () => { throw new TypeError('offline'); }).complete(REQ)), 'network');
    assert.equal(await code(mk(reply({ error: 'upstream' }, 502)).complete(REQ)), 'http');
    assert.equal(await code(mk(async () => new Response('<html>')).complete(REQ)), 'invalid');
    assert.equal(await code(mk(reply({ json: 'str' })).complete(REQ)), 'invalid');
    assert.equal(await code(mk(reply({ json: [1] })).complete(REQ)), 'invalid');
    assert.equal(await code(mk(reply({})).complete(REQ)), 'invalid');
    assert.equal(await code(Llm.create({ base: '', fetch: reply({}) }).complete(REQ)), 'network');
  });
  test('timeout aborts the request', async () => {
    const f = (u, i) => new Promise((_, rej) => i.signal.addEventListener('abort', () => rej(Object.assign(new Error('a'), { name: 'AbortError' }))));
    assert.equal(await code(mk(f, { timeoutMs: 20 }).complete(REQ)), 'timeout');
  });
  test('429 throws quota, reports it, and blocks further calls until retry_after passes', async () => {
    let n = 0, t = 1000, errs = [];
    const l = mk(async () => { n++; return new Response(JSON.stringify({ error: 'quota', retry_after: 30 }), { status: 429 }); }, { now: () => t, onError: e => errs.push(e.code) });
    assert.equal(await code(l.complete(REQ)), 'quota');
    assert.equal(await code(l.complete(REQ)), 'quota');
    assert.equal(n, 1, 'second call made no request');
    assert.deepEqual(errs, ['quota', 'quota']);
    t += 31000;
    assert.equal(await code(l.complete(REQ)), 'quota');
    assert.equal(n, 2, 'window over, tries again');
  });
  test('a huge server retry_after is clamped to maxRetryAfterS', async () => {
    let t = 0, n = 0;
    const l = mk(async () => { n++; return new Response(JSON.stringify({ retry_after: 999999 }), { status: 429 }); }, { now: () => t, maxRetryAfterS: 100 });
    const e = await l.complete(REQ).catch(x => x);
    assert.equal(e.retryAfter, 100);
    t = 99000; await code(l.complete(REQ)); assert.equal(n, 1);
    t = 100001; await code(l.complete(REQ)); assert.equal(n, 2);
  });
  test('429 without retry_after uses the configured default', async () => {
    let t = 0, n = 0;
    const l = mk(async () => { n++; return new Response('{}', { status: 429 }); }, { now: () => t, defaultRetryAfterS: 5 });
    await code(l.complete(REQ));
    t = 4000; await code(l.complete(REQ)); assert.equal(n, 1);
    t = 5001; await code(l.complete(REQ)); assert.equal(n, 2);
  });
});

describe('server-owned prompts', () => {
  test('the client sends agent, input and schema but never a system prompt', async () => {
    let b;
    await mk(async (u, i) => { b = JSON.parse(i.body); return new Response('{"json":{"a":1}}'); }).complete({ ...REQ, system: 'client supplied instructions' });
    assert.deepEqual(Object.keys(b).sort(), ['agent', 'input', 'schema']);
  });
  test('the generated Worker prompts are in sync with prompts/studio and config', async () => {
    const { generate } = await import(path.join(root, 'scripts/gen-ai-prompts.mjs'));
    assert.equal(readFileSync(path.join(root, 'services/ai/src/prompts.js'), 'utf8'), await generate(), 'run `npm run gen:ai`');
  });
  test('prompt files exist for every agent, use known placeholders, counts come from config', async () => {
    for (const a of [...S.agents, 'common', 'hinglish']) assert.ok(prompts[a] && prompts[a].length > 60, a);
    for (const t of Object.values(prompts)) for (const m of t.matchAll(/\{\{(\w+)\}\}/g)) assert.ok(S[m[1]] != null, m[1]);
    const { composeSystem } = await import(path.join(root, 'services/ai/src/prompts.js'));
    const sys = (a, lang = 'en') => composeSystem(a, { lang });
    assert.match(sys('strategist'), new RegExp(`exactly ${S.angles} items`));
    assert.match(sys('instagram'), new RegExp(`exactly ${S.reel_shots} items`));
    assert.match(sys('thread'), new RegExp(`exactly ${S.thread_posts} posts`));
    assert.match(sys('board'), new RegExp(`exactly ${S.board_tiles} tiles`));
    for (const a of S.agents) assert.ok(!/\{\{/.test(sys(a)), a);
    assert.ok(!/Roman-script/.test(sys('thread'))); assert.match(sys('thread', 'hi'), /Roman-script Hindi/);
    assert.match(sys('critic'), /buying or faking followers/); assert.match(sys('thread'), /earns the creator no XP/);
  });
});

describe('newClientId', () => {
  test('is url-safe, 8 to 64 chars, and differs between calls', () => {
    const a = Llm.newClientId(), b = Llm.newClientId();
    assert.match(a, /^[A-Za-z0-9_-]{8,64}$/); assert.notEqual(a, b);
  });
});

describe('studio with the llm client', () => {
  const profile = { name: 'Asha', niche: 'food', language: 'english' };
  const ctx = () => { const st = { posts: [] }, now = at('2026-10-19'); return { cfg, appCfg, profile, posts: [], today: '2026-10-19', insights: E.postInsights(st, cfg, now), engagement: E.engagementInsights(st, cfg, now) }; };
  const IDEA = 'A reel about my ₹80 dosa at the hostel canteen near campus';
  test('valid model JSON is used (mode llm); the rest of the run still validates', async () => {
    const mock = await Studio.run(IDEA, ctx(), {});
    const f = async (u, i) => { const b = JSON.parse(i.body); return new Response(JSON.stringify({ json: b.agent === 'thread' ? { platform: 'x', posts: mock.thread.posts.map((p, k) => 'Live post ' + k) } : mock[b.agent] })); };
    const r = await Studio.run(IDEA, ctx(), { llm: mk(f) });
    assert.equal(r.mode, 'llm');
    assert.ok(r.thread.posts[0].startsWith('Live post'));
    assert.equal(Studio.validate(r, appCfg).ok, true);
  });
  test('429 on every call falls back to the mock result', async () => {
    const mock = await Studio.run(IDEA, ctx(), {});
    const r = await Studio.run(IDEA, ctx(), { llm: mk(reply({ error: 'quota' }, 429)) });
    assert.equal(r.mode, 'mock');
    assert.deepEqual(r.thread, mock.thread);
    assert.equal(Studio.validate(r, appCfg).ok, true);
  });
  test('invalid model JSON for one agent falls back for that agent only', async () => {
    const mock = await Studio.run(IDEA, ctx(), {});
    const f = async (u, i) => { const b = JSON.parse(i.body); return new Response(JSON.stringify({ json: b.agent === 'board' ? { tiles: [] } : mock[b.agent] })); };
    const r = await Studio.run(IDEA, ctx(), { llm: mk(f) });
    assert.equal(r.mode, 'llm'); assert.deepEqual(r.board, mock.board);
  });
  test('cheat ideas never reach the network and the critic stays on rethink', async () => {
    let calls = 0;
    const r = await Studio.run('I want to buy 10k followers for my reel', ctx(), { llm: mk(async () => { calls++; return new Response('{"json":{}}'); }) });
    assert.equal(calls, 0); assert.equal(r.critic.verdict, 'rethink'); assert.equal(r.mode, 'mock');
  });
  test('a model that approves cheating cannot replace the refusal (llm never asked)', async () => {
    const r = await Studio.run('Fake likes and bought views for my Reel', ctx(), { llm: mk(async () => new Response(JSON.stringify({ json: { verdict: 'ship', risks: [], fix: 'go', hook_score: 10 } }))) });
    assert.equal(r.critic.verdict, 'rethink');
  });
  test('AI output earns no XP: results carry no xp fields', async () => {
    const r = await Studio.run(IDEA, ctx(), {});
    assert.ok(!/"xp"/.test(JSON.stringify(r)));
  });
});
