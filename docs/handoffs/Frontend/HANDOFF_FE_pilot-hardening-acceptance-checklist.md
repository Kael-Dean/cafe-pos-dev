# Pilot Hardening (Train B + B.1) — staging acceptance checklist

**Run against:** staging, after PR #2 (`feat/pilot-hardening`, incl. B.1) merges to `dev` and deploys.
**Sources:** [HANDOFF_FE_pilot-hardening.md](HANDOFF_FE_pilot-hardening.md) (8 original test scenarios) +
[HANDOFF_FE_pilot-hardening-b1.md](HANDOFF_FE_pilot-hardening-b1.md).
**Owner:** frontend runs it; backend items are marked **[BE]** where the check is really about the API.

Nothing below has been run yet — every FE item is `tsc` + lint clean only.

---

## A. Rate limiting (429)

- [ ] **A1 — IP limit envelope.** 6 rapid `POST /api/v1/auth/login` → 429 with
      `error.code === "TOO_MANY_REQUESTS"` and message starting `Rate limit exceeded:`.
- [ ] **A2 — headers exist [BE].** That same 429 carries `Retry-After` (integer ≥ 1),
      `X-RateLimit-Limit`, `X-RateLimit-Remaining: 0`, `X-RateLimit-Reset` (epoch **seconds**).
      *B.1 added these — they genuinely did not exist before, so this is a real check, not a formality.*
- [ ] **A3 — headers survive our proxy.** Repeat A2 through the Next.js rewrite (`localhost:3000` /
      `:3001`, not the API host) and diff the header set against A2. **This is the leg neither side has
      verified.** If `Retry-After` is missing here, the classifier falls back to matching the message and
      the countdown falls back to a constant — degraded, not broken. Record the result either way.
- [ ] **A4 — admin per-email lockout.** 5 failed logins on **one** admin email, spaced >13s apart (so the
      per-minute IP counter never reaches 5), then a 6th with the **correct** password → 429,
      message `Too many attempts, try again later`, and **no** `Retry-After`.
- [ ] **A5 — lockout copy.** A4 shows the 15-minute Thai copy that says the correct password won't work
      either, an `mm:ss` countdown, and a working `ลองใหม่เลย` escape.
- [ ] **A6 — IP copy.** ~7 rapid admin logins with **seven different** emails (keeps every per-email
      counter at 1) → the network-level copy and a ~60s / `Retry-After` countdown, not the 15-minute one.
- [ ] **A7 — lockout is per email.** During A4's window, a different admin email still gets a normal 401,
      and a successful login resets the counter.
- [ ] **A8 — POS staff login.** A bad PIN shows the backend's message, not the generic
      `เข้าสู่ระบบไม่สำเร็จ`. If `/auth/login` is rate limited, a 429 shows the cooldown and disables submit.

## B. Expired stock

- [ ] **B1 — happy path.** Inventory → the "ล็อตหมดอายุ (มีสต็อก)" tile is clickable and keyboard
      focusable; the modal opens with everything checked; confirm → `wasted.length` shown, no skips.
- [ ] **B2 — everything refreshes.** After B1: the expired list, the KPI tile, the item's stock on hand,
      the Wastage tab's movements, and `LotsModal`'s `qty_remaining` all update without a manual reload.
- [ ] **B3 — the movement is right.** The write-off appears with reason `EXPIRED` and note
      `auto — confirmed expiry`, and shows under `EXPIRED` in the wastage report after a manual re-run.
- [ ] **B4 — mixed batch.** 2 expired + 1 future-dated + 1 already-empty + 1 foreign-store id →
      `wasted` has 2; `skipped` has 3 with reasons `not_expired`, `empty`, `not_found`; stock drops by
      exactly the two lots' quantities.
- [ ] **B5 — idempotent re-post.** Submit the same ids again from a second tab → all come back `empty`
      (`บันทึกแล้ว`), nothing double-deducted.
- [ ] **B6 — stale list.** Open the modal, waste a lot from another tab, then confirm in the first →
      skipped rows show the **item name** from the pre-submit snapshot, not a bare cuid.
- [ ] **B7 — `inactive_item` [B.1].** Fetch the list, soft-delete one of those ingredients, then confirm →
      that lot comes back `inactive_item` and renders as `รายการวัตถุดิบถูกลบแล้ว`.
- [ ] **B8 — list excludes inactive items [B.1] [BE].** With a soft-deleted ingredient that still has
      expired stock, `GET /inventory/expired` does **not** list its lots.
- [ ] **B9 — Bangkok date [B.1] [BE].** Between 00:00 and 07:00 Bangkok, a lot that expired "yesterday"
      appears in the list (previously the list used UTC and lagged the confirm).
- [ ] **B10 — 200 cap.** With >200 expired lots: the default selection is 200, the "second pass" note
      shows, and ticking a 201st disables the confirm button.
- [ ] **B11 — selection survives a refetch.** Untick a lot, wait for a background refetch, confirm it is
      still unticked.

## C. Manual wastage

