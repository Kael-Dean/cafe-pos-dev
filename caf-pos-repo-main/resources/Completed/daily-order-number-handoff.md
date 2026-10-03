# Backend Handoff — Daily-Reset Order Number + Backend-Generated Receipt Number

**Audience:** the backend (`caf-pos-repo-main/api`, FastAPI + SQLAlchemy async + Alembic, deployed on Railway).
**Author:** frontend/POS side. This document is self-contained — you do not need the frontend repo to implement it.
**Status:** spec only. No backend code has been written yet.

---

## 1. Goal

The POS currently has two numbering problems:

1. **Order "tag" never resets.** `orders.order_number` comes from a **global** Postgres sequence
   `order_number_seq` (starts at 1001) and is monotonic across all stores and all days. The shop wants
   the **first order of each day to be `#0001`**, resetting daily, per store.

2. **Receipt number is computed on the client and is fragile.** The frontend builds the receipt number
   (`เลขที่ใบเสร็จ`) in three different places as
   `IV{BuddhistYear}{MM}{DD}-{order_number zero-padded to 4}` (e.g. `IV25690610-1047`). Because it pads
   the **global** `order_number`, it (a) is never `-0001`, and (b) overflows 4 digits once the global
   counter passes 9999. We want the **backend to own the receipt number** as the single source of truth.

### What we want you to build

- A **per-store, per-business-day** order number that **resets to 1 each day** (`daily_number`),
  assigned **at order creation**, **atomically**, and **immutably** (stored on the row, never recomputed).
- A backend-generated, globally-unique, stored **`receipt_no`** derived from that daily number + date.
- Expose `daily_number`, `business_date`, and `receipt_no` on the order API response.

### Decisions already made (do not re-litigate)

| Decision | Choice | Rationale |
|---|---|---|
| Where the number is assigned | **Backend** | Authoritative, race-safe, immutable. Client cannot guarantee uniqueness across terminals. |
| When the number is assigned | **At order creation** (the `POST /orders` insert, status `PENDING`) | Kitchen/KDS needs the tag immediately; create+pay happen back-to-back in this POS. |
| Voided / failed-payment orders | **Keep their number → gaps are allowed** | A consumed receipt number must never be reused (tax integrity). Gaps are auditable and expected. |
| Receipt number owner | **Backend** | One source of truth; client and print bridge stop computing it. |
| Keep the global `order_number`? | **Yes — keep it unchanged** | It is referenced by FIFO inventory logs, void logs, PromptPay QR, and all existing data. We **add** fields, we do not repurpose `order_number`. |

---

## 2. Data model changes

### 2.1 New columns on `orders`

| Column | Type | Notes |
|---|---|---|
| `business_date` | `DATE NOT NULL` | The **Asia/Bangkok** calendar date at the moment of creation. The reset key. |
| `daily_number` | `INTEGER NOT NULL` | Per `(store_id, business_date)` counter, **starts at 1**. This is the `#0001` tag. |
| `receipt_no` | `VARCHAR(32) NOT NULL` | Fully-formed receipt number, stored once at creation, never changed. |

### 2.2 New counter table

```text
order_daily_counters
  store_id       <FK type matching orders.store_id, e.g. String(24)>   NOT NULL
  business_date  DATE                                                  NOT NULL
  last_number    INTEGER                                               NOT NULL
  PRIMARY KEY (store_id, business_date)
```

This table is the atomic allocator (see §4). One row per store per day; `last_number` is the highest
daily number handed out so far for that store/day.

### 2.3 Constraints & indexes

- `UNIQUE (store_id, business_date, daily_number)` on `orders`
  → hard guarantee that two orders can never share `#0001` for the same store/day, even under a race.
- `UNIQUE (receipt_no)` on `orders`
  → tax-grade global uniqueness of the receipt number.
- `INDEX (store_id, business_date)` on `orders`
  → fast "all orders for this shop on this day" queries (the receipt-copies / daily-report path).

---

## 3. Timezone — "what is a new day?"

- Use **`Asia/Bangkok`** (UTC+7, no DST).
- `business_date = (created_at in Asia/Bangkok).date()`.
  `created_at` is stored in UTC, so compute the local date explicitly. In Postgres:
  `(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Bangkok')::date` (or simply
  `(created_at AT TIME ZONE 'Asia/Bangkok')::date` if `created_at` is a `timestamptz`).
  In Python: `datetime.now(ZoneInfo("Asia/Bangkok")).date()`.
- **Do not** derive the day from UTC midnight — that would reset the counter at 07:00 local, splitting a
  business day in half.
- If a `Store.timezone` column exists or is added later, prefer it; otherwise hardcode `Asia/Bangkok` as a
  module constant `STORE_TZ = ZoneInfo("Asia/Bangkok")`.
- **Optional (only if the shop asks):** a business-day cutoff for shops open past midnight — e.g. orders
  before 04:00 count as the previous business day: `business_date = (local_dt - timedelta(hours=4)).date()`.
  **Default = calendar midnight (no cutoff).** Make it a single constant if you implement it.

