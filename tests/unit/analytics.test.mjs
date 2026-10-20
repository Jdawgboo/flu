import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Analytics as AN, Instagram as IG, cfg, at } from './helpers.mjs';

const NOW = at('2026-10-19');
const DAY = 86400000;
const day = d => new Date(NOW - d * DAY).toISOString().slice(0, 10);
let n = 0;
const post = (over = {}) => ({ id: 'ig_' + (++n), source: 'instagram', platform: 'instagram', format: 'Post', date: day(1), hour: 18, likes: 100, comments: 10, caption: 'plain words here', ...over });

describe('analyze', () => {
  test('too few posts says how many are needed', () => {
    const r = AN.analyze([post(), post()], 1000, cfg, NOW);
    assert.equal(r.ready, false); assert.equal(r.posts, 2); assert.equal(r.needed, cfg.analytics.min_posts);
  });
  test('ignores manual posts, posts without likes and future posts', () => {
    const r = AN.analyze([post(), post(), post({ source: 'manual' }), post({ likes: null }), post({ date: day(-3) })], 1000, cfg, NOW);
    assert.equal(r.ready, false); assert.equal(r.posts, 2);
  });
  test('engagement rate uses followers, or reach when the post has insights', () => {
    const r = AN.analyze([post({ likes: 90, comments: 10 }), post({ likes: 90, comments: 10 }), post({ likes: 90, comments: 10 })], 1000, cfg, NOW);
    assert.equal(r.totals.medianEr, 10); assert.equal(r.totals.erBase, 'followers'); assert.equal(r.totals.hasInsights, false);
    const s = AN.analyze([1, 2, 3].map(() => post({ likes: 40, comments: 5, saves: 3, shares: 2, reach: 500 })), 1000, cfg, NOW);
    assert.equal(s.totals.medianEr, 10); assert.equal(s.totals.erBase, 'reach');
    assert.equal(s.totals.saveRate, 0.6); assert.equal(s.totals.shareRate, 0.4); assert.equal(s.totals.reachRate, 50);
  });
  test('format groups are ranked and a strong one becomes a takeaway', () => {
    const posts = [post({ format: 'Reel', likes: 300 }), post({ format: 'Reel', likes: 280 }), post({ format: 'Post', likes: 80 }), post({ format: 'Post', likes: 90 }), post({ format: 'Post', likes: 85 })];
    const r = AN.analyze(posts, 1000, cfg, NOW);
    assert.equal(r.byFormat[0].key, 'Reel'); assert.ok(r.byFormat[0].lift > 1.2);
    assert.ok(r.takeaways.some(t => t.startsWith('Reels get')));
  });
  test('groups below min_group_posts are kept but marked and never become takeaways', () => {
    const r = AN.analyze([post({ format: 'Carousel', likes: 900 }), post(), post(), post()], 1000, cfg, NOW);
    const car = r.byFormat.find(g => g.key === 'Carousel');
    assert.equal(car.enough, false);
    assert.ok(!r.takeaways.some(t => t.startsWith('Carousels')));
  });
  test('time slots come from config, night wraps past midnight', () => {
    assert.equal(AN.slotOf(6, cfg.analytics), 'Morning'); assert.equal(AN.slotOf(23, cfg.analytics), 'Night');
    assert.equal(AN.slotOf(2, cfg.analytics), 'Night'); assert.equal(AN.slotOf(null, cfg.analytics), null);
  });
  test('caption traits: question, number, price, CTA, hashtags, length', () => {
    const t = AN.traits('Is this ₹80 dosa worth it?\nSave this #food #dosa #blr', cfg.analytics);
    assert.equal(t.question, true); assert.equal(t.number, true); assert.equal(t.rupee, true); assert.equal(t.cta, true); assert.equal(t.hashtags, true);
    assert.equal(t.short, true); assert.equal(AN.traits('', cfg.analytics), null);
  });
  test('a caption trait compares with and without', () => {
    const q = c => post({ caption: c });
    const posts = [q('Worth it?'), q('Really worth it?'), q('Plain one'), q('Plain two'), q('Plain three')];
    posts[0].likes = 300; posts[1].likes = 300;
    const t = AN.analyze(posts, 1000, cfg, NOW).traits.find(x => x.key === 'question');
    assert.equal(t.withPosts, 2); assert.equal(t.withoutPosts, 3); assert.ok(t.lift > 2);
  });
  test('rhythm: posts per week, gaps and days since the last post', () => {
    const r = AN.analyze([post({ date: day(9) }), post({ date: day(16) }), post({ date: day(23) })], 1000, cfg, NOW);
    assert.equal(r.rhythm.medianGap, 7); assert.equal(r.rhythm.longestGap, 7); assert.equal(r.rhythm.daysSinceLast, 9);
    assert.ok(r.takeaways[0].startsWith('No post in 9 days'));
  });
  test('trend compares the newer half of the weeks with the older half', () => {
    const old = [30, 31, 40, 41].map(d => post({ date: day(d), likes: 50 })), recent = [2, 3, 9, 10].map(d => post({ date: day(d), likes: 150 }));
    const r = AN.analyze(old.concat(recent), 1000, cfg, NOW);
    assert.equal(r.trend.weeks.length, cfg.analytics.trend_weeks);
    assert.ok(r.trend.change > 1); assert.ok(r.takeaways.some(t => t.startsWith('Engagement is up')));
  });
  test('top and bottom posts never overlap', () => {
    const posts = [1, 2, 3, 4].map(i => post({ likes: i * 50 }));
    const r = AN.analyze(posts, 1000, cfg, NOW);
    assert.equal(r.top.length, 3); assert.equal(r.bottom.length, 1); assert.equal(r.bottom[0].likes, 50);
    assert.ok(!r.top.some(p => p.id === r.bottom[0].id));
  });
  test('the demo sample creator produces a full report with insights', () => {
    const posts = IG.mediaToPosts(IG.sampleProfile(NOW), NOW);
    const r = AN.analyze(posts, 3100, cfg, NOW);
    assert.equal(r.ready, true); assert.equal(r.totals.hasInsights, true); assert.equal(r.totals.erBase, 'reach');
    assert.ok(r.takeaways.length > 0 && r.takeaways.length <= cfg.analytics.max_takeaways);
    assert.ok(r.byTime.length > 0 && r.traits.length > 0);
  });
});

describe('imported posts carry what Analytics needs', () => {
  test('caption, local hour and insights are kept; no insights leaves them null', () => {
    const ts = new Date(NOW - DAY).toISOString();
    const [a, b] = IG.mediaToPosts({ media: [
      { id: '1', caption: 'x'.repeat(900), media_type: 'REELS', timestamp: ts, like_count: 5, insights: { reach: 50, saved: 2, shares: 1, views: 300 } },
      { id: '2', media_type: 'IMAGE', timestamp: ts, like_count: 5 }
    ] }, NOW);
    assert.equal(a.caption.length, 500); assert.equal(a.hour, new Date(ts).getHours());
    assert.equal(a.reach, 50); assert.equal(a.saves, 2); assert.equal(a.shares, 1); assert.equal(a.views, 300);
    assert.equal(b.caption, ''); assert.equal(b.reach, null); assert.equal(b.views, null);
  });
});
