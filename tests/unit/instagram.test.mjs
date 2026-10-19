import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Instagram as IG, Engine as E, cfg, at } from './helpers.mjs';

const NOW = at('2026-10-19');
const DAY = 86400000;
const ago = d => new Date(NOW - d * DAY).toISOString();
const media = (caption, daysAgo = 1, type = 'IMAGE', id = String(Math.random())) => ({ id, caption, media_type: type, permalink: 'https://instagram.com/p/x', timestamp: ago(daysAgo), like_count: 10, comments_count: 2 });
const profile = (over = {}) => ({ username: 'creator', name: 'Asha Rao', account_type: 'MEDIA_CREATOR', biography: '', followers_count: 500, media: [], ...over });

describe('inferProfile niche', () => {
  test('picks the niche with the most keyword hits across bio and captions', () => {
    const r = IG.inferProfile(profile({ biography: 'Street food and chai lover', media: [media('Best dosa and biryani at this cafe')] }), cfg, NOW);
    assert.equal(r.niche, 'food');
  });
  test('finance words give finance', () => {
    const r = IG.inferProfile(profile({ biography: 'Money, SIP and tax tips', media: [media('How I save ₹5000 a month on my salary')] }), cfg, NOW);
    assert.equal(r.niche, 'finance');
  });
  test('no keywords, one stray hit and ties all give other', () => {
    assert.equal(IG.inferProfile(profile(), cfg, NOW).niche, 'other');
    assert.equal(IG.inferProfile(profile({ biography: 'I love my dosa' }), cfg, NOW).niche, 'other');
    assert.equal(IG.inferNiche(profile({ biography: 'dosa chai gym workout' })), 'other');
  });
  test('matches whole words only', () => {
    assert.equal(IG.inferNiche(profile({ biography: 'ready tailor spin' })), 'other'); // contains "ai", "run"-like fragments
  });
});

describe('inferProfile name, language and weekly goal', () => {
  test('name is the first word, falling back to the username', () => {
    assert.equal(IG.inferProfile(profile(), cfg, NOW).name, 'Asha');
    assert.equal(IG.inferProfile(profile({ name: '' }), cfg, NOW).name, 'creator');
  });
  test('Hinglish when enough captions are Hinglish, else English', () => {
    const hi = 'Yaar ye kya hai, bhai ekdum mast';
    assert.equal(IG.inferLanguage(profile({ media: [media(hi), media(hi), media('Plain english caption here'), media('Another one')] })), 'hinglish');
    assert.equal(IG.inferLanguage(profile({ media: [media(hi), media('a'), media('b'), media('c'), media('d')] })), 'english');
    assert.equal(IG.inferLanguage(profile()), 'english');
    assert.equal(IG.inferLanguage(profile({ media: [media(null), media('')] })), 'english');
  });
  test('weekly goal is posts in the last 28 days over 4, rounded', () => {
    const n = k => profile({ media: Array.from({ length: k }, (_, i) => media('x', 1 + i)) });
    assert.equal(IG.inferProfile(n(8), cfg, NOW).weeklyGoal, 2);
    assert.equal(IG.inferProfile(n(10), cfg, NOW).weeklyGoal, 3); // 2.5 rounds up
  });
  test('weekly goal is clamped to the config min and max', () => {
    const many = profile({ media: Array.from({ length: 27 }, (_, i) => media('x', 1 + (i % 27))) });
    assert.equal(IG.inferProfile(many, cfg, NOW).weeklyGoal, cfg.weekly_goal.max);
    const tight = { weekly_goal: { min: 2, max: 7, suggested: 3 } };
    const four = profile({ media: Array.from({ length: 4 }, (_, i) => media('x', 1 + i)) });
    assert.equal(IG.inferProfile(four, tight, NOW).weeklyGoal, 2);
  });
  test('fewer than 3 recent posts falls back to the suggested goal; old posts do not count', () => {
    assert.equal(IG.inferProfile(profile({ media: [media('x', 1), media('x', 2)] }), cfg, NOW).weeklyGoal, cfg.weekly_goal.suggested);
    const old = profile({ media: [1, 2, 3, 4, 5, 6].map(i => media('x', 40 + i)) });
    assert.equal(IG.inferProfile(old, cfg, NOW).weeklyGoal, cfg.weekly_goal.suggested);
  });
  test('missing or malformed input does not throw', () => {
    assert.doesNotThrow(() => IG.inferProfile(null, cfg, NOW));
    assert.doesNotThrow(() => IG.inferProfile({ media: [null, 5, { timestamp: 'nope' }] }, cfg, NOW));
    assert.equal(IG.inferProfile({}, cfg, NOW).notes.length, 3);
  });
});

