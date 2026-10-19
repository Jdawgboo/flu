/* Studio LLM client: implements the `llm.complete({ agent, system, input, schema })` interface that
 * studio.js expects, on top of a deployed services/ai Worker (config app.ai_api_base). Pure except
 * for the injected `fetch` (and `now`), so it can move into services/api unchanged.
 *
 * Every failure (network, timeout, HTTP error, 429, a reply that is not a JSON object) throws an
 * Error with `.code` ('quota' | 'timeout' | 'network' | 'http' | 'invalid'); studio.js catches it
 * and uses the mock for that agent. After a 429 the client stops calling until `retry_after` has
 * passed, so one busy minute does not fire five more doomed requests. No key lives here: the
 * Worker holds it. The client sends only { agent, input, schema }: the Worker owns the system prompts
 * (services/ai/src/prompts.js), so a user can never change the instructions. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LILlm = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const fail = (code, extra) => Object.assign(new Error(code), { code }, extra);

  /* A random per-install id for the Worker's rate limiter. Anonymous: it is not tied to a person. */
  function newClientId(cryptoObj) {
    const c = cryptoObj || (typeof crypto !== 'undefined' ? crypto : null);
    const bytes = new Uint8Array(18);
    if (c && c.getRandomValues) c.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    return Array.from(bytes, b => b.toString(36).padStart(2, '0')).join('').slice(0, 32);
  }

  /* opts: base, fetch, clientId (string or function), header, timeoutMs, defaultRetryAfterS, maxRetryAfterS, now, onError(err). */
  function create(opts) {
    const o = opts || {};
    const base = String(o.base || '').replace(/\/+$/, '');
    const nowMs = o.now || Date.now;
    let blockedUntil = 0;

    async function complete(req) {
      if (!base) throw fail('network');
      const f = o.fetch || (typeof fetch === 'function' ? fetch : null);
      if (!f) throw fail('network');
      const id = typeof o.clientId === 'function' ? o.clientId() : o.clientId;
      const headers = { 'content-type': 'application/json' };
      if (id && o.header) headers[o.header] = id;
      const body = JSON.stringify({ agent: req.agent, input: req.input, schema: req.schema });
      const ctl = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = ctl && o.timeoutMs ? setTimeout(() => ctl.abort(), o.timeoutMs) : null;
      try {
        if (nowMs() < blockedUntil) throw fail('quota', { retryAfter: Math.ceil((blockedUntil - nowMs()) / 1000) });
        let res;
        try { res = await f(base + '/v1/complete', { method: 'POST', headers, body, credentials: 'omit', signal: ctl ? ctl.signal : undefined }); }
        catch (e) { throw fail(e && e.name === 'AbortError' ? 'timeout' : 'network'); }
        if (res.status === 429) {
          let ra = 0;
          try { ra = Number((await res.json()).retry_after) || 0; } catch (e) { ra = 0; }
          ra = ra > 0 ? ra : (o.defaultRetryAfterS || 60);
          if (o.maxRetryAfterS > 0) ra = Math.min(ra, o.maxRetryAfterS); // never trust the server to block us for a day
          blockedUntil = nowMs() + ra * 1000;
          throw fail('quota', { retryAfter: ra });
        }
        if (!res.ok) throw fail('http', { status: res.status });
        let data;
        try { data = await res.json(); } catch (e) { throw fail('invalid'); }
        const out = data && data.json;
        if (!out || typeof out !== 'object' || Array.isArray(out)) throw fail('invalid');
        return out;
      } catch (e) {
        if (o.onError) try { o.onError(e); } catch (x) { /* ignore */ }
        throw e;
      } finally { if (timer) clearTimeout(timer); }
    }
    return { complete };
  }

  return { create, newClientId };
});
