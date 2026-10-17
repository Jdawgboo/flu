# LockIn — Technical PRD (v0.1, Oct 18 2026)

> Plain-text export of [LockIn-PRD.pdf](LockIn-PRD.pdf). Tables lost their layout in the export; the PDF is the source of truth.

```text
Oct 18, 2026

· ​@jash · v0.1 · "LockIn" is a working name

How to use this PRD with Claude
Build one phase at a time from section "Build plan", and stop at each phase gate for Jash
to test on a real phone before moving on.
Paste this into your coding agent at the start of the project:
You are building LockIn from docs/PRD.md. Rules:
1. Read the whole PRD before writing code. Build only the current phase in
"Build plan".
2. Anything marked [DECIDE] is Jash's call. Ask him before implementing it;
never guess.
3. All gamification numbers (XP values, caps, thresholds) live in one config
file, never hard-coded.
4. Secrets go in .env only. Never commit tokens. Encrypt platform OAuth
tokens at rest.
5. Every phase ends with: migrations applied, tests passing, seed data
loaded, a short CHANGELOG entry.
6. If a platform API behaves differently from this PRD, stop and report it
instead of working around it.

Save this doc into the repo as docs/PRD.md (export it as Markdown) and point to it from
CLAUDE.md .

Product overview
LockIn is the app that takes someone from "I'm going to be a creator" to their first paid
brand deal, by making consistency a game.
Who it's for: Indians starting out on Instagram or YouTube, from zero to roughly 10K
followers. Not established influencers.
The problem: Most new creators quit within weeks. Posting is a big effort, results depend
on an algorithm, and early numbers feel like rejection.
The core idea: Reward effort daily, celebrate results when they come, and make paid
brand gigs the end reward.

Daily layer (effort, always in the user's control): ideas, hooks, scripts, practice clips,
posting on schedule. Earns XP, streaks and league rank.
Results layer (from real platform data): view milestones, follower milestones, personal
bests. Earns creator tiers that only go up.
Reward layer (Phase 5): at a set tier, creators unlock paid UGC gigs from Indian brands,
a SideShift-style marketplace.
What we borrow from SideShift for the marketplace: a brand pastes its website and AI
drafts the brief and pay structure; creators apply; per-creator cost-per-view tracking;
best organic posts reused as ads; one-click payouts; an MCP server so brands can run
campaigns from an AI assistant.
North-star metric: Weekly Consistent Creators, the number of users who hit their own
weekly posting goal.
Supporting metrics:
Metric

What it tells us

D1 / D7 / D30 retention

Whether the daily loop works

Share of active users on a 7+ day streak

Habit formation

Median days from signup to first verified
post

Onboarding friction

Ideas that reach "posted" (%)

Whether daily practice turns into real posts

Users reaching Gig-ready tier (%)

Whether the coaching actually makes creators
better

Targets get set after the first 4 weeks of beta data.

Key decisions and assumptions
These defaults let the build start now. Items marked [DECIDE] need Jash's confirmation
before the phase that uses them.

Area

Default

Why

Status

Platforms at
launch

Instagram and
YouTube, behind one
connector interface

Jash wants both; the
gamification doesn't
care which platform a
post is on

[DECIDE] Instagramonly MVP would ship
faster

Client

Mobile app first
(Android + iOS) via
Expo / React Native;
web later

Streaks need push
notifications; most
target users in India are
Android-first

Assumed

Backend

FastAPI (Python) +
Postgres on Supabase
+ Redis job queue

Python suits the AI and
video pipelines;
Supabase gives auth,
storage and Postgres in
one place

Assumed

AI models

Claude API for
coaching and grading; a
speech-to-text model
for transcripts; ffmpeg
for video frames

Model-agnostic
pipeline: frames +
transcript work with any
LLM

Assumed

Languages

English and Hinglish at
launch; Hindi and
regional languages
later

Most Indian beginners
script and caption in
Hinglish

[DECIDE]

Age

18+ only at launch

Under-18 users need
verifiable parental
consent under India's
data law (see Trust and
compliance)

[DECIDE]

Pricing

Free for creators
during MVP

Goal is adoption; brands
pay once the
marketplace launches in
Phase 5

Assumed

Name

LockIn (working name)

From Jash's "lock in"
framing

[DECIDE]

Core user journeys
The product is four loops: onboard once, practise daily, post weekly, tier up over months.
1. Onboarding (target: under 3 minutes to first XP)
1. Sign up with phone OTP or Google. Confirm age 18+.
2. Pick a goal ("start posting", "grow my page", "earn from content"), a niche (fitness, tech,
food, fashion, comedy, education, finance, travel, other) and a language (English or
Hinglish).
3. Set a weekly posting goal (1 to 7 posts per week; the app suggests 3).
4. Do a first 60-second exercise: write 3 hooks for your niche. The AI grades them. User
earns first XP and day 1 of the streak.
5. Optional, can be skipped: connect Instagram (needs a free creator or business
account) or YouTube. The app explains how to switch an Instagram account to creator.
2. Daily loop (the Duolingo lesson, about 5 minutes)
1. Push notification from the coach at the user's chosen time.
2. Home screen shows the daily brief: today's prompt, streak, league rank, the next idea
in the pipeline.
3. User does at least one rep: capture an idea, write hooks, draft a script, or record a
practice clip.
4. The AI coach responds with a score, one specific fix, and a short reaction in the coach's
voice.
5. XP, skill progress and streak update with an animation.
3. Posting loop (weekly)
1. User moves an idea through the pipeline: idea → hook → script → filmed → posted.
2. Optional pre-post review: upload the edited video and get feedback before posting.
3. User posts on Instagram or YouTube natively (the app does not publish for them in
MVP).
4. The app detects the new post through the connected account, links it to the idea and
awards posting XP.
5. 48 hours later: a results card with views, likes, saves and a comparison to the user's
own average, plus a reflection prompt ("what would you change?") that earns XP.
4. Tier-up loop (months)

1. Results sync daily. When a post crosses a milestone or beats a personal best, a
celebration screen appears.
2. Creator tier is recalculated. Tiers only go up.
3. Reaching Gig-ready unlocks the marketplace in Phase 5, where brand campaigns
appear as paid quests.

Gamification system
XP rewards effort and quality; tiers reward real results; nothing ever punishes a user for
low views. All numbers below are starting values in config/gamification.yaml , tuned
from beta data.
XP rules
Action

Base
XP

Quality bonus

Verified how

Capture an idea

10

+5 if AI score ≥
7/10

Must not duplicate a past idea
(embedding similarity)

Write a hook (graded)

10

+10 if AI score ≥
7/10

AI rubric

Finish a script

25

+10 if AI score ≥
7/10

AI rubric

Record a practice clip

30

+10 if AI score ≥
7/10

Clip uploaded and analysed

Pre-post video review

30

none

Video uploaded and analysed

Verified post on
Instagram or YouTube

100

+50 if it hits the
weekly goal

Detected through platform API,
published after connection

48-hour reflection

20

none

Minimum 15 words

Lesson or challenge
completed

15

none

In-app

Daily cap from practice actions: 300 XP. Posting and reflection XP are not capped.
Streaks

Daily streak: extends when the user completes at least one rep that earns XP in their
local day.
Weekly goal streak: extends when the user hits their own weekly posting goal. This is
the north-star behaviour and gets the biggest celebrations.
Streak freeze: earned 1 per 7-day streak, hold at most 2, used automatically on a
missed day.
Streak loss is shown gently ("start a new run"), never with guilt language after a 30+
day streak.
Skill tree: six skills, five levels each. Each AI-graded action adds skill XP to the skills it
trains.
Skill

Trained by

Hooks

Hook exercises, first 3 seconds of practice clips

Retention and pacing

Script structure, video review, platform retention
data where available

On-camera confidence

Practice clips (delivery, energy, eye contact)

Editing

Pre-post video reviews (cuts, captions, pacing)

Storytelling

Scripts and ideas

Niche and consistency

Weekly goal streaks, posting in the chosen niche

Leagues (weekly, effort-only)
Cohorts of about 30 users at a similar creator tier, matched by signup week where
possible.
Ranked on weekly XP. Top 7 promote, bottom 5 demote, the rest stay.
Ladder: Bronze, Silver, Gold, Platinum, Diamond.
Never rank by followers or views. A zero-follower creator must be able to win.
Creator tiers (results-based, only go up)
Tier

Unlocked when

Starter

Account created

Poster

First verified post

Tier

Unlocked when

Consistent

Hit the weekly goal 4 weeks in a row

Rising

One post with 1,000+ views, or 100+ followers

Breakout

One post with 10,000+ views, or 1,000+ followers

Gig-ready

Breakout + Consistent + average AI quality ≥ 7
across the last 10 graded actions + fraud checks
passed

Personal bests: celebrate any post that beats the user's own previous best views, saves
or watch time, at any scale.
Anti-gaming rules
Idea and hook XP needs a minimum AI quality score of 4/10; junk gets 0 XP and a
coaching nudge.
Duplicate ideas (cosine similarity above 0.9 to the user's past ideas) get no XP.
Only posts published after the account connection count, and only on the connected
account.
Tier awards based on views wait for a fraud check (see Trust and compliance).

MVP feature spec
The MVP is ten modules; the brand marketplace is Phase 5. Each module lists what "done"
means.

M1. Auth and profile
Phone OTP and Google sign-in, an age gate, and a profile holding niche, language, weekly
goal, timezone and notification time.
Signing up with a birth date under 18 blocks account creation with a clear message.
Users can delete their account from settings; profile, ideas, media and platform data
are erased within 30 days, while processing logs are kept only as long as the law
requires (see Trust and compliance).

M2. Onboarding
The flow in journey 1, ending with a graded first exercise.

A new user earns their first XP in under 3 minutes without connecting any platform.
Every onboarding step except age and niche can be skipped.

M3. Idea pipeline
A board of the user's ideas, each moving through stages: idea, hook, script, filmed, posted.
Users can add ideas by text or voice note (transcribed).
Each stage change is logged with a timestamp and awards the XP in the gamification
rules.
A detected post can be linked to an idea automatically (caption similarity) or manually.

M4. Practice reps
Short exercises: write hooks, rewrite a weak hook, draft a 30-second script, record a 7 to
15 second clip.
Every rep returns a score out of 10, one strength, one specific fix, and an improved
example.
Feedback returns in under 8 seconds for text reps and under 60 seconds for clips.

M5. AI coach
A named coach character (name [DECIDE]) that writes the daily brief, reacts to reps, and
answers questions in chat.
The coach knows the user's niche, language, recent scores, streak and latest post
stats.
Replies in the user's chosen language, including Hinglish.
Refuses advice that breaks platform rules (buying views, follow-for-follow schemes)
and explains why.

M6. Platform connect and sync
OAuth connection to Instagram (professional accounts) and YouTube, then scheduled
syncing of posts and metrics.
New posts are detected within 6 hours of publishing.
Per-post metrics are snapshotted at 1h, 24h, 48h, 7 days and 30 days after publishing.
A disconnected or expired token shows a reconnect prompt; gamification never
breaks because of it.

M7. Gamification engine
Server-side XP ledger, streaks, skills, leagues, tiers and badges.
XP is only ever written by the server as append-only ledger entries; the client cannot
grant XP.
Streaks compute in the user's local timezone; a streak freeze applies automatically.
Leagues close every Sunday 23:59 IST; promotions and demotions are applied
idempotently.

M8. Notifications
Push notifications via Expo, written in the coach's voice.
At most 2 pushes per day; quiet hours 22:00 to 08:00 local unless the user changes
them.
Types: daily reminder, streak at risk (2 hours before day end), results ready, league
result, tier-up.

M9. Progress screens
Home (daily brief, streak, league), Profile (tier, skills, badges, personal bests), Stats (post
history with metrics).
Stats always compare a post to the user's own past posts, never to other creators.

M10. Admin console (internal)
A basic web page for the team.
Search users, view their XP ledger, reverse fraudulent XP, edit gamification config, view
AI cost per user per day.

AI pipelines
Every AI feature returns structured JSON validated against a schema, so scores feed the
XP engine reliably and the coach's tone stays separate from the grading.
Pipeline

Input

Output

Runs

Idea scorer

Idea text, niche, past
ideas

Score 0 to 10, novelty flag,
one-line angle suggestion

Sync, under 5s

Pipeline

Input

Output

Runs

Hook grader

Hook text, niche, language

Score, rubric breakdown,
one fix, rewritten example

Sync, under 5s

Script coach

Script draft, target length

Score, structure notes
(hook, payoff, call to
action), suggested cuts

Sync, under 8s

Clip and
video
reviewer

Video file

Score per skill,
timestamped notes, top 3
fixes

Async job, under
60s for clips

Daily brief
writer

User profile, streak,
recent scores, latest post
stats, niche trends list

Today's prompt, one focus
skill, coach message

Nightly batch
per user

Results
explainer

Post metrics vs user's own
baseline

Plain-language summary +
one lesson

Async at 48h
snapshot

Coach chat

Conversation + user
context

Reply in coach voice

Streaming

Video review pipeline
1. Upload to object storage; enqueue a job.
2. Extract audio with ffmpeg, transcribe with a speech-to-text model that handles
Hinglish.
3. Sample frames: 4 frames per second for the first 3 seconds (the hook), then 1 frame
every 2 seconds.
4. Compute cheap signals without AI: duration, cut frequency, loudness, silence gaps, onscreen text presence.
5. Send transcript, frames and signals to the LLM with the review rubric. Validate the
JSON output.
6. Store the review, award skill XP, notify the user.
Grading rubrics: written once per rep type and versioned in prompts/rubrics/ . Each
rubric lists 3 to 5 criteria with what a 3, 6 and 9 look like, plus niche-specific examples.
Store the rubric version on every graded item.

Coach persona: a system prompt in prompts/coach.md defines name, voice (warm,
direct, a little funny, never shaming), language rules, and hard limits: no promises of
virality, no advice to buy followers or views, no medical, legal or financial advice.
Cost controls
Cache the user-context block so each call doesn't resend profile data (prompt
caching).
Use a smaller, cheaper model for idea and hook grading; the larger model only for video
review and the daily brief.
Per-user daily AI budget in config; past it, reps still earn XP but feedback becomes a
short version.
Log tokens and cost per call to the ai_calls table; the admin console shows cost per
active user.
Quality checks: keep a golden set of 50 hooks and 20 clips with human-agreed scores.
Every prompt change runs against it; scores must stay within ±1 of the human score on
80% of items before shipping.

System architecture
The app only talks to the API; anything slower than a few seconds (platform sync, video
review, nightly briefs, notifications) runs in the worker off a job queue.

system architecture · 9 components

Text reps are graded inside the API call so feedback feels instant; everything else is
queued.
Component

Tech

Responsibilities

Mobile app

Expo (React Native, TypeScript),
Expo Router

All creator screens, recording clips,
push token registration, direct
media upload via signed URLs

Admin web

Next.js

User lookup, XP reversals, fraud
review, config edits, AI cost view

API service

FastAPI (Python 3.12)

Auth checks, REST endpoints, textrep grading, XP and streak rules,
OAuth callbacks

Job queue

Redis with a Python job library
(for example arq or RQ)

Scheduled and on-demand jobs,
retries

Component

Tech

Responsibilities

Worker

Python, ffmpeg

Platform sync, metric snapshots,
video review, daily briefs, league
close, notifications

Postgres +
Storage

Supabase (Postgres with
pgvector, Auth, Storage)

System of record, row-level
security, media files

AI models

Claude API; a speech-to-text
model with Hinglish support

Grading, coaching, briefs;
transcripts of voice ideas and
videos

Push

Expo push service

Delivering notifications to Android
and iOS

Observability

Product analytics + error tracking
(for example PostHog and Sentry)

Retention funnels, crash reports,
job failures

Data model
Postgres is the system of record; the XP ledger is append-only and every other
gamification number is derived from it.
Table

Key columns

Notes

users

id, phone, email, birth_date, language,
timezone, created_at, deleted_at

Soft delete, then hard
delete within 30 days

creator_profiles

user_id, niche, goal, weekly_post_goal,
notify_time, coach_tone

One per user

platform_accounts

id, user_id, platform
(instagram/youtube), external_id,
handle, access_token_enc,
refresh_token_enc, token_expires_at,
status

Tokens encrypted at
rest

ideas

id, user_id, text, stage
(idea/hook/script/filmed/posted),
embedding, score, created_at

pgvector for duplicate
checks

Table

Key columns

Notes

reps

id, user_id, idea_id?, type
(hook/script/clip/review/lesson),
content, media_url?, status

One row per practice
action

ai_feedback

id, rep_id, score, rubric_version,
breakdown_json, fix_text,
example_text, model, created_at

Structured grading
output

posts

id, user_id, platform_account_id,
external_media_id, idea_id?,
media_type, caption, published_at,
permalink

Only posts after
connection

post_metrics

post_id, captured_at, snapshot_label
(1h/24h/48h/7d/30d), views, likes,
comments, saves, shares, watch_time?,
retention_json?

One row per snapshot

xp_ledger

id, user_id, amount, reason,
source_type, source_id, created_at,
reversed_by?

Append-only; reversals
are new rows

streaks

user_id, kind (daily/weekly_goal),
current, longest, last_counted_date,
freezes_held

Recomputed from
ledger and posts

skills

user_id, skill, xp, level

Six rows per user

leagues /
league_members

league_id, tier, week_start; user_id,
weekly_xp, final_rank, outcome

Closed weekly

creator_tiers

user_id, tier, achieved_at,
evidence_post_id?

History kept; current =
highest

badges / user_badges

badge_id, name, rule; user_id, badge_id,
earned_at

notifications

id, user_id, type, body, scheduled_for,
sent_at, opened_at

Enforces daily cap

ai_calls

id, user_id, pipeline, model,
input_tokens, output_tokens, cost_inr,
latency_ms

Cost tracking

Table

Key columns

Notes

fraud_flags

id, user_id, post_id?, rule, details_json,
status

Reviewed in admin

Phase 5 adds: brands, campaigns, campaign_applications, deliverables, contracts,
payouts, tax_records.

API surface and background jobs
A REST API under /v1 , authenticated with the Supabase JWT; the client only ever reads
gamification state and never writes it.
Method

Path

Purpose

GET /
PATCH

/v1/me

Profile, settings, weekly goal

DELETE

/v1/me

Start account and data deletion

GET

/v1/home

Daily brief, streaks, league snapshot, next
pipeline item

GET / POST

/v1/ideas

List or create ideas (text or voice)

PATCH

/v1/ideas/{id}

Move stage, edit text

POST

/v1/reps

Submit a rep; text reps return feedback
inline

POST

/v1/reps/{id}/upload-url

Signed upload URL for clips and videos

GET

/v1/reps/{id}

Rep status and feedback (poll for async
video review)

GET / POST

/v1/coach/messages

Coach chat history; send a message
(streamed reply)

GET

/v1/connect/{platform}/start

Begin OAuth

GET

/v1/connect/{platform}/callback

Finish OAuth, store encrypted tokens

DELETE

/v1/connect/{platform}

Disconnect and revoke

GET

/v1/posts

Detected posts with latest metrics

Method

Path

Purpose

POST

/v1/posts/{id}/link-idea

Link a post to an idea manually

POST

/v1/posts/{id}/reflection

Submit the 48-hour reflection

GET

/v1/progress

XP, skills, tier, badges, personal bests

GET

/v1/leagues/current

Current league table

POST

/v1/devices

Register an Expo push token

Background jobs

Job

Schedule

What it does

sync_new_posts

Every 2 hours per connected
account

Finds posts published since the last
sync, creates posts rows, awards
posting XP

snapshot_metrics

Every 15 minutes, picks posts
due a snapshot

Captures metrics at 1h, 24h, 48h, 7d,
30d

results_ready

On the 48h snapshot

Runs the results explainer, sends a
push, opens the reflection prompt

evaluate_tiers

After each snapshot

Checks milestones and personal
bests, runs fraud checks, awards
tiers

daily_brief

Nightly per timezone

Generates tomorrow's brief for
each active user

streak_rollover

Hourly, per timezone at local
midnight

Extends or breaks streaks, applies
freezes

close_leagues

Sunday 23:59 IST

Ranks, promotes, demotes, forms
next week's cohorts

send_notifications

Every 5 minutes

Sends due pushes within the daily
cap and quiet hours

refresh_tokens

Daily

Refreshes long-lived tokens before
expiry; marks failures for reconnect

video_review

Queue

The video pipeline in AI pipelines

Every job is idempotent: re-running it for the same window must not double-award XP.

Instagram and YouTube integration
Both platforms give us a creator's own post metrics through official OAuth APIs, so the
app never scrapes and never asks for screenshots; the main limits are Instagram's
account-type rule and YouTube's daily quota.
Wrap both behind one interface so a third platform can be added later:

class PlatformConnector(Protocol):
def auth_url(self, state: str) -> str: ...
def exchange_code(self, code: str) -> TokenSet: ...
def refresh(self, tokens: TokenSet) -> TokenSet: ...
def get_profile(self, tokens: TokenSet) -> AccountProfile: ...

#

handle, followers
def list_media_since(self, tokens: TokenSet, since: datetime) ->
list[MediaItem]: ...
def get_metrics(self, tokens: TokenSet, media_ids: list[str]) ->
list[MetricSnapshot]: ...

Instagram (Instagram API with Instagram Login)
Item

Detail

Login

Business Login for Instagram, host
graph.instagram.com ; no Facebook Page needed
(Meta)

Permissions

instagram_business_basic ,
instagram_business_manage_insights (Meta)

Account type

Only professional accounts (creator or business)
return data; onboarding must explain the free
switch (Meta)

Reel metrics to store

views , reach , likes , comments , saved ,
shares , total_interactions ,
ig_reels_avg_watch_time , reels_skip_rate

Delays

Metric data can lag up to 48 hours; take the 48h
snapshot as provisional and the 7-day one as final
for tier awards

Webhooks

Insights webhooks are not supported with
Instagram Login, so syncing is by polling

Gaps

No insights for media inside carousel albums; story
metrics only last 24 hours

Review

Expect Meta App Review before users outside the
developer team can connect; plan 2 to 4 weeks for
it in Phase 1

reels_skip_rate (share of viewers who skipped in the first 3 seconds) is the best signal

for hook coaching. Meta marks it estimated and in development, so treat it as optional.
YouTube (Data API v3 + YouTube Analytics API)
Item

Detail

Login

Google OAuth with read-only YouTube and
YouTube Analytics scopes

Detect new videos

Read the channel's uploads playlist (cheap list call),
or subscribe to YouTube's push notifications for
uploads

Metrics

videos.list statistics (views, likes, comments),

batched up to 50 IDs per call; Analytics API for
watch time and retention on the user's own
channel
Quota

Default 10,000 units per day for most endpoints,
plus separate buckets of 100 search.list and 100
videos.insert calls; list reads usually cost 1 unit;
more quota by request form (Google)

Quota planning: syncing every 2 hours with about 2 list calls per sync is roughly 24 units
per user per day, which caps the default quota near 400 connected YouTube users. Use
push notifications for new uploads, batch metric reads, and file the quota extension
request during Phase 1.

Brand marketplace (Phase 5)
Phase 5 turns brand campaigns into paid quests for Gig-ready creators, with one edge
over SideShift-style marketplaces: every creator's skill scores and post metrics come
from verified data, not self-reported numbers.
Brand side (web dashboard)
1. Brand signs up, adds GSTIN and PAN, and pastes its website or app store link.
2. AI drafts the brief: product summary, target audience, 3 content angles, deliverables,
suggested pay per video.
3. Brand sets eligibility (niche, platform, minimum tier, language, city if needed), budget,
deadline and usage rights.

4. The campaign goes live as a quest inside the creator app.
5. Brand reviews applicants with an AI shortlist ranked by fit (this is the original matching
algorithm: niche match, audience fit, skill scores, past completion rate).
6. Creators submit drafts; the brand approves or requests one revision round.
7. Creator posts; the app tracks the post through the creator's connected account.
8. Brand approves the deliverable and releases payment.
Creator side (inside the existing app)
Quests tab, visible only from Gig-ready tier, with a teaser of locked quests for lower
tiers as motivation.
Apply with one tap; the application auto-attaches skill scores and best posts.
Completing a quest awards large XP, a badge and counts toward a "Pro" tier.
Payments
Brand pre-funds the campaign budget into escrow before it goes live.
Payouts to creators by UPI or bank transfer through a payout provider such as
RazorpayX or Cashfree Payouts [DECIDE after comparing fees and TDS support].
The platform deducts TDS where required and issues TDS certificates (see Trust and
compliance).
Platform fee on top of creator pay [DECIDE the percentage].
Campaign analytics for brands
Views, engagement and cost per thousand views per creator and per campaign, from
verified platform data.
Content angle comparison: which hooks and formats performed best across creators.
Export of top-performing videos with usage rights for paid ads.
Later ideas (not in scope yet): virality and best-posting-time prediction for brands, an
MCP server so brands can run campaigns from an AI assistant, and affiliate or sales-based
payouts.

Trust, safety and India compliance
Three rules shape the build: keep the app 18+ until a parental-consent flow exists, never
let fake views earn tiers, and settle the TDS setup with a CA before the first brand payout.
Data protection (DPDP Act 2023 and DPDP Rules 2025)

The Rules were notified on 14 November 2025. Notice and consent, breach reporting,
security safeguards, verifiable consent for children's data and user rights take effect
on 14 May 2027 (Shardul Amarchand Mangaldas). Build to these from day one.
Anyone under 18 is a child. Processing their data needs verifiable parental consent, and
tracking, behavioural monitoring and targeted ads aimed at children are prohibited. A
streak-and-XP app is behavioural monitoring by design, so launch 18+ only.
Rules also require two-tier breach reporting (to the Data Protection Board and
affected users), grievance resolution within 90 days, and keeping processing logs for at
least one year.
Ship a clear consent notice at signup, a data export, account deletion, and a grievance
contact.
Platform policies
Official APIs only; no scraping, no stored passwords.
When a user disconnects a platform, revoke the token and delete that platform's
stored data.
Follow Meta Platform Terms and YouTube API Services Developer Policies, including
their rules on how long API data may be stored.
Ad disclosure (Phase 5): brand quest posts must carry a paid-partnership label in line
with ASCI's influencer advertising guidelines. Content review checks for it before
approval.
Tax on creator payouts (Phase 5) — confirm every line with a CA before launch
(Finowings, updated Jul 2026):
Item

Rule as of Oct 2026

Governing law

Income Tax Act, 2025 replaced the 1961 Act from 1
April 2026; TDS now sits under Section 393(1)

Cash fees to creators

10% TDS above ₹30,000 (formerly Section 194J)

Free products or perks

10% TDS once a brand's benefits to one creator
exceed ₹20,000 in a year (formerly Section 194R)

Creator without PAN

TDS at 20%

Paperwork

Quarterly TDS return Form 140; certificate to
creator Form 131

Item

Rule as of Oct 2026

GST

18% on promotional services; creator registration
mandatory above ₹20 lakh annual turnover

[DECIDE with a CA] whether the platform or the brand is the TDS deductor; that depends
on how money flows through escrow. Collect PAN at payout setup either way.
Fraud and integrity
Signal

Rule

View spike

Views far above the creator's own baseline with
low reach or low interactions → hold tier award

Engagement ratio

Interactions per view far outside the account's
history → flag

Follower jump

Sudden follower gains with no matching post
performance → flag

Multiple accounts

Same phone, device ID or payout account across
users → block duplicate XP and payouts

Duplicate content

Perceptual hash match against other users'
campaign submissions → reject

Tier awards based on views wait for the 7-day snapshot and pass these checks; flagged
items go to the admin console.
Safety and security
Coach guardrails in the persona prompt (see AI pipelines); users can report a bad AI
reply.
No user-to-user messaging in MVP; leagues show display names and avatars only.
OAuth tokens encrypted at rest, row-level security on every user table, signed shortlived URLs for media.

Build plan
Five phases to a public creator app, then the marketplace as its own phase; each ends
with a gate Jash checks before the next starts.

Repo layout
apps/mobile

Expo app (TypeScript, Expo Router)

apps/admin

Internal admin web (Next.js)

services/api

FastAPI app

services/worker
packages/shared

Background jobs and video pipeline
API types generated from the FastAPI OpenAPI schema

supabase/

Migrations, seed data, row-level security policies

prompts/

Coach persona and grading rubrics, versioned

config/
docs/PRD.md

gamification.yaml, notifications.yaml
This document

Phase 0: Foundations
1. Monorepo, linting, formatting, CI running tests on every push.
2. Supabase project, migrations for users , creator_profiles , xp_ledger , streaks .
3. Phone OTP and Google sign-in with the 18+ age gate.
4. FastAPI skeleton with auth middleware, health check, OpenAPI type generation into
packages/shared .

5. Empty home screen on an Android device via Expo.
Gate: Jash signs in on his own Android phone; CI is green; a fresh clone runs with one
setup command.
Phase 1: The daily loop (no platform connection yet)
1. Onboarding flow (M2) ending in the first graded hook exercise.
2. Idea pipeline (M3) with text and voice ideas.
3. Text reps (M4): hooks, hook rewrites, scripts, with the grading pipelines and rubric
files.
4. XP ledger, daily streak, streak freezes, all driven by config/gamification.yaml .
5. Coach v1 (M5): daily brief and feedback voice, English and Hinglish.
6. Push notifications (M8): daily reminder and streak-at-risk.
Gate: 10 test users use it daily for 7 days; text feedback returns in under 8 seconds; no
way to earn XP from the client.
Phase 2: Real posts and results
1. Instagram and YouTube connectors behind PlatformConnector ; encrypted tokens;
token refresh job.

2. Submit Meta App Review and the YouTube quota extension request at the start of this
phase.
3. Post detection, metric snapshots (1h to 30d), the 48-hour results card and reflection.
4. Posting XP, weekly goal streak, creator tiers, personal bests, celebration screens.
Gate: on test accounts, a new post is detected within 6 hours and its snapshots match
the native app's numbers.
Phase 3: Depth and integrity
1. Practice clip and pre-post video review pipeline.
2. Skill tree, weekly leagues, badges.
3. Fraud checks and the admin console (M10).
4. AI cost tracking, per-user budgets, and the golden-set evaluation for prompts.
Gate: closed beta of about 100 users for 4 weeks; AI cost per active user is known and
within the budget Jash sets.
Phase 4: Public launch
1. DPDP-ready flows: consent notice, data export, deletion, grievance contact.
2. Product analytics and crash reporting.
3. Play Store and App Store submission.
Gate: store approval; north-star and retention dashboards live.
Phase 5: Brand marketplace
Write a dedicated spec from the Brand marketplace section first: payout provider choice,
TDS setup confirmed by a CA, escrow flow, and the brand dashboard. Do not start this
phase until those are settled.

Open questions for Jash
The first four block Phase 1; the rest can wait until their phase.
Final app name (LockIn is a placeholder).
Instagram and YouTube at launch, or Instagram only for a faster MVP?
Confirm 18+ at launch. Is a parental-consent flow for under-18s worth building later?
Coach character: name, personality, and how strict or funny it should be.
Languages after English and Hinglish, and in what order.
Monthly AI budget per active user.

When to introduce any paid tier for creators, if ever.
Payout provider and platform fee for the marketplace.
With a CA: who deducts TDS on creator payouts, the platform or the brand.

Sources
SideShift homepage and SideShift for AI, read Oct 2026
Meta: Instagram Media Insights reference
Meta: User and Media Insights on Instagram API with Instagram Login
Meta: IG Media reference
Google: YouTube Data API overview and quota
Shardul Amarchand Mangaldas: DPDP Act enforcement and DPDP Rules alert, Nov
2025
Finowings: Influencer tax in India, updated Jul 2026
```
