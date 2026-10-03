# BE Handoff — Backdate an order ("แก้วันที่ใบเสร็จ" / past-sale entry)

**Date:** 2026-06-15
**Target repo / branch:** `FeatureRichDevelopment/caf-pos-repo` @ `dev`
**Audience:** Backend (FastAPI / Railway)
**Frontend status:** ✅ already shipped on `cafe-pos-dev` (commit `c13059a`). The FE
button already calls the endpoint below — it currently **404s until this BE ships.**

---

## TL;DR

Add ONE endpoint: `PATCH /orders/{order_id}/date`. It moves an existing order to a
past calendar day so it counts as a sale on that date. No DB migration, no schema
columns, fully backward compatible. The FE sends `{ "business_date": "YYYY-MM-DD" }`
and expects the full updated `OrderRead` back.

This is needed because today the backend **always stamps the server's current date**
(`created_at` + `business_date` via `_business_date()`), and no request accepts a
client-supplied date — so the cashier can't key in yesterday's sales.

---

## Why all four fields must move together

The single source of truth for "which day a sale belongs to" is **`Order.created_at`**:

- `services/reports.py` groups **every** revenue/sales/wastage query by
  `func.date(Order.created_at)` / `date_trunc(..., Order.created_at)` and
  `StockMovement.created_at` — **not** `business_date`.
- The FE "สำเนาใบเสร็จ" (receipt-copies) page filters the day by `created_at`
  (`from`/`to` query params).

`business_date` + `daily_number` drive the per-day running number, and `receipt_no`
embeds the date (`IV{BE-year}{MM}{DD}-{daily:04d}`). So to backdate consistently we
must, in one transaction:

1. claim a fresh `daily_number` for the **target** day (atomic counter, same as create),
2. recompute `receipt_no` for that day,
3. shift `created_at` to the new day (preserving the original time-of-day),
4. shift the order's `StockMovement.created_at` rows too (so inventory/wastage
   reports follow the sale).

> `Order.created_at` and `StockMovement.created_at` use `TimestampMixin`, where only
> `updated_at` has `onupdate=func.now()`. `created_at` has **no** `onupdate`, so
> assigning it manually persists correctly. ✅
>
> Re-allocating `daily_number` leaves a gap in the old day's `OrderDailyCounter`
> (never decremented) — that's fine and matches the append-only convention.

---

## API contract (must match the FE exactly)

```
PATCH /orders/{order_id}/date
Authorization: Bearer <access JWT>
Content-Type: application/json

{ "business_date": "2026-06-10" }      // YYYY-MM-DD, local calendar day
```

- **Auth:** any authenticated store user (use `_BARISTA_PLUS`, like create/pay/void).
- **200 OK** → full `OrderRead` with the updated `business_date`, `daily_number`,
  `receipt_no`, and `created_at`. The FE reads all four off the response.
- **422 UNPROCESSABLE** → `business_date` is in the future.
- **409 CONFLICT** → the order is already `VOID`.
- **404 NOT_FOUND** → order id not in this store.

The FE shows a generic error toast on any non-2xx (it uses the standard
`{"error": {"message": ...}}` envelope), so no special bodies are required.

---

## Changes

### 1. `api/app/schemas/orders.py`

`date` is already imported. Add after `VoidOrderRequest`:

```python
class SetOrderDateRequest(BaseModel):
    """Backdate an order to a past calendar day (for keying in past sales)."""

    business_date: date
```

### 2. `api/app/services/orders.py`

**Imports** — add `Unprocessable` and `SetOrderDateRequest`:

```python
from app.core.errors import Conflict, NotFound, Unprocessable
```
```python
from app.schemas.orders import (
    CreateOrderRequest,
    OrderItemRead,
    OrderRead,
    OrdersPage,
    PayOrderRequest,
    SetOrderDateRequest,   # <-- add
    UpdateStatusRequest,
    VoidOrderRequest,
)
```

**New service** — place it after `void_order`, just before the `# -- helpers --`
section. It reuses the existing `make_receipt_no`, `_business_date`, `_load_order`,
`OrderDailyCounter`, `pg_insert`, `select`, `StockMovement`, and `STORE_TZ` already
in this module:

