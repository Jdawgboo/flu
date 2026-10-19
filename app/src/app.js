/* LockIn Phase 1 app: onboarding, the Home chat with the studio, ideas, practice reps, blackboard and profile.
 * Renders into #app from template strings; every click goes through one delegated handler
 * keyed by data-action. State lives in localStorage ('lockin.v1') and falls back to memory
 * when storage is blocked. All XP numbers come from window.LI_CONFIG via LIEngine. */
(function () {
  'use strict';

  const E = window.LIEngine, C = window.LIContent, G = window.LIGrader, K = window.LICoach, IGM = window.LIInstagram, ST = window.LIStudio, R = window.LIRouter, V = window.LIVoice;
  const cfg = window.LI_CONFIG;
  const APP = cfg.app || {};
  const SC = APP.studio;
  const KEY = 'lockin.v1';
  const STAGES = ['idea', 'hook', 'script', 'filmed', 'posted'];
  const STAGE_LABEL = { idea: 'Idea', hook: 'Hook', script: 'Script', filmed: 'Filmed', posted: 'Posted' };
  const WPS = 2.5; // spoken words per second, for script timing
  const DEMO_CODE = '123456';
  const IG_BASE = (cfg.app && cfg.app.ig_api_base) || ''; // empty = demo mode with a built-in sample creator
  // Connecting Instagram fills in name, niche, language and weekly goal, so those screens drop out.
  const OB_IG = ['agree', 'connect', 'confirm', 'exercise'];
  const OB_MANUAL = ['agree', 'connect', 'signin', 'name', 'goal', 'niche', 'weekly', 'exercise'];
  const OB_REQUIRED = ['agree', 'niche'];
  const obSteps = () => (state.ob.data && state.ob.data.manual ? OB_MANUAL : OB_IG);
  const IG_ERRORS = {
    account_type: 'Instagram only shares data from creator or business accounts. Switch yours for free: Instagram → Settings → Account type and tools → Switch to professional account → Creator. Then connect again.',
    denied: 'Instagram was not connected because access was not allowed. You can try again or fill in your details instead.',
    network: 'Could not reach the Instagram connection service. Check your internet and try again, or fill in your details instead.',
    expired: 'Your Instagram connection expired. Connect again to refresh.',
    failed: 'Something went wrong connecting Instagram. Please try again, or fill in your details instead.'
  };

  // ---------- time (overridable for tests) ----------

  let fixedNow = null;
  const now = () => (fixedNow != null ? fixedNow : Date.now());
  const iso = t => new Date(t).toISOString();

  // ---------- storage ----------

  let memory = null;

  function fresh() {
    return {
      v: 4, voice: { replies: true }, profile: null, ob: { step: 'welcome', data: {} },
      ledger: [], reps: [], ideas: [], lessonsDone: [], chat: [], posts: [], board: { text: '', cards: [], saves: [] },
      notif: { day: '', count: 0, sent: {} }, seenLevel: 1, highestTier: 'starter', leagueIndex: 0
    };
  }

  function load() {
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { raw = null; }
    if (!raw) raw = memory;
    try { return raw ? E.migrate(Object.assign(fresh(), JSON.parse(raw))) : fresh(); } catch (e) { return fresh(); }
  }

  function save() {
    const raw = JSON.stringify(state);
    memory = raw;
    try { localStorage.setItem(KEY, raw); } catch (e) { /* private mode or sandbox: memory only */ }
  }

  let state = load();
  const ui = { igBusy: false, igErr: '', confirmIg: false, editPost: null, tab: 'home', view: null, draft: {}, filter: 'all', err: '', otpSent: false, modals: [], confirmDelete: false, exportText: null, exportCopied: false, ideaConfirm: null, listening: false, thinking: false, micHint: false, micMsg: '', voice: 'idle', heard: '', chatScroll: false };

  // ---------- helpers ----------

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const draft = k => (ui.draft[k] == null ? '' : ui.draft[k]);
  const profile = () => state.profile || obProfile();
  const gradeOpts = () => ({ niche: profile().niche || 'other', language: profile().language || 'english' });
  const niche = () => C.NICHES[profile().niche] || C.NICHES.other;
  const lang = () => (profile().language === 'hinglish' ? 'hi' : 'en');
  const streak = () => E.dailyStreak(state, cfg, now());
  const briefCtx = s => ({ today: E.localDay(now()), skills: E.skills(state, cfg), streak: s || streak(), gentleAfterDays: cfg.streaks.gentle_after_days });
  const fmtNum = K.fmtNum;
  const platformName = p => K.platformName(p);
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

  function obProfile() {
    const d = state.ob.data || {};
    return { name: d.name || '', niche: d.niche || 'other', language: d.language || 'english', weeklyGoal: d.weeklyGoal || cfg.weekly_goal.suggested, notifyTime: d.notifyTime || '19:00' };
  }

  function activeDays() {
    const reversed = new Set(state.ledger.filter(e => e.reverses).map(e => e.reverses));
    return new Set(state.ledger.filter(e => e.amount > 0 && !e.reverses && !reversed.has(e.id)).map(e => e.day));
  }

  function fmtDate(t) {
    const d = new Date(t);
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + ', ' + d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  }

  function wordCount(text) { return String(text || '').trim().split(/\s+/).filter(Boolean).length; }

  function xpRange(type) {
    const r = cfg.xp[type];
    return r.bonus ? `+${r.base}–${r.base + r.bonus} XP` : `+${r.base} XP`;
  }

  function scoreTone(score) { return score >= 7 ? 'good' : score >= cfg.anti_gaming.min_quality_score ? 'gold' : 'bad'; }
  function ringColor(score) { return score >= 7 ? 'var(--good)' : score >= cfg.anti_gaming.min_quality_score ? 'var(--marigold)' : 'var(--bad)'; }

  function toast(msg) {
    document.querySelectorAll('.toast').forEach(t => t.remove());
    const t = document.createElement('div');
    t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2800);
  }

  function burst(n) {
    if (!n) return;
    const b = document.createElement('div');
    b.className = 'xpburst'; b.setAttribute('aria-hidden', 'true'); b.textContent = '+' + n + ' XP';
    document.body.appendChild(b);
    setTimeout(() => b.remove(), 1400);
    // Let the burst play before a celebration modal covers it.
    if (ui.modals.length && !ui.holdModal) {
      ui.holdModal = true;
      const o = document.querySelector('.overlay');
      if (o) o.remove();
      setTimeout(() => { ui.holdModal = false; render(); }, 1200);
    }
  }

  // ---------- XP, reps and celebrations ----------

  function snapshot() {
    return { level: E.levelFor(E.totalXP(state), cfg).level, streak: streak().current };
  }

  // Queue the level-up and streak-milestone modals an action earned.
  function celebrate(before) {
    const after = snapshot();
    // Tiers only go up; remember the highest one reached here, not while rendering.
    const tr = E.tier(state, cfg), ids = cfg.tiers.map(t => t.id);
    if (tr.index > ids.indexOf(state.highestTier || ids[0])) { state.highestTier = tr.current.id; save(); }
    if (after.level > (state.seenLevel || 1)) {
      ui.modals.push({ kind: 'level', level: after.level });
      state.seenLevel = after.level;
    }
    if (after.streak > before.streak && cfg.streaks.milestones.includes(after.streak)) ui.modals.push({ kind: 'streak', days: after.streak });
    if (after.streak > before.streak && after.streak % cfg.streaks.freeze_every_days === 0 && streak().freezes > 0) ui.modals.push({ kind: 'freeze', days: after.streak });
  }

  const GRADERS = { hook: G.gradeHook, rewrite: G.gradeHook, script: G.gradeScript };

  // Grade one piece of writing, save the rep and append its XP row. Shared by live reps and the demo seed.
  function doRep(st, type, content, opts, t) {
    const fb = GRADERS[type](content, opts.grade);
    const rep = { id: E.uid('rep'), type, content, ideaId: opts.ideaId || null, prompt: opts.prompt || null, feedback: fb, created_at: iso(t) };
    const again = E.isRepeatRep(content, type, st, cfg);
    const entry = E.award(st, cfg, { source: type, sourceId: rep.id, score: fb.score, words: wordCount(content), repeat: again.repeat, bestRepeatScore: again.bestScore, now: t });
    rep.xp = entry.amount;
    rep.notes = entry.notes.slice();
    st.reps.push(rep);
    return { rep, entry, fb };
  }

  function moveStage(idea, stage, t) {
    if (!idea || STAGES.indexOf(stage) <= STAGES.indexOf(idea.stage)) return false;
    idea.stage = stage;
    idea.history.push({ stage, at: iso(t) });
    return true;
  }

  function makeIdea(st, text, source, t) {
    const dup = E.isDuplicateIdea(text, st.ideas, cfg);
    const fb = G.gradeIdea(text, { niche: (st.profile || obProfile()).niche || 'other', language: (st.profile || obProfile()).language });
    const idea = { id: E.uid('idea'), text, stage: 'idea', score: fb.score, feedback: { strength: fb.strength, fix: fb.fix }, duplicate: dup, source: source || 'text', created_at: iso(t), history: [{ stage: 'idea', at: iso(t) }] };
    const entry = E.award(st, cfg, { source: 'idea', sourceId: idea.id, score: fb.score, duplicate: dup, now: t });
    idea.xp = entry.amount;
    st.ideas.unshift(idea);
    return { idea, entry };
  }

  function addIdea(text, source) {
    text = String(text || '').trim();
    if (!text) { toast('Write your idea first'); return null; }
    const before = snapshot();
    const { idea, entry } = makeIdea(state, text, source, now());
    if (source !== 'chat') ui.draft.ideaText = '';
    save();
    celebrate(before);
    render();
    if (entry.notes.includes('duplicate')) toast('Saved, but it is very close to an idea you already have, so 0 XP');
    else if (entry.notes.includes('low_quality')) toast('Saved. Too vague for XP yet: ' + idea.feedback.fix);
    else if (entry.notes.includes('daily_cap') && !entry.amount) toast('Saved. Daily practice XP cap reached');
    else { toast(`Idea saved: ${idea.score}/10`); burst(entry.amount); }
    return idea;
  }

  function noteText(note, type) {
    const r = cfg.xp[type] || {};
    return {
      quality_bonus: `Quality bonus: +${r.bonus} XP for scoring ${r.bonus_min_score}+`,
      daily_cap: `Daily practice cap reached (${cfg.daily_practice_cap} XP a day). Your streak still counts.`,
      low_quality: `Scores under ${cfg.anti_gaming.min_quality_score} earn 0 XP. Use the fix and try again.`,
      duplicate: 'Too close to an idea you already have, so 0 XP.',
      too_short: 'Too short to earn XP.',
      daily_limit: 'Daily limit for this kind of XP reached.',
      no_change: 'Same as before. Change it enough to score higher to earn XP.'
    }[note] || note;
  }

  // ---------- rendering ----------

  const ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
    ideas: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1.1 2l.1.7h4.8l.1-.7c.1-.8.5-1.5 1.1-2A6 6 0 0 0 12 3z"/>',
    practice: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    you: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'
  };
  const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

  function applyTheme() {
    const t = state.profile && state.profile.theme;
    const r = document.documentElement;
    if (t === 'light' || t === 'dark') r.setAttribute('data-theme', t); else r.removeAttribute('data-theme');
  }

  function render() {
    applyTheme();
    const root = document.getElementById('app');
    if (!root) return;
    const onboarded = state.profile && state.profile.onboarded;
    const oldChat = document.getElementById('chat');
    const keep = oldChat ? oldChat.scrollTop : null;
    root.innerHTML = (onboarded ? mainView() : onboardingView()) + modalView();
    const chat = document.getElementById('chat');
    if (chat) {
      // Keep the thread where it was; jump to the newest message after a send or on first show.
      if (ui.chatScroll || keep == null) {
        const last = chat.lastElementChild;
        chat.scrollTop = ui.chatScroll === 'start' && last && last.classList.contains('studio-set') ? last.offsetTop - chat.offsetTop : chat.scrollHeight;
      } else chat.scrollTop = keep;
      ui.chatScroll = false;
    }
  }

  function go(patch) {
    Object.assign(ui, patch);
    ui.err = '';
    render();
    try { window.scrollTo(0, 0); } catch (e) { /* ignore */ }
  }

  function errLine() { return ui.err ? `<p class="err" role="alert">${esc(ui.err)}</p>` : ''; }

  // ---------- onboarding ----------

  function obGo(step) { state.ob.step = step; save(); go({}); }

  function obFrame(step, inner, foot) {
    const steps = obSteps();
    const i = steps.indexOf(step === 'result' ? 'exercise' : step);
    const canSkip = !OB_REQUIRED.includes(step) && step !== 'result' && step !== 'connect' && step !== 'confirm';
    return `<section class="screen bare">
      <div class="ob-top">
        ${step === 'result' ? '<span></span>' : '<button class="btn ghost sm" data-action="ob-back" aria-label="Back">←</button>'}
        <div class="dots" aria-label="Step ${i + 1} of ${steps.length}">${steps.map((s, j) => `<i class="${j === i ? 'on' : ''}"></i>`).join('')}</div>
        ${canSkip ? '<button class="linkbtn" data-action="ob-skip">Skip</button>' : '<span style="width:36px"></span>'}
      </div>
      <div class="ob-body">${inner}</div>
      <div class="ob-foot">${errLine()}${foot}</div>
    </section>`;
  }

  function onboardingView() {
    const step = state.ob.step || 'welcome';
    const d = state.ob.data;
    if (step === 'welcome') {
      return `<section class="screen bare">
        <div class="ob-top"><span class="wordmark">Lock<b>In</b></span></div>
        <div class="ob-body">
          <div class="welcome-art">
            <span class="label">For new creators in India</span>
            <h1>Five minutes a day. Real creator skills.</h1>
            <p>Daily reps, honest feedback from your coach, and a ladder that ends in paid brand gigs.</p>
            <div class="ladder-mini">${cfg.tiers.map(t => `<span>${esc(t.name)}</span>`).join('')}</div>
          </div>
          <div class="stack">
            <div class="row"><span class="em" aria-hidden="true">✍️</span><p>Write hooks, scripts and ideas. Get a score and one clear fix in seconds.</p></div>
            <div class="row"><span class="em" aria-hidden="true">🔥</span><p>Keep a daily streak. Freezes cover the odd missed day.</p></div>
            <div class="row"><span class="em" aria-hidden="true">🏆</span><p>Tiers go up with real results, never down because of low views.</p></div>
          </div>
        </div>
        <div class="ob-foot">
          <button class="btn block" data-action="ob-start">Get started</button>
          <button class="btn ghost block" data-action="demo">Try a demo profile</button>
        </div>
      </section>`;
    }
    if (step === 'blocked') {
      return `<section class="screen bare"><div class="blocked">
        <div class="huge" style="font-size:54px" aria-hidden="true">🔒</div>
        <h2>LockIn is for creators 18 and over</h2>
        <p class="muted">We can't create an account for you yet. Paid brand work needs an adult account, and this version does not support parental consent. We have not saved the details you entered.</p>
        <button class="btn block" data-action="ob-reset">Back to start</button>
      </div></section>`;
    }
    if (step === 'agree') {
      return obFrame('agree', `
        <h1>Before we start</h1>
        <p class="muted">LockIn is for creators 18 and over, because tiers lead to paid brand work.</p>
        <label class="field"><span>Birth date</span><input type="date" data-bind="birthDate" max="${E.localDay(now())}" min="1900-01-01" value="${esc(draft('birthDate') || d.birthDate || '')}"></label>
        <label class="check"><input type="checkbox" data-bind="consent" ${draft('consent') || d.consentAt ? 'checked' : ''}>
          <span>I agree to LockIn processing my details to run my account, as described in the notice below.</span></label>
        <p class="notice"><b>Privacy notice (DPDP Act 2023).</b> We use your birth date, name, niche, practice work and, if you connect Instagram, your public profile and recent posts, only to run your account and coach you. In this prototype it all stays in this browser on this device. Connecting Instagram is read-only and optional. You can export, disconnect or delete everything any time from You → Settings.</p>
      `, '<button class="btn block" data-action="ob-agree">Continue</button>');
    }
    if (step === 'connect') return connectView();
    if (step === 'confirm') return confirmView();
    if (step === 'signin') {
      const phoneBlock = ui.otpSent
        ? `<label class="field"><span>Enter the 6-digit code sent to +91 ${esc(d.phone || '')}</span>
             <input type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" data-bind="otp" value="${esc(draft('otp'))}" placeholder="••••••"></label>
           <p class="notice">Demo prototype: no SMS is sent. Your code is <b class="num">${DEMO_CODE}</b>.</p>
           <button class="btn block" data-action="otp-verify">Verify and continue</button>
           <button class="linkbtn" data-action="otp-change">Use a different number</button>`
        : `<label class="field"><span>Mobile number</span>
             <div class="row"><span class="chip num">+91</span><input type="tel" inputmode="numeric" autocomplete="tel-national" maxlength="10" data-bind="phone" value="${esc(draft('phone'))}" placeholder="98765 43210"></div></label>
           <button class="btn block" data-action="otp-send">Send code</button>`;
      return obFrame('signin', `
        <h1>Create your account</h1>
        <p class="muted">Sign in so your streak and progress have a home. (Connecting Instagram instead skips this.)</p>
        ${phoneBlock}
        <div class="row muted small" style="justify-content:center">or</div>
        <button class="btn ghost block" data-action="google">${GOOGLE_G} Continue with Google</button>
      `, '');
    }
    if (step === 'name') {
      return obFrame('name', `
        <h1>What should your coach call you?</h1>
        <label class="field"><span>First name</span><input type="text" autocomplete="given-name" maxlength="40" data-bind="name" value="${esc(draft('name') || d.name || '')}" placeholder="Priya"></label>
      `, '<button class="btn block" data-action="ob-name">Continue</button>');
    }
    if (step === 'goal') {
      return obFrame('goal', `
        <h1>What's your goal?</h1>
        <div class="options one">${C.GOALS.map(g => `<button class="opt" data-action="ob-pick" data-key="goal" data-val="${g.id}" aria-pressed="${d.goal === g.id}"><b>${esc(g.label)}</b><small>${esc(g.sub)}</small></button>`).join('')}</div>
      `, '<button class="btn block" data-action="ob-next-from" data-step="goal">Continue</button>');
    }
    if (step === 'niche') {
      return obFrame('niche', `
        <h1>Pick your niche</h1>
        <p class="muted">Your prompts, examples and feedback are tuned to it. You can change it later.</p>
        ${nichePickers(d)}
      `, '<button class="btn block" data-action="ob-niche">Continue</button>');
    }
    if (step === 'weekly') {
      return obFrame('weekly', `
        <h1>How often will you post?</h1>
        <p class="muted">Pick a number you can keep. Most new creators start with ${cfg.weekly_goal.suggested} a week.</p>
        ${weeklyPickers(d)}
      `, '<button class="btn block" data-action="ob-weekly">Continue</button>');
    }
    if (step === 'exercise') {
      const n = niche();
      return obFrame('exercise', `
        <span class="label">Your first rep · about 60 seconds</span>
        <h1>Write 3 hooks for a ${esc(n.label.toLowerCase())} video</h1>
        <div class="coach-line"><div class="avatar" aria-hidden="true">${K.NAME[0]}</div>
          <p>A hook is the first line of your video. Viewers decide in 3 seconds, so lead with the surprise. Like this: <b>"${esc(n.strong[0])}"</b></p></div>
        ${hookInputs(n)}
      `, `<button class="btn block" data-action="ob-hooks">Grade my hooks</button>`);
    }
    if (step === 'result') {
      const r = ui.obResult;
      if (!r) { state.ob.step = 'exercise'; return onboardingView(); }
      const s = streak();
      const head = r.xp > 0
        ? `<div class="card hero" style="text-align:center;align-items:center"><div style="font-size:44px" aria-hidden="true">🎉</div><h1 class="num">+${r.xp} XP</h1><p>Your first XP. 🔥 Day ${s.current} of your streak starts now.</p></div>`
        : `<div class="card warn"><h2>No XP on this one</h2><p>Every creator writes weak first drafts. Use the fix below and try again, or carry on and do a rep from Home.</p></div>`;
      return obFrame('result', head + feedbackCards(r), `
        <button class="btn block" data-action="ob-finish">Finish and go home</button>
        <button class="btn ghost block" data-action="ob-retry">Try again</button>`);
    }
    state.ob.step = 'welcome';
    return onboardingView();
  }

  // Shared by the manual niche and weekly steps and the Instagram confirm screen.
  function nichePickers(d) {
    return `<div class="options three">${Object.entries(C.NICHES).map(([id, n]) => `<button class="opt" data-action="ob-pick" data-key="niche" data-val="${id}" aria-pressed="${d.niche === id}"><span class="em" aria-hidden="true">${n.emoji}</span><b>${esc(n.label)}</b></button>`).join('')}</div>
      <span class="label">Coach language</span>
      <div class="options">${[['english', 'English', 'Clear and simple'], ['hinglish', 'Hinglish', 'Thoda mix, thoda masti']].map(([id, l, s]) => `<button class="opt" data-action="ob-pick" data-key="language" data-val="${id}" aria-pressed="${(d.language || 'english') === id}"><b>${l}</b><small>${s}</small></button>`).join('')}</div>`;
  }

  function weeklyPickers(d) {
    const g = d.weeklyGoal || cfg.weekly_goal.suggested;
    return `<div class="stepper">
        <button data-action="ob-goal" data-d="-1" aria-label="Fewer posts" ${g <= cfg.weekly_goal.min ? 'disabled' : ''}>−</button>
        <div class="stack" style="align-items:center;gap:2px"><span class="big num">${g}</span><span class="muted small">posts a week</span></div>
        <button data-action="ob-goal" data-d="1" aria-label="More posts" ${g >= cfg.weekly_goal.max ? 'disabled' : ''}>+</button>
      </div>
      <label class="field"><span>Daily reminder from your coach</span><input type="time" data-bind="notifyTime" value="${esc(draft('notifyTime') || d.notifyTime || '19:00')}"></label>
      <p class="small muted">We send at most ${cfg.notifications.max_per_day} reminders a day and never between ${cfg.notifications.quiet_start} and ${cfg.notifications.quiet_end}.</p>`;
  }

  function igCard(ig) {
    const initial = (ig.name || ig.username || '?').trim()[0].toUpperCase();
    return `<div class="card" id="ig-card"><div class="row"><div class="avatar" aria-hidden="true">${esc(initial)}</div>
        <div class="grow stack" style="gap:2px"><b>${esc(ig.name || ig.username)}</b><span class="muted small">@${esc(ig.username)}</span></div>
        ${ig.demo ? '<span class="pill gold">Sample data</span>' : '<span class="pill">Imported</span>'}</div>
      <div class="row small"><span><b class="num">${fmtNum(ig.followers_count)}</b> followers</span><span><b class="num">${fmtNum(ig.media_count)}</b> posts</span></div>
      ${ig.demo ? '<p class="small muted">Demo mode: this is a made-up sample creator, not your account.</p>' : ''}</div>`;
  }

  function connectView() {
    const ig = state.instagram;
    if (ig) {
      return obFrame('connect', `
        <h1>Instagram connected</h1>
        ${igCard(ig)}
      `, '<button class="btn block" data-action="ob-confirm-go">Continue</button><button class="linkbtn" data-action="ob-manual">Fill in manually instead</button>');
    }
    const label = ui.igBusy ? 'Connecting…' : IG_BASE ? 'Connect Instagram' : 'Connect Instagram (demo)';
    return obFrame('connect', `
      <h1>Connect Instagram</h1>
      <p class="muted">LockIn reads your profile and recent posts to fill in your name, niche, language and posting goal. It is read-only and never posts for you.</p>
      <div class="card"><h3>What you need</h3>
        <p class="small muted">A free creator or business account. To switch: Instagram → Settings → Account type and tools → Switch to professional account → Creator. You can switch back.</p></div>
      ${IG_BASE ? '' : '<p class="notice">Demo mode: no real account is connected. This loads a sample creator (@priya.eats) so you can see the flow.</p>'}
      <p class="small muted">YouTube is not connected yet.</p>
      ${ui.igErr ? `<p class="err" role="alert">${esc(ui.igErr)}</p>` : ''}
    `, `<button class="btn block" data-action="ig-connect" ${ui.igBusy ? 'disabled' : ''}>${label}</button><button class="linkbtn" data-action="ob-manual">Fill in manually instead</button>`);
  }

  function confirmView() {
    const d = state.ob.data, ig = state.instagram;
    if (!ig) { state.ob.step = 'connect'; return onboardingView(); }
    return obFrame('confirm', `
      <h1>Does this look right?</h1>
      ${igCard(ig)}
      ${(d.igNotes || []).length ? `<p class="small muted">${d.igNotes.map(esc).join(' ')}</p>` : ''}
      <label class="field"><span>First name</span><input type="text" autocomplete="given-name" maxlength="40" data-bind="name" value="${esc(draft('name') || d.name || '')}" placeholder="Priya"></label>
      <span class="label">Niche</span>
      ${nichePickers(d)}
      <span class="label">Weekly posting goal</span>
      ${weeklyPickers(d)}
    `, '<button class="btn block" data-action="ob-confirm">Looks good</button>');
  }

  const GOOGLE_G = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';

  function hookInputs(n) {
    return [0, 1, 2].map(i => `<label class="field"><span>Hook ${i + 1}${i ? ' (optional)' : ''}</span>
      <input type="text" maxlength="160" data-bind="hook${i}" value="${esc(draft('hook' + i))}" placeholder="${esc(i === 0 ? 'e.g. ' + n.weak[0] + '… but better' : 'Another angle')}"></label>`).join('');
  }

  function ageOn(birth, t) {
    const [y, m, d] = birth.split('-').map(Number);
    const n = new Date(t);
    let a = n.getFullYear() - y;
    if (n.getMonth() + 1 < m || (n.getMonth() + 1 === m && n.getDate() < d)) a--;
    return a;
  }

  function finishOnboarding() {
    const d = state.ob.data;
    state.profile = {
      name: d.name || '', phone: d.phone || '', authMethod: d.method || (state.instagram ? 'instagram' : 'guest'), birthDate: d.birthDate,
      goal: d.goal || null, niche: d.niche, language: d.language || 'english',
      weeklyGoal: d.weeklyGoal || cfg.weekly_goal.suggested, notifyTime: d.notifyTime || '19:00',
      timezone: (Intl.DateTimeFormat().resolvedOptions().timeZone || ''), theme: 'system', notifications: false,
      consentAt: d.consentAt || iso(now()), createdAt: iso(now()), onboarded: true
    };
    state.ob = { step: 'done', data: {} };
    state.seenLevel = E.levelFor(E.totalXP(state), cfg).level;
    ui.draft = {}; ui.obResult = null;
    save();
    go({ tab: 'home', view: null });
    toast(`Welcome to LockIn${state.profile.name ? ', ' + state.profile.name : ''}`);
  }

  // ---------- main tabs ----------

  function topbar() {
    const s = streak();
    const xp = E.totalXP(state);
    return `<header class="topbar"><span class="wordmark">Lock<b>In</b></span>
      <div class="chips">
        <span class="chip flame" title="Day streak" aria-label="${plural(s.current, 'day')} streak">🔥 <span class="num">${s.current}</span></span>
        <span class="chip freeze" title="Streak freezes" aria-label="${plural(s.freezes, 'streak freeze')}">❄️ <span class="num">${s.freezes}</span></span>
        <span class="chip" title="Total XP" aria-label="${xp} XP">⚡ <span class="num">${xp}</span></span>
      </div></header>`;
  }

  function tabbar() {
    const tabs = [['home', 'Home'], ['ideas', 'Ideas'], ['practice', 'Practice'], ['you', 'You']];
    return `<div class="tabbar"><nav aria-label="Main">${tabs.map(([id, label]) => `<button class="tab" data-action="tab" data-tab="${id}" ${ui.tab === id && !ui.view ? 'aria-current="page"' : ''}>${icon(id)}<span>${label}</span></button>`).join('')}</nav></div>`;
  }

  function mainView() {
    const body = ui.view ? subView() : { home: homeView, ideas: ideasView, practice: practiceView, you: youView }[ui.tab]();
    return body + tabbar();
  }

  function levelCard() {
    const xp = E.totalXP(state);
    const L = E.levelFor(xp, cfg);
    return `<div class="card tight"><div class="row between"><h3>Level <span class="num">${L.level}</span></h3><span class="small muted num">${L.into} / ${L.span} XP</span></div>
      <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="${L.span}" aria-valuenow="${L.into}" aria-label="Level progress"><i style="width:${Math.round(L.into / L.span * 100)}%"></i></div>
      <p class="small muted">${L.next - xp} XP to level ${L.level + 1}</p></div>`;
  }

  function weekStrip() {
    const s = streak();
    const active = activeDays();
    const today = E.localDay(now());
    const ws = E.weekStart(now());
    const days = Array.from({ length: 7 }, (_, i) => E.addDays(ws, i));
    return `<div class="card tight"><div class="row between"><h3>This week</h3><span class="small muted">${s.longest > s.current ? 'Best run ' + s.longest + ' days' : ''}</span></div>
      <div class="week">${days.map((d, i) => {
        const on = active.has(d), frz = s.frozenDays.includes(d);
        const cls = [on ? 'on' : '', frz ? 'frz' : '', d === today ? 'today' : ''].join(' ');
        const label = on ? 'active' : frz ? 'covered by a freeze' : d > today ? 'upcoming' : d === today ? 'today, no rep yet' : 'missed';
        return `<div class="d ${cls}" aria-label="${'Mon Tue Wed Thu Fri Sat Sun'.split(' ')[i]}: ${label}"><i>${on ? '🔥' : frz ? '❄️' : Number(d.slice(8))}</i>${'MTWTFSS'[i]}</div>`;
      }).join('')}</div></div>`;
  }

  function nextIdea() {
    return state.ideas.filter(i => i.stage !== 'posted')
      .sort((a, b) => STAGES.indexOf(b.stage) - STAGES.indexOf(a.stage) || a.created_at.localeCompare(b.created_at))[0];
  }

  function ideaNextAction(idea, sm) {
    const cls = sm ? 'btn sm' : 'btn block';
    if (idea.stage === 'idea') return `<button class="${cls}" data-action="idea-rep" data-type="hook" data-id="${idea.id}">Write the hook</button>`;
    if (idea.stage === 'hook') return `<button class="${cls}" data-action="idea-rep" data-type="script" data-id="${idea.id}">Write the script</button>`;
    if (idea.stage === 'script') return `<button class="${cls}" data-action="idea-stage" data-stage="filmed" data-id="${idea.id}">Mark filmed</button>`;
    if (idea.stage === 'filmed') return `<button class="${cls}" data-action="idea-stage" data-stage="posted" data-id="${idea.id}">Mark posted</button>`;
    return '';
  }

  function postedThisWeek() { return E.postsInWeek(state, now()).length; }

  function postDayLabel(date) {
    const [y, m, d] = date.split('-').map(Number);
    const dt = new Date(y, m - 1, d, 12);
    return E.addDays(date, 6) >= E.localDay(now()) ? dt.toLocaleDateString('en-IN', { weekday: 'long' }) : dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }

  function homeView() {
    const p = state.profile;
    const s = streak();
    const brief = K.dailyBrief(p, briefCtx(s));
    const hoursLeft = E.hoursLeftToday(now());
    const atRisk = !s.activeToday && s.current > 0 && E.minutesOfDay(now()) >= E.streakRiskStart(cfg, p);
    const lg = E.league(state, cfg, now());
    const up = cfg.leagues.ladder[(state.leagueIndex || 0) + 1];
    const zone = lg.zone === 'promote' ? `<span class="pill good">Promotion zone</span>` : lg.zone === 'demote' ? `<span class="pill bad">Drop zone</span>` : `<span class="pill">Safe</span>`;
    const zoneLine = lg.zone === 'promote' ? (up ? `Finish in the top ${cfg.leagues.promote_top} to move up to ${up}.` : 'Top of the ladder. Stay sharp.')
      : lg.zone === 'demote' ? `The bottom ${cfg.leagues.demote_bottom} drop a division. One rep can lift you out.` : `Top ${cfg.leagues.promote_top} move up on Sunday night.`;
    const idea = nextIdea();
    const posted = postedThisWeek();
    const goal = p.weeklyGoal;
    const mins = Math.max(0, Math.floor(hoursLeft * 60));
    const nudge = K.postNudge(p, { posts: state.posts, weekCount: posted, goal, insights: E.postInsights(state, cfg, now()), today: E.localDay(now()), cfg });
    const due = E.postNeedingViews(state, cfg, now());
    const tp = ST.todayPick(p, studioCtx());

    return `<section class="screen">${topbar()}
      ${atRisk ? `<div class="card warn" role="alert"><div class="row"><span style="font-size:24px" aria-hidden="true">⏳</span><div class="grow"><h3>Your ${s.current}-day streak is at risk</h3>
        <p class="small">${Math.floor(mins / 60)}h ${mins % 60}m left today.${s.freezes ? ' A freeze would cover it, but save it for a real off day.' : ' One quick rep keeps it alive.'}</p></div></div>
        <button class="btn gold block" data-action="open-rep" data-type="hook">Do a 1-minute rep</button></div>` : ''}
      ${voicePanel()}
      ${todayCard(brief, tp)}
      <div class="chat scroll" id="chat" role="log" aria-label="Chat with ${esc(K.NAME)}"><div class="msg coach brief"><b>${esc(brief.coach)} · daily brief</b><br>${esc(brief.message)}</div>${state.chat.map(chatMsg).join('')}${ui.thinking ? '<div class="msg coach thinking" id="thinking" role="status">Thinking…</div>' : ''}</div>
      <div class="quick" aria-label="Quick questions">${QUICK.map(q => `<button type="button" data-action="quick" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
      <div class="card tight composer-card">
        <textarea rows="3" maxlength="${SC.max_input_chars}" autocomplete="off" enterkeyhint="send" data-bind="chatText" data-enter="chat" aria-label="Message to ${esc(K.NAME)}" placeholder="Tell ${esc(K.NAME)} an idea, ask anything, or say what you are stuck on">${esc(draft('chatText'))}</textarea>
        <button class="btn block" data-action="chat">Send</button>
      </div>
      <h2>Your week</h2>
      ${levelCard()}
      ${weekStrip()}
      <div class="card tight">
        <div class="row between"><h3>${esc(lg.division)} league</h3>${zone}</div>
        <div class="row between"><p><span class="num" style="font-size:22px;font-weight:700">#${lg.rank}</span> <span class="muted">of ${lg.size} · ${E.weeklyXP(state, now())} XP this week</span></p></div>
        <p class="small muted">${esc(zoneLine)}</p>
        <p class="small muted">Practice league, simulated cohort.</p>
      </div>
      <div class="card tight"><div class="row between"><h3>Next in your pipeline</h3><button class="linkbtn" data-action="tab" data-tab="ideas">All ideas</button></div>
        ${idea ? `<p class="idea-text">${esc(idea.text)}</p>${track(idea)}<p class="small muted">Stage: ${STAGE_LABEL[idea.stage]}</p>${ideaNextAction(idea)}`
        : `<p class="muted">No open ideas. Save today's prompt or add your own.</p><button class="btn soft block" data-action="tab" data-tab="ideas">Add an idea</button>`}
      </div>
      <div class="card tight" id="board-card"><div class="row between"><h3>Blackboard</h3><button class="btn soft sm" data-action="board-open">Open</button></div>
        <p class="small muted">A notepad and sticky cards for your thinking. A note of ${cfg.xp.board.min_words}+ words that you write yourself earns +${cfg.xp.board.base} XP.</p></div>
      <div class="card tight"><div class="row between"><h3>Weekly posting goal</h3><span class="num">${posted}/${goal}</span></div>
        <div class="bar gold"><i style="width:${Math.min(100, Math.round(posted / goal * 100))}%"></i></div>
        ${nudge ? `<p class="small" id="post-nudge"><b>${esc(K.NAME)}:</b> ${esc(nudge)}</p>` : ''}
        <p class="small muted">${posted >= goal ? 'Goal hit this week. ' : ''}Self-reported, so posts you log here earn no XP. Verified posting XP arrives when you connect Instagram or YouTube.</p>
        <button class="btn soft sm" data-action="log-post-open">Log a post</button></div>
      ${due ? `<div class="card tight" id="views-prompt"><h3>Your ${esc(due.format || 'post')} from ${esc(postDayLabel(due.date))}: how many views?</h3>
        <div class="row"><input type="text" inputmode="numeric" autocomplete="off" maxlength="12" data-bind="nudgeViews" data-enter="prompt-views-save" data-id="${due.id}" value="${esc(draft('nudgeViews'))}" placeholder="e.g. 1840" aria-label="Views">
          <button class="btn sm" data-action="prompt-views-save" data-id="${due.id}">Save</button></div>
        <p class="small muted">Just for your own insights. It earns no XP.</p></div>` : ''}
    </section>`;
  }

  function track(idea) {
    const idx = STAGES.indexOf(idea.stage);
    return `<div class="track" aria-label="Stage ${idx + 1} of 5: ${STAGE_LABEL[idea.stage]}">${STAGES.map((s, i) => `<i class="${i <= idx ? 'on' : ''}"></i>`).join('')}</div>`;
  }

  // ---------- ideas ----------

  const SR = (() => { try { return window.SpeechRecognition || window.webkitSpeechRecognition || null; } catch (e) { return null; } })();

  function ideasView() {
    const counts = {};
    STAGES.forEach(s => { counts[s] = 0; });
    state.ideas.forEach(i => { counts[i.stage]++; });
    const list = state.ideas.filter(i => ui.filter === 'all' || i.stage === ui.filter);
    return `<section class="screen">${topbar()}
      <h1>Ideas</h1>
      <p class="muted small">Every video moves idea → hook → script → filmed → posted.</p>
      <div class="card">
        <label class="field"><span>New idea</span><textarea rows="2" maxlength="280" data-bind="ideaText" data-enter="add-idea" placeholder="${esc(niche().prompts[1])}">${esc(draft('ideaText'))}</textarea></label>
        <div class="row">
          <button class="btn grow" data-action="add-idea">Save idea · ${xpRange('idea')}</button>
          ${SR ? `<button class="btn ghost" type="button" data-action="voice" data-target="ideaText" aria-label="Add by voice" aria-pressed="${ui.listening}">${ui.listening ? '● Listening' : '🎙️'}</button>` : ''}
        </div>
      </div>
      <div class="stages" role="group" aria-label="Filter by stage">
        <button class="stage-tab" data-action="filter" data-f="all" aria-pressed="${ui.filter === 'all'}">All ${state.ideas.length}</button>
        ${STAGES.map(s => `<button class="stage-tab" data-action="filter" data-f="${s}" aria-pressed="${ui.filter === s}">${STAGE_LABEL[s]} ${counts[s]}</button>`).join('')}
      </div>
      ${list.length ? list.map(ideaCard).join('') : `<div class="card"><p class="muted">${state.ideas.length ? 'No ideas at this stage.' : 'Your idea bank is empty. Add one above, or save today\'s prompt from Home.'}</p></div>`}
    </section>`;
  }

  function ideaCard(i) {
    const idx = STAGES.indexOf(i.stage);
    const acts = [];
    if (idx <= 1) acts.push(`<button class="btn ${idx === 0 ? '' : 'soft'} sm" data-action="idea-rep" data-type="hook" data-id="${i.id}">Write hook</button>`);
    if (idx <= 2) acts.push(`<button class="btn ${idx === 1 ? '' : 'soft'} sm" data-action="idea-rep" data-type="script" data-id="${i.id}">Write script</button>`);
    if (idx < 3) acts.push(`<button class="btn ${idx === 2 ? '' : 'soft'} sm" data-action="idea-stage" data-stage="filmed" data-id="${i.id}">Mark filmed</button>`);
    if (idx < 4) acts.push(`<button class="btn ${idx === 3 ? '' : 'soft'} sm" data-action="idea-stage" data-stage="posted" data-id="${i.id}">Mark posted</button>`);
    const confirming = ui.ideaConfirm === i.id;
    return `<article class="card tight" data-idea="${i.id}">
      <div class="row between"><span class="pill brand">${STAGE_LABEL[i.stage]}</span><span class="pill ${scoreTone(i.score)}" aria-label="Idea score ${i.score} out of 10">${i.score}/10</span></div>
      <p class="idea-text">${esc(i.text)}</p>
      ${track(i)}
      ${i.hook ? `<p class="small"><span class="muted">Hook:</span> ${esc(i.hook)}</p>` : ''}
      ${i.stage === 'posted' ? `<p class="small muted">Self-reported. Verified posting XP (+${cfg.xp.post.base}) arrives when you connect Instagram or YouTube in Phase 2.</p>`
        : `<p class="small muted">${i.duplicate ? 'Similar to another idea, so no XP. ' : ''}${esc(i.feedback ? i.feedback.fix : '')}</p>`}
      ${acts.length ? `<div class="row wrap">${acts.join('')}</div>` : ''}
      <details><summary class="small muted">History</summary>
        <div class="list">${i.history.map(h => `<div class="li small"><span class="grow">${STAGE_LABEL[h.stage]}</span><span class="muted">${esc(fmtDate(h.at))}</span></div>`).join('')}</div>
        ${confirming ? `<div class="row wrap"><span class="small grow">Remove this idea? Any XP it earned is reversed.</span><button class="btn danger sm" data-action="idea-remove-yes" data-id="${i.id}">Remove</button><button class="btn ghost sm" data-action="idea-remove-no">Cancel</button></div>`
          : `<button class="linkbtn small" style="color:var(--bad)" data-action="idea-remove" data-id="${i.id}">Remove idea</button>`}
      </details>
    </article>`;
  }

  // Voice typing into the Ideas draft. Home uses the hands-free voice session below instead.
  function startVoice(target) {
    target = target || 'ideaText';
    const unavailable = () => {
      ui.listening = false;
      render();
      toast('Voice input is not available here. Type your idea instead.');
    };
    if (!SR) { unavailable(); return; }
    let rec;
    try {
      rec = new SR();
      rec.lang = APP.speech_lang;
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      rec.onresult = ev => {
        const text = ev.results && ev.results[0] && ev.results[0][0] ? ev.results[0][0].transcript : '';
        ui.draft[target] = (draft(target) ? draft(target) + ' ' : '') + text;
        if (target === 'ideaText') ui.voiceUsed = true;
        const box = document.querySelector(`[data-bind="${target}"]`);
        if (box) box.value = ui.draft[target];
      };
      rec.onerror = unavailable;
      rec.onend = () => { ui.listening = false; render(); };
      rec.start();
      ui.listening = true;
      render();
    } catch (e) {
      unavailable();
    }
  }

  // ---------- voice session (Home) ----------
  // idle -> listening -> thinking -> speaking -> listening ... until stop, a stop phrase, the idle
  // timeout or the turn limit. The mic is closed while the app speaks so it never hears itself.

  const SYNTH = (() => { try { return window.speechSynthesis && typeof window.SpeechSynthesisUtterance === 'function' ? window.speechSynthesis : null; } catch (e) { return null; } })();
  const VSTATE = { idle: 'Tap the mic and talk', listening: 'Listening…', thinking: 'Thinking…', speaking: 'Speaking…' };
  const MIC_ERR = {
    'not-allowed': 'Microphone access is blocked. Allow it in your browser settings, or type below.',
    'service-not-allowed': 'Microphone access is blocked. Allow it in your browser settings, or type below.',
    'audio-capture': 'No microphone was found. Type below instead.',
    network: 'Voice needs an internet connection. Type below instead.',
    'language-not-supported': 'Voice is not available in this language here. Type below instead.'
  };
  const vs = { active: false, gen: 0, rec: null, idle: null, restart: null, turns: 0, utter: null };

  function voicePanel() {
    const st = ui.voice, on = st !== 'idle';
    return `<div class="card tight voice-panel" id="voice-panel" data-state="${st}">
        <div class="mic-stage"><span class="pulse" aria-hidden="true"></span>
          <button class="mic-btn" id="mic-btn" type="button" data-action="mic" aria-pressed="${on}" aria-label="${on ? (st === 'speaking' ? 'Interrupt and talk' : 'Voice session on') : 'Talk to ' + esc(K.NAME)}"><span aria-hidden="true">🎙️</span></button></div>
        <div class="voice-side">
          <p class="voice-status" id="voice-status" role="status" aria-live="polite">${VSTATE[st]}</p>
          <p class="voice-heard small" id="voice-heard" aria-live="off">${esc(ui.heard)}</p>
          ${ui.micHint ? `<p class="small muted" id="mic-hint" role="status">${esc(ui.micMsg || MIC_HINT)}</p>` : ''}
          <div class="row wrap">
            <button class="btn ghost sm" id="voice-stop" type="button" data-action="voice-stop" ${on ? '' : 'disabled'}>■ Stop</button>
            ${SYNTH ? `<button class="btn soft sm" id="voice-replies" type="button" data-action="voice-replies" aria-pressed="${state.voice.replies}">${state.voice.replies ? '🔊 Replies on' : '🔇 Replies off'}</button>` : ''}
          </div>
        </div>
      </div>`;
  }

  function setVState(st) {
    ui.voice = st;
    render();
  }

  function voiceHint(msg) {
    ui.micHint = true; ui.micMsg = msg || MIC_HINT;
    endSession();
    render();
    focusChat();
  }

  function clearVoiceTimers() {
    clearTimeout(vs.idle); clearTimeout(vs.restart);
    vs.idle = vs.restart = null;
  }

  function killRec() {
    const rec = vs.rec;
    vs.rec = null;
    if (!rec) return;
    rec.onresult = rec.onerror = rec.onend = null;
    try { rec.abort ? rec.abort() : rec.stop(); } catch (e) { /* ignore */ }
  }

  function cancelSpeech() {
    vs.utter = null;
    try { if (SYNTH) SYNTH.cancel(); } catch (e) { /* ignore */ }
  }

  function endSession(msg) {
    const was = ui.voice !== 'idle' || vs.active;
    vs.active = false; vs.gen++; vs.turns = 0;
    clearVoiceTimers(); killRec(); cancelSpeech();
    ui.voice = 'idle'; ui.heard = '';
    if (was) render();
    if (msg) toast(msg);
  }

  function micTap() {
    if (!SR) { voiceHint(MIC_HINT); return; }
    ui.micHint = false;
    if (vs.active && ui.voice === 'speaking') { cancelSpeech(); vs.gen++; listen(); return; } // barge-in
    if (vs.active) return;
    cancelSpeech();
    vs.active = true; vs.turns = 0;
    listen();
  }

  // fresh: a new listening turn (arms the idle deadline). A silent restart keeps the running deadline.
  function listen(fresh = true) {
    if (!vs.active) return;
    const gen = ++vs.gen, VC = APP.voice;
    killRec(); clearTimeout(vs.restart); vs.restart = null;
    if (fresh) clearTimeout(vs.idle);
    let rec;
    try {
      rec = new SR();
      rec.lang = APP.speech_lang;
      rec.interimResults = true;
      rec.continuous = false;
      rec.maxAlternatives = 1;
    } catch (e) { voiceHint(MIC_HINT); return; }
    vs.rec = rec;
    let heard = '', done = false;
    const finish = text => { if (done) return; done = true; killRec(); clearTimeout(vs.idle); handleHeard(text, gen); };
    rec.onresult = ev => {
      if (gen !== vs.gen || !ev.results) return;
      clearTimeout(vs.idle); // someone is talking
      let text = '', final = false;
      for (let i = 0; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r && r[0]) text += (text ? ' ' : '') + r[0].transcript;
        if (r && r.isFinal) final = true;
      }
      heard = text.trim();
      ui.heard = heard;
      const box = document.getElementById('voice-heard');
      if (box) box.textContent = heard;
      if (final) finish(heard);
    };
    rec.onerror = ev => {
      if (gen !== vs.gen) return;
      const code = ev && ev.error;
      if (code === 'no-speech' || code === 'aborted') return; // onend follows; the idle timer decides
      done = true;
      voiceHint(MIC_ERR[code] || MIC_HINT);
    };
    rec.onend = () => {
      if (gen !== vs.gen || done) return;
      if (heard) { finish(heard); return; } // silence ended it after some words
      vs.rec = null;
      vs.restart = setTimeout(() => { if (gen === vs.gen) listen(false); }, VC.restart_ms); // nothing heard: listen again
    };
    try { rec.start(); } catch (e) { voiceHint(MIC_HINT); return; }
    if (fresh) vs.idle = setTimeout(() => { if (vs.active) endSession('Voice mode ended: I did not hear anything.'); }, VC.idle_timeout_ms);
    ui.heard = '';
    setVState('listening');
  }

  function handleHeard(text, gen) {
    if (gen !== vs.gen || !vs.active) return;
    const d = V.decide(text, { turns: vs.turns }, APP.voice);
    if (d.action === 'ignore') { listen(); return; }
    if (d.action === 'stop') { endSession(d.reason === 'max-turns' ? 'Voice mode ended: turn limit reached.' : 'Voice mode stopped.'); return; }
    vs.turns++;
    ui.heard = '';
    const g = ++vs.gen;
    ui.voice = 'thinking';
    sendChat(text, { voice: true }).then(res => {
      if (g !== vs.gen || !vs.active) return;
      if (!res || res.rep) { endSession(); return; }
      return speakReply(res.msg);
    }).then(() => {
      if (g !== vs.gen || !vs.active) return; // stopped, or the user barged in and already re-listened
      if (vs.turns >= APP.voice.max_turns) { endSession('Voice mode ended: turn limit reached.'); return; }
      listen();
    });
    render();
  }

  // Resolves when the reply has been spoken (or at once when voice replies are off or unsupported).
  function speakReply(msg) {
    return new Promise(resolve => {
      const text = state.voice.replies && SYNTH && msg ? V.speakable(msg, { maxChars: APP.voice.spoken_max_chars }) : '';
      if (!text) { resolve(); return; }
      const hi = V.langOf(msg, state.profile && state.profile.language) === 'hi';
      let u;
      try { u = new window.SpeechSynthesisUtterance(text); } catch (e) { resolve(); return; }
      const voice = V.pickVoice(SYNTH.getVoices ? SYNTH.getVoices() : [], hi ? 'hi-IN' : 'en-IN') || (hi ? V.pickVoice(SYNTH.getVoices(), 'en-IN') : null);
      u.lang = hi ? 'hi-IN' : APP.speech_lang;
      if (voice) { u.voice = voice; u.lang = voice.lang || u.lang; }
      u.rate = APP.voice.speech_rate;
      let timer = null, over = false;
      const end = () => { if (over) return; over = true; clearTimeout(timer); if (vs.utter === u) vs.utter = null; resolve(); };
      u.onend = u.onerror = end;
      timer = setTimeout(() => { try { SYNTH.cancel(); } catch (e) { /* ignore */ } end(); }, APP.voice.speak_timeout_ms);
      vs.utter = u;
      setVState('speaking');
      try { SYNTH.cancel(); SYNTH.speak(u); } catch (e) { end(); }
    });
  }

  function setVoiceReplies(on) {
    state.voice.replies = !!on;
    if (!on) cancelSpeech();
    save(); render();
  }

  // ---------- practice ----------

  function practiceView() {
    const today = E.localDay(now());
    const used = E.practiceXPOn(state, cfg, today);
    const cap = cfg.daily_practice_cap;
    const recent = state.reps.slice(-5).reverse();
    const REPNAME = { hook: 'Hook', rewrite: 'Rewrite', script: 'Script' };
    return `<section class="screen">${topbar()}
      <h1>Practice</h1>
      <div class="card tight"><div class="row between"><h3>Today's practice XP</h3><span class="num small">${used} / ${cap}</span></div>
        <div class="bar"><i style="width:${Math.min(100, Math.round(used / cap * 100))}%"></i></div>
        <p class="small muted">${used >= cap ? 'Cap reached. Reps still train your skills and keep your streak.' : 'Practice XP is capped each day so quality beats volume.'}</p></div>
      <div class="reps">
        <button class="rep" data-action="open-rep" data-type="hook"><span class="em" aria-hidden="true">🪝</span><b>Write hooks</b><small>One to three opening lines for your next video.</small><span class="pill brand xp">${xpRange('hook')} each</span></button>
        <button class="rep" data-action="open-rep" data-type="rewrite"><span class="em" aria-hidden="true">🔁</span><b>Rewrite a weak hook</b><small>Turn a boring opener into a scroll-stopper.</small><span class="pill brand xp">${xpRange('rewrite')}</span></button>
        <button class="rep" data-action="open-rep" data-type="script"><span class="em" aria-hidden="true">📝</span><b>30-second script</b><small>Hook, payoff and a clear ask in about 75 words.</small><span class="pill brand xp">${xpRange('script')}</span></button>
        <button class="rep" data-action="lessons"><span class="em" aria-hidden="true">🎓</span><b>Lessons</b><small>${state.lessonsDone.length} of ${C.LESSONS.length} done. Two-minute reads with a quiz.</small><span class="pill brand xp">${xpRange('lesson')} each</span></button>
        <div class="rep locked" aria-disabled="true"><span class="em" aria-hidden="true">🎥</span><b>Practice clip</b><small>Record 7 to 15 seconds on camera and get notes.</small><span class="pill xp">🔒 Phase 3</span></div>
        <div class="rep locked" aria-disabled="true"><span class="em" aria-hidden="true">🔍</span><b>Video review</b><small>Upload your edit for a pre-post check.</small><span class="pill xp">🔒 Phase 3</span></div>
      </div>
      ${recent.length ? `<div class="card tight"><h3>Recent reps</h3><div class="list">${recent.map(r => `<div class="li"><span class="pill">${REPNAME[r.type] || r.type}</span><span class="grow small">${esc(r.content.length > 70 ? r.content.slice(0, 70) + '…' : r.content)}</span><span class="pill ${scoreTone(r.feedback.score)}">${r.feedback.score}/10</span></div>`).join('')}</div></div>` : ''}
    </section>`;
  }

  function subView() {
    const v = ui.view;
    if (v.kind === 'rep') return repView(v);
    if (v.kind === 'feedback') return feedbackView(v);
    if (v.kind === 'log-post') return logPostView(v);
    if (v.kind === 'board') return boardView();
    if (v.kind === 'lessons') return lessonsView();
    if (v.kind === 'lesson') return lessonView(v);
    ui.view = null;
    return homeView();
  }

  // ---------- blackboard ----------

  function boardView() {
    const b = state.board;
    const words = wordCount(b.text);
    const R_ = cfg.xp.board;
    const recent = b.saves.slice(0, 3);
    return `<section class="screen">${backBar('Blackboard')}
      <h1>Blackboard</h1>
      <p class="muted small">Think out loud. Your own note of ${R_.min_words}+ words earns +${R_.base} XP when you save it (up to ${R_.max_per_day} a day). Sticky cards and anything the studio writes earn nothing.</p>
      <div class="card">
        <label class="field"><span>Notepad</span><textarea rows="6" id="board-text" maxlength="4000" data-bind="boardText" placeholder="Jot ideas, rough scripts, things to film…">${esc(b.text)}</textarea></label>
        <div class="row"><span class="small muted grow" id="board-words">${plural(words, 'word')}</span><button class="btn" data-action="board-save">Save note</button></div>
        ${recent.length ? `<div class="list">${recent.map(x => `<div class="li small"><span class="grow">${esc(x.text.slice(0, 60))}${x.text.length > 60 ? '…' : ''}</span><span class="muted num">${x.xp ? '+' + x.xp + ' XP' : 'no XP'}</span></div>`).join('')}</div>` : ''}
      </div>
      <div class="row between"><h2>Sticky cards</h2><button class="btn soft sm" data-action="board-add">+ Add card</button></div>
      ${b.cards.length ? `<div class="stickies" id="stickies">${b.cards.map((c, i) => `<div class="sticky c${i % 4}" data-card="${c.id}">
          <textarea rows="3" maxlength="400" data-card-text="${c.id}" aria-label="Sticky card ${i + 1}" placeholder="Write on the card">${esc(c.text)}</textarea>
          <div class="row"><button class="btn ghost sm" data-action="board-move" data-id="${c.id}" data-dir="-1" aria-label="Move earlier" ${i === 0 ? 'disabled' : ''}>←</button><button class="btn ghost sm" data-action="board-move" data-id="${c.id}" data-dir="1" aria-label="Move later" ${i === b.cards.length - 1 ? 'disabled' : ''}>→</button><span class="grow"></span><button class="btn danger sm" data-action="board-del" data-id="${c.id}">Delete</button></div></div>`).join('')}</div>`
        : '<div class="card"><p class="muted small">No cards yet. Tap Add card for one thought per card.</p></div>'}
    </section>`;
  }

  function boardSave() {
    const b = state.board;
    const text = String(b.text || '').trim();
    if (!text) { toast('Write a note first'); return; }
    const before = snapshot();
    const id = E.uid('note');
    const entry = E.award(state, cfg, { source: 'board', sourceId: id, score: G.looksLikeJunk(text) ? 1 : 10, words: wordCount(text), duplicate: E.isDuplicateIdea(text, b.saves, cfg), now: now() });
    b.saves.unshift({ id, text, at: iso(now()), xp: entry.amount });
    save();
    celebrate(before);
    render();
    const n = entry.notes;
    if (n.includes('too_short')) toast(`Saved. Notes under ${cfg.xp.board.min_words} words earn no XP`);
    else if (n.includes('duplicate')) toast('Saved, but it is very close to an earlier note, so 0 XP');
    else if (n.includes('low_quality')) toast('Saved. Write a real thought to earn XP');
    else if (n.includes('daily_limit')) toast('Saved. Daily note XP limit reached');
    else if (n.includes('daily_cap') && !entry.amount) toast('Saved. Daily practice XP cap reached');
    else { toast('Note saved'); burst(entry.amount); }
  }

  function backBar(title) {
    return `<div class="topbar"><button class="btn ghost sm" data-action="back">← Back</button><span class="label">${esc(title || '')}</span><span style="width:60px"></span></div>`;
  }

  function logPostView(v) {
    const idea = v.ideaId && state.ideas.find(i => i.id === v.ideaId);
    const fmt = draft('postFormat'), plat = draft('postPlatform');
    return `<section class="screen">${backBar('Log a post')}
      <h1>${idea ? 'Mark posted' : 'Log a post'}</h1>
      ${idea ? `<div class="card marigold tight"><span class="label">Your idea</span><p class="idea-text">${esc(idea.text)}</p></div>` : ''}
      <p class="small muted">Self-reported. Logging a post earns no XP and does not change your tier. It counts toward your weekly goal and your own insights.</p>
      <span class="label">Where did you post it?</span>
      <div class="options">${cfg.posts.platforms.map(id => `<button class="opt" data-action="post-platform-pick" data-val="${id}" aria-pressed="${plat === id}"><b>${esc(platformName(id))}</b></button>`).join('')}</div>
      <label class="field"><span>Date posted</span><input type="date" data-bind="postDate" max="${E.localDay(now())}" min="2000-01-01" value="${esc(draft('postDate'))}"></label>
      <span class="label">Format (optional)</span>
      <div class="row wrap" role="group" aria-label="Format">${cfg.posts.formats.map(f => `<button class="stage-tab" data-action="post-format" data-val="${esc(f)}" aria-pressed="${fmt === f}">${esc(f)}</button>`).join('')}</div>
      <label class="field"><span>Views so far (optional)</span><input type="text" inputmode="numeric" autocomplete="off" maxlength="12" data-bind="postViews" value="${esc(draft('postViews'))}" placeholder="e.g. 1840"></label>
      <label class="field"><span>Note (optional)</span><textarea rows="2" maxlength="${cfg.posts.note_max}" data-bind="postNote" placeholder="What was the post about?">${esc(draft('postNote'))}</textarea></label>
      ${errLine()}
      <button class="btn block" data-action="post-save">Save post</button>
    </section>`;
  }

  function openLogPost(ideaId) {
    ['postPlatform', 'postFormat', 'postViews', 'postNote'].forEach(k => { delete ui.draft[k]; });
    ui.draft.postDate = E.localDay(now());
    go({ view: { kind: 'log-post', ideaId: ideaId || null } });
  }

  function weakHookFor(seed) {
    const list = niche().weak;
    return list[seed % list.length];
  }

  function repView(v) {
    const n = niche();
    const idea = v.ideaId && state.ideas.find(i => i.id === v.ideaId);
    const context = idea ? `<div class="card marigold tight"><span class="label">Your idea</span><p class="idea-text">${esc(idea.text)}</p>${v.type === 'script' && idea.hook ? `<p class="small">Your hook: ${esc(idea.hook)}</p>` : ''}</div>`
      : v.prompt ? `<div class="card marigold tight"><span class="label">Today's prompt</span><p class="idea-text">${esc(v.prompt)}</p></div>` : '';
    let body = '';
    if (v.type === 'hook') {
      body = `<h1>Write hooks</h1>${context}
        <div class="coach-line"><div class="avatar" aria-hidden="true">${K.NAME[0]}</div><p class="small">Lead with the surprise, keep it 6 to 15 words, add one real detail. Example: <b>"${esc(n.strong[1])}"</b></p></div>
        ${hookInputs(n)}`;
    } else if (v.type === 'rewrite') {
      body = `<h1>Rewrite a weak hook</h1>
        <div class="card tight"><span class="label">Weak hook</span><p class="quote">"${esc(v.weak)}"</p><p class="small muted">Make it specific, open a loop, and talk to the viewer.</p></div>
        <label class="field"><span>Your rewrite</span><input type="text" maxlength="160" data-bind="rewrite" value="${esc(draft('rewrite'))}" placeholder="Your sharper version"></label>`;
    } else {
      const wc = wordCount(draft('script'));
      body = `<h1>30-second script</h1>${context}
        <p class="small muted">Open with a hook, deliver one payoff, end with a specific ask. Aim for 55 to 95 words.</p>
        <label class="field"><span>Script</span><textarea rows="8" maxlength="1500" data-bind="script" placeholder="${esc(n.strong[0])}. …">${esc(draft('script'))}</textarea></label>
        <p class="small muted num" id="wc" aria-live="polite">${wcText(wc)}</p>`;
    }
    return `<section class="screen">${backBar(v.type === 'script' ? 'Script rep' : 'Hook rep')}
      ${body}${errLine()}
      <button class="btn block" data-action="submit-rep">Get feedback</button>
    </section>`;
  }

  function wcText(wc) { return `${wc} words · about ${Math.round(wc / WPS)} seconds spoken`; }

  const CRIT_LABEL = { curiosity: 'Curiosity', specificity: 'Specificity', brevity: 'Brevity', viewer_focus: 'Viewer focus', hook: 'Hook', payoff: 'Payoff', cta: 'Call to action', pacing: 'Pacing' };

  function feedbackCards(r) {
    const p = profile();
    const reaction = K.react(p, { score: r.score, fix: r.fix }, { notes: r.notes });
    return `<div class="card"><div class="score">
        <div class="ring" style="--p:${r.score * 10};--ring:${ringColor(r.score)}" role="img" aria-label="Score ${r.score} out of 10"><span>${r.score}<small>/10</small></span></div>
        <div class="grow stack" style="gap:6px"><span class="label">${r.items && r.items.length > 1 ? 'Average of ' + r.items.length + ' hooks' : r.type === 'script' ? 'Script score' : 'Hook score'}</span>
          <div class="coach-line"><div class="avatar" aria-hidden="true">${K.NAME[0]}</div><p class="small">${esc(reaction)}</p></div></div>
      </div>
      ${r.items && r.items.length > 1 ? `<div class="list">${r.items.map(it => `<div class="li small"><span class="grow">${esc(it.text)}</span><span class="pill ${scoreTone(it.score)}">${it.score}/10</span><span class="num muted">+${it.xp}</span></div>`).join('')}</div>` : ''}
      ${r.type === 'script' && r.wordCount != null ? `<p class="small muted num">${wcText(r.wordCount)}</p>` : ''}
    </div>
    <div class="card"><span class="label">${r.items && r.items.length > 1 ? 'Breakdown of your best hook' : 'Breakdown'}</span>
      ${Object.entries(r.breakdown).map(([k, val]) => `<div class="crit"><span>${CRIT_LABEL[k] || k}</span><div class="bar"><i style="width:${val * 10}%"></i></div><span class="num">${val}</span></div>`).join('')}
    </div>
    <div class="card">
      <div class="fb-block"><span class="ic good" aria-hidden="true">✓</span><div><span class="label">Strength</span><p>${esc(r.strength)}</p></div></div>
      <div class="fb-block"><span class="ic fix" aria-hidden="true">!</span><div><span class="label">One fix</span><p>${esc(r.fix)}</p></div></div>
      <div class="fb-block"><span class="ic ex" aria-hidden="true">★</span><div><span class="label">Improved example</span><p class="quote">"${esc(r.example)}"</p></div></div>
    </div>
    <div class="card tight"><div class="row between"><h3>XP earned</h3><span class="num" style="font-size:22px;font-weight:700;color:var(--warn)">+${r.xp}</span></div>
      ${r.notes.length ? `<ul class="small muted" style="margin:0;padding-left:18px">${r.notes.map(n => `<li>${esc(noteText(n, r.type))}</li>`).join('')}</ul>` : `<p class="small muted">Base XP for the rep.</p>`}
    </div>`;
  }

  function feedbackView(v) {
    return `<section class="screen">${backBar('Feedback')}
      ${feedbackCards(v.result)}
      <div class="stack">
        <button class="btn block" data-action="rep-retry">Try again</button>
        <button class="btn soft block" data-action="rep-another">Another rep</button>
        <button class="btn ghost block" data-action="tab" data-tab="home">Home</button>
      </div></section>`;
  }

  // Grade the current rep, award XP, update the linked idea and show feedback.
  function submitRep() {
    const v = ui.view;
    const t = now();
    const opts = { grade: gradeOpts(), ideaId: v.ideaId, prompt: v.prompt };
    const before = snapshot();
    let result;
    if (v.type === 'hook') {
      const list = [0, 1, 2].map(i => String(draft('hook' + i)).trim()).filter(Boolean);
      if (!list.length) { ui.err = 'Write at least one hook.'; render(); return; }
      result = gradeHookSet(list, opts, t);
    } else if (v.type === 'rewrite') {
      const text = String(draft('rewrite')).trim();
      if (!text) { ui.err = 'Write your rewrite first.'; render(); return; }
      const { entry, fb } = doRep(state, 'rewrite', text, opts, t);
      result = Object.assign({ type: 'rewrite', content: [text], xp: entry.amount, notes: entry.notes.slice() }, pickFb(fb));
    } else {
      const text = String(draft('script')).trim();
      const minWords = cfg.xp.script.min_words;
      if (wordCount(text) < minWords) { ui.err = `Write at least ${minWords} words so there is a script to grade.`; render(); return; }
      const { entry, fb } = doRep(state, 'script', text, opts, t);
      result = Object.assign({ type: 'script', content: [text], xp: entry.amount, notes: entry.notes.slice(), wordCount: fb.wordCount }, pickFb(fb));
    }
    const idea = v.ideaId && state.ideas.find(i => i.id === v.ideaId);
    if (idea) {
      if (v.type === 'hook') { idea.hook = result.best; moveStage(idea, 'hook', t); }
      if (v.type === 'script') { idea.script = result.content[0]; moveStage(idea, 'script', t); }
    }
    save();
    celebrate(before);
    go({ view: { kind: 'feedback', result, from: v } });
    burst(result.xp);
  }

  function pickFb(fb) { return { score: fb.score, breakdown: fb.breakdown, strength: fb.strength, fix: fb.fix, example: fb.example }; }

  function gradeHookSet(list, opts, t) {
    const g = G.gradeHooks(list, opts.grade);
    const items = list.map(text => {
      const { entry, fb } = doRep(state, 'hook', text, opts, t);
      return { text, score: fb.score, xp: entry.amount, notes: entry.notes };
    });
    const notes = [...new Set(items.flatMap(i => i.notes))];
    return { type: 'hook', content: list, items, xp: items.reduce((s, i) => s + i.xp, 0), notes, best: g.best.text, score: g.score, breakdown: g.breakdown, strength: g.strength, fix: g.fix, example: g.example };
  }

  function openRep(type, extra) {
    ['hook0', 'hook1', 'hook2', 'rewrite', 'script'].forEach(k => { delete ui.draft[k]; });
    const view = Object.assign({ kind: 'rep', type }, extra || {});
    if (type === 'rewrite' && !view.weak) view.weak = weakHookFor(state.reps.filter(r => r.type === 'rewrite').length);
    go({ view });
  }

  // ---------- lessons ----------

  function lessonsView() {
    return `<section class="screen">${backBar('Lessons')}
      <h1>Lessons</h1><p class="muted small">Short reads with one question. ${xpRange('lesson')} the first time you get each right.</p>
      <div class="list card tight">${C.LESSONS.map((l, i) => {
        const done = state.lessonsDone.includes(l.id);
        return `<button class="li" style="background:none;border-left:0;border-right:0;border-top:0;text-align:left;width:100%" data-action="lesson" data-id="${l.id}">
          <span class="rank">${done ? '✓' : i + 1}</span><span class="grow"><b>${esc(l.title)}</b></span><span class="pill ${done ? 'good' : 'brand'}">${done ? 'Done' : '+' + cfg.xp.lesson.base + ' XP'}</span></button>`;
      }).join('')}</div></section>`;
  }

  function lessonView(v) {
    const l = C.LESSONS.find(x => x.id === v.id);
    if (!l) { ui.view = { kind: 'lessons' }; return lessonsView(); }
    const done = state.lessonsDone.includes(l.id);
    const answered = v.picked != null;
    const right = answered && v.picked === l.answer;
    const next = C.LESSONS[C.LESSONS.indexOf(l) + 1];
    return `<section class="screen">${backBar('Lesson')}
      <h1>${esc(l.title)}</h1>
      <div class="card"><p>${esc(l.body)}</p></div>
      <span class="label">Quick check</span>
      <h3>${esc(l.q)}</h3>
      <div class="options one">${l.options.map((o, i) => `<button class="opt" data-action="answer" data-i="${i}" aria-pressed="${v.picked === i}" ${right ? 'disabled' : ''}><b>${esc(o)}</b>${answered && v.picked === i ? `<small>${right ? 'Correct' : 'Not quite'}</small>` : ''}</button>`).join('')}</div>
      ${answered ? (right ? `<div class="card tight"><p><b>Correct.</b> ${v.earned ? `+${v.earned} XP.` : done && !v.earned ? 'You already earned XP for this lesson.' : ''}</p></div>`
        : `<p class="err" role="alert">Not quite. Read it again and pick the other answer.</p>`) : ''}
      ${right ? `<div class="stack">${next ? `<button class="btn block" data-action="lesson" data-id="${next.id}">Next lesson</button>` : ''}<button class="btn ghost block" data-action="lessons">All lessons</button></div>` : ''}
    </section>`;
  }

  // ---------- chat: coach, studio and the today card (all on Home) ----------

  const QUICK = ["I'm stuck", 'Plan a shoot with friends', 'What should I post today?', 'How do I write a better hook?', "What's working?", 'My views are low', 'When should I post?', 'How do brand deals work?', 'Can I buy followers?'];
  const MIC_HINT = "Voice typing isn't supported here. Tap the keyboard's mic or type.";
  // The AI behind the studio is the built-in mock. Pass { llm } to ST.run to plug in a real model later.
  const STUDIO_LLM = null;

  function studioCtx() {
    const t = now();
    return { cfg, appCfg: APP, profile: state.profile, insights: E.postInsights(state, cfg, t), engagement: E.engagementInsights(state, cfg, t), posts: state.posts, today: E.localDay(t) };
  }

  function gapText(gap) { return gap == null ? '' : gap === 0 ? 'Last post: today' : `Last post: ${plural(gap, 'day')} ago`; }

  function todayCard(brief, tp) {
    const gap = gapText(tp.gapDays);
    return `<div class="card hero" id="today-card" data-basis="${tp.basis}">
        <span class="label">${esc(brief.coach)} · today's pick</span>
        <p class="prompt" id="today-format">Post a ${esc(tp.format)} today</p>
        <p class="small">${esc(platformName(tp.platform))}${gap ? ` · <span id="today-gap">${esc(gap)}</span>` : ''}</p>
        <ul class="reasons small">${tp.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
        <span class="label">Today's prompt</span>
        <p class="prompt">${esc(tp.prompt)}</p>
        <div class="row wrap"><button class="btn onbrand sm" data-action="prompt-hooks">Write hooks for this</button><button class="btn ghost sm" style="color:inherit;border-color:currentColor" data-action="prompt-idea">Save as idea</button></div>
        <p class="small muted">Focus skill: <b>${esc(brief.focusLabel)}</b></p>
      </div>`;
  }

  const LBL = {
    en: { strategist: 'Strategist', instagram: 'Instagram', thread: 'X thread', linkedin: 'LinkedIn post', board: 'Board', critic: 'Critic', angles: 'Angles', questions: 'Questions to answer', shots: 'Shots', slides: 'Slides', caption: 'Caption', verdict: { ship: 'Ship it', tweak: 'Tweak first', rethink: 'Rethink' }, score: 'Hook score', fix: 'Fix', note: 'Written by the studio, so it earns no XP. Only your own idea earns XP when you save it.' },
    hi: { strategist: 'Strategist', instagram: 'Instagram', thread: 'X thread', linkedin: 'LinkedIn post', board: 'Board', critic: 'Critic', angles: 'Angles', questions: 'In sawaalon ka jawab do', shots: 'Shots', slides: 'Slides', caption: 'Caption', verdict: { ship: 'Post karo', tweak: 'Thoda tweak', rethink: 'Dobara socho' }, score: 'Hook score', fix: 'Fix', note: 'Yeh studio ne likha hai, isliye XP nahi. Sirf tumhara apna idea save karne pe XP milta hai.' }
  };

  function studioSet(m, i) {
    const r = m.result, l = LBL[r.lang] || LBL.en, c = r.critic;
    const reel = r.instagram.concepts[0], car = r.instagram.concepts[1];
    const card = (agent, inner) => `<article class="studio-card" data-agent="${agent}"><h4>${esc(l[agent])}</h4>${inner}</article>`;
    const next = r.next.map(n => {
      if (n.action === 'save-idea') return m.savedId ? '<span class="pill good">Saved to Ideas</span>' : `<button class="btn sm" data-action="studio-save" data-i="${i}">${esc(n.label)} · ${xpRange('idea')}</button>`;
      if (n.action === 'idea-rep') return m.savedId ? `<button class="btn soft sm" data-action="idea-rep" data-type="hook" data-id="${m.savedId}">${esc(n.label)}</button>` : '';
      return `<button class="btn soft sm" data-action="open-rep" data-type="hook">${esc(n.label)}</button>`;
    }).join('');
    return `<div class="studio-set" data-lang="${r.lang}">
      ${card('strategist', `<p class="small muted">${l.angles}</p><ul>${r.strategist.angles.map(a => `<li><b>${esc(a.label)}</b>: ${esc(a.why)}</li>`).join('')}</ul><p class="small muted">${l.questions}</p><ul>${r.strategist.questions.map(q => `<li>${esc(q)}</li>`).join('')}</ul>`)}
      ${card('instagram', `<p><b>Reel:</b> ${esc(reel.title)}</p><p class="hook">"${esc(reel.hook)}"</p><ol class="shots">${reel.shots.map(x => `<li>${esc(x.shot)} <span class="muted">(${x.seconds}s${x.onscreen ? ' · text: ' + esc(x.onscreen) : ''})</span></li>`).join('')}</ol><p class="small"><b>${l.caption}:</b> ${esc(reel.caption)}</p>
        <p><b>Carousel:</b> ${esc(car.title)}</p><p class="hook">"${esc(car.hook)}"</p><ol class="shots">${car.slides.map(x => `<li>${esc(x.text)}</li>`).join('')}</ol><p class="small"><b>${l.caption}:</b> ${esc(car.caption)}</p>`)}
      ${card('thread', `<ol class="shots">${r.thread.posts.map(x => `<li>${esc(x)}</li>`).join('')}</ol>`)}
      ${card('linkedin', r.linkedin.posts.map(x => `<p>${esc(x)}</p>`).join(''))}
      ${card('board', `<div class="tiles">${r.board.tiles.map(x => `<div class="tile"><b>${x.n}. ${esc(x.label)}</b><span class="small">${esc(x.visual)}</span>${x.text ? `<span class="small muted">${esc(x.text)}</span>` : ''}</div>`).join('')}</div><button class="btn soft sm" data-action="board-from-studio" data-i="${i}">Open on blackboard</button>`)}
      ${card('critic', `<div class="row wrap"><span class="pill ${c.verdict === 'ship' ? 'good' : c.verdict === 'tweak' ? 'gold' : 'bad'}" data-verdict="${c.verdict}">${esc(l.verdict[c.verdict])}</span><span class="small muted">${l.score}: <span class="num">${c.hook_score}/10</span></span></div>
        ${c.risks.length ? `<ul>${c.risks.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}<p class="small"><b>${l.fix}:</b> ${esc(c.fix)}</p>`)}
      <p class="small muted">${esc(l.note)}</p>
      <div class="row wrap">${next}</div>
    </div>`;
  }

  function planCard(m) {
    const g = m.plan;
    return `<article class="plan-card" data-kind="group"><h4>Shoot plan for ${g.people} people · about ${g.minutes} min</h4><p>${esc(g.concept)}</p>
      <p class="small muted">Roles</p><ul>${g.roles.map(x => `<li><b>${esc(x.who)}: ${esc(x.role)}</b>. ${esc(x.job)}</li>`).join('')}</ul>
      <p class="small muted">Shots</p><ol class="shots">${g.shots.map(x => `<li><b>${esc(x.who)}</b>: ${esc(x.shot)} <span class="muted">(${x.seconds}s)</span></li>`).join('')}</ol>
      <p class="small muted">Before you start</p><ul>${g.checklist.map(x => `<li>${esc(x)}</li>`).join('')}</ul></article>`;
  }

  function stuckCard(m) {
    const u = m.stuck;
    return `<article class="plan-card" data-kind="stuck"><h4>Stuck? Start tiny</h4><ul>${u.prompts.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
      <button class="btn sm" data-action="open-rep" data-type="${u.action.type}">${esc(u.action.label)}</button></article>`;
  }

  function chatMsg(m, i) {
    if (m.kind === 'studio' && m.result) return studioSet(m, i);
    if (m.kind === 'group' && m.plan) return planCard(m);
    if (m.kind === 'stuck' && m.stuck) return stuckCard(m);
    return `<div class="msg ${m.from === 'me' ? 'me' : 'coach'}">${esc(m.text)}</div>`;
  }

  function chatPush(m) {
    state.chat.push(Object.assign({ at: iso(now()) }, m));
    if (state.chat.length > APP.chat_history_max) state.chat = state.chat.slice(-APP.chat_history_max);
  }

  function focusChat() {
    const input = document.querySelector('[data-bind="chatText"]');
    if (input) try { input.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  }

  /* Sends a message through the router. Returns a promise of { msg, rep } (the coach's reply, and
   * whether a rep screen opened) or null when nothing was sent. { voice: true } keeps the keyboard closed. */
  function sendChat(text, opts) {
    text = String(text || '').trim().slice(0, SC.max_input_chars);
    if (!text || ui.thinking) return Promise.resolve(null);
    const quiet = !!(opts && opts.voice);
    const p = state.profile, r = R.route(text, { appCfg: APP }), c = studioCtx();
    chatPush({ from: 'me', text });
    ui.draft.chatText = '';
    // Clear the box itself too, or the change event fired when it is replaced would put the old text back.
    const box = document.querySelector('[data-bind="chatText"]');
    if (box) box.value = '';
    ui.micHint = false;
    ui.chatScroll = true;
    let last = null;
    const reply = m => { chatPush(m); last = state.chat[state.chat.length - 1]; };
    let flash = false, rep = null, pending = null;
    if (r.intent === 'idea') {
      ui.thinking = true;
      pending = ST.run(text, c, { llm: STUDIO_LLM })
        .then(result => reply({ from: 'coach', kind: 'studio', result }))
        .catch(() => reply({ from: 'coach', text: K.chat(p, text, { insights: c.insights, cfg }) }))
        .then(() => { ui.thinking = false; ui.chatScroll = 'start'; save(); render(); return { msg: last, rep: false }; });
    } else if (r.intent === 'group') reply({ from: 'coach', kind: 'group', plan: ST.groupPlan(text, p, c) });
    else if (r.intent === 'stuck') reply({ from: 'coach', kind: 'stuck', stuck: ST.unstick(p, c) });
    else if (r.intent === 'today') {
      const tp = ST.todayPick(p, c);
      reply({ from: 'coach', text: `Pinned at the top: post a ${tp.format} today. ${tp.reasons[0]}` });
      flash = true;
    } else if (r.intent === 'practice') {
      reply({ from: 'coach', text: 'Opening a hook rep. Go.' });
      rep = r.payload.type;
    } else reply({ from: 'coach', text: K.chat(p, text, { insights: c.insights, cfg }) });
    save();
    if (rep) { openRep(rep); return Promise.resolve({ msg: last, rep: true }); }
    render();
    if (!quiet) focusChat();
    if (flash) {
      const card = document.getElementById('today-card');
      if (card) { card.classList.add('flash'); try { card.scrollIntoView({ block: 'center' }); } catch (e) { /* ignore */ } }
    }
    return pending || Promise.resolve({ msg: last, rep: false });
  }

  // ---------- you ----------

  const BADGE_EMOJI = { first_xp: '⚡', streak3: '🔥', streak7: '🔐', streak30: '🏆', ideas10: '💡', first_script: '📝', nine: '🎯', filmed: '🎬', lessons5: '🎓' };
  const REASON = { board: 'Blackboard note', idea: 'Idea captured', hook: 'Hook rep', rewrite: 'Hook rewrite', script: 'Script rep', lesson: 'Lesson', reversal: 'Reversed', post: 'Verified post', reflection: 'Reflection', clip: 'Practice clip', review: 'Video review' };
  const NOTE_SHORT = { daily_limit: 'daily limit', quality_bonus: 'quality bonus', daily_cap: 'daily cap', low_quality: 'below quality bar', duplicate: 'duplicate', too_short: 'too short', no_change: 'no change' };
  const QUESTS = [
    ['Third Wave-style cafe, Koramangala', '₹4,000 · 1 Reel on our filter coffee'],
    ['D2C skincare brand, Pune', '₹6,500 · 2 Reels + 3 stories'],
    ['Handloom store, Jaipur', '₹3,000 · festive lookbook Reel']
  ];

  function youView() {
    const p = state.profile;
    const xp = E.totalXP(state);
    const L = E.levelFor(xp, cfg);
    const s = streak();
    const tr = E.tier(state, cfg);
    const sk = E.skills(state, cfg);
    const bd = E.badges(state, cfg, now());
    const labels = K.SKILL_LABEL[lang()];
    const n = C.NICHES[p.niche] || C.NICHES.other;
    const hist = state.ledger.slice(-20).reverse();
    const gig = tr.reached.gig_ready;
    return `<section class="screen">${topbar()}
      <div class="row"><div class="avatar" style="width:52px;height:52px;font-size:22px;background:var(--brand);color:var(--brand-ink)" aria-hidden="true">${esc((p.name || 'Y')[0].toUpperCase())}</div>
        <div class="grow"><h1>${esc(p.name || 'You')}</h1><p class="muted small">${n.emoji} ${esc(n.label)} creator · <span class="pill brand">${esc(tr.current.name)}</span></p></div></div>
      ${levelCard()}
      <div class="stats">
        <div class="stat"><div class="v num">${xp}</div><div class="k">Total XP</div></div>
        <div class="stat"><div class="v num">${s.current}</div><div class="k">Day streak</div></div>
        <div class="stat"><div class="v num">${s.longest}</div><div class="k">Best streak</div></div>
        <div class="stat"><div class="v num">${state.reps.length}</div><div class="k">Reps</div></div>
        <div class="stat"><div class="v num">${state.ideas.length}</div><div class="k">Ideas</div></div>
        <div class="stat"><div class="v num">${state.reps.length ? E.recentAverageScore(state, 10).toFixed(1) : '–'}</div><div class="k">Avg score</div></div>
      </div>

      <div class="card"><h2>Creator tier</h2><p class="small muted">Tiers come from real results and only go up. Post data arrives when you connect accounts in Phase 2.</p>
        <div class="ladder">${cfg.tiers.map((t, i) => {
          const cls = i <= tr.index ? 'done' : i === tr.index + 1 ? 'next' : '';
          return `<div class="tier ${cls}"><span class="node" aria-hidden="true">${i <= tr.index ? '✓' : '🔒'}</span><div><b>${esc(t.name)}</b>${i === tr.index ? ' <span class="pill brand">You</span>' : ''}<p class="small muted">${esc(t.rule)}</p></div></div>`;
        }).join('')}</div></div>

      <div class="card"><h2>Skills</h2>
        ${sk.map(x => `<div class="skill"><b>${esc(labels[x.name] || x.name)}</b><span class="small muted num">Lv ${x.level}/${cfg.skills.levels}</span>
          <div class="bar" role="progressbar" aria-label="${esc(labels[x.name] || x.name)}" aria-valuemin="0" aria-valuemax="${x.span}" aria-valuenow="${x.maxed ? x.span : x.into}"><i style="width:${x.maxed ? 100 : Math.round(x.into / x.span * 100)}%"></i></div>
          ${['confidence', 'editing'].includes(x.name) && !x.xp ? '<span class="small muted" style="grid-column:1/-1">Trained by practice clips and video reviews (Phase 3)</span>' : ''}</div>`).join('')}
      </div>

      <div class="card"><h2>Badges</h2><div class="badges">${bd.map(b => `<div class="badge ${b.earned ? 'on' : ''}"><span class="em" aria-hidden="true">${BADGE_EMOJI[b.id] || '🏅'}</span><b>${esc(b.name)}</b><small>${esc(b.desc)}</small><span class="sr">${b.earned ? 'Earned' : 'Not earned yet'}</span></div>`).join('')}</div></div>

      <div class="card"><div class="row between"><h2>Brand quests</h2><span class="pill gold">${gig ? 'Unlocked' : '🔒 Gig-ready'}</span></div>
        <p class="small muted">Paid briefs from Indian brands, unlocked at the Gig-ready tier. These are samples of what will appear here.</p>
        ${QUESTS.map(([who, what]) => `<div class="quest" aria-hidden="true"><div class="blur"><b>${esc(who)}</b><p class="small">${esc(what)}</p></div></div>`).join('')}
        <p class="small muted">Reach Gig-ready: ${esc(cfg.tiers[cfg.tiers.length - 1].rule)}.</p>
      </div>

      ${perksCard()}

      ${postsCard()}
      ${insightsCard()}

      <div class="card"><h2>XP history</h2>
        ${hist.length ? `<div class="list">${hist.map(e => `<div class="li small"><div class="grow"><b>${esc(REASON[e.reason] || e.reason)}</b>${e.notes.length ? ` <span class="muted">· ${e.notes.map(n => NOTE_SHORT[n] || n).join(', ')}</span>` : ''}${E.isReversed(state, e.id) ? ' <span class="muted">· reversed</span>' : ''}<div class="muted">${esc(fmtDate(e.created_at))}</div></div><span class="num" style="font-weight:700;color:${e.amount > 0 ? 'var(--good)' : e.amount < 0 ? 'var(--bad)' : 'var(--muted)'}">${e.amount > 0 ? '+' : ''}${e.amount}</span></div>`).join('')}</div>` : '<p class="muted small">No XP yet.</p>'}
      </div>

      ${settingsCard()}
    </section>`;
  }

  function perksCard() {
    const list = E.perks(state, cfg);
    return `<div class="card" id="perks"><div class="row between"><h2>Perks shelf</h2><span class="pill gold">Coming soon</span></div>
      <p class="small muted">Examples of perks you could unlock. There are no real sponsors yet, so nothing here can be claimed.</p>
      ${list.map(x => `<div class="perk ${x.unlocked ? 'on' : ''}" data-perk="${x.id}" data-unlocked="${x.unlocked}"><span aria-hidden="true">${x.unlocked ? '🔓' : '🔒'}</span><div class="grow"><b>${esc(x.name)}</b><p class="small muted">${esc(x.desc)}</p></div><span class="pill ${x.unlocked ? 'good' : ''}">${x.unlocked ? 'Unlocked' : esc(x.unlock)}</span></div>`).join('')}</div>`;
  }

  // Most recent first: by date posted, then by when it was logged.
  function recentPosts(limit) {
    return state.posts.map((p, i) => ({ p, i }))
      .sort((a, b) => b.p.date.localeCompare(a.p.date) || (b.p.loggedOn || '').localeCompare(a.p.loggedOn || '') || b.i - a.i)
      .slice(0, limit).map(x => x.p);
  }

  function postRow(p) {
    const editing = ui.editPost === p.id;
    const title = p.platform
      ? `<b>${esc(platformName(p.platform))}${p.format ? ' · ' + esc(p.format) : ''}</b>`
      : `<b>Add platform</b> <span class="row wrap" style="display:inline-flex;gap:6px">${cfg.posts.platforms.map(id => `<button class="btn soft sm" data-action="post-set-platform" data-id="${p.id}" data-val="${id}">${esc(platformName(id))}</button>`).join('')}</span>`;
    const eng = p.source === 'instagram' && p.likes != null ? `<span class="num">${fmtNum(p.likes)}</span> likes · <span class="num">${fmtNum(p.comments || 0)}</span> comments` : '';
    const views = p.views != null ? `<span class="num">${fmtNum(p.views)}</span> views${eng ? ' · ' + eng : ''}` : eng || 'No views added';
    return `<div class="li small" data-post="${p.id}"><div class="grow stack" style="gap:4px">
        <div>${title} <span class="muted">· ${esc(postDayLabel(p.date))}</span></div>
        <div class="muted">${views}</div>
        ${p.note ? `<div class="muted">${esc(p.note)}</div>` : ''}
        ${editing ? `<div class="row"><input type="text" inputmode="numeric" autocomplete="off" maxlength="12" data-bind="postViewsEdit" data-enter="post-views-save" data-id="${p.id}" value="${esc(draft('postViewsEdit'))}" placeholder="Views" aria-label="Views"><button class="btn sm" data-action="post-views-save" data-id="${p.id}">Save</button><button class="btn ghost sm" data-action="post-views-cancel">Cancel</button></div>` : ''}
      </div>${editing ? '' : `<button class="btn soft sm" data-action="post-views-edit" data-id="${p.id}">${p.views != null ? 'Update' : 'Add'} views</button>`}</div>`;
  }

  function postsCard() {
    const list = recentPosts(10);
    return `<div class="card" id="your-posts"><div class="row between"><h2>Your posts</h2><button class="linkbtn" data-action="log-post-open">Log a post</button></div>
      <p class="small muted">Logged by you or imported from Instagram${state.instagram && state.instagram.demo ? ' (sample data)' : ''}. Posts here earn no XP and do not change your tier.</p>
      ${list.length ? `<div class="list">${list.map(postRow).join('')}</div>` : '<p class="muted small">No posts logged yet. Mark an idea posted, or log one from Home.</p>'}
    </div>`;
  }

  function insightsCard() {
    const ins = E.postInsights(state, cfg, now()), eng = E.engagementInsights(state, cfg, now());
    const name = (platform, format, fallback) => `${platformName(platform)}${format ? ' · ' + format : fallback ? ' · ' + fallback : ''}`;
    return `<div class="card" id="whats-working"><h2>What's working</h2>
      ${ins.groups.length ? `<div class="list">${ins.groups.map(g => `<div class="li small"><span class="grow">${esc(name(g.platform, g.format, 'posts'))}: median <span class="num">${fmtNum(g.median)}</span> views (${plural(g.posts, 'post')})</span></div>`).join('')}</div>`
        : `<p class="muted small">Log at least ${cfg.insights.min_posts_per_format} posts of the same format with their views, from the last ${cfg.insights.window_days} days, and we will show what works for you.</p>`}
      ${ins.best ? `<p class="small"><b>Your best:</b> ${esc(platformName(ins.best.platform))}${ins.best.format ? ' ' + esc(ins.best.format) : ''}, <span class="num">${fmtNum(ins.best.views)}</span> views</p>` : ''}
      ${eng.groups.length || eng.best ? `<span class="label">Imported from Instagram${state.instagram && state.instagram.demo ? ' (sample)' : ''}</span>
        ${eng.groups.length ? `<div class="list">${eng.groups.map(g => `<div class="li small"><span class="grow">${esc(name(g.platform, g.format, 'posts'))}: median <span class="num">${fmtNum(g.median)}</span> likes + comments (${plural(g.posts, 'post')})</span></div>`).join('')}</div>` : ''}
        ${eng.best ? `<p class="small"><b>Most engaged:</b> ${esc(eng.best.format || 'Post')}, <span class="num">${fmtNum(eng.best.score)}</span> likes + comments (counts come from Instagram)</p>` : ''}` : ''}
      <p class="small muted">Self-reported. Compared only with your own posts.</p>
    </div>`;
  }

  function notifStatus() {
    const p = state.profile;
    if (!('Notification' in window)) return 'Not available in this browser.';
    let perm = 'default';
    try { perm = Notification.permission; } catch (e) { /* ignore */ }
    if (perm === 'denied') return 'Blocked in browser settings.';
    if (p.notifications && perm === 'granted') return `On. Reminder at ${p.notifyTime}, while the app is open in this prototype.`;
    return 'Off.';
  }

  function instagramRow() {
    const ig = state.instagram;
    const err = ui.igErr ? `<p class="err" role="alert">${esc(ui.igErr)}</p>` : '';
    if (!ig) {
      return `<div class="stack" id="ig-row"><div class="row between"><div class="grow"><b>Instagram</b><p class="small muted">Import your profile and recent posts. Read-only.${IG_BASE ? '' : ' Demo mode loads a sample creator.'}</p></div>
        <button class="btn soft sm" data-action="ig-connect" ${ui.igBusy ? 'disabled' : ''}>${ui.igBusy ? 'Connecting…' : IG_BASE ? 'Connect Instagram' : 'Connect Instagram (demo)'}</button></div>${err}</div>`;
    }
    return `<div class="stack" id="ig-row"><div class="row between"><div class="grow"><b>Instagram</b> ${ig.demo ? '<span class="pill gold">Sample data</span>' : ''}
        <p class="small muted">@${esc(ig.username)} · <span class="num">${fmtNum(ig.followers_count)}</span> followers</p>
        <p class="small muted">Last synced ${esc(fmtDate(ig.syncedAt))}</p></div>
        <button class="btn soft sm" data-action="ig-refresh" ${ui.igBusy ? 'disabled' : ''}>${ui.igBusy ? 'Syncing…' : 'Refresh'}</button></div>
      ${err}
      ${ui.confirmIg
        ? `<div class="card warn"><h3>Disconnect Instagram?</h3><p class="small">This deletes the imported profile, followers and posts from this device. Posts you logged yourself stay.</p>
            <div class="row"><button class="btn ghost grow" data-action="ig-disconnect-cancel">Cancel</button><button class="btn danger grow" data-action="ig-disconnect-yes">Yes, disconnect</button></div></div>`
        : '<button class="btn ghost sm" data-action="ig-disconnect">Disconnect</button>'}</div>`;
  }

  function settingsCard() {
    const p = state.profile;
    const on = p.notifications;
    const qw = { start: p.quietStart || cfg.notifications.quiet_start, end: p.quietEnd || cfg.notifications.quiet_end };
    const quietNote = E.isQuietAt(cfg, p, E.toMinutes(p.notifyTime))
      ? `<p class="small muted" id="quiet-note">That's inside quiet hours. We'll remind you at ${esc(qw.end)} instead.</p>` : '';
    return `<div class="card" id="settings"><h2>Settings</h2>
      <span class="label">Coach language</span>
      <div class="options">${[['english', 'English'], ['hinglish', 'Hinglish']].map(([id, l]) => `<button class="opt" data-action="set" data-key="language" data-val="${id}" aria-pressed="${p.language === id}"><b>${l}</b></button>`).join('')}</div>
      <span class="label">Niche</span>
      <select data-setting="niche" aria-label="Niche">${Object.entries(C.NICHES).map(([id, n]) => `<option value="${id}" ${p.niche === id ? 'selected' : ''}>${n.emoji} ${esc(n.label)}</option>`).join('')}</select>
      <span class="label">Weekly posting goal</span>
      <div class="stepper"><button data-action="set-goal" data-d="-1" aria-label="Fewer posts" ${p.weeklyGoal <= cfg.weekly_goal.min ? 'disabled' : ''}>−</button><span class="big num" style="font-size:40px">${p.weeklyGoal}</span><button data-action="set-goal" data-d="1" aria-label="More posts" ${p.weeklyGoal >= cfg.weekly_goal.max ? 'disabled' : ''}>+</button></div>
      ${instagramRow()}
      <label class="field"><span>Daily reminder time</span><input type="time" data-setting="notifyTime" value="${esc(p.notifyTime)}"></label>
      ${quietNote}
      <div class="row"><label class="field grow"><span>Quiet hours start</span><input type="time" data-setting="quietStart" value="${esc(qw.start)}"></label>
        <label class="field grow"><span>Quiet hours end</span><input type="time" data-setting="quietEnd" value="${esc(qw.end)}"></label></div>
      ${SYNTH ? `<div class="row between"><div class="grow"><b>Voice replies</b><p class="small muted">${state.voice.replies ? `${esc(K.NAME)} speaks answers aloud while you are in a voice session.` : 'Answers stay on screen. Nothing is spoken.'}</p></div><button class="btn ${state.voice.replies ? 'ghost' : 'soft'} sm" id="settings-voice-replies" data-action="voice-replies" aria-pressed="${state.voice.replies}">${state.voice.replies ? 'Turn off' : 'Turn on'}</button></div>`
        : '<div><b>Voice replies</b><p class="small muted">This browser cannot speak answers aloud.</p></div>'}
      <span class="label">Theme</span>
      <div class="options three">${[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']].map(([id, l]) => `<button class="opt" data-action="set" data-key="theme" data-val="${id}" aria-pressed="${(p.theme || 'system') === id}"><b>${l}</b></button>`).join('')}</div>
      <div class="row between"><div class="grow"><b>Reminders</b><p class="small muted">${esc(notifStatus())}</p></div><button class="btn ${on ? 'ghost' : 'soft'} sm" data-action="notify-toggle">${on ? 'Turn off' : 'Enable'}</button></div>
      <div class="row between"><div class="grow"><b>Your data</b><p class="small muted">Everything is stored only on this device.</p></div><button class="btn soft sm" data-action="export">Export</button></div>
      ${ui.exportText != null ? `<label class="field"><span>${ui.exportCopied ? 'Copied to your clipboard. Here it is too:' : 'Copy your data from here:'}</span><textarea readonly rows="6" data-select-all style="font-family:var(--font-num);font-size:12px">${esc(ui.exportText)}</textarea></label>` : ''}
      ${ui.confirmDelete
        ? `<div class="card warn"><h3>Delete your account?</h3><p class="small">This permanently erases your profile, ideas, reps, XP and chat from this device. It cannot be undone.</p>
            <div class="row"><button class="btn ghost grow" data-action="delete-cancel">Cancel</button><button class="btn danger grow" data-action="delete-yes">Yes, delete everything</button></div></div>`
        : '<button class="btn danger block" data-action="delete">Delete account</button>'}
      <p class="small muted">LockIn prototype · Phase 1. Grading is rule-based on this device. Build <span class="num" id="build">${esc(window.LI_BUILD || 'dev')}</span></p>
    </div>`;
  }

  // ---------- modals ----------

  function modalView() {
    const m = ui.modals[0];
    if (!m || ui.holdModal) return '';
    let art, title, body;
    if (m.kind === 'level') { art = '🚀'; title = `Level ${m.level}!`; body = 'Your reps are adding up. Keep the streak going to climb faster.'; }
    else if (m.kind === 'freeze') { art = '❄️'; title = 'Streak freeze earned'; body = `${m.days} days in a row earns a freeze. It covers one missed day automatically (you can hold up to ${cfg.streaks.max_freezes}).`; }
    else { art = '🔥'; title = `${m.days}-day streak!`; body = m.days >= 30 ? 'A month of showing up. That is a real habit.' : m.days >= 7 ? 'A full week. You are properly locked in.' : 'Three days in a row. This is how habits start.'; }
    return `<div class="overlay" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal">
      <div class="huge" aria-hidden="true">${art}</div><h2 id="modal-title">${esc(title)}</h2><p class="muted">${esc(body)}</p>
      <button class="btn block" data-action="close-modal">Keep going</button></div></div>`;
  }

  // ---------- notifications ----------

  function sendNotification(title, body) {
    const opts = { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'lockin-' + title };
    const direct = () => { try { new Notification(title, opts); } catch (e) { /* ignore */ } };
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) {
        navigator.serviceWorker.getRegistration().then(reg => {
          if (reg && reg.showNotification) return reg.showNotification(title, opts);
          direct();
        }).catch(direct);
      } else direct();
    } catch (e) { direct(); }
  }

  function checkNotify() {
    try {
      const p = state.profile;
      if (!p || !p.onboarded || !p.notifications || !('Notification' in window) || Notification.permission !== 'granted') return;
      const t = now();
      const day = E.localDay(t);
      if (state.notif.day !== day) state.notif = { day, count: 0, sent: {} };
      if (state.notif.count >= cfg.notifications.max_per_day || E.isQuiet(cfg, p, t)) return;
      const s = streak();
      if (s.activeToday) return;
      const hi = lang() === 'hi';
      const first = (p.name || '').split(' ')[0];
      let kind = null, title, body;
      const minute = E.minutesOfDay(t);
      if (!state.notif.sent.risk && s.current > 0 && minute >= E.streakRiskStart(cfg, p)) {
        kind = 'risk'; title = `${K.NAME}: your ${s.current}-day streak is at risk`;
        body = hi ? 'Bas ek chhota rep, 1 minute. Streak bachao.' : 'One quick rep keeps it alive. It takes a minute.';
      } else if (!state.notif.sent.reminder && minute >= E.reminderMinutes(cfg, p)) {
        kind = 'reminder'; title = `${K.NAME}: today's rep is ready`;
        body = hi ? `${first || 'Dost'}, aaj ka prompt ready hai. 5 minute, chalo.` : `${first ? first + ', t' : 'T'}oday's prompt is waiting. Five minutes.`;
      }
      if (!kind) return;
      state.notif.sent[kind] = iso(t);
      state.notif.count++;
      save();
      sendNotification(title, body);
    } catch (e) { /* notifications are best effort */ }
  }

  function toggleNotifications() {
    const p = state.profile;
    if (p.notifications) { p.notifications = false; save(); render(); toast('Reminders off'); return; }
    if (!('Notification' in window)) { toast('Notifications are not available in this browser'); return; }
    const done = res => {
      if (res === 'granted') { p.notifications = true; save(); render(); toast('Reminders on'); checkNotify(); }
      else { render(); toast('Notifications are blocked. You can allow them in your browser settings.'); }
    };
    try {
      const r = Notification.requestPermission(done);
      if (r && typeof r.then === 'function') r.then(done).catch(() => toast('Notifications are not available here'));
    } catch (e) { toast('Notifications are not available here'); }
  }

  // ---------- demo profile ----------

  function seedDemo() {
    const st = fresh();
    const t0 = now();
    const at = (daysAgo, h, m) => { const d = new Date(t0); d.setDate(d.getDate() - daysAgo); d.setHours(h, m || 0, 0, 0); return d.getTime(); };
    st.profile = {
      name: 'Priya', phone: '', authMethod: 'demo', birthDate: '2002-03-14', goal: 'grow', niche: 'food', language: 'english',
      weeklyGoal: cfg.weekly_goal.suggested, notifyTime: '19:00', timezone: 'Asia/Kolkata',
      theme: (state.profile && state.profile.theme) || 'system', notifications: false,
      consentAt: iso(at(5, 18)), createdAt: iso(at(5, 18)), onboarded: true, demo: true
    };
    st.ob = { step: 'done', data: {} };
    const grade = { niche: 'food', language: 'english' };
    const idea = (text, d, h) => makeIdea(st, text, 'text', at(d, h)).idea;
    const rep = (type, text, d, h, ideaId) => doRep(st, type, text, { grade, ideaId }, at(d, h)).rep;

    // Day 5: onboarding hooks and first ideas
    rep('hook', 'This ₹80 dosa in Koramangala beats every ₹400 brunch I have had', 5, 18);
    rep('hook', 'Hi guys today I will show you my favourite cafe', 5, 18);
    rep('hook', 'Stop ordering paneer tikka at dhabas. Order this instead.', 5, 18);
    const dosa = idea('The ₹80 dosa in Koramangala that beats every brunch', 5, 19);
    const coffee = idea('Ranking 5 filter coffee spots in Bangalore under ₹100', 5, 19);
    // Day 4
    const biryani = idea('Why your homemade biryani never tastes like the restaurant', 4, 13);
    rep('rewrite', 'I found a cafe in Indiranagar where coffee costs ₹60. Here is the catch.', 4, 21);
    // Day 3
    rep('script', 'Your biryani is missing one thing, and it is not the masala. Restaurants cook the rice in the same stock as the meat. Here is the trick: boil the rice for 6 minutes in salted water with whole spices, then layer it over the half-cooked chicken. Seal the pot with dough and cook on low for 20 minutes. That is why the rice tastes like the meat. Save this for your next Sunday biryani.', 3, 20, biryani.id);
    const roti = idea('One kitchen shortcut my mom taught me for soft rotis every time', 3, 21);
    // Day 2
    rep('hook', 'Why does every Bangalore biryani taste the same now?', 2, 9);
    E.award(st, cfg, { source: 'lesson', sourceId: 'l1', now: at(2, 9, 30) });
    st.lessonsDone.push('l1');
    idea('Street momos vs ₹400 cafe momos blind taste test', 2, 22);
    // Day 1
    rep('hook', 'You are making chai wrong, and your nani knows it', 1, 8, roti.id);
    rep('rewrite', 'I made restaurant-style pasta for ₹90 using only 4 things', 1, 19);
    E.award(st, cfg, { source: 'lesson', sourceId: 'l3', now: at(1, 19, 20) });
    st.lessonsDone.push('l3');
    idea('Best chai stall near HSR for late night study breaks', 1, 23);

    // Pipeline progress
    dosa.hook = 'This ₹80 dosa in Koramangala beats every ₹400 brunch I have had';
    [['hook', 5, 18], ['script', 4, 20], ['filmed', 2, 17], ['posted', 1, 12]].forEach(([s, d, h]) => moveStage(dosa, s, at(d, h)));
    const logPost = (ideaId, platform, format, views, daysAgo, h) => st.posts.push(E.validatePost({ ideaId, platform, format, views, date: E.localDay(at(daysAgo, h)) }, cfg, at(daysAgo, h)));
    logPost(dosa.id, 'instagram', 'Reel', 1840, 1, 12);
    logPost(null, 'youtube', 'Short', 410, 5, 17);
    logPost(null, 'instagram', 'Reel', 2650, 8, 13);
    logPost(null, 'instagram', 'Reel', 920, 12, 19);
    coffee.hook = 'I tried 5 filter coffees in Bangalore. Only one was worth ₹100.';
    [['hook', 4, 10], ['script', 3, 11], ['filmed', 1, 16]].forEach(([s, d, h]) => moveStage(coffee, s, at(d, h)));
    moveStage(biryani, 'hook', at(3, 19)); moveStage(biryani, 'script', at(3, 20));
    biryani.hook = 'Your biryani is missing one thing, and it is not the masala.';
    roti.hook = 'You are making chai wrong, and your nani knows it';
    moveStage(roti, 'hook', at(1, 8));

    st.chat = [
      { from: 'coach', text: K.chat(st.profile, 'hi'), at: iso(at(5, 18)) },
      { from: 'me', text: 'How do I write a better hook?', at: iso(at(4, 21)) },
      { from: 'coach', text: K.chat(st.profile, 'How do I write a better hook?'), at: iso(at(4, 21)) }
    ];
    st.ledger.sort((a, b) => a.created_at.localeCompare(b.created_at));
    st.reps.sort((a, b) => a.created_at.localeCompare(b.created_at));
    st.seenLevel = E.levelFor(E.totalXP(st), cfg).level;
    return st;
  }

  // ---------- Instagram import ----------

  function igClear() {
    delete state.instagram;
    delete state.followers;
    state.posts = state.posts.filter(p => p.source !== 'instagram');
  }

  // Ask the connect service to forget the stored token; best effort, the local data goes either way.
  function igRevoke() {
    const ig = state.instagram;
    if (!IG_BASE || !ig || !ig.session) return;
    try { fetch(`${IG_BASE}/api/disconnect?session=${encodeURIComponent(ig.session)}`, { method: 'POST' }).catch(() => {}); } catch (e) { /* ignore */ }
  }

  // Store the profile and its posts. Imported posts stay unverified: they feed the goal bar and
  // insights only, never XP or tiers (Phase 2 verifies real posts on the server).
  function igApply(data) {
    const t = now(), prev = state.instagram || {};
    const num = v => (typeof v === 'number' && isFinite(v) && v >= 0 ? Math.floor(v) : 0);
    const str = (v, n) => String(v == null ? '' : v).slice(0, n);
    state.instagram = {
      username: str(data.username, 60), name: str(data.name, 80), account_type: str(data.account_type, 20), biography: str(data.biography, 300),
      profile_picture_url: str(data.profile_picture_url, 500), followers_count: num(data.followers_count), follows_count: num(data.follows_count), media_count: num(data.media_count),
      demo: !IG_BASE, session: str(data.session || prev.session, 200), connectedAt: prev.connectedAt || iso(t), syncedAt: iso(t), verified: false
    };
    state.followers = state.instagram.followers_count;
    state.posts = state.posts.filter(p => p.source !== 'instagram').concat(IGM.mediaToPosts(data, t));
  }

  // A successful connect: during onboarding fill in the answers and show the confirm screen.
  function igConnected(data) {
    igApply(data);
    ui.igBusy = false; ui.igErr = '';
    if (state.profile && state.profile.onboarded) {
      save(); render();
      toast(`Instagram connected: @${state.instagram.username}`);
      return;
    }
    const guess = IGM.inferProfile(data, cfg, now());
    Object.assign(state.ob.data, { manual: false, name: guess.name, niche: guess.niche, language: guess.language, weeklyGoal: guess.weeklyGoal, igNotes: guess.notes });
    ui.draft.name = guess.name;
    obGo('confirm');
  }

  function igFailed(code) {
    ui.igBusy = false;
    ui.igErr = IG_ERRORS[code] || IG_ERRORS.failed;
    if (state.profile && state.profile.onboarded) toast(ui.igErr.split('. ')[0] + '.');
    render();
  }

  async function igFetch(query) {
    let res, body = null;
    try { res = await fetch(`${IG_BASE}/api/profile?${query}`); } catch (e) { throw new Error('network'); }
    try { body = await res.json(); } catch (e) { /* not JSON */ }
    if (!res.ok) throw new Error(body && body.error === 'account_type' ? 'account_type' : res.status === 401 || res.status === 404 ? 'expired' : 'failed');
    return body;
  }

  function igConnect() {
    if (ui.igBusy) return;
    if (IG_BASE) {
      // The service sends the browser back here with #ig=<one-time code>, picked up by igReturn().
      const back = encodeURIComponent(location.origin + location.pathname);
      location.assign(`${IG_BASE}/auth/start?return=${back}`);
      return;
    }
    ui.igBusy = true; ui.igErr = ''; render();
    setTimeout(() => igConnected(IGM.sampleProfile(now())), 900);
  }

  function igRefresh() {
    const ig = state.instagram;
    if (!ig || ui.igBusy) return;
    if (!IG_BASE) { toast('Demo data is a fixed sample, so there is nothing new to fetch'); return; }
    ui.igBusy = true; ui.igErr = ''; render();
    igFetch('session=' + encodeURIComponent(ig.session))
      .then(data => { igApply(data); ui.igBusy = false; save(); render(); toast('Instagram refreshed'); })
      .catch(e => igFailed(e.message));
  }

  // Back from the connect service: read #ig=<code> or #ig_error=<reason>, clear it from the URL, fetch the profile.
  function igReturn() {
    const hash = location.hash || '';
    const code = (hash.match(/[#&]ig=([^&]+)/) || [])[1], error = (hash.match(/[#&]ig_error=([^&]+)/) || [])[1];
    if (!code && !error) return;
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
    const onboarded = state.profile && state.profile.onboarded;
    if (!onboarded && !(state.ob.data && state.ob.data.consentAt)) return; // consent comes first
    if (onboarded) { ui.tab = 'you'; ui.view = null; } else state.ob.step = 'connect';
    if (error) { igFailed(/denied|cancel/i.test(error) ? 'denied' : 'failed'); return; }
    ui.igBusy = true;
    igFetch('code=' + encodeURIComponent(decodeURIComponent(code))).then(igConnected).catch(e => igFailed(e.message));
  }

  // ---------- actions ----------

  // Add or update the view count on a logged post. Self-reported, so no XP and no ledger row.
  function saveViews(id, raw, done) {
    const post = state.posts.find(x => x.id === id);
    if (!post) return;
    try { E.setPostViews(post, String(raw).replace(/[,\s]/g, ''), cfg, now()); } catch (err) { toast(err.message); return; }
    done();
    save(); render();
    toast('Views saved');
  }

  const actions = {
    'ob-start': () => obGo('agree'),
    demo: () => { state = seedDemo(); ui.draft = {}; save(); go({ tab: 'home', view: null, modals: [] }); toast('Demo profile loaded: Priya, food creator'); },
    'ob-back': () => {
      const step = state.ob.step;
      if (step === 'signin' && ui.otpSent) { ui.otpSent = false; render(); return; }
      ui.igErr = '';
      const i = obSteps().indexOf(step);
      obGo(i <= 0 ? 'welcome' : obSteps()[i - 1]);
    },
    'ob-skip': () => {
      const step = state.ob.step;
      if (step === 'signin') state.ob.data.method = 'guest';
      if (step === 'weekly') state.ob.data.weeklyGoal = state.ob.data.weeklyGoal || cfg.weekly_goal.suggested;
      obGo(obSteps()[obSteps().indexOf(step) + 1] || 'exercise');
    },
    'ob-reset': () => { state = fresh(); ui.draft = {}; ui.otpSent = false; save(); go({}); },
    'otp-send': () => {
      const phone = String(draft('phone')).replace(/\D/g, '');
      if (!/^[6-9]\d{9}$/.test(phone)) { ui.err = 'Enter a 10-digit Indian mobile number.'; render(); return; }
      state.ob.data.phone = phone;
      ui.otpSent = true; ui.err = ''; save(); render();
      toast('Code sent (demo: ' + DEMO_CODE + ')');
    },
    'otp-change': () => { ui.otpSent = false; ui.err = ''; render(); },
    'otp-verify': () => {
      if (String(draft('otp')).trim() !== DEMO_CODE) { ui.err = 'That code does not match. In this demo the code is ' + DEMO_CODE + '.'; render(); return; }
      state.ob.data.method = 'phone';
      ui.otpSent = false;
      obGo('name');
    },
    google: () => {
      state.ob.data.method = 'google';
      toast('Signed in with Google (demo)');
      obGo('name');
    },
    'ob-name': () => { state.ob.data.name = String(draft('name')).trim().slice(0, 40); obGo('goal'); },
    'ob-agree': () => {
      const b = String(draft('birthDate') || state.ob.data.birthDate || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(b) || b < '1900-01-01' || b > E.localDay(now())) { ui.err = 'Enter your birth date.'; render(); return; }
      if (ageOn(b, now()) < 18) {
        state = Object.assign(fresh(), { ob: { step: 'blocked', data: {} } });
        ui.draft = {};
        save(); go({});
        return;
      }
      if (!draft('consent') && !state.ob.data.consentAt) { ui.err = 'Please accept the privacy notice to continue.'; render(); return; }
      state.ob.data.birthDate = b;
      state.ob.data.consentAt = state.ob.data.consentAt || iso(now());
      obGo('connect');
    },
    'ob-manual': () => {
      if (state.instagram) igClear();
      state.ob.data.manual = true; ui.igErr = '';
      obGo('signin');
    },
    'ob-confirm-go': () => obGo('confirm'),
    'ob-confirm': () => {
      const d = state.ob.data;
      if (!d.niche) { ui.err = 'Pick a niche to continue.'; render(); return; }
      d.name = String(draft('name') || d.name || '').trim().slice(0, 40);
      d.language = d.language || 'english';
      d.weeklyGoal = d.weeklyGoal || cfg.weekly_goal.suggested;
      if (draft('notifyTime')) d.notifyTime = draft('notifyTime');
      obGo('exercise');
    },
    'ig-connect': () => igConnect(),
    'ig-refresh': () => igRefresh(),
    'ig-disconnect': () => { ui.confirmIg = true; render(); },
    'ig-disconnect-cancel': () => { ui.confirmIg = false; render(); },
    'ig-disconnect-yes': () => {
      igRevoke();
      igClear();
      ui.confirmIg = false; ui.igErr = '';
      save(); render();
      toast('Instagram disconnected and its data deleted from this device');
    },
    'ob-pick': el => { state.ob.data[el.dataset.key] = el.dataset.val; ui.err = ''; save(); render(); },
    'ob-next-from': el => obGo(obSteps()[obSteps().indexOf(el.dataset.step) + 1]),
    'ob-niche': () => {
      if (!state.ob.data.niche) { ui.err = 'Pick a niche to continue.'; render(); return; }
      state.ob.data.language = state.ob.data.language || 'english';
      obGo('weekly');
    },
    'ob-goal': el => {
      const d = state.ob.data;
      d.weeklyGoal = Math.max(cfg.weekly_goal.min, Math.min(cfg.weekly_goal.max, (d.weeklyGoal || cfg.weekly_goal.suggested) + Number(el.dataset.d)));
      save(); render();
    },
    'ob-weekly': () => {
      const d = state.ob.data;
      d.weeklyGoal = d.weeklyGoal || cfg.weekly_goal.suggested;
      if (draft('notifyTime')) d.notifyTime = draft('notifyTime');
      obGo('exercise');
    },
    'ob-hooks': () => {
      const list = [0, 1, 2].map(i => String(draft('hook' + i)).trim()).filter(Boolean);
      if (!list.length) { ui.err = 'Write at least one hook, or skip for now.'; render(); return; }
      ui.obResult = gradeHookSet(list, { grade: gradeOpts() }, now());
      state.ob.step = 'result';
      save();
      go({});
      burst(ui.obResult.xp);
    },
    'ob-retry': () => { ['hook0', 'hook1', 'hook2'].forEach(k => { delete ui.draft[k]; }); obGo('exercise'); },
    'ob-finish': () => finishOnboarding(),

    tab: el => go({ tab: el.dataset.tab, view: null, ideaConfirm: null, confirmDelete: false, exportText: null }),
    back: () => {
      const v = ui.view;
      if (v && v.kind === 'lesson') go({ view: { kind: 'lessons' } });
      else go({ view: null });
    },
    'close-modal': () => { ui.modals.shift(); render(); },

    'prompt-hooks': () => {
      const brief = K.dailyBrief(state.profile, briefCtx());
      openRep('hook', { prompt: brief.prompt });
    },
    'prompt-idea': () => {
      const brief = K.dailyBrief(state.profile, briefCtx());
      addIdea(brief.prompt, 'prompt');
    },
    'open-rep': el => { ui.tab = ui.tab === 'home' ? 'home' : 'practice'; openRep(el.dataset.type); },
    'submit-rep': () => submitRep(),
    'rep-retry': () => {
      const r = ui.view.result, from = ui.view.from;
      openRep(from.type, { ideaId: from.ideaId, prompt: from.prompt, weak: from.weak });
      if (from.type === 'hook') r.content.forEach((c, i) => { ui.draft['hook' + i] = c; });
      else ui.draft[from.type] = r.content[0];
      render();
    },
    'rep-another': () => openRep(ui.view.from.type),
    lessons: () => go({ tab: 'practice', view: { kind: 'lessons' } }),
    lesson: el => go({ view: { kind: 'lesson', id: el.dataset.id, picked: null } }),
    answer: el => {
      const v = ui.view;
      const l = C.LESSONS.find(x => x.id === v.id);
      v.picked = Number(el.dataset.i);
      v.earned = 0;
      if (v.picked === l.answer && !state.lessonsDone.includes(l.id)) {
        const before = snapshot();
        const entry = E.award(state, cfg, { source: 'lesson', sourceId: l.id, now: now() });
        state.lessonsDone.push(l.id);
        v.earned = entry.amount;
        save();
        celebrate(before);
        render();
        burst(entry.amount);
        return;
      }
      render();
    },

    filter: el => { ui.filter = el.dataset.f; render(); },
    voice: el => startVoice(el.dataset.target),
    mic: () => micTap(),
    'voice-stop': () => endSession(),
    'voice-replies': () => setVoiceReplies(!state.voice.replies),
    'idea-rep': el => { ui.tab = 'ideas'; openRep(el.dataset.type, { ideaId: el.dataset.id }); },
    'idea-stage': el => {
      const idea = state.ideas.find(i => i.id === el.dataset.id);
      if (el.dataset.stage === 'posted') {
        // Posting is self-reported: say where and when, then the post is logged and the idea moves on.
        if (idea && STAGES.indexOf(idea.stage) < STAGES.indexOf('posted')) openLogPost(idea.id);
        return;
      }
      if (!idea || !moveStage(idea, el.dataset.stage, now())) return;
      save();
      render();
      toast('Marked filmed 🎬');
    },
    'log-post-open': () => openLogPost(null),
    'post-platform-pick': el => { ui.draft.postPlatform = el.dataset.val; ui.err = ''; render(); },
    'post-format': el => { ui.draft.postFormat = draft('postFormat') === el.dataset.val ? '' : el.dataset.val; render(); },
    'post-save': () => {
      const v = ui.view, t = now();
      let post;
      try {
        post = E.validatePost({
          ideaId: v.ideaId, platform: draft('postPlatform'), date: draft('postDate'), format: draft('postFormat'),
          views: String(draft('postViews')).replace(/[,\s]/g, ''), note: draft('postNote')
        }, cfg, t);
      } catch (err) { ui.err = err.message; render(); return; }
      state.posts.push(post);
      const idea = v.ideaId && state.ideas.find(i => i.id === v.ideaId);
      if (idea) moveStage(idea, 'posted', t);
      save();
      go({ view: null });
      const n = postedThisWeek(), goal = state.profile.weeklyGoal;
      toast(n >= goal ? 'Weekly posting goal hit! 🎉' : `Post logged. ${n}/${goal} this week`);
    },
    'post-set-platform': el => {
      const post = state.posts.find(x => x.id === el.dataset.id);
      if (!post) return;
      E.setPostPlatform(post, el.dataset.val, cfg);
      save(); render();
    },
    'post-views-edit': el => { ui.editPost = el.dataset.id; const post = state.posts.find(x => x.id === el.dataset.id); ui.draft.postViewsEdit = post && post.views != null ? String(post.views) : ''; render(); },
    'post-views-cancel': () => { ui.editPost = null; render(); },
    'post-views-save': el => saveViews(el.dataset.id, draft('postViewsEdit'), () => { ui.editPost = null; }),
    'prompt-views-save': el => saveViews(el.dataset.id, draft('nudgeViews'), () => { delete ui.draft.nudgeViews; }),
    'idea-remove': el => { ui.ideaConfirm = el.dataset.id; render(); const d = document.querySelector(`[data-idea="${el.dataset.id}"] details`); if (d) d.open = true; },
    'idea-remove-no': () => { ui.ideaConfirm = null; render(); },
    'idea-remove-yes': el => {
      const id = el.dataset.id;
      state.ledger.filter(e => e.source_type === 'idea' && e.source_id === id && e.amount > 0 && !E.isReversed(state, e.id)).forEach(e => E.reverse(state, e.id, now()));
      state.ideas = state.ideas.filter(i => i.id !== id);
      ui.ideaConfirm = null;
      save(); render();
      toast('Idea removed');
    },

    'studio-save': el => {
      const m = state.chat[Number(el.dataset.i)];
      if (!m || !m.result || m.savedId) return;
      // Only the user's own words are saved (and earn XP through the usual idea path); the AI parts earn nothing.
      const idea = addIdea(m.result.idea.text, 'chat');
      if (idea) { m.savedId = idea.id; save(); render(); }
    },
    'board-open': () => go({ view: { kind: 'board' } }),
    'board-add': () => {
      const c = { id: E.uid('card'), text: '', ai: false };
      state.board.cards.push(c); save(); render();
      const t = document.querySelector(`[data-card-text="${c.id}"]`);
      if (t) try { t.focus(); } catch (e) { /* ignore */ }
    },
    'board-del': el => { state.board.cards = state.board.cards.filter(c => c.id !== el.dataset.id); save(); render(); },
    'board-move': el => {
      const cards = state.board.cards, i = cards.findIndex(c => c.id === el.dataset.id), j = i + Number(el.dataset.dir);
      if (i < 0 || j < 0 || j >= cards.length) return;
      [cards[i], cards[j]] = [cards[j], cards[i]]; save(); render();
    },
    'board-save': () => boardSave(),
    'board-from-studio': el => {
      // The studio's tiles become sticky cards marked as AI-written. They never earn XP.
      const m = state.chat[Number(el.dataset.i)];
      if (!m || !m.result) return;
      m.result.board.tiles.forEach(t => state.board.cards.push({ id: E.uid('card'), text: `${t.label}: ${t.visual}${t.text ? ' (' + t.text + ')' : ''}`, ai: true }));
      save();
      go({ view: { kind: 'board' } });
    },
    quick: el => sendChat(el.dataset.q),
    chat: () => sendChat(draft('chatText')),
    'add-idea': () => { const voice = ui.voiceUsed; ui.voiceUsed = false; addIdea(draft('ideaText'), voice ? 'voice' : 'text'); },

    set: el => { state.profile[el.dataset.key] = el.dataset.val; save(); render(); },
    'set-goal': el => {
      const p = state.profile;
      p.weeklyGoal = Math.max(cfg.weekly_goal.min, Math.min(cfg.weekly_goal.max, p.weeklyGoal + Number(el.dataset.d)));
      save(); render();
    },
    'notify-toggle': () => toggleNotifications(),
    export: () => {
      const text = JSON.stringify(state, (k, v) => (k === 'session' ? undefined : v), 2); // the connect session is a credential
      ui.exportText = text; ui.exportCopied = false;
      render();
      try {
        const pol = document.permissionsPolicy || document.featurePolicy;
        if (!navigator.clipboard || (pol && pol.allowsFeature && !pol.allowsFeature('clipboard-write'))) { toast('Copy the data from the box below'); return; }
        navigator.clipboard.writeText(text).then(() => { ui.exportCopied = true; render(); toast('Your data is copied to the clipboard'); })
          .catch(() => toast('Copy the data from the box below'));
      } catch (e) { toast('Copy the data from the box below'); }
    },
    delete: () => { ui.confirmDelete = true; render(); },
    'delete-cancel': () => { ui.confirmDelete = false; render(); },
    'delete-yes': () => {
      igRevoke();
      try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
      memory = null;
      state = fresh();
      ui.draft = {}; ui.confirmDelete = false; ui.exportText = null; ui.modals = []; ui.otpSent = false;
      save();
      go({ tab: 'home', view: null });
      toast('Your account and data were deleted from this device');
    }
  };


  // ---------- events ----------

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const fn = actions[el.dataset.action];
    if (!fn) return;
    e.preventDefault();
    try { fn(el, e); } catch (err) { console.error(err); toast('Something went wrong. Please try again.'); }
  });

  // No <form>s: sandboxed hosts block form submission, so Enter is handled here.
  document.addEventListener('keydown', e => {
    const a = e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.target.dataset && e.target.dataset.enter;
    if (!a || !actions[a]) return;
    e.preventDefault();
    ui.draft[e.target.dataset.bind] = e.target.value;
    actions[a](e.target, e);
  });

  function bind(e) {
    const t = e.target;
    if (t.dataset && t.dataset.cardText) {
      const c = state.board.cards.find(x => x.id === t.dataset.cardText);
      if (c) { c.text = t.value; c.ai = false; save(); }
      return;
    }
    const k = t.dataset && t.dataset.bind;
    if (k === 'boardText') { state.board.text = t.value; save(); const w = document.getElementById('board-words'); if (w) w.textContent = plural(wordCount(t.value), 'word'); return; }
    if (k) {
      ui.draft[k] = t.type === 'checkbox' ? t.checked : t.value;
      if (k === 'script') { const wc = document.getElementById('wc'); if (wc) wc.textContent = wcText(wordCount(t.value)); }
      if (k === 'consent' && t.checked && ui.err) { ui.err = ''; const el = document.querySelector('.err'); if (el) el.remove(); }
    }
  }
  document.addEventListener('input', bind);
  document.addEventListener('change', e => {
    bind(e);
    const s = e.target.dataset && e.target.dataset.setting;
    if (s && state.profile) {
      state.profile[s] = e.target.value;
      save();
      if (s === 'notifyTime') { state.notif.sent.reminder = null; toast('Reminder time saved'); }
      else if (s === 'quietStart' || s === 'quietEnd') { state.notif.sent.reminder = null; toast('Quiet hours saved'); }
      render();
    }
  });
  document.addEventListener('focusin', e => { if (e.target.hasAttribute && e.target.hasAttribute('data-select-all')) try { e.target.select(); } catch (err) { /* ignore */ } });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && ui.modals.length) { ui.modals.shift(); render(); } });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') endSession(); // the mic and speech stop with the app
    if (document.visibilityState === 'visible') { if (state.profile && state.profile.onboarded && !ui.view && ui.tab === 'home') render(); checkNotify(); }
  });

  setInterval(checkNotify, 3 * 60 * 1000);
  setInterval(() => { if (state.profile && state.profile.onboarded && !ui.view && ui.tab === 'home' && !document.querySelector('.overlay') && !document.activeElement.matches('input,textarea')) render(); }, 60 * 1000);

  // Test hooks: inspect state and move the clock without touching the engine.
  window.LIApp = {
    state: () => state,
    ui: () => ui,
    setNow: ms => { fixedNow = ms == null ? null : Number(ms); render(); },
    render,
    reset: () => { state = fresh(); memory = null; try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } ui.draft = {}; ui.modals = []; go({ tab: 'home', view: null }); },
    checkNotify
  };

  igReturn();
  render();
  checkNotify();
})();
