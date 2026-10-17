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
    const ctx = { today: '2026-10-01', skills: [], streak: { current: 0, lastBrokenRun: 35, activeToday: false } };
    const m = C.dailyBrief(en, ctx).message;
    assert.match(m, /35-day run/);
    assert.doesNotMatch(m, /lost|failed|broke|shame/i);
  });
  test('react mentions cap and low quality', () => {
    assert.match(C.react(en, { score: 8, fix: 'x' }, { notes: ['daily_cap'] }), /cap/);
    assert.match(C.react(en, { score: 2, fix: 'x' }, { notes: ['low_quality'] }), /No XP/);
    assert.match(C.react(hi, { score: 2, fix: 'x' }, { notes: ['low_quality'] }), /XP nahi/);
  });
});
