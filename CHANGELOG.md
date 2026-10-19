# Changelog

## 0.4.0 — 2026-10-19 · Instagram AI manager: Home chat, Idea Studio, blackboard
Direction (approved by Jash): LockIn becomes an Instagram AI manager, a "centre for an influencer's brain" for solo creators and friend groups. You talk to it by voice or text like talking to yourself. All AI in this build is a deterministic mock (no network calls) behind an interface, so a real model can be swapped in later. See `docs/STUDIO.md`.

Defaults chosen for open decisions (change any of these and say so)
- The coach is still called Kavi. Languages are English and Hinglish only; voice typing uses `en-IN`.
- AI-written hooks, scripts, threads and boards earn 0 XP and are never logged as reps. Saving the user's own idea goes through the existing `addIdea` (normal idea XP after the grader gate).
- The X thread agent, the LinkedIn post agent and group shoot plans are included.

Home (tabs are now Home, Ideas, Practice, You; the Coach tab is gone)
- Top to bottom: streak-at-risk banner, a pinned today card (`todayPick`: format from your own median views, else imported Instagram engagement, else the default format; the gap since your last post against `insights.post_gap_nudge_days`; reasons always say they come from your self-reported or imported posts), the chat (the daily brief is the first coach line), quick chips, a large composer with a mic, then "Your week" (level, week strip, league, pipeline, blackboard, weekly goal, views prompt).
- `app/src/router.js` decides what a message does: cheat, stats, practice, today, stuck, group, idea (a non-question of `studio.min_idea_words` words or more), else the rule-based coach. A short message about a coach topic ("my views are low") stays a chat; a longer one is an idea.
- A typed or spoken idea gets six `.studio-card`s: strategist, Instagram (Reel and Carousel), X thread, LinkedIn post, board, critic. "Save idea" saves only your own words. "I'm stuck" gives three tiny prompts and a 60-second hook rep. "Plan a shoot with friends" gives roles, shots, a checklist and a time box; the group size is parsed from the text ("3 of us", "teen dost") and clamped by config.
- Voice: the mic is always on Home. Without SpeechRecognition (or on error) it shows "Voice typing isn't supported here. Tap the keyboard's mic or type." and focuses the box. Ideas and Home share one `startVoice(target)`.

Blackboard (Home, and "Open on blackboard" on the studio board card)
- A freeform notepad plus sticky cards (add, edit, move earlier or later, delete), stored in `state.board` (state v3; export and delete include it). Studio tiles become cards marked AI-written and earn nothing.
- Saving a note of 8+ words earns `xp.board.base` (8 XP) through the existing award path: capped with the other practice sources, gated for gibberish and near-copies of an earlier note, and limited to `xp.board.max_per_day` (3) paying notes a day. It counts as a streak day like other practice. Cards and AI output never earn XP.

Perks shelf (You)
- Five example perks, clearly labelled "Coming soon" with no real sponsors. `E.perks` computes locked or unlocked from level and tier in `config/gamification.yaml`.

Config
- `config/app.yaml` gains `ai_api_base` (empty = mock), `speech_lang`, `chat_history_max` (was a hard-coded 200), `studio` and `group`. The build copies every `app.yaml` key into `config.app`. Keys added beyond the plan: `studio.linkedin_posts`, `studio.unstick_prompts`, `studio.unstick_seconds`, `group.min_size`, `group.reel_seconds`.
- `config/gamification.yaml` gains `xp.board`, `board` in `capped_sources` and `gated_sources`, and `perks`.

Other
- The cheat regex moved to `Content.CHEAT_RE`, shared by the coach and the studio critic; `hash` and `pick` moved to content.js too (the studio may only require content.js and grader.js). The coach's greeting match now needs a word boundary, so "ruchi" is no longer a hello. `Coach.intentOf` is new.
- State is now v3 (adds `board`), `E.migrate` fills it in.

## 0.3.0 — 2026-10-19 · Connect Instagram, shorter onboarding
Onboarding (fewer questions)
- New flow: welcome → age + consent (one screen, under-18 still blocks) → Connect Instagram → confirm → first hook → home. Connecting skips sign-in, name, goal, niche and weekly screens. "Fill in manually instead" keeps the old screens (sign-in, name, goal, niche, weekly) minus the age and consent they used to hold.
- The confirm screen shows what was imported (name, @handle, followers, post count) and the guessed niche, language and weekly goal, each editable, plus the reminder time. Only age and niche are still required; the step dots follow the path you are on.
- Dropped the old "Connect your accounts, coming in Phase 2" screen.

