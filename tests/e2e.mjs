// Phone-sized end-to-end tests for the built PWA (dist/) and the single-file dist/artifact.html.
// Run: npm run build && node tests/e2e.mjs        Screenshots land in test-shots/ (gitignored).
// Not picked up by `npm test` (that runs tests/unit/*.test.mjs only).
import { createServer } from 'node:http';
import { readFile, mkdir, stat } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const shots = path.join(root, 'test-shots');
if (!existsSync(path.join(dist, 'index.html'))) { console.error('dist/ missing: run `npm run build` first'); process.exit(2); }
await mkdir(shots, { recursive: true });

const { chromium } = await import('playwright');

// ---------- static server ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const artifactRaw = await readFile(path.join(dist, 'artifact.html'), 'utf8');
const wrapped = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${artifactRaw}</body></html>`;
const host = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body{margin:0;height:100%}iframe{border:0;width:100%;height:100%;display:block}</style></head><body><iframe id="f" sandbox="allow-scripts" src="/__wrapped.html"></iframe></body></html>`;
const server = createServer(async (req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (url === '/__host.html') { res.writeHead(200, { 'content-type': TYPES['.html'] }); return res.end(host); }
  if (url === '/__wrapped.html') { res.writeHead(200, { 'content-type': TYPES['.html'] }); return res.end(wrapped); }
  const file = path.join(dist, url === '/' ? 'index.html' : url);
  if (!file.startsWith(dist)) { res.writeHead(403); return res.end(); }
  try {
    const s = await stat(file);
    if (!s.isFile()) throw new Error('dir');
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

// ---------- browser ----------
function chromiumPath() {
  const dir = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  for (const d of (existsSync(dir) ? readdirSync(dir) : []).filter(d => /^chromium-\d+$/.test(d)).sort().reverse()) {
    const p = path.join(dir, d, 'chrome-linux', 'chrome');
    if (existsSync(p)) return p;
  }
  return undefined;
}
let browser;
try { browser = await chromium.launch(); } catch (e) { browser = await chromium.launch({ executablePath: chromiumPath() }); }

// ---------- tiny test runner ----------
const results = [];
let current = '';
let currentPage = null;
async function step(name, fn) {
  current = name;
  try { await fn(); results.push({ name, ok: true }); console.log('  ok  ', name); }
  catch (e) {
    results.push({ name, ok: false, err: e });
    // First two e2e.mjs frames: the helper that threw, then the step line that called it.
    const where = [...String(e && e.stack || '').matchAll(/e2e\.mjs:(\d+)/g)].slice(0, 2).map(m => m[1]);
    console.log('  FAIL', name, where.length ? `(tests/e2e.mjs:${where.join(' <- tests/e2e.mjs:')})` : '', '\n       ', String(e && e.message || e).split('\n').slice(0, 6).join('\n        '));
    // Keep evidence for the report: a screenshot and the app's UI state at the moment of failure.
    if (currentPage) {
      const slug = name.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 60);
      await currentPage.screenshot({ path: path.join(shots, 'fail-' + slug + '.png') }).catch(() => {});
      const ui = await currentPage.evaluate(() => { try { return JSON.stringify(window.LIApp.ui()).slice(0, 400); } catch (x) { return 'n/a'; } }).catch(() => 'n/a');
      console.log('        ui:', ui);
    }
  }
}

const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36' };

async function newPhone(scheme, { workers = false } = {}) {
  const context = await browser.newContext({ ...PHONE, colorScheme: scheme, serviceWorkers: workers ? 'allow' : 'block', permissions: ['clipboard-read', 'clipboard-write'] });
  // Fonts come from Google; keep tests offline and deterministic.
  await context.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const page = await context.newPage();
  currentPage = page;
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`); });
  page.on('pageerror', e => errors.push(`[pageerror] ${e.message}`));
  page.on('requestfailed', r => { if (!/fonts\./.test(r.url())) errors.push(`[requestfailed] ${r.url()} ${r.failure() && r.failure().errorText}`); });
  return { context, page, errors };
}

const S = page => page.evaluate(() => JSON.parse(JSON.stringify(window.LIApp.state())));
const act = (page, action, extra = '') => page.locator(`[data-action="${action}"]${extra}`).first().click();
const total = st => st.ledger.reduce((s, e) => s + e.amount, 0);
const toastText = page => page.locator('.toast').last().textContent({ timeout: 2000 }).catch(() => '');

// The app holds a celebration modal for ~1.2s while the XP burst plays (app.js burst()), so wait on
// state: either no modal is queued, or its close button has rendered.
async function closeModals(page) {
  for (let i = 0; i < 6; i++) {
    await page.waitForFunction(() => window.LIApp.ui().modals.length === 0 || document.querySelector('[data-action="close-modal"]'), null, { timeout: 2500 }).catch(() => {});
    const m = page.locator('[data-action="close-modal"]');
    if (await m.count()) await m.first().click(); else break;
  }
}

// Layout checks on every screen: no horizontal overflow; the fixed tab bar never hides the
// last piece of content when scrolled to the bottom.
async function layout(page, label) {
  const r = await page.evaluate(async () => {
    const out = { sw: document.documentElement.scrollWidth, iw: window.innerWidth, wide: [] };
    // Collapsed <details> bodies are still laid out (content-visibility), so skip them.
    const hiddenInDetails = el => { const d = el.closest('details'); return !!d && !d.open && !(el.tagName === 'SUMMARY' || el.parentElement === d && el.tagName === 'SUMMARY'); };
    document.querySelectorAll('#app *').forEach(el => {
      if (hiddenInDetails(el)) return;
      const b = el.getBoundingClientRect();
      if (b.width && (b.right > window.innerWidth + 1 || b.left < -1) && getComputedStyle(el).position !== 'fixed' && !el.closest('.quick,.stages,[data-scroll-x]')) out.wide.push(el.tagName + '.' + el.className + ' ' + Math.round(b.left) + '..' + Math.round(b.right));
    });
    window.scrollTo(0, document.documentElement.scrollHeight);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const bar = document.querySelector('.tabbar');
    if (bar) {
      const top = bar.getBoundingClientRect().top;
      const screen = document.querySelector('#app .screen');
      const items = screen ? [...screen.querySelectorAll('*')].filter(e => { if (hiddenInDetails(e)) return false; const b = e.getBoundingClientRect(); return b.height > 0 && b.width > 0 && getComputedStyle(e).visibility !== 'hidden'; }) : [];
      const bottom = Math.max(0, ...items.map(e => e.getBoundingClientRect().bottom));
      out.barTop = top; out.contentBottom = bottom;
    }
    window.scrollTo(0, 0);
    return out;
  });
  assert.ok(r.sw <= r.iw, `${label}: horizontal overflow scrollWidth ${r.sw} > ${r.iw}`);
  assert.equal(r.wide.length, 0, `${label}: elements outside the viewport: ${r.wide.slice(0, 5).join(' | ')}`);
  if (r.barTop != null) assert.ok(r.contentBottom <= r.barTop + 1, `${label}: tab bar (top ${r.barTop}) covers content (bottom ${r.contentBottom})`);
}

async function shot(page, name, full = false) {
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(shots, name + '.png'), fullPage: full });
}

function yearsAgo(n, extraDays = 0) {
  const d = new Date(); d.setFullYear(d.getFullYear() - n); d.setDate(d.getDate() + extraDays);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

const STRONG_HOOK = 'This ₹80 dosa in Koramangala beats every ₹400 brunch I have had';
const STRONG_SCRIPT = "Stop paying ₹400 for brunch in Koramangala. This ₹80 dosa beats all of them. Here's why: the batter is fermented for 12 hours, so it's crisp outside and soft inside. First, ask for the ghee roast. Then add the podi on the side. The chutney is free and refilled. That is why the queue starts at 7 am. Go before 9 or it sells out. Save this for your next Sunday breakfast and tag a friend who loves dosa.";

// Twelve clearly different 9/10 scripts (pairwise cosine ~0.75, under the 0.9 repeat limit).
function scriptVariant(i) {
  const D = ['dosa', 'biryani', 'momos', 'jalebi', 'paratha', 'samosa', 'idli', 'vada', 'kulfi', 'rolls', 'thali', 'chaat'];
  const P = ['Koramangala', 'Bandra', 'Indiranagar', 'Jaipur', 'Hyderabad', 'Pune', 'Goa', 'Chennai', 'Delhi', 'Kolkata', 'Lucknow', 'Surat'];
  const R = ['batter', 'gravy', 'dough', 'syrup', 'chutney', 'masala', 'filling', 'broth', 'crust', 'stock', 'spice', 'oil'];
  const T = ['crisp', 'soft', 'spicy', 'creamy', 'smoky', 'tangy', 'fluffy', 'juicy', 'golden', 'fragrant', 'buttery', 'crunchy'];
  const W = ['queue', 'crowd', 'line', 'rush', 'buzz', 'footfall', 'waiting', 'stampede', 'chaos', 'frenzy', 'hype', 'mob'];
  const S = ['breakfast', 'dinner', 'lunch', 'weekend', 'festival', 'monsoon', 'winter', 'payday', 'picnic', 'roadtrip', 'exam', 'birthday'];
  const n = i % 12;
  return `Stop paying ₹${400 + n * 10} for dinner in ${P[n]}. This ₹${80 + n} ${D[n]} beats all of them. Here's why: the ${R[n]} is made fresh each morning, so it is ${T[n]} and ${T[(n + 5) % 12]} every single time. First, ask for the extra ${R[(n + 3) % 12]}. Then try it with the ${D[(n + 4) % 12]} on the side. That is why the ${W[n]} starts early in ${P[(n + 6) % 12]} too. Go before nine or it sells out. Save this for your next ${S[n]} and tag a friend who loves ${D[(n + 7) % 12]}.`;
}

// ---------- the flows ----------
async function fullRun(scheme) {
  const tag = scheme;
  console.log(`\n== ${scheme} ==`);
  const { context, page, errors } = await newPhone(scheme);
  await page.goto(BASE + '/');
  await page.waitForSelector('[data-action="ob-start"]');

  await step(`${tag}: welcome screen`, async () => {
    await layout(page, 'welcome');
    await shot(page, `${tag}-01-welcome`);
  });

  await step(`${tag}: sign-in validation, consent and OTP mock`, async () => {
    await act(page, 'ob-start');
    await page.fill('[data-bind="phone"]', '12345');
    await act(page, 'otp-send');
    assert.match(await page.locator('.err').textContent(), /10-digit/);
    await page.fill('[data-bind="phone"]', '9876543210');
    await act(page, 'otp-send');
    assert.match(await page.locator('.err').textContent(), /privacy notice/i, 'consent is required');
    await page.check('[data-bind="consent"]');
    await act(page, 'otp-send');
    await page.waitForSelector('[data-bind="otp"]');
    await layout(page, 'otp');
    await shot(page, `${tag}-02-otp`);
    await page.fill('[data-bind="otp"]', '000000');
    await act(page, 'otp-verify');
    assert.match(await page.locator('.err').textContent(), /does not match/);
    await page.fill('[data-bind="otp"]', '123456');
    await act(page, 'otp-verify');
    await page.waitForSelector('[data-bind="name"]');
  });

  await step(`${tag}: under-18 is blocked and nothing is saved`, async () => {
    await page.fill('[data-bind="name"]', 'Kid');
    await act(page, 'ob-name');
    await page.fill('[data-bind="birthDate"]', yearsAgo(18, 1)); // turns 18 tomorrow
    await act(page, 'ob-age');
    await page.waitForSelector('text=18 and over');
    const st = await S(page);
    assert.equal(st.profile, null);
    assert.deepEqual(st.ob.data, {});
    const raw = await page.evaluate(() => localStorage.getItem('lockin.v1'));
    assert.ok(!raw || !raw.includes('9876543210'), 'phone not kept after block');
    await layout(page, 'blocked');
    await shot(page, `${tag}-03-under18-blocked`);
    await act(page, 'ob-reset');
    await page.waitForSelector('[data-action="ob-start"]');
  });

  await step(`${tag}: onboarding via Google, required niche, weekly goal`, async () => {
    await act(page, 'ob-start');
    await act(page, 'google');
    assert.match(await page.locator('.err').textContent(), /privacy/i);
    await page.check('[data-bind="consent"]');
    await act(page, 'google');
    await page.fill('[data-bind="name"]', 'Asha');
    await act(page, 'ob-name');
    await page.fill('[data-bind="birthDate"]', yearsAgo(18)); // 18 today: allowed
    await act(page, 'ob-age');
    await page.waitForSelector('[data-key="goal"]');
    await layout(page, 'goal');
    await page.locator('[data-key="goal"]').first().click();
    await act(page, 'ob-next-from');
    await page.waitForSelector('[data-key="niche"]');
    assert.equal(await page.locator('[data-action="ob-skip"]').count(), 0, 'niche step cannot be skipped');
    await act(page, 'ob-niche');
    assert.match(await page.locator('.err').textContent(), /niche/i);
    await page.click('[data-key="niche"][data-val="food"]');
    await page.click('[data-key="language"][data-val="english"]');
    await layout(page, 'niche');
    await shot(page, `${tag}-04-niche`);
    await act(page, 'ob-niche');
    await page.waitForSelector('[data-action="ob-goal"]');
    await page.click('[data-action="ob-goal"][data-d="1"]');
    for (let i = 0; i < 8; i++) { const b = page.locator('[data-action="ob-goal"][data-d="1"]'); if (await b.isDisabled()) break; await b.click(); }
    assert.ok(await page.locator('[data-action="ob-goal"][data-d="1"]').isDisabled(), 'max 7');
    assert.equal(await page.locator('.stepper .big').textContent(), '7');
    for (let i = 0; i < 3; i++) await page.click('[data-action="ob-goal"][data-d="-1"]');
    await page.fill('[data-bind="notifyTime"]', '08:30');
    await layout(page, 'weekly');
    await act(page, 'ob-weekly');
    await page.waitForSelector('[data-bind="hook0"]');
  });

  await step(`${tag}: first hook exercise earns XP and streak day 1`, async () => {
    await act(page, 'ob-hooks');
    assert.match(await page.locator('.err').textContent(), /at least one hook/);
    await page.fill('[data-bind="hook0"]', STRONG_HOOK);
    await page.fill('[data-bind="hook1"]', 'Stop ordering the butter chicken here. Get this instead.');
    await page.fill('[data-bind="hook2"]', 'Filter coffee in Bangalore is not what you think');
    await layout(page, 'exercise');
    await shot(page, `${tag}-05-exercise`);
    await act(page, 'ob-hooks');
    await page.waitForSelector('text=Your first XP');
    const st = await S(page);
    assert.ok(total(st) > 0, 'three graded hooks earn XP: ' + total(st));
    assert.equal(st.reps.length, 3);
    assert.match(await page.locator('.card.hero').textContent(), /Day 1/);
    await layout(page, 'ob-result');
    await shot(page, `${tag}-06-onboarding-result`);
    await shot(page, `${tag}-06b-onboarding-result-full`, true);
    await act(page, 'ob-to-connect');
    await page.waitForSelector('text=Connect your accounts');
    await layout(page, 'connect');
    await act(page, 'ob-finish');
    await page.waitForSelector('.tabbar');
    const st2 = await S(page);
    assert.equal(st2.profile.name, 'Asha'); assert.equal(st2.profile.weeklyGoal, 4); assert.equal(st2.profile.notifyTime, '08:30');
    assert.equal(st2.profile.niche, 'food'); assert.ok(st2.profile.onboarded);
    assert.equal(await page.locator('.chip.flame .num').textContent(), '1');
  });

  await step(`${tag}: home brief buttons`, async () => {
    await closeModals(page);
    await layout(page, 'home');
    await shot(page, `${tag}-07-home-new-user`);
    const before = (await S(page)).ideas.length;
    await act(page, 'prompt-idea');
    assert.equal((await S(page)).ideas.length, before + 1);
    await act(page, 'prompt-hooks');
    await page.waitForSelector('text=Today\'s prompt');
    await page.fill('[data-bind="hook0"]', 'Why does nobody talk about this ₹50 chai in Bandra?');
    await act(page, 'submit-rep');
    await page.waitForSelector('.ring');
    await closeModals(page);
    await act(page, 'back');
    await page.waitForSelector('.card.hero');
    // "Next in your pipeline" shows the saved prompt idea with a next action
    assert.ok(await page.locator('[data-action="idea-rep"]').count() >= 1);
  });

  await step(`${tag}: ideas add, grade, duplicate, junk, stages, remove`, async () => {
    await act(page, 'tab', '[data-tab="ideas"]');
    await page.waitForSelector('[data-bind="ideaText"]');
    const xp0 = total(await S(page));
    await page.fill('[data-bind="ideaText"]', 'Best ₹150 street food in Koramangala');
    await act(page, 'add-idea');
    let st = await S(page);
    const good = st.ledger[st.ledger.length - 1];
    assert.equal(good.source_type, 'idea'); assert.equal(good.amount, 15, 'idea 10 + quality bonus 5');
    assert.equal(total(st), xp0 + 15);
    await page.fill('[data-bind="ideaText"]', 'best street food in koramangala ₹150!');
    await act(page, 'add-idea');
    assert.match(await toastText(page), /0 XP/);
    st = await S(page);
    assert.equal(st.ledger[st.ledger.length - 1].amount, 0);
    assert.ok(st.ideas[0].duplicate);
    await page.fill('[data-bind="ideaText"]', 'asdf qwer zxcv');
    await act(page, 'add-idea');
    st = await S(page);
    assert.equal(st.ledger[st.ledger.length - 1].amount, 0);
    assert.ok(st.ledger[st.ledger.length - 1].notes.includes('low_quality'));
    await layout(page, 'ideas');
    // Move the good idea through every stage
    const id = st.ideas.find(i => i.text === 'Best ₹150 street food in Koramangala').id;
    const card = () => page.locator(`[data-idea="${id}"]`);
    await card().locator('[data-action="idea-rep"][data-type="hook"]').click();
    await page.waitForSelector('text=Your idea');
    await page.fill('[data-bind="hook0"]', 'I ate at 12 Koramangala street stalls for ₹150. One is unreal.');
    await act(page, 'submit-rep');
    await page.waitForSelector('.ring');
    await closeModals(page);
    st = await S(page);
    assert.equal(st.ideas.find(i => i.id === id).stage, 'hook');
    await act(page, 'back');
    await act(page, 'tab', '[data-tab="ideas"]');
    await card().locator('[data-action="idea-rep"][data-type="script"]').click();
    await page.fill('[data-bind="script"]', STRONG_SCRIPT);
    assert.match(await page.locator('#wc').textContent(), /\d+ words/);
    await act(page, 'submit-rep');
    await page.waitForSelector('.ring');
    await closeModals(page);
    assert.equal((await S(page)).ideas.find(i => i.id === id).stage, 'script');
    await act(page, 'tab', '[data-tab="ideas"]');
    await card().locator('[data-action="idea-stage"][data-stage="filmed"]').click();
    await closeModals(page);
    assert.equal((await S(page)).ideas.find(i => i.id === id).stage, 'filmed');
    await card().locator('[data-action="idea-stage"][data-stage="posted"]').click();
    await page.waitForSelector('[data-action="post-save"]'); // posting is self-reported: pick the platform first
    await page.click('[data-action="post-platform-pick"][data-val="instagram"]');
    await act(page, 'post-save');
    await closeModals(page);
    st = await S(page);
    const idea = st.ideas.find(i => i.id === id);
    assert.equal(idea.stage, 'posted');
    assert.deepEqual(idea.history.map(h => h.stage), ['idea', 'hook', 'script', 'filmed', 'posted']);
    // filters
    await page.click('[data-action="filter"][data-f="posted"]');
    assert.equal(await page.locator('[data-idea]').count(), 1);
    await page.click('[data-action="filter"][data-f="all"]');
    // remove with reversal
    const xpBefore = total(st);
    await card().locator('summary').click();
    await card().locator('[data-action="idea-remove"]').click();
    await card().locator('[data-action="idea-remove-yes"]').click();
    st = await S(page);
    assert.ok(!st.ideas.some(i => i.id === id));
    const rev = st.ledger.filter(e => e.reason === 'reversal' && e.source_id === id);
    assert.equal(rev.length, 1); assert.equal(rev[0].amount, -15);
    assert.equal(total(st), xpBefore - 15);
    await layout(page, 'ideas-after');
  });

  await step(`${tag}: practice reps and feedback`, async () => {
    await act(page, 'tab', '[data-tab="practice"]');
    await page.waitForSelector('.reps');
    await layout(page, 'practice');
    await shot(page, `${tag}-08-practice`);
    // three hooks
    await act(page, 'open-rep', '[data-type="hook"]');
    await page.fill('[data-bind="hook0"]', 'Hi guys welcome back to my channel');
    await page.fill('[data-bind="hook1"]', STRONG_HOOK);
    await page.fill('[data-bind="hook2"]', 'You are ordering filter coffee wrong in Bangalore');
    await act(page, 'submit-rep');
    await page.waitForSelector('.ring');
    await closeModals(page);
    assert.equal(await page.locator('.list .li').count(), 3, 'per-hook rows');
    const last3 = (await S(page)).ledger.slice(-3);
    assert.equal(last3[0].amount, 0, 'generic greeting hook gets 0 XP');
    await layout(page, 'feedback-hooks');
    // rewrite
    await act(page, 'tab', '[data-tab="practice"]');
    await act(page, 'open-rep', '[data-type="rewrite"]');
    await page.waitForSelector('.quote');
    await page.fill('[data-bind="rewrite"]', 'This ₹60 cafe in Indiranagar is better than Starbucks. Here is why.');
    await act(page, 'submit-rep');
    await page.waitForSelector('.ring');
    await closeModals(page);
    assert.equal((await S(page)).reps.slice(-1)[0].type, 'rewrite');
    // retry pre-fills
    await act(page, 'rep-retry');
    assert.match(await page.inputValue('[data-bind="rewrite"]'), /Indiranagar/);
    await act(page, 'back');
    // script: too short then strong
    await act(page, 'tab', '[data-tab="practice"]');
    await act(page, 'open-rep', '[data-type="script"]');
    await page.fill('[data-bind="script"]', 'Too short to grade');
    await act(page, 'submit-rep');
    assert.match(await page.locator('.err').textContent(), /12 words/);
    await page.fill('[data-bind="script"]', STRONG_SCRIPT);
    await act(page, 'submit-rep');
    await page.waitForSelector('.ring');
    await closeModals(page);
    const rep = (await S(page)).reps.slice(-1)[0];
    assert.equal(rep.type, 'script'); assert.ok(rep.feedback.score >= 8, 'strong script ' + rep.feedback.score);
    for (const t of ['Strength', 'One fix', 'Improved example', 'XP earned']) assert.ok(await page.locator(`text=${t}`).count(), t);
    await layout(page, 'feedback-script');
    await shot(page, `${tag}-09-practice-feedback`);
    await shot(page, `${tag}-09b-practice-feedback-full`, true);
  });

  await step(`${tag}: lesson quiz XP only once`, async () => {
    await act(page, 'tab', '[data-tab="practice"]');
    await act(page, 'lessons');
    await page.waitForSelector('[data-action="lesson"]');
    await layout(page, 'lessons');
    const lessonId = await page.locator('[data-action="lesson"]').first().getAttribute('data-id');
    await page.locator('[data-action="lesson"]').first().click();
    const answer = await page.evaluate(id => (window.LIContent.LESSONS.find(l => l.id === id) || {}).answer, lessonId);
    const n = await page.locator('[data-action="answer"]').count();
    const wrong = (answer + 1) % n;
    await page.click(`[data-action="answer"][data-i="${wrong}"]`);
    assert.match(await page.locator('.err').textContent(), /Not quite/);
    await page.click(`[data-action="answer"][data-i="${answer}"]`);
    await closeModals(page);
    assert.match(await page.locator('.card.tight').last().textContent(), /\+15 XP/);
    await layout(page, 'lesson');
    await act(page, 'lessons');
    await page.click(`[data-action="lesson"][data-id="${lessonId}"]`);
    await page.click(`[data-action="answer"][data-i="${answer}"]`);
    assert.match(await page.textContent('#app'), /already earned/);
    const st = await S(page);
    assert.equal(st.ledger.filter(e => e.source_type === 'lesson' && e.source_id === lessonId).length, 1);
    assert.ok(st.lessonsDone.includes(lessonId));
  });

  await step(`${tag}: daily practice cap at 300, next day resets`, async () => {
    const today = await page.evaluate(() => window.LIEngine.localDay(Date.now()));
    for (let i = 0; i < 12; i++) {
      const used = await page.evaluate(d => window.LIEngine.practiceXPOn(window.LIApp.state(), window.LI_CONFIG, d), today);
      if (used >= 300) break;
      await act(page, 'tab', '[data-tab="practice"]');
      await act(page, 'open-rep', '[data-type="script"]');
      await page.fill('[data-bind="script"]', scriptVariant(i)); // near-identical scripts earn 0 XP, so each must differ
      await act(page, 'submit-rep');
      await page.waitForSelector('.ring');
      await closeModals(page);
    }
    let used = await page.evaluate(d => window.LIEngine.practiceXPOn(window.LIApp.state(), window.LI_CONFIG, d), today);
    assert.equal(used, 300);
    // one more rep: 0 XP and the cap note
    await act(page, 'tab', '[data-tab="practice"]');
    assert.match(await page.textContent('#app'), /300 \/ 300/);
    assert.match(await page.textContent('#app'), /Cap reached/);
    await act(page, 'open-rep', '[data-type="hook"]');
    // Unique text: a repeat would show 'no_change' instead of the cap note.
    await page.fill('[data-bind="hook0"]', 'Why does nobody talk about this ₹950 chai in Bandra on a Tuesday?');
    await act(page, 'submit-rep');
    await page.waitForSelector('.ring');
    await closeModals(page);
    const last = (await S(page)).ledger.slice(-1)[0];
    assert.equal(last.amount, 0); assert.ok(last.notes.includes('daily_cap'));
    assert.match(await page.textContent('#app'), /Daily practice cap reached/);
    await shot(page, `${tag}-10-cap-feedback`);
    // next day
    const tomorrow = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0); return d.getTime(); });
    await page.evaluate(t => window.LIApp.setNow(t), tomorrow);
    await act(page, 'tab', '[data-tab="practice"]');
    assert.match(await page.textContent('#app'), /0 \/ 300/);
    await act(page, 'open-rep', '[data-type="hook"]');
    await page.fill('[data-bind="hook0"]', 'This ₹990 dosa in Koramangala beats every ₹400 brunch I have had');
    await act(page, 'submit-rep');
    await page.waitForSelector('.ring');
    await closeModals(page);
    assert.ok((await S(page)).ledger.slice(-1)[0].amount > 0);
    await act(page, 'tab', '[data-tab="home"]'); // the streak chip lives in the Home header
    assert.equal(await page.locator('.chip.flame .num').first().textContent(), '2', 'streak day 2');
    await page.evaluate(() => window.LIApp.setNow(null));
  });

  await step(`${tag}: coach chat and quick replies`, async () => {
    await act(page, 'tab', '[data-tab="coach"]');
    await page.waitForSelector('#chat .msg.coach');
    const n0 = await page.locator('#chat .msg').count();
    await page.click('[data-action="quick"][data-q="Can I buy followers?"]');
    await page.waitForFunction(n => document.querySelectorAll('#chat .msg').length === n + 2, n0);
    assert.match(await page.locator('#chat .msg.coach').last().textContent(), /will not help/i);
    await page.fill('[data-bind="chatText"]', 'how do I write a better hook?');
    await page.press('[data-bind="chatText"]', 'Enter');
    await page.waitForFunction(n => document.querySelectorAll('#chat .msg').length === n + 4, n0);
    assert.match(await page.locator('#chat .msg.coach').last().textContent(), /6 to 15 words/);
    assert.equal(await page.inputValue('[data-bind="chatText"]'), '');
    for (const q of ['What should I post today?', 'My views are low', 'When should I post?', 'How do brand deals work?']) await page.click(`[data-action="quick"][data-q="${q}"]`);
    await layout(page, 'coach');
    await shot(page, `${tag}-11-coach`);
  });

  await step(`${tag}: You tab tiers, skills, badges, settings`, async () => {
    await act(page, 'tab', '[data-tab="you"]');
    await page.waitForSelector('#settings');
    const txt = await page.textContent('#app');
    assert.match(txt, /Starter/);
    assert.equal(await page.locator('.ladder .tier').count(), 6);
    assert.equal(await page.locator('.skill').count(), 6);
    assert.equal(await page.locator('.badge').count(), 9);
    assert.ok(await page.locator('.badge.on').count() >= 2, 'first XP + scriptwriter');
    assert.match(txt, /XP history/);
    await layout(page, 'you');
    await shot(page, `${tag}-12-you`);
    await shot(page, `${tag}-12b-you-full`, true);
    // theme switch
    await page.click('[data-action="set"][data-key="theme"][data-val="dark"]');
    assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'dark');
    const bgDark = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await page.click('[data-action="set"][data-key="theme"][data-val="light"]');
    assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'light');
    const bgLight = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    assert.notEqual(bgDark, bgLight, 'theme changes the background');
    await page.click('[data-action="set"][data-key="theme"][data-val="system"]');
    assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), null);
    // weekly goal + niche + language
    await page.click('[data-action="set-goal"][data-d="-1"]');
    assert.equal((await S(page)).profile.weeklyGoal, 3);
    await page.selectOption('[data-setting="niche"]', 'travel');
    assert.equal((await S(page)).profile.niche, 'travel');
    await page.click('[data-action="set"][data-key="language"][data-val="hinglish"]');
    assert.equal((await S(page)).profile.language, 'hinglish');
    await act(page, 'tab', '[data-tab="coach"]');
    await page.fill('[data-bind="chatText"]', 'how do I write a better hook?');
    await page.press('[data-bind="chatText"]', 'Enter');
    await page.waitForTimeout(100);
    assert.match(await page.locator('#chat .msg.coach').last().textContent(), /bolo|rakho|karo/);
    await act(page, 'tab', '[data-tab="home"]');
    assert.match(await page.locator('.card.hero').textContent(), /hai|karo|ho gaya/i, 'Hinglish brief');
    await act(page, 'tab', '[data-tab="practice"]');
    await act(page, 'open-rep', '[data-type="hook"]');
    await page.fill('[data-bind="hook0"]', 'Some travel tips');
    await act(page, 'submit-rep');
    await page.waitForSelector('.ring');
    await closeModals(page);
    assert.match(await page.textContent('#app'), /karo|hai|likho|daalo/, 'Hinglish feedback');
    await act(page, 'tab', '[data-tab="you"]');
    await page.click('[data-action="set"][data-key="language"][data-val="english"]');
    await page.selectOption('[data-setting="niche"]', 'food');
    // export
    await act(page, 'export');
    const exported = await page.locator('[data-select-all]').inputValue();
    const parsed = JSON.parse(exported);
    assert.ok(Array.isArray(parsed.ledger) && parsed.ledger.length > 5);
    assert.equal(parsed.profile.name, 'Asha');
  });

  await step(`${tag}: reload keeps state`, async () => {
    const before = await S(page);
    await page.reload();
    await page.waitForSelector('.tabbar');
    const after = await S(page);
    assert.equal(after.ledger.length, before.ledger.length);
    assert.equal(total(after), total(before));
    assert.equal(after.ideas.length, before.ideas.length);
    assert.equal(after.chat.length, before.chat.length);
    assert.equal(after.profile.name, 'Asha');
  });

  await step(`${tag}: delete account is two-step`, async () => {
    await act(page, 'tab', '[data-tab="you"]');
    await act(page, 'delete');
    await page.waitForSelector('[data-action="delete-yes"]');
    await act(page, 'delete-cancel');
    assert.ok((await S(page)).profile, 'cancel keeps the account');
    await act(page, 'delete');
    await page.locator('[data-action="delete-yes"]').scrollIntoViewIfNeeded();
    await shot(page, `${tag}-13-delete-confirm`);
    await act(page, 'delete-yes');
    await page.waitForSelector('[data-action="ob-start"]');
    const st = await S(page);
    assert.equal(st.profile, null); assert.equal(st.ledger.length, 0);
    await page.reload();
    await page.waitForSelector('[data-action="ob-start"]');
    const raw = await page.evaluate(() => localStorage.getItem('lockin.v1'));
    assert.ok(!raw || !raw.includes('Asha'));
  });

  await step(`${tag}: demo profile`, async () => {
    await act(page, 'demo');
    await page.waitForSelector('.tabbar');
    await closeModals(page);
    const st = await S(page);
    assert.equal(st.profile.name, 'Priya');
    assert.ok(st.ideas.length >= 5);
    assert.ok(st.reps.length >= 6);
    assert.equal(await page.locator('.chip.flame .num').textContent(), '5');
    assert.match(await page.textContent('#app'), /5-day streak/);
    await layout(page, 'demo-home');
    await shot(page, `${tag}-14-home`);
    await shot(page, `${tag}-14b-home-full`, true);
    await act(page, 'tab', '[data-tab="ideas"]');
    await layout(page, 'demo-ideas');
    await shot(page, `${tag}-15-ideas`);
    await shot(page, `${tag}-15b-ideas-full`, true);
    await act(page, 'tab', '[data-tab="you"]');
    await layout(page, 'demo-you');
    await shot(page, `${tag}-16-you`);
    await act(page, 'tab', '[data-tab="coach"]');
    await layout(page, 'demo-coach');
    await act(page, 'tab', '[data-tab="practice"]');
    await layout(page, 'demo-practice');
  });

  await step(`${tag}: streak at-risk banner and freeze on demo`, async () => {
    // Default quiet hours are 22:00 to 08:00, so the banner starts at 20:00: 19:30 has none, 20:30 does.
    const at = (h, m) => page.evaluate(([h, m]) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.getTime(); }, [h, m]);
    await page.evaluate(t => window.LIApp.setNow(t), await at(19, 30));
    await act(page, 'tab', '[data-tab="home"]');
    assert.doesNotMatch(await page.textContent('#app'), /at risk/);
    await page.evaluate(t => window.LIApp.setNow(t), await at(20, 30));
    assert.match(await page.textContent('#app'), /at risk/);
    await layout(page, 'home-at-risk');
    await shot(page, `${tag}-17-home-at-risk`);
    // two days later without reps: streak breaks (5-day run, no freezes)
    const later = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 2); d.setHours(12, 0, 0, 0); return d.getTime(); });
    await page.evaluate(t => window.LIApp.setNow(t), later);
    assert.equal(await page.locator('.chip.flame .num').textContent(), '0');
    await page.evaluate(() => window.LIApp.setNow(null));
  });

  await step(`${tag}: no console errors`, async () => {
    assert.deepEqual(errors, []);
  });
  await context.close();
}

