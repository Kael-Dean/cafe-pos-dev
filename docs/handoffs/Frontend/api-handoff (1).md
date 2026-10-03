# API Handoff: Per-Menu Modifier Ingredient Deductions

## Business Context

A modifier (e.g. "100% Sweet", "Extra Shot") can deduct ingredients from inventory when an item is ordered. Previously each modifier had **one global** ingredient deduction shared across every product. This feature makes the deduction **unique per menu**: the same shared modifier now deducts *different* ingredients (or different amounts) on different products — "100% Sweet" can take 25g sugar on an iced coffee but 5g on a cake, with no cross-menu carry-over. Deductions are keyed on `(product_id, modifier_id, inventory_item_id)`.

> **This is a BREAKING CHANGE for the existing modifier-recipe-items integration.** The management endpoints moved from under `/modifier-groups/...` to under `/products/...`, and two fields were removed from the modifier payloads. Details below.

---

## ⚠️ Breaking Changes (action required by frontend)

1. **Endpoint URLs moved.** Recipe-item management is no longer keyed by modifier alone — it is now keyed by product **and** modifier.
   - ❌ OLD (removed, now 404): `GET|PUT /api/v1/modifier-groups/{modifier_group_id}/modifiers/{modifier_id}/recipe-items`
   - ✅ NEW: `GET|PUT /api/v1/products/{product_id}/modifiers/{modifier_id}/recipe-items`
   - The UI for editing a modifier's ingredient deductions must now live in the **product** editing context (you must know which product the user is configuring), not in the global modifier-group editor.

2. **`Modifier` payloads dropped two fields.** `inventory_item_id` and `inventory_qty` were removed from `ModifierRead`, `ModifierCreate`, and `ModifierUpdate`. The old "single global ingredient per modifier" concept no longer exists — all modifier ingredient deductions now go through the per-product recipe-items endpoints. Remove any UI/forms that set these two fields on a modifier.

3. **Order snapshot shape narrowed.** The `modifiers_json` snapshot stored on order items no longer includes `inventory_item_id` / `inventory_qty` per modifier (it now contains only `id`, `name`, `price_delta`). Any frontend/analytics consumer reading those keys off historical or new orders must stop relying on them.

---

## Endpoints

### GET /api/v1/products/{product_id}/modifiers/{modifier_id}/recipe-items
- **Purpose**: List the ingredient deductions configured for a given modifier *on this specific product*.
- **Auth**: Any authenticated store user (Bearer access token).
- **Path params**: `product_id` (CUID), `modifier_id` (CUID).
- **Request**: none (GET).
- **Response** (200):
  ```json
  [
    {
      "id": "ckv...",
      "inventory_item_id": " cku...",
      "quantity": "25.000",
      "mode": "delta"
    }
  ]
  ```
  Returns `[]` if no per-menu deductions are configured for this modifier on this product.
- **Response** (error):
  - `404` `{"error": {"code": "not_found", "message": "Modifier not attached to this product"}}` — the modifier's group is not attached to this product, or the product doesn't belong to the caller's store.
  - `401` if no/invalid token.
- **Notes**: The store is taken from the JWT — you do not (and cannot) pass `store_id`.

### PUT /api/v1/products/{product_id}/modifiers/{modifier_id}/recipe-items
- **Purpose**: **Bulk-replace** all of a modifier's ingredient deductions for this product. This is a full replace — whatever you send becomes the complete set; omitted rows are deleted.
- **Auth**: **MANAGER or OWNER only** (`403` otherwise).
- **Path params**: `product_id` (CUID), `modifier_id` (CUID).
- **Request**:
  ```json
  {
    "items": [
      {
        "inventory_item_id": "cku... — CUID of the inventory item to deduct",
        "quantity": "25.000 — Decimal, -999999.999 .. 999999.999",
        "mode": "delta — one of 'override' | 'delta' (default 'override')"
      }
    ]
  }
  ```
  Send `{"items": []}` to clear all deductions for this modifier on this product.
- **Response** (200): the new full list, same shape as GET (echoes back the persisted rows incl. generated `id`).
- **Response** (error):
  - `403` — caller is not MANAGER/OWNER.
  - `404` — modifier not attached to this product, or product not in caller's store.
  - `422` — validation error (e.g. `quantity` out of range, invalid `mode`).
- **Notes**: Idempotent for a given payload (full replace). Unique per `(product_id, modifier_id, inventory_item_id)` — do not send the same `inventory_item_id` twice in one payload.

