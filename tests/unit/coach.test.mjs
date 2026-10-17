import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Coach as C, Engine as E, cfg, freshState, at } from './helpers.mjs';

const en = { name: 'Asha Rao', niche: 'food', language: 'english' };
const hi = { name: 'Asha Rao', niche: 'food', language: 'hinglish' };

describe('coach chat', () => {
  test('refuses buying followers / views / f4f', () => {
    for (const m of ['how do I buy followers', 'can I purchase 1000 views', 'should I buy likes?', 'follow for follow groups?', 'join an engagement pod?', 'kya main followers kharid sakta hoon', 'buy 1000 real instagram followers', 'are paid followers worth it', 'fake views kaise milte', 'should I use a bot for likes']) {
      const r = C.chat(en, m);
      assert.match(r, /will not help|not help/i, m);
    }
    assert.match(C.chat(hi, 'buy followers'), /help nahi/);
    for (const m of ['I paid for a course and my views are low', 'robot dance video idea', 'what about bottles']) assert.doesNotMatch(C.chat(en, m), /will not help/, m);
  });
  test('answers common intents', () => {
    assert.match(C.chat(en, 'how do I write a better hook?'), /6 to 15 words/);
    assert.match(C.chat(en, 'I get low views'), /normal/);
    assert.match(C.chat(en, 'my views are so low'), /normal/);
    assert.match(C.chat(en, 'what should I post?'), /Ideas/);
    assert.match(C.chat(en, 'how do brand deals work'), /Gig-ready/);
    assert.match(C.chat(en, 'hi'), /Asha/);
    assert.ok(C.chat(en, 'qwertyuiop').length > 20, 'fallback');
  });
  test('Hinglish profile replies in Hinglish', () => {
    assert.match(C.chat(hi, 'how do I write a better hook?'), /bolo|rakho|likho/);
    assert.match(C.chat(hi, 'random question'), /karo/);
  });
  test('works for every niche', () => {
    for (const niche of ['food', 'fitness', 'tech', 'fashion', 'comedy', 'education', 'finance', 'travel', 'other', 'unknown']) {
      assert.ok(C.chat({ ...en, niche }, 'give me an idea').length > 10, niche);
    }
  });
});

describe('daily brief and reactions', () => {
  test('brief has prompt, focus and a message; Hinglish switches language', () => {
    const s = freshState();
    const ctx = { today: '2026-10-01', skills: E.skills(s, cfg), streak: E.dailyStreak(s, cfg, at('2026-10-01')) };
    const b = C.dailyBrief(en, ctx);
    assert.ok(b.prompt && b.focus && b.focusLabel && b.message);
    assert.match(b.message, /Asha/);
    assert.notEqual(C.dailyBrief(hi, ctx).message, b.message);
  });
  test('no guilt language after a 30+ day run ends', () => {
    const ctx = { today: '2026-10-01', skills: [], streak: { current: 0, lastBrokenRun: 35, activeToday: false }, gentleAfterDays: cfg.streaks.gentle_after_days };
    const m = C.dailyBrief(en, ctx).message;
    assert.match(m, /35-day run/);
    assert.doesNotMatch(m, /lost|failed|broke|shame/i);
  });
  test('the gentle-run threshold comes from the context, not the code', () => {
    const ctx = { today: '2026-10-01', skills: [], streak: { current: 0, lastBrokenRun: 12, activeToday: false } };
    assert.doesNotMatch(C.dailyBrief(en, { ...ctx, gentleAfterDays: 30 }).message, /12-day run/);
    assert.match(C.dailyBrief(en, { ...ctx, gentleAfterDays: 10 }).message, /12-day run/);
  });
  test('react mentions cap and low quality', () => {
    assert.match(C.react(en, { score: 8, fix: 'x' }, { notes: ['daily_cap'] }), /cap/);
    assert.match(C.react(en, { score: 2, fix: 'x' }, { notes: ['low_quality'] }), /No XP/);
    assert.match(C.react(hi, { score: 2, fix: 'x' }, { notes: ['low_quality'] }), /XP nahi/);
  });
});