```python
async def set_order_date(
    db: AsyncSession,
    *,
    store_id: str,
    order_id: str,
    req: SetOrderDateRequest,
) -> Order:
    """Backdate an order to a past day so it counts as a sale on that date.

    Reports and the receipt-copies list group sales by ``created_at``, while
    ``business_date`` drives the daily number + receipt number. To keep a
    backdated sale fully consistent we move all four together: claim a fresh
    ``daily_number`` for the target day, recompute ``receipt_no``, and shift
    ``created_at`` (and the order's stock movements) to the new day, preserving
    each record's original time-of-day.
    """
    new_date = req.business_date
    if new_date > _business_date():
        raise Unprocessable("Cannot set a future date")

    async with db.begin():
        order = await _load_order(db, store_id=store_id, order_id=order_id)
        if order.status == OrderStatus.VOID:
            raise Conflict("Cannot change the date of a voided order")
        if order.business_date == new_date:
            return order  # already on this day — nothing to do

        # Atomically claim the next daily_number for the target store+day, the
        # same way create_order does (serialized by the counter row lock).
        counter_stmt = (
            pg_insert(OrderDailyCounter)
            .values(store_id=store_id, business_date=new_date, last_number=1)
            .on_conflict_do_update(
                index_elements=["store_id", "business_date"],
                set_={"last_number": OrderDailyCounter.last_number + 1},
            )
            .returning(OrderDailyCounter.last_number)
        )
        new_daily = (await db.execute(counter_stmt)).scalar_one()

        order.business_date = new_date
        order.daily_number = new_daily
        order.receipt_no = make_receipt_no(new_date, new_daily)
        order.created_at = _shift_to_day(order.created_at, new_date)

        # Move the order's stock movements too, so inventory/wastage reports
        # (also grouped by created_at) attribute the usage to the backdated day.
        movements = (
            await db.execute(
                select(StockMovement).where(StockMovement.ref_order_id == order.id)
            )
        ).scalars()
        for mv in movements:
            mv.created_at = _shift_to_day(mv.created_at, new_date)

    return order


def _shift_to_day(ts: datetime, new_date: _date) -> datetime:
    """Return ``ts`` moved to ``new_date``, preserving its time-of-day in the
    store timezone (Asia/Bangkok)."""
    local = ts.astimezone(STORE_TZ)
    return datetime.combine(new_date, local.timetz())
```

> Module already has: `from datetime import date as _date`, `from datetime import
> datetime`, `STORE_TZ = ZoneInfo("Asia/Bangkok")`, `make_receipt_no(...)`,
> `_business_date()`, `OrderDailyCounter`, `pg_insert`, `select`, `StockMovement`.
> Nothing else to import.

### 3. `api/app/api/v1/orders.py`

**Imports** — add `SetOrderDateRequest`:

```python
from app.schemas.orders import (
    CreateOrderRequest,
    OrderRead,
    OrdersPage,
    PayOrderRequest,
    PromptPayQRResponse,
    SetOrderDateRequest,   # <-- add
    UpdateStatusRequest,
    VoidOrderRequest,
)
```

**New route** — add alongside the others (e.g. before `promptpay_qr`).
`_BARISTA_PLUS` is already defined in this file:

```python
@router.patch(
    "/{order_id}/date",
    response_model=OrderRead,
    summary="Backdate an order — recomputes daily no., receipt no. + shifts created_at",
    operation_id="orders_set_date",
    dependencies=[Depends(_BARISTA_PLUS)],
)
async def set_order_date(
    order_id: str,
    payload: SetOrderDateRequest,
    user: StoreUser,
    db: DbSession,
) -> OrderRead:
    order = await svc.set_order_date(db, store_id=user.store_id, order_id=order_id, req=payload)
    return await svc.get_order(db, store_id=user.store_id, order_id=order.id)
```

### 4. No migration

No model/column changes → **do not** create an Alembic revision.

---

## Tests — `api/tests/test_orders_service.py`

Add imports (`date`, `timedelta`, `Unprocessable`, `SetOrderDateRequest`) and these
cases. They follow the existing fixtures (`store_a`, `user_a`, `manager_a`,
`product_a`, `inv_beans`) and helpers (`_create_req`) already in the file:

