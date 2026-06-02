# Produced Goods & Production Orders — Design Spec

**Date:** 2026-05-20
**Status:** Approved

---

## Problem

The system currently assumes every product is made-to-order: when an order is placed, recipe ingredients are deducted from stock one-for-one, and the recipe is treated as a single serving. This breaks for batch-produced goods (e.g. cookies) where:

- A recipe produces multiple units (a batch of 24 cookies)
- Finished goods are stored in inventory and sold from stock — not assembled per order
- The same finished good may appear as an ingredient in other recipes (e.g. a caramel cookie smoothie)
- Cost per piece must be calculated as `total_recipe_cost / servings_per_batch`

---

## Solution Overview

Introduce a `product_type` field (`MADE_TO_ORDER` | `PRODUCED`) on `Product`. `PRODUCED` products are backed by a linked `InventoryItem` (finished goods). Staff record production runs via a new `/production-orders` module, which atomically deducts raw ingredients and adds finished units to stock. Order fulfillment branches on product type.

---

## Data Model

### `enums.py` — additions

```python
class ProductType(str, enum.Enum):
    MADE_TO_ORDER = "MADE_TO_ORDER"
    PRODUCED = "PRODUCED"

# Extend existing MovementType:
class MovementType(str, enum.Enum):
    ...
    PRODUCTION = "PRODUCTION"   # stock added via internal production run
```

### `products` table — three new columns

| Column | Type | Default | Notes |
|---|---|---|---|
| `product_type` | `ProductType` enum | `MADE_TO_ORDER` | Non-breaking for all existing products |
| `servings_per_batch` | `Integer` | `1` | How many sellable units one recipe batch yields |
| `finished_goods_item_id` | `String(24)` nullable FK → `inventory_items` | `null` | Only populated for `PRODUCED` type |

### `production_orders` table — new

| Column | Type | Notes |
|---|---|---|
| `id` | `String(24)` CUID | PK |
| `store_id` | `String(24)` | FK → `stores`, index |
| `product_id` | `String(24)` | FK → `products` |
| `batches_count` | `Integer` ≥ 1 | Number of batches made |
| `units_produced` | `Integer` | Stored as `batches_count × servings_per_batch` — immutable audit record |
| `produced_by` | `String(24)` | FK → `users` |
| `produced_at` | `DateTime` | Default now (UTC) |
| `notes` | `Text` nullable | Optional staff note |

No status column — recording a production order IS completion. All writes are atomic.

### Alembic migration

One revision: adds three columns to `products` (with safe defaults) and creates `production_orders`. No data migration required.

---

## Auto-Pair Inventory Item

When a `PRODUCED` product is created:
1. System atomically creates an `InventoryItem` with `name = product.name`, `unit = "piece"`, `cost_per_unit = 0`
2. Sets `product.finished_goods_item_id` to the new item's id
3. Staff may rename or reconfigure the `InventoryItem` afterwards — the FK link is stable by id

When `product_type` changes `PRODUCED → MADE_TO_ORDER`:
- `finished_goods_item_id` is set to `null`
- The orphaned `InventoryItem` and all its stock history are preserved — never auto-deleted

---

## Order Flow

The order service branches on `product_type` at fulfilment time.

**MADE_TO_ORDER (unchanged):**
```
order placed → deduct recipe ingredients from stock (quantity × 1)
```

**PRODUCED:**
```
order placed → deduct 1 unit from product.finished_goods_item inventory
```
Raw ingredients are not touched at sale time for produced goods.

**Cross-recipe use (e.g. caramel cookie smoothie):**
The smoothie is `MADE_TO_ORDER`. Its recipe lists the "Cookies" `InventoryItem` as an ingredient (`quantity: 1`). When a smoothie is ordered, cookie stock is deducted exactly like any other ingredient. No special handling needed.

**Misconfiguration guard:**
If `product_type == PRODUCED` and `finished_goods_item_id is None` → raise `500 PRODUCT_MISCONFIGURED` rather than silently skipping deduction.

---

## Production Order Flow

Staff records a production run via the Bakery page.

**Request:** `POST /production-orders`
```json
{
  "product_id": "abc123",
  "batches_count": 2,
  "notes": "Morning batch"
}
```

**Service (atomic transaction):**
1. Validate product exists, is `PRODUCED`, and has `finished_goods_item_id`
2. Load recipe items for the product
3. Create `StockMovement(DEDUCT)` per recipe ingredient: `quantity = recipe_item.quantity × batches_count`
4. Create `StockMovement(PRODUCTION)` for finished goods item: `quantity = +batches_count × servings_per_batch`
5. Persist `ProductionOrder` record with `units_produced = batches_count × servings_per_batch`

**Ingredient preview:** no extra endpoint — frontend calculates `ingredient.quantity × batches_count` from recipe data already returned by `GET /products/{id}`.

**No edit/cancel:** production orders are append-only. Errors are corrected via a compensating `ADJUST` stock movement (existing pattern).

**Negative stock:** allowed with a warning, never blocked — consistent with existing system behaviour.

---

## Cost Calculation

