# Frontend Handoff: Shopping List "amount to buy"

## Why
The Shopping List previously showed only the ingredient and its unit (`Milk [g]`) with no
amount. The backend now computes a **suggested buy amount** per item and supports a
**user override**. The UI should render the amount and let the user edit it.

## API changes

### `ShoppingListItemRead` — two new fields
| field | type | meaning |
|---|---|---|
| `suggested_qty` | decimal (string) | Computed amount still to buy = `max(0, pending-pre-order demand − stock_on_hand)`. Always present, recomputed live. |
| `quantity` | decimal (string) \| `null` | User override. `null` = no override (use the suggestion). |

Existing fields (`id`, `inventory_item_id`, `inventory_item_name`, `unit`, `note`,
`added_by_id`, `created_at`) are unchanged.

### Render rule
Show **`quantity ?? suggested_qty`** next to the unit, as an editable number input:

```
Milk   [ 3.5 ] g     ← suggested_qty (no override yet)
Flour  [ 12  ] g     ← quantity override set by user
```

A subtle hint (e.g. greyed vs. bold, or a "suggested" tag) can distinguish an unedited
suggestion from an explicit override (`quantity === null`).

### Endpoints
- `GET /api/v1/shopping-list` → list with the two new fields.
- `POST /api/v1/shopping-list` → body may now include optional `quantity` to set an override at add time:
  `{ "inventory_item_id": "...", "quantity": "7.5", "note": "..." }` (still idempotent per item).
- **`PATCH /api/v1/shopping-list/{item_id}`** (new) → set/clear the override:
  - body: `{ "quantity": "12" }` to override, or `{ "quantity": null }` to revert to suggestion.
  - returns the updated `ShoppingListItemRead`.
  - 404 `SHOPPING_LIST_ITEM_NOT_FOUND` if the item doesn't belong to the store.
- `DELETE /api/v1/shopping-list/{item_id}` → unchanged.
- `GET /api/v1/shopping-list/print` → plain-text now includes the amount per line:
  `- Milk: 3.5 L  (note)`.

### Suggested UX
On editing the input, `PATCH` with the new `quantity`. To "reset to suggested", `PATCH` with
`quantity: null`. The suggestion updates automatically as pending pre-orders and stock change,
so a non-overridden item always reflects current demand.

## Notes
- Demand counts **PENDING pre-orders only** (not IN_PROGRESS — those already deducted stock).
- All decimals are serialized as JSON strings; parse before arithmetic.
