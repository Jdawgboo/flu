import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Engine as E, cfg, freshState, at } from './helpers.mjs';

describe('config', () => {
  test('has the PRD starting values', () => {
    assert.equal(cfg.daily_practice_cap, 300);
    assert.equal(cfg.anti_gaming.min_quality_score, 4);
    assert.equal(cfg.anti_gaming.duplicate_similarity, 0.9);
    assert.equal(cfg.streaks.freeze_every_days, 7);
    assert.equal(cfg.streaks.max_freezes, 2);
    assert.ok(!cfg.capped_sources.includes('post'));
    assert.ok(!cfg.capped_sources.includes('reflection'));
    assert.deepEqual(cfg.streaks.milestones, [3, 7, 30]);
  });
});

describe('XP awards', () => {
  for (const source of ['idea', 'hook', 'rewrite', 'script']) {
    test(`${source}: base below bonus threshold, base+bonus at/above it (from config)`, () => {
      const r = cfg.xp[source];
      const s = freshState();
      assert.equal(E.award(s, cfg, { source, score: r.bonus_min_score - 1, words: 60, now: at('2026-10-01') }).amount, r.base);
      const e = E.award(s, cfg, { source, score: r.bonus_min_score, words: 60, now: at('2026-10-01') });
      assert.equal(e.amount, r.base + r.bonus);
      assert.ok(e.notes.includes('quality_bonus'));
    });
  }

  test('XP values follow config, not hard-coded numbers', () => {
    const c = structuredClone(cfg);
    c.xp.hook = { base: 13, bonus: 4, bonus_min_score: 6 };
    const s = freshState();
    assert.equal(E.award(s, c, { source: 'hook', score: 6, now: at('2026-10-01') }).amount, 17);
    assert.equal(E.award(s, c, { source: 'hook', score: 5, now: at('2026-10-01') }).amount, 13);
  });

  test('lesson earns its base', () => {
    const s = freshState();
    assert.equal(E.award(s, cfg, { source: 'lesson', now: at('2026-10-01') }).amount, cfg.xp.lesson.base);
  });

  for (const source of ['idea', 'hook', 'rewrite']) {
    test(`${source} under min quality score gets 0 XP, at min gets XP`, () => {
      const s = freshState();
      const low = E.award(s, cfg, { source, score: cfg.anti_gaming.min_quality_score - 1, now: at('2026-10-01') });
      assert.equal(low.amount, 0);
      assert.ok(low.notes.includes('low_quality'));
      assert.ok(E.award(s, cfg, { source, score: cfg.anti_gaming.min_quality_score, now: at('2026-10-01') }).amount > 0);
    });
  }

  test('duplicate idea gets 0 XP', () => {
    const s = freshState();
    const e = E.award(s, cfg, { source: 'idea', score: 8, duplicate: true, now: at('2026-10-01') });
    assert.equal(e.amount, 0);
    assert.ok(e.notes.includes('duplicate'));
  });

  test('unknown source throws', () => {
    assert.throws(() => E.award(freshState(), cfg, { source: 'nope' }));
  });

  test('reflection needs min words; uncapped', () => {
    const s = freshState();
    assert.equal(E.award(s, cfg, { source: 'reflection', words: 5, now: at('2026-10-01') }).amount, 0);
    assert.equal(E.award(s, cfg, { source: 'reflection', words: 20, now: at('2026-10-01') }).amount, cfg.xp.reflection.base);
  });
});

