# Running the Opus / Sonnet / Haiku workflow in your terminal

LockIn is built by four subagents defined in `.claude/agents/`:

| Agent | Model | Job |
|---|---|---|
| `planner` | Opus | Reads the PRD and code, writes the plan. Never edits. |
| `developer` | Sonnet | Writes and fixes code, runs the tests after every change. |
| `tester` | Haiku | Runs unit and phone-sized browser tests, reports reproduced bugs. Edits only `tests/`. |
| `verifier` | Haiku | Re-checks each finding independently before anything gets fixed. |

The model per stage comes from each agent's `model:` line, so it holds whether you run one agent at a time or a whole workflow.

## One-time setup

```bash
git clone https://github.com/Jdawgboo/flu.git
cd flu
npm install          # js-yaml and Playwright
npx playwright install chromium   # only on your own machine, once
npm test && npm run build
npm run serve                     # serves dist/ on port 8080
```

Open http://localhost:8080 to use the app. To try it on your phone over the same Wi-Fi, open `http://<your laptop's IP>:8080`. Installing to the home screen needs HTTPS, so use the GitHub Pages link for that.

## Start Claude Code

```bash
claude --model opus
```

Opus runs the main session and does the planning. Check `/agents` lists planner, developer, tester and verifier.

To have Claude turn every substantive task into a workflow automatically, launch with `claude --model opus --effort ultracode` instead, or run `/effort ultracode` in a session (`/effort ultracode off` to stop). This uses noticeably more of your usage, so for one-off tasks just put the word `ultracode` in that prompt.

## Prompts to paste

**Audit everything (read-only):**

> ultracode: audit app/src/*.js, app/index.html and config/gamification.yaml against docs/PRD.md Phase 1 for bugs and edge cases (timezones, local-day streaks, freezes, daily XP cap, localStorage failures, phone layout, accessibility). Use the tester agent to find issues and the verifier agent to independently confirm each one. Report only confirmed findings; list the rest as unverified.

**Build a feature:**

> ultracode: implement <feature>. Have the planner agent plan it first and show me the plan. Then have the developer agent make the changes and add unit tests, the tester agent run `npm test && npm run build && node tests/e2e.mjs`, and the verifier agent confirm each bug the tester reports before the developer fixes it. Stop any fix loop after two rounds with no progress. Show me the diff and wait for my go before committing.

**Fix until green:**

> ultracode: run `npm test && node tests/e2e.mjs` and have the developer agent fix failures until everything passes or two rounds in a row make no progress. The tester agent re-runs after each round.

## Watch it live

- `/workflows` opens the progress view: each phase with its agent count. Use ↑/↓ to pick a phase, Enter to drill into an agent (its prompt, tool calls and result), `p` to pause, `x` to stop, `r` to restart an agent.
- The task panel under the input box shows a one-line progress summary while a run is going. Press ↓ then Enter to expand it.

## Save a workflow you like

In `/workflows`, select the run and press `s`. Choose `.claude/workflows/` to commit it to this repo (everyone who clones gets it) or `~/.claude/workflows/` for just you. It then runs as `/<name>`, for example `/lockin-audit`.

## Notes

- Workflows need a paid plan. On Pro, turn on Dynamic workflows in `/config`.
- Start on one file or one feature before a full sweep; the `/workflows` view shows token use per agent and you can stop a run any time.
- Reference: https://code.claude.com/docs/en/workflows