---

## Data Models / DTOs

```typescript
// Returned by GET and PUT recipe-items endpoints
interface ModifierRecipeItemRead {
  id: string;                 // CUID
  inventory_item_id: string;  // CUID of the inventory item deducted
  quantity: string;           // Decimal as string, 3 dp (e.g. "25.000"); may be negative in 'delta' mode
  mode: 'override' | 'delta';
}

// Sent in the PUT body
interface ModifierRecipeItemInput {
  inventory_item_id: string;
  quantity: string;                    // Decimal, -999999.999 .. 999999.999
  mode?: 'override' | 'delta';         // default 'override'
}
interface ModifierRecipeItemsBulkReplace {
  items: ModifierRecipeItemInput[];
}

// Modifier payloads — NOTE the removed fields vs. previous version
interface ModifierRead {
  id: string;
  name: string;
  price_delta: string;   // Decimal
  sort_order: number;
  is_active: boolean;
  // REMOVED: inventory_item_id, inventory_qty
}
```

## Enums & Constants

| `mode` value | Meaning | Suggested Display Label |
|--------------|---------|-------------------------|
| `override`   | This modifier **replaces** the product's base recipe usage of this ingredient with `quantity` (an absolute amount). | "Set to" |
| `delta`      | This modifier **adds** `quantity` on top of the base usage. `quantity` may be negative to *reduce* usage. | "Add / subtract" |

## Validation Rules (mirror these in the form for good UX)

- `inventory_item_id`: required, must be an existing inventory item in the store.
- `quantity`: Decimal, range `-999999.999 .. 999999.999`, up to 3 decimal places. Negative values are only meaningful with `mode: "delta"` (to subtract).
- `mode`: must be exactly `"override"` or `"delta"`; defaults to `"override"` if omitted.
- The modifier's group must already be attached to the product (otherwise `404`). Configure the product's modifier groups first, then its per-menu deductions.

## Business Logic & Edge Cases

- **Per-menu isolation**: deductions configured for modifier M on product A have no effect on product B. Each product configures its own set.
- **Override vs delta at order time**: when an order line includes the modifier, for each configured ingredient: `override` sets the deducted amount to `quantity`; `delta` adds `quantity` to whatever the base recipe already deducts (negative = subtract). Amounts are multiplied by the line quantity.
- **Full-replace semantics**: PUT is not a merge. Always send the complete desired set.
- **Product duplication**: duplicating a product now **copies** its per-menu modifier recipe items to the new product. They are independent copies (editing one does not affect the other).
- **Single deduction system**: the old global per-modifier ingredient field is fully retired. There is exactly one way to configure modifier deductions now — these per-product recipe items.
- **Negative stock**: allowed (deductions can drive stock negative; backend warns but never blocks).

## Integration Notes

- **Recommended flow**: open a product → ensure its modifier groups are attached → for a chosen modifier, `GET` its recipe-items → edit in a small table (ingredient + quantity + mode) → `PUT` the full list on save.
- **Optimistic UI**: safe — PUT returns the authoritative full list; reconcile against the response.
- **Caching**: no special cache headers; refetch after a successful PUT.
- **Real-time**: none for this endpoint.

## Test Scenarios

1. **Happy path**: PUT two items (one `override`, one `delta`) on a product/modifier → 200 with both echoed back; GET returns the same two.
2. **Full replace**: PUT two items, then PUT one item → GET returns only the one item.
3. **Clear**: PUT `{"items": []}` → GET returns `[]`.
4. **Permission denied**: a BARISTA calls PUT → `403`.
5. **Modifier not on product**: PUT for a modifier whose group is not attached to the product → `404`.
6. **Cross-store**: caller from store A targets a product in store B → `404`.
7. **Validation**: `quantity` out of range or `mode` not in the enum → `422`.
8. **Per-menu isolation (the headline behavior)**: same modifier configured 25g on product A and 5g on product B → ordering A deducts 25g, ordering B deducts 5g.

## Migration / Deployment Note

- Deploying this feature runs migrations `0027` and `0028`. **`0027` deletes all existing `modifier_recipe_items` rows** (they were globally keyed and cannot be attributed to a product). Any store that had configured modifier recipe items under the old system must **re-enter** them per-product after deploy. Surface this to operations/PM before deploy.

## Open Questions / TODOs

- None outstanding. Confirm with PM that no production store relies on existing (global) modifier recipe items that would be cleared by migration `0027`.
