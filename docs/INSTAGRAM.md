# Instagram connect

Connecting Instagram lets LockIn fill in onboarding from the account instead of asking. YouTube is not covered here.

## 1. What is filled in and what is still asked

| Item | Source | Why |
|---|---|---|
| Name (first name) | Instagram `name`, editable | Available from the API. |
| Niche | Guessed from bio and captions, editable | Not an API field; we count niche keywords and you confirm. |
| Language (English or Hinglish) | Guessed from captions, editable | Not an API field; we check how many captions are Hinglish. |
| Weekly posting goal | Posts in the last 28 days divided by 4, within the config min and max, editable | Not an API field. Fewer than 3 recent posts falls back to the suggested goal. |
| Followers, post count, recent posts | Instagram | Shown on the confirm screen, then used for the weekly goal bar, "Your posts" and "What's working" (likes and comments). Imported posts are not verified and earn no XP or tier credit in this build. |
| Birth date (18+ gate) | Asked | Instagram does not provide it. Needed to keep under-18s out. |
| Consent to the privacy notice | Asked | Must be an explicit act (DPDP Act). |
| Reminder time | Asked, on the confirm screen | Not an API field. |
| Phone or Google sign-in, goal | Only on "Fill in manually instead" | Not needed when connecting. |

Only birth date and niche are required overall. Connect accounts must be creator or business accounts; Instagram returns nothing useful for personal accounts, and the app shows the free switch steps.

## 2. Meta setup (by hand)

1. Go to developers.facebook.com and create an app. Choose the use case **Instagram API with Instagram login** (Business Login for Instagram).
2. In the app's Instagram settings, open Business Login settings and add the OAuth redirect URI `https://<your-worker>/auth/callback` (the worker URL from step 3 below, exactly, no trailing slash).
3. Add the permissions `instagram_business_basic` and `instagram_business_manage_insights` (per-post reach, views, saves and shares for Analytics).
4. Copy the Instagram app ID and app secret (keep the secret out of the repo).
5. Before App Review, only people with a role can connect. Under **App roles → Roles**, add **Instagram testers** and enter Instagram usernames (yours first).
6. Switch your Instagram account to Creator or Business: Instagram → Settings → Account type and tools → Switch to professional account → Creator.
7. Accept the tester invite in Instagram: Settings → Apps and websites → Tester invites.
8. Public use needs **App Review** and business verification for both permissions. This takes weeks. Until it passes, nobody outside the tester list can connect. For personal use, staying in tester mode is enough.

## 3. Cloudflare setup (by hand)

From `services/ig-connect`:

```
npx wrangler kv namespace create SESSIONS     # paste the printed id into wrangler.toml
npx wrangler secret put IG_APP_ID
npx wrangler secret put IG_APP_SECRET
npx wrangler secret put STATE_SECRET          # any long random string
npx wrangler secret put TOKEN_ENC_KEY         # 32 random bytes, base64url (see README.md)
```

Set `ALLOWED_RETURN_ORIGINS` in `wrangler.toml` to the origin that serves the app (for example `https://jash.github.io`), then:

```
npx wrangler deploy
```

Wrangler prints the worker URL. Put it in the Meta redirect URI (step 2.2), then set it in `config/app.yaml`:

```
ig_api_base: "https://lockin-ig-connect.<account>.workers.dev"
```

Commit and push so the app rebuilds. While `ig_api_base` is empty the app runs in demo mode: "Connect Instagram (demo)" loads a labelled sample creator (@priya.eats) and nothing leaves the device.

## 4. What the app does with it

- Real mode: "Connect Instagram" goes to `<ig_api_base>/auth/start?return=<app url>`, comes back with `#ig=<code>`, removes it from the URL and fetches the profile. The app stores the profile, posts and an opaque session id on the device only. Export leaves the session id out.
- Disconnect (You → Settings → Instagram) deletes the imported profile, followers and posts on the device and asks the worker to delete the stored token.
- Imported posts have `verified: false`. Verifying posts and awarding post XP and tiers is Phase 2 server-side work.
