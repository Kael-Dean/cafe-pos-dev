# BE Bug — `PATCH /orders/{id}/date` not re-sequencing daily_number / receipt_no

**Date:** 2026-06-22
**Target repo / branch:** `FeatureRichDevelopment/caf-pos-repo` @ `dev`
**Audience:** Backend (FastAPI / Railway)
**Severity:** medium — backdated sales carry the wrong daily running number + receipt number
**Related:** `HANDOFF_2026-06-15_order-backdate-be.md` (the original spec — this is a regression/gap report against it)

---

## TL;DR

When a cashier backdates an order via `PATCH /orders/{order_id}/date`, the deployed
endpoint **moves `created_at` to the new day but leaves `daily_number` and
`receipt_no` unchanged** (still the keyed-in day's values). It must instead claim a
fresh `daily_number` for the **target** day and recompute `receipt_no` — exactly as
`HANDOFF_2026-06-15_order-backdate-be.md` already specified. Looks like the deployed
`dev` build is running a partial version of `set_order_date` (created_at shift only).

The FE side has been fixed in the same change (it now reads back the new
`daily_number` too, not just `receipt_no`), so once BE re-sequences, the slip will
show the correct number with no further FE work.

---

## Repro (observed on live `cafe-pos-dev`)

1. Today (2026-06-22) key an order → it becomes daily **#39**, `receipt_no`
   `IV25690622-0039`.
2. In the receipt modal, change "วันที่ใบเสร็จ" to **2026-06-17** → บันทึกวันที่.
3. Result on the slip:
   - `created_at` → **17/6/2569** ✅ (moved correctly)
   - order no. → **#39** ❌ (should be the next running number for 17 มิ.ย.)
   - `receipt_no` → **IV25690622-0039** ❌ (still the `0622` = 22 มิ.ย. prefix +
     daily `0039`; should be `IV25690617-00NN` for the target day)

Expected: the order is renumbered into the **target day's** sequence — e.g. if
2026-06-17 already had 20 paid orders, the backdated order becomes daily **#21** with
`receipt_no` `IV25690617-0021`.

## Why we know it's the BE response (not the FE)

The current FE already assigns `receiptNo = updated.receipt_no` straight from the
`PATCH .../date` response. The slip still shows `IV25690622-0039` after the move, so
the **response itself** carried the un-recomputed `receipt_no` (and `daily_number`).

---

## Fix

`api/app/services/orders.py → set_order_date(...)` must, inside the existing
transaction, do all of (already written out in the 2026-06-15 handoff):

```python
# Atomically claim the next daily_number for the TARGET store+day.
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
order.daily_number  = new_daily
order.receipt_no    = make_receipt_no(new_date, new_daily)   # <-- both must change
order.created_at    = _shift_to_day(order.created_at, new_date)
```

Please diff the deployed `set_order_date` against the spec in
`HANDOFF_2026-06-15_order-backdate-be.md §2`: the `daily_number` / `receipt_no`
re-claim block appears to be missing or not running on `dev`.

> Same-day move stays a no-op (`if order.business_date == new_date: return order`) —
> don't burn a counter when the date is unchanged.

## QA checklist

- [ ] Backdate an order to a past day that already has sales → `daily_number` becomes
      that day's next running number; `receipt_no` prefix shows the **target** day.
- [ ] `receipt_no` = `make_receipt_no(new_date, new_daily)` (BE-year + target MMDD +
      4-digit daily).
- [ ] Response body returns the updated `daily_number`, `receipt_no`, `business_date`,
      `created_at` together.
- [ ] Same-date call → no extra `daily_number` burned.
- [ ] The order shows the new number in both the POS post-sale modal and the
      "สำเนาใบเสร็จ" list (both already read it back from the response / refetch).

---

## FE status (shipped alongside this report — context only)

`app/src/components/screens/pos.tsx` `onSaveDate` previously refreshed only
`receiptNo`; it now also refreshes `orderNumber` via `displayOrderNo(updated)`, so the
POS post-sale modal reflects the re-sequenced number once the BE returns it.
(`receipt-copies.tsx` already read back `daily_number` — no change needed there.)
