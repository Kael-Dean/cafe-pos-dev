# BE Handoff — admin login rate limit is not active on staging

**Date:** 2026-08-22
**From:** Frontend (admin control plane, Phase 1)
**Severity:** medium — brute-force protection documented but absent on an admin login endpoint
**Env checked:** `https://caf-pos-repo-staging.up.railway.app`

---

## What the handoff says

`2026-08-22-admin-control-plane-phase1-handoff.md`, under `POST /api/v1/admin/auth/login`:

> **Rate limited to 5 attempts per minute per IP.** Handle `429` with a clear
> "too many attempts, wait a minute" message rather than a generic error — the
> founders will hit this while testing.

Test scenario 9 likewise expects: *six failed logins in a minute → `429`*.

## What the API actually does

It never returns `429`. Every attempt returns `401`, indefinitely.

Measured twice, from the same IP, inside one minute:

| Path | Attempts | Result |
|---|---|---|
| Through the admin app's Next proxy (`/api/v1/admin/auth/login`) | 8 | all `401 UNAUTHORIZED / "Invalid credentials"` |
| Direct to staging, bypassing the proxy | 7 | all `401`, same body |

No `429` at any point. No `Retry-After`, `X-RateLimit-*`, or any rate-limit
header on any response.

Everything else in the handoff matched the deployed API exactly — all 12 admin
paths are present and every schema field (including `price_monthly` as a string
and `store_count` defaulting to 0) lines up with `/openapi.json`. This is the
only divergence found.

## Why it matters

`POST /admin/auth/login` is the front door to the control plane: it can suspend
every client, strip entitlements from every store, and read every tenant's
billing details. Unlimited password guessing against it is the one thing the
documented limiter was there to stop. Admin passwords are also capped at 72
bytes (bcrypt) with strength enforced only at account-creation time, so the
limiter is doing real work in the threat model.

## Please confirm which is true

1. **The limiter was never wired up** → implement it, and the frontend needs no
   change (the `429` path is already built and will light up on its own).
2. **It exists but is disabled on staging** (missing Redis / env flag / a
   `RATE_LIMIT_ENABLED=false`) → say so, and confirm it is on in production. We
   would like a way to exercise it before go-live.
3. **The documented behaviour is stale and there is deliberately no limit** →
   then the handoff needs correcting, and we should talk about what protects this
   endpoint instead.

## One related thing to check before production

The admin app proxies `/api/v1/*` through its own Next.js server (same-origin in
the browser → no CORS). Once it is deployed to Vercel, **every admin request
reaches the backend from a Vercel egress IP, not the founder's**.

If the limiter keys on the socket peer address, then after it is enabled:

- one founder tripping the limit would lock out the other, and
- the per-IP bucket becomes effectively per-deployment rather than per-user.

If it keys on `X-Forwarded-For`, that header is attacker-controllable unless the
backend trusts only a known proxy hop. Worth deciding explicitly. Keying the
login limiter on the **email** (or email + IP) sidesteps both problems.

Tell us which it is and we will adjust the proxy or the client accordingly.

## Also noted, not a bug

`GET /api/v1/admin/tenants` with `Authorization: Bearer not.a.real.token`
returns:

```json
{"error":{"code":"UNAUTHORIZED","message":"Invalid header string: 'utf-8' codec can't decode byte 0x9e in position 0: invalid start byte"}}
```

The status is right (`401`) and we surface our own Thai copy rather than this
string, so nothing is broken. But the message leaks a Python codec error to the
client where `"Invalid token"` would do.

## Frontend status

The admin portal is built and handles `429` correctly already — a dedicated
message plus a 60-second countdown on the submit button. No frontend change is
needed whichever way this is resolved; we would just like to know whether the
protection is actually there.

**Still blocked on:** an admin account on staging (email + password) to run
handoff test scenarios 1–8 and 11. There is no signup endpoint, so it has to be
seeded with the CLI script.
