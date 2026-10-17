/* Rule-based graders implementing prompts/rubrics/*.v1.md.
 * They return the same JSON shape the LLM graders will return, so the XP engine and
 * screens don't change when grading moves to the Claude API in services/api. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./content.js'));
  else root.LIGrader = factory(root.LIContent);
})(typeof self !== 'undefined' ? self : this, function (Content) {
  'use strict';

  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const round1 = n => Math.round(n * 10) / 10;

  function words(text) { return String(text || '').trim().split(/\s+/).filter(Boolean); }
  function lower(text) { return String(text || '').toLowerCase(); }
  function has(text, list) { const t = lower(text); return list.filter(w => new RegExp('(^|[^a-z])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z]|$)').test(t)).length; }

  const CURIOSITY = ['but', 'nobody', 'secret', 'mistake', 'stop', 'never', 'why', 'how', 'actually', 'truth', 'until', 'before', 'finally', 'wish', 'ruined', 'regret', 'hidden', 'only', 'wrong', 'instead', 'trick', 'surprised', 'no one', 'skip', 'skips', 'beats', 'last', 'replaced', 'cost', 'disappeared', 'exactly', 'whole time', 'nobody told', 'reject', 'without', 'lost', 'one thing', 'this one', 'than', 'worth', 'fail', 'cheaper', 'galti', 'kyun', 'kaise', 'sach', 'raaz', 'mat', 'kabhi', 'sirf', 'asli'];
  const VIEWER = ['you', 'your', "you're", 'yours', 'tum', 'aap', 'tera', 'tumhara', 'aapka', 'apna', 'tujhe'];
  const IMPERATIVE = ['stop', 'try', 'save', "don't", 'dont', 'never', 'skip', 'watch', 'get', 'turn', 'read', 'mat', 'karo', 'dekho'];
  const GENERIC_OPENERS = ['hi guys', 'hello guys', 'hey guys', 'hello everyone', 'hi everyone', 'welcome back', 'in this video', 'today i will', 'today we will', 'namaste doston', 'hello doston', 'kaise ho'];
  const PLACES = ['bangalore', 'bengaluru', 'koramangala', 'indiranagar', 'hsr', 'mumbai', 'bandra', 'delhi', 'gurgaon', 'noida', 'pune', 'hyderabad', 'chennai', 'kolkata', 'goa', 'manali', 'jaipur', 'kerala', 'gokarna', 'ladakh', 'sarojini', 'india'];
  const HINGLISH = ['hai', 'kya', 'yaar', 'bhai', 'karo', 'nahi', 'kaise', 'mera', 'meri', 'tum', 'aap', 'bas', 'accha', 'matlab', 'kyun', 'sab', 'ekdum'];

  function looksLikeJunk(text) {
    const w = words(text);
    if (w.length < 3) return true;
    const letters = (text.match(/[a-zऀ-ॿ]/gi) || []).length;
    if (letters / Math.max(1, text.replace(/\s/g, '').length) < 0.5) return true;
    if (/(.)\1{4,}/.test(text)) return true;
    const uniq = new Set(w.map(x => x.toLowerCase()));
    if (uniq.size / w.length < 0.4) return true;
    // Keyboard mash ("asdf qwer zxcv"): most words have no vowel, a long consonant run, or are a keyboard row.
    const latin = w.map(x => x.toLowerCase().replace(/[^a-z]/g, '')).filter(x => x.length >= 3);
    const ROWS = 'qwertyuiop asdfghjkl zxcvbnm poiuytrewq lkjhgfdsa mnbvcxz';
    const mash = latin.filter(x => !/[aeiouy]/.test(x) || /[^aeiouy]{5,}/.test(x) || (x.length >= 4 && ROWS.includes(x)));
    if (latin.length && mash.length / latin.length >= 0.5 && mash.length >= 2) return true;
    return false;
  }

  function isHinglish(text) { return has(text, HINGLISH) >= 2; }

  function nicheOf(opts) { return Content.NICHES[(opts && opts.niche) || 'other'] || Content.NICHES.other; }

  function pick(list, seed) {
    let h = 0; const s = String(seed || '');
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return list[h % list.length];
  }

  const MSG = {
    en: {
      junk: { strength: 'You showed up and did the rep.', fix: 'Write a full sentence a viewer could hear in the first 3 seconds.' },
      curiosity: { strength: 'It opens a loop the viewer wants closed.', fix: 'Hint at a surprise or a mistake so people stay to find out what happened.' },
      specificity: { strength: 'Concrete details make it feel real.', fix: 'Add a number, a price in ₹, or a real place.' },
      brevity: { strength: 'Short enough to land in under 3 seconds.', fix: 'Cut it to 6 to 15 words. Every extra word is a reason to scroll.' },
      viewer_focus: { strength: 'It talks straight to the viewer.', fix: 'Make it about the viewer: use "you", or ask them a direct question.' },
      generic: 'Drop the greeting. Start with the surprising part.',
      hook: { strength: 'Your opening line pulls people in.', fix: 'Your first line should open a loop. Skip greetings and lead with the surprise.' },
      payoff: { strength: 'There is a clear takeaway.', fix: 'Say the one thing the viewer learns, plainly, in the middle.' },
      cta: { strength: 'Your ending tells the viewer what to do next.', fix: 'End with a specific ask, like "save this for your next trip".' },
      pacing: { strength: 'Good length for a 30-second video.', fix: 'Aim for 55 to 95 words in short sentences. That is about 30 seconds spoken.' },
      idea_ok: { strength: 'This is a clear, filmable idea.', fix: 'Add the angle: what makes your take different?' },
      idea_vague: { strength: 'Good instinct for a topic.', fix: 'Make it specific: who is it for, and what will they get?' }
    },
    hi: {
      junk: { strength: 'Tum aaye aur rep kiya, yeh important hai.', fix: 'Ek poora sentence likho jo viewer pehle 3 second mein sune.' },
      curiosity: { strength: 'Yeh ek sawaal khol deta hai, viewer rukega.', fix: 'Koi surprise ya galti ka hint do, taaki log end tak rukein.' },
      specificity: { strength: 'Details se yeh real lagta hai.', fix: 'Ek number, ₹ mein price, ya asli jagah ka naam daalo.' },
      brevity: { strength: 'Itna chhota ki 3 second mein land ho jaaye.', fix: '6 se 15 words tak kaato. Har extra word scroll ka reason hai.' },
      viewer_focus: { strength: 'Seedha viewer se baat karta hai.', fix: 'Viewer ke baare mein banao: "tum/you" use karo ya seedha sawaal pucho.' },
      generic: 'Greeting hatao. Surprising part se shuru karo.',
      hook: { strength: 'Pehli line log ko kheench leti hai.', fix: 'Pehli line mein loop kholo. Greeting skip karo, surprise se shuru karo.' },
      payoff: { strength: 'Takeaway clear hai.', fix: 'Beech mein seedha bolo ki viewer kya seekhega.' },
      cta: { strength: 'End mein viewer ko pata hai kya karna hai.', fix: 'Specific ask se khatam karo, jaise "agle trip ke liye save karo".' },
      pacing: { strength: '30 second ke liye perfect length.', fix: '55 se 95 words, chhote sentences. Itna 30 second mein bola jaata hai.' },
      idea_ok: { strength: 'Clear idea hai, shoot ho sakta hai.', fix: 'Apna angle add karo: tumhara take alag kyun hai?' },
      idea_vague: { strength: 'Topic ka instinct accha hai.', fix: 'Specific banao: kiske liye hai, aur unhe kya milega?' }
    }
  };

  function msgs(opts) { return MSG[(opts && opts.language) === 'hinglish' ? 'hi' : 'en']; }

  function summarise(breakdown, m) {
    const entries = Object.entries(breakdown);
    const best = entries.reduce((a, b) => (b[1] > a[1] ? b : a));
    const worst = entries.reduce((a, b) => (b[1] < a[1] ? b : a));
    return { strength: m[best[0]].strength, fix: m[worst[0]].fix, worst: worst[0] };
  }

  // ---------- hooks ----------

  function hookBreakdown(text, opts) {
    const n = words(text).length;
    const t = lower(text);
    const niche = nicheOf(opts);
    const generic = GENERIC_OPENERS.some(g => t.startsWith(g) || t.includes(g));

    let curiosity = 3 + 2 * Math.min(3, has(text, CURIOSITY));
    if (text.includes('?')) curiosity += 2;
    if (/\d/.test(text)) curiosity += 1;
    if (generic) curiosity = Math.min(curiosity, 2);

    let specificity = 3;
    if (/\d/.test(text)) specificity += 3;
    if (/₹|\brs\.?\s?\d|\brupees?\b|\blakh\b/i.test(text)) specificity += 2;
    if (has(text, niche.keywords)) specificity += 2;
    if (has(text, PLACES)) specificity += 2;
    const properNouns = words(text).slice(1).filter(w => /^[A-Z][a-z]{2,}/.test(w)).length;
    specificity += Math.min(2, properNouns);

    let brevity;
    if (n >= 6 && n <= 15) brevity = 9 + (n <= 12 ? 1 : 0);
    else if (n >= 4 && n <= 5) brevity = 6;
    else if (n >= 16 && n <= 24) brevity = 6;
    else if (n > 24) brevity = 3;
    else brevity = 2;

    let viewer = 3;
    if (has(text, VIEWER)) viewer += 4;
    if (text.includes('?')) viewer += 2;
    if (IMPERATIVE.some(w => t.startsWith(w + ' ') || t.startsWith(w + '.'))) viewer += 2;
    if (/^(pov|when)\b/.test(t)) viewer += 3;

    return {
      generic,
      breakdown: {
        curiosity: clamp(curiosity, 0, 10),
        specificity: clamp(specificity, 0, 10),
        brevity: clamp(brevity, 0, 10),
        viewer_focus: clamp(viewer, 0, 10)
      }
    };
  }

  function gradeHook(text, opts) {
    const m = msgs(opts);
    const niche = nicheOf(opts);
    const example = pick(niche.strong, text);
    if (looksLikeJunk(text)) {
      return { score: 1, rubric_version: 'hook.v1', breakdown: { curiosity: 1, specificity: 1, brevity: 1, viewer_focus: 1 }, strength: m.junk.strength, fix: m.junk.fix, example, hinglish: false };
    }
    const { breakdown, generic } = hookBreakdown(text, opts);
    const vals = Object.values(breakdown);
    let score = vals.reduce((a, b) => a + b, 0) / vals.length;
    // A greeting opener is the classic weak hook: it never earns more than 3.
    const opensGeneric = GENERIC_OPENERS.some(g => lower(text).trim().replace(/^[^a-z]+/, '').startsWith(g));
    if (opensGeneric) score = Math.min(score, 3);
    else if (generic) score -= 1;
    score = clamp(Math.round(score), 0, 10);
    const s = summarise(breakdown, m);
    return { score, rubric_version: 'hook.v1', breakdown, strength: s.strength, fix: generic ? m.generic : s.fix, example, hinglish: isHinglish(text) };
  }

  // Grades a set of hooks (onboarding writes 3) and returns the best plus each score.
  function gradeHooks(list, opts) {
    const graded = list.filter(h => h && h.trim()).map(h => ({ text: h.trim(), fb: gradeHook(h, opts) }));
    if (!graded.length) return null;
    const best = graded.reduce((a, b) => (b.fb.score > a.fb.score ? b : a));
    const avg = Math.round(graded.reduce((s, g) => s + g.fb.score, 0) / graded.length);
    return { score: avg, best, items: graded, rubric_version: 'hook.v1', breakdown: best.fb.breakdown, strength: best.fb.strength, fix: graded.reduce((a, b) => (b.fb.score < a.fb.score ? b : a)).fb.fix, example: best.fb.example };
  }

  // ---------- scripts ----------

  const PAYOFF = ["here's", 'here is', 'the trick', "that's why", 'that is why', 'the reason', 'result', 'step', 'first', 'then', 'finally', 'so', 'because', 'which means', 'matlab', 'isliye', 'pehle', 'phir', 'answer'];
  const CTA_SPECIFIC = /(save (this|it) for|comment (your|which|the)|tag (a|your) (friend|buddy|someone)|send this to|follow for (part|more) \w+|try (this|it) (and|tonight|tomorrow)|agle .* liye save|comment mein|share karo .* jo)/i;
  const CTA_GENERIC = /(like|subscribe|follow|share|comment|save)/i;

  function sentences(text) { return String(text || '').split(/(?<=[.!?।])\s+|\n+/).map(s => s.trim()).filter(Boolean); }

  function gradeScript(text, opts) {
    const m = msgs(opts);
    const niche = nicheOf(opts);
    const n = words(text).length;
    if (looksLikeJunk(text) || n < 12) {
      return { score: 1, rubric_version: 'script.v1', breakdown: { hook: 1, payoff: 1, cta: 1, pacing: 1 }, strength: m.junk.strength, fix: m.pacing.fix, example: pick(niche.strong, text), wordCount: n, seconds: Math.round(n / 2.5) };
    }
    const sents = sentences(text);
    const first = sents[0] || '';
    const hookFb = gradeHook(first, opts);
    const hook = clamp(Math.round((hookFb.breakdown.curiosity + hookFb.breakdown.viewer_focus) / 2 + (hookFb.breakdown.specificity >= 6 ? 1 : 0)), 0, 10);

    const middle = sents.slice(1, -1).join(' ') || text;
    let payoff = 3 + 2 * Math.min(3, has(middle, PAYOFF));
    if (/\d/.test(middle)) payoff += 1;
    if (sents.length >= 3) payoff += 1;

    const last = sents.slice(-2).join(' ');
    let cta = 2;
    if (CTA_SPECIFIC.test(last)) cta = 9;
    else if (CTA_GENERIC.test(last)) cta = 6;

    let pacing;
    if (n >= 55 && n <= 95) pacing = 9;
    else if ((n >= 40 && n < 55) || (n > 95 && n <= 120)) pacing = 6;
    else pacing = 3;
    const avgLen = n / Math.max(1, sents.length);
    if (avgLen <= 14 && pacing >= 6) pacing += 1;

    const breakdown = { hook: clamp(hook, 0, 10), payoff: clamp(payoff, 0, 10), cta, pacing: clamp(pacing, 0, 10) };
    const vals = Object.values(breakdown);
    const score = clamp(Math.round(vals.reduce((a, b) => a + b, 0) / vals.length), 0, 10);
    const s = summarise(breakdown, m);
    let example = pick(niche.strong, text);
    if (s.worst === 'cta') example = (opts && opts.language) === 'hinglish' ? 'Agli baar ke liye isse save karo, aur us dost ko tag karo jisko yeh chahiye.' : 'Save this for later, and send it to the friend who needs it.';
    return { score, rubric_version: 'script.v1', breakdown, strength: s.strength, fix: s.fix, example, wordCount: n, seconds: Math.round(n / 2.5) };
  }

  // ---------- ideas ----------

  function gradeIdea(text, opts) {
    const m = msgs(opts);
    const niche = nicheOf(opts);
    const n = words(text).length;
    if (looksLikeJunk(text)) return { score: 1, rubric_version: 'idea.v1', strength: m.junk.strength, fix: m.idea_vague.fix };
    let score = 3;
    if (n >= 4 && n <= 30) score += 2;
    if (/\d/.test(text)) score += 1;
    if (has(text, niche.keywords)) score += 2;
    if (has(text, PLACES)) score += 1;
    if (has(text, CURIOSITY) || text.includes('?')) score += 1;
    if (/\b(vs|versus|before|after|under|without|for)\b/i.test(text)) score += 1;
    score = clamp(score, 0, 10);
    const ok = score >= 7;
    return { score, rubric_version: 'idea.v1', strength: (ok ? m.idea_ok : m.idea_vague).strength, fix: (ok ? m.idea_ok : m.idea_vague).fix };
  }

  return { gradeHook, gradeHooks, gradeScript, gradeIdea, looksLikeJunk, isHinglish, words, round1 };
});