```python
async def test_set_order_date_backdates_order(db, store_a, user_a, product_a):
    """Backdating recomputes business_date, daily_number, receipt_no, created_at."""
    order = await svc.create_order(db, store_id=store_a.id, user_id=user_a.id, req=_create_req(product_a.id))

    past = date.today() - timedelta(days=5)
    updated = await svc.set_order_date(
        db, store_id=store_a.id, order_id=order.id, req=SetOrderDateRequest(business_date=past)
    )

    assert updated.business_date == past
    assert updated.daily_number == 1  # first order claimed for that fresh day
    assert updated.receipt_no == svc.make_receipt_no(past, 1)
    assert updated.created_at.astimezone(svc.STORE_TZ).date() == past


async def test_set_order_date_future_raises(db, store_a, user_a, product_a):
    """A future date can't be set (you can't pre-date a sale)."""
    order = await svc.create_order(db, store_id=store_a.id, user_id=user_a.id, req=_create_req(product_a.id))
    future = date.today() + timedelta(days=1)

    with pytest.raises(Unprocessable):
        await svc.set_order_date(
            db, store_id=store_a.id, order_id=order.id, req=SetOrderDateRequest(business_date=future)
        )


async def test_set_order_date_voided_raises(db, store_a, user_a, manager_a, product_a):
    """A voided order's date can't be changed."""
    order = await svc.create_order(db, store_id=store_a.id, user_id=user_a.id, req=_create_req(product_a.id))
    await svc.void_order(db, store_id=store_a.id, order_id=order.id, user_id=manager_a.id, req=VoidOrderRequest())

    with pytest.raises(Conflict):
        await svc.set_order_date(
            db,
            store_id=store_a.id,
            order_id=order.id,
            req=SetOrderDateRequest(business_date=date.today() - timedelta(days=1)),
        )


async def test_set_order_date_shifts_stock_movements(db, store_a, user_a, product_a, inv_beans):
    """The order's stock movements move to the new day (inventory reports follow)."""
    from app.models.catalog import RecipeItem

    db.add(RecipeItem(product_id=product_a.id, inventory_item_id=inv_beans.id, quantity=Decimal("10")))
    await db.commit()

    order = await svc.create_order(db, store_id=store_a.id, user_id=user_a.id, req=_create_req(product_a.id))
    await db.commit()

    past = date.today() - timedelta(days=3)
    await svc.set_order_date(
        db, store_id=store_a.id, order_id=order.id, req=SetOrderDateRequest(business_date=past)
    )

    movements = list((await db.execute(
        select(StockMovement).where(StockMovement.ref_order_id == order.id)
    )).scalars())
    assert movements
    for mv in movements:
        assert mv.created_at.astimezone(svc.STORE_TZ).date() == past
```

Run: `uv run pytest tests/test_orders_service.py -k set_order_date`
(requires the real Postgres test DB, per repo convention).

---

## QA checklist

- [ ] `PATCH /orders/{id}/date` with a past date → 200; response `business_date`,
      `daily_number`, `receipt_no`, `created_at` all reflect the new day.
- [ ] The order now appears under the new day in the sales report and the
      "สำเนาใบเสร็จ" list (both keyed on `created_at`).
- [ ] `receipt_no` recomputed (`IV` prefix shows the backdated day, daily seq for
      that day).
- [ ] Stock movements for the order moved to the new day (inventory/wastage report).
- [ ] Future date → 422. Already-`VOID` order → 409. Unknown id → 404.
- [ ] A barista (not just manager) can call it — no 403.
- [ ] Same-date call is a no-op (returns the order unchanged, no extra daily_number burned).

---

## FE reference (already shipped — for context only)

- Hook `useSetOrderDate` → `api.patch('/api/v1/orders/{id}/date', { business_date })`,
  invalidates `['kds-orders']` + `['receipt-copies']`.
- A date picker ("วันที่ใบเสร็จ") shows in the receipt modal both **after saving an
  order in POS** and on the **copy preview**; "บันทึกวันที่" calls the endpoint and
  re-renders with the returned `receipt_no` / `created_at`.
- Files: `app/src/hooks/use-orders.ts`, `app/src/components/screens/receipt-modal.tsx`,
  `app/src/components/screens/pos.tsx`, `app/src/components/screens/receipt-copies.tsx`.
