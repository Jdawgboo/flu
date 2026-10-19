import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { signState, verifyState, isAllowedReturn, encryptToken, decryptToken, corsHeaders, b64urlEncode } from '../src/index.js';

const ALLOWED = 'https://jash.github.io, http://localhost:8080/';
const KEY = b64urlEncode(new Uint8Array(32).fill(7));

describe('return origin validation', () => {
  test('accepts listed origins with any path', () => {
    assert.equal(isAllowedReturn('https://jash.github.io/flu/', ALLOWED), true);
    assert.equal(isAllowedReturn('http://localhost:8080/', ALLOWED), true);
  });
  test('rejects other hosts, ports, schemes, credentials and junk', () => {
    for (const u of ['https://evil.example/', 'https://jash.github.io.evil.example/', 'http://jash.github.io/', 'https://jash.github.io@evil.example/',
      'https://user:pw@jash.github.io/', 'http://localhost:9999/', 'javascript:alert(1)', '//jash.github.io', '', null, undefined]) {
      assert.equal(isAllowedReturn(u, ALLOWED), false, String(u));
    }
    assert.equal(isAllowedReturn('https://jash.github.io/', ''), false);
    assert.equal(isAllowedReturn('http://example.com/', 'http://example.com'), false, 'plain http only for localhost');
  });
});

describe('signed state', () => {
  test('round trips the return URL', async () => {
    const s = await signState('secret', 'https://jash.github.io/flu/');
    assert.equal(await verifyState('secret', s), 'https://jash.github.io/flu/');
  });
  test('rejects a wrong secret, tampering, expiry and malformed values', async () => {
    const s = await signState('secret', 'https://jash.github.io/flu/', 1000);
    assert.equal(await verifyState('other', s, 1000), null);
    const [body, sig] = s.split('.');
    const forged = Buffer.from(JSON.stringify({ r: 'https://evil.example/', n: 'x', e: 9e15 })).toString('base64url');
    assert.equal(await verifyState('secret', forged + '.' + sig, 1000), null);
    assert.equal(await verifyState('secret', body + '.' + sig.slice(0, -2) + 'AA', 1000), null);
    assert.equal(await verifyState('secret', s, 1000 + 10 * 60 * 1000 + 1), null, 'expired');
    assert.equal(await verifyState('secret', s, 1000 + 60 * 1000), 'https://jash.github.io/flu/');
    for (const bad of ['', 'abc', 'a.b.c', null, undefined, '.']) assert.equal(await verifyState('secret', bad), null, String(bad));
  });
  test('each state is unique', async () => {
    assert.notEqual(await signState('s', 'https://a/'), await signState('s', 'https://a/'));
  });
});

describe('token encryption', () => {
  test('round trips and does not reveal the token', async () => {
    const sealed = await encryptToken(KEY, 'IGQVJ-token');
    assert.ok(!sealed.includes('IGQVJ'));
    assert.equal(await decryptToken(KEY, sealed), 'IGQVJ-token');
    assert.notEqual(await encryptToken(KEY, 'IGQVJ-token'), sealed, 'random IV');
  });
  test('fails with the wrong key, tampering, or a short key', async () => {
    const sealed = await encryptToken(KEY, 'tok');
    await assert.rejects(decryptToken(b64urlEncode(new Uint8Array(32).fill(8)), sealed));
    await assert.rejects(decryptToken(KEY, sealed.slice(0, -3) + 'AAA'));
    await assert.rejects(encryptToken('c2hvcnQ', 'tok'));
  });
});

describe('CORS', () => {
  test('only listed origins are echoed back', () => {
    assert.equal(corsHeaders('https://jash.github.io', ALLOWED)['access-control-allow-origin'], 'https://jash.github.io');
    assert.equal(corsHeaders('https://evil.example', ALLOWED)['access-control-allow-origin'], undefined);
    assert.equal(corsHeaders(null, ALLOWED)['access-control-allow-origin'], undefined);
  });
});
