# Idea Studio (0.4.0, live AI since 0.6.0)

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
`mode` is `llm` when at least one agent's answer came from the model. The cards show "AI: live" or "AI: template fallback" from it, and a notice when the AI service refused for quota.

## The `llm` interface
```
llm.complete({ agent, system, input, schema }) -> Promise<json>
```
Called once per agent (the critic last, with the other parts in `input.parts`). Every answer is validated against the agent's shape and the configured counts. An invalid answer, a rejection or no answer within `studio.timeout_ms` falls back to the mock for that agent only. Cheat or gibberish ideas never reach the model.

## Going live (0.6.0)
Done: `services/ai` (a Cloudflare Worker, Gemini by default, swappable provider) exposes `POST /v1/complete` with the `llm.complete` contract, and `app/src/llm.js` is the fetch-backed client wired into `app.js` when `ai_api_base` in `config/app.yaml` is set. The provider key is a Worker secret, never in the repo or the client. The Worker enforces per-user and global daily limits and logs no user text. System prompts live in `prompts/studio/*.md`. Setup, privacy caveats and provider swapping are in `docs/AI.md`.

Still open: review the prompts and refusal rules with Jash before launch, decide retention (none is stored today), and add a paid-tier or other provider if the free-tier privacy terms are not acceptable.

## Blackboard and perks
- `state.board = { text, cards: [{ id, text, ai }], saves: [{ id, text, at, xp }] }`. A save of the notepad text awards `xp.board` through `E.award` (min words, near-copy and gibberish gate, `max_per_day`, shared daily cap).
- `E.perks(state, cfg)` returns `[{ id, name, desc, unlock, unlocked }]` from `perks` in `config/gamification.yaml`; a perk needs every condition it lists (`level`, `tier`).

## Voice mode (0.5.0)
Home has a big mic button that starts a hands-free voice session: listen, send the final transcript through `router.js` and the studio, speak a short summary, listen again. Settings live in `config/app.yaml` under `voice`.

- `app/src/voice.js` (pure): `speakable(msg, { maxChars })` makes speech from a chat message (studio result: top angle, one question, the reel hook; stuck; group plan; coach text), `isStopPhrase`, `decide` (stop, turn limit, empty, send), `pickVoice`, `langOf`.
- The session itself (SpeechRecognition with interim results, speechSynthesis, timers) lives in `app.js`. The mic is closed while speaking; tapping the mic interrupts speech; hiding the app ends the session. Replies are only spoken during a session, and the "Voice replies" toggle (`state.voice.replies`) turns speech off.
- Limits: HTTPS and a browser with SpeechRecognition (Chrome and Android best, iOS Safari and PWAs limited). No wake word: a web app cannot listen in the background, so "Hey Flu" needs a native app later.