describe('quality gate and re-submit farming', () => {
  const day = at('2026-10-01');

  test('script is gated like hooks: under min quality score gets 0 XP', () => {
    const s = freshState();
    const low = E.award(s, cfg, { source: 'script', score: cfg.anti_gaming.min_quality_score - 1, words: 40, now: day });
    assert.equal(low.amount, 0);
    assert.ok(low.notes.includes('low_quality'));
    assert.ok(E.award(s, cfg, { source: 'script', score: cfg.anti_gaming.min_quality_score, words: 40, now: day }).amount > 0);
  });

  test('gated_sources comes from config', () => {
    const c = structuredClone(cfg);
    c.anti_gaming.gated_sources = ['idea'];
    assert.equal(E.award(freshState(), c, { source: 'hook', score: 1, now: day }).amount, c.xp.hook.base);
    c.anti_gaming.gated_sources = ['idea', 'hook', 'lesson'];
    assert.equal(E.award(freshState(), c, { source: 'lesson', score: 1, now: day }).amount, 0);
  });

  test('script under min_words gets 0 XP and the too_short note', () => {
    const s = freshState();
    const min = cfg.xp.script.min_words;
    const e = E.award(s, cfg, { source: 'script', score: 8, words: min - 1, now: day });
    assert.equal(e.amount, 0);
    assert.deepEqual(e.notes, ['too_short']);
    assert.ok(E.award(s, cfg, { source: 'script', score: 8, words: min, now: day }).amount > 0);
  });

  test('min_words follows config for any rule', () => {
    const c = structuredClone(cfg);
    c.xp.hook.min_words = 5;
    assert.equal(E.award(freshState(), c, { source: 'hook', score: 6, words: 4, now: day }).amount, 0);
    assert.ok(E.award(freshState(), c, { source: 'hook', score: 6, words: 5, now: day }).amount > 0);
  });

  const rep = (type, content, score) => ({ type, content, feedback: { score } });

  test('isRepeatRep finds near-identical past reps of the same type only', () => {
    const s = freshState();
    s.reps.push(rep('hook', 'This ₹80 dosa beats every brunch', 6), rep('hook', 'This ₹80 dosa beats every brunch!', 8), rep('script', 'Something else entirely', 5));
    const same = E.isRepeatRep('this ₹80 dosa beats every brunch', 'hook', s, cfg);
    assert.deepEqual(same, { repeat: true, bestScore: 8 });
    assert.equal(E.isRepeatRep('this ₹80 dosa beats every brunch', 'rewrite', s, cfg).repeat, false);
    assert.deepEqual(E.isRepeatRep('Why biryani tastes different at weddings', 'hook', s, cfg), { repeat: false, bestScore: 0 });
  });

  test('a repeat that does not beat the best score earns 0 XP with no_change', () => {
    const s = freshState();
    const same = E.award(s, cfg, { source: 'hook', score: 7, repeat: true, bestRepeatScore: 7, now: day });
    assert.equal(same.amount, 0);
    assert.deepEqual(same.notes, ['no_change']);
    assert.equal(E.award(s, cfg, { source: 'hook', score: 5, repeat: true, bestRepeatScore: 7, now: day }).amount, 0);
  });

  test('a repeat that scores higher earns normal XP', () => {
    const e = E.award(freshState(), cfg, { source: 'hook', score: 8, repeat: true, bestRepeatScore: 7, now: day });
    assert.equal(e.amount, cfg.xp.hook.base + cfg.xp.hook.bonus);
  });

  test('non-repeats are untouched by bestRepeatScore', () => {
    assert.ok(E.award(freshState(), cfg, { source: 'hook', score: 5, repeat: false, bestRepeatScore: 9, now: day }).amount > 0);
  });

  test('skills ignore reps that earned nothing and duplicate ideas', () => {
    const s = freshState();
    const good = { type: 'hook', feedback: { score: 5 }, notes: [] };
    s.reps.push(good, { ...good, notes: ['no_change'] }, { ...good, notes: ['low_quality'] }, { ...good, notes: ['too_short'] }, { type: 'hook', feedback: { score: 5 } });
    const hooks = () => E.skills(s, cfg).find(x => x.name === 'hooks').xp;
    assert.equal(hooks(), 10 * 2, 'only the clean rep and the legacy rep without notes count');
    s.ideas.push({ score: 6, duplicate: true }, { score: 6 });
    assert.equal(E.skills(s, cfg).find(x => x.name === 'niche').xp, 6);
  });
});

describe('duplicate detection', () => {
  const ideas = [{ id: 'a', text: 'Best ₹150 street food in Koramangala' }];
  test('identical / reordered text is a duplicate', () => {
    assert.ok(E.isDuplicateIdea('Best ₹150 street food in Koramangala', ideas, cfg));
    assert.ok(E.isDuplicateIdea('best street food in koramangala ₹150!', ideas, cfg));
  });
  test('different idea is not a duplicate', () => {
    assert.ok(!E.isDuplicateIdea('Why everyone orders biryani wrong in Hyderabad', ideas, cfg));
    assert.ok(!E.isDuplicateIdea('Best ₹150 street food in Indiranagar', ideas, cfg), 'one word changed out of 5 tokens is below 0.9');
  });
  test('editing an idea ignores itself', () => {
    assert.ok(!E.isDuplicateIdea('Best ₹150 street food in Koramangala', ideas, cfg, 'a'));
  });
  test('cosine bounds', () => {
    assert.equal(E.cosine('', 'x'), 0);
    assert.ok(Math.abs(E.cosine('chai dosa', 'dosa chai') - 1) < 1e-9);
  });
});

describe('daily cap', () => {
  test('practice XP stops at 300 per local day, partial award at the edge', () => {
    const s = freshState();
    const day = at('2026-10-01');
    let total = 0, last;
    for (let i = 0; i < 20; i++) { last = E.award(s, cfg, { source: 'script', score: 9, words: 60, now: day }); total += last.amount; }
    assert.equal(total, cfg.daily_practice_cap);
    assert.equal(E.practiceXPOn(s, cfg, '2026-10-01'), 300);
    assert.equal(last.amount, 0);
    assert.ok(last.notes.includes('daily_cap'));
    // 300 / 35 -> 8 full awards (280), then a partial 20
    const partial = s.ledger.find(e => e.notes.includes('daily_cap') && e.amount > 0);
    assert.equal(partial.amount, 20);
  });
  test('cap resets the next local day', () => {
    const s = freshState();
    for (let i = 0; i < 20; i++) E.award(s, cfg, { source: 'script', score: 9, words: 60, now: at('2026-10-01') });
    assert.equal(E.award(s, cfg, { source: 'hook', score: 5, now: at('2026-10-02', 0) + 60000 }).amount, 10);
  });
  test('posting and reflection are not capped', () => {
    const s = freshState();
    for (let i = 0; i < 20; i++) E.award(s, cfg, { source: 'script', score: 9, words: 60, now: at('2026-10-01') });
    assert.equal(E.award(s, cfg, { source: 'post', hitsWeeklyGoal: true, now: at('2026-10-01') }).amount, cfg.xp.post.base + cfg.xp.post.bonus);
    assert.equal(E.award(s, cfg, { source: 'post', now: at('2026-10-01') }).amount, cfg.xp.post.base);
    assert.equal(E.award(s, cfg, { source: 'reflection', words: 30, now: at('2026-10-01') }).amount, cfg.xp.reflection.base);
  });
  test('a reversal does not free up cap room', () => {
    const s = freshState();
    const first = E.award(s, cfg, { source: 'script', score: 9, words: 60, now: at('2026-10-01') });
    for (let i = 0; i < 20; i++) E.award(s, cfg, { source: 'script', score: 9, words: 60, now: at('2026-10-02') });
    E.reverse(s, first.id, at('2026-10-02'));
    assert.equal(E.award(s, cfg, { source: 'hook', score: 9, now: at('2026-10-02') }).amount, 0);
  });
  test('lessons count toward the cap', () => {
    const s = freshState();
    for (let i = 0; i < 20; i++) E.award(s, cfg, { source: 'script', score: 9, words: 60, now: at('2026-10-01') });
    assert.equal(E.award(s, cfg, { source: 'lesson', now: at('2026-10-01') }).amount, 0);
  });
});

