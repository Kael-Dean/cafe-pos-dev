# Batch Receipt Inventory Design

**Date:** 2026-05-14  
**Status:** Approved  
**Scope:** Backend — inventory receiving, lot tracking, FIFO deduction

---

## Problem

Stock receiving is currently one-item-at-a-time via `POST /inventory/receive`. In practice, purchasing happens per supplier bill/receipt covering multiple ingredients at once. There is no lot tracking, so expiry dates are flat fields on the ingredient definition and cost-per-unit is overwritten on every receive — making real COGS tracking and FIFO rotation impossible.

---

## Goals

- Receive stock by receipt/bill: create a draft, add ingredient lines, confirm atomically
- Track stock as lots so oldest stock is consumed first (soft FIFO)
- Per-lot expiry dates and cost-per-unit for accurate food cost tracking
- Supplier price history and receipt reference numbers for accounting

## Non-Goals

- Hard FIFO (tracing exactly which lot each order consumed) — deferred
- Supplier entity with its own CRUD — supplier name stays free text
- Receipt voiding — corrections go through the existing ADJUST flow

---

## Approach

Full lot model: two new tables (`stock_receipts`, `stock_lots`). The receipt header groups a purchasing event; each lot is one ingredient line with its own quantity, cost, and expiry. FIFO deduction in the order service walks lots oldest-first by `created_at`. `InventoryItem.stock_on_hand` is kept as a denormalized cache for fast list queries.

---

## Data Model

### New table: `stock_receipts`

| Column | Type | Notes |
|---|---|---|
| `id` | String(24) CUID | PK |
| `store_id` | String(24) FK → stores | |
| `status` | Enum: DRAFT, CONFIRMED | |
| `supplier_name` | String(120) nullable | free text |
| `receipt_ref` | String(80) nullable | supplier invoice/bill number |
| `note` | Text nullable | |
| `received_at` | Date | actual date on the receipt; defaults to today |
| `created_by_id` | String(24) FK → users | |
| `created_at` | DateTime | when entered into the system |

### New table: `stock_lots`

| Column | Type | Notes |
|---|---|---|
| `id` | String(24) CUID | PK |
| `store_id` | String(24) FK → stores | |
| `receipt_id` | String(24) FK → stock_receipts | |
| `inventory_item_id` | String(24) FK → inventory_items | |
| `qty_received` | Numeric(12,3) | original amount; never changes |
| `qty_remaining` | Numeric(12,3) | decremented by FIFO deductions |
| `cost_per_unit` | Numeric(12,4) | |
| `expiry_date` | Date nullable | |
| `created_at` | DateTime | used for FIFO ordering (oldest first) |

Index: `(inventory_item_id, qty_remaining, created_at)` — supports the FIFO deduction query.

### Changes to `inventory_items`

- `expiry_date` column **removed** — expiry now lives per lot
- `cost_per_unit` stays — updated to the cost of the most recently confirmed lot for that item on receipt confirmation; used for display and COGS reports
- `stock_on_hand` stays — denormalized cache, updated atomically on confirm and on FIFO deduction

### Migration

- Creates `stock_receipts` and `stock_lots` tables
- Drops `expiry_date` from `inventory_items`
- Zeros `stock_on_hand` on all inventory items (current data is mock)

---

## API

### Removed

| Method | Path |
|---|---|
| POST | `/inventory/receive` |

### New endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/inventory/{item_id}/lots` | BARISTA+ | List lots for one ingredient, ordered oldest-first. Query param: `status=active\|all` |
| POST | `/inventory/receipts` | MANAGER+ | Create a DRAFT receipt |
| GET | `/inventory/receipts` | MANAGER+ | Paginated list of receipts (summary, no lots). Filter: `status=DRAFT\|CONFIRMED` |
| GET | `/inventory/receipts/{receipt_id}` | MANAGER+ | Get receipt with all lots |
| POST | `/inventory/receipts/{receipt_id}/lots` | MANAGER+ | Add a lot to a DRAFT receipt |
| DELETE | `/inventory/receipts/{receipt_id}/lots/{lot_id}` | MANAGER+ | Remove a lot from a DRAFT receipt |
| POST | `/inventory/receipts/{receipt_id}/confirm` | MANAGER+ | Confirm receipt — applies stock atomically, locks receipt |

### Updated endpoint

`GET /inventory/expired` — now queries `stock_lots` where `expiry_date < today AND qty_remaining > 0`. Response shape changes to `list[ExpiredLotRead]` (see Schemas).

### Confirm behavior (atomic transaction)

