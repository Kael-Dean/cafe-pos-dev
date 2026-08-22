# FRD Control Plane (`admin/`)

FRD's internal portal for running the POS business: who our clients are, which
package each one is on, which features that switches on, and whether a client is
currently switched on at all.

**Not client-facing.** No cafe owner, manager or barista ever sees this, and
there is no self-signup — admin accounts are created with a CLI script on the
backend.

## Why it is a separate app

Admin and cafe staff are **different auth realms**. An admin token and a POS
token are minted by different endpoints, carry a different realm claim, and each
is rejected with `401` by the other side's routes. So this deploys to its own
hostname, on its own Vercel project, with its own token key
(`frd_admin_token`, vs the POS's `cafe_pos_token`).

It shares the POS design tokens — same palette, type scale, spacing, and the
measured AA contrast pairs — so the two products read as one family.

## Run it

```bash
pnpm install
pnpm dev          # http://localhost:3001 (the POS uses 3000)
pnpm typecheck
pnpm lint
pnpm build
```

You need an admin account on the target API to get past the login screen. There
is no signup and no password reset — ask the backend team to seed one.

## Config

| Var | Meaning |
|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | Leave **empty**. The browser calls same-origin `/api/v1/*`. |
| `ADMIN_API_URL` | Where `next.config.ts` proxies `/api/v1/*`. Avoids CORS entirely. |

`/api/v1/admin/*` currently exists on **staging only**
(`caf-pos-repo-staging.up.railway.app`); production does not serve it yet.

## Deploy

A **separate Vercel project** with Root Directory `admin/`. Do not touch the
repo-root `vercel.json` — that one is wired to build the POS (`app/`).

## Shape of the code

```
src/
  app/
    login/              email + password, its own realm
    (portal)/           everything behind the guard
      tenants/          list · [id] detail · new (3-step onboarding)
      packages/         the sellable feature bundles
  components/ui/        button, field, select, modal, data-table, toast, …
  hooks/                one React Query file per domain
  lib/
    admin-api.ts        fetch wrapper: bearer, error envelope, no refresh
    admin-token.ts      localStorage + cross-tab sync
    format.ts           money (string, never parseFloat), Buddhist-era dates
    schemas.ts          zod mirrors of the API's validation rules
    error-copy.ts       status + context → a Thai message with a recovery step
```

## Rules the UI has to keep

These come from the API's actual behaviour, not from taste:

- **A store's `owner_pin` is returned once, ever.** No endpoint reads it back and
  there is no reset. It lives in component state only — never localStorage,
  never the query cache — and the screen showing it refuses to be dismissed
  until the founder confirms they saved it.
- **Money is a string.** `parseFloat` on `"2500.00"` loses baht. Format the
  string (see `formatMoney`).
- **Store slugs are unique across all clients**, not per client, because staff
  log in with `(store_slug, PIN)`. The form suggests a tenant-prefixed slug.
- **`features` on a store is derived** from the tenant's package. Display it,
  never offer to edit it.
- **Suspension is read-only, not a lockout.** Suspended staff can still log in,
  read history, run reports and export — they just cannot write. The copy says
  "อ่านอย่างเดียว", never "ปิดใช้งาน".
- **Resuming a tenant does not reopen every store** — only the ones that
  suspension froze. The store list is refetched rather than assumed.
- **A store cannot resume while its tenant is suspended** (`409`), so that button
  is disabled with the reason shown instead.
- **Nothing is ever deleted.** There are no delete endpoints and no delete UI.
- **No optimistic updates.** Several writes can be rejected server-side; render
  what the response returns.

## Not in Phase 1

No billing. No tenant-detail editing (billing fields are set at creation only —
a typo needs a database fix). No PIN reset. No audit-log screen. No admin
invite / password change. No deletes.
