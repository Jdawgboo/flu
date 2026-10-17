# Changelog

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