describe('ledger', () => {
  test('append-only: reversal is a new negative row, original amount untouched', () => {
    const s = freshState();
    const e = E.award(s, cfg, { source: 'script', score: 9, words: 60, now: at('2026-10-01') });
    const snapshot = JSON.stringify(e);
    const r = E.reverse(s, e.id, at('2026-10-02'));
    assert.equal(s.ledger.length, 2);
    assert.equal(r.amount, -e.amount);
    assert.equal(r.reverses, e.id);
    assert.equal(r.reason, 'reversal');
    assert.equal(JSON.stringify(s.ledger[0]), snapshot, 'original row is never edited');
    assert.ok(E.isReversed(s, e.id));
    assert.equal(E.reverse(s, r.id), null, 'cannot reverse a reversal');
    assert.equal(E.totalXP(s), 0);
    assert.equal(E.reverse(s, e.id), null, 'cannot reverse twice');
    assert.equal(E.reverse(s, 'missing'), null);
  });
  test('entries have the ledger shape', () => {
    const e = E.award(freshState(), cfg, { source: 'hook', score: 8, sourceId: 'rep1', now: at('2026-10-01') });
    for (const k of ['id', 'amount', 'reason', 'source_type', 'source_id', 'created_at', 'day']) assert.ok(k in e, k);
    assert.equal(e.day, '2026-10-01');
    assert.equal(e.source_id, 'rep1');
  });
  test('reversal does not count as an active streak day, and a reversed award stops counting', () => {
    const s = freshState();
    const e = E.award(s, cfg, { source: 'hook', score: 8, now: at('2026-10-02') });
    assert.ok(E.dailyStreak(s, cfg, at('2026-10-02')).activeToday);
    E.reverse(s, e.id, at('2026-10-02'));
    assert.ok(!E.dailyStreak(s, cfg, at('2026-10-02')).activeToday);
  });
});

describe('levels', () => {
  const step = cfg.levels.step;
  const cases = [[0, 1], [step - 1, 1], [step, 2], [3 * step - 1, 2], [3 * step, 3], [6 * step - 1, 3], [6 * step, 4], [10 * step, 5]];
  for (const [xp, level] of cases) {
    test(`${xp} XP is level ${level}`, () => assert.equal(E.levelFor(xp, cfg).level, level));
  }
  test('floor/next/into/span are consistent', () => {
    const l = E.levelFor(150, cfg);
    assert.deepEqual([l.floor, l.next, l.into, l.span], [100, 300, 50, 200]);
  });
});

describe('daily streak', () => {
  function activeOn(s, days) { days.forEach(d => E.award(s, cfg, { source: 'hook', score: 6, now: at(d) })); }
  function range(start, n) { const out = []; let d = start; for (let i = 0; i < n; i++) { out.push(d); d = E.addDays(d, 1); } return out; }

  test('empty ledger', () => {
    const st = E.dailyStreak(freshState(), cfg, at('2026-10-01'));
    assert.equal(st.current, 0); assert.equal(st.freezes, 0); assert.equal(st.activeToday, false);
  });
  test('first rep today is day 1', () => {
    const s = freshState(); activeOn(s, ['2026-10-01']);
    const st = E.dailyStreak(s, cfg, at('2026-10-01', 20));
    assert.equal(st.current, 1); assert.ok(st.activeToday);
  });
  test('today not active yet does not break the streak', () => {
    const s = freshState(); activeOn(s, range('2026-10-01', 3));
    const st = E.dailyStreak(s, cfg, at('2026-10-04', 23));
    assert.equal(st.current, 3); assert.equal(st.activeToday, false);
  });
  test('missed day without freeze breaks the streak', () => {
    const s = freshState(); activeOn(s, range('2026-10-01', 3)); // 1..3, miss 4
    const st = E.dailyStreak(s, cfg, at('2026-10-05'));
    assert.equal(st.current, 0); assert.equal(st.lastBrokenRun, 3); assert.equal(st.brokeOn, '2026-10-04');
    assert.equal(st.longest, 3);
  });
  test('7-day run earns one freeze, auto-applied on a missed day', () => {
    const s = freshState(); activeOn(s, range('2026-10-01', 7));
    assert.equal(E.dailyStreak(s, cfg, at('2026-10-07')).freezes, 1);
    activeOn(s, ['2026-10-09']); // missed 10-08
    const st = E.dailyStreak(s, cfg, at('2026-10-09'));
    assert.equal(st.current, 8); assert.equal(st.freezes, 0); assert.deepEqual(st.frozenDays, ['2026-10-08']);
  });
  test('max 2 freezes held', () => {
    const s = freshState(); activeOn(s, range('2026-10-01', 28));
    assert.equal(E.dailyStreak(s, cfg, at('2026-10-28')).freezes, 2);
  });
  test('two freezes cover two missed days, third missed day breaks', () => {
    const s = freshState(); activeOn(s, range('2026-10-01', 14)); // to 10-14, 2 freezes
    assert.equal(E.dailyStreak(s, cfg, at('2026-10-16')).current, 14); // 10-15 frozen, 10-16 is today
    assert.equal(E.dailyStreak(s, cfg, at('2026-10-17')).current, 14); // 15,16 frozen
    const st = E.dailyStreak(s, cfg, at('2026-10-18')); // 17 missed, no freezes
    assert.equal(st.current, 0); assert.equal(st.lastBrokenRun, 14);
  });
  test('streak counts in local days (late-night and early-morning reps are different days)', () => {
    const s = freshState();
    E.award(s, cfg, { source: 'hook', score: 6, now: at('2026-10-01', 23) + 50 * 60000 });
    E.award(s, cfg, { source: 'hook', score: 6, now: at('2026-10-02', 0) + 10 * 60000 });
    assert.deepEqual(s.ledger.map(e => e.day), ['2026-10-01', '2026-10-02']);
    assert.equal(E.dailyStreak(s, cfg, at('2026-10-02')).current, 2);
  });
  test('0-XP reps do not count as active days', () => {
    const s = freshState();
    E.award(s, cfg, { source: 'hook', score: 1, now: at('2026-10-01') });
    assert.equal(E.dailyStreak(s, cfg, at('2026-10-01')).current, 0);
  });
  test('hoursLeftToday', () => {
    assert.equal(E.hoursLeftToday(at('2026-10-01', 22)), 2);
  });
});

