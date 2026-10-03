# API Handoff: Deleted-Items Listing & Restore ("Recycle Bin")

## Business Context
Managers need a way to see what was soft-deleted and bring it back. Nothing in this POS is hard-deleted — "deleting" a product, ingredient, staff member, etc. just sets `is_active = false`, so the row still exists and can be restored. This feature exposes, per entity, a **list-deleted** route (everything with `is_active = false`) and a **restore** route (flips it back to `is_active = true`). The frontend builds one "deleted / recycle bin" page per entity, each with a Restore action.

> **Status of this handoff:** **Products** and **Ingredients (inventory items)** are **live and deployed** — build those pages now. **Staff, Categories, Modifier groups, and Customers** are designed with an identical contract but **not yet implemented** — see [Not Yet Available](#not-yet-available). Don't wire those four until the next handoff revision confirms they're live.

## Auth (applies to every endpoint here)
- **Bearer JWT** required (`Authorization: Bearer <access_token>`), same token as the rest of the API.
- **Role: OWNER or MANAGER only.** BARISTA / BAKER get `403`. Hide the deleted-bin pages and Restore buttons from non-managers.
- `store_id` is taken from the JWT — never send it. You only ever see/restore your own store's records.

## Error envelope (all errors)
```json
{ "error": { "code": "SNAKE_CASE_CODE", "message": "Human readable message" } }
```
| HTTP | When |
|------|------|
| `401` | Missing/invalid/expired token |
| `403` | Authenticated but role is not OWNER/MANAGER |
| `404` | Restore target id doesn't exist in your store (`code: "not_found"`) |

---

## Endpoints — LIVE

### GET /api/v1/products/deleted
- **Purpose**: List all soft-deleted products in the current store.
- **Auth**: OWNER / MANAGER.
- **Request**: no query params, no body.
- **Response** `200` — array of `ProductRead` (same shape as the normal product list):
  ```json
  [
    {
      "id": "ckv9a1b2c3d4e5f6g7h8i9j0",
      "store_id": "ckstore0000000000000000",
      "category_id": "ckcat00000000000000000a",
      "name": "Iced Mocha",
      "description": null,
      "image_url": null,
      "price": "95.00",
      "is_active": false,
      "product_type": "MADE_TO_ORDER",
      "servings_per_batch": 1,
      "finished_goods_item_id": null,
      "created_at": "2026-06-20T08:00:00Z",
      "updated_at": "2026-06-23T09:15:00Z"
    }
  ]
  ```
- **Notes**: Returns only `is_active = false` rows. Unpaginated. Empty array if none.

### POST /api/v1/products/{product_id}/restore
- **Purpose**: Restore one soft-deleted product.
- **Auth**: OWNER / MANAGER.
- **Request**: no body. `product_id` in the path.
- **Response** `200` — the restored `ProductRead` with `"is_active": true`.
- **Response** (error): `404` if the id isn't in your store; `403` if not a manager.
- **Notes**: **Idempotent** — restoring an already-active product returns `200` (no error). After success, the product disappears from `/products/deleted` and reappears in `GET /products?is_active=true`.

### GET /api/v1/inventory/deleted
- **Purpose**: List all soft-deleted inventory items (ingredients) in the current store.
- **Auth**: OWNER / MANAGER.
- **Request**: no query params, no body.
- **Response** `200` — array of `InventoryItemRead` (same shape as the normal inventory list):
  ```json
  [
    {
      "id": "ckinv00000000000000000a",
      "name": "Oat Milk",
      "unit": "ml",
      "cost_per_unit": "0.0450",
      "stock_on_hand": "1200.000",
      "par_level": "2000.000",
      "is_active": false,
      "unit_size": "1000.000",
      "unit_price": "45.00",
      "status": "critical"
    }
  ]
  ```
- **Notes**: Only `is_active = false` rows. Unpaginated. `status` (`ok` / `low` / `critical`) is still computed from stock vs par even for deleted items — you can ignore it on the recycle-bin page.

### POST /api/v1/inventory/{item_id}/restore
- **Purpose**: Restore one soft-deleted inventory item.
- **Auth**: OWNER / MANAGER.
- **Request**: no body. `item_id` in the path.
- **Response** `200` — the restored `InventoryItemRead` with `"is_active": true`.
- **Response** (error): `404` if not in your store; `403` if not a manager.
- **Notes**: **Idempotent**. After success it leaves `/inventory/deleted` and reappears in `GET /inventory?is_active=true`.

---

## Data Models / DTOs
These are the **existing** read models — you almost certainly already have these types. The deleted-list endpoints return the **exact same shapes** as the active-list endpoints, so reuse your current `Product` / `InventoryItem` types and list-row components.

```typescript
interface ProductRead {
  id: string;
  store_id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  image_url: string | null;
  price: string;                 // decimal as string, 2dp
  is_active: boolean;            // false in deleted list, true after restore
  product_type: 'MADE_TO_ORDER' | 'PRODUCED' | 'COMPONENT';
  servings_per_batch: number;
  finished_goods_item_id: string | null;
  created_at: string;            // ISO 8601
  updated_at: string;
}

interface InventoryItemRead {
  id: string;
  name: string;
  unit: string;
  cost_per_unit: string;         // decimal, 4dp
  stock_on_hand: string;         // decimal, 3dp
  par_level: string;             // decimal, 3dp
  is_active: boolean;
  unit_size: string | null;
  unit_price: string | null;
  status: 'ok' | 'low' | 'critical';
}
```

## Validation Rules
None for the frontend to mirror — both list calls take no input, and restore takes only the path id (no body). Just gate the UI to OWNER/MANAGER.

## Business Logic & Edge Cases
- **Soft-delete model**: "deleted" everywhere in this POS means `is_active = false`. These routes never hard-delete and never permanently remove anything.
- **Idempotent restore**: calling restore on a record that's already active returns `200` with the record — it is not an error. Safe against double-clicks / retries.
- **Restore can't fail on name/phone/email collisions**: a deleted record still holds its unique slot, so a conflicting active duplicate can't exist. Restore won't return a 409 for uniqueness.
- **Cross-store / unknown id → `404`** with `code: "not_found"`.
- **Restored product's category may itself be deleted**: a product can come back while its old category is still soft-deleted. The product is active but its `category_id` may point at an inactive category — render the category defensively (it may not appear in your active-category list).

## Integration Notes — what you need to build/change
1. **New pages/routes** (manager-only): e.g. `/products/deleted` and `/inventory/deleted` (recycle bin). Two for now.
2. **New API calls**: `getDeletedProducts()`, `restoreProduct(id)`, `getDeletedInventory()`, `restoreItem(id)` — all with the auth header.
3. **Reuse existing types & row components** — responses match your current list shapes; no new DTOs.
4. **Role gate**: only show the deleted-bin nav entry + Restore buttons to OWNER/MANAGER. Handle `403` gracefully if a non-manager hits the route directly.
5. **After a successful restore**: remove the row from the deleted list locally (or refetch it) and, if the active list is cached, invalidate/refetch it so the item reappears.
6. **Entry point**: add a "View deleted" / recycle-bin link on the Products and Ingredients management screens.
- **Optimistic UI**: safe for restore (idempotent) — you can drop the row immediately and reconcile on response; on `404`/`403` re-add it and toast an error.
- **Real-time**: none. No Pusher events are emitted for delete or restore — these screens are pull/refresh only.
- **Caching**: no special cache headers; refetch on page open.

## Test Scenarios
1. **Happy path — list**: manager opens recycle bin → `GET /products/deleted` → renders only deleted products.
2. **Happy path — restore**: click Restore → `POST /products/{id}/restore` → `200`, row leaves the deleted list, reappears in active list.
3. **Idempotent restore**: double-click Restore → both calls return `200`, no error shown.
4. **Not found**: restore a stale id (already restored elsewhere / wrong store) → `404` → toast "Item no longer available", refresh list.
5. **Permission denied**: barista navigates directly to `/products/deleted` or calls restore → `403` → redirect / hide.
6. **Empty state**: no deleted records → `[]` → show empty-bin message.

## Not Yet Available
Designed with the **identical contract** (manager-gated `GET /<entity>/deleted` + `POST /<entity>/{id}/restore`, idempotent restore, same `*Read` response shapes), but **not deployed yet** — do **not** integrate until confirmed live:

| Entity | List (planned) | Restore (planned) | Response shape |
|--------|----------------|-------------------|----------------|
| Staff | `GET /api/v1/hr/staff/deleted` | `POST /api/v1/hr/staff/{user_id}/restore` | `StaffRead` |
| Categories | `GET /api/v1/categories/deleted` | `POST /api/v1/categories/{category_id}/restore` | `CategoryRead` |
| Modifier groups | `GET /api/v1/modifier-groups/deleted` | `POST /api/v1/modifier-groups/{group_id}/restore` | `ModifierGroupRead` |
| Customers | `GET /api/v1/customers/deleted` | `POST /api/v1/customers/{customer_id}/restore` | `CustomerRead` |

**Heads-up for Modifier groups**: deleting a modifier group permanently removes its child modifiers (they are NOT soft-deleted). So a restored modifier group comes back **empty** (`modifiers: []`) — the manager must re-add its options. Plan the UI copy accordingly when that entity ships.

## Open Questions / TODOs
- Four of the six entities (staff, categories, modifier groups, customers) are pending implementation — a follow-up handoff revision will flip them to LIVE. Build Products + Ingredients first; the rest are a copy of the same pattern.
