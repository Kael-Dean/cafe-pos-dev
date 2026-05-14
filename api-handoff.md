# API Handoff: Pre-Orders & Shopping List

## Business Context

Pre-orders let café staff take advance orders from customers — typically for custom cakes or large batch items. Staff create a pre-order with customer info and negotiated pricing, review ingredient requirements against current stock, then "start" the order when production begins (which deducts stock via FIFO). The shopping list is a persistent per-store list of ingredients that need restocking, usable independently or populated from the ingredient summary view.

All endpoints require any authenticated store user (BARISTA+). `store_id` is always derived from the JWT — never sent in the request body.

---

## Endpoints

### POST /api/v1/pre-orders
- **Purpose**: Create a new pre-order
- **Auth**: Any store user (BARISTA+)
- **Request**:
  ```json
  {
    "order_date": "2026-05-14",
    "due_date": "2026-05-21",
    "customer_name": "Alice",
    "customer_phone": "0812345678",
    "customer_id": null,
    "deposit_amount": "500.00",
    "deposit_paid": false,
    "notes": "Extra chocolate on top",
    "items": [
      { "product_id": "abc123", "quantity": 2 },
      { "product_id": "def456", "quantity": 1, "unit_price": "120.00" }
    ]
  }
  ```
- **Response** (201): Full `PreOrderRead` object (see Data Models)
- **Response** (error):
  - `422 { "error": { "code": "CUSTOMER_REQUIRED", "message": "CUSTOMER_REQUIRED" } }` — neither `customer_id` nor (`customer_name` + `customer_phone`) provided
  - `404` — a `product_id` in items doesn't exist or is inactive in this store
- **Notes**:
  - Either `customer_id` (linked customer record) OR both `customer_name` + `customer_phone` (inline) must be provided
  - If `unit_price` is omitted, defaults to the product's current catalogue price — use this for negotiated pricing overrides
  - Items list must have at least 1 item
  - `line_total` is computed server-side as `unit_price × quantity`

---

### GET /api/v1/pre-orders
- **Purpose**: List pre-orders for this store, ordered by due date ascending
- **Auth**: Any store user
- **Query params**:
  - `status` (optional): `PENDING` | `IN_PROGRESS` | `COMPLETED` | `CANCELLED`
  - `page` (default 1, min 1)
  - `limit` (default 50, min 1, max 200)
- **Response** (200):
  ```json
  {
    "items": [
      {
        "id": "po_abc123",
        "order_date": "2026-05-14",
        "due_date": "2026-05-21",
        "customer_name": "Alice",
        "customer_phone": "0812345678",
        "status": "PENDING",
        "item_count": 2,
        "created_at": "2026-05-14T10:00:00Z"
      }
    ],
    "total": 42
  }
  ```
- **Notes**: Summary list only — no items array. Fetch individual pre-order for full detail.

---

### GET /api/v1/pre-orders/{pre_order_id}
- **Purpose**: Get full pre-order detail including all items
- **Auth**: Any store user
- **Response** (200): Full `PreOrderRead` object (see Data Models)
- **Response** (error): `404` if not found in this store

---

### PATCH /api/v1/pre-orders/{pre_order_id}
- **Purpose**: Update pre-order header fields (only while PENDING)
- **Auth**: Any store user
- **Request** (all fields optional):
  ```json
  {
    "order_date": "2026-05-14",
    "due_date": "2026-05-22",
    "customer_name": "Bob",
    "customer_phone": "0899999999",
    "customer_id": null,
    "deposit_amount": "1000.00",
    "deposit_paid": true,
    "notes": "Updated notes"
  }
  ```
- **Response** (200): Full `PreOrderRead`
- **Response** (error):
  - `422 { "error": { "code": "PRE_ORDER_NOT_PENDING", ... } }` — order already started/completed/cancelled
  - `404` — not found

---

### POST /api/v1/pre-orders/{pre_order_id}/items
- **Purpose**: Add an item to an existing pre-order (only while PENDING)
- **Auth**: Any store user
- **Request**:
  ```json
  { "product_id": "abc123", "quantity": 3, "unit_price": "110.00" }
  ```