Instagram import (`app/src/instagram.js`, pure)
- `inferProfile`: niche from keyword counts in bio and captions (ties, none or one stray hit give Other), Hinglish when 30%+ of captions read as Hinglish, weekly goal from posts in the last 28 days divided by 4 within the config min and max (suggested goal under 3 posts). `mediaToPosts`: Reel, Carousel and Post formats, local day of the timestamp, `source: 'instagram'`, always `verified: false`, no views.
- Imported posts feed the weekly goal bar, "Your posts" (likes and comments shown) and a new "Imported from Instagram" section in "What's working" (`engagementInsights`, median likes plus comments). No XP, streak days or tiers. `tier()` ignores imported followers until `state.instagram.verified` (never true in this build).
- Real mode when `ig_api_base` in the new `config/app.yaml` is set: redirect to the connect service, read and clear `#ig=`, fetch the profile; friendly errors for personal accounts (with the switch-to-creator steps), denied access and network failures. Empty means demo mode with a labelled sample creator (@priya.eats).
- You → Settings → Instagram: handle, followers, last synced, Refresh, two-step Disconnect that deletes imported data; or Connect from settings (profile and posts only). Export leaves out the connect session id.

Connect service (`services/ig-connect`, not deployed)
- Cloudflare Worker: `/auth/start`, `/auth/callback`, `/api/profile` (code or session), `/api/disconnect`. HMAC-signed state, return-origin allow list, CORS limited to it, tokens AES-GCM encrypted on top of KV, secrets only as Worker secrets. Tests cover signing, origin checks, encryption and the whole flow against a stubbed Instagram.
- `docs/INSTAGRAM.md`: what is auto-filled, Meta and Cloudflare setup by hand. YouTube is not covered.

## 0.2.0 — 2026-10-17 · Quality gates, quiet hours, self-reported posts
Gaming and fairness
- Scripts are gated like hooks and ideas: below the minimum quality score earns 0 XP, and scripts under `xp.script.min_words` earn 0 XP ("too short"). The gated sources are now `anti_gaming.gated_sources`.
- Re-submit farming closed: a hook, rewrite or script that is a near-copy (cosine above `duplicate_similarity`) of an earlier rep of the same type only earns XP if it scores higher than the best earlier one; otherwise 0 XP with a "Same as before" note. Identical hooks within one 3-hook set earn once. Reps that earned nothing for these reasons, and duplicate ideas, no longer train skills.
- Quiet hours and streak-at-risk now share one engine definition (`quietWindow`, `isQuiet`, `streakRiskStart`). Settings gets quiet-hours start and end inputs. The at-risk banner and notification start `streak_risk_hours_before_midnight` before quiet hours begin (20:00 with the defaults), and a reminder time inside quiet hours is sent at quiet end, with a note in Settings.
- Hard-coded numbers moved to `config/gamification.yaml`: tier thresholds (views, followers, goal weeks, average score and rep window), streak milestones, and the coach's "gentle" run length.
- Viewing the You tab no longer writes the highest tier; it is recorded when an action is celebrated.

Self-reported posts (earn no XP, streak days, league XP or tiers)
- "Mark posted" opens a sheet: platform (required), date, format, optional views and note. "Log a post" on Home logs one without an idea. The weekly goal counts logged posts.
- "Your posts" on You lists the 10 most recent with inline Add/Update views. Older saved data is migrated (state v2): each idea already marked posted gets a post with "Add platform".
- "What's working" on You: median views per platform and format over the last 28 days, plus your best post, only from your own posts.
- Coach: one post nudge under the weekly goal bar (gap since last post, behind pace, goal hit, or a standout format; English and Hinglish), and chat answers "views / what's working / stats / kya chal raha" from your numbers.
- Home asks for views on your oldest post that is 2+ days old and has none.
- Demo profile seeded with four logged posts.

App shell
- The build hash is written to `config.js` as `LI_BUILD` and shown in Settings; when a new version takes over the service worker, a "New version ready" toast offers a Reload.

Not included, by decision: platform-balance tips, a fully Hinglish interface, XP for self-reported posts.

## 0.1.0 — 2026-10-17 · Phase 1 prototype (daily loop)
- Installable mobile web app (PWA) with offline support.
- Onboarding: mock phone OTP / Google sign-in, consent notice, 18+ age gate, goal, niche, language (English or Hinglish), weekly posting goal, first graded hook exercise.
- Idea pipeline (idea → hook → script → filmed → posted) with duplicate detection and stage history.
- Text reps: hooks, hook rewrites, 30-second scripts, lessons; rule-based graders following `prompts/rubrics/*.v1.md`.
- Append-only XP ledger, daily practice cap, daily streak with freezes, levels, skills, tiers, badges, simulated weekly league, all driven by `config/gamification.yaml`.
- Coach "Kavi" (placeholder name): daily brief, rep reactions and chat in English and Hinglish.
- Local reminders and streak-at-risk notifications while the app is open.
- Demo profile seed data.

Not yet: real auth and server-side XP (Phase 0 backend), AI grading via the Claude API, server push, platform connect (Phase 2).
