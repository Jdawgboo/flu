import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Grader as G, Content, Engine as E, cfg } from './helpers.mjs';

const food = { niche: 'food', language: 'english' };

function assertHookShape(fb) {
  assert.equal(typeof fb.score, 'number');
  assert.ok(Number.isInteger(fb.score) && fb.score >= 0 && fb.score <= 10, 'score 0-10');
  assert.equal(fb.rubric_version, 'hook.v1');
  assert.deepEqual(Object.keys(fb.breakdown).sort(), ['brevity', 'curiosity', 'specificity', 'viewer_focus']);
  for (const v of Object.values(fb.breakdown)) assert.ok(v >= 0 && v <= 10);
  for (const k of ['strength', 'fix', 'example']) assert.ok(typeof fb[k] === 'string' && fb[k].length > 5, k);
}

describe('hook grader', () => {
  test('rubric JSON shape', () => {
    for (const t of ['This ₹80 dosa in Koramangala beats every ₹400 brunch I have had', 'asdf', '', 'Hi guys']) assertHookShape(G.gradeHook(t, food));
  });
  test('strong specific hook scores >= 7', () => {
    assert.ok(G.gradeHook('This ₹80 dosa in Koramangala beats every ₹400 brunch I have had', food).score >= 7);
    assert.ok(G.gradeHook('Why does nobody talk about this ₹50 chai in Bandra?', food).score >= 7);
  });
  test('generic greeting scores low and earns no XP', () => {
    for (const t of ['Hi guys welcome back to my channel', 'Hello everyone today I will show you my morning routine', 'Namaste doston aaj ka video']) {
      const fb = G.gradeHook(t, food);
      assert.ok(fb.score < cfg.anti_gaming.min_quality_score, `${t} -> ${fb.score}`);
      assert.match(fb.fix, /greeting/i);
    }
  });
  test('junk scores 0-2', () => {
    for (const t of ['asdf qwer zxcv', 'lol', 'food food food food food', '!!!! ???? ....', 'aaaaaaaaaa bbbb', '12345 67890 111']) {
      assert.ok(G.gradeHook(t, food).score <= 2, t);
      assert.ok(G.looksLikeJunk(t), t);
    }
  });
  test('real sentences are not junk', () => {
    for (const n of Object.values(Content.NICHES)) for (const h of n.strong) assert.ok(!G.looksLikeJunk(h), h);
    assert.ok(!G.looksLikeJunk('Yaar yeh ₹100 ki biryani Hyderabad mein sabse best hai'));
  });
  test('niche strong examples beat weak examples on average and mostly reach 6+', () => {
    let strong = [], weak = [];
    for (const [k, n] of Object.entries(Content.NICHES)) {
      strong.push(...n.strong.map(h => G.gradeHook(h, { niche: k }).score));
      weak.push(...n.weak.map(h => G.gradeHook(h, { niche: k }).score));
    }
    const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
    assert.ok(avg(strong) >= 6.5, `strong avg ${avg(strong)}`);
    assert.ok(avg(weak) <= 4.5, `weak avg ${avg(weak)}`);
    assert.ok(strong.every(s => s >= 6), 'every model hook is at least 6');
  });
  test('Hinglish profile returns Hinglish coaching', () => {
    const fb = G.gradeHook('This food was very nice', { niche: 'food', language: 'hinglish' });
    const en = G.gradeHook('This food was very nice', food);
    assert.notEqual(fb.fix, en.fix);
    assert.ok(G.isHinglish(fb.fix + ' ' + fb.strength) || /karo|hai|kya|mein|se /.test(fb.fix), fb.fix);
    const junk = G.gradeHook('asdf qwer zxcv', { niche: 'food', language: 'hinglish' });
    assert.match(junk.fix, /likho|sentence/);
  });
  test('isHinglish detects Hinglish input', () => {
    assert.ok(G.isHinglish('Yaar yeh biryani kya mast hai'));
    assert.ok(!G.isHinglish('This dosa beats every brunch'));
  });
  test('gradeHooks returns best, average and per-item scores', () => {
    const r = G.gradeHooks(['Hi guys welcome back', 'This ₹80 dosa in Koramangala beats every ₹400 brunch I have had', '  '], food);
    assert.equal(r.items.length, 2);
    assert.equal(r.best.text, 'This ₹80 dosa in Koramangala beats every ₹400 brunch I have had');
    assert.equal(r.rubric_version, 'hook.v1');
    assert.equal(G.gradeHooks(['', ' '], food), null);
  });
  test('deterministic', () => {
    const t = 'Stop ordering the butter chicken here. Get this instead.';
    assert.deepEqual(G.gradeHook(t, food), G.gradeHook(t, food));
  });
});

