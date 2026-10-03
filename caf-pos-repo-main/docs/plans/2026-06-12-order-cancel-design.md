# Order Cancellation Design — reuse VOID, add restock/waste choice

**Date:** 2026-06-12
**Status:** Approved, ready for implementation
**Scope:** `api/` backend only. Frontend (Vercel repo) handed off as a spec.

## Problem

Staff have no way to cancel an order once it's placed — test orders and wrong
orders are stuck. We want a "canceled" state that keeps the order (never
deletes), records a reason, and reverts both stock and money.

## Key finding

The backend **already implements this** as the `VOID` flow
(`services/orders.py:void_order`, `POST /orders/{id}/void`):

- Order kept, flipped to `OrderStatus.VOID` (never deleted).
- Stock deductions reversed (restores `stock_on_hand`, recreates `StockLot`s,
  writes compensating `ADJUST` movements — append-only, per repo convention).
- Reason captured in `order_void_logs` (who + free text).
- Membership points earned on the order are reversed.
- Realtime `order.voided` event fires to the KDS.
- Works at **any** status (`IN_PROGRESS`, `READY`, `COMPLETED`).

**Money reverts automatically via status** — no refund ledger needed:
- Revenue reports count only `_REVENUE_STATUSES`, which excludes `VOID`
  (`reports.py`).
- Cash-drawer reconciliation sums only `status == PAID` orders (`hr.py`), so a
  voided paid order drops out of the drawer's expected total by exactly its
  amount.

## Decisions

1. **Reuse `VOID`**, do not add a new `CANCELLED` enum value. Avoids an Alembic
   migration and touching reports / cash recon / transitions. The word "Cancel /
   ยกเลิก" is a frontend label only.
2. **Add a per-cancel restock choice.** Today void always restocks, which lies
   about inventory when the item was already made. Staff choose:
   - **Caught early (not made):** restore stock — today's behavior.
   - **Already made (test/wrong order):** ingredients were physically used →
     write off as **waste**, do not inflate inventory.
3. **Remove the role gate** (for now). `/void` moves from Manager/Owner only to
   any store role (matches create/pay/status). Still requires an authenticated
   `StoreUser`.

## Backend changes

### `schemas/orders.py`
```python
class VoidOrderRequest(BaseModel):
    reason: str | None = None
    restock: bool = True   # False = already made → write off as waste
```
Default `True` preserves current behavior — fully backward compatible.

### `services/orders.py`
- Parametrize `_deduct_fifo` with `movement_type: MovementType = MovementType.SALE`.
- In `void_order`: keep the existing SALE-reversal loop (restores stock + lots +
  `ADJUST`) for **both** branches. When `restock=False`, additionally consume the
  same per-item quantities again as `WASTE` via `_deduct_fifo(..., movement_type=
  WASTE, reason=_encode_waste_reason(WastageReason.TRIAL, f"Canceled order #..."))`.
  Net stock stays down, and the loss is correctly attributed to waste (shows in
  the wastage report) instead of a phantom sale.
- Add `restock` to the `order.voided` pusher payload so the KDS can distinguish
  "canceled — already made" from "canceled — voided".

Resulting movement trail per item:
```
restock=True :  SALE -qty , ADJUST +qty                  (net 0, stock restored)
restock=False:  SALE -qty , ADJUST +qty , WASTE -qty      (net -qty, attributed to waste)
```

### `api/v1/orders.py`
- `/void` dependency: `_MANAGER_PLUS` → `_BARISTA_PLUS`.

## API contract (unchanged route)
```
POST /orders/{order_id}/void          # any store role
Body: { "reason": "ลูกค้าสั่งผิด", "restock": false }
200 → OrderRead (status "VOID")
409 → already voided
```

## Frontend spec (Vercel repo — not built here)
1. **Cancel button** on order detail + KDS ticket.
2. **Confirm dialog:** reason field + toggle "ทำเสร็จแล้ว / Already made?"
   (on → `restock: false`; default off → `restock: true`).
3. Labels say "Cancel / ยกเลิก" — never show "void" to staff.
4. On `order.voided` event → remove/grey the KDS ticket.
5. Receipt/history shows canceled orders struck through with reason, not hidden.

## Tests (`tests/test_orders_service.py`, real Postgres)
1. `restock=True` restores stock; `ADJUST +qty` present, no `WASTE`.
2. `restock=False` keeps stock down; trail is `SALE, ADJUST(+), WASTE(-)`.
3. Field omitted → behaves as `restock=True` (backward-compat).
4. Voided order excluded from revenue report and cash-session `system_total`.
5. Void succeeds at `IN_PROGRESS`, `READY`, `COMPLETED`.
6. Double-void → `409`.
7. `BARISTA` can now void (gate widened); update any barista-forbidden assertion.
8. Membership points reversal still fires.