1. Assert receipt is `DRAFT` and has ≥ 1 lot → else 422
2. Set `receipt.status = CONFIRMED`
3. For each lot:
   - Create `StockMovement(type=RECEIVE)` to keep audit log intact
   - `inventory_item.stock_on_hand += lot.qty_received`
   - If this lot's `received_at` is the most recent for the item, update `inventory_item.cost_per_unit`

---

## Schemas

### Removed

- `ReceiveStockRequest`

### Modified

- `InventoryItemCreate` — remove `expiry_date`
- `InventoryItemRead` — remove `expiry_date`
- `InventoryItemUpdate` — remove `expiry_date`

### New

**`StockReceiptCreate`**
```
supplier_name  str | None
receipt_ref    str | None
note           str | None
received_at    date          (default: today)
```

**`StockLotCreate`**
```
inventory_item_id  str
qty_received       Decimal   (> 0)
cost_per_unit      Decimal   (>= 0)
expiry_date        date | None
```

**`StockLotRead`**
```
id                   str
inventory_item_id    str
inventory_item_name  str
qty_received         Decimal
qty_remaining        Decimal
cost_per_unit        Decimal
expiry_date          date | None
created_at           datetime
```

**`StockReceiptRead`**
```
id             str
status         str            ("DRAFT" | "CONFIRMED")
supplier_name  str | None
receipt_ref    str | None
note           str | None
received_at    date
created_by     CreatedBy      ({id, name})
created_at     datetime
lots           list[StockLotRead]
```

**`StockReceiptSummary`** (paginated list — no lots)
```
id             str
status         str
supplier_name  str | None
receipt_ref    str | None
received_at    date
lot_count      int
created_at     datetime
```

**`StockReceiptsPage`**
```
items        list[StockReceiptSummary]
next_cursor  str | None
```

**`ExpiredLotRead`** (replaces returning InventoryItemRead from /expired)
```
lot_id               str
inventory_item_id    str
inventory_item_name  str
unit                 str
qty_remaining        Decimal
expiry_date          date
```

---

## FIFO Deduction (Order Service)

A new private helper `_deduct_fifo(db, store_id, inventory_item_id, qty)` replaces the direct `stock_on_hand` decrement in `services/orders.py`.

**Algorithm:**
1. Query `StockLot` where `inventory_item_id = X AND store_id = Y AND qty_remaining > 0`, ordered by `created_at ASC`
2. Walk lots oldest-first, decrementing `qty_remaining` until the full quantity is consumed
3. Decrement `InventoryItem.stock_on_hand` by the total qty consumed
4. Log one `StockMovement(type=SALE)` per ingredient (same as today)

**Negative stock:** if all lots are exhausted before the full qty is consumed, the remaining balance is applied as a negative to `InventoryItem.stock_on_hand`. Allowed with a warning log — matches existing policy.

**Order cancellation:** when an order is cancelled, a synthetic `StockReceipt(status=CONFIRMED, receipt_ref="ORDER_CANCEL", store_id=store_id)` is created and a compensating lot (`qty_received = qty_remaining = restored_qty`) is attached to it. `InventoryItem.stock_on_hand` is incremented accordingly. This restores stock without trying to reverse into specific old lots.

---

## Error Codes

| Code | Status | Trigger |
|---|---|---|
| `RECEIPT_ALREADY_CONFIRMED` | 409 | Adding/removing lots from or re-confirming a CONFIRMED receipt |
| `RECEIPT_HAS_NO_LOTS` | 422 | Confirming a receipt with zero lots |
| `INVENTORY_ITEM_NOT_FOUND` | 404 | Lot references an item not in this store |
| `INVALID_QUANTITY` | 422 | `qty_received <= 0` or `cost_per_unit < 0` |

---

## Files Affected

| Action | File |
|---|---|
| New | `api/app/models/receipts.py` |
| New | `api/app/schemas/receipts.py` |
| New | `api/app/services/receipts.py` |
| New | `api/app/api/v1/receipts.py` |
| New | `api/alembic/versions/XXXX_batch_receipt_lots.py` |
| Modified | `api/app/models/inventory.py` — remove `expiry_date` |
| Modified | `api/app/models/__init__.py` — export new models |
| Modified | `api/app/schemas/inventory.py` — remove `expiry_date`, remove `ReceiveStockRequest` |
| Modified | `api/app/services/inventory.py` — remove `receive_stock`, update `list_expired` |
| Modified | `api/app/services/orders.py` — replace stock deduction with `_deduct_fifo` |
| Modified | `api/app/api/v1/inventory.py` — remove `/receive`, add `/{item_id}/lots` |
| Modified | `api/app/api/v1/router.py` — register receipts router |