- **Response** (201): Full `PreOrderRead` with updated items list
- **Response** (error): `422 PRE_ORDER_NOT_PENDING`, `404` product not found

---

### DELETE /api/v1/pre-orders/{pre_order_id}/items/{item_id}
- **Purpose**: Remove an item from a pre-order (only while PENDING)
- **Auth**: Any store user
- **Response** (200): Full `PreOrderRead` with updated items list
- **Response** (error): `422 PRE_ORDER_NOT_PENDING`, `404` item not found

---

### GET /api/v1/pre-orders/{pre_order_id}/ingredients
- **Purpose**: Summarise ingredients needed across all items, checked against current stock
- **Auth**: Any store user
- **Query params**:
  - `threshold` (default 50.0, 0–100): usage % above which an ingredient is flagged
- **Response** (200):
  ```json
  {
    "threshold": 50.0,
    "items": [
      {
        "inventory_item_id": "inv_abc",
        "name": "Flour",
        "unit": "g",
        "qty_needed": "1000.000",
        "stock_on_hand": "5000.000",
        "usage_pct": 20.0,
        "exceeds_threshold": false,
        "on_shopping_list": false
      }
    ]
  }
  ```
- **Notes**:
  - Only products with a recipe (BOM) contribute ingredients — items without a linked product are skipped
  - `usage_pct` is `qty_needed / stock_on_hand × 100`; `null` when `stock_on_hand` is 0
  - `exceeds_threshold: true` when `usage_pct > threshold` OR when `stock_on_hand` is 0
  - `on_shopping_list: true` when the ingredient is already on this store's shopping list
  - Use this screen to let staff decide what to buy before starting production

---

### POST /api/v1/pre-orders/{pre_order_id}/start
- **Purpose**: Begin production — deducts ingredients from stock via FIFO, transitions to IN_PROGRESS
- **Auth**: Any store user
- **Request**: No body
- **Response** (200): Full `PreOrderRead` with `status: "IN_PROGRESS"`, `started_at`, `started_by_id` set
- **Response** (error):
  - `409 { "error": { "code": "PRE_ORDER_ALREADY_STARTED", ... } }` — not in PENDING status
  - `422 PRE_ORDER_NO_ITEMS` — order has no items with recipes (nothing to deduct)
- **Notes**: Stock deduction is **irreversible** — warn the user before calling this. Header/item editing is blocked after this point.

---

### POST /api/v1/pre-orders/{pre_order_id}/complete
- **Purpose**: Mark order as handed off to customer — IN_PROGRESS → COMPLETED
- **Auth**: Any store user
- **Request**: No body
- **Response** (200): Full `PreOrderRead` with `status: "COMPLETED"`, `completed_at`, `completed_by_id` set
- **Response** (error): `422 PRE_ORDER_NOT_IN_PROGRESS` — must be IN_PROGRESS first

---

### POST /api/v1/pre-orders/{pre_order_id}/cancel
- **Purpose**: Cancel a pre-order (only while PENDING — before stock deduction)
- **Auth**: Any store user
- **Request**: No body
- **Response** (200): Full `PreOrderRead` with `status: "CANCELLED"`
- **Response** (error): `422 PRE_ORDER_NOT_PENDING` — cannot cancel after starting

---

### GET /api/v1/shopping-list
- **Purpose**: Get this store's current shopping list
- **Auth**: Any store user
- **Response** (200): Array of `ShoppingListItemRead` (see Data Models)

---

### POST /api/v1/shopping-list
- **Purpose**: Add an ingredient to the shopping list (idempotent)
- **Auth**: Any store user
- **Request**:
  ```json
  { "inventory_item_id": "inv_abc", "note": "buy 5kg" }
  ```
- **Response**: `201` if newly added, `200` if already existed — same `ShoppingListItemRead` body either way
- **Notes**: Safe to call repeatedly — same item returns the existing record at 200

---

### DELETE /api/v1/shopping-list/{item_id}
- **Purpose**: Remove an item from the shopping list
- **Auth**: Any store user
- **Response** (204): No body
- **Response** (error): `404` if not found

