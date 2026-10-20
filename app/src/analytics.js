/* Analytics: everything we can learn from the creator's own posts. Engagement rate per post,
 * format, weekday and time of day, caption style, hashtags, posting rhythm, the trend over the
 * last weeks, top and bottom posts, and plain-language takeaways. Uses Instagram insights
 * (reach, views, saves, shares) when the post has them, else likes and comments only.
 * Pure functions, no DOM and no network, so they can move into services/api unchanged.
 * Every threshold comes from cfg.analytics (config/gamification.yaml). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./grader.js'));
  else root.LIAnalytics = factory(root.LIGrader);
})(typeof self !== 'undefined' ? self : this, function (Grader) {
  'use strict';

  const DAY = 24 * 60 * 60 * 1000;
  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const CTA = /\b(save|share|comment|follow|tag|send|link in bio|dm)\b/i;
  const EMOJI = /\p{Extended_Pictographic}/u;

  const num = v => (typeof v === 'number' && isFinite(v) && v >= 0 ? v : null);

  function median(xs) {
    const v = xs.filter(x => typeof x === 'number' && isFinite(x)).sort((a, b) => a - b);
    if (!v.length) return null;
    const m = v.length >> 1;
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  }

  function dayOf(date) {
    const [y, m, d] = String(date).split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function slotOf(hour, A) {
    if (hour == null) return null;
    const s = A.time_slots.find(x => (x.from <= x.to ? hour >= x.from && hour < x.to : hour >= x.from || hour < x.to));
    return s ? s.label : null;
  }

  /* Caption traits we compare: each is true or false for a post with a caption. */
  function traits(caption, A) {
    const c = String(caption || '');
    if (!c.trim()) return null;
    const tags = (c.match(/#[\p{L}\p{N}_]+/gu) || []).length;
    const firstLine = c.split('\n')[0];
    return {
      question: /\?/.test(firstLine),
      number: /\d/.test(firstLine),
      rupee: /₹|\brs\.?\s?\d/i.test(c),
      hinglish: Grader.isHinglish(c),
      cta: CTA.test(c),
      emoji: EMOJI.test(c),
      hashtags: tags >= A.many_hashtags,
      short: c.length < A.caption_short_chars,
      long: c.length > A.caption_long_chars
    };
  }

  const TRAIT_LABEL = {
    question: 'Hook asks a question', number: 'Number in the hook', rupee: 'Mentions a price (₹)', hinglish: 'Hinglish caption',
    cta: 'Asks to save, share or comment', emoji: 'Uses emoji', hashtags: 'Several hashtags', short: 'Short caption', long: 'Long caption'
  };

  /* One row per Instagram post with the numbers we score on. */
  function rows(posts, followers) {
    return (posts || []).filter(p => p && p.source === 'instagram' && num(p.likes) != null && /^\d{4}-\d\d-\d\d$/.test(String(p.date))).map(p => {
      const likes = p.likes, comments = num(p.comments) || 0, saves = num(p.saves), shares = num(p.shares), reach = num(p.reach), views = num(p.views);
      const interactions = likes + comments + (saves || 0) + (shares || 0);
      const base = reach || followers || null;
      return {
        id: p.id, date: p.date, hour: num(p.hour), format: p.format || 'Post', caption: String(p.caption || ''), permalink: p.permalink || '',
        likes, comments, saves, shares, reach, views, interactions,
        er: base ? (interactions / base) * 100 : null,
        erBase: reach ? 'reach' : 'followers'
      };
    });
  }

  /* Groups rows by key(row) and compares each group's median engagement with the overall one. */
  function groupBy(list, key, overall, A) {
    const g = {};
    list.forEach(r => { const k = key(r); if (k != null) (g[k] = g[k] || []).push(r); });
    return Object.keys(g).map(k => {
      const ers = g[k].map(r => r.er), m = median(ers);
      return { key: k, posts: g[k].length, er: m, lift: overall ? m / overall : null, enough: g[k].length >= A.min_group_posts };
    }).sort((a, b) => (b.enough - a.enough) || (b.er - a.er) || b.posts - a.posts);
  }

  /* With-versus-without comparison for each caption trait, kept only when both sides have enough posts. */
  function traitEffects(list, A) {
    const withT = list.map(r => ({ r, t: traits(r.caption, A) })).filter(x => x.t);
    return Object.keys(TRAIT_LABEL).map(k => {
      const yes = withT.filter(x => x.t[k]).map(x => x.r.er), no = withT.filter(x => !x.t[k]).map(x => x.r.er);
      if (yes.length < A.min_group_posts || no.length < A.min_group_posts) return null;
      const my = median(yes), mn = median(no);
      return { key: k, label: TRAIT_LABEL[k], withPosts: yes.length, withoutPosts: no.length, withEr: my, withoutEr: mn, lift: mn ? my / mn : null };
    }).filter(Boolean).sort((a, b) => Math.abs(Math.log(b.lift || 1)) - Math.abs(Math.log(a.lift || 1)));
  }

  /* Gaps between posting days, posts per week, and weeks with no post at all. */
  function rhythm(list, now, A) {
    const days = Array.from(new Set(list.map(r => r.date))).sort();
    if (!days.length) return null;
    const gaps = [];
    for (let i = 1; i < days.length; i++) gaps.push(Math.round((dayOf(days[i]) - dayOf(days[i - 1])) / DAY));
    const spanDays = Math.max(1, Math.round((now - dayOf(days[0])) / DAY) + 1);
    const weeks = Math.max(1, Math.ceil(spanDays / 7));
    const sinceLast = Math.max(0, Math.floor((now - dayOf(days[days.length - 1])) / DAY));
    const recentFrom = now - A.window_days * DAY;
    return {
      posts: list.length, spanDays, perWeek: list.length / weeks, medianGap: median(gaps), longestGap: gaps.length ? Math.max(...gaps) : null,
      daysSinceLast: sinceLast, recentPerWeek: list.filter(r => dayOf(r.date) >= recentFrom).length / (A.window_days / 7)
    };
  }

  /* Median engagement per week for the last trend_weeks weeks, oldest first, and the change from
   * the first half of those weeks to the second. */
  function trend(list, now, A) {
    const weeks = [];
    for (let i = A.trend_weeks - 1; i >= 0; i--) {
      const end = now - i * 7 * DAY, start = end - 7 * DAY;
      const ers = list.filter(r => { const t = dayOf(r.date).getTime() + 12 * 3600 * 1000; return t > start && t <= end; }).map(r => r.er);
      weeks.push({ weeksAgo: i, posts: ers.length, er: median(ers) });
    }
    const half = Math.floor(weeks.length / 2);
    const a = median(weeks.slice(0, half).map(w => w.er)), b = median(weeks.slice(half).map(w => w.er));
    return { weeks, change: a && b != null ? b / a - 1 : null };
  }

  const pct = x => Math.round(Math.abs(x) * 100);

  /* Plain-language takeaways, strongest first, each backed by how many posts it rests on. */
  function takeaways(r, A) {
    const out = [];
    const best = (list, what) => {
      const g = list.filter(x => x.enough);
      if (g.length < 2) return;
      const top = g[0], low = g[g.length - 1];
      if (top.lift >= A.lift_threshold) out.push({ weight: top.lift, text: `${what(top.key)} get ${pct(top.lift - 1)}% more engagement than your average (${top.posts} posts).` });
      if (low.lift && low.lift <= 1 / A.lift_threshold) out.push({ weight: 1 / low.lift, text: `${what(low.key)} trail your average by ${pct(1 - low.lift)}% (${low.posts} posts).` });
    };
    best(r.byFormat, k => (k === 'Post' ? 'Photo posts' : `${k}s`));
    best(r.byWeekday, k => `Posts on ${k}`);
    best(r.byTime, k => `${k} posts`);
    r.traits.forEach(t => {
      if (t.lift >= A.lift_threshold) out.push({ weight: t.lift, text: `${t.label}: ${pct(t.lift - 1)}% more engagement than without (${t.withPosts} vs ${t.withoutPosts} posts).` });
      else if (t.lift && t.lift <= 1 / A.lift_threshold) out.push({ weight: 1 / t.lift, text: `${t.label}: ${pct(1 - t.lift)}% less engagement than without (${t.withPosts} vs ${t.withoutPosts} posts).` });
    });
    if (r.trend.change != null && Math.abs(r.trend.change) >= A.lift_threshold - 1) {
      out.push({ weight: 1 + Math.abs(r.trend.change), text: `Engagement is ${r.trend.change > 0 ? 'up' : 'down'} ${pct(r.trend.change)}% over the last ${Math.floor(A.trend_weeks / 2)} weeks compared with the ${Math.floor(A.trend_weeks / 2)} before.` });
    }
    if (r.rhythm && r.rhythm.daysSinceLast >= A.gap_warning_days) out.push({ weight: 99, text: `No post in ${r.rhythm.daysSinceLast} days. Your usual gap is ${r.rhythm.medianGap == null ? 'unknown' : r.rhythm.medianGap + ' days'}.` });
    if (r.totals.saveRate != null && r.totals.shareRate != null) {
      out.push({ weight: 1, text: `For every 100 people reached, ${r.totals.saveRate.toFixed(1)} save and ${r.totals.shareRate.toFixed(1)} share. Saves and shares push a post further than likes.` });
    }
    return out.sort((a, b) => b.weight - a.weight).slice(0, A.max_takeaways).map(x => x.text);
  }

  /* posts: state.posts. followers: follower count. Returns null when there is nothing to analyse. */
  function analyze(posts, followers, cfg, now) {
    const A = cfg.analytics;
    const t = now == null ? Date.now() : now;
    const list = rows(posts, num(followers)).filter(r => r.er != null && dayOf(r.date).getTime() <= t);
    if (list.length < A.min_posts) return { ready: false, posts: list.length, needed: A.min_posts };
    const overall = median(list.map(r => r.er));
    const sum = k => list.reduce((s, r) => s + (r[k] || 0), 0);
    const withReach = list.filter(r => r.reach);
    const reachSum = withReach.reduce((s, r) => s + r.reach, 0);
    const totals = {
      posts: list.length, likes: sum('likes'), comments: sum('comments'), saves: sum('saves'), shares: sum('shares'), views: sum('views'),
      medianEr: overall, erBase: withReach.length === list.length ? 'reach' : 'followers', hasInsights: withReach.length > 0,
      medianReach: median(withReach.map(r => r.reach)),
      reachRate: withReach.length && followers ? median(withReach.map(r => r.reach / followers * 100)) : null,
      saveRate: reachSum ? withReach.reduce((s, r) => s + (r.saves || 0), 0) / reachSum * 100 : null,
      shareRate: reachSum ? withReach.reduce((s, r) => s + (r.shares || 0), 0) / reachSum * 100 : null,
      commentsPerLike: sum('likes') ? sum('comments') / sum('likes') : null
    };
    const ranked = list.slice().sort((a, b) => b.er - a.er);
    const pick = r => Object.assign({}, r, { lift: overall ? r.er / overall : null, traits: traits(r.caption, A) });
    const res = {
      ready: true, totals,
      byFormat: groupBy(list, r => r.format, overall, A),
      byWeekday: groupBy(list, r => WEEKDAYS[dayOf(r.date).getDay()], overall, A),
      byTime: groupBy(list, r => slotOf(r.hour, A), overall, A),
      traits: traitEffects(list, A),
      rhythm: rhythm(list, t, A),
      trend: trend(list, t, A),
      top: ranked.slice(0, A.top_n).map(pick),
      bottom: ranked.slice(Math.max(A.top_n, ranked.length - A.top_n)).reverse().map(pick)
    };
    res.takeaways = takeaways(res, A);
    return res;
  }

  return { analyze, traits, median, slotOf, TRAIT_LABEL, WEEKDAYS };
});