describe('mediaToPosts', () => {
  test('maps media types to formats', () => {
    const p = IG.mediaToPosts(profile({ media: [media('a', 1, 'VIDEO', '1'), media('a', 1, 'REELS', '2'), media('a', 1, 'CAROUSEL_ALBUM', '3'), media('a', 1, 'IMAGE', '4'), media('a', 1, 'STORY', '5')] }), NOW);
    assert.deepEqual(p.map(x => x.format), ['Reel', 'Reel', 'Carousel', 'Post', 'Post']);
  });
  test('posts are Instagram, unverified, without views, in the shape validatePost uses', () => {
    const [p] = IG.mediaToPosts(profile({ media: [media('a', 2, 'VIDEO', '99')] }), NOW);
    assert.equal(p.id, 'ig_99'); assert.equal(p.platform, 'instagram'); assert.equal(p.source, 'instagram');
    assert.equal(p.verified, false); assert.equal(p.views, null); assert.equal(p.ideaId, null); assert.equal(p.note, '');
    assert.equal(p.loggedOn, E.localDay(NOW)); assert.equal(p.likes, 10); assert.equal(p.comments, 2);
    assert.ok(cfg.posts.formats.includes(p.format));
  });
  test('date is the local day of the timestamp, and "+0000" offsets parse', () => {
    const ts = new Date(2026, 9, 5, 23, 30).toISOString(); // late evening local time
    const [a] = IG.mediaToPosts(profile({ media: [{ id: '1', media_type: 'IMAGE', timestamp: ts }] }), NOW);
    assert.equal(a.date, '2026-10-05');
    const [b] = IG.mediaToPosts(profile({ media: [{ id: '2', media_type: 'IMAGE', timestamp: '2026-10-05T12:00:00+0000' }] }), NOW);
    assert.equal(b.date, E.localDay(Date.parse('2026-10-05T12:00:00Z')));
  });
  test('bad timestamps are skipped and counts are sanitised', () => {
    const p = IG.mediaToPosts(profile({ media: [{ id: '1', timestamp: 'junk' }, { id: '2', timestamp: ago(1), like_count: -5, comments_count: 'x' }, null] }), NOW);
    assert.equal(p.length, 1); assert.equal(p[0].likes, null); assert.equal(p[0].comments, null);
  });
});

describe('sample creator', () => {
  const s = IG.sampleProfile(NOW);
  test('is priya.eats, a creator account with 12 media over about five weeks', () => {
    assert.equal(s.username, 'priya.eats'); assert.equal(s.followers_count, 3100); assert.equal(s.media.length, 12);
    assert.ok(['BUSINESS', 'MEDIA_CREATOR'].includes(s.account_type));
    const types = new Set(s.media.map(m => m.media_type));
    assert.ok(types.has('REELS') && types.has('CAROUSEL_ALBUM'));
  });
  test('infers food, English, and a weekly goal in range; never verified', () => {
    const r = IG.inferProfile(s, cfg, NOW);
    assert.equal(r.niche, 'food'); assert.equal(r.language, 'english'); assert.equal(r.name, 'Priya');
    assert.ok(r.weeklyGoal >= cfg.weekly_goal.min && r.weeklyGoal <= cfg.weekly_goal.max);
    assert.ok(IG.mediaToPosts(s, NOW).every(p => p.verified === false && p.date <= E.localDay(NOW)));
  });
  test('has exactly one Hinglish caption', () => {
    assert.equal(s.media.filter(m => /ekdum/.test(m.caption)).length, 1);
  });
});
