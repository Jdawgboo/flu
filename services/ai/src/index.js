/* LockIn AI service: a small Cloudflare Worker that runs the Idea Studio's agents on a model
 * provider, so the app never holds a provider key. Provider-agnostic: see src/providers/.
 *
 *   POST /v1/complete  { agent, system, input, schema? }  ->  { json }
 *
 * Errors are always JSON: { error, retry_after? } with 400 bad_request, 403 origin, 404 not_found,
 * 405 method, 413 too_large, 415 unsupported_media, 503 misconfigured (no KV), 429 rate_limit | quota, 500 not_configured, 502 upstream | bad_output,
 * 504 timeout. The app treats every error as "use the template fallback".
 * Bindings: LIMITS (KV). Secret: GEMINI_API_KEY (or the key of the chosen provider). Vars: see wrangler.toml.
 * No cookies are read or set, the key is never logged or returned, and nothing the user typed is logged. */
import { getProvider } from './providers/index.js';
import { composeSystem } from './prompts.js';

const CLIENT_HEADER = 'x-lockin-client';
const CLIENT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const MODEL_RE = /^[A-Za-z0-9._-]{1,80}$/;

const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
const list = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean);
const origins = v => list(v).map(s => s.replace(/\/+$/, ''));

export function corsHeaders(origin, allowed) {
  const h = { vary: 'Origin' };
  if (origin && origins(allowed).includes(origin)) {
    h['access-control-allow-origin'] = origin;
    h['access-control-allow-methods'] = 'POST, OPTIONS';
    h['access-control-allow-headers'] = 'content-type, ' + CLIENT_HEADER;
    h['access-control-max-age'] = '600';
  }
  return h;
}

function json(body, status, cors, extra) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors, ...extra } });
}
const fail = (error, status, cors, retryAfter) => json(retryAfter ? { error, retry_after: retryAfter } : { error }, status, cors, retryAfter ? { 'retry-after': String(retryAfter) } : undefined);

async function sha256Hex(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
}

/* Anonymous identity: a hash of the IP (never stored raw), which is ALWAYS limited, and the app's
 * self-chosen per-install id, which can only add a stricter bucket (rotating it gains nothing). */
export async function clientKeys(request) {
  const id = request.headers.get(CLIENT_HEADER);
  return {
    ip: 'ip' + await sha256Hex(request.headers.get('cf-connecting-ip') || 'unknown'),
    id: id && CLIENT_ID_RE.test(id) ? 'c' + id : null
  };
}

/* Fixed-window counters in KV. KV is not atomic, so concurrent calls can overshoot a little (a
 * Durable Object would make them exact); the global cap and the provider's own quota are the hard
 * stops. `keys` is { ip, id? }: the IP buckets always apply, the id buckets are stricter extras.
 * The global counter only moves for requests that passed every other bucket, and each IP is capped,
 * so one attacker cannot burn the whole global cap. Returns null when allowed (and counts the
 * call), else { error, retry_after }. */
export async function checkLimits(kv, keys, env, nowMs = Date.now()) {
  if (typeof keys === 'string') keys = { ip: keys };
  const L = { min: num(env.AI_PER_MINUTE, 12), day: num(env.AI_PER_DAY, 60), ipMin: num(env.AI_PER_IP_MINUTE, 20), ipDay: num(env.AI_PER_IP_DAY, 100), global: num(env.AI_GLOBAL_DAILY, 200) };
  const minute = Math.floor(nowMs / 60000), day = new Date(nowMs).toISOString().slice(0, 10);
  const toMinute = Math.max(1, 60 - Math.floor((nowMs % 60000) / 1000));
  const toDay = Math.max(1, Math.ceil((Date.parse(day + 'T00:00:00Z') + 86400000 - nowMs) / 1000));
  const slots = [
    { k: `m:${keys.ip}:${minute}`, max: L.ipMin, ttl: 120, err: 'rate_limit', wait: toMinute },
    { k: `d:${keys.ip}:${day}`, max: L.ipDay, ttl: 90000, err: 'rate_limit', wait: toDay }
  ];
  if (keys.id) slots.push(
    { k: `m:${keys.id}:${minute}`, max: L.min, ttl: 120, err: 'rate_limit', wait: toMinute },
    { k: `d:${keys.id}:${day}`, max: L.day, ttl: 90000, err: 'rate_limit', wait: toDay });
  slots.push({ k: `g:${day}`, max: L.global, ttl: 90000, err: 'quota', wait: toDay });
  const counts = [];
  for (const s of slots) {
    const n = parseInt(await kv.get(s.k), 10) || 0;
    if (n >= s.max) return { error: s.err, retry_after: s.wait };
    counts.push(n);
  }
  await Promise.all(slots.map((s, i) => kv.put(s.k, String(counts[i] + 1), { expirationTtl: s.ttl })));
  return null;
}

