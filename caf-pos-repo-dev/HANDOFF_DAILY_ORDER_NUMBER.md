# Handoff → Backend: per-store daily-running order number (`daily_order_number`)

**From:** Frontend team
**Date:** 2026-06-12
**Type:** New field on the order read model + realtime payload
**Priority:** Medium (frontend ships a graceful fallback now; this lights it up)

---

## Why

The POS needs to print and display a **human-friendly order number that resets every day, per store** — i.e. the first sale of the day is order **#1**, the next **#2**, and so on, restarting at **1** the next calendar day. This is what cashiers and customers expect on a receipt ("ออเดอร์ #7 วันนี้"), and it feeds the kitchen display (KDS) queue.

Today the only number you return is **`order_number`**, a single global Postgres sequence (`order_number_seq`, `START 1001`, `+1` per order, **shared across every store, never resets**) — see `api/app/models/orders.py:27-41`. That value is fine as a stable internal id and the frontend keeps using it as a fallback, but it is **not** a per-day, per-store number, and there is no way for the frontend to derive one reliably (no per-day endpoint; counting today's orders client-side races with voids and concurrent checkouts).

So we need the backend to assign and persist it.

## What we need

Add a new field **`daily_order_number: int`** to the order, with these semantics:

| Property | Requirement |
|---|---|
| **Scope** | Per **store** (each store counts independently). |
| **Reset boundary** | Resets to `1` at the start of each **store-local calendar day** — timezone **Asia/Bangkok** (the stores are in Thailand). First order of the day = `1`. |
| **Assignment time** | At **order creation** (`POST /orders`), inside the same transaction that creates the order. |
| **Persistence** | Stored on the order row, **immutable** after creation. Never recomputed on read. |
| **Uniqueness** | Unique per `(store_id, store-local date)`. |
| **Gaps** | Allowed. A voided order **keeps** its `daily_order_number` (do not renumber siblings). |
| **Concurrency** | Assignment must be **atomic** — two simultaneous checkouts in the same store on the same day must get distinct consecutive numbers, never a duplicate. |
| **Idempotency** | A retried `POST /orders` with the same `idempotency_key` must return the **same** `daily_order_number` as the original (it already returns the same order; just make sure the number was assigned once, at first creation). |
| **Keep** | Leave the existing global `order_number` exactly as-is. Do **not** remove or repurpose it. |

### Suggested implementation (your call)

Either is fine as long as it's atomic and correct under concurrency:

1. **Counter table** — a `store_daily_order_counters(store_id, business_date, last_number)` row; inside the create transaction, `INSERT ... ON CONFLICT (store_id, business_date) DO UPDATE SET last_number = last_number + 1 RETURNING last_number`. This is race-safe via the upsert and avoids a full table scan.
2. **Count + 1** — inside the create transaction (which already runs under `async with db.begin()`), `SELECT count(*) ... WHERE store_id = :s AND created_at` within the store-local day, then `+1`. Simpler, but make sure the isolation level / locking prevents two concurrent inserts from reading the same count (option 1 is safer).

`business_date` should be derived from the order's creation time converted to **Asia/Bangkok**, so a sale at 00:30 local belongs to the new day even though the UTC `created_at` may still read the previous date.

## Where to touch

- **Model:** `api/app/models/orders.py` — add `daily_order_number: Mapped[int]` to `Order` (and the counter table if you go that route).
- **Create logic:** `api/app/services/orders.py` — assign it in `create_order` where the `Order(...)` is built (`:99-112`).
- **Read schema:** `api/app/schemas/orders.py` — add `daily_order_number: int` to `OrderRead` (`:53-72`).
- **Read mapper:** `api/app/services/orders.py` `_order_to_read` (`:462-483`) — include `daily_order_number=order.daily_order_number`.
- **Realtime / KDS:** `api/app/services/orders.py` `_publish_order_created` (`:501+`) — add `"daily_order_number": order.daily_order_number` to the `order.created` payload (the KDS reads the number live from this event, so it must be present here too).
- **Migration:** new Alembic revision (next is `0021_*`) adding the column (+ counter table). Backfill existing rows if you like — the frontend does not require a backfill (old orders fall back to the global `order_number`), but a per-day backfill ordered by `created_at` would make historical receipt reprints show the correct daily number.

## What the frontend does with it

- Displays `daily_order_number` as **the** order number on: POS checkout toast, the on-screen + printed receipt header ("ออเดอร์ #N"), the receipt "เลขที่" line (`IV{พ.ศ.}{MMDD}-{NNNN}` — the `NNNN` becomes the daily number), the KDS ticket queue, and the "today's copies" reprint screen.
- Uses `daily_order_number ?? order_number` everywhere, so **the frontend already works before you ship this** — it just shows the global number until the field appears.
- Multi-day views (member order history) intentionally keep showing the global `order_number`, since a daily-reset number is ambiguous without a date.

## Acceptance

- `POST /orders`, `GET /orders/{id}`, `GET /orders` (`OrdersPage.items[]`) all return `daily_order_number`.
- The `order.created` Pusher event includes `daily_order_number`.
- Two orders created in the same store on the same local day return `1` then `2`; the first order created after midnight Asia/Bangkok returns `1` again.
- A retried create (same `idempotency_key`) returns the original `daily_order_number`.
- Voiding order #2 leaves #1 and #3 unchanged.
