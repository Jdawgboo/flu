import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Studio, Engine as E, Content, Grader, cfg, appCfg, at } from './helpers.mjs';

const TODAY = '2026-10-19';
const S = appCfg.studio;
const profile = { name: 'Asha', niche: 'food', language: 'english' };
const post = (id, date, platform, format, views) => ({ id, date, platform, format, views, source: 'manual', verified: false });

function ctx(over = {}) {
  const posts = over.posts || [];
  const st = { posts };
  const now = at(TODAY);
  return { cfg, appCfg, profile, posts, today: TODAY, insights: E.postInsights(st, cfg, now), engagement: E.engagementInsights(st, cfg, now), ...over };
}
const IDEA = 'Why my Sunday dosa at the hostel canteen beats every cafe brunch';

describe('studio config', () => {
  test('agents in config match the code', () => {
    assert.deepEqual(Object.keys(Studio.AGENTS), S.agents);
    assert.equal(Studio.AGENTS.linkedin.length, 2);
  });
});

describe('studio.run (mock)', () => {
  test('is deterministic', async () => {
    const a = await Studio.run(IDEA, ctx()), b = await Studio.run(IDEA, ctx());
    assert.deepEqual(a, b);
    assert.equal(a.mode, 'mock');
    assert.equal(a.version, 'studio.v1');
  });
  test('result is valid and counts match config', async () => {
    const r = await Studio.run(IDEA, ctx());
    assert.deepEqual(Studio.validate(r, appCfg), { ok: true, errors: [] });
    assert.equal(r.strategist.angles.length, S.angles);
    assert.equal(r.strategist.questions.length, S.questions);
    assert.equal(r.instagram.concepts[0].shots.length, S.reel_shots);
    assert.equal(r.instagram.concepts[1].slides.length, S.carousel_slides);
    assert.equal(r.thread.posts.length, S.thread_posts);
    assert.equal(r.linkedin.posts.length, S.linkedin_posts);
    assert.equal(r.linkedin.platform, 'linkedin');
    assert.equal(r.board.tiles.length, S.board_tiles);
    assert.ok(r.thread.posts.every(p => p.length <= 280));
    assert.ok(r.next.some(n => n.action === 'save-idea'));
  });
  test('counts follow a changed config', async () => {
    const c = ctx({ appCfg: { ...appCfg, studio: { ...S, reel_shots: 7, board_tiles: 8, thread_posts: 3, linkedin_posts: 5, angles: 4 } } });
    const r = await Studio.run(IDEA, c);
    assert.equal(r.instagram.concepts[0].shots.length, 7);
    assert.equal(r.board.tiles.length, 8);
    assert.equal(r.thread.posts.length, 3);
    assert.equal(r.linkedin.posts.length, 5);
    assert.equal(r.strategist.angles.length, 4);
    assert.ok(Studio.validate(r, c.appCfg).ok);
  });
  test('works for every niche and the hooks pass the critic', async () => {
    for (const niche of Object.keys(Content.NICHES)) {
      const r = await Studio.run('Something about ' + niche + ' that I learned this month', ctx({ profile: { ...profile, niche } }));
      assert.ok(Studio.validate(r, appCfg).ok, niche);
      assert.notEqual(r.critic.verdict, 'rethink', niche + ' ' + JSON.stringify(r.critic));
      assert.ok(Grader.words(r.instagram.concepts[0].hook).length <= 15, niche);
    }
  });
  test('Hinglish profile or Hinglish idea gives lang hi', async () => {
    assert.equal((await Studio.run(IDEA, ctx({ profile: { ...profile, language: 'hinglish' } }))).lang, 'hi');
    const r = await Studio.run('yaar mera dosa kya mast hai aur sab ko pasand hai', ctx());
    assert.equal(r.lang, 'hi');
    assert.match(JSON.stringify(r.instagram), /karo|mein|tum/i);
    assert.match(r.linkedin.posts.join(' '), /karo|mein|batao/i);
    assert.equal((await Studio.run(IDEA, ctx())).lang, 'en');
  });
  test('input is trimmed to max_input_chars', async () => {
    const r = await Studio.run(('dosa ' .repeat(400)), ctx());
    assert.ok(r.idea.text.length <= S.max_input_chars);
  });
  test('a cheat idea is refused with rethink and nothing to save', async () => {
    for (const t of ['I want to buy followers for my reel', 'kharid ke 1000 followers chahiye mujhe', 'join an engagement pod for my reels']) {
      const r = await Studio.run(t, ctx());
      assert.equal(r.critic.verdict, 'rethink', t);
      assert.equal(r.critic.hook_score, 1);
      assert.ok(Studio.validate(r, appCfg).ok);
      assert.deepEqual(r.next.map(n => n.action), ['open-rep']);
    }
    assert.ok(Content.CHEAT_RE.test('buy followers'));
  });
  test('cheat ideas never reach the llm, and an llm cannot overrule the refusal', async () => {
    let calls = 0;
    const r = await Studio.run('buy 500 followers', ctx(), { llm: { complete: async () => { calls++; return {}; } } });
    assert.equal(calls, 0);
    assert.equal(r.critic.verdict, 'rethink');
    assert.equal(r.mode, 'mock');
  });
  test('gibberish is a rethink', async () => {
    assert.equal((await Studio.run('asdf qwer zxcv', ctx())).critic.verdict, 'rethink');
  });
  test('critic flags a long hook, no detail and no cta', () => {
    const inp = { lang: 'en', niche: 'food', seed: 'x', parts: { instagram: { concepts: [{ hook: 'this is a very long hook with way more than fifteen words in it so the critic must flag it right away', cta: 'enjoy' }] } } };
    const c = Studio.AGENTS.critic(inp, ctx());
    assert.match(c.risks.join(' '), /over 15 words/);
    assert.match(c.risks.join(' '), /concrete detail/);
    assert.match(c.risks.join(' '), /call to action/);
    assert.equal(c.verdict, 'rethink');
  });
});