describe('tiers', () => {
  test('new user is Starter', () => {
    const t = E.tier(freshState(), cfg);
    assert.equal(t.current.id, 'starter'); assert.equal(t.current.name, 'Starter');
  });
  test('Poster after first verified post', () => {
    const s = freshState(); s.posts = [{ verified: true, views: 10 }];
    assert.equal(E.tier(s, cfg).current.id, 'poster');
    s.posts = [{ verified: false, views: 50000 }];
    assert.equal(E.tier(s, cfg).current.id, 'starter', 'unverified posts do not count');
  });
  function scoredReps(n, score) { return Array.from({ length: n }, () => ({ type: 'hook', feedback: { score } })); }
  test('Gig-ready needs breakout + consistent + avg >= 7', () => {
    const s = freshState();
    s.posts = [{ verified: true, views: 12000 }]; s.weeklyGoalStreak = 4; s.reps = scoredReps(10, 7);
    assert.equal(E.tier(s, cfg).current.id, 'gig_ready');
    s.reps = scoredReps(10, 6);
    assert.notEqual(E.tier(s, cfg).current.id, 'gig_ready');
    s.reps = scoredReps(10, 8); s.weeklyGoalStreak = 3;
    assert.notEqual(E.tier(s, cfg).current.id, 'gig_ready');
    s.weeklyGoalStreak = 4; s.posts = [{ verified: true, views: 9999 }]; s.followers = 999;
    assert.notEqual(E.tier(s, cfg).current.id, 'gig_ready');
    s.followers = 1000;
    assert.equal(E.tier(s, cfg).current.id, 'gig_ready');
    s.fraudFlags = 1;
    assert.notEqual(E.tier(s, cfg).reached.gig_ready, true);
  });
  describe('thresholds come from config', () => {
    const verified = views => { const s = freshState(); s.posts = [{ verified: true, views }]; return s; };
    const mod = fn => { const c = structuredClone(cfg); fn(id => c.tiers.find(t => t.id === id)); return c; };
    test('rising and breakout views / followers', () => {
      assert.equal(E.tier(verified(1000), cfg).current.id, 'rising');
      assert.equal(E.tier(verified(999), cfg).current.id, 'poster');
      assert.equal(E.tier(verified(999), mod(t => { t('rising').min_best_views = 500; })).current.id, 'rising');
      assert.equal(E.tier(verified(10000), cfg).current.id, 'breakout');
      assert.equal(E.tier(verified(10000), mod(t => { t('breakout').min_best_views = 20000; })).current.id, 'rising');
      const s = freshState(); s.followers = 100;
      assert.equal(E.tier(s, cfg).current.id, 'rising');
      assert.equal(E.tier(s, mod(t => { t('rising').min_followers = 150; })).current.id, 'starter');
      s.followers = 1000;
      assert.equal(E.tier(s, mod(t => { t('breakout').min_followers = 5000; })).current.id, 'rising');
    });
    test('consistent goal weeks', () => {
      const s = freshState(); s.weeklyGoalStreak = 3;
      assert.equal(E.tier(s, cfg).reached.consistent, false);
      assert.equal(E.tier(s, mod(t => { t('consistent').goal_weeks = 3; })).reached.consistent, true);
    });
    test('gig-ready average score and window', () => {
      const s = verified(12000); s.weeklyGoalStreak = 4;
      s.reps = [...scoredReps(10, 1), ...scoredReps(5, 9)];
      assert.equal(E.tier(s, cfg).reached.gig_ready, false, 'last 10 average is 5');
      assert.equal(E.tier(s, mod(t => { t('gig_ready').avg_over_reps = 5; })).reached.gig_ready, true);
      s.reps = scoredReps(10, 6);
      assert.equal(E.tier(s, mod(t => { t('gig_ready').min_avg_score = 6; })).reached.gig_ready, true);
    });
  });
  test('average uses only the last 10 graded reps', () => {
    const s = freshState();
    s.posts = [{ verified: true, views: 12000 }]; s.weeklyGoalStreak = 4;
    s.reps = [...scoredReps(20, 1), ...scoredReps(10, 8)];
    assert.equal(E.tier(s, cfg).current.id, 'gig_ready');
  });
  test('tiers only go up (highestTier held)', () => {
    const s = freshState(); s.highestTier = 'rising';
    assert.equal(E.tier(s, cfg).current.id, 'rising');
  });
});

