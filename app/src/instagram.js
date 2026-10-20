/* Instagram import: turns the profile the connect service returns (Instagram API with
 * Instagram Login, scope instagram_business_basic) into onboarding answers and post rows.
 * Pure functions, no DOM and no network, so they can move into services/api unchanged.
 * Imported posts are never verified here: verifying real posts and awarding post XP is
 * Phase 2 server-side work. Also holds the sample creator used by the demo connect. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./content.js'), require('./grader.js'), require('./engine.js'));
  else root.LIInstagram = factory(root.LIContent, root.LIGrader, root.LIEngine);
})(typeof self !== 'undefined' ? self : this, function (Content, Grader, Engine) {
  'use strict';

  const DAY = 24 * 60 * 60 * 1000;
  const WINDOW_DAYS = 28;       // posts in this window set the weekly goal
  const MIN_POSTS_FOR_GOAL = 3; // fewer than this and we fall back to the suggested goal
  const MIN_NICHE_HITS = 2;     // a niche needs at least this many keyword hits to be suggested
  const HINGLISH_SHARE = 0.3;   // share of captions in Hinglish that makes Hinglish the suggestion
  const CAPTION_MAX = 500;      // caption characters kept per imported post, for Analytics

  const FORMATS = { VIDEO: 'Reel', REELS: 'Reel', CAROUSEL_ALBUM: 'Carousel', IMAGE: 'Post' };

  // Instagram sends "+0000" offsets; Safari only parses "+00:00".
  function parseTime(ts) {
    const t = new Date(String(ts || '').replace(/([+-]\d\d)(\d\d)$/, '$1:$2')).getTime();
    return isFinite(t) ? t : null;
  }

  function tokens(text) { return String(text || '').toLowerCase().match(/[\p{L}\p{N}₹]+/gu) || []; }

  function mediaList(ig) { return ig && Array.isArray(ig.media) ? ig.media.filter(m => m && typeof m === 'object') : []; }

  /* Suggest a niche by counting niche keywords in the bio and captions. Ties and weak
   * signals fall back to 'other'; the user always confirms or changes it. */
  function inferNiche(ig) {
    const words = tokens([ig && ig.biography].concat(mediaList(ig).map(m => m.caption)).join(' '));
    const best = { id: 'other', hits: 0, tie: false };
    Object.keys(Content.NICHES).filter(id => id !== 'other').forEach(id => {
      const kw = new Set(Content.NICHES[id].keywords);
      const hits = words.filter(w => kw.has(w)).length;
      if (hits > best.hits) { best.id = id; best.hits = hits; best.tie = false; } else if (hits === best.hits && hits > 0) best.tie = true;
    });
    return best.hits >= MIN_NICHE_HITS && !best.tie ? best.id : 'other';
  }

  function inferLanguage(ig) {
    const caps = mediaList(ig).map(m => m.caption).filter(c => typeof c === 'string' && c.trim());
    if (!caps.length) return 'english';
    return caps.filter(c => Grader.isHinglish(c)).length / caps.length >= HINGLISH_SHARE ? 'hinglish' : 'english';
  }

  /* igProfile: the JSON from the connect service. cfg: gamification config (weekly_goal).
   * Returns the onboarding answers we can guess, plus plain-language notes on how. */
  function inferProfile(ig, cfg, now) {
    ig = ig || {};
    const t = now == null ? Date.now() : now;
    const G = cfg.weekly_goal;
    const media = mediaList(ig);
    const first = String(ig.name || '').trim().split(/\s+/)[0] || String(ig.username || '').trim();
    const niche = inferNiche(ig);
    const language = inferLanguage(ig);
    const recent = media.map(m => parseTime(m.timestamp)).filter(x => x != null && x <= t && x > t - WINDOW_DAYS * DAY).length;
    const enough = recent >= MIN_POSTS_FOR_GOAL;
    const weeklyGoal = enough ? Math.max(G.min, Math.min(G.max, Math.round(recent / (WINDOW_DAYS / 7)))) : G.suggested;
    const notes = [
      niche === 'other' ? 'We could not tell your niche from your bio and captions, so please pick one.' : `Niche guessed from your bio and ${media.length} recent posts.`,
      language === 'hinglish' ? 'Many of your captions are in Hinglish.' : 'Your captions read as English.',
      enough ? `Weekly goal matches your ${recent} posts in the last ${WINDOW_DAYS} days.` : `Not enough recent posts to read your pace, so we suggest ${G.suggested} a week.`
    ];
    return { name: first.slice(0, 40), niche, language, weeklyGoal, notes };
  }

  /* Media to state.posts rows. Always verified:false. Views, reach, saves and shares come from
   * the post's insights when the connect service sent them, else they stay null. Likes, comments,
   * the caption and the local posting hour are kept for "What's working" and Analytics. */
  function mediaToPosts(ig, now) {
    const loggedOn = Engine.localDay(now == null ? Date.now() : now);
    const out = [];
    mediaList(ig).forEach(m => {
      const t = parseTime(m.timestamp);
      if (t == null) return;
      const n = v => (typeof v === 'number' && isFinite(v) && v >= 0 ? Math.floor(v) : null);
      const ins = m.insights && typeof m.insights === 'object' ? m.insights : {};
      out.push({
        id: 'ig_' + String(m.id == null ? t : m.id), ideaId: null, date: Engine.localDay(t), platform: 'instagram',
        format: FORMATS[m.media_type] || 'Post', views: n(ins.views), note: '', source: 'instagram', verified: false, loggedOn,
        likes: n(m.like_count), comments: n(m.comments_count), permalink: typeof m.permalink === 'string' ? m.permalink : '',
        caption: typeof m.caption === 'string' ? m.caption.slice(0, CAPTION_MAX) : '', hour: new Date(t).getHours(),
        reach: n(ins.reach), saves: n(ins.saved), shares: n(ins.shares)
      });
    });
    return out;
  }

  /* The built-in sample creator for demo mode. Timestamps are relative to `now` so the
   * weekly goal and "recent posts" always look current. Clearly sample data, not a real account. */
  function sampleProfile(now) {
    const t = now == null ? Date.now() : now;
    const at = (daysAgo, hour) => { const d = new Date(t - daysAgo * DAY); d.setHours(hour, 0, 0, 0); return d.toISOString(); };
    const rows = [
      [1, 18, 'REELS', 'This ₹80 dosa in Koramangala beats every ₹400 brunch. Full thali review inside', 2140, 96, 9800, 210, 140],
      [3, 12, 'CAROUSEL_ALBUM', '5 street food spots in Indiranagar under ₹150, saved for your next cafe run', 880, 41, 4200, 190, 35],
      [5, 19, 'REELS', 'Yaar ye biryani kya ekdum mast hai, bas ek bite aur sab bhool jaoge', 1520, 77, 8900, 60, 95],
      [8, 11, 'REELS', 'Filter coffee vs cold coffee: which one is worth your money?', 960, 38, 7600, 40, 30],
      [10, 17, 'IMAGE', 'Sunday brunch menu at the new cafe. Honest taste test coming soon', 410, 19, 3900, 12, 6],
      [12, 20, 'REELS', 'I tried every momos stall on one street so you do not have to', 1830, 88, 8200, 120, 110],
      [15, 13, 'CAROUSEL_ALBUM', 'Masala chai recipe in 4 steps. Save this for the monsoon', 720, 30, 3600, 150, 20],
      [18, 18, 'REELS', 'The paneer roll everyone in Bengaluru is queueing for, worth it?', 1190, 52, 9100, 70, 60],
      [21, 12, 'IMAGE', 'Weekend snack haul from the local market', 330, 14, 3400, 8, 4],
      [24, 19, 'REELS', 'Why your homemade dosa never gets crisp, and the kitchen fix', 1670, 71, 6400, 180, 70],
      [29, 14, 'CAROUSEL_ALBUM', 'Restaurant week picks: where to eat on a student budget', 540, 22, 3800, 95, 15],
      [33, 18, 'REELS', 'Street food tour: the best chaat in town', 1010, 45, 8700, 30, 40]
    ];
    return {
      username: 'priya.eats', name: 'Priya', account_type: 'MEDIA_CREATOR',
      biography: 'Street food, chai and cafes of Bengaluru. Honest reviews, no filters.',
      profile_picture_url: '', followers_count: 3100, follows_count: 412, media_count: rows.length,
      media: rows.map((r, i) => ({
        id: 'sample' + (i + 1), caption: r[3], media_type: r[2], permalink: '', timestamp: at(r[0], r[1]), like_count: r[4], comments_count: r[5],
        insights: { reach: r[6], views: r[2] === 'REELS' ? r[6] * 2 : r[6], saved: r[7], shares: r[8] }
      })),
      session: ''
    };
  }

  return { inferProfile, inferNiche, inferLanguage, mediaToPosts, sampleProfile, parseTime };
});