describe('studio.validate', () => {
  test('rejects malformed results, and counts only with config', async () => {
    const good = await Studio.run(IDEA, ctx());
    assert.equal(Studio.validate(null).ok, false);
    const bad = JSON.parse(JSON.stringify(good));
    bad.thread.posts = [];
    assert.deepEqual(Studio.validate(bad).errors, ['thread']);
    const wrongCount = JSON.parse(JSON.stringify(good));
    wrongCount.instagram.concepts[0].shots.pop();
    assert.ok(Studio.validate(wrongCount).ok);
    assert.deepEqual(Studio.validate(wrongCount, appCfg).errors, ['instagram']);
    const v = JSON.parse(JSON.stringify(good)); v.critic.verdict = 'great'; v.version = 'x'; v.linkedin.platform = 'x';
    assert.deepEqual(Studio.validate(v).errors.sort(), ['critic', 'linkedin', 'version']);
    const long = JSON.parse(JSON.stringify(good)); long.thread.posts[0] = 'a'.repeat(281);
    assert.deepEqual(Studio.validate(long).errors, ['thread']);
  });
});

describe('studio.run with an llm', () => {
  test('bad json, wrong shape, throws and timeouts fall back per agent only', async () => {
    const mock = await Studio.run(IDEA, ctx());
    const goodStrategist = { angles: Array.from({ length: S.angles }, (_, i) => ({ id: 'a' + i, label: 'L' + i, why: 'W' + i })), questions: Array.from({ length: S.questions }, (_, i) => 'Q' + i) };
    const calls = [];
    const llm = { complete: async ({ agent, system, schema }) => {
      calls.push(agent);
      assert.ok(system && schema, 'system and schema are passed');
      if (agent === 'strategist') return goodStrategist;
      if (agent === 'instagram') return 'not json';
      if (agent === 'thread') return { platform: 'x', posts: ['only one'] };
      if (agent === 'linkedin') throw new Error('boom');
      if (agent === 'board') return new Promise(() => {}); // never answers
      return { verdict: 'ship', risks: [], fix: 'ok', hook_score: 9 };
    } };
    const c = ctx({ appCfg: { ...appCfg, studio: { ...S, timeout_ms: 20 } } });
    const r = await Studio.run(IDEA, c, { llm });
    assert.deepEqual(calls.sort(), [...S.agents].sort());
    assert.equal(r.mode, 'llm');
    assert.deepEqual(r.strategist, goodStrategist);
    assert.equal(r.critic.hook_score, 9);
    for (const k of ['instagram', 'thread', 'linkedin', 'board']) assert.deepEqual(r[k], mock[k], k);
    assert.ok(Studio.validate(r, appCfg).ok);
  });
  test('all invalid means mock mode', async () => {
    const r = await Studio.run(IDEA, ctx(), { llm: { complete: async () => ({}) } });
    assert.equal(r.mode, 'mock');
    assert.deepEqual({ ...r, mode: 'x' }, { ...(await Studio.run(IDEA, ctx())), mode: 'x' });
  });
});

