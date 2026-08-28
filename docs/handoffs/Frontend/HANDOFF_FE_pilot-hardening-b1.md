# BE reply — Pilot Hardening (Train B.1)

> **Received:** 2026-08-29, from Backend, answering
> [HANDOFF_BE_pilot-hardening-questions.md](../Backend/HANDOFF_BE_pilot-hardening-questions.md).
> **Branch:** `feat/pilot-hardening` (PR #2 → `dev`), pushed as "Train B.1" on top of the original 18
> commits. No migrations. **Supersedes the matching sections of**
> [HANDOFF_FE_pilot-hardening.md](HANDOFF_FE_pilot-hardening.md).
> Archived here with the same UTF-8/latin-1 encoding fault repaired; no technical content changed.

All five asks were actioned, plus one correction to the original handoff. Nothing we built needs to
change; three things can be deleted or simplified.

---

## 0. Correction + our "small ask": `Retry-After` on 429

We asked them to confirm the headers survive the proxy. **They did not exist.** The first handoff claimed
the per-IP 429 carried `Retry-After` / `X-RateLimit-*`; it didn't — slowapi only emits them when the
limiter is built with `headers_enabled=True`, and theirs wasn't.

**Now (B.1)** the per-IP 429 carries:

| header | value |
|---|---|
| `Retry-After` | seconds until the window resets, integer ≥ 1 |
| `X-RateLimit-Limit` | the route's limit, e.g. `5` |
| `X-RateLimit-Remaining` | `0` on a 429 |
| `X-RateLimit-Reset` | Unix epoch **seconds** of the reset point (slowapi's convention — an absolute time, not a duration; use `Retry-After` for the countdown) |

Only on the **429** — successful responses on limited routes get no rate-limit headers (they are built in
the 429 handler, not at the decorator, so no route signatures changed). They are listed in
`Access-Control-Expose-Headers`, so a **cross-origin** browser call can read them; through our Next.js
rewrite it is same-origin and moot either way.

The per-email admin lockout 429 still has **no** `Retry-After`, exactly as documented — our header-first /
message-second classifier is the right design and now has a header to key on. Whether the header survives
our rewrite is still ours to check (`next.config` rewrites pass response headers through by default).

## 1. Inactive items — new skip reason `inactive_item`

Shipped. `ExpiredWasteSkip.reason` is now `not_found | not_expired | empty | inactive_item`. Contract
otherwise unchanged: one transaction, always 200, per-lot report. Check order: `not_found` → `not_expired`
→ `empty` → `inactive_item`.

Two consistency changes so the list and the batch never disagree:
- `GET /inventory/expired` **no longer lists** lots on inactive (soft-deleted) items. Restore the item
  first to put its stock back in play.
- Both endpoints now evaluate "expired" against the **Bangkok** calendar date (see §2).

So `inactive_item` only appears on a stale list — item deactivated between fetch and confirm. Suggested
copy: TH "รายการวัตถุดิบถูกลบแล้ว" / EN "Item is inactive".

## 2. `GET /inventory/expired` server date vs Bangkok

Fixed — the list uses the same Bangkok date as the confirm. The comment on `useExpiredInventory()` can go.

## 3. `TenantUpdate.name = null` → 422 · `{}` message pinned

- `{"name": null}` → `422 UNPROCESSABLE_ENTITY` (validation envelope, `details[0].msg` contains
  `name cannot be null`). The 409 branch can go. **`name` is the one field where our `'' → null = clear`
  rule must not apply**: `""` also 422s (`min_length=1`, a different message) — omit the key when unchanged.
- `PATCH` with `{}` stays `422` with message exactly `No fields to update` — now pinned by a test, so it is
  safe to match on.

## 4. `GET /api/v1/admin/feature-keys`

The union-of-local-and-existing workaround was the right call; the real endpoint now exists so the
hard-coded table can go.

- **Auth:** platform admin (admin realm). POS tokens → 401.
- **Response** `200`:
  ```json
  [ { "key": "vertical.boardgame", "label": "Board game cafe" } ]
  ```
  Sorted by `key`. `label` is English; Thai display copy is ours. This list is the *exact* set
  `POST/PATCH /admin/packages` accepts — a backend test asserts they cannot drift.
- Keep the "unknown-but-present keys shown checked and flagged" behaviour as belt-and-braces for a stale
  client build; with the endpoint fetched on picker open, the entitlement-stripping scenario can't happen.

## 5. `POST /api/v1/inventory/waste` — the contract, written down

- **Auth:** OWNER / MANAGER / BARISTA / BAKER (every staff role).
- **Request:**
  ```json
  { "item_id": "cuid", "qty": "1.500", "reason": "EXPIRED", "note": "optional, ≤ 500 chars" }
  ```
  `qty`: decimal, `> 0`, `≤ 999999.999`, 3 dp. `reason`: `EXPIRED | SPILLED | TRIAL | DAMAGED | OTHER`.
- **Response** `200`: the updated `InventoryItemRead` (same shape as `GET /inventory/{id}`).
- **`qty` may exceed `stock_on_hand`** — yes: stock goes negative, a warning is logged, no error. Same as
  the batch endpoint.
- **`CANCELED` is backend-set only** — hiding it was right, and B.1 now enforces it: submitting
  `reason: "CANCELED"` → `422`, message `CANCELED is set by the system on order cancellation and cannot be
  submitted`. It still appears in movement history and the wastage report for order-cancel write-offs.
- Errors: `404 NOT_FOUND` item not in this store; `409 CONFLICT` item inactive (`Item is not active`);
  `422` validation (`qty ≤ 0`, bad reason, note > 500).
- Movement `reason` is stored as `<REASON>|<note>`; the report groups by the `<REASON>` prefix.

## Still open on the backend side (nothing needed from us)

- Deploy-time proxy-header spoof check before pilot go-live — if Railway appends rather than overwrites
  `X-Forwarded-For`, the per-IP limiter's bucket is attacker-chosen. They'll run it on the first staging
  deploy.
- `waste_expired_lots` / `record_waste` share arithmetic by copy, not by helper; row-level lock on the
  batch path — internal refactor, no contract change.

---

## What we changed in response (2026-08-29)

| B.1 item | FE |
|---|---|
| §0 `Retry-After` now real | **No change** — the header-first classifier was already built for it |
| §1 `inactive_item` | Real Thai label; the widened reason type meant nothing broke while it was unknown |
| §2 Bangkok list | Stale comment on `useExpiredInventory()` replaced |
| §3 `name: null` → 422 | 409 branch removed from `error-copy.ts` |
| §4 feature-keys endpoint | `useFeatureKeys()`; the local table is now Thai labels + an offline fallback |
| §5 waste contract | `qty` stays a number (Pydantic coerces; the endpoint has always worked). `CANCELED` was already hidden. Added Thai copy for the 409 on an inactive item |

Staging acceptance: [HANDOFF_FE_pilot-hardening-acceptance-checklist.md](HANDOFF_FE_pilot-hardening-acceptance-checklist.md).
