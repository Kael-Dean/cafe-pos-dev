# Pre-Order Item Fulfillment Mode

**Date:** 2026-05-23
**Status:** Approved

## Problem

When a pre-order contains PRODUCED products (e.g. chiffon cake), the manager currently has no choice — the system always deducts raw ingredients and assumes a fresh production run. In practice the bakery may already have finished goods in stock and wants to pull from those instead. This feature lets managers decide per line-item.

---

## User Flow

1. Manager creates a pre-order with one or more PRODUCED items. Default mode is **Produce Fresh**.
2. While the order is **PENDING**, the manager can switch any PRODUCED item to **From Inventory** (and back).
3. The ingredient summary (วัตถุดิบ tab) updates in real time to reflect the choice — items covered by existing finished goods stock disappear from the raw ingredient list.
4. When the manager clicks **เริ่มผลิต** (Start), the backend applies the fulfillment logic per item and either starts the order or blocks with a clear error.

---

## Data Model

### New enum — `app/enums.py`

```python
class FulfillmentMode(enum.StrEnum):
    PRODUCE_FRESH   = "PRODUCE_FRESH"
    FROM_INVENTORY  = "FROM_INVENTORY"
```

### New column — `pre_order_items`

| Column | Type | Nullable | Default |
|---|---|---|---|
| `fulfillment_mode` | `VARCHAR` (enum) | YES | `NULL` |

`NULL` and `PRODUCE_FRESH` are treated identically throughout the system. The column is only meaningful on items whose linked `Product.product_type == PRODUCED`.

Requires one Alembic migration.

---

## API

### Set fulfillment mode

```
PATCH /api/v1/pre-orders/{id}/items/{item_id}/fulfillment
```

**Request body:**
```json
{ "fulfillment_mode": "FROM_INVENTORY" | "PRODUCE_FRESH" }
```

**Validation:**
- Order must be `PENDING` → 422 `PRE_ORDER_NOT_PENDING`
- Product must be `PRODUCED` type → 422 `ITEM_NOT_PRODUCED`
- `FROM_INVENTORY` requires `Product.finished_goods_item_id` to be set → 422 `NO_FINISHED_GOODS_ITEM`

**Response:** full `PreOrderRead` (same shape as all other pre-order mutations)

---

## Ingredient Summary — Updated Logic

`GET /api/v1/pre-orders/{id}/ingredients`

For each PRODUCED pre-order item, the raw ingredient contribution is calculated as follows:

| fulfillment_mode | finished goods stock vs qty ordered | Raw ingredient qty included |
|---|---|---|
| `FROM_INVENTORY` | stock ≥ qty | **None** — fully covered by existing stock |
| `FROM_INVENTORY` | stock < qty | Shortfall only: `ceil((qty − stock) / servings_per_batch) × recipe_qty` |
| `PRODUCE_FRESH` or `NULL` | any | Full qty: `ceil(qty / servings_per_batch) × recipe_qty` |

For non-PRODUCED items, existing logic is unchanged (`recipe_qty × qty_ordered`).

---

## Start — Updated Logic

`POST /api/v1/pre-orders/{id}/start`

Processed per item in a single atomic transaction.

### PRODUCED item — FROM_INVENTORY mode

```
available    = min(finished_goods_stock, qty_ordered)
shortfall    = qty_ordered − available

if available > 0:
    deduct `available` from finished goods InventoryItem (FIFO)

if shortfall > 0:
    batches_needed = ceil(shortfall / servings_per_batch)
    if any raw ingredient stock < required_qty:
        → 422 INSUFFICIENT_INGREDIENTS
    else:
        deduct raw ingredients for `batches_needed` batches
```

### PRODUCED item — PRODUCE_FRESH (or NULL) mode

Existing behavior unchanged: `batches_needed = ceil(qty / servings_per_batch)`, deduct raw ingredients via FIFO, negative stock allowed.

### Non-PRODUCED items

Unchanged.

### Error response for insufficient ingredients

```json
{
  "error": {
    "code": "INSUFFICIENT_INGREDIENTS",
    "message": "Must fulfill shopping list before starting",
    "detail": [
      { "inventory_item_id": "...", "name": "แป้งเค้ก", "required": 500, "available": 200 }
    ]
  }
}
```

---

## Files Changed

| File | Change |
|---|---|
| `app/enums.py` | Add `FulfillmentMode` enum |
| `app/models/pre_orders.py` | Add `fulfillment_mode` column to `PreOrderItem` |
| `alembic/versions/xxxx_add_fulfillment_mode_to_pre_order_items.py` | Migration |
| `app/schemas/pre_orders.py` | Add `fulfillment_mode` to `PreOrderItemRead`; new `FulfillmentModeUpdate` schema |
| `app/services/pre_orders.py` | Update `_aggregate_ingredients`; update `start_pre_order`; add `set_item_fulfillment` |
| `app/api/v1/pre_orders.py` | Add `PATCH /{id}/items/{item_id}/fulfillment` route |
| `tests/test_pre_orders_api.py` | Tests for new endpoint and updated start/summary logic |

---

## Test Cases

- `PATCH` sets `FROM_INVENTORY` on a PRODUCED item → ingredient summary excludes its raw ingredients when stock sufficient
- `PATCH` blocked on non-PRODUCED item → 422 `ITEM_NOT_PRODUCED`
- `PATCH` blocked on non-PENDING order → 422 `PRE_ORDER_NOT_PENDING`
- `PATCH` `FROM_INVENTORY` blocked when no `finished_goods_item_id` → 422 `NO_FINISHED_GOODS_ITEM`
- Start: `FROM_INVENTORY` + sufficient stock → deducts finished goods, no raw ingredient deduction
- Start: `FROM_INVENTORY` + partial stock → deducts available finished goods + raw ingredients for shortfall batches only
- Start: `FROM_INVENTORY` + insufficient finished goods + insufficient raw ingredients → 422 `INSUFFICIENT_INGREDIENTS`
- Start: `FROM_INVENTORY` + insufficient finished goods + sufficient raw ingredients → succeeds
- Ingredient summary: `FROM_INVENTORY` item fully covered → excluded from raw list
- Ingredient summary: `FROM_INVENTORY` item partial stock → only shortfall batches shown