describe('skills, badges, league', () => {
  test('six skills, capped at 5 levels', () => {
    const s = freshState();
    s.reps = Array.from({ length: 100 }, () => ({ type: 'hook', feedback: { score: 10 } }));
    const sk = E.skills(s, cfg);
    assert.equal(sk.length, 6);
    const hooks = sk.find(x => x.name === 'hooks');
    assert.equal(hooks.level, cfg.skills.levels); assert.ok(hooks.maxed);
    assert.equal(sk.find(x => x.name === 'editing').xp, 0);
  });
  test('badges', () => {
    const s = freshState();
    assert.ok(E.badges(s, cfg, at('2026-10-01')).every(b => !b.earned));
    E.award(s, cfg, { source: 'hook', score: 6, now: at('2026-10-01') });
    assert.ok(E.badges(s, cfg, at('2026-10-01')).find(b => b.id === 'first_xp').earned);
  });
  test('league has ~30 members, user included, deterministic', () => {
    const s = freshState();
    const a = E.league(s, cfg, at('2026-10-01')), b = E.league(s, cfg, at('2026-10-01'));
    assert.equal(a.size, cfg.leagues.cohort_size);
    assert.equal(a.members.filter(m => m.you).length, 1);
    assert.deepEqual(a.members, b.members);
    assert.ok(['promote', 'stay', 'demote'].includes(a.zone));
    assert.equal(a.division, 'Bronze');
  });
  test('weekStart is Monday', () => {
    assert.equal(E.weekStart(at('2026-10-17')), '2026-10-12'); // Saturday -> Monday
    assert.equal(E.weekStart(at('2026-10-12')), '2026-10-12');
    assert.equal(E.weekStart(at('2026-10-18')), '2026-10-12'); // Sunday
  });
});

describe('quiet hours and streak-at-risk window', () => {
  const withQuiet = (quietStart, quietEnd, extra) => ({ quietStart, quietEnd, ...extra });
  const hm = h => h * 60;

  test('quietWindow uses config defaults, user overrides win', () => {
    assert.deepEqual(E.quietWindow(cfg, {}), { start: hm(22), end: hm(8) });
    assert.deepEqual(E.quietWindow(cfg, withQuiet('23:30', '07:15')), { start: hm(23) + 30, end: hm(7) + 15 });
    assert.deepEqual(E.quietWindow(cfg, undefined), { start: hm(22), end: hm(8) });
  });

  test('isQuiet wraps past midnight and treats the end as open', () => {
    const q = (day, h, m) => E.isQuiet(cfg, {}, new Date(2026, 9, day, h, m).getTime());
    assert.equal(q(1, 21, 59), false);
    assert.equal(q(1, 22, 0), true);
    assert.equal(q(2, 0, 30), true);
    assert.equal(q(2, 7, 59), true);
    assert.equal(q(2, 8, 0), false);
  });

  test('isQuiet handles a same-day window and start == end', () => {
    const p = withQuiet('13:00', '15:00');
    assert.equal(E.isQuiet(cfg, p, at('2026-10-01', 14)), true);
    assert.equal(E.isQuiet(cfg, p, at('2026-10-01', 15)), false);
    const none = withQuiet('22:00', '22:00');
    for (const h of [0, 12, 22, 23]) assert.equal(E.isQuiet(cfg, none, at('2026-10-01', h)), false);
  });

  test('streak risk starts N hours before quiet start when quiet begins in the evening', () => {
    assert.equal(E.streakRiskStart(cfg, {}), hm(20));
    assert.equal(E.streakRiskStart(cfg, withQuiet('22:00', '08:00')), hm(20));
    assert.equal(E.streakRiskStart(cfg, withQuiet('23:30', '07:00')), hm(21) + 30);
  });

  test('streak risk falls back to midnight when quiet starts after midnight or there are none', () => {
    assert.equal(E.streakRiskStart(cfg, withQuiet('01:00', '06:00')), hm(22));
    assert.equal(E.streakRiskStart(cfg, withQuiet('22:00', '22:00')), hm(22));
  });

  test('streak risk hours come from config', () => {
    const c = structuredClone(cfg);
    c.notifications.streak_risk_hours_before_midnight = 3;
    assert.equal(E.streakRiskStart(c, {}), hm(19));
  });

  test('reminder moves to quiet end when the chosen time is inside quiet hours', () => {
    assert.equal(E.reminderMinutes(cfg, { notifyTime: '19:00' }), hm(19));
    assert.equal(E.reminderMinutes(cfg, { notifyTime: '23:00' }), hm(8));
    assert.equal(E.reminderMinutes(cfg, { notifyTime: '06:30' }), hm(8));
    assert.equal(E.reminderMinutes(cfg, { notifyTime: '23:00', quietStart: '23:30', quietEnd: '07:00' }), hm(23));
  });
});