---

## 4. Atomic assignment (recommended mechanism)

Do this **inside the existing transaction** in `create_order()`
(`app/services/orders.py`, the `async with db.begin():` block), **before** flushing the `Order`.

The current code builds the `Order` like this (abridged):

```python
order = Order(
    store_id=store_id,
    status=OrderStatus.PENDING,
    channel=req.channel,
    ...
)
db.add(order)
await db.flush()
```

Insert the allocation step right before constructing the order:

```python
from datetime import datetime
from zoneinfo import ZoneInfo
from sqlalchemy.dialects.postgresql import insert as pg_insert

STORE_TZ = ZoneInfo("Asia/Bangkok")

business_date = datetime.now(STORE_TZ).date()

# Atomic upsert: create the day's counter at 1, or bump it by 1. Returns the value to use.
stmt = (
    pg_insert(OrderDailyCounter)
    .values(store_id=store_id, business_date=business_date, last_number=1)
    .on_conflict_do_update(
        index_elements=["store_id", "business_date"],
        set_={"last_number": OrderDailyCounter.last_number + 1},
    )
    .returning(OrderDailyCounter.last_number)
)
daily_number = (await db.execute(stmt)).scalar_one()

receipt_no = make_receipt_no(business_date, daily_number)  # see §5

order = Order(
    store_id=store_id,
    status=OrderStatus.PENDING,
    channel=req.channel,
    business_date=business_date,
    daily_number=daily_number,
    receipt_no=receipt_no,
    ...
)
db.add(order)
await db.flush()
```

### Why this is correct

- **Race-safe:** the `ON CONFLICT DO UPDATE` takes a row lock on the `(store_id, business_date)` counter
  row. Two concurrent `create_order` transactions serialize on it — one waits for the other to
  commit/rollback, then reads the updated value. No two orders get the same `daily_number`.
- **No gap on rollback:** the counter bump shares the order's transaction. If the create fails and rolls
  back, the counter increment rolls back too — the number is not wasted.
- **Gaps only from voids:** a void/refund happens later in a **separate** transaction and does **not**
  decrement the counter. That order keeps its number; the gap is intentional and correct for tax/audit.
- The `UNIQUE (store_id, business_date, daily_number)` constraint is a belt-and-suspenders backstop.

### Acceptable alternative (if you prefer not to add a table)

Within the create transaction:
```sql
SELECT COALESCE(MAX(daily_number), 0) + 1
FROM orders
WHERE store_id = :store_id AND business_date = :business_date
FOR UPDATE;   -- requires locking; or rely on the unique constraint + retry on IntegrityError
```
This works but needs either explicit locking or a retry loop on unique-violation. **We recommend the
counter table (cleaner, lock-free retries, single round trip).**

---

## 5. Receipt number format

Match the series the shop has already been printing so the tax sequence stays continuous:

```
IV{BuddhistYear}{MM}{DD}-{daily_number:04d}
```

- `BuddhistYear = business_date.year + 543`
- `MM`, `DD` are two-digit month/day from `business_date`
- `daily_number` zero-padded to **at least** 4 digits

Example: business_date `2026-06-10`, daily_number `1` → **`IV25690610-0001`**.

```python
def make_receipt_no(business_date, daily_number: int) -> str:
    be_year = business_date.year + 543
    return f"IV{be_year}{business_date.month:02d}{business_date.day:02d}-{daily_number:04d}"
```

> Note: the existing frontend uses the **Buddhist** year. Keep Buddhist by default for continuity.
> Switch to Gregorian only if the shop explicitly agrees (it changes the printed receipt-number series).

---

## 6. API response contract (this is what the frontend will consume)

Add these fields to `OrderRead` in `app/schemas/orders.py` (and they will be returned by
`POST /orders`, `PATCH /orders/{id}/pay`, `GET /orders`, `GET /orders/{id}`):

```python
class OrderRead(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    order_number: int        # keep — global reference, unchanged
    daily_number: int        # NEW — the per-day tag, e.g. 1 → displayed as #0001
    business_date: date      # NEW — Asia/Bangkok calendar date
    receipt_no: str          # NEW — e.g. "IV25690610-0001"
    store_id: str
    ...                      # everything else unchanged
```

- Also add the three fields to **`PromptPayQRResponse`** if you want the QR/payment screen to show the
  receipt number (optional but nice — it already returns `order_number`).
- Keep `order_number` in the response — the frontend still references it during the transition and for
  internal/global lookups.

The frontend expects:
- `daily_number` as a plain integer (it will format `#{daily_number:04d}` for display).
- `receipt_no` as the final string to print verbatim (no client-side reformatting).
- `business_date` as an ISO date string `YYYY-MM-DD`.

---

## 7. Backfill (in the same Alembic migration)

New migration id: **`0020_daily_order_number`** (current head is `0019_add_promotions`).

Steps:

