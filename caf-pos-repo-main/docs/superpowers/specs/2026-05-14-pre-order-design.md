# Pre-Order Feature — Design Spec

## Context

The café takes bulk pre-orders from customers (e.g. catering, events). Currently there is no way to record these in the POS — staff use paper or external notes. This feature adds a dedicated pre-order system: staff create a pre-order with customer info, line items at negotiated prices, and a due date. The system calculates the total ingredients needed, warns when a pre-order would consume a significant portion of current stock, and maintains a per-store shopping list of ingredients that need purchasing. When staff are ready to begin production, they press "Start Order" which atomically deducts stock via the existing FIFO lot system. A "Complete" action closes the order.

Scope: **Backend API only** (FastAPI). Frontend handoff docs to be written after implementation.

---

## Approach

Standalone `pre_orders` module — new models, service, and router. No changes to the existing `orders` system. Reuses `_deduct_fifo` from `services/orders.py` and the existing `recipe_items` → `inventory_items` link.

---

## Data Model

### New Enum — `PreOrderStatus` (add to `app/enums.py`)

```
PENDING → IN_PROGRESS → COMPLETED
PENDING → CANCELLED
```

### `PreOrder` table (`app/models/pre_orders.py`)

| Field | Type | Notes |
|---|---|---|
| `id` | String(24) CUID | PK |
| `store_id` | String(24) FK → stores | from JWT |
| `order_date` | Date | when customer placed the pre-order |
| `due_date` | Date | when order must be ready — list sorted by this |
| `customer_id` | String(24) FK → customers nullable | optional link |
| `customer_name` | String(120) nullable | inline fallback |
| `customer_phone` | String(30) nullable | inline fallback |
| `deposit_amount` | Numeric(12,2) nullable | agreed deposit |
| `deposit_paid` | Boolean default False | |
| `notes` | Text nullable | |
| `status` | PreOrderStatus | PENDING on create |
| `created_by_id` | FK → users | |
| `started_by_id` | FK → users nullable | set on start |
| `completed_by_id` | FK → users nullable | set on complete |
| `started_at` | DateTime nullable | |
| `completed_at` | DateTime nullable | |
| `created_at` | DateTime | |
| `updated_at` | DateTime | |

Validation: either `customer_id` OR (`customer_name` + `customer_phone`) must be present.

### `PreOrderItem` table (`app/models/pre_orders.py`)

| Field | Type | Notes |
|---|---|---|
| `id` | String(24) CUID | PK |
| `pre_order_id` | FK → pre_orders | |
| `product_id` | FK → products nullable | nullable for custom line items |
| `product_name` | String(200) | snapshot at creation |
| `quantity` | Integer ≥ 1 | |
| `unit_price` | Numeric(12,2) | negotiated; defaults from product.price |
| `line_total` | Numeric(12,2) | quantity × unit_price, stored |

### `ShoppingListItem` table (`app/models/pre_orders.py`)

| Field | Type | Notes |
|---|---|---|
| `id` | String(24) CUID | PK |
| `store_id` | FK → stores | |
| `inventory_item_id` | FK → inventory_items | |
| `added_by_id` | FK → users | |
| `note` | String(255) nullable | |
| `created_at` | DateTime | |

Unique constraint: `(store_id, inventory_item_id)`.

---

## API Endpoints

All endpoints: any authenticated user (BARISTA+). `store_id` always from JWT.

### Pre-Orders router — `app/api/v1/pre_orders.py`, prefix `/pre-orders`

| Method | Path | Purpose |
|---|---|---|
| POST | `/pre-orders` | Create pre-order with items |
| GET | `/pre-orders` | List, ordered by `due_date ASC`, filterable by `status` |
| GET | `/pre-orders/{id}` | Detail with all items |
| PATCH | `/pre-orders/{id}` | Update header fields (PENDING only) |
| POST | `/pre-orders/{id}/items` | Add item to pre-order (PENDING only) |
| DELETE | `/pre-orders/{id}/items/{item_id}` | Remove item (PENDING only) |
| GET | `/pre-orders/{id}/ingredients?threshold=50` | Ingredient summary + stock check |
| POST | `/pre-orders/{id}/start` | PENDING → IN_PROGRESS, deducts stock |
| POST | `/pre-orders/{id}/complete` | IN_PROGRESS → COMPLETED |
| POST | `/pre-orders/{id}/cancel` | PENDING → CANCELLED |

### Shopping List router — `app/api/v1/shopping_list.py`, prefix `/shopping-list`

| Method | Path | Purpose |
|---|---|---|
| GET | `/shopping-list` | List all items with ingredient name + unit |
| POST | `/shopping-list` | Add ingredient (upsert — idempotent) |
| DELETE | `/shopping-list/{item_id}` | Remove item |
| GET | `/shopping-list/print` | Returns `text/plain` printable summary |

### Ingredient Summary Response Shape

```json
{
  "items": [
    {
      "inventory_item_id": "...",
      "name": "Flour",
      "unit": "g",
      "qty_needed": "2400.000",
      "stock_on_hand": "3000.000",
      "usage_pct": 80.0,
      "exceeds_threshold": true,
      "on_shopping_list": false
    }
  ],
  "threshold": 50
}
```