/* Returns { ok: true, value } or { ok: false, error, status }. */
export function validateBody(body, env) {
  const bad = (error = 'bad_request', status = 400) => ({ ok: false, error, status });
  if (!body || typeof body !== 'object' || Array.isArray(body)) return bad();
  const { agent, system, input, schema } = body;
  if (system !== undefined) return bad(); // instructions are owned by the Worker, never accepted from the client
  const agents = list(env.AI_AGENTS || 'strategist,instagram,thread,linkedin,board,critic');
  if (typeof agent !== 'string' || !agents.includes(agent)) return bad();
  if (input === undefined || input === null || typeof input !== 'object') return bad();
  if (JSON.stringify(input).length > num(env.AI_MAX_INPUT_CHARS, 12000)) return bad('too_large', 413);
  if (schema !== undefined && schema !== null) {
    if (typeof schema !== 'object' || Array.isArray(schema)) return bad();
    if (JSON.stringify(schema).length > num(env.AI_MAX_SCHEMA_CHARS, 8000)) return bad('too_large', 413);
  }
  return { ok: true, value: { agent, input, schema: schema || undefined } };
}

const STATUS = { quota: 429, timeout: 504, bad_output: 502, not_configured: 500, upstream: 502 };

async function complete(request, env, cors) {
  if (!/^application\/json\b/i.test(request.headers.get('content-type') || '')) return fail('unsupported_media', 415, cors);
  if (!env.LIMITS || typeof env.LIMITS.get !== 'function' || typeof env.LIMITS.put !== 'function') return fail('misconfigured', 503, cors);
  const maxBody = num(env.AI_MAX_INPUT_CHARS, 12000) + num(env.AI_MAX_SCHEMA_CHARS, 8000) + 2000;
  let text;
  try {
    let t;
    text = await Promise.race([request.text(), new Promise((_, rej) => { t = setTimeout(() => rej(new Error('body_timeout')), num(env.AI_BODY_TIMEOUT_MS, 5000)); })]).finally(() => clearTimeout(t));
  } catch (e) { return fail('timeout', 504, cors); }
  if (text.length > maxBody) return fail('too_large', 413, cors);
  let body;
  try { body = JSON.parse(text); } catch (e) { return fail('bad_request', 400, cors); }
  const v = validateBody(body, env);
  if (!v.ok) return fail(v.error, v.status, cors);

  const provider = getProvider(env.AI_PROVIDER);
  const model = String(env.AI_MODEL || '');
  if (!provider || !MODEL_RE.test(model)) return fail('not_configured', 500, cors);

  const limited = await checkLimits(env.LIMITS, await clientKeys(request), env);
  if (limited) return fail(limited.error, 429, cors, limited.retry_after);

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), num(env.AI_TIMEOUT_MS, 14000));
  const t0 = Date.now();
  let status = 200;
  try {
    const out = await provider.complete({ env, model, system: composeSystem(v.value.agent, v.value.input), input: v.value.input, schema: v.value.schema, signal: ctl.signal, fetch: globalThis.fetch.bind(globalThis) });
    return json({ json: out }, 200, cors);
  } catch (e) {
    const kind = e && e.kind && STATUS[e.kind] ? e.kind : 'upstream';
    status = STATUS[kind];
    return kind === 'quota' ? fail('quota', 429, cors, 60) : fail(kind, status, cors);
  } finally {
    clearTimeout(timer);
    // Metrics only: no input, system text, output or key ever goes into a log line.
    console.log(JSON.stringify({ evt: 'complete', provider: provider.name, agent: v.value.agent, status, ms: Date.now() - t0 }));
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('origin');
    const cors = corsHeaders(origin, env.ALLOWED_ORIGINS);
    if (!cors['access-control-allow-origin']) return fail('origin', 403, cors);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (url.pathname !== '/v1/complete') return fail('not_found', 404, cors);
    if (request.method !== 'POST') return fail('method', 405, cors);
    try { return await complete(request, env, cors); }
    catch (e) { return fail('upstream', 502, cors); }
  }
};
