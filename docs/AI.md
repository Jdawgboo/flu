# Real AI for the Idea Studio (0.6.0)

The studio's six agents (strategist, Instagram, thread, LinkedIn, board, critic) can now run on a real model. Mock mode (the deterministic templates in `app/src/studio.js`) is still the default and the fallback: with `ai_api_base` empty the app makes no AI request at all.

## Architecture
```
app.js (STUDIO_LLM) -> llm.js -> POST /v1/complete -> services/ai Worker -> provider adapter -> Gemini
        studio.js validates every answer; any error, 429, timeout or invalid JSON -> mock for that agent
```
- `app/src/llm.js` (UMD, pure except an injected `fetch`) implements `llm.complete({ agent, system, input, schema })` but sends only `{ agent, input, schema }` (the `lang` rides inside `input`), plus a random per-install client id in the `ai.client_id_header` header. It times out after `studio.timeout_ms` and throws on every failure. After a 429 it stops calling until `retry_after` has passed (or `ai.default_retry_after_s`), never longer than `ai.max_retry_after_s`.
- System prompts live only in the Worker. `prompts/studio/*.md` are the source; `npm run gen:ai` (`scripts/gen-ai-prompts.mjs`) writes `services/ai/src/prompts.js` with the counts from `config/app.yaml` filled in. A unit test fails when the generated file is stale. The Worker adds the shared rules, the agent's role and, when `input.lang` is `hi`, the Hinglish rule. A request that includes `system` is rejected with 400. The `schema` still comes from the client (size-capped) because it is built from the same config counts and `studio.validate` checks every answer anyway.
- `services/ai` is the only place a provider key exists. See `services/ai/README.md` for routes, errors and vars.
- The user's text only travels in `input` (data); instructions are owned by the Worker. The prompts tell the model to treat `input` as data and ignore instructions inside it. `studio.validate` still gates every output, so a hijacked answer that breaks the shape is dropped.
- Cheat and gibberish ideas never reach the model (`studio.js`), and the critic prompt refuses fake-engagement ideas as a second line.
- AI output earns 0 XP and is never logged as a rep. Only the user's own words earn XP when they save an idea.
- Studio cards show "AI: live" when at least one agent answered from the model, else "AI: template fallback". A quota or rate-limit refusal adds a one-line notice. When AI is off (no base) no indicator is shown.

## Setup
1. Get a free key at https://aistudio.google.com/apikey. Never paste it into a file, chat or commit.
2. In `services/ai`:
   ```
   npx wrangler kv namespace create LIMITS     # copy the id into wrangler.toml (LIMITS binding)
   npx wrangler secret put GEMINI_API_KEY      # paste the key when asked
   npx wrangler deploy
   ```
3. In `services/ai/wrangler.toml` set `ALLOWED_ORIGINS = "https://jdawgboo.github.io"` (comma separated for more, no trailing slash; add `http://localhost:8080` while testing).
4. Check `AI_MODEL` (default `gemini-2.5-flash`) against the models listed in Google AI Studio and the rate limits shown there; model names change and free-tier limits differ per model. Then set `AI_GLOBAL_DAILY` below the daily request limit you see.
5. Put the deployed Worker URL (no trailing slash) in `config/app.yaml` as `ai_api_base`, then `npm run build` and deploy the site.

Limits: a hash of the caller's IP is always limited (`AI_PER_IP_MINUTE=20`, `AI_PER_IP_DAY=100`); the app's self-chosen client id only adds a stricter per-id bucket (`AI_PER_MINUTE=12`, `AI_PER_DAY=60`), so rotating the id gains nothing. The global counter (`AI_GLOBAL_DAILY=200`) only counts requests that passed every other bucket, and each IP is capped, so one attacker cannot use up the global cap alone (many IPs still can). Without the `LIMITS` KV binding the Worker answers 503 `misconfigured` instead of serving unlimited. KV counters are not atomic and can overshoot slightly; a Durable Object would make them exact. Other defaults (one idea is 6 calls, so roughly 2 ideas a minute, 10 a day per person, about 33 ideas a day for everyone), `AI_MAX_INPUT_CHARS=12000`, `AI_BODY_TIMEOUT_MS=5000`, `AI_TIMEOUT_MS=14000` (below the app's `studio.timeout_ms` of 15000).

## Privacy
On the free Gemini API tier, Google may use prompts and responses to improve its products, and humans may review them. Do not send anything private. Before launch, tell users that ideas typed into the studio are sent to Google when AI is on, or move to a paid tier or another provider where that is off. The Worker stores no prompts and logs no user text; the rate limiter stores only counters keyed by the random client id or a hash of the IP.

## Swap the provider
1. Add `services/ai/src/providers/<name>.js` exporting `{ name, complete({ env, model, system, input, schema, signal, fetch }) }` that returns parsed JSON and throws `ProviderError('quota' | 'timeout' | 'upstream' | 'bad_output' | 'not_configured')`.
2. Register it in `src/providers/index.js`.
3. Set `AI_PROVIDER` and `AI_MODEL` in `wrangler.toml` and put its key in a secret.
`openai.js` is an untested stub for any OpenAI-compatible chat completions API (`OPENAI_API_KEY`, optional `OPENAI_BASE_URL`).

## Costs and limits
Free tier only: when Google's quota runs out the Worker returns `429 quota`, the app shows the notice and keeps working on templates. Raise nothing without checking the quota page.
