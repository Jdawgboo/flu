/* Coach v1: daily brief, reactions to reps, and chat replies in the persona from
 * prompts/coach.md. Rule-based for the Phase 1 prototype. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./content.js'));
  else root.LICoach = factory(root.LIContent);
})(typeof self !== 'undefined' ? self : this, function (Content) {
  'use strict';

  const NAME = 'Kavi';

  function hash(s) { let h = 0; s = String(s); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }
  function pick(list, seed) { return list[hash(seed) % list.length]; }

  const SKILL_LABEL = {
    en: { hooks: 'Hooks', retention: 'Retention and pacing', confidence: 'On-camera confidence', editing: 'Editing', storytelling: 'Storytelling', niche: 'Niche and consistency' },
    hi: { hooks: 'Hooks', retention: 'Retention aur pacing', confidence: 'Camera confidence', editing: 'Editing', storytelling: 'Storytelling', niche: 'Niche aur consistency' }
  };

  const PLATFORM_NAME = { instagram: 'Instagram', youtube: 'YouTube' };
  const fmtNum = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const platformName = p => PLATFORM_NAME[p] || p || '';

  function L(profile) { return profile && profile.language === 'hinglish' ? 'hi' : 'en'; }

  // Skills you can practise in Phase 1, used to choose the daily focus.
  const PRACTISABLE = ['hooks', 'storytelling', 'retention'];

  function dailyBrief(profile, ctx) {
    const lang = L(profile);
    const niche = Content.NICHES[profile.niche] || Content.NICHES.other;
    const prompt = pick(niche.prompts, ctx.today + profile.niche);
    const weakest = (ctx.skills || []).filter(s => PRACTISABLE.includes(s.name)).sort((a, b) => a.xp - b.xp)[0];
    const focus = weakest ? weakest.name : 'hooks';
    const s = ctx.streak || { current: 0 };
    const first = (profile.name || '').split(' ')[0] || (lang === 'hi' ? 'dost' : 'friend');
    let message;
    if (lang === 'hi') {
      if (ctx.streak.activeToday) message = `Aaj ka rep ho gaya, ${first}. Streak safe hai. Ek aur karoge toh skill aur tez badhegi.`;
      else if (s.current === 0 && s.lastBrokenRun >= ctx.gentleAfterDays) message = `${s.lastBrokenRun} din ka run zabardast tha. Naya run aaj se, chill.`;
      else if (s.current === 0) message = `Chalo ${first}, aaj se run shuru. Bas ek chhota rep, 5 minute.`;
      else if (s.current >= 7) message = `${s.current} din se lagatar. Tum sach mein lock in ho. Aaj ka rep karke run aage badhao.`;
      else message = `${s.current} din ka streak chal raha hai. Aaj ek rep aur, bas.`;
    } else {
      if (ctx.streak.activeToday) message = `Today's rep is done, ${first}. Your streak is safe. One more and your skills climb faster.`;
      else if (s.current === 0 && s.lastBrokenRun >= ctx.gentleAfterDays) message = `That ${s.lastBrokenRun}-day run was huge. Start a new one today, no pressure.`;
      else if (s.current === 0) message = `Let's start a run today, ${first}. One small rep, five minutes.`;
      else if (s.current >= 7) message = `${s.current} days straight. You're properly locked in. Do today's rep to keep it going.`;
      else message = `You're on a ${s.current}-day streak. One rep today keeps it alive.`;
    }
    return { prompt, focus, focusLabel: SKILL_LABEL[lang][focus], message, coach: NAME };
  }

  function react(profile, fb, xp) {
    const lang = L(profile);
    const sc = fb.score;
    const en = sc >= 9 ? ['That is scroll-stopping. Seriously.', 'Okay, I would stop for that.', 'Chef\'s kiss. Bookmark this one.']
      : sc >= 7 ? ['Strong rep. One tweak and it sings.', 'Good one. You are getting the hang of this.', 'Nice. That is post-ready with a small fix.']
      : sc >= 4 ? ['Solid start. Fix the one thing below and try again.', 'There is something here. Sharpen it.', 'Halfway there. The fix below gets you the rest.']
      : ['Every creator writes bad first drafts. Try the fix below.', 'Not there yet, and that is fine. One change at a time.', 'Warm-up rep. Now let\'s make it count.'];
    const hi = sc >= 9 ? ['Yeh toh scroll rok dega. Sach mein.', 'Main toh ruk jaata iske liye.', 'Ekdum mast. Isko save karke rakho.']
      : sc >= 7 ? ['Strong rep. Ek tweak aur perfect.', 'Badhiya. Tumhe samajh aa raha hai.', 'Nice. Chhota sa fix aur post-ready.']
      : sc >= 4 ? ['Accha start. Neeche wala fix karke phir try karo.', 'Kuch toh hai isme. Thoda sharp karo.', 'Aadha raasta ho gaya. Fix se baaki ho jaayega.']
      : ['Har creator ka first draft kharab hota hai. Neeche wala fix try karo.', 'Abhi nahi, aur koi baat nahi. Ek ek change.', 'Warm-up rep tha. Ab asli wala.'];
    const line = pick(lang === 'hi' ? hi : en, fb.fix + sc);
    let xpLine = '';
    if (xp && xp.notes.includes('daily_cap')) xpLine = lang === 'hi' ? ' Aaj ka practice XP cap ho gaya, kal phir milte hain.' : ' You hit today\'s practice XP cap. More tomorrow.';
    else if (xp && xp.notes.includes('low_quality')) xpLine = lang === 'hi' ? ' Is baar XP nahi mila. Fix karke dobara try karo.' : ' No XP this time. Try the fix and resubmit.';
    else if (xp && xp.notes.includes('no_change')) xpLine = lang === 'hi' ? ' Pehle jaisa hi hai, isliye XP nahi. Thoda badlo.' : ' Same as last time, so no XP. Change it to score higher.';
    return line + xpLine;
  }

  // ---------- post nudge: one line at most, from the creator's own self-reported posts ----------

  function daysBetween(a, b) {
    const t = d => { const [y, m, day] = d.split('-').map(Number); return Date.UTC(y, m - 1, day); };
    return Math.round((t(b) - t(a)) / 86400000);
  }

  /* ctx: { posts, weekCount, goal, insights, today, cfg }. Returns the first rule that fits, or null. */
  function postNudge(profile, ctx) {
    const lang = L(profile);
    const I = ctx.cfg.insights;
    const posts = (ctx.posts || []).filter(p => p && /^\d{4}-\d{2}-\d{2}$/.test(p.date) && p.date <= ctx.today);
    if (!posts.length) return null;

    const last = posts.reduce((m, p) => (p.date > m ? p.date : m), '');
    const gap = daysBetween(last, ctx.today);
    if (gap >= I.post_gap_nudge_days) {
      return lang === 'hi' ? `${gap} din se koi post log nahi hui. Ek chhota sa post bhi chalega.` : `It has been ${gap} days since your last post. A small one still counts.`;
    }

    // Days left in the week, today included (Monday is 7, Sunday is 1).
    const [y, m, d] = ctx.today.split('-').map(Number);
    const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
    const daysLeft = 7 - dow;
    const expected = ctx.goal * (dow + 1) / 7;
    if (ctx.weekCount < expected - I.pace_tolerance && daysLeft <= I.pace_days_left) {
      return lang === 'hi' ? `Is hafte ${ctx.weekCount}/${ctx.goal} posts hui hain aur ${daysLeft} din bache hain. Aaj ek post nikaalo.` : `You are at ${ctx.weekCount}/${ctx.goal} this week with ${daysLeft} day${daysLeft === 1 ? '' : 's'} left. Aim to post today.`;
    }

    if (ctx.weekCount >= ctx.goal) {
      return lang === 'hi' ? 'Weekly goal poora ho gaya. Ab bonus mein kuch naya try karo.' : 'Weekly goal hit. Try something new with the extra post.';
    }

    const g = (ctx.insights && ctx.insights.groups) || [];
    if (g.length >= 2 && g[1].median > 0 && g[0].median >= I.standout_ratio * g[1].median) {
      const name = `${platformName(g[0].platform)} ${g[0].format || 'posts'}`.trim();
      return lang === 'hi' ? `Tumhare ${name} sabse zyada views la rahe hain (median ${fmtNum(g[0].median)}). Aur banao.` : `Your ${name} get the most views lately (median ${fmtNum(g[0].median)}). Make more of them.`;
    }
    return null;
  }

  const INTENTS = [
    { re: /\b(buy|bought|purchase|fake|kharid)\w*\b.{0,24}\b(follower|view|like|subscriber|comment)|\bpaid (follower|view|like|subscriber)|\b(follower|view|like|subscriber)s?\b.{0,20}\b(buy|purchase|kharid|khareed)|follow ?(for|4) ?follow|\bf4f\b|\bl4l\b|engagement pods?|\bbots?\b/i, key: 'cheat' },
    { re: /\bhook|first line|opening|shuru/i, key: 'hook' },
    { re: /(no|low|less|kam|zero|not getting( any)?) (views|reach|likes)|(views|reach|likes) (are|is) (so )?(low|bad|dead|down)|views? (nahi|kam)|nobody (watches|sees)|flop/i, key: 'lowviews' },
    { re: /what'?s working|what is working|\bviews?\b|\bstats?\b|analytics|performance|kya (chal|kaam)/i, key: 'stats' },
    { re: /\bwhen\b.*\bpost|best time|kab post|timing/i, key: 'time' },
    { re: /idea|what (should|to) (i )?post|kya post|topic/i, key: 'ideas' },
    { re: /(brand|deal|money|paid|earn|gig|collab|paisa|kamai)/i, key: 'brands' },
    { re: /(consisten|streak|lazy|motivat|give up|quit|tired|bored|thak|mann nahi)/i, key: 'motivation' },
    { re: /(camera|shy|nervous|face|confiden|darr|sharam)/i, key: 'camera' },
    { re: /(edit|capcut|cuts|caption|transition)/i, key: 'editing' },
    { re: /(instagram|youtube|connect|creator account|business account)/i, key: 'connect' },
    { re: /(hi|hello|hey|namaste|yo)\b/i, key: 'hello' }
  ];

  const REPLIES = {
    en: {
      cheat: 'I will not help with that. Bought followers and views do not watch or engage, so your engagement rate drops and Instagram and YouTube show you to fewer real people. Brands check for it too. The slow way is the only way that pays.',
      hook: n => `Lead with the most surprising part, keep it 6 to 15 words, and add one real detail like a price or place. For ${n.label.toLowerCase()}, something like: "${n.strong[0]}". Want to practise? Open Practice and write three.`,
      lowviews: 'Low views early are normal and they are not a verdict on you. Compare each post only to your own last five. Pick one thing to change next time, usually the first 3 seconds, and keep your posting days fixed.',
      time: 'Consistency beats timing. Pick two or three days you can keep, post at roughly the same time, and check your own results after 48 hours. When your account is connected I will show you which of your slots works best.',
      ideas: n => `Try one of these: "${n.prompts[0]}" or "${n.prompts[1]}". Capture it in Ideas so it does not get lost.`,
      brands: 'Paid gigs unlock at the Gig-ready tier: consistent posting, a post with 10,000+ views or 1,000+ followers, and strong practice scores. Brands will see your verified numbers, so every rep now counts later.',
      motivation: 'Make the goal tiny: one rep a day, five minutes. Streak freezes cover a missed day now and then, so one bad day will not wipe you out. Showing up is the whole game.',
      camera: 'Everyone is awkward on camera at first. Record a 10-second clip you never post, three days in a row. Look at the lens, not the screen, and talk like you are sending a voice note to a friend.',
      editing: 'Cut every pause longer than half a second, add captions because most people watch muted, and change the shot every 2 to 3 seconds. Pre-post video reviews are coming soon in the app.',
      connect: 'Account connect arrives in the next phase. You will need a free Instagram creator or business account: Settings, Account type and tools, Switch to professional account. YouTube works with any channel.',
      hello: name => `Hey ${name}! I'm ${NAME}, your coach. Ask me about hooks, ideas, low views, posting times or brand deals.`,
      fallback: 'Good question. My short answer: do one rep today, post on your fixed days, and judge each post only against your own last few. Ask me about hooks, ideas, views, timing or brand deals for something more specific.'
    },
    hi: {
      cheat: 'Isme main help nahi karunga. Kharide hue followers aur views na dekhte hain na engage karte hain, toh engagement rate girta hai aur Instagram/YouTube tumhe kam real logon ko dikhata hai. Brands bhi check karte hain. Dheere wala raasta hi paise deta hai.',
      hook: n => `Sabse surprising cheez pehle bolo, 6 se 15 words rakho, aur ek asli detail daalo jaise price ya jagah. ${n.label} ke liye kuch aisa: "${n.strong[0]}". Practice mein jaake teen likho.`,
      lowviews: 'Shuru mein kam views normal hai, yeh tumhare baare mein faisla nahi hai. Har post ko sirf apne pichhle 5 se compare karo. Agli baar ek cheez badlo, mostly pehle 3 second, aur posting ke din fix rakho.',
      time: 'Timing se zyada consistency matter karti hai. 2-3 din fix karo, roughly same time pe post karo, aur 48 ghante baad apne results dekho. Account connect hone ke baad main bataunga kaunsa slot best hai.',
      ideas: n => `Yeh try karo: "${n.prompts[0]}" ya "${n.prompts[1]}". Ideas mein save kar lo taaki bhool na jao.`,
      brands: 'Paid gigs Gig-ready tier pe unlock hote hain: consistent posting, 10,000+ views wali post ya 1,000+ followers, aur acche practice scores. Brands tumhare verified numbers dekhenge, toh abhi ka har rep baad mein kaam aayega.',
      motivation: 'Goal chhota rakho: din ka ek rep, 5 minute. Streak freeze kabhi kabhi ek missed din cover kar leta hai. Roz aana hi poora game hai.',
      camera: 'Shuru mein sab camera pe awkward hote hain. Teen din lagatar 10 second ka clip record karo jo post nahi karna. Screen nahi, lens mein dekho, aur aise bolo jaise dost ko voice note bhej rahe ho.',
      editing: 'Aadhe second se lamba har pause kaato, captions daalo kyunki log mute pe dekhte hain, aur har 2-3 second mein shot badlo. Pre-post video review jaldi app mein aa raha hai.',
      connect: 'Account connect agle phase mein aa raha hai. Free Instagram creator ya business account chahiye: Settings, Account type and tools, Switch to professional account. YouTube kisi bhi channel ke saath chalega.',
      hello: name => `Hey ${name}! Main ${NAME} hoon, tumhara coach. Hooks, ideas, kam views, posting time ya brand deals ke baare mein pucho.`,
      fallback: 'Accha sawaal. Short answer: aaj ek rep karo, fixed din pe post karo, aur har post ko sirf apne pichhle posts se compare karo. Hooks, ideas, views, timing ya brand deals ke baare mein pucho toh aur specific bataunga.'
    }
  };

  // Answer "what's working?" from the creator's own logged posts; `insights` comes from the engine.
  function statsReply(lang, insights, cfg) {
    const g = insights && insights.groups || [];
    const best = insights && insights.best;
    const min = cfg ? cfg.insights.min_posts_per_format : 2;
    if (!g.length && !best) {
      return lang === 'hi' ? `Abhi mere paas views ka data nahi hai. You tab mein "Your posts" mein posts log karo aur views daalo, phir main bataunga kya chal raha hai.`
        : 'I do not have any view counts yet. Log your posts under Your posts on the You tab and add their views, then I can tell you what is working.';
    }
    const lines = [];
    if (g.length) {
      const t = g[0];
      const name = `${platformName(t.platform)} ${t.format || 'posts'}`.trim();
      lines.push(lang === 'hi' ? `Abhi tumhara sabse acha ${name} hai: median ${fmtNum(t.median)} views (${t.posts} posts).` : `Your strongest format lately is ${name}: median ${fmtNum(t.median)} views over ${t.posts} posts.`);
    } else {
      lines.push(lang === 'hi' ? `Ek hi format ke ${min} posts views ke saath log hon tab main formats compare kar paunga.` : `Once you have ${min} posts of the same format with views, I can compare formats.`);
    }
    if (best) {
      const name = `${platformName(best.platform)} ${best.format || 'post'}`.trim();
      lines.push(lang === 'hi' ? `Tumhara best: ${name}, ${fmtNum(best.views)} views.` : `Your best: ${name}, ${fmtNum(best.views)} views.`);
    }
    lines.push(lang === 'hi' ? 'Yeh tumhare apne self-reported numbers hain, sirf tumhare apne posts se compare hue.' : 'These are your self-reported numbers, compared only with your own posts.');
    return lines.join(' ');
  }

  function chat(profile, message, ctx) {
    const lang = L(profile);
    const n = Content.NICHES[profile.niche] || Content.NICHES.other;
    const intent = INTENTS.find(i => i.re.test(message));
    if (intent && intent.key === 'stats') return statsReply(lang, ctx && ctx.insights, ctx && ctx.cfg);
    const r = REPLIES[lang][intent ? intent.key : 'fallback'];
    if (typeof r === 'function') return intent.key === 'hello' ? r((profile.name || '').split(' ')[0] || 'there') : r(n);
    return r;
  }

  return { NAME, dailyBrief, react, chat, postNudge, fmtNum, platformName, SKILL_LABEL };
});