1. Add the three columns to `orders` as **nullable** first.
2. Create `order_daily_counters`.
3. Backfill existing orders:
   ```sql
   -- business_date from created_at in Asia/Bangkok
   UPDATE orders
   SET business_date = (created_at AT TIME ZONE 'Asia/Bangkok')::date;

   -- daily_number = creation order within (store, business_date)
   WITH numbered AS (
     SELECT id,
            ROW_NUMBER() OVER (
              PARTITION BY store_id, business_date
              ORDER BY created_at, order_number
            ) AS rn
     FROM orders
   )
   UPDATE orders o
   SET daily_number = n.rn
   FROM numbered n
   WHERE o.id = n.id;

   -- receipt_no from business_date + daily_number (Buddhist year)
   UPDATE orders
   SET receipt_no =
     'IV'
     || (EXTRACT(YEAR FROM business_date)::int + 543)::text
     || lpad(EXTRACT(MONTH FROM business_date)::int::text, 2, '0')
     || lpad(EXTRACT(DAY   FROM business_date)::int::text, 2, '0')
     || '-'
     || lpad(daily_number::text, 4, '0');

   -- seed the counter table to the current max per store/day
   INSERT INTO order_daily_counters (store_id, business_date, last_number)
   SELECT store_id, business_date, MAX(daily_number)
   FROM orders
   GROUP BY store_id, business_date;
   ```
4. `ALTER COLUMN ... SET NOT NULL` on the three columns.
5. Add `UNIQUE (store_id, business_date, daily_number)`, `UNIQUE (receipt_no)`, and
   `INDEX (store_id, business_date)`.

> If `created_at` is a naive `timestamp` (not `timestamptz`), use
> `(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Bangkok')::date` for the backfill so it converts
> from UTC correctly.

Provide a `downgrade()` that drops the constraints, columns, and the counter table.

---

## 8. Edge cases to handle / document

| Case | Expected behaviour |
|---|---|
| Two cashiers create orders at the same instant | Counter upsert serializes them; they get consecutive `daily_number`s; no collision. |
| Order creation rolls back mid-transaction | Counter bump rolls back with it; the number is **not** consumed; no gap. |
| Order voided / payment failed after creation | Number stays consumed; a **gap** appears in the sequence. This is intended. |
| More than 9999 orders in one day | `daily_number` naturally becomes 5 digits; `:04d` is a **minimum** width, not a cap. `receipt_no` is still unique thanks to the date prefix. |
| Order created at 23:59:30 vs 00:00:30 Bangkok | They land on **different** `business_date`s; the second is `#0001` of the new day. |
| Two stores, same day | Independent counters; each store has its own `#0001`. |

---

## 9. Tests to add (backend)

1. **Daily reset:** create N orders on day D for a store → numbers 1..N; first order on day D+1 → number 1.
2. **Per-store isolation:** interleave orders for store A and store B on the same day → each gets its own
   1..k sequence.
3. **Concurrency:** fire several `create_order` calls concurrently for the same store/day → all
   `daily_number`s distinct and contiguous (use the unique constraint as the assertion).
4. **Void leaves a gap:** create 3, void #2, create a 4th → numbers are 1, 2(void), 3, 4 (no reuse of 2).
5. **Backfill correctness:** seed legacy orders with known `created_at`/`store_id`, run the migration,
   assert `business_date`, `daily_number`, `receipt_no`, and the counter seed values.
6. **Timezone boundary:** orders with `created_at` UTC `16:30` (=23:30 Bangkok) and `17:30` (=00:30
   Bangkok next day) → different `business_date`s.
7. **Receipt format:** `daily_number=1`, `business_date=2026-06-10` → `receipt_no == "IV25690610-0001"`.

---

## 10. Frontend follow-up (FYI — not your job, but defines the contract)

Once the API returns `daily_number`, `business_date`, and `receipt_no`, the POS frontend will:

- Display the order tag as `#{daily_number:04d}` (KDS tickets, POS toast, receipt header).
- Print `receipt_no` verbatim and **stop** computing the `IV...` number on the client and in the print
  bridge (removing the three duplicated client-side formatters).

So please make sure the response fields are named exactly **`daily_number`**, **`business_date`**,
**`receipt_no`**, and that `receipt_no` is the final, print-ready string.

---

## 11. Summary checklist for the backend implementer

- [ ] Alembic `0020_daily_order_number`: add `business_date`, `daily_number`, `receipt_no` to `orders`;
      create `order_daily_counters`; backfill; add unique/index constraints; NOT NULL.
- [ ] `OrderDailyCounter` model.
- [ ] `Order` model: add the three columns.
- [ ] `make_receipt_no(business_date, daily_number)` helper (Buddhist year).
- [ ] `create_order()`: compute `business_date` (Asia/Bangkok), atomic counter upsert → `daily_number`,
      build `receipt_no`, set all three on the `Order` inside the existing transaction.
- [ ] `OrderRead` (+ optionally `PromptPayQRResponse`): expose `daily_number`, `business_date`, `receipt_no`.
- [ ] Tests from §9.