describe('script grader', () => {
  const strong = "Stop paying ₹400 for brunch in Koramangala. This ₹80 dosa beats all of them. Here's why: the batter is fermented for 12 hours, so it's crisp outside and soft inside. First, ask for the ghee roast. Then add the podi on the side. The chutney is free and refilled. That is why the queue starts at 7 am. Go before 9 or it sells out. Save this for your next Sunday breakfast and tag a friend who loves dosa.";
  test('shape', () => {
    const fb = G.gradeScript(strong, food);
    assert.equal(fb.rubric_version, 'script.v1');
    assert.deepEqual(Object.keys(fb.breakdown).sort(), ['cta', 'hook', 'pacing', 'payoff']);
    for (const k of ['strength', 'fix', 'example']) assert.equal(typeof fb[k], 'string');
    assert.ok(fb.score >= 0 && fb.score <= 10);
    assert.equal(typeof fb.wordCount, 'number');
  });
  test('hook + payoff + specific CTA at ~70-80 words scores high', () => {
    const fb = G.gradeScript(strong, food);
    assert.ok(fb.wordCount >= 60 && fb.wordCount <= 95, String(fb.wordCount));
    assert.ok(fb.score >= 8, JSON.stringify(fb.breakdown));
    assert.equal(fb.breakdown.cta, 9);
  });
  test('~70-word strong script in another niche scores >= 7', () => {
    const s = "You are wasting ₹2,000 a month on a gym you skip. I lost 8 kg doing this 12-minute hostel-room workout instead. Here's the plan. First, 20 squats. Then 15 push-ups, knees down is fine. Then a 40-second plank. Rest one minute and repeat three times. The trick is doing it before breakfast, every day, so it never gets skipped. Save this for tomorrow morning and send it to your gym-skipping roommate.";
    const fb = G.gradeScript(s, { niche: 'fitness' });
    assert.ok(fb.score >= 7, `${fb.score} ${JSON.stringify(fb.breakdown)}`);
  });
  test('generic short script scores low', () => {
    const fb = G.gradeScript('Hi guys welcome back to my channel. Today I will show you a cafe. The food was nice. The coffee was good. I liked it a lot. Please like share and subscribe.', food);
    assert.ok(fb.score <= 5, String(fb.score));
  });
  test('junk / too short scores 1', () => {
    assert.equal(G.gradeScript('Good food here try it', food).score, 1);
    assert.equal(G.gradeScript('asdf qwer zxcv asdf qwer zxcv asdf qwer zxcv asdf qwer zxcv', food).score, 1);
  });
  test('weak CTA gets the CTA example', () => {
    const s = "Stop paying ₹400 for brunch in Koramangala. This ₹80 dosa beats all of them. Here's why: the batter is fermented for 12 hours, so it's crisp outside and soft inside. First, ask for the ghee roast. Then add the podi on the side. The chutney is free and refilled. That is why the queue starts at 7 am. Go before 9 or it sells out. Honestly it is the best one.";
    const fb = G.gradeScript(s, food);
    assert.ok(fb.breakdown.cta <= 2);
    assert.match(fb.example, /save/i);
  });
  test('Hinglish', () => {
    const fb = G.gradeScript('Good food here try it', { niche: 'food', language: 'hinglish' });
    assert.match(fb.fix, /words|sentences/);
    assert.notEqual(fb.fix, G.gradeScript('Good food here try it', food).fix);
  });
});

describe('idea grader', () => {
  test('specific idea scores high, junk low, shape', () => {
    const good = G.gradeIdea('Best ₹150 street food in Koramangala', food);
    assert.ok(good.score >= 7);
    assert.equal(good.rubric_version, 'idea.v1');
    assert.equal(typeof good.strength, 'string'); assert.equal(typeof good.fix, 'string');
    assert.ok(G.gradeIdea('asdkjh aksjdh', food).score < cfg.anti_gaming.min_quality_score);
  });
  test('junk idea earns 0 XP end to end; duplicate earns 0', () => {
    const s = { ledger: [], ideas: [{ id: 'i1', text: 'Best ₹150 street food in Koramangala' }] };
    const junk = G.gradeIdea('asdf qwer zxcv', food);
    assert.equal(E.award(s, cfg, { source: 'idea', score: junk.score }).amount, 0);
    const text = 'best street food in Koramangala under ₹150';
    const dup = E.isDuplicateIdea(text, s.ideas, cfg);
    assert.ok(dup);
    assert.equal(E.award(s, cfg, { source: 'idea', score: G.gradeIdea(text, food).score, duplicate: dup }).amount, 0);
  });
});