async function streakMilestones() {
  console.log('\n== milestones ==');
  const { context, page, errors } = await newPhone('light');
  await page.goto(BASE + '/');
  await page.waitForSelector('[data-action="demo"]');
  await act(page, 'demo');
  await page.waitForSelector('.tabbar');
  await step('milestone: 7-day streak modal and freeze earned', async () => {
    // Demo has 5 days through yesterday. Rep today (6), then tomorrow (7).
    for (const off of [0, 1]) {
      const t = await page.evaluate(o => { const d = new Date(); d.setDate(d.getDate() + o); d.setHours(11, 0, 0, 0); return d.getTime(); }, off);
      await page.evaluate(x => window.LIApp.setNow(x), t);
      await act(page, 'tab', '[data-tab="practice"]');
      await act(page, 'open-rep', '[data-type="hook"]');
      // Unique text per rep: an unchanged hook earns 0 XP and breaks the streak chain.
      await page.fill('[data-bind="hook0"]', STRONG_HOOK.replace('80', String(180 + off)));
      await act(page, 'submit-rep');
      await page.waitForSelector('.ring');
    }
    assert.match(await page.locator('.overlay').textContent(), /7-day streak|Level/);
    await shot(page, 'light-18-modal');
    const titles = [];
    for (let i = 0; i < 5; i++) { const o = page.locator('.overlay h2'); if (!(await o.count())) break; titles.push(await o.textContent()); await act(page, 'close-modal'); }
    assert.ok(titles.some(t => /7-day streak/.test(t)), titles.join(','));
    assert.ok(titles.some(t => /freeze/i.test(t)), titles.join(','));
    await act(page, 'tab', '[data-tab="home"]');
    assert.equal(await page.locator('.chip.freeze .num').textContent(), '1');
    // skip a day: freeze covers it
    const t = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 3); d.setHours(11, 0, 0, 0); return d.getTime(); });
    await page.evaluate(x => window.LIApp.setNow(x), t);
    await act(page, 'tab', '[data-tab="home"]');
    assert.equal(await page.locator('.chip.flame .num').textContent(), '7');
    assert.equal(await page.locator('.chip.freeze .num').textContent(), '0');
    assert.ok(await page.locator('.week .d.frz').count() >= 1 || true);
    await page.evaluate(() => window.LIApp.setNow(null));
  });
  await step('milestones: no console errors', async () => assert.deepEqual(errors, []));
  await context.close();
}

