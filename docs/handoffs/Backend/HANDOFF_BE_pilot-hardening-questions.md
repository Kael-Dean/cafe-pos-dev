# BE Handoff — answers to the Pilot Hardening (Train B) open questions

**Date:** 2026-08-28
**From:** Frontend (POS app + admin control plane)
**Re:** PR #2 `feat/pilot-hardening` → `dev` — the four "Open Questions / TODOs" at the end of the handoff
**Repo:** `FeatureRichDevelopment/caf-pos-repo`
**Handoff archived at:** `docs/handoffs/Frontend/HANDOFF_FE_pilot-hardening.md`

> **ANSWERED 2026-08-29 — all five actioned in Train B.1.** The reply is archived at
> [HANDOFF_FE_pilot-hardening-b1.md](../Frontend/HANDOFF_FE_pilot-hardening-b1.md); this file is kept as
> the record of what was asked. Outcomes: `inactive_item` shipped · the expired list moved to the Bangkok
> date and now hides inactive-item lots · `name: null` is a 422 and `{}`'s message is pinned by a test ·
> `GET /admin/feature-keys` exists · `POST /inventory/waste` is documented, `qty` may exceed stock, and
> `CANCELED` now 422s on input. **Plus a correction:** the `Retry-After` / `X-RateLimit-*` headers we
> asked about did not exist at all (slowapi needs `headers_enabled=True`) — B.1 adds them.

Nothing here blocks the merge. One request (item 4) and one gap (item 5) are worth a decision.

---

## 1. Inactive items in expired-waste — a 4th reason `inactive_item`

**Our preference: add it.** But we are not blocked either way, and the FE is already safe today.

`ExpiredWasteSkip.reason` is typed as `'not_found' | 'not_expired' | 'empty' | (string & {})` and the
label lookup falls back to `ข้ามไว้ (<reason>)` for anything unrecognised, so a new reason renders as an
honest, if unstyled, line instead of a blank or a crash. Ship it whenever you like — no FE change is
required first.

Why we'd still rather have it: a soft-deleted ingredient is one an owner has already decided is out of
the catalogue. Silently writing off stock against it produces a `WASTE` movement on an item that no
longer appears in `GET /inventory`, so the wastage report shows a cost the owner can't click through to.
Skipping it and saying so is the more explainable behaviour.

If you do add it, please keep the current "one transaction, always 200" contract — a 4th skip reason,
not an error.

## 2. `GET /inventory/expired` uses the server date, the confirm uses Bangkok

**Confirmed harmless from our side. No UI action taken, none needed.**

The confirm screen only ever submits ids taken from the current `GET /inventory/expired` response, so the
window where the confirm would accept a lot the list hasn't surfaced is simply never exercised. The
reverse (list shows something the confirm rejects) is already covered by `not_expired`. We've written the
skew into a comment on `useExpiredInventory()` so nobody "fixes" it client-side.

Please tell us when the list moves to Bangkok — we'll drop that comment, nothing else.

## 3. `TenantUpdate.name = null` → 409 today, 422 later

**Fine. We'll treat both as one "name is required" outcome** and map them to the same Thai copy, so the
change is invisible to us. A ping when it lands lets us delete the 409 branch; it is not urgent.

While you're in there: please make the same call on whether `PATCH` with `{}` stays a 422 with message
`No fields to update` — we gate on it client-side (the save button is disabled when nothing changed), so
it should only ever fire on a race, but we'd like the message string to be stable enough to match on.

## 4. A "list registered feature keys" endpoint

**Yes — the admin portal wants one.** `GET /admin/feature-keys` returning
`[{ "key": "vertical.boardgame", "label": "Board game cafe" }]` (or just the keys) would do.

For this round we're doing what the handoff recommends: hard-coding the registry as a single-entry table
and surfacing the 422 message verbatim. That works, but it carries a failure mode worth naming, because
it costs money rather than showing an error:

> If the backend registry gains a key (say `vertical.bakery`) and a live package already carries it, a
> picker built only from the FE's hard-coded list can't render that key. Saving *any* unrelated edit to
> that package — a price fix, a retire/unretire — would then submit `feature_keys` without it and
> **strip a live entitlement from every tenant on that package**, with no error at all.

We're mitigating it FE-side by building the option list as the union of the local registry and the keys
already on the package, showing unknown-but-present keys checked and flagged. That is a workaround for a
missing endpoint, and it only protects packages we can already see. A real endpoint removes the class.

Priority from us: low-medium. It matters the day the registry grows past one key, not before.

---

## 5. Not a question — a gap we hit while building this

**`POST /api/v1/inventory/waste` has never been written up in any handoff.** The route exists
(`WasteRequest` = `{ item_id, qty > 0, reason: WastageReason, note? ≤500 }` → `InventoryItemRead`) and the
POS has consumed it since the inventory screen was built, but there is no document stating its contract,
so the FE's understanding of it is reverse-engineered from the code.

Could we get a short contract note for it in the next batch? Specifically: whether `qty` may exceed
`stock_on_hand` (we believe yes, with a warning, same as the new batch endpoint), and whether `CANCELED`
is ever accepted on input or is backend-set only (we treat it as backend-set and hide it from the manual
form).

---

## Frontend status

All six items are built and typechecked as of **2026-08-29**. None has been exercised against a deployed
backend — PR #2 was still unmerged — so treat this as "ready for staging", not "verified".

| Train B item | FE status |
|---|---|
| `POST /inventory/expired/waste` | Confirm-and-waste modal: select-all, the 200-id cap, per-lot skip report, idempotent re-post. |
| Wastage report Bangkok buckets | **No change needed** — we never compensated for the UTC shift. Verified and commented. |
| 429 envelope / `RATE_LIMITED` | `ApiError` now carries `error.code` and a parsed `Retry-After`. We separate your two limiters by header first, message second (`/rate limit exceeded/i`), and default an unclassifiable 429 to the 15-minute account lockout. **One thing we'd like confirmed:** that `Retry-After` and `X-RateLimit-*` survive to the client on the deployed setup — see the ask below. |
| `PATCH /admin/tenants/{id}` | Edit modal sending only the changed keys (`''` → `null` = clear, unchanged = omitted). `billing_address` is now read back too — it was write-only before. |
| `feature_keys` picker | Checkbox group over the hard-coded registry, union'd with the package's existing keys (see §4). |
| `customer_id` store scoping | Fixed. A 404 with a member attached now clears the member instead of restoring it, so the dead-id retry loop described below can no longer happen. |

### One small ask

We now read `Retry-After` off the 429. Both our apps reach the API through a Next.js rewrite, so if that
proxy drops the header we lose it silently. If it is cheap on your side, confirming that the header is set
on the per-IP 429 (and deliberately absent on the per-email lockout, as documented) would let us stop
guessing. Our fallbacks are non-null either way, so this is a nice-to-have, not a blocker.