`usage_pct = (qty_needed / stock_on_hand) × 100`. If `stock_on_hand = 0`: `usage_pct = null`, `exceeds_threshold = true`.

---

## Business Logic

### Create Pre-Order

1. Validate customer presence: `customer_id` OR (`customer_name` + `customer_phone`) required.
2. For each item with `product_id`: load product, snapshot `product_name`, default `unit_price` to `product.price` if not provided by caller.
3. Compute and store `line_total = quantity × unit_price`.
4. Status = PENDING.

### Ingredient Summary (`GET /pre-orders/{id}/ingredients`)

1. For each `PreOrderItem` with a `product_id`, load all `RecipeItem` records.
2. Multiply `recipe_item.quantity × pre_order_item.quantity`.
3. Aggregate totals by `inventory_item_id` across all items.
4. Join with `InventoryItem.stock_on_hand` and `ShoppingListItem` membership.
5. Compute `usage_pct`; set `exceeds_threshold = usage_pct > threshold`.
6. Custom line items (no `product_id`) contribute no ingredients.

### Start Order (`POST /pre-orders/{id}/start`)

1. Guard: `status == PENDING` → else `PRE_ORDER_ALREADY_STARTED`.
2. Guard: at least one item has a `product_id` → else `PRE_ORDER_NO_ITEMS`.
3. Re-aggregate ingredient totals (same logic as summary endpoint).
4. `_deduct_fifo` signature updated: `ref_order_id: str | None = None` (existing callers unaffected).
5. Call `_deduct_fifo` for each aggregated ingredient with `ref_order_id=None`; `StockMovement.reason = f"Pre-order {pre_order.id[:8]}"`.
6. Set `status = IN_PROGRESS`, `started_by_id`, `started_at`.
7. All in a single `async with db.begin()` transaction.

### Cancel

- Guard: `status == PENDING` only.
- No stock reversal (stock was never deducted).

### Shopping List Upsert

- `POST /shopping-list` with `inventory_item_id`: insert or return existing on unique conflict (200 with existing item).

---

## Error Handling

All errors follow the existing `{"error": {"code": "...", "message": "..."}}` envelope. Register new codes in `app/main.py:_code_for`.

| Code | HTTP | Trigger |
|---|---|---|
| `PRE_ORDER_NOT_FOUND` | 404 | Pre-order not found or wrong store |
| `PRE_ORDER_NOT_PENDING` | 422 | Edit/add-item/remove-item/cancel on non-PENDING |
| `PRE_ORDER_NOT_IN_PROGRESS` | 422 | Complete on non-IN_PROGRESS |
| `PRE_ORDER_ALREADY_STARTED` | 422 | Start on non-PENDING |
| `PRE_ORDER_NO_ITEMS` | 422 | Start with no product-linked items |
| `PRE_ORDER_ITEM_NOT_FOUND` | 404 | Item not found on this pre-order |
| `CUSTOMER_REQUIRED` | 422 | No customer_id and no customer_name+phone |
| `PRODUCT_NOT_FOUND` | 404 | product_id not found or inactive |
| `SHOPPING_LIST_ITEM_NOT_FOUND` | 404 | Shopping list item not found in store |

---

## Files to Create / Modify

| Action | Path |
|---|---|
| Create | `api/app/models/pre_orders.py` |
| Create | `api/app/schemas/pre_orders.py` |
| Create | `api/app/services/pre_orders.py` |
| Create | `api/app/api/v1/pre_orders.py` |
| Create | `api/app/api/v1/shopping_list.py` |
| Create | `api/tests/test_pre_orders.py` |
| Create | `api/tests/test_shopping_list.py` |
| Create | `api/alembic/versions/0012_pre_orders.py` |
| Modify | `api/app/enums.py` — add `PreOrderStatus` |
| Modify | `api/app/models/__init__.py` — register new models |
| Modify | `api/app/api/v1/router.py` — register new routers |
| Modify | `api/app/main.py` — register new error codes |
| Modify | `api/app/services/orders.py` — `_deduct_fifo` ref_order_id becomes `Optional[str]` |

### Key Reused Functions

- `_deduct_fifo` — `api/app/services/orders.py`
- `new_cuid` — `api/app/db/types.py`
- `get_current_user` / `store_id` from JWT — `api/app/deps.py`
- `make_item`, `make_product`, `make_customer` — `api/tests/conftest.py` + `factories.py`

---

## Verification

1. `uv run pytest tests/test_pre_orders.py tests/test_shopping_list.py` — all pass
2. `uv run pytest --cov=app --cov-report=term-missing` — coverage ≥ 80%
3. `uv run alembic upgrade head` — migration applies cleanly
4. `uv run alembic downgrade -1` — migration rolls back cleanly
5. Manual smoke via `http://localhost:8000/docs`:
   - Create pre-order → list → view ingredients with threshold warning → add ingredient to shopping list → start order → verify stock deducted → complete order
   - Verify cancel is blocked after start
   - Print shopping list returns `text/plain`
