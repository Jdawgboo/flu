/* Studio v1: turns one idea into a strategy, an Instagram Reel and Carousel, an X thread, a visual
 * board and a critic's verdict, plus the "what should I post today" pick, the unstick prompts and
 * the group shoot plan. Everything here is a deterministic, template-based MOCK. `run` takes an
 * optional `llm` ({ complete({ agent, system, input, schema }) -> Promise<json> }); each agent's
 * answer is validated and any invalid, failed or slow answer falls back to the mock for that agent
 * only, so a real model can be swapped in later without touching the screens. Pure: no DOM and no
 * network. Needs only content.js and grader.js, so it can move into services/ai unchanged. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./content.js'), require('./grader.js'));
  else root.LIStudio = factory(root.LIContent, root.LIGrader);
})(typeof self !== 'undefined' ? self : this, function (Content, Grader) {
  'use strict';

  const VERSION = 'studio.v1';
  const pick = Content.pick;
  const nicheOf = key => Content.NICHES[key] || Content.NICHES.other;
  const PLATFORM_NAME = { instagram: 'Instagram', youtube: 'YouTube', x: 'X' };
  const platformName = p => PLATFORM_NAME[p] || p || '';
  const fmtNum = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const T = (lang, en, hi) => (lang === 'hi' ? hi : en);
  // n items from a list, starting at an offset and wrapping, so any configured count is met.
  const take = (list, n, start) => Array.from({ length: n }, (_, i) => list[(start + i) % list.length]);

  function isHi(profile, text) { return !!(profile && profile.language === 'hinglish') || Grader.isHinglish(text); }
  const L = (profile, text) => (isHi(profile, text) ? 'hi' : 'en');

  // ---------- input ----------

  function clean(text, max) { return String(text == null ? '' : text).replace(/\s+/g, ' ').trim().slice(0, max).trim(); }

  function makeInput(text, ctx) {
    const profile = ctx.profile || {};
    const nicheKey = Content.NICHES[profile.niche] ? profile.niche : 'other';
    const w = text.replace(/[.!?,;:]+$/g, '').split(' ').filter(Boolean);
    const lang = L(profile, text);
    return {
      text, lang, niche: nicheKey, nicheLabel: nicheOf(nicheKey).label,
      core: w.slice(0, 5).join(' '),
      seed: text + '|' + nicheKey,
      cheat: Content.CHEAT_RE.test(text),
      junk: Grader.looksLikeJunk(text)
    };
  }

  // ---------- mock agents: (input, ctx) -> part ----------

  const HOOKS = {
    en: [
      c => `You are getting ${c} wrong. Fix it in 30 seconds`,
      c => `Nobody tells you this about ${c}`,
      c => `I got ${c} wrong 3 times. Here is the fix`,
      c => `Stop scrolling if you care about ${c}`
    ],
    hi: [
      c => `${c} mein maine 3 galti ki. Tum mat karna`,
      c => `${c} ka sach koi nahi batata, tum dekho`,
      c => `Tumhare ${c} ke liye sirf ek trick kaafi hai`,
      c => `${c} karne se pehle yeh 3 cheezein dekho`
    ]
  };

  function hooksFor(inp) {
    const list = HOOKS[inp.lang];
    const start = Content.hash(inp.seed) % list.length;
    return take(list, list.length, start).map(f => f(inp.core));
  }

  function ctaFor(inp) {
    const l = inp.nicheLabel.toLowerCase();
    return T(inp.lang, `Save this and tag a friend who loves ${l}`, `Isse save karo aur ${l} pasand karne wale dost ko tag karo`);
  }

  const ANGLES = {
    en: [
      ['story', 'Your own story', 'People follow a person, so tell what happened to you.'],
      ['mistake', 'The mistake', 'A mistake you made makes viewers stay to avoid it.'],
      ['number', 'The number', 'One price, count or time makes it feel real.'],
      ['myth', 'The myth', 'Say what everyone believes, then show what is true.'],
      ['beforeafter', 'Before and after', 'A visible change is easy to watch with the sound off.'],
      ['howto', 'The 3-step version', 'Steps are easy to save and come back to.']
    ],
    hi: [
      ['story', 'Tumhari apni kahani', 'Log insaan ko follow karte hain, toh bolo tumhare saath kya hua.'],
      ['mistake', 'Galti wala angle', 'Tumhari galti dekhkar log ruk jaate hain taaki khud na karein.'],
      ['number', 'Ek number', 'Ek price, count ya time se baat asli lagti hai.'],
      ['myth', 'Myth todo', 'Pehle bolo sab kya maante hain, phir sach dikhao.'],
      ['beforeafter', 'Pehle aur baad', 'Badlav dikhta hai, mute pe bhi samajh aata hai.'],
      ['howto', '3 step version', 'Steps save karna aasan hai aur log wapas aate hain.']
    ]
  };

  const QUESTIONS = {
    en: [n => `What is the one detail about ${n.label.toLowerCase()} that surprised you?`, () => 'Can you show it on camera in under 10 seconds?', () => 'Who is this for: a beginner or someone who already tried?', n => `Is there a price, number or place in this idea? Example: ${n.prompts[0]}`],
    hi: [n => `${n.label} mein kaunsi baat ne tumhe surprise kiya?`, () => '10 second ke andar camera pe dikha sakte ho?', () => 'Yeh kiske liye hai: beginner ya jisne try kar liya hai?', n => `Idea mein koi price, number ya jagah hai? Example: ${n.prompts[0]}`]
  };

  function strategist(inp, ctx) {
    const S = ctx.appCfg.studio, n = nicheOf(inp.niche);
    const start = Content.hash(inp.seed) % ANGLES[inp.lang].length;
    return {
      angles: take(ANGLES[inp.lang], S.angles, start).map(a => ({ id: a[0], label: a[1], why: a[2] })),
      questions: take(QUESTIONS[inp.lang], S.questions, 0).map(q => q(n))
    };
  }

  function instagram(inp, ctx) {
    const S = ctx.appCfg.studio, l = inp.lang, c = inp.core;
    const hooks = hooksFor(inp), cta = ctaFor(inp), n = nicheOf(inp.niche);
    const detail = pick(n.strong, inp.seed);
    const mid = [
      [5, T(l, 'Show the problem or the "before" in one clean shot', 'Problem ya "pehle" wali halat ek clean shot mein dikhao'), T(l, 'The problem', 'Problem')],
      [6, T(l, `Cut to step one of ${c}`, `${c} ka pehla step dikhao`), T(l, 'Step 1', 'Step 1')],
      [6, T(l, 'Show the detail that surprises people: a price, a number or a place', 'Woh detail dikhao jo surprise kare: price, number ya jagah'), T(l, 'The detail', 'Yeh detail')],
      [5, T(l, 'Show the result or the "after"', 'Result ya "baad" wali halat dikhao'), T(l, 'The result', 'Result')]
    ];
    const shots = [{ seconds: 3, shot: T(l, 'Close-up. Say the hook straight to the lens', 'Close-up. Hook seedha lens mein bolo'), onscreen: hooks[0] }]
      .concat(take(mid, Math.max(0, S.reel_shots - 2), 0).map(m => ({ seconds: m[0], shot: m[1], onscreen: m[2] })))
      .concat([{ seconds: 4, shot: T(l, 'Face the camera and make the ask', 'Camera ki taraf dekho aur ask bolo'), onscreen: cta }])
      .slice(0, S.reel_shots)
      .map((s, i) => Object.assign({ n: i + 1 }, s));
    const points = [
      T(l, 'The mistake most people make', 'Zyada log yeh galti karte hain'),
      T(l, `Step 1: start with ${c}`, `Step 1: ${c} se shuru karo`),
      T(l, 'Step 2: the detail that changes everything', 'Step 2: woh detail jo sab badal deti hai'),
      T(l, `Example: ${detail}`, `Example: ${detail}`),
      T(l, 'What you will see after a week', 'Ek hafte baad kya dikhega'),
      T(l, 'The one thing to skip', 'Yeh ek cheez chhod do')
    ];
    const slides = [hooks[1 % hooks.length]]
      .concat(take(points, Math.max(0, S.carousel_slides - 2), 0))
      .concat([cta])
      .slice(0, S.carousel_slides)
      .map((text, i) => ({ n: i + 1, text }));
    return {
      concepts: [
        { format: 'Reel', title: T(l, `${c}, in 30 seconds`, `${c}, 30 second mein`), hook: hooks[0], shots, caption: T(l, `${c}: the short version. ${cta}`, `${c}: short version. ${cta}`), cta },
        { format: 'Carousel', title: T(l, `${c}: the 3-step guide`, `${c}: 3 step guide`), hook: hooks[1 % hooks.length], slides, caption: T(l, `Swipe for ${c}. ${cta}`, `${c} ke liye swipe karo. ${cta}`), cta }
      ]
    };
  }

  function thread(inp, ctx) {
    const S = ctx.appCfg.studio, l = inp.lang, c = inp.core;
    const n = nicheOf(inp.niche);
    const hooks = hooksFor(inp);
    const body = [
      T(l, `The mistake most people make with ${c}.`, `${c} mein zyada log yeh galti karte hain.`),
      T(l, `Step 1: start small. One 30-second try beats a week of planning.`, `Step 1: chhota shuru karo. 30 second ki ek koshish hafta bhar ki planning se behtar hai.`),
      T(l, `Step 2: add one real detail, like a price or a place. Example: ${pick(n.strong, inp.seed)}`, `Step 2: ek asli detail daalo, jaise price ya jagah. Example: ${pick(n.strong, inp.seed)}`),
      T(l, `Step 3: do it again tomorrow and compare it only with your own last post.`, `Step 3: kal phir karo aur sirf apne pichhle post se compare karo.`),
      T(l, 'What would you add? Reply and tell me.', 'Tum kya add karoge? Reply karke batao.')
    ];
    const last = T(l, 'Follow for more, and save this thread for later.', 'Aur ke liye follow karo, aur yeh thread baad ke liye save karo.');
    const posts = [hooks[0]].concat(take(body, Math.max(0, S.thread_posts - 2), 0)).concat([last]).slice(0, S.thread_posts);
    return { platform: 'x', posts };
  }

  function linkedin(inp, ctx) {
    const S = ctx.appCfg.studio, l = inp.lang, c = inp.core;
    const n = nicheOf(inp.niche);
    const hooks = hooksFor(inp);
    const body = [
      T(l, `Most people overthink ${c}. I did too, until I tried one small version and wrote down what happened.`, `Zyada log ${c} ke baare mein bahut sochte hain. Maine bhi socha, jab tak ek chhota version try nahi kiya.`),
      T(l, `Here is what worked: start small, add one real detail like a price or a place, and compare only with your own last attempt. Example: ${pick(n.strong, inp.seed)}`, `Yeh kaam kiya: chhota shuru karo, ek asli detail daalo jaise price ya jagah, aur sirf apni pichhli koshish se compare karo. Example: ${pick(n.strong, inp.seed)}`),
      T(l, 'The result was not instant, but it was repeatable, and that is what matters.', 'Result turant nahi aaya, par repeat ho sakta tha, aur wahi matter karta hai.'),
      T(l, 'Small, honest steps beat big plans you never start.', 'Chhote, sachche steps un bade plans se behtar hain jo shuru hi nahi hote.')
    ];
    const ask = T(l, 'What is one small thing you tried recently that surprised you? Tell me in the comments.', 'Haal hi mein tumne kaunsi chhoti cheez try ki jisne surprise kiya? Comments mein batao.');
    const posts = [hooks[0]].concat(take(body, Math.max(0, S.linkedin_posts - 2), 0)).concat([ask]).slice(0, S.linkedin_posts);
    return { platform: 'linkedin', posts };
  }

  function board(inp, ctx) {
    const S = ctx.appCfg.studio, l = inp.lang, c = inp.core;
    const hooks = hooksFor(inp), cta = ctaFor(inp);
    const tiles = [
      [T(l, 'Hook', 'Hook'), T(l, 'Close-up of your face, bright and steady', 'Chehre ka close-up, roshni achhi'), hooks[0]],
      [T(l, 'Problem', 'Problem'), T(l, `The messy "before" of ${c}`, `${c} ki "pehle" wali halat`), T(l, 'The problem', 'Problem')],
      [T(l, 'Step', 'Step'), T(l, 'Hands in frame doing the first step', 'Haath frame mein, pehla step karte hue'), T(l, 'Step 1', 'Step 1')],
      [T(l, 'Detail', 'Detail'), T(l, 'Tight shot of a price tag, number or place sign', 'Price tag, number ya jagah ke board ka tight shot'), T(l, 'The detail', 'Yeh detail')],
      [T(l, 'Result', 'Result'), T(l, 'The clean "after", same angle as the problem', 'Saaf "baad" wali halat, problem wale angle se'), T(l, 'The result', 'Result')],
      [T(l, 'Ask', 'Ask'), T(l, 'Face the camera again, smile, point down', 'Phir camera ki taraf, smile, neeche point karo'), cta]
    ];
    return { tiles: take(tiles, S.board_tiles, 0).map((t, i) => ({ n: i + 1, label: t[0], visual: t[1], text: t[2] })) };
  }

  const CTA_RE = /\b(save|share|send|tag|comment|reply|follow|dm|bhej|bhejo|karo|batao)\b/i;
  const SHIP_TIPS = {
    en: ['Film in daylight and keep the first shot under 3 seconds.', 'Say the hook out loud twice before you record.', 'Cut every pause longer than half a second.'],
    hi: ['Din ki roshni mein film karo aur pehla shot 3 second se chhota rakho.', 'Record se pehle hook do baar bol ke dekho.', 'Aadhe second se lamba har pause kaato.']
  };

  function critic(inp, ctx) {
    const l = inp.lang, parts = inp.parts || {};
    const min = ctx.cfg.anti_gaming.min_quality_score;
    const opts = { niche: inp.niche, language: l === 'hi' ? 'hinglish' : 'english' };
    const concepts = (parts.instagram && parts.instagram.concepts) || [];
    const reel = concepts[0] || {};
    const hook = String(reel.hook || '');
    if (inp.cheat) {
      return {
        verdict: 'rethink',
        risks: [T(l, 'This is about buying or faking followers, views or likes. I will not build content for that.', 'Yeh followers, views ya likes kharidne ya fake karne ke baare mein hai. Iske liye content nahi banaunga.')],
        fix: T(l, 'Pick something you can actually film: a mistake, a price, a place or a before and after.', 'Kuch aisa lo jo tum sach mein film kar sako: galti, price, jagah ya pehle-baad.'),
        hook_score: 1
      };
    }
    const fb = Grader.gradeHook(hook, opts);
    const risks = [];
    if (inp.junk) risks.push(T(l, 'The idea reads like gibberish. Write a full sentence about one thing you will show.', 'Idea gibberish jaisa lag raha hai. Ek cheez ke baare mein poora sentence likho.'));
    if (Grader.looksLikeJunk(hook)) risks.push(T(l, 'The hook reads like gibberish.', 'Hook gibberish jaisa lag raha hai.'));
    if (Grader.words(hook).length > 15) risks.push(T(l, 'The hook is over 15 words. Cut it.', 'Hook 15 words se lamba hai. Chhota karo.'));
    if (!/\d|₹/.test(hook) && fb.breakdown.specificity < 6) risks.push(T(l, 'The hook has no concrete detail. Add a number, a price or a place.', 'Hook mein koi concrete detail nahi. Number, price ya jagah daalo.'));
    if (!concepts.length || concepts.some(c => !CTA_RE.test(String(c.cta || '')))) risks.push(T(l, 'There is no clear call to action. Ask for one specific thing.', 'Koi clear call to action nahi hai. Ek specific cheez maango.'));
    if (fb.score < min) risks.push(T(l, `The hook scores ${fb.score}/10. ${fb.fix}`, `Hook ka score ${fb.score}/10 hai. ${fb.fix}`));
    const verdict = inp.junk || fb.score < min || risks.length >= 3 ? 'rethink' : risks.length ? 'tweak' : 'ship';
    return {
      verdict, risks,
      fix: risks.length ? risks[0] : pick(SHIP_TIPS[l], inp.seed),
      hook_score: fb.score
    };
  }

  const AGENTS = { strategist, instagram, thread, linkedin, board, critic };

  // ---------- validation ----------

  const isStr = s => typeof s === 'string' && s.trim().length > 0;
  const isArr = (a, n) => Array.isArray(a) && (n == null || a.length === n);
  const isList = (a, n) => isArr(a, n) && a.length > 0;
  const all = (a, f) => a.every(f);
  const VERDICTS = ['ship', 'tweak', 'rethink'];

  const PART_CHECK = {
    strategist: (p, S) => isList(p.angles, S && S.angles) && all(p.angles, a => a && isStr(a.id) && isStr(a.label) && isStr(a.why)) && isList(p.questions, S && S.questions) && all(p.questions, isStr),
    instagram: (p, S) => isArr(p.concepts, 2)
      && p.concepts[0] && p.concepts[0].format === 'Reel' && p.concepts[1] && p.concepts[1].format === 'Carousel'
      && p.concepts.every(c => isStr(c.title) && isStr(c.hook) && isStr(c.caption) && isStr(c.cta))
      && isList(p.concepts[0].shots, S && S.reel_shots) && all(p.concepts[0].shots, s => s && typeof s.n === 'number' && typeof s.seconds === 'number' && isStr(s.shot) && typeof s.onscreen === 'string')
      && isList(p.concepts[1].slides, S && S.carousel_slides) && all(p.concepts[1].slides, s => s && typeof s.n === 'number' && isStr(s.text)),
    thread: (p, S) => p.platform === 'x' && isList(p.posts, S && S.thread_posts) && all(p.posts, s => isStr(s) && s.length <= 280),
    linkedin: (p, S) => p.platform === 'linkedin' && isList(p.posts, S && S.linkedin_posts) && all(p.posts, s => isStr(s) && s.length <= 3000),
    board: (p, S) => isList(p.tiles, S && S.board_tiles) && all(p.tiles, t => t && typeof t.n === 'number' && isStr(t.label) && isStr(t.visual) && typeof t.text === 'string'),
    critic: p => VERDICTS.includes(p.verdict) && isArr(p.risks) && all(p.risks, isStr) && typeof p.fix === 'string' && typeof p.hook_score === 'number' && p.hook_score >= 0 && p.hook_score <= 10
  };

  /* { ok, errors } for one agent's output. `S` (config studio block) is optional: with it, counts must match. */
  function validatePart(agent, part, S) {
    let ok = false;
    try { ok = !!(part && typeof part === 'object' && PART_CHECK[agent] && PART_CHECK[agent](part, S)); } catch (e) { ok = false; }
    return ok ? { ok: true, errors: [] } : { ok: false, errors: [agent] };
  }

  /* { ok, errors } for a whole result. Pass appCfg to also check every count against config. */
  function validate(result, appCfg) {
    const errors = [];
    const S = appCfg && appCfg.studio;
    if (!result || typeof result !== 'object') return { ok: false, errors: ['result'] };
    if (result.version !== VERSION) errors.push('version');
    if (!['mock', 'llm'].includes(result.mode)) errors.push('mode');
    if (!['en', 'hi'].includes(result.lang)) errors.push('lang');
    if (!result.idea || !isStr(result.idea.text) || typeof result.idea.niche !== 'string') errors.push('idea');
    Object.keys(AGENTS).forEach(a => { if (!result[a] || !validatePart(a, result[a], S).ok) errors.push(a); });
    if (!isArr(result.next) || !all(result.next, n => n && ['save-idea', 'idea-rep', 'open-rep'].includes(n.action) && isStr(n.label))) errors.push('next');
    return { ok: errors.length === 0, errors };
  }

  // ---------- run ----------

  const SYSTEM = {
    strategist: 'You are the strategist for an Indian solo creator. Give angles and questions that sharpen their idea. Reply in the creator\'s language (English or Hinglish).',
    instagram: 'You write one Instagram Reel and one Carousel for the idea. Hooks are 6 to 15 words with one concrete detail. End with one specific call to action.',
    thread: 'You write an X thread: a hook post, short points, and a final ask. Each post is 280 characters or fewer.',
    linkedin: 'You write a LinkedIn post as short paragraphs: a hook line, a few plain paragraphs and a closing question. Each is 3000 characters or fewer.',
    board: 'You describe a visual board: one tile per shot with a label, what the picture shows, and the on-screen text.',
    critic: 'You critique the other agents\' work honestly. Verdict is ship, tweak or rethink. Refuse ideas about buying or faking followers, views or likes.'
  };

  function schemaFor(agent, S) {
    const str = { type: 'string' };
    const list = (item, n) => ({ type: 'array', items: item, minItems: n, maxItems: n });
    const obj = (props) => ({ type: 'object', properties: props, required: Object.keys(props) });
    const num = { type: 'number' };
    return {
      strategist: obj({ angles: list(obj({ id: str, label: str, why: str }), S.angles), questions: list(str, S.questions) }),
      instagram: obj({ concepts: list(obj({ format: { enum: ['Reel', 'Carousel'] }, title: str, hook: str, shots: list(obj({ n: num, seconds: num, shot: str, onscreen: str }), S.reel_shots), slides: list(obj({ n: num, text: str }), S.carousel_slides), caption: str, cta: str }), 2) }),
      thread: obj({ platform: { enum: ['x'] }, posts: list({ type: 'string', maxLength: 280 }, S.thread_posts) }),
      linkedin: obj({ platform: { enum: ['linkedin'] }, posts: list({ type: 'string', maxLength: 3000 }, S.linkedin_posts) }),
      board: obj({ tiles: list(obj({ n: num, label: str, visual: str, text: str }), S.board_tiles) }),
      critic: obj({ verdict: { enum: VERDICTS }, risks: { type: 'array', items: str }, fix: str, hook_score: num })
    }[agent];
  }

  function withTimeout(promise, ms) {
    let timer;
    const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), ms); });
    return Promise.race([Promise.resolve(promise), timeout]).then(v => { clearTimeout(timer); return v; }, e => { clearTimeout(timer); throw e; });
  }

  function nextActions(inp, verdict) {
    const l = inp.lang;
    if (inp.cheat || inp.junk || verdict === 'rethink') return [{ action: 'open-rep', label: T(l, 'Practise 3 hooks', '3 hooks practise karo') }];
    return [
      { action: 'save-idea', label: T(l, 'Save idea', 'Idea save karo') },
      { action: 'idea-rep', label: T(l, 'Write your own hook', 'Apna hook likho') },
      { action: 'open-rep', label: T(l, 'Practise 3 hooks', '3 hooks practise karo') }
    ];
  }

  /* idea text + ctx -> Promise<Result>. Only the mock ever sees a cheat or gibberish idea, and the
   * critic's refusal of a cheat idea can never be replaced by a model's answer. */
  async function run(idea, ctx, opts) {
    const S = ctx.appCfg.studio;
    const llm = opts && opts.llm;
    const text = clean(idea, S.max_input_chars);
    const inp = makeInput(text, ctx);
    const useLlm = !!llm && !inp.cheat && !inp.junk;
    let llmParts = 0;

    async function one(agent, input) {
      if (useLlm) {
        try {
          const out = await withTimeout(llm.complete({ agent, system: SYSTEM[agent], input, schema: schemaFor(agent, S) }), S.timeout_ms);
          if (validatePart(agent, out, S).ok) { llmParts++; return out; }
        } catch (e) { /* fall through to the mock for this agent only */ }
      }
      return AGENTS[agent](input, ctx);
    }

    const names = Object.keys(AGENTS).filter(a => a !== 'critic');
    const parts = {};
    await Promise.all(names.map(async a => { parts[a] = await one(a, inp); }));
    parts.critic = await one('critic', Object.assign({}, inp, { parts }));

    return {
      version: VERSION,
      mode: llmParts > 0 ? 'llm' : 'mock',
      lang: inp.lang,
      idea: { text, niche: inp.niche },
      strategist: parts.strategist,
      instagram: parts.instagram,
      thread: parts.thread,
      linkedin: parts.linkedin,
      board: parts.board,
      critic: parts.critic,
      next: nextActions(inp, parts.critic.verdict)
    };
  }

  // ---------- what to post today ----------

  function daysBetween(a, b) {
    const t = d => { const [y, m, day] = d.split('-').map(Number); return Date.UTC(y, m - 1, day); };
    return Math.round((t(b) - t(a)) / 86400000);
  }

  /* Format from the creator's own numbers: median views first, then imported engagement, else a
   * default. The reasons always say where the pick comes from. ctx: { cfg, appCfg, insights,
   * engagement, posts, today }. */
  function todayPick(profile, ctx) {
    const lang = L(profile, '');
    const S = ctx.appCfg.studio;
    const n = nicheOf(profile && profile.niche);
    const vg = ctx.insights && ctx.insights.groups || [];
    const eg = ctx.engagement && ctx.engagement.groups || [];
    let format = S.default_format, platform = 'instagram', basis = 'niche';
    const reasons = [];
    const name = g => `${platformName(g.platform)} ${g.format || S.default_format}`.trim();
    if (vg.length) {
      const g = vg[0];
      format = g.format || S.default_format; platform = g.platform; basis = 'views';
      reasons.push(T(lang, `From the posts you reported: your ${name(g)} posts have the most views (median ${fmtNum(g.median)} over ${g.posts} posts).`, `Tumhare report kiye posts se: ${name(g)} posts pe sabse zyada views hain (median ${fmtNum(g.median)}, ${g.posts} posts).`));
    } else if (eg.length) {
      const g = eg[0];
      format = g.format || S.default_format; platform = g.platform; basis = 'engagement';
      reasons.push(T(lang, `From your imported Instagram posts: ${name(g)} posts get the most likes and comments (median ${fmtNum(g.median)} over ${g.posts} posts).`, `Tumhare import kiye Instagram posts se: ${name(g)} posts pe sabse zyada likes aur comments hain (median ${fmtNum(g.median)}, ${g.posts} posts).`));
    } else {
      reasons.push(T(lang, `No view counts in your own posts yet, so this is a starter format for ${n.label.toLowerCase()}. Log or import posts and I will use your numbers.`, `Abhi tumhare apne posts mein views nahi hain, toh yeh ${n.label} ka starter format hai. Posts log ya import karo, phir tumhare numbers use karunga.`));
    }
    const dated = (ctx.posts || []).filter(p => p && /^\d{4}-\d{2}-\d{2}$/.test(p.date) && p.date <= ctx.today);
    let gapDays = null;
    if (dated.length) {
      const last = dated.reduce((m, p) => (p.date > m ? p.date : m), '');
      gapDays = daysBetween(last, ctx.today);
      const nudge = ctx.cfg.insights.post_gap_nudge_days;
      if (gapDays >= nudge) reasons.push(T(lang, `Your last logged post was ${gapDays} days ago, so today is a good day to post.`, `Tumhari pichhli logged post ${gapDays} din pehle thi, toh aaj post karne ka sahi din hai.`));
      else if (gapDays === 0) reasons.push(T(lang, 'You already posted today. This is a bonus.', 'Aaj post ho chuki hai. Yeh bonus hai.'));
      else reasons.push(T(lang, `Your last logged post was ${gapDays} day${gapDays === 1 ? '' : 's'} ago. Keep the rhythm.`, `Tumhari pichhli logged post ${gapDays} din pehle thi. Rhythm banaye rakho.`));
    }
    return { format, platform, prompt: pick(n.prompts, ctx.today + (profile && profile.niche)), reasons, gapDays, basis };
  }

  // ---------- stuck ----------

  const TINY = {
    en: ['Say it out loud to a friend in one sentence.', 'Name one thing that annoyed you today.', 'Write the worst possible hook. Then fix one word.', 'What did you google this week?', 'Film 5 seconds of anything near you.'],
    hi: ['Ek dost ko ek line mein bolke sunao.', 'Aaj kaunsi ek cheez ne annoy kiya, woh likho.', 'Sabse kharab hook likho. Phir ek word badlo.', 'Is hafte tumne kya google kiya?', 'Apne aaspaas ki kisi bhi cheez ke 5 second film karo.']
  };

  /* Three tiny prompts and a one-minute hook rep. */
  function unstick(profile, ctx) {
    const lang = L(profile, '');
    const S = ctx.appCfg.studio;
    const n = nicheOf(profile && profile.niche);
    const seed = ctx.today + (profile && profile.niche);
    const pool = [pick(n.prompts, seed)].concat(take(TINY[lang], TINY[lang].length, Content.hash(seed) % TINY[lang].length));
    return {
      prompts: pool.slice(0, S.unstick_prompts),
      action: { type: 'hook', seconds: S.unstick_seconds, label: T(lang, `Do a ${S.unstick_seconds}-second hook rep`, `${S.unstick_seconds} second ka hook rep karo`) }
    };
  }

  // ---------- group shoot ----------

  const NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, ek: 1, do: 2, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, chheh: 6, saat: 7, aath: 8, nau: 9, das: 10 };
  const NUM = '(\\d{1,2}|' + Object.keys(NUM_WORDS).join('|') + ')';
  const SIZE_RES = [
    new RegExp('\\b' + NUM + '\\s*(?:of us|of them|friends?|people|persons?|dost(?:on)?|log|guys|ppl|members|creators|yaar)\\b', 'i'),
    new RegExp('\\b(?:group|squad|team|gang|crew) of ' + NUM + '\\b', 'i')
  ];

  function groupSize(text, G) {
    let size = G.default_size;
    for (const re of SIZE_RES) {
      const m = String(text || '').match(re);
      if (m) { const v = m[1].toLowerCase(); size = /^\d/.test(v) ? Number(v) : NUM_WORDS[v]; break; }
    }
    return Math.max(G.min_size, Math.min(G.max_size, size));
  }

  const ROLES = {
    en: [['Host', 'Talks to camera and delivers the hook'], ['Camera', 'Holds the phone and frames every shot'], ['Director', 'Calls the order and checks each take'], ['Reactor', 'Reacts on camera so it feels alive'], ['Props', 'Sets up props and the background'], ['Sound', 'Keeps noise down and checks audio'], ['Editor', 'Picks the best takes on the spot'], ['Extra', 'Fills the frame and jumps in anywhere']],
    hi: [['Host', 'Camera pe baat karta hai aur hook bolta hai'], ['Camera', 'Phone pakadta hai aur har shot frame karta hai'], ['Director', 'Order bolta hai aur har take check karta hai'], ['Reactor', 'Camera pe react karta hai taaki mazaa aaye'], ['Props', 'Props aur background set karta hai'], ['Sound', 'Shor kam rakhta hai aur audio check karta hai'], ['Editor', 'Best take wahin chun leta hai'], ['Extra', 'Frame bharta hai aur kahin bhi aa jaata hai']]
  };

  /* A shoot plan for friends from a chat message. Size comes from the text, clamped by config.group. */
  function groupPlan(text, profile, ctx) {
    const lang = L(profile, text);
    const G = ctx.appCfg.group;
    const n = nicheOf(profile && profile.niche);
    const people = groupSize(text, G);
    const prompt = pick(n.prompts, ctx.today + String(text || '') + (profile && profile.niche));
    const roles = ROLES[lang].slice(0, people).map((r, i) => ({ who: T(lang, `Person ${i + 1}`, `Banda ${i + 1}`), role: r[0], job: r[1] }));
    const slots = people + 2;
    const seconds = Math.max(1, Math.round(G.reel_seconds / slots));
    const shots = [{ who: roles[0].who, shot: T(lang, `Hook to camera: "${prompt}"`, `Camera pe hook: "${prompt}"`), seconds }]
      .concat(roles.map(r => ({ who: r.who, shot: T(lang, 'Gives their answer in one sentence, a different angle each time', 'Ek line mein apna jawab, har baar alag angle se'), seconds })))
      .concat([{ who: T(lang, 'Everyone', 'Sab log'), shot: T(lang, 'Group shot: vote on the best answer and say the ask together', 'Group shot: best jawab pe vote karo aur ask saath mein bolo'), seconds }]);
    return {
      people, roles,
      concept: T(lang, `Everyone answers the same question to camera, then you vote: "${prompt}"`, `Sab ek hi sawaal ka jawab camera pe dete hain, phir vote: "${prompt}"`),
      shots,
      minutes: G.shoot_minutes,
      checklist: lang === 'hi'
        ? ['Sabke phone charge hain', 'Jagah ki roshni check karo', 'Pehle poori script ek baar bol ke dekho', 'Har shot ke 2 take lo', 'Last mein 10 second ka group clip lo']
        : ['Everyone\'s phone is charged', 'Check the light where you shoot', 'Say the whole thing out loud once first', 'Take 2 takes of every shot', 'End with a 10-second group clip']
    };
  }

  return { VERSION, AGENTS, run, validate, validatePart, todayPick, unstick, groupPlan, groupSize };
});
