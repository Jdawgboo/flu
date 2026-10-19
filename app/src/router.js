/* Router v1: decides what a message typed or spoken on Home should do. Rules run in a fixed order
 * and the first match wins: cheat, stats, practice, today, stuck, group, idea, then coach (the
 * rule-based chat in coach.js). Pure, so it can move into services/api unchanged. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./content.js'), require('./coach.js'));
  else root.LIRouter = factory(root.LIContent, root.LICoach);
})(typeof self !== 'undefined' ? self : this, function (Content, Coach) {
  'use strict';

  const STATS = /what'?s working|what is working|\bstats?\b|analytics|performance|kya (chal|kaam)/i;
  const PRACTICE = /\b(practi[cs]e|drill|do a rep|start a rep|hook rep|rep (karo|karna|karte))\b/i;
  const TODAY = /what (should|shall|can|do) (i|we) post|what to post|kya post (karu|karun|karna|kru|karoon)|aaj kya|post today|today'?s post/i;
  const STUCK = /\b(stuck|no ideas?|blank|out of ideas|nothing to (post|say)|writer'?s block|idea nahi|atak|atka|atki)\b|samajh nahi aa raha/i;
  const NUMBER = '(\\d{1,2}|two|three|four|five|six|seven|eight|do|teen|char|chaar|paanch|chhe|saat|aath)';
  const GROUP_WORD = /\b(friends?|group|squad|dost(on)?|yaar|crew|gang|team)\b/i;
  const GROUP_PLAN = /\b(shoot|plan|film|filming|reel|video|banao|banani|banana|shooting)\b/i;
  const GROUP = new RegExp('collab(oration)? shoot|\\b' + NUMBER + ' of us\\b', 'i');
  const QUESTION = /\?|^\s*(what|how|why|when|where|which|who|can|could|should|is|are|do|does|will|kya|kaise|kyun|kab|kaun|kahan|kitna|kitne)\b/i;

  const wordCount = text => String(text || '').trim().split(/\s+/).filter(Boolean).length;

  /* ctx: { appCfg }. Returns { intent, payload } with intent one of
   * cheat | stats | practice | today | stuck | group | idea | coach. */
  function route(text, ctx) {
    text = String(text || '').trim();
    const min = ctx.appCfg.studio.min_idea_words;
    if (Content.CHEAT_RE.test(text)) return { intent: 'cheat', payload: { text } };
    if (STATS.test(text)) return { intent: 'stats', payload: { text } };
    if (PRACTICE.test(text)) return { intent: 'practice', payload: { type: /\brewrite\b/i.test(text) ? 'rewrite' : /\bscript\b/i.test(text) ? 'script' : 'hook' } };
    if (TODAY.test(text)) return { intent: 'today', payload: { text } };
    if (STUCK.test(text)) return { intent: 'stuck', payload: { text } };
    if (GROUP.test(text) || (GROUP_WORD.test(text) && GROUP_PLAN.test(text))) return { intent: 'group', payload: { text } };
    const n = wordCount(text);
    if (n >= min && !QUESTION.test(text)) {
      // A short message about a coach topic ("my views are low") is a chat, a longer one is an idea.
      const topic = Coach.intentOf(text);
      if (!topic || n > 2 * min) return { intent: 'idea', payload: { text } };
    }
    return { intent: 'coach', payload: { text } };
  }

  return { route };
});