---

### GET /api/v1/shopping-list/print
- **Purpose**: Plain-text printable shopping list (for receipt printers)
- **Auth**: Any store user
- **Response** (200):
  ```
  Content-Type: text/plain

  SHOPPING LIST
  ==============================

  - Flour [g]  (buy 5kg)
  - Milk [L]
  ```
- **Notes**: Returns `"Shopping list is empty.\n"` when empty

---

## Data Models

```typescript
interface PreOrderRead {
  id: string
  store_id: string
  order_date: string            // "YYYY-MM-DD"
  due_date: string              // "YYYY-MM-DD"
  customer_id: string | null    // linked Customer record
  customer_name: string | null  // inline customer name
  customer_phone: string | null
  deposit_amount: string | null // decimal string e.g. "500.00"
  deposit_paid: boolean
  notes: string | null
  status: PreOrderStatus
  created_by_id: string
  started_by_id: string | null
  completed_by_id: string | null
  started_at: string | null     // ISO 8601
  completed_at: string | null   // ISO 8601
  items: PreOrderItemRead[]
  created_at: string            // ISO 8601
  updated_at: string            // ISO 8601
}

interface PreOrderItemRead {
  id: string
  product_id: string | null  // null if product was deleted
  product_name: string       // snapshot at time of creation
  quantity: number
  unit_price: string         // decimal string e.g. "150.00"
  line_total: string         // decimal string e.g. "300.00"
}

interface PreOrderSummary {
  id: string
  order_date: string
  due_date: string
  customer_name: string | null
  customer_phone: string | null
  status: PreOrderStatus
  item_count: number
  created_at: string
}

interface PreOrdersPage {
  items: PreOrderSummary[]
  total: number
}

interface IngredientSummaryItem {
  inventory_item_id: string
  name: string
  unit: string
  qty_needed: string       // decimal string
  stock_on_hand: string    // decimal string
  usage_pct: number | null // null when stock_on_hand is 0
  exceeds_threshold: boolean
  on_shopping_list: boolean
}

interface IngredientSummary {
  items: IngredientSummaryItem[]
  threshold: number
}

interface ShoppingListItemRead {
  id: string
  inventory_item_id: string
  inventory_item_name: string
  unit: string
  note: string | null
  added_by_id: string
  created_at: string  // ISO 8601
}
```

---

## Enums & Constants

### PreOrderStatus

| Value | Meaning | Transitions | Display Label |
|-------|---------|-------------|---------------|
| `PENDING` | Created, not yet started | → IN_PROGRESS (start), → CANCELLED (cancel) | Pending |
| `IN_PROGRESS` | Stock deducted, production underway | → COMPLETED (complete) | In Progress |
| `COMPLETED` | Handed off to customer | terminal | Completed |
| `CANCELLED` | Voided before production | terminal | Cancelled |

### Error codes

| Code | HTTP | When |
|------|------|------|
| `CUSTOMER_REQUIRED` | 422 | Create without customer info |
| `PRE_ORDER_NOT_PENDING` | 422 | Edit/add-item/remove-item/cancel on non-PENDING order |
| `PRE_ORDER_ALREADY_STARTED` | 409 | Start on non-PENDING order |
| `PRE_ORDER_NOT_IN_PROGRESS` | 422 | Complete on non-IN_PROGRESS order |
| `PRE_ORDER_NO_ITEMS` | 422 | Start when no items have recipes |
| `PRE_ORDER_NOT_FOUND` | 404 | Pre-order ID not found in this store |
| `PRE_ORDER_ITEM_NOT_FOUND` | 404 | Item ID not found on this pre-order |
| `SHOPPING_LIST_ITEM_NOT_FOUND` | 404 | Shopping list item ID not found |

---

## Validation Rules