describe('todayPick', () => {
  test('views basis: top format, reasons cite the creator\'s own posts, gap vs nudge days', () => {
    const posts = [post('a', '2026-10-10', 'instagram', 'Reel', 900), post('b', '2026-10-12', 'instagram', 'Reel', 1100), post('c', '2026-10-11', 'youtube', 'Short', 100), post('d', '2026-10-13', 'youtube', 'Short', 120)];
    const p = Studio.todayPick(profile, ctx({ posts }));
    assert.equal(p.basis, 'views');
    assert.equal(p.format, 'Reel');
    assert.equal(p.platform, 'instagram');
    assert.equal(p.gapDays, 6);
    assert.ok(p.gapDays >= cfg.insights.post_gap_nudge_days);
    assert.match(p.reasons.join(' '), /posts you reported/);
    assert.match(p.reasons.join(' '), /6 days ago/);
    assert.ok(Content.NICHES.food.prompts.includes(p.prompt));
  });
  test('a recent post gives a rhythm reason', () => {
    const posts = [post('a', '2026-10-18', 'instagram', 'Reel', 900), post('b', '2026-10-17', 'instagram', 'Reel', 1100)];
    const p = Studio.todayPick(profile, ctx({ posts }));
    assert.equal(p.gapDays, 1);
    assert.match(p.reasons[1], /1 day ago/);
  });
  test('engagement-only: imported Instagram posts', () => {
    const ig = (id, date, likes) => ({ id, date, platform: 'instagram', format: 'Carousel', views: null, source: 'instagram', likes, comments: 5 });
    const p = Studio.todayPick(profile, ctx({ posts: [ig('a', '2026-10-15', 200), ig('b', '2026-10-16', 300)] }));
    assert.equal(p.basis, 'engagement');
    assert.equal(p.format, 'Carousel');
    assert.match(p.reasons[0], /imported Instagram posts/);
    assert.equal(p.gapDays, 3);
  });
  test('empty: niche basis, default format, null gap, still mentions posts', () => {
    const p = Studio.todayPick(profile, ctx());
    assert.deepEqual([p.basis, p.format, p.platform, p.gapDays], ['niche', S.default_format, 'instagram', null]);
    assert.equal(p.reasons.length, 1);
    assert.match(p.reasons[0], /posts/);
  });
  test('same day, same prompt; Hinglish reasons', () => {
    assert.equal(Studio.todayPick(profile, ctx()).prompt, Studio.todayPick(profile, ctx()).prompt);
    assert.match(Studio.todayPick({ ...profile, language: 'hinglish' }, ctx()).reasons[0], /tumhare|Posts/i);
  });
});

describe('unstick and groupPlan', () => {
  test('unstick: tiny prompts and a one-minute hook rep from config', () => {
    const u = Studio.unstick(profile, ctx());
    assert.equal(u.prompts.length, S.unstick_prompts);
    assert.deepEqual([u.action.type, u.action.seconds], ['hook', S.unstick_seconds]);
    assert.equal(S.unstick_seconds, 60);
    assert.deepEqual(u, Studio.unstick(profile, ctx()));
  });
  test('group size is parsed from English and Hinglish', () => {
    const G = appCfg.group;
    const size = t => Studio.groupPlan(t, profile, ctx()).people;
    assert.equal(size('plan a shoot with 3 of us'), 3);
    assert.equal(size('teen dost ke saath shoot'), 3);
    assert.equal(size('shoot with five friends'), 5);
    assert.equal(size('group of 4 shoot'), 4);
    assert.equal(size('plan a shoot with friends'), G.default_size);
  });
  test('group size is clamped by config', () => {
    const G = appCfg.group;
    assert.equal(Studio.groupPlan('shoot with 20 friends', profile, ctx()).people, G.max_size);
    assert.equal(Studio.groupPlan('shoot with 1 of us', profile, ctx()).people, G.min_size);
    const c = ctx({ appCfg: { ...appCfg, group: { ...G, max_size: 4 } } });
    assert.equal(Studio.groupPlan('shoot with 7 friends', profile, c).people, 4);
  });
  test('plan shape', () => {
    const g = Studio.groupPlan('plan a shoot with 4 of us', profile, ctx());
    assert.equal(g.roles.length, 4);
    assert.equal(g.shots.length, 4 + 2);
    assert.ok(g.shots.every(s => s.who && s.shot && s.seconds > 0));
    assert.equal(g.minutes, appCfg.group.shoot_minutes);
    assert.ok(g.concept && g.checklist.length >= 3);
    assert.match(Studio.groupPlan('teen dost', { ...profile, language: 'hinglish' }, ctx()).concept, /Sab|jawab/);
  });
});