describe('self-reported posts', () => {
  // Wed 2026-10-14 noon; the week runs Mon 10-12 to Sun 10-18.
  const WED = '2026-10-14', MON = '2026-10-12', now = at(WED);
  const ok = input => E.validatePost({ platform: 'instagram', date: WED, ...input }, cfg, now);
  const bad = (input, re, when = now) => assert.throws(() => E.validatePost(input, cfg, when), re, JSON.stringify(input));

  test('basics: trims, lowercases the platform, stores the manual-post shape', () => {
    const p = E.validatePost({ date: MON, platform: '  YouTube ', format: '  Short  ', note: '  hi  ', views: ' 1840 ', ideaId: 'i1' }, cfg, now);
    assert.match(p.id, /^post_/);
    assert.deepEqual({ ...p, id: undefined, viewsUpdatedAt: undefined }, {
      id: undefined, ideaId: 'i1', date: MON, platform: 'youtube', format: 'Short', views: 1840, viewsUpdatedAt: undefined,
      note: 'hi', source: 'manual', verified: false, loggedOn: WED
    });
    assert.equal(p.viewsUpdatedAt, new Date(now).toISOString());
  });

  test('views are optional: missing, null and empty string all mean none', () => {
    for (const views of [undefined, null, '', '   ']) {
      const p = ok({ views });
      assert.equal(p.views, null);
      assert.equal(p.viewsUpdatedAt, null);
    }
    assert.equal(ok({}).ideaId, null);
  });

  test('format and note are capped after trimming', () => {
    assert.equal(ok({ format: 'a'.repeat(100), note: 'b'.repeat(1000) }).format.length, cfg.posts.format_max);
    assert.equal(ok({ format: 'a'.repeat(100), note: 'b'.repeat(1000) }).note.length, cfg.posts.note_max);
    assert.equal(ok({ note: ' '.repeat(10) + 'c'.repeat(cfg.posts.note_max) }).note, 'c'.repeat(cfg.posts.note_max));
    assert.equal(ok({ note: '   ', format: null }).note, '');
    assert.equal(ok({ format: null }).format, '');
    const long = ok({ note: 'x'.repeat(cfg.posts.note_max - 1) + ' yyyy' });
    assert.equal(long.note, long.note.trim());
  });

  test('platform must be on the list', () => {
    for (const platform of ['tiktok', '', null, undefined, 5, ['youtube'], 'constructor', '__proto__']) bad({ date: MON, platform }, /platform/i);
    bad(null, /platform/i);
    bad(undefined, /platform/i);
  });

  test('date must be a real YYYY-MM-DD, never in the future', () => {
    for (const date of ['2026-02-30', '2026-02-29', '2026-13-01', '', undefined, '01/05/2026', '2026-1-5', ' 2026-10-05']) bad({ platform: 'youtube', date }, /date/i);
    bad({ platform: 'youtube', date: '2026-10-15' }, /future/i);
    bad({ platform: 'youtube', date: '9999-12-31' }, /future/i);
    assert.equal(ok({ date: WED }).date, WED, 'today is fine');
  });

  test('leap day and year boundary', () => {
    const v = (date, today) => E.validatePost({ platform: 'youtube', date }, cfg, at(today));
    assert.equal(v('2028-02-29', '2028-02-29').date, '2028-02-29');
    assert.throws(() => v('2028-02-29', '2028-02-28'), /future/i);
    assert.equal(v('2025-12-31', '2026-01-01').date, '2025-12-31');
    assert.throws(() => v('2026-01-02', '2026-01-01'), /future/i);
  });

  test('"today" is the local day of now, not UTC', () => {
    const lateNight = new Date(2026, 9, 14, 23, 50).getTime();
    assert.equal(E.validatePost({ platform: 'youtube', date: '2026-10-14' }, cfg, lateNight).loggedOn, '2026-10-14');
    assert.throws(() => E.validatePost({ platform: 'youtube', date: '2026-10-15' }, cfg, lateNight), /future/i);
  });

  test('views: whole numbers 0 to max only', () => {
    assert.equal(ok({ views: 0 }).views, 0);
    assert.equal(ok({ views: '0' }).views, 0);
    assert.equal(ok({ views: cfg.posts.max_views }).views, cfg.posts.max_views);
    for (const views of [-1, '-1', 1.5, '1.5', '1e3', 'abc', '1,000', NaN, Infinity, cfg.posts.max_views + 1, true, [5], {}]) bad({ platform: 'youtube', date: MON, views }, /views/i);
  });

  test('validatePost does not touch its input', () => {
    const input = Object.freeze({ platform: ' Instagram', date: WED, format: ' t ', note: ' n ' });
    const out = E.validatePost(input, cfg, now);
    assert.equal(input.note, ' n ');
    assert.equal(out.note, 'n');
  });

  test('config drives the lists and caps', () => {
    const c = structuredClone(cfg);
    c.posts.platforms = ['instagram'];
    c.posts.max_views = 100;
    assert.throws(() => E.validatePost({ platform: 'youtube', date: MON }, c, now), /platform/i);
    assert.throws(() => E.validatePost({ platform: 'instagram', date: MON, views: 101 }, c, now), /100/);
  });

  test('setPostViews adds and updates views, rejects bad input, leaves the ledger alone', () => {
    const s = freshState();
    const p = ok({});
    s.posts.push(p);
    E.setPostViews(p, '2500', cfg, now + 1000);
    assert.equal(p.views, 2500);
    assert.equal(p.viewsUpdatedAt, new Date(now + 1000).toISOString());
    E.setPostViews(p, 0, cfg, now);
    assert.equal(p.views, 0);
    for (const v of ['', null, undefined, '-3', 'x', 1.2, cfg.posts.max_views + 1]) assert.throws(() => E.setPostViews(p, v, cfg, now), /view/i);
    assert.equal(p.views, 0, 'failed update leaves the old value');
    assert.equal(s.ledger.length, 0);
  });

  test('setPostPlatform fills in a migrated post', () => {
    const p = { platform: null };
    assert.equal(E.setPostPlatform(p, 'YouTube', cfg).platform, 'youtube');
    assert.throws(() => E.setPostPlatform(p, 'tiktok', cfg), /platform/i);
  });

  test('a manual post with 2,000,000 views gives no XP, streak, tier or ledger row', () => {
    const s = freshState();
    s.posts.push(E.validatePost({ platform: 'instagram', date: WED, format: 'Reel', views: 2000000 }, cfg, now));
    assert.equal(E.totalXP(s), 0);
    assert.equal(s.ledger.length, 0);
    assert.equal(E.tier(s, cfg).current.id, 'starter');
    assert.equal(E.dailyStreak(s, cfg, now).current, 0);
    assert.equal(E.weeklyXP(s, now), 0);
    assert.equal(E.league(s, cfg, now).members.find(m => m.you).xp, 0);
  });

  test('postsInWeek: Monday to Sunday inclusive, by the date posted', () => {
    const day = d => ({ date: d });
    const s = freshState();
    s.posts = ['2026-10-11', '2026-10-12', '2026-10-14', '2026-10-18', '2026-10-19'].map(day);
    assert.deepEqual(E.postsInWeek(s, now).map(p => p.date), ['2026-10-12', '2026-10-14', '2026-10-18']);
    assert.equal(E.postsInWeek(s, at('2026-10-18', 23)).length, 3, 'Sunday night is still the same week');
    assert.equal(E.postsInWeek(s, at('2026-10-19', 0)).length, 1, 'Monday starts a new week');
    assert.equal(E.postsInWeek(freshState(), now).length, 0);
    assert.equal(E.postsInWeek({}, now).length, 0);
  });

  test('migrate: a post for each posted idea, once, with the date it was posted', () => {
    const s = freshState();
    s.v = 1;
    s.ideas = [
      { id: 'a', stage: 'posted', created_at: '2026-10-01T10:00:00.000Z', history: [{ stage: 'idea', at: '2026-10-01T10:00:00.000Z' }, { stage: 'posted', at: new Date(2026, 9, 10, 12).toISOString() }] },
      { id: 'b', stage: 'filmed', history: [] },
      { id: 'c', stage: 'posted', history: [{ stage: 'posted', at: new Date(2026, 9, 11, 12).toISOString() }] }
    ];
    s.posts = [{ id: 'old', ideaId: 'c', date: '2026-10-11', platform: 'youtube', source: 'manual' }];
    E.migrate(s);
    assert.equal(s.v, 2);
    assert.equal(s.posts.length, 2);
    const made = s.posts.find(p => p.ideaId === 'a');
    assert.deepEqual({ ...made, id: undefined }, { id: undefined, ideaId: 'a', date: '2026-10-10', platform: null, format: '', views: null, viewsUpdatedAt: null, note: '', source: 'manual', verified: false, loggedOn: '2026-10-10' });
    const snap = JSON.stringify(s);
    E.migrate(s);
    assert.equal(JSON.stringify(s), snap, 'idempotent');
    assert.equal(E.totalXP(s), 0);
  });

  test('migrate tolerates old state with no posts array', () => {
    const s = { ideas: [], ledger: [] };
    E.migrate(s);
    assert.deepEqual(s.posts, []);
    assert.equal(s.v, 2);
  });
});