| Field | Rule |
|-------|------|
| Customer | `customer_id` OR (`customer_name` + `customer_phone`) required at create |
| `customer_name` | max 120 chars |
| `customer_phone` | max 30 chars |
| `deposit_amount` | ≥ 0 |
| `notes` | no length limit |
| `items` | min 1 item on create |
| `quantity` | integer ≥ 1 |
| `unit_price` | ≥ 0 if provided; omit to use catalogue price |
| Shopping list `note` | max 255 chars |
| `threshold` (ingredients) | 0–100, default 50 |

---

## Business Logic & Edge Cases

- **Editing is locked after start**: PATCH, add-item, and remove-item all return `PRE_ORDER_NOT_PENDING` once status is IN_PROGRESS or beyond. Show the edit UI only when `status === "PENDING"`.
- **Cancellation only works pre-production**: Cancel is blocked after start because stock has already been deducted. There is no refund/reverse-deduction endpoint — a stock adjustment must be done manually via the inventory module.
- **Negotiated pricing**: `unit_price` overrides the catalogue price per line item. Store it client-side for display but the server always recomputes `line_total`.
- **Product name snapshot**: `product_name` on `PreOrderItemRead` is snapshotted at creation time. If the product is later renamed or deleted, the snapshot is preserved. `product_id` may be null if the product was deleted.
- **Ingredient summary is read-only**: The `/ingredients` endpoint does not affect stock — it is purely informational. Only `/start` deducts stock.
- **`on_shopping_list` in ingredient summary**: Reflects the current store's shopping list at query time. Use this to show a "already on list" badge and avoid duplicate adds.
- **Shopping list is per-store**: Items added by store A are invisible to store B.
- **Shopping list POST is idempotent**: Check the response status code (201 vs 200) if you need to distinguish new vs existing.
- **`usage_pct` can be null**: When `stock_on_hand` is 0, `usage_pct` is null and `exceeds_threshold` is always true. Handle null in display.
- **Decimal values are strings**: All money and quantity fields come back as decimal strings (`"150.00"`, `"1000.000"`). Parse with a decimal library — do not use `parseFloat`.

---

## Integration Notes

- **Recommended pre-order creation flow**: Fill header form → add items → review ingredient summary → optionally add flagged ingredients to shopping list → confirm → POST create
- **Recommended production flow**: List PENDING orders → open detail → view ingredients → POST /start (with user confirmation) → POST /complete when done
- **Status badge colours**: PENDING=yellow, IN_PROGRESS=blue, COMPLETED=green, CANCELLED=grey
- **Optimistic UI**: Not recommended for `/start` — the stock deduction is irreversible; always wait for server confirmation before updating UI
- **Polling**: No real-time events for pre-orders; polling or manual refresh is fine given low-frequency updates
- **Print endpoint**: Hit `/shopping-list/print` from an anchor tag with `target="_blank"` or pipe to a receipt printer. No `Accept` header needed.

---

## Test Scenarios

1. **Happy path (create → start → complete)**: Create with inline customer + 1 product item → verify status=PENDING, items populated, unit_price matches catalogue → GET ingredients, check qty_needed maths → POST /start, verify status=IN_PROGRESS and stock reduced → POST /complete, verify status=COMPLETED
2. **Negotiated price**: Create item with explicit `unit_price` lower than catalogue → verify `line_total = unit_price × quantity`, not catalogue × quantity
3. **Customer required**: POST without `customer_name`/`customer_phone`/`customer_id` → expect `422 CUSTOMER_REQUIRED`
4. **Edit locked after start**: PATCH after /start → expect `422 PRE_ORDER_NOT_PENDING`
5. **Cancel locked after start**: POST /cancel after /start → expect `422 PRE_ORDER_NOT_PENDING`
6. **Double-start blocked**: POST /start twice → second call returns `409 PRE_ORDER_ALREADY_STARTED`
7. **Ingredient threshold**: Create order with qty that consumes >50% of stock → verify `exceeds_threshold: true` in ingredient summary
8. **Shopping list idempotency**: POST same `inventory_item_id` twice → first returns 201, second returns 200 with same `id`
9. **Shopping list isolation**: Add item as store A → verify store B's list does not include it
10. **Print empty list**: GET /shopping-list/print with empty list → verify `text/plain` response containing "Shopping list is empty."