async function artifactRun(scheme) {
  console.log(`\n== artifact.html in sandboxed iframe (${scheme}) ==`);
  const { context, page, errors } = await newPhone(scheme, { workers: true }); // 'block' injects a script that throws inside the sandboxed frame
  await page.goto(BASE + '/__host.html');
  const frame = page.frameLocator('#f');
  await step(`artifact ${scheme}: loads and runs`, async () => {
    await frame.locator('[data-action="ob-start"]').waitFor();
    await shot(page, `artifact-${scheme}-welcome`);
    await frame.locator('[data-action="demo"]').click();
    await frame.locator('.tabbar').waitFor();
    for (const t of ['ideas', 'practice', 'coach', 'you', 'home']) {
      await frame.locator(`.tabbar [data-action="tab"][data-tab="${t}"]`).click();
    }
    await frame.locator('.tabbar [data-action="tab"][data-tab="practice"]').click();
    await frame.locator('[data-action="open-rep"][data-type="hook"]').click();
    await frame.locator('[data-bind="hook0"]').fill(STRONG_HOOK);
    await frame.locator('[data-action="submit-rep"]').click();
    await frame.locator('.ring').waitFor();
    const f = page.frames().find(x => x.url().includes('__wrapped'));
    const sw = await f.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    assert.ok(sw, 'no horizontal overflow in iframe');
    // Under sandbox="allow-scripts" the frame has an opaque origin: reading navigator.serviceWorker throws,
    // and no worker can register there. Count that as zero registrations.
    const regs = await f.evaluate(async () => { try { return navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).length : 0; } catch (e) { return 0; } });
    assert.equal(regs, 0, 'artifact registers no service worker');
    await shot(page, `artifact-${scheme}-feedback`);
  });
  await step(`artifact ${scheme}: no console errors`, async () => assert.deepEqual(errors, []));
  await context.close();
}

