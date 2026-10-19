import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Voice as V, Studio, Engine as E, Coach, cfg, appCfg, at } from './helpers.mjs';

const VC = appCfg.voice;
const profile = { name: 'Asha', niche: 'food', language: 'english' };
const TODAY = '2026-10-19';
function ctx(over = {}) {
  const st = { posts: [] }, now = at(TODAY);
  return { cfg, appCfg, profile, posts: [], today: TODAY, insights: E.postInsights(st, cfg, now), engagement: E.engagementInsights(st, cfg, now), ...over };
}
const say = (msg, max = VC.spoken_max_chars) => V.speakable(msg, { maxChars: max });
const NO_MARKUP = /[*_`#<>\[\]]|https?:|www\.|[\u{1F300}-\u{1FAFF}☀-➿]/u;

describe('voice config', () => {
  test('values exist and stop phrases cover English and Hinglish', () => {
    for (const k of ['idle_timeout_ms', 'max_turns', 'spoken_max_chars', 'speech_rate', 'restart_ms', 'speak_timeout_ms']) assert.ok(VC[k] > 0, k);
    assert.deepEqual(VC.stop_phrases, ['stop', 'bas', "that's all", 'band karo']);
  });
});

describe('clean and cap', () => {
  test('strips markdown, links, emoji and symbols', () => {
    const t = V.clean('## Big **bold** _idea_ 🎬 see [my page](https://x.com/a) and https://foo.bar/z, `code` → go\n- item one\n1. item two');
    assert.ok(!NO_MARKUP.test(t), t);
    assert.match(t, /Big bold idea/);
    assert.match(t, /my page/);
    assert.match(t, /item one item two/);
  });
  test('rupees are read as words', () => assert.equal(V.clean('a ₹80 dosa'), 'a 80 rupees dosa'));
  test('cap cuts at a sentence end, then a word, and never exceeds the limit', () => {
    const t = 'First sentence here. Second sentence is a bit longer than the first one. Third one.';
    assert.equal(V.cap(t, 80), 'First sentence here. Second sentence is a bit longer than the first one.');
    assert.equal(V.cap(t, 60), 'First sentence here. Second sentence is a bit longer than.');
    const long = V.cap('word '.repeat(100), 50);
    assert.ok(long.length <= 51 && /\.$/.test(long));
    assert.equal(V.cap('short', 50), 'short');
  });
});

describe('speakable per reply kind', () => {
  test('studio result: top angle, one question, the hook, within the cap', async () => {
    const r = await Studio.run('Why my Sunday dosa at the hostel canteen beats every cafe brunch', ctx());
    const t = say({ kind: 'studio', result: r }, 1000);
    assert.ok(t.includes(r.strategist.angles[0].label), t);
    assert.ok(t.includes('One question:') && t.includes(r.strategist.questions[0].replace(/[?]$/, '')));
    assert.ok(t.includes(V.clean(r.instagram.concepts[0].hook)), t);
    assert.ok(!NO_MARKUP.test(t), t);
    assert.ok(say({ kind: 'studio', result: r }).length <= VC.spoken_max_chars);
  });
  test('studio result in Hinglish speaks as hi', async () => {
    const r = await Studio.run('mera idea hai ki ghar ka khana review karun yaar', ctx({ profile: { ...profile, language: 'hinglish' } }));
    assert.equal(r.lang, 'hi');
    const t = say({ kind: 'studio', result: r });
    assert.match(t, /Ek sawaal:/);
    assert.equal(V.langOf({ result: r }, 'english'), 'hi');
  });
  test('a rethink verdict (cheat idea) speaks the refusal and the fix, not a hook', async () => {
    const r = await Studio.run('how to buy followers fast for my page', ctx());
    const t = say({ kind: 'studio', result: r });
    assert.match(t, /buying or faking/i);
    assert.ok(!/Best hook/.test(t));
  });
  test('group plan', () => {
    const t = say({ kind: 'group', plan: Studio.groupPlan('3 of us want to film something', profile, ctx()) });
    assert.match(t, /^Plan for 3 people, about \d+ minutes\./);
    assert.match(t, /First shot:/);
    assert.ok(t.length <= VC.spoken_max_chars);
  });
  test('stuck', () => {
    const u = Studio.unstick(profile, ctx());
    const t = say({ kind: 'stuck', stuck: u });
    assert.match(t, /^Start tiny\./);
    assert.ok(t.includes(V.clean(u.prompts[0]).replace(/[.!?]$/, '')));
    assert.match(t, /60 second hook rep/);
  });
  test('today pick (coach text) and a coach chat reply', () => {
    const tp = Studio.todayPick(profile, ctx());
    const t = say({ text: `Pinned at the top: post a ${tp.format} today. ${tp.reasons[0]}` });
    assert.ok(t.startsWith('Pinned at the top'));
    const chat = Coach.chat(profile, 'How do I write a better hook?', { insights: ctx().insights, cfg });
    const c = say({ text: chat });
    assert.ok(c.length > 0 && c.length <= VC.spoken_max_chars && !NO_MARKUP.test(c), c);
  });
  test('a long markdown reply is capped at a sentence', () => {
    const t = say({ text: '**One.** ' + 'This is a sentence with 🎬 emoji. '.repeat(30) }, 100);
    assert.ok(t.length <= 100 && /[.!?]$/.test(t) && !NO_MARKUP.test(t), t);
  });
  test('nothing to say', () => { assert.equal(say(null), ''); assert.equal(say({ text: '🎬🎬' }), ''); });
  test('langOf follows the profile for plain replies', () => {
    assert.equal(V.langOf({ text: 'hi' }, 'hinglish'), 'hi');
    assert.equal(V.langOf({ text: 'hi' }, 'english'), 'en');
  });
});

describe('stop phrases and decide', () => {
  test('stop phrases in English and Hinglish', () => {
    for (const t of ['stop', 'Stop.', 'bas', 'Bas!', "that's all", 'that is all', 'thats all', 'band karo', 'ok stop', 'please stop it', 'bas ab', 'Band karo ji', 'STOP!!'])
      assert.equal(V.isStopPhrase(t, VC.stop_phrases), true, t);
  });
  test('ideas that contain a stop word are not stops', () => {
    for (const t of ['stop scrolling hook idea for my reel', 'a reel about bus stop chai', 'bas ek idea hai mera reel ke liye', 'what is all this', '', 'hello'])
      assert.equal(V.isStopPhrase(t, VC.stop_phrases), false, t);
  });
  test('decide: empty is ignored, stop phrase stops, turn limit stops, else send', () => {
    assert.deepEqual(V.decide('  ', { turns: 0 }, VC), { action: 'ignore', reason: 'empty' });
    assert.equal(V.decide('stop', { turns: 0 }, VC).action, 'stop');
    assert.equal(V.decide('a reel about my chai stall', { turns: VC.max_turns - 1 }, VC).action, 'send');
    assert.deepEqual(V.decide('a reel about my chai stall', { turns: VC.max_turns }, VC), { action: 'stop', reason: 'max-turns' });
  });
});

describe('pickVoice', () => {
  const voices = [{ lang: 'en-US', name: 'a' }, { lang: 'hi_IN', name: 'b' }, { lang: 'en-IN', name: 'c' }, { lang: 'en-GB', name: 'd' }];
  test('exact locale first, then same language, else null', () => {
    assert.equal(V.pickVoice(voices, 'en-IN').name, 'c');
    assert.equal(V.pickVoice(voices, 'hi-IN').name, 'b');
    assert.equal(V.pickVoice(voices.filter(v => v.name !== 'c'), 'en-IN').name, 'a');
    assert.equal(V.pickVoice([{ lang: 'fr-FR' }], 'hi-IN'), null);
    assert.equal(V.pickVoice(undefined, 'en-IN'), null);
  });
});

describe('state migration v4', () => {
  test('voice replies default on, keep an explicit off, idempotent', () => {
    const s = {}; E.migrate(s);
    assert.deepEqual(s.voice, { replies: true });
    assert.equal(s.v, 4);
    s.voice.replies = false; E.migrate(s);
    assert.equal(s.voice.replies, false);
    const o = { voice: { replies: 'x' } }; E.migrate(o);
    assert.equal(o.voice.replies, true);
  });
});