describe('post nudge', () => {
  // Mon 2026-10-12 .. Sun 2026-10-18
  const nudge = (profile, over) => C.postNudge(profile, { posts: [], weekCount: 0, goal: 3, insights: { groups: [], best: null }, today: '2026-10-14', cfg, ...over });
  const post = date => ({ date, platform: 'instagram', format: 'Reel', views: 100 });
  const groups = (a, b) => ({ groups: [{ platform: 'instagram', format: 'Reel', median: a, posts: 3 }, { platform: 'youtube', format: 'Short', median: b, posts: 2 }], best: null });

  test('no posts logged means no nudge at all', () => {
    assert.equal(nudge(en, {}), null);
    assert.equal(nudge(en, { weekCount: 0, today: '2026-10-18' }), null);
    assert.equal(nudge(hi, { posts: undefined }), null);
  });

  test('rule 1: last post at least post_gap_nudge_days ago', () => {
    const gap = cfg.insights.post_gap_nudge_days;
    const days = n => E.addDays('2026-10-14', -n);
    assert.match(nudge(en, { posts: [post(days(gap))] }), new RegExp(`${gap} days since your last post`));
    assert.equal(nudge(en, { posts: [post(days(gap - 1))] }), null);
    assert.match(nudge(en, { posts: [post(days(10)), post(days(gap + 2))] }), new RegExp(`${gap + 2} days`), 'uses the most recent post');
  });

  test('rule 2: behind pace late in the week', () => {
    const base = { posts: [post('2026-10-14')], goal: 3 };
    assert.equal(nudge(en, { ...base, today: '2026-10-14', weekCount: 0 }), null, 'Wednesday: 5 days left is too early');
    assert.match(nudge(en, { ...base, today: '2026-10-16', weekCount: 1 }), /1\/3 this week with 3 days left/);
    assert.equal(nudge(en, { ...base, today: '2026-10-16', weekCount: 2 }), null, 'Friday at 2/3 is on pace (expected 2.14, tolerance 0.5)');
    assert.match(nudge(en, { ...base, posts: [post('2026-10-17')], today: '2026-10-18', weekCount: 2 }), /1 day left/);
  });

  test('pace rule thresholds come from config', () => {
    const c = structuredClone(cfg);
    c.insights.pace_days_left = 6;
    const ctx = { posts: [post('2026-10-13')], cfg: c, today: '2026-10-14', weekCount: 0 };
    assert.match(nudge(en, ctx), /0\/3/);
  });

  test('rule 3: goal hit', () => {
    const r = nudge(en, { posts: [post('2026-10-14')], weekCount: 3, goal: 3 });
    assert.match(r, /Weekly goal hit/);
    assert.match(nudge(en, { posts: [post('2026-10-14')], weekCount: 4, goal: 3 }), /Weekly goal hit/);
  });

  test('rule 4: one format stands out', () => {
    const ctx = { posts: [post('2026-10-14')], weekCount: 1, goal: 1 + 0, today: '2026-10-14' };
    const quiet = nudge(en, { ...ctx, goal: 2, insights: groups(1500, 1100) });
    assert.equal(quiet, null, '1.36x is not enough');
    const r = nudge(en, { ...ctx, goal: 2, insights: groups(1500, 1000) });
    assert.match(r, /Instagram Reel get the most views/);
    assert.match(r, /1,500/);
    assert.equal(nudge(en, { ...ctx, goal: 2, insights: { groups: [groups(1500, 1).groups[0]], best: null } }), null, 'needs a second format to compare');
  });

  test('standout ratio comes from config', () => {
    const c = structuredClone(cfg);
    c.insights.standout_ratio = 1.2;
    assert.match(nudge(en, { posts: [post('2026-10-14')], weekCount: 1, goal: 2, insights: groups(1300, 1000), cfg: c }), /most views/);
  });

  test('first matching rule wins and only one line comes back', () => {
    const r = nudge(en, { posts: [post('2026-10-08')], weekCount: 3, goal: 3, insights: groups(5000, 100) });
    assert.match(r, /days since your last post/);
    assert.equal(typeof r, 'string');
    assert.ok(!r.includes('\n'));
  });

  test('Hinglish variants for every rule', () => {
    assert.match(nudge(hi, { posts: [post('2026-10-08')] }), /din se koi post log nahi/);
    assert.match(nudge(hi, { posts: [post('2026-10-15')], today: '2026-10-16', weekCount: 1 }), /din bache hain/);
    assert.match(nudge(hi, { posts: [post('2026-10-14')], weekCount: 3 }), /poora ho gaya/);
    assert.match(nudge(hi, { posts: [post('2026-10-14')], weekCount: 1, goal: 2, insights: groups(1500, 1000) }), /sabse zyada views/);
  });
});

describe('chat: views and what is working', () => {
  const insights = { groups: [{ platform: 'instagram', format: 'Reel', median: 1840, posts: 3 }], best: { platform: 'youtube', format: 'Short', views: 12400, date: '2026-10-10' } };
  const ask = (p, q, ctx) => C.chat(p, q, ctx === undefined ? { insights, cfg } : ctx);

  test('answers from the creator posts', () => {
    for (const q of ["What's working?", 'show my stats', 'how are my views', 'whats working for me', 'performance check']) {
      const r = ask(en, q);
      assert.match(r, /Instagram Reel/, q);
      assert.match(r, /median 1,840 views over 3 posts/, q);
      assert.match(r, /Your best: YouTube Short, 12,400 views/, q);
      assert.match(r, /compared only with your own posts/, q);
    }
  });

  test('Hinglish', () => {
    assert.match(ask(hi, 'kya chal raha hai'), /median 1,840 views \(3 posts\)/);
    assert.match(ask(hi, 'stats batao'), /Tumhara best: YouTube Short/);
  });

  test('no data yet explains how to get some', () => {
    const empty = { insights: { groups: [], best: null }, cfg };
    assert.match(ask(en, "what's working", empty), /do not have any view counts/);
    assert.match(ask(hi, 'stats', empty), /views ka data nahi/);
    assert.match(C.chat(en, 'my stats'), /do not have any view counts/, 'no context at all');
  });

  test('only a best post, no comparable format yet', () => {
    const r = ask(en, 'stats', { insights: { groups: [], best: insights.best }, cfg });
    assert.match(r, /2 posts of the same format/);
    assert.match(r, /12,400 views/);
  });

  test('low views advice is unchanged', () => {
    assert.match(ask(en, 'my views are low'), /not a verdict/);
    assert.match(ask(en, 'no views on my last reel'), /not a verdict/);
  });
});
