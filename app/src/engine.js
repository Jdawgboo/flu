/* LockIn gamification engine.
 * Pure functions over (state, config, now). The XP ledger is append-only and every
 * other number (totals, streaks, levels, skills, tiers) is derived from it.
 * In Phase 1 this runs on the device; when services/api exists it moves server-side
 * unchanged so the client can no longer write XP. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LIEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DAY_MS = 86400000;

  function pad(n) { return String(n).padStart(2, '0'); }

  // Local calendar day as YYYY-MM-DD, so streaks follow the user's timezone.
  function localDay(date) {
    const d = new Date(date);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function dayToDate(day) {
    const [y, m, d] = day.split('-').map(Number);
    return new Date(y, m - 1, d, 12);
  }

  function addDays(day, n) {
    const d = dayToDate(day);
    d.setDate(d.getDate() + n);
    return localDay(d);
  }

  // Monday of the week containing `date` (leagues and weekly goals run Monday to Sunday).
  function weekStart(date) {
    const d = dayToDate(localDay(date));
    const dow = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - dow);
    return localDay(d);
  }

  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // ---------- text similarity (stand-in for pgvector embeddings) ----------

  const STOP = new Set('a an the and or but of to in on for with at by from is are was were be been it this that these those my your our i you we they he she me us them as so if than then just very can will do does did how what why when who about into over out up down not no yes hai ka ki ke ko se me mein aur ye yeh woh wo bhi to toh'.split(' '));

  function tokens(text) {
    return String(text || '').toLowerCase().replace(/[^a-z0-9₹ऀ-ॿ\s]/g, ' ').split(/\s+/).filter(t => t && !STOP.has(t));
  }

  function cosine(a, b) {
    const ta = tokens(a), tb = tokens(b);
    if (!ta.length || !tb.length) return 0;
    const fa = {}, fb = {};
    ta.forEach(t => { fa[t] = (fa[t] || 0) + 1; });
    tb.forEach(t => { fb[t] = (fb[t] || 0) + 1; });
    let dot = 0, na = 0, nb = 0;
    for (const k in fa) { na += fa[k] * fa[k]; if (fb[k]) dot += fa[k] * fb[k]; }
    for (const k in fb) nb += fb[k] * fb[k];
    return dot / Math.sqrt(na * nb);
  }

  function isDuplicateIdea(text, ideas, cfg, ignoreId) {
    const limit = cfg.anti_gaming.duplicate_similarity;
    return (ideas || []).some(i => i.id !== ignoreId && cosine(text, i.text) > limit);
  }

  /* Has this exact piece of work been done before? Looks at past reps of the same type
   * and returns the best score any near-identical one got, so a resubmit only earns XP
   * if it improves on that. */
  function isRepeatRep(text, type, state, cfg) {
    const limit = cfg.anti_gaming.duplicate_similarity;
    let repeat = false, bestScore = 0;
    (state.reps || []).forEach(r => {
      if (r.type !== type || cosine(text, r.content) <= limit) return;
      repeat = true;
      bestScore = Math.max(bestScore, r.feedback ? r.feedback.score : 0);
    });
    return { repeat, bestScore };
  }

  // ---------- XP ledger ----------

  function practiceXPOn(state, cfg, day) {
    const capped = new Set(cfg.capped_sources);
    // Reversals don't free up cap room, so reversing yesterday's XP can't be farmed today.
    return state.ledger.filter(e => e.day === day && capped.has(e.source_type) && !e.reverses).reduce((s, e) => s + e.amount, 0);
  }

  /* Work out the XP for one action and append it to the ledger.
   * opts: { source, sourceId, score, duplicate, words, repeat, bestRepeatScore, hitsWeeklyGoal, now }
   * Returns the ledger entry plus why the amount is what it is. */
  function award(state, cfg, opts) {
    const now = opts.now || Date.now();
    const day = localDay(now);
    const rule = cfg.xp[opts.source];
    if (!rule) throw new Error('No XP rule for ' + opts.source);

    let amount = rule.base;
    let reason = opts.source;
    const notes = [];

    const gated = cfg.anti_gaming.gated_sources.includes(opts.source);
    if (gated && typeof opts.score === 'number' && opts.score < cfg.anti_gaming.min_quality_score) {
      amount = 0; notes.push('low_quality');
    } else if (opts.source === 'idea' && opts.duplicate) {
      amount = 0; notes.push('duplicate');
    } else if (rule.min_words && (opts.words || 0) < rule.min_words) {
      amount = 0; notes.push('too_short');
    } else if (opts.repeat && typeof opts.score === 'number' && opts.score <= (opts.bestRepeatScore || 0)) {
      amount = 0; notes.push('no_change');
    } else {
      if (rule.bonus && typeof opts.score === 'number' && opts.score >= rule.bonus_min_score) {
        amount += rule.bonus; notes.push('quality_bonus');
      }
      if (opts.source === 'post' && opts.hitsWeeklyGoal) { amount += rule.bonus; notes.push('weekly_goal_bonus'); }
    }

    if (cfg.capped_sources.includes(opts.source) && amount > 0) {
      const room = Math.max(0, cfg.daily_practice_cap - practiceXPOn(state, cfg, day));
      if (amount > room) { amount = room; notes.push('daily_cap'); }
    }

    const entry = {
      id: uid('xp'), amount, reason, notes,
      source_type: opts.source, source_id: opts.sourceId || null,
      created_at: new Date(now).toISOString(), day
    };
    state.ledger.push(entry);
    return entry;
  }

  // Reversals are new rows, never edits: the original row is left untouched and a
  // reversal points back at it with `reverses`.
  function isReversed(state, entryId) { return state.ledger.some(x => x.reverses === entryId); }

  function reverse(state, entryId, now) {
    const e = state.ledger.find(x => x.id === entryId);
    if (!e || e.reverses || isReversed(state, entryId)) return null;
    const t = now || Date.now();
    const r = { id: uid('xp'), amount: -e.amount, reason: 'reversal', notes: [], source_type: e.source_type, source_id: e.source_id, created_at: new Date(t).toISOString(), day: localDay(t), reverses: e.id };
    state.ledger.push(r);
    return r;
  }

  function totalXP(state) { return state.ledger.reduce((s, e) => s + e.amount, 0); }

  function xpBetween(state, fromDay, toDay) {
    return state.ledger.filter(e => e.day >= fromDay && e.day <= toDay).reduce((s, e) => s + e.amount, 0);
  }

  function weeklyXP(state, now) {
    const start = weekStart(now);
    return xpBetween(state, start, addDays(start, 6));
  }

  function levelFor(xp, cfg) {
    const step = cfg.levels.step;
    let n = 1;
    while (step * (n + 1) * n / 2 <= xp) n++;
    const floor = step * n * (n - 1) / 2, next = step * (n + 1) * n / 2;
    return { level: n, floor, next, into: xp - floor, span: next - floor };
  }

  // ---------- streaks ----------

  /* Daily streak with automatic freezes.
   * A day counts when at least one action earned XP that local day. */
  function dailyStreak(state, cfg, now) {
    const today = localDay(now || Date.now());
    const reversed = new Set(state.ledger.filter(e => e.reverses).map(e => e.reverses));
    const active = new Set(state.ledger.filter(e => e.amount > 0 && e.reason !== 'reversal' && !reversed.has(e.id)).map(e => e.day));
    const days = [...active].sort();
    const out = { current: 0, longest: 0, freezes: 0, activeToday: active.has(today), frozenDays: [], lastBrokenRun: 0, brokeOn: null };
    if (!days.length) return out;

    const S = cfg.streaks;
    let run = 0, freezes = 0;
    for (let d = days[0]; d <= today; d = addDays(d, 1)) {
      if (active.has(d)) {
        run++;
        if (run % S.freeze_every_days === 0 && freezes < S.max_freezes) freezes++;
      } else if (d === today) {
        // The day isn't over yet; the run is still alive.
      } else if (run > 0 && freezes > 0) {
        freezes--; out.frozenDays.push(d);
      } else if (run > 0) {
        out.lastBrokenRun = run; out.brokeOn = d; run = 0;
      }
      out.longest = Math.max(out.longest, run);
    }
    out.current = run;
    out.freezes = freezes;
    return out;
  }

  // Hours left in the user's local day; used for the streak-at-risk nudge.
  function hoursLeftToday(now) {
    const d = new Date(now || Date.now());
    const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    return (end - d) / 3600000;
  }

  // ---------- quiet hours and the streak-at-risk window ----------

  function toMinutes(hhmm) {
    const [h, m] = String(hhmm || '0:0').split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  }

  function minutesOfDay(now) {
    const d = new Date(now == null ? Date.now() : now);
    return d.getHours() * 60 + d.getMinutes();
  }

  // Quiet hours as minutes after midnight; the user's own times win over the config defaults.
  function quietWindow(cfg, profile) {
    const N = cfg.notifications, p = profile || {};
    return { start: toMinutes(p.quietStart || N.quiet_start), end: toMinutes(p.quietEnd || N.quiet_end) };
  }

  function isQuietAt(cfg, profile, minutes) {
    const { start, end } = quietWindow(cfg, profile);
    if (start === end) return false; // same start and end means no quiet hours
    return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
  }

  function isQuiet(cfg, profile, now) { return isQuietAt(cfg, profile, minutesOfDay(now)); }

  /* When the streak-at-risk nudge starts, in minutes after midnight. It goes out N hours
   * before the day ends; when quiet hours begin in the afternoon or evening and run past
   * midnight, the day effectively ends at quiet start, or the nudge would never be sent. */
  function streakRiskStart(cfg, profile) {
    const { start, end } = quietWindow(cfg, profile);
    const dayEnd = start > end && start >= 720 ? start : 1440;
    return dayEnd - cfg.notifications.streak_risk_hours_before_midnight * 60;
  }

  // The daily reminder goes at the user's time, or at quiet end when that time falls inside quiet hours.
  function reminderMinutes(cfg, profile) {
    const at = toMinutes(profile && profile.notifyTime);
    return isQuietAt(cfg, profile, at) ? quietWindow(cfg, profile).end : at;
  }

  // ---------- skills, tiers, badges ----------

  // Reps that earned nothing for these reasons don't train skills either.
  const NO_SKILL_NOTES = ['low_quality', 'no_change', 'duplicate', 'too_short'];

  function skills(state, cfg) {
    const S = cfg.skills;
    const xp = {};
    S.names.forEach(n => { xp[n] = 0; });
    (state.reps || []).forEach(r => {
      if ((r.notes || []).some(n => NO_SKILL_NOTES.includes(n))) return;
      const trained = S.trained_by[r.type] || [];
      const gain = r.feedback ? Math.round(r.feedback.score * 2) : 0;
      trained.forEach(s => { xp[s] += gain; });
    });
    (state.ideas || []).forEach(i => {
      if (i.duplicate) return;
      (S.trained_by.idea || []).forEach(s => { xp[s] += Math.round((i.score || 0)); });
    });
    return S.names.map(name => {
      const level = Math.min(S.levels, Math.floor(xp[name] / S.xp_per_level));
      return { name, xp: xp[name], level, into: xp[name] - level * S.xp_per_level, span: S.xp_per_level, maxed: level >= S.levels };
    });
  }

  function recentAverageScore(state, n) {
    const scored = (state.reps || []).filter(r => r.feedback).slice(-n);
    if (!scored.length) return 0;
    return scored.reduce((s, r) => s + r.feedback.score, 0) / scored.length;
  }

  /* Results-based tiers, which only go up. Posts and follower counts arrive from the
   * platform connectors in Phase 2; until then everyone is Starter. */
  function tier(state, cfg) {
    const posts = (state.posts || []).filter(p => p.verified);
    const followers = state.followers || 0;
    const best = posts.reduce((m, p) => Math.max(m, p.views || 0), 0);
    const goalWeeks = state.weeklyGoalStreak || 0;
    const row = id => cfg.tiers.find(t => t.id === id) || {};
    const rising = row('rising'), breakout = row('breakout'), gig = row('gig_ready');
    const reached = { starter: true };
    reached.poster = posts.length > 0;
    reached.consistent = goalWeeks >= row('consistent').goal_weeks;
    reached.rising = best >= rising.min_best_views || followers >= rising.min_followers;
    reached.breakout = best >= breakout.min_best_views || followers >= breakout.min_followers;
    reached.gig_ready = reached.breakout && reached.consistent && recentAverageScore(state, gig.avg_over_reps) >= gig.min_avg_score && !state.fraudFlags;
    let current = cfg.tiers[0];
    // Highest tier whose rule is met, without skipping the ones the PRD stacks on.
    const order = ['starter', 'poster', 'consistent', 'rising', 'breakout', 'gig_ready'];
    order.forEach(id => { if (reached[id]) current = cfg.tiers.find(t => t.id === id) || current; });
    const earned = Math.max(order.indexOf(current.id), order.indexOf(state.highestTier || 'starter'));
    return { current: cfg.tiers[earned], index: earned, reached, all: cfg.tiers };
  }

  const BADGES = [
    { id: 'first_xp', name: 'First rep', desc: 'Earned your first XP', test: c => c.total > 0 },
    { id: 'streak3', name: 'Three-peat', desc: '3-day streak', test: c => c.streak.longest >= 3 },
    { id: 'streak7', name: 'Locked in', desc: '7-day streak', test: c => c.streak.longest >= 7 },
    { id: 'streak30', name: 'Habit formed', desc: '30-day streak', test: c => c.streak.longest >= 30 },
    { id: 'ideas10', name: 'Idea bank', desc: '10 ideas captured', test: c => c.state.ideas.length >= 10 },
    { id: 'first_script', name: 'Scriptwriter', desc: 'Finished a script', test: c => c.state.reps.some(r => r.type === 'script') },
    { id: 'nine', name: 'Sharp hook', desc: 'Scored 9+ on a hook', test: c => c.state.reps.some(r => (r.type === 'hook' || r.type === 'rewrite') && r.feedback && r.feedback.score >= 9) },
    { id: 'filmed', name: 'Action!', desc: 'Moved an idea to filmed', test: c => c.state.ideas.some(i => ['filmed', 'posted'].includes(i.stage)) },
    { id: 'lessons5', name: 'Student', desc: 'Finished 5 lessons', test: c => (c.state.lessonsDone || []).length >= 5 }
  ];

  function badges(state, cfg, now) {
    const ctx = { state, total: totalXP(state), streak: dailyStreak(state, cfg, now) };
    return BADGES.map(b => ({ id: b.id, name: b.name, desc: b.desc, earned: !!b.test(ctx) }));
  }

  // ---------- weekly league (simulated cohort until real users exist) ----------

  function seeded(seed) {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
    return function () {
      h += 0x6D2B79F5;
      let t = h;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const LEAGUE_NAMES = ['Aarav', 'Diya', 'Kabir', 'Ishita', 'Rohan', 'Meera', 'Arjun', 'Sana', 'Vihaan', 'Tara', 'Neel', 'Anaya', 'Zoya', 'Dev', 'Riya', 'Kunal', 'Nisha', 'Aditya', 'Pooja', 'Yash', 'Fatima', 'Siddharth', 'Kiara', 'Ayaan', 'Simran', 'Harsh', 'Lavanya', 'Omar', 'Tanvi'];

  function league(state, cfg, now) {
    const t = now || Date.now();
    const ws = weekStart(t);
    const rnd = seeded(ws + (state.profile && state.profile.niche || ''));
    const dow = (dayToDate(localDay(t)).getDay() + 6) % 7 + 1; // 1..7 days into the week
    const members = LEAGUE_NAMES.slice(0, cfg.leagues.cohort_size - 1).map(name => ({
      name, you: false, xp: Math.round(rnd() * 90 * dow + rnd() * 40)
    }));
    members.push({ name: (state.profile && state.profile.name) || 'You', you: true, xp: weeklyXP(state, t) });
    members.sort((a, b) => b.xp - a.xp);
    const rank = members.findIndex(m => m.you) + 1;
    const L = cfg.leagues;
    const zone = rank <= L.promote_top ? 'promote' : rank > members.length - L.demote_bottom ? 'demote' : 'stay';
    return { division: L.ladder[state.leagueIndex || 0], members, rank, zone, size: members.length, weekStart: ws, simulated: true };
  }

  return {
    localDay, addDays, weekStart, uid, tokens, cosine, isDuplicateIdea, isRepeatRep,
    award, reverse, isReversed, totalXP, weeklyXP, xpBetween, practiceXPOn, levelFor,
    dailyStreak, hoursLeftToday, toMinutes, minutesOfDay, quietWindow, isQuietAt, isQuiet, streakRiskStart, reminderMinutes, skills, tier, badges, league, recentAverageScore
  };
});