describe("what's working (postInsights)", () => {
  const TODAY = '2026-10-14', now = at(TODAY);
  const post = (daysAgo, platform, format, views) => ({ date: E.addDays(TODAY, -daysAgo), platform, format, views });
  const run = posts => E.postInsights({ ...freshState(), posts }, cfg, now);

  test('median per platform and format, sorted by median desc', () => {
    const r = run([post(1, 'instagram', 'Reel', 100), post(2, 'instagram', 'Reel', 300), post(3, 'instagram', 'Reel', 200), post(1, 'youtube', 'Short', 900), post(2, 'youtube', 'Short', 1100)]);
    assert.deepEqual(r.groups.map(g => [g.platform, g.format, g.posts, g.median]), [['youtube', 'Short', 2, 1000], ['instagram', 'Reel', 3, 200]]);
  });

  test('window edges: last window_days days including today; older and future posts ignored', () => {
    const edge = cfg.insights.window_days - 1;
    const r = run([post(edge, 'instagram', 'Reel', 10), post(0, 'instagram', 'Reel', 20), post(edge + 1, 'instagram', 'Reel', 5000), post(-1, 'instagram', 'Reel', 7000)]);
    assert.equal(r.groups.length, 1);
    assert.equal(r.groups[0].posts, 2);
    assert.equal(r.groups[0].median, 15);
    assert.equal(r.best.views, 20);
  });

  test('window follows config', () => {
    const c = structuredClone(cfg);
    c.insights.window_days = 3;
    const r = E.postInsights({ posts: [post(2, 'instagram', 'Reel', 10), post(3, 'instagram', 'Reel', 30), post(0, 'instagram', 'Reel', 20)] }, c, now);
    assert.equal(r.groups[0].posts, 2);
  });

  test('posts without a numeric view count are ignored', () => {
    const r = run([post(1, 'instagram', 'Reel', null), post(1, 'instagram', 'Reel', undefined), post(1, 'instagram', 'Reel', '500'), post(2, 'instagram', 'Reel', 40), post(3, 'instagram', 'Reel', 60)]);
    assert.deepEqual(r.groups.map(g => [g.posts, g.median]), [[2, 50]]);
    assert.deepEqual(run([post(1, 'instagram', 'Reel', null)]), { groups: [], best: null, windowDays: cfg.insights.window_days });
  });

  test('groups smaller than min_posts_per_format are dropped but can still be the best post', () => {
    const r = run([post(1, 'instagram', 'Reel', 5000), post(1, 'youtube', 'Short', 10), post(2, 'youtube', 'Short', 20)]);
    assert.deepEqual(r.groups.map(g => g.format), ['Short']);
    assert.equal(r.best.views, 5000);
    const c = structuredClone(cfg);
    c.insights.min_posts_per_format = 1;
    assert.equal(E.postInsights({ posts: [post(1, 'instagram', 'Reel', 5)] }, c, now).groups.length, 1);
  });

  test('even-count median rounds half up', () => {
    assert.equal(run([post(1, 'instagram', 'Reel', 1), post(2, 'instagram', 'Reel', 2)]).groups[0].median, 2);
    assert.equal(run([post(1, 'instagram', 'Reel', 10), post(2, 'instagram', 'Reel', 20), post(3, 'instagram', 'Reel', 30), post(4, 'instagram', 'Reel', 41)]).groups[0].median, 25);
  });

  test('ties sort by post count, then key', () => {
    const r = run([
      post(1, 'youtube', 'Video', 100), post(2, 'youtube', 'Video', 100),
      post(1, 'instagram', 'Reel', 100), post(2, 'instagram', 'Reel', 100), post(3, 'instagram', 'Reel', 100),
      post(1, 'instagram', 'Carousel', 100), post(2, 'instagram', 'Carousel', 100)
    ]);
    assert.deepEqual(r.groups.map(g => g.key), ['instagram|reel', 'instagram|carousel', 'youtube|video']);
  });

  test('format casing groups together; unknown platforms are skipped; no format is its own group', () => {
    const r = run([post(1, 'instagram', 'Reel', 10), post(2, 'instagram', 'reel', 30), post(1, 'tiktok', 'Reel', 999), post(1, 'youtube', '', 5), post(2, 'youtube', '', 7)]);
    assert.deepEqual(r.groups.map(g => [g.key, g.posts]), [['instagram|reel', 2], ['youtube|', 2]]);
    assert.equal(r.best.views, 30);
  });

  test('best post is the highest views; ties go to the most recent', () => {
    const r = run([post(5, 'instagram', 'Reel', 900), post(1, 'youtube', 'Short', 900), post(2, 'youtube', 'Short', 100)]);
    assert.equal(r.best.platform, 'youtube');
    assert.equal(r.best.date, E.addDays(TODAY, -1));
  });

  test('no posts', () => {
    assert.deepEqual(run([]), { groups: [], best: null, windowDays: cfg.insights.window_days });
  });
});

