# Idea Studio (0.4.0)

`app/src/studio.js` turns one idea into content for Instagram, X and LinkedIn, plus a strategy, a visual board and a critic's verdict. It is pure (no DOM, no network, needs only `content.js` and `grader.js`) and ships with a deterministic, template-based mock. `app/src/router.js` decides which messages reach it.

## Rules
- AI-written output (hooks, scripts, threads, posts, boards) earns 0 XP and is never logged as a rep.
- Only the user's own words earn XP: "Save idea" calls `addIdea`, so the normal idea XP and grader gate apply. Blackboard notes written by the user earn `xp.board` XP; cards and studio tiles earn nothing.
- Cheat ideas (buying or faking followers, views, likes; `Content.CHEAT_RE`, the same regex the coach uses) are refused: the critic returns `rethink`, nothing is sent to a model and no save button is offered.
- Languages: English and Hinglish. Hinglish is used when `profile.language` is `hinglish` or `Grader.isHinglish(idea)`.
- All counts and limits come from `config/app.yaml` (`studio`, `group`).

## API
- `run(idea, ctx, { llm }) -> Promise<Result>`
- `todayPick(profile, ctx) -> { format, platform, prompt, reasons[], gapDays, basis: 'views'|'engagement'|'niche' }`
- `unstick(profile, ctx) -> { prompts[3], action: { type: 'hook', seconds: 60, label } }`
- `groupPlan(text, profile, ctx) -> { people, roles[], concept, shots[{ who, shot, seconds }], minutes, checklist[] }`
- `validate(result, appCfg?) -> { ok, errors[] }` (with `appCfg`, counts are checked too)
- `AGENTS`: `strategist`, `instagram`, `thread`, `linkedin`, `board`, `critic`, each `(input, ctx) -> part`. The critic's input also carries the other parts.
- `ctx = { cfg, appCfg, profile, insights, engagement, posts, today }`: `cfg` is gamification.yaml, `appCfg` is app.yaml, `insights` and `engagement` come from `E.postInsights` and `E.engagementInsights`.

## Result (`studio.v1`)
```
{ version: "studio.v1", mode: "mock"|"llm", lang: "en"|"hi",
  idea: { text, niche },
  strategist: { angles: [{ id, label, why }], questions: [] },
  instagram: { concepts: [
    { format: "Reel", title, hook, shots: [{ n, seconds, shot, onscreen }], caption, cta },
    { format: "Carousel", title, hook, slides: [{ n, text }], caption, cta } ] },
  thread: { platform: "x", posts: [] },            // each post 280 characters or fewer
  linkedin: { platform: "linkedin", posts: [] },   // hook line, short paragraphs, closing question
  board: { tiles: [{ n, label, visual, text }] },
  critic: { verdict: "ship"|"tweak"|"rethink", risks: [], fix, hook_score },
  next: [{ action: "save-idea"|"idea-rep"|"open-rep", label }] }
```
`mode` is `llm` when at least one agent's answer came from the model.

## The `llm` interface
```
llm.complete({ agent, system, input, schema }) -> Promise<json>
```
Called once per agent (the critic last, with the other parts in `input.parts`). Every answer is validated against the agent's shape and the configured counts. An invalid answer, a rejection or no answer within `studio.timeout_ms` falls back to the mock for that agent only. Cheat or gibberish ideas never reach the model.

## Going live (not done in this build)
1. Add `services/ai`, a Cloudflare Worker like `services/ig-connect`, exposing `POST /complete` with the `llm.complete` contract.
2. Keep the Anthropic API key as a Worker secret (`wrangler secret put`), never in the repo, `.env` committed files or the client.
3. Enforce a per-user AI budget in the Worker (requests and tokens per user per day, with a hard monthly ceiling); return a friendly error so the app falls back to the mock.
4. Rate-limit per user, log token use without the idea text, and decide retention before storing any prompts.
5. Set `ai_api_base` in `config/app.yaml` and build a small fetch-backed `llm` in `app.js` (today `STUDIO_LLM` is `null`).
6. Review the system prompts in `studio.js` and the refusal rules with Jash before launch.

## Blackboard and perks
- `state.board = { text, cards: [{ id, text, ai }], saves: [{ id, text, at, xp }] }`. A save of the notepad text awards `xp.board` through `E.award` (min words, near-copy and gibberish gate, `max_per_day`, shared daily cap).
- `E.perks(state, cfg)` returns `[{ id, name, desc, unlock, unlocked }]` from `perks` in `config/gamification.yaml`; a perk needs every condition it lists (`level`, `tier`).