- [ ] **C1 — `CANCELED` rejected [B.1] [BE].** `POST /inventory/waste` with `reason: "CANCELED"` → 422.
      (The UI never offers it; this checks the backend's new guard.)
- [ ] **C2 — inactive item 409.** Wastage on a soft-deleted ingredient shows
      `วัตถุดิบนี้ถูกลบไปแล้ว`, not the raw English `Item is not active`.
- [ ] **C3 — `CANCELED` still renders.** Cancel an order that consumed stock → the write-off shows as
      `ยกเลิกออเดอร์` in movement history and in the wastage report.
- [ ] **C4 — `qty` serialisation.** A normal wastage still succeeds. *(We send `qty` as a JSON number
      where the contract's example shows a decimal string; Pydantic coerces. If this ever 422s, that is
      the cause.)*

## D. Admin — tenants

- [ ] **D1 — minimal PATCH.** Change one field → the request body in DevTools contains **only** that key.
- [ ] **D2 — clear a field.** Empty `legal_name` → body is `{"legal_name": null}` → the detail row reads
      "ไม่ได้ระบุ".
- [ ] **D3 — no-op guarded.** Open the modal and save without changing anything → the save button is
      disabled; the modal just closes.
- [ ] **D4 — `billing_address` round-trips.** Set it, save, reload → it appears in the new detail row.
      *(It was write-only before Train B.)*
- [ ] **D5 — `{}` → 422 [BE].** A raw `PATCH {}` returns 422 with message exactly `No fields to update`,
      and the UI shows the Thai "ไม่มีการเปลี่ยนแปลง" copy.
- [ ] **D6 — `name: null` → 422 not 409 [B.1] [BE].** Raw `PATCH {"name": null}` → 422 whose
      `details[0].msg` mentions `name cannot be null`; the UI puts the error on the name field.
- [ ] **D7 — rejects.** `PATCH {"slug": "x"}` → 422; unknown tenant id → 404 with the "อาจถูกลบไปแล้ว"
      copy; a POS staff token → 401.
- [ ] **D8 — field errors land.** An invalid email and an over-length `tax_id` each surface on their own
      input, not only in a toast.
- [ ] **D9 — stale copy gone.** Neither the detail page nor the create wizard still says
      "เฟสนี้ยังไม่มี endpoint แก้ไข".

## E. Admin — packages / feature keys

- [ ] **E1 — endpoint used [B.1].** Open the package editor → `GET /api/v1/admin/feature-keys` fires and
      the picker renders from its response (Thai label from our local map, English from the API for keys
      we have no Thai for).
- [ ] **E2 — fallback works.** With the endpoint blocked (DevTools offline/block-request), the picker
      still renders `vertical.boardgame` from the local table and is still usable.
      *This is the only item that can be checked **before** the merge — today's staging 404s the endpoint.*
- [ ] **E3 — drift protection (the important one).** Put a fake key on a staging package via the API,
      reload the edit modal → it appears **checked** with the "ไม่รู้จักในเวอร์ชันนี้" tag; save an
      unrelated price change → **the fake key survives**.
- [ ] **E4 — typo rejected [BE].** `feature_keys: ["vertical.bordgame"]` → 422 whose message names
      `vertical.bordgame`, shown verbatim **under the picker**, not only in a toast.
- [ ] **E5 — confirm dialog is honest.** The "affects N paying customers" step fires only when the feature
      set actually changed **and** `affectedTenants > 0` — reordering alone must not trigger it.
- [ ] **E6 — retire/unretire preserves features.** Toggling a package's active flag round-trips
      `feature_keys` unchanged.

## F. Orders

- [ ] **F1 — foreign customer [BE].** Create an order with another store's `customer_id` → 404
      `Customer not found`.
- [ ] **F2 — the member is cleared.** Attach a member, delete that customer server-side, then pay → cart
      restored, member chip **gone**, toast `ข้อมูลสมาชิกใช้ไม่ได้แล้ว`, and a retry succeeds after
      re-scanning.
- [ ] **F3 — no regression.** A 404 with **no** member attached behaves exactly as before (generic
      "บิลบันทึกไม่สำเร็จ" + cart restored).

## G. Reports

- [ ] **G1 — Bangkok buckets.** The wastage report's by-day rows line up with Bangkok calendar days; no
      off-by-one at the day boundary. *(We never compensated for the UTC shift, so this is confirmation,
      not a fix.)*
- [ ] **G2 — expired write-offs appear.** The batch confirm from B1 shows up under reason `EXPIRED` once
      the report is re-run.

---

## Known gaps — not covered by this checklist

- `todayIso()` returns the **UTC** date in 6 POS call sites, so default dates on those forms are wrong
  between 00:00 and 07:00 Bangkok. Pre-existing, unrelated to Train B.
- Table sessions persist their own `customer_id`; the store-scoping 404 handling covers `/orders` and
  `/pre-orders` only, which is what the handoff specified.
- Pre-orders never send `customer_id` at all — the form collects a free-text name and phone.
