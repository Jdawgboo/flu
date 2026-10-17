# LockIn (Project Flu)

Build from `docs/PRD.md` (source PDF: `docs/LockIn-PRD.pdf`). Rules from the PRD:

1. Read the whole PRD before writing code. Build only the current phase in "Build plan".
2. Anything marked [DECIDE] is Jash's call. Ask before implementing it; never guess.
3. All gamification numbers (XP values, caps, thresholds) live in `config/gamification.yaml`, never hard-coded.
4. Secrets go in `.env` only. Never commit tokens. Encrypt platform OAuth tokens at rest.
5. Every phase ends with: migrations applied, tests passing, seed data loaded, a short CHANGELOG entry.
6. If a platform API behaves differently from the PRD, stop and report it instead of working around it.

## Current state
Phase 1 (daily loop) as a mobile PWA in `app/`, no backend yet. `app/src/engine.js`, `grader.js` and `coach.js` are pure modules written so they can move into `services/api` unchanged.

- `npm install && npm test` runs unit tests; `node tests/e2e.mjs` runs the phone-sized browser tests.
- `npm run build` writes `dist/` (the deployable site) and `dist/artifact.html` (single-file copy).

## Workflow (model split)
- Plan with the `planner` agent (Opus), write code with `developer` (Sonnet), test with `tester` (Haiku), and confirm each finding with `verifier` (Haiku) before fixing it. Definitions are in `.claude/agents/`.
- Run `npm test && npm run build && node tests/e2e.mjs` after every edit. Stop fix loops after two rounds with no progress.
- Show a diff and wait for Jash's go before committing or pushing.
- How to run it from a terminal and watch it live: `WORKFLOW.md`.
