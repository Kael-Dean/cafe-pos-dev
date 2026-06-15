# Reply → Frontend: per-store daily-running order number — **shipped**

**From:** Backend team
**Date:** 2026-06-12
**Re:** `HANDOFF_DAILY_ORDER_NUMBER.md` (per-store daily-reset order number)
**Status:** ✅ Done — and a bit more than you asked for. Two things to note before you wire up (field name + one bonus field set).

---

## TL;DR

Yes, it's done. The backend now assigns and persists a per-store, per-day order number, atomically, at order creation, resetting at **Asia/Bangkok** midnight. It's returned on every order read path and is now also on the `order.created` realtime event.

**One difference from your handoff to flag up front:** we implemented a slightly later/expanded spec (the one in `resources/Completed/daily-order-number-handoff.md`). Concretely:

- The field is named **`daily_number`**, not `daily_order_number`.
- You also get two bonus fields for free: **`business_date`** and **`receipt_no`** (backend-owned, print-ready receipt number).

If you'd genuinely prefer the field be called `daily_order_number`, say so and we'll rename — but `daily_number` is what's live now and what the rest of the spec/tests use.

---

## The API contract (what you consume)

`OrderRead` now includes three new fields, returned by `POST /orders`, `GET /orders/{id}`, and `GET /orders` (`OrdersPage.items[]`):

| Field | Type | Example | Notes |
|---|---|---|---|
| `daily_number` | `int` | `1` | The per-day tag. Format it `#{daily_number:04d}` → `#0001`. Resets to `1` each store-local day. |
| `business_date` | `string` (ISO date) | `"2026-06-12"` | Asia/Bangkok calendar date the order belongs to. |
| `receipt_no` | `string` | `"IV25690612-0001"` | Backend-generated, print-ready. `IV{BuddhistYear}{MM}{DD}-{daily_number:04d}`. Print verbatim — **stop computing the `IV…` string on the client.** |
| `order_number` | `int` | `1042` | **Unchanged.** Global sequence, kept exactly as-is. Still your fallback / global reference. |

`PromptPayQRResponse` also now carries `daily_number`, `business_date`, and `receipt_no` (in addition to `order_number`), so the QR/payment screen can show the receipt number.

Your `daily_number ?? order_number` fallback keeps working — `daily_number` is always present now, so it'll just resolve to the daily value.

---

## Realtime / KDS

The `order.created` Pusher event on channel `kds-store-{store_id}` now includes the new fields (this was the one gap against your handoff — fixed in this change):

```json
{
  "order_id": "…",
  "order_number": 1042,
  "daily_number": 1,
  "business_date": "2026-06-12",
  "receipt_no": "IV25690612-0001",
  "status": "PENDING",
  "channel": "DINE_IN",
  "items": [ { "product_name": "…", "quantity": 1 } ]
}
```

So the KDS ticket can render `#0001` live without a follow-up fetch.

---

## Semantics (matches your acceptance list)

- **Scope:** per store, independent counters. ✅
- **Reset:** at Asia/Bangkok calendar midnight. First order of the day = `1`. ✅
- **Assignment:** at `POST /orders`, inside the create transaction, **atomically** via an `order_daily_counters` upsert (`INSERT … ON CONFLICT (store_id, business_date) DO UPDATE last_number = last_number + 1 RETURNING …`). Two simultaneous checkouts serialize on the counter row → distinct consecutive numbers, never a duplicate. ✅
- **Immutable:** stored on the order row, never recomputed on read. ✅
- **Uniqueness:** `UNIQUE (store_id, business_date, daily_number)` + `UNIQUE (store_id, receipt_no)` as belt-and-suspenders. ✅
- **Gaps:** a voided order **keeps** its `daily_number`; siblings are not renumbered. ✅
- **Idempotency nuance — please read:** a retried `POST /orders` with a duplicate `idempotency_key` returns **409 `CONFLICT`** (`{"error":{"code":"CONFLICT","message":"Duplicate idempotency_key — order already exists"}}`), it does **not** return the original order body. This is the pre-existing idempotency contract, unchanged by this feature. The counter is **not** consumed on a duplicate (the idempotency check runs before allocation), and the original order's `daily_number` is immutable — so re-fetching that order via `GET /orders/{id}` returns the same number. If you were expecting the retry itself to echo the original order, that's a separate conversation.

---

## Migration / backfill

- Alembic revision **`0023_daily_order_number`** (note: your handoff guessed `0021`; actual head landed it at `0023`). Adds the three columns, creates `order_daily_counters`, backfills existing orders (business_date from `created_at` AT TIME ZONE 'Asia/Bangkok'; `daily_number` = row-number per store/day ordered by `created_at, order_number`; `receipt_no` from the Buddhist-year format; seeds the counter table to the per-day max), then sets `NOT NULL` and adds the constraints/index. Historical receipt reprints will show correct daily numbers.

---

## Verified

- `tests/test_orders_service.py` green (daily reset, per-store isolation, void-leaves-a-gap, receipt format, timezone boundary).
- Backend assigns/serves the number; client should drop any client-side `IV…` formatting and use `receipt_no` verbatim, and display the tag as `#{daily_number:04d}`.

## Open question for you

1. Keep field name `daily_number`, or rename to `daily_order_number` as your handoff originally wrote? Default: keep `daily_number`.
