import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Router, appCfg, Coach } from './helpers.mjs';

const r = text => Router.route(text, { appCfg });
const TABLE = {
  cheat: ['how do I buy followers', 'kya main followers kharid sakta hoon', 'f4f groups?'],
  stats: ["What's working?", 'show my stats', 'kya chal raha hai'],
  practice: ['I want to practise hooks', 'do a rep', 'rep karo'],
  today: ['What should I post today?', 'kya post karu', 'aaj kya banau', 'what to post'],
  stuck: ["I'm stuck", 'no ideas left', 'main atka hua hoon'],
  group: ['Plan a shoot with friends', 'teen dost ke saath reel banani hai', '3 of us want to film something', 'collab shoot with my squad'],
  idea: ['a reel about the best 80 rupee dosa near my hostel', 'chai stall tour in Pune at sunrise', 'mera idea hai ki ghar ka khana review karun'],
  coach: ['hi', 'How do I write a better hook?', 'My views are low', 'When should I post?', 'How do brand deals work?', 'thanks']
};

describe('router', () => {
  for (const [intent, list] of Object.entries(TABLE)) {
    test(`${intent}: English and Hinglish`, () => {
      for (const m of list) assert.equal(r(m).intent, intent, m);
    });
  }
  test('ordering: "what should I post" is today, not idea or coach', () => {
    assert.equal(r('what should I post').intent, 'today');
    assert.equal(r('What should I post today?').intent, 'today');
  });
  test('cheat beats everything, stats beats practice, today beats stuck and idea', () => {
    assert.equal(r('plan a shoot with friends to buy followers').intent, 'cheat');
    assert.equal(r("what's working in my practice").intent, 'stats');
    assert.equal(r("I'm stuck, what should I post today").intent, 'today');
    assert.equal(r('stuck on a reel idea with friends shoot').intent, 'stuck');
  });
  test('an idea needs min words and must not be a question', () => {
    assert.equal(r('two words').intent, 'coach');
    assert.equal(r('dosa reel hostel').intent, 'idea');
    assert.equal(r('why is dosa crispy at this stall').intent, 'coach');
    assert.equal(r('is this a good dosa reel idea?').intent, 'coach');
  });
  test('a short coach-topic message is chat, a long description is an idea', () => {
    assert.equal(r('my views are low').intent, 'coach');
    assert.equal(r('a reel about my camera setup in my tiny hostel room').intent, 'idea');
  });
  test('payloads', () => {
    assert.equal(r('rewrite practice').payload.type, 'rewrite');
    assert.equal(r('practice hooks').payload.type, 'hook');
    assert.equal(r('a reel about dosa at the hostel').payload.text, 'a reel about dosa at the hostel');
    assert.equal(Coach.intentOf('ruchi dosa tour'), null, '"hi" inside a word is not a greeting');
  });
});