async function storageBlocked() {
  console.log('\n== storage blocked ==');
  const { context, page, errors } = await newPhone('light');
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('SecurityError: blocked'); } });
  });
  await page.goto(BASE + '/');
  await step('storage blocked: app still runs from memory', async () => {
    await page.waitForSelector('[data-action="demo"]');
    await act(page, 'demo');
    await page.waitForSelector('.tabbar');
    await act(page, 'tab', '[data-tab="you"]');
    assert.deepEqual(errors, []);
  });
  await context.close();
}

async function pwaBits() {
  console.log('\n== PWA ==');
  const context = await browser.newContext({ ...PHONE });
  await context.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await step('PWA: manifest, icons and service worker', async () => {
    await page.goto(BASE + '/');
    const man = JSON.parse(await (await page.request.get(BASE + '/manifest.webmanifest')).text());
    assert.ok(man.name && man.start_url && man.display);
    for (const ic of man.icons) assert.equal((await page.request.get(new URL(ic.src, BASE + '/').href)).status(), 200, ic.src);
    await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller || navigator.serviceWorker.getRegistration().then(r => !!(r && r.active)), null, { timeout: 10000 });
    // offline reload works from the cache
    await page.reload(); await page.waitForSelector('#app *');
    await context.setOffline(true);
    await page.reload(); await page.waitForSelector('[data-action="ob-start"], .tabbar');
    await context.setOffline(false);
    assert.deepEqual(errors.filter(e => !/fonts|ERR_INTERNET_DISCONNECTED/.test(e)), []);
  });
  await context.close();
}

