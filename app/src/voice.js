/* Voice helpers: turn a chat reply into short speakable text, spot stop phrases, decide what a
 * heard transcript should do, and pick a speech voice. Pure (no DOM, no network, no requires) so it
 * can move into services/api unchanged. All limits come from config/app.yaml `voice`. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LIVoice = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* Plain text for a speech engine: no markdown, links, emoji or symbols it would read aloud. */
  function clean(text) {
    return String(text == null ? '' : text)
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/(https?:\/\/|www\.)\S+/gi, ' ')
      .replace(/₹\s?(\d[\d,.]*)/g, '$1 rupees')
      .replace(/[→⇒➜]/g, ' to ')
      .replace(/[\p{Extended_Pictographic}‍️⃣]/gu, ' ')
      .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
      .replace(/(\*\*|__|\*|_|`|~~)/g, '')
      .replace(/#(\w)/g, '$1')
      .replace(/["“”]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const endStop = s => (/[.!?]$/.test(s) ? s : s + '.');

  /* Cut at the last sentence end under max, else at the last word. Never ends mid-word. */
  function cap(text, max) {
    text = String(text || '').trim();
    if (!(max > 0) || text.length <= max) return text;
    const head = text.slice(0, max);
    const stop = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '));
    if (stop > max * 0.4) return head.slice(0, stop + 1).trim();
    const sp = head.lastIndexOf(' ');
    return endStop((sp > 0 ? head.slice(0, sp) : head).replace(/[,;:\-]+$/, '').trim());
  }

  const join = parts => parts.map(clean).filter(Boolean).map(endStop).join(' ');
  const hi = lang => lang === 'hi';

  /* msg: a chat message { text } | { kind: 'studio', result } | { kind: 'group', plan } | { kind: 'stuck', stuck }.
   * opts: { maxChars }. Returns the text to speak ('' when there is nothing to say). */
  function speakable(msg, opts) {
    const max = opts && opts.maxChars;
    if (!msg) return '';
    let out = '';
    if (msg.kind === 'studio' && msg.result) {
      const r = msg.result, l = r.lang, s = r.strategist || {}, c = r.critic || {};
      const angle = (s.angles || [])[0], q = (s.questions || [])[0];
      const reel = ((r.instagram || {}).concepts || [])[0] || {};
      if (c.verdict === 'rethink') out = join([c.risks && c.risks[0], c.fix]);
      else out = join([
        angle && `Top angle: ${angle.label}. ${angle.why}`,
        q && (hi(l) ? `Ek sawaal: ${q}` : `One question: ${q}`),
        reel.hook && `Best hook: ${reel.hook}`
      ]);
    } else if (msg.kind === 'group' && msg.plan) {
      const g = msg.plan, shot = (g.shots || [])[0];
      out = join([
        `Plan for ${g.people} people, about ${g.minutes} minutes`,
        g.concept,
        shot && `First shot: ${shot.who}, ${shot.shot}`
      ]);
    } else if (msg.kind === 'stuck' && msg.stuck) {
      const u = msg.stuck, p = u.prompts || [];
      out = join(['Start tiny', p[0], p[1] && `Or: ${p[1]}`, u.action && u.action.seconds && `Then a ${u.action.seconds} second hook rep`]);
    } else out = clean(msg.text);
    // A couple of sentences: when over the cap, keep what fits.
    const fit = cap(out, max);
    return /[.!?]$/.test(fit) || !fit ? fit : endStop(fit);
  }

  /* 'hi' when the reply is Hinglish (a Hinglish studio result or a Hinglish coach profile), else 'en'. */
  function langOf(msg, profileLanguage) {
    if (msg && msg.result && msg.result.lang) return msg.result.lang;
    return profileLanguage === 'hinglish' ? 'hi' : 'en';
  }

  const norm = s => String(s || '').toLowerCase().replace(/[’‘`]/g, "'").replace(/\bthat is\b/g, "that's")
    .replace(/[^a-z0-9'ऀ-ॿ\s]/g, ' ').replace(/'/g, '').replace(/\s+/g, ' ').trim();
  const FILLER = new Set(['ok', 'okay', 'please', 'pls', 'hey', 'flu', 'kavi', 'now', 'ji', 'thanks', 'thank', 'you', 'ab', 'the', 'it']);

  /* True when the whole utterance is a stop phrase: "stop", "ok bas", "that's all", "please stop it".
   * A longer sentence that merely contains the word ("stop scrolling hook idea") is not a stop. */
  function isStopPhrase(text, phrases) {
    const words = norm(text).split(' ').filter(w => w && !FILLER.has(w));
    if (!words.length) return false;
    return (phrases || []).some(p => {
      const pw = norm(p).split(' ').filter(Boolean);
      if (!pw.length || words.length > pw.length + 1) return false;
      for (let i = 0; i + pw.length <= words.length; i++) if (pw.every((w, k) => words[i + k] === w)) return true;
      return false;
    });
  }

  /* What a heard transcript should do in a session: { action: 'stop'|'send'|'ignore', reason? }.
   * session: { turns }. cfg: the `voice` config. */
  function decide(text, session, cfg) {
    const t = String(text || '').trim();
    if (!t) return { action: 'ignore', reason: 'empty' };
    if (isStopPhrase(t, cfg.stop_phrases)) return { action: 'stop', reason: 'stop-phrase' };
    if (session && session.turns >= cfg.max_turns) return { action: 'stop', reason: 'max-turns' };
    return { action: 'send' };
  }

  /* Best of the browser's voices for a language: exact en-IN / hi-IN, then any voice of that language,
   * then null (the engine's default). */
  function pickVoice(voices, lang) {
    const list = Array.isArray(voices) ? voices : [];
    const want = String(lang || '').toLowerCase().replace('_', '-');
    const base = want.split('-')[0];
    const of = v => String(v && v.lang || '').toLowerCase().replace('_', '-');
    return list.find(v => of(v) === want) || list.find(v => of(v).split('-')[0] === base) || null;
  }

  return { clean, cap, speakable, langOf, isStopPhrase, decide, pickVoice };
});
