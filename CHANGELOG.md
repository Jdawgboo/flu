# Changelog

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