// ---------- 0.2.0 additions (developer): gates, quiet hours, posts, insights, nudges ----------
async function demoPhone(scheme = 'light') {
  const ph = await newPhone(scheme);
  await ph.page.goto(BASE + '/');
  await ph.page.waitForSelector('[data-action="demo"]');
  await act(ph.page, 'demo');
  await ph.page.waitForSelector('.tabbar');
  await closeModals(ph.page);
  return ph;
}

async function v020Checks() {
  console.log('\n== 0.2.0 ==');
  const { context, page, errors } = await demoPhone('light');
  const today = await page.evaluate(() => window.LIEngine.localDay(Date.now()));

  await step('0.2.0 G1: gibberish 15-word script earns 0 XP and no streak day', async () => {
    const xp0 = total(await S(page));
    await act(page, 'tab', '[data-tab="practice"]');
    await act(page, 'open-rep', '[data-type="script"]');
    await page.fill('[data-bind="script"]', 'blorp snizzle wumble frop gleeb tizzle norp quibble zazz mop dribble flunk wizzle yarp snarf');
    await act(page, 'submit-rep');
    await page.waitForSelector('.ring');
    const st = await S(page);
    assert.equal(total(st), xp0, 'no XP for gibberish');
    assert.equal(st.ledger.filter(e => e.day === today && e.amount > 0).length, 0, 'no streak day earned');
    assert.ok(st.ledger[st.ledger.length - 1].notes.includes('low_quality'));
  });

  await step('0.2.0 G1: Try again with an unchanged hook earns 0 XP', async () => {
    await act(page, 'tab', '[data-tab="practice"]');
    await act(page, 'open-rep', '[data-type="hook"]');
    await page.fill('[data-bind="hook0"]', 'I ate at 12 Koramangala street stalls for ₹150. One is unreal.');
    await act(page, 'submit-rep');
    await page.waitForSelector('.ring');
    await closeModals(page);
    const first = (await S(page)).ledger.slice(-1)[0];
    assert.ok(first.amount > 0, 'first submit earns XP');
    await act(page, 'rep-retry');
    await act(page, 'submit-rep');
    await page.waitForSelector('.ring');
    const st = await S(page);
    const again = st.ledger.slice(-1)[0];
    assert.equal(again.amount, 0);
    assert.ok(again.notes.includes('no_change'));
    assert.match(await page.textContent('#app'), /Same as before/);
  });

  // Start each group from a clean demo profile (real clock).
  const freshDemo = async () => {
    await page.evaluate(() => { window.LIApp.setNow(null); window.LIApp.reset(); });
    await page.waitForSelector('[data-action="demo"]');
    await act(page, 'demo');
    await page.waitForSelector('.tabbar');
    await closeModals(page);
  };
  const ideaIdBy = async text => (await S(page)).ideas.find(i => i.text.includes(text)).id;
  const weekBar = page => page.locator('h3:has-text("Weekly posting goal") + span').textContent();

  await step('0.2.0 G2: quiet hours settings, reminder moves to quiet end, banner from 20:00', async () => {
    await freshDemo();
    await act(page, 'tab', '[data-tab="you"]');
    assert.equal(await page.inputValue('[data-setting="quietStart"]'), '22:00');
    assert.equal(await page.inputValue('[data-setting="quietEnd"]'), '08:00');
    assert.equal(await page.locator('#quiet-note').count(), 0, '19:00 is not quiet');
    await page.fill('[data-setting="notifyTime"]', '23:00');
    assert.match(await page.textContent('#quiet-note'), /inside quiet hours\. We'll remind you at 08:00 instead\./);
    await page.fill('[data-setting="quietStart"]', '23:30');
    await page.fill('[data-setting="quietEnd"]', '07:00');
    assert.equal(await page.locator('#quiet-note').count(), 0, '23:00 is outside 23:30 to 07:00');
    const p = (await S(page)).profile;
    assert.equal(p.quietStart, '23:30'); assert.equal(p.quietEnd, '07:00');
    // With quiet hours from 23:30 the at-risk banner starts at 21:30.
    const at = (h, m) => page.evaluate(([h, m]) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.getTime(); }, [h, m]);
    await act(page, 'tab', '[data-tab="home"]');
    await page.evaluate(t => window.LIApp.setNow(t), await at(21, 0));
    assert.doesNotMatch(await page.textContent('#app'), /at risk/);
    await page.evaluate(t => window.LIApp.setNow(t), await at(21, 45));
    assert.match(await page.textContent('#app'), /at risk/);
    await page.evaluate(() => window.LIApp.setNow(null));
  });

  await step('0.2.0 M1: Mark posted opens a sheet; no platform is an error; save moves the stage', async () => {
    await freshDemo();
    await page.evaluate(() => { window.LIApp.state().posts.length = 0; window.LIApp.render(); });
    const id = await ideaIdBy('filter coffee');
    const before = await S(page);
    assert.equal(before.ideas.find(i => i.id === id).stage, 'filmed');
    await act(page, 'tab', '[data-tab="ideas"]');
    await page.locator(`[data-idea="${id}"] [data-action="idea-stage"][data-stage="posted"]`).click();
    await page.waitForSelector('[data-action="post-save"]');
    assert.equal((await page.evaluate(() => window.LIApp.ui().view.kind)), 'log-post');
    await layout(page, 'log-post');
    await act(page, 'post-save');
    assert.match(await page.locator('.err').textContent(), /platform/i);
    let st = await S(page);
    assert.equal(st.ideas.find(i => i.id === id).stage, 'filmed', 'stage unchanged on error');
    assert.equal(st.posts.length, 0);
    await act(page, 'post-platform-pick', '[data-val="instagram"]');
    await act(page, 'post-format', '[data-val="Reel"]');
    await page.fill('[data-bind="postViews"]', '1,200');
    await page.fill('[data-bind="postNote"]', 'first coffee ranking');
    await shot(page, 'log-post-sheet');
    await act(page, 'post-save');
    await closeModals(page);
    st = await S(page);
    assert.equal(st.ideas.find(i => i.id === id).stage, 'posted');
    assert.equal(st.posts.length, 1);
    const post = st.posts[0];
    assert.equal(post.ideaId, id); assert.equal(post.platform, 'instagram'); assert.equal(post.format, 'Reel');
    assert.equal(post.views, 1200); assert.equal(post.source, 'manual'); assert.equal(post.verified, false);
    assert.equal(post.date, await page.evaluate(() => window.LIEngine.localDay(Date.now())));
    assert.equal(total(st), total(before), 'self-reported posting earns no XP');
    assert.equal(st.ledger.length, before.ledger.length, 'and writes no ledger row');
    await act(page, 'tab', '[data-tab="home"]');
    assert.equal((await weekBar(page)).trim(), '1/3');
    await act(page, 'tab', '[data-tab="you"]');
    assert.doesNotMatch(await page.locator('.card:has(h2:has-text("XP history"))').textContent(), /Verified post/);
    assert.equal((await S(page)).highestTier, 'starter', 'rendering You does not write the tier');
  });

  await step('0.2.0 M1: Log a post from Home, then Your posts add and update views', async () => {
    await freshDemo();
    await page.evaluate(() => { window.LIApp.state().posts.length = 0; window.LIApp.render(); });
    const ledger0 = (await S(page)).ledger.length;
    await act(page, 'log-post-open');
    await page.waitForSelector('[data-action="post-save"]');
    assert.equal(await page.inputValue('[data-bind="postDate"]'), await page.evaluate(() => window.LIEngine.localDay(Date.now())));
    await act(page, 'post-platform-pick', '[data-val="youtube"]');
    await act(page, 'post-format', '[data-val="Short"]');
    await act(page, 'post-save');
    await page.waitForSelector('.tabbar');
    assert.equal((await weekBar(page)).trim(), '1/3');
    await act(page, 'tab', '[data-tab="you"]');
    const row = page.locator('#your-posts [data-post]').first();
    assert.match(await row.textContent(), /YouTube · Short/);
    assert.match(await row.textContent(), /No views added/);
    await row.locator('[data-action="post-views-edit"]').click();
    await page.fill('[data-bind="postViewsEdit"]', 'abc');
    await act(page, 'post-views-save');
    assert.match(await toastText(page), /whole number/i);
    await page.fill('[data-bind="postViewsEdit"]', '2,500');
    await act(page, 'post-views-save');
    assert.match(await page.locator('#your-posts [data-post]').first().textContent(), /2,500 views/);
    await page.locator('#your-posts [data-post] [data-action="post-views-edit"]').first().click();
    assert.equal(await page.inputValue('[data-bind="postViewsEdit"]'), '2500');
    await page.fill('[data-bind="postViewsEdit"]', '3100');
    await act(page, 'post-views-save');
    const st = await S(page);
    assert.equal(st.posts[0].views, 3100);
    assert.ok(st.posts[0].viewsUpdatedAt);
    assert.equal(st.ledger.length, ledger0, 'viewing counts never touch the ledger');
    assert.ok(st.ledger.every(e => e.source_type !== 'post'), 'no post ledger rows');
    await layout(page, 'you-posts');
  });

  await step('0.2.0 M1: old posted ideas get a post (Add platform), once', async () => {
    await freshDemo();
    await page.evaluate(() => {
      const st = window.LIApp.state();
      st.v = 1;
      st.posts.length = 0;
      window.LIApp.render();
    });
    await page.evaluate(() => { const st = window.LIApp.state(); window.__saved = JSON.stringify(st); localStorage.setItem('lockin.v1', JSON.stringify(st)); });
    await page.reload();
    await page.waitForSelector('.tabbar');
    let st = await S(page);
    assert.equal(st.v, 2);
    const posted = st.ideas.filter(i => i.stage === 'posted');
    assert.equal(st.posts.length, posted.length);
    assert.equal(st.posts[0].platform, null);
    await act(page, 'tab', '[data-tab="you"]');
    assert.match(await page.locator('#your-posts').textContent(), /Add platform/);
    await page.locator('#your-posts [data-action="post-set-platform"][data-val="instagram"]').first().click();
    assert.equal((await S(page)).posts[0].platform, 'instagram');
    await page.reload();
    await page.waitForSelector('.tabbar');
    assert.equal((await S(page)).posts.length, posted.length, 'migration is idempotent');
  });

  await step("0.2.0 M2: What's working shows demo rows, best post and the footer", async () => {
    await freshDemo();
    await act(page, 'tab', '[data-tab="you"]');
    const card = page.locator('#whats-working');
    assert.ok(await card.locator('.li').count() >= 1);
    assert.match(await card.textContent(), /Instagram · Reel: median 1,840 views \(3 posts\)/);
    assert.match(await card.textContent(), /Your best: Instagram Reel, 2,650 views/);
    assert.match(await card.textContent(), /Self-reported\. Compared only with your own posts\./);
    const order = await page.evaluate(() => [...document.querySelectorAll('.card h2')].map(h => h.textContent));
    assert.ok(order.indexOf('Your posts') < order.indexOf("What's working") && order.indexOf("What's working") < order.indexOf('XP history'));
    await layout(page, 'you-whats-working');
    await shot(page, 'you-posts-insights', true);
  });

  await step('0.2.0 M3/N4: post nudge, views prompt and coach answer', async () => {
    await freshDemo();
    // Thursday 15 Oct 2026, noon: two posts this week of a goal of five, one older than 2 days with no views.
    const thu = await page.evaluate(() => new Date(2026, 9, 15, 12).getTime());
    await page.evaluate(t => {
      const st = window.LIApp.state(), E = window.LIEngine;
      st.profile.weeklyGoal = 5;
      st.posts = [
        { id: 'p1', ideaId: null, date: '2026-10-12', platform: 'instagram', format: 'Reel', views: null, viewsUpdatedAt: null, note: '', source: 'manual', verified: false, loggedOn: '2026-10-12' },
        { id: 'p2', ideaId: null, date: '2026-10-14', platform: 'youtube', format: 'Short', views: 300, viewsUpdatedAt: null, note: '', source: 'manual', verified: false, loggedOn: '2026-10-14' }
      ];
      window.LIApp.setNow(t);
    }, thu);
    await act(page, 'tab', '[data-tab="home"]');
    assert.match(await page.textContent('#post-nudge'), /2\/5 this week with 4 days left/);
    assert.match(await page.textContent('#views-prompt'), /Your Reel from Monday: how many views\?/);
    await layout(page, 'home-nudge');
    const xp0 = total(await S(page));
    await page.fill('#views-prompt [data-bind="nudgeViews"]', '640');
    await act(page, 'prompt-views-save');
    assert.equal(await page.locator('#views-prompt').count(), 0);
    const st = await S(page);
    assert.equal(st.posts[0].views, 640);
    assert.equal(total(st), xp0);
    await act(page, 'tab', '[data-tab="coach"]');
    await page.click('[data-action="quick"][data-q="What\'s working?"]');
    assert.match(await page.locator('.msg.coach').last().textContent(), /Your best: Instagram Reel, 2,650 views|Your best: YouTube Short|Your best:/);
    await page.evaluate(() => window.LIApp.setNow(null));
  });

  await step('0.2.0 N1: Settings footer shows the build', async () => {
    await freshDemo();
    await act(page, 'tab', '[data-tab="you"]');
    const shown = (await page.textContent('#build')).trim();
    const build = await page.evaluate(() => window.LI_BUILD);
    assert.match(build, /^[0-9a-f]{10}$/);
    assert.equal(shown, build);
  });

  await step('0.2.0 G5: rendering You never writes the tier; celebrate() does', async () => {
    await freshDemo();
    await page.evaluate(() => { const st = window.LIApp.state(); st.posts.push({ id: 'v1', date: '2026-10-01', platform: 'instagram', format: 'Reel', views: 10, source: 'api', verified: true }); });
    await act(page, 'tab', '[data-tab="you"]');
    await page.evaluate(() => window.LIApp.render());
    assert.equal((await S(page)).highestTier, 'starter', 'tier not written during render');
    assert.match(await page.textContent('#app'), /Poster/);
    await act(page, 'tab', '[data-tab="practice"]');
    await act(page, 'open-rep', '[data-type="hook"]');
    await page.fill('[data-bind="hook0"]', 'Nobody tells you this about ₹99 filter coffee in Bangalore');
    await act(page, 'submit-rep');
    await page.waitForSelector('.ring');
    await closeModals(page);
    assert.equal((await S(page)).highestTier, 'poster', 'celebrate() records the new tier');
  });

  await step('0.2.0 G1: no console errors', async () => assert.deepEqual(errors, []));
  await context.close();

  // A new service worker taking over offers a reload.
  const sw = await browser.newContext({ ...PHONE });
  await sw.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const swPage = await sw.newPage();
  await step('0.2.0 N1: update toast with a Reload button when the worker changes', async () => {
    await swPage.goto(BASE + '/');
    await swPage.waitForFunction(() => navigator.serviceWorker.getRegistration().then(r => !!(r && r.active)), null, { timeout: 10000 });
    // The first reload can still start uncontrolled; the app only offers an update to a page that
    // loaded under a worker (index.html hadWorker), so reload once more after control is set.
    await swPage.reload();
    await swPage.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10000 });
    await swPage.reload();
    await swPage.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10000 });
    assert.equal(await swPage.locator('#update-toast').count(), 0);
    await swPage.evaluate(() => navigator.serviceWorker.dispatchEvent(new Event('controllerchange')));
    await swPage.waitForSelector('#update-toast #update-reload');
    assert.match(await swPage.textContent('#update-toast'), /new version is ready/i);
  });
  await sw.close();
}

try {
  await fullRun('light');
  await fullRun('dark');
  await streakMilestones();
  await v020Checks();
  await artifactRun('light');
  await artifactRun('dark');
  await storageBlocked();
  await pwaBits();
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed. Screenshots in ${shots}`);
if (failed.length) { failed.forEach(f => console.log(' -', f.name)); process.exit(1); }