Purely frontend-calculated from recipe data:

```
cost_per_piece = sum(ingredient.quantity × ingredient.cost_per_unit) / servings_per_batch
margin         = (price - cost_per_piece) / price
```

`servings_per_batch` is returned on `ProductDetail`. Changing it affects future frontend calculations only — past `production_orders.units_produced` values are immutable.

---

## API Endpoints

### Updated product endpoints

- `POST /products` — accepts `product_type` (default `MADE_TO_ORDER`), `servings_per_batch` (default `1`). Auto-creates inventory item if `PRODUCED`
- `PATCH /products/{id}` — can update `product_type`, `servings_per_batch`
- `GET /products/{id}` — response includes `product_type`, `servings_per_batch`, `finished_goods_item_id`

### New: `/production-orders`

| Method | Path | Description |
|---|---|---|
| `POST` | `/production-orders` | Record a production run — atomic |
| `GET` | `/production-orders` | List; filters: `?product_id=`, `?from=`, `?to=` |
| `GET` | `/production-orders/{id}` | Single production order detail |

---

## Validation & Error Handling

### Product creation/update

| Condition | Behaviour |
|---|---|
| `product_type = PRODUCED` without `servings_per_batch` | Defaults to `1` if omitted, accepted |
| `servings_per_batch < 1` | 422 schema validation error |
| `servings_per_batch` on `MADE_TO_ORDER` | Accepted, silently unused |
| `MADE_TO_ORDER → PRODUCED` | Auto-creates inventory item; `servings_per_batch` uses existing value (column default `1` satisfies ≥ 1 automatically) |
| `PRODUCED → MADE_TO_ORDER` | Nulls `finished_goods_item_id`; preserves inventory item |

### Production order creation

| Condition | HTTP | Code |
|---|---|---|
| `product_id` not found | 404 | `PRODUCT_NOT_FOUND` |
| Product is `MADE_TO_ORDER` | 422 | `NOT_A_PRODUCED_PRODUCT` |
| `finished_goods_item_id` is null | 500 | `PRODUCT_MISCONFIGURED` |
| `batches_count < 1` | 422 | schema validation |

### Order placement

| Condition | HTTP | Code |
|---|---|---|
| `PRODUCED` product, `finished_goods_item_id` null | 500 | `PRODUCT_MISCONFIGURED` |
| Insufficient finished goods stock | Allowed | warning only (negative stock) |

---

## Testing

**New factories (`tests/factories.py`):**
- `make_produced_product(db, store_id, servings_per_batch=12)` — `PRODUCED` product with auto-paired inventory item
- `make_production_order(db, store_id, product_id, batches_count=1)` — records a production run

**Test cases:**

*Product creation:*
- Creating `PRODUCED` product auto-creates a linked `InventoryItem`
- `servings_per_batch` stored and returned in `GET /products/{id}`
- `PRODUCED → MADE_TO_ORDER` nulls `finished_goods_item_id`, preserves inventory item

*Production orders:*
- Each recipe ingredient deducted by `quantity × batches_count`
- Finished goods item receives `+batches_count × servings_per_batch` units
- Ingredient movements use `MovementType.DEDUCT`; finished goods movement uses `MovementType.PRODUCTION`
- `units_produced` on record equals `batches_count × servings_per_batch`
- Returns 422 `NOT_A_PRODUCED_PRODUCT` for a `MADE_TO_ORDER` product

*Order flow:*
- Ordering a `PRODUCED` product deducts from `finished_goods_item`, not recipe ingredients
- Ordering a `MADE_TO_ORDER` product still deducts recipe ingredients (regression)
- Ordering a smoothie with a cookie recipe item deducts cookie `InventoryItem` stock correctly

---

## Files Touched

| File | Change |
|---|---|
| `app/enums.py` | Add `ProductType`; add `MovementType.PRODUCTION` |
| `app/models/catalog.py` | Add 3 columns to `Product` |
| `app/models/production.py` | New — `ProductionOrder` model |
| `app/models/__init__.py` | Import `ProductionOrder` |
| `app/schemas/catalog.py` | Extend `ProductRead`, `ProductCreate`, `ProductUpdate`, `ProductDetail` |
| `app/schemas/production.py` | New — `ProductionOrderCreate`, `ProductionOrderRead` |
| `app/services/catalog.py` | Update `create_product`, `update_product` with auto-pair logic |
| `app/services/orders.py` | Branch on `product_type` at stock deduction |
| `app/services/production.py` | New — `create_production_order`, `list_production_orders`, `get_production_order` |
| `app/api/v1/production.py` | New — router with 3 endpoints |
| `app/api/v1/router.py` | Register production router |
| `alembic/versions/0016_*.py` | Migration: product columns + production_orders table |
| `tests/factories.py` | Add `make_produced_product`, `make_production_order` |
| `tests/test_production.py` | New — full test suite |
| `tests/test_catalog.py` | Extend with product type tests |
| `tests/test_orders.py` | Add regression + produced goods order tests |
| `CLAUDE.md` | Add `ProductionOrder` to model map |
