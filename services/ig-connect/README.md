# ig-connect

Cloudflare Worker that connects a creator's Instagram account to LockIn using the Instagram API with Instagram Login (scope `instagram_business_basic`). The app never sees the app secret or the long-lived token. It is a Phase 2 skeleton: nothing here is deployed, and no real secrets are in the repo.

Setup by hand is in `docs/INSTAGRAM.md`.

## Routes

| Route | What it does |
|---|---|
| `GET /auth/start?return=<app url>` | Checks `return` against `ALLOWED_RETURN_ORIGINS`, then redirects to Instagram with an HMAC-signed `state` that carries the return URL. |
| `GET /auth/callback` | Verifies `state`, swaps the code for a short token and then a long-lived token, stores the token (AES-GCM encrypted) in KV under a random one-time code for 10 minutes, redirects to `<return>#ig=<code>`. On denial it redirects to `<return>#ig_error=<reason>`. |
| `GET /api/profile?code=` | Consumes the one-time code, fetches profile and the latest 30 media. Personal accounts get `422 {"error":"account_type"}` and nothing is stored. Otherwise the token moves to a 60-day session record and the JSON includes an opaque `session`. |
| `GET /api/profile?session=` | Same JSON for a stored session. `401 {"error":"expired"}` when the session is gone or Instagram rejected the token. |
| `POST /api/disconnect?session=` | Deletes the stored token. |

CORS allows only the origins in `ALLOWED_RETURN_ORIGINS`.

## Config

Var (in `wrangler.toml`): `ALLOWED_RETURN_ORIGINS`, comma separated origins such as `https://jash.github.io`.

Secrets (`npx wrangler secret put NAME`): `IG_APP_ID`, `IG_APP_SECRET`, `STATE_SECRET` (any long random string), `TOKEN_ENC_KEY` (32 random bytes, base64url: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`).

KV namespace binding: `SESSIONS`.

## Known limits

- KV is eventually consistent and has no atomic get-and-delete, so a one-time code could in theory be used twice within a second or so. Move to a Durable Object if that matters.
- Long-lived tokens are not refreshed yet (Instagram allows refresh after 24 hours and before 60 days). The session simply expires and the user reconnects.
- No rate limiting. Add a Cloudflare rate-limit rule on `/api/*` before opening it up.

## Tests

`npm test` from the repo root runs `test/*.test.mjs` here (state signing, return-origin validation, token encryption, and the whole flow against a stubbed Instagram).