describe('48-hour views prompt (postNeedingViews)', () => {
  const now = at('2026-10-15');
  const post = (id, date, over) => ({ id, date, platform: 'instagram', format: 'Reel', views: null, source: 'manual', verified: false, ...over });
  const pick = (posts, c = cfg, t = now) => E.postNeedingViews({ ...freshState(), posts }, c, t);

  test('picks the oldest manual post at least views_prompt_after_days old with no views', () => {
    assert.equal(cfg.insights.views_prompt_after_days, 2);
    assert.equal(pick([post('a', '2026-10-14'), post('b', '2026-10-13'), post('c', '2026-10-10'), post('d', '2026-10-09')]).id, 'd');
  });

  test('boundary: exactly two days old counts, one day old does not', () => {
    assert.equal(pick([post('a', '2026-10-13')]).id, 'a');
    assert.equal(pick([post('a', '2026-10-14'), post('b', '2026-10-15')]), null);
  });

  test('skips posts that already have views (zero counts as an answer), verified posts and bad dates', () => {
    assert.equal(pick([post('a', '2026-10-01', { views: 0 }), post('b', '2026-10-01', { views: 50 }), post('c', '2026-10-01', { verified: true }), post('d', '2026-10-01', { date: 'nope' })]), null);
  });

  test('works for migrated posts with no platform, and follows config', () => {
    assert.equal(pick([post('a', '2026-10-13', { platform: null })]).id, 'a');
    const c = structuredClone(cfg);
    c.insights.views_prompt_after_days = 5;
    assert.equal(pick([post('a', '2026-10-13')], c), null);
    assert.equal(pick([post('a', '2026-10-10')], c).id, 'a');
  });

  test('empty or missing posts', () => {
    assert.equal(pick([]), null);
    assert.equal(E.postNeedingViews({}, cfg, now), null);
  });

  test('answering it with setPostViews clears the prompt without touching XP', () => {
    const s = { ...freshState(), posts: [post('a', '2026-10-12')] };
    E.setPostViews(E.postNeedingViews(s, cfg, now), 900, cfg, now);
    assert.equal(E.postNeedingViews(s, cfg, now), null);
    assert.equal(s.ledger.length, 0);
  });
});
