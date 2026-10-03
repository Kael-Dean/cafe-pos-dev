# API Handoff: PER_ITEM Earn Category Filter

## Business Context
Loyalty programs can earn points "per item" on an order. Previously this counted **every** item on the receipt. Stores can now optionally restrict per-item earning to a **single product category** (e.g. earn points only on Drinks, not Pastries). This is purely a program-config addition — one new optional field on the existing membership program.

## Endpoints

### PUT /api/v1/membership/program
- **Purpose**: Create or update the store's membership program config (upsert; one program per store).
- **Auth**: Authenticated store user (`store_id` from JWT). Same as before.
- **Request** (only the new/relevant fields shown — full body unchanged otherwise):
  ```json
  {
    "earn_mode": "PER_ITEM",
    "earn_category_id": "clx... (category CUID) | null"
  }
  ```
- **Response** (200): full `ProgramRead`, now including `earn_category_id`.
- **Response** (error): `422` validation envelope (see below).
- **Notes**: `earn_category_id` is **only** valid when `earn_mode === "PER_ITEM"`. Sending it with any other earn mode is rejected.

### GET /api/v1/membership/program
- Unchanged except the response now includes `earn_category_id` (string | null).

## Data Models / DTOs

```typescript
interface MembershipProgram {
  // ...existing fields unchanged...
  earnMode: 'PER_RECEIPT' | 'PER_BAHT' | 'PER_ITEM';
  earnCategoryId: string | null; // NEW — category CUID, or null = count all items
  // ...
}
```
> Note: API field is snake_case (`earn_category_id`); shown camelCase above per FE convention.

## Validation Rules
| Field | Rule |
|-------|------|
| `earn_category_id` | Optional. May only be non-null when `earn_mode === "PER_ITEM"`. Must be an existing category id. |

- If `earn_category_id` is set while `earn_mode !== "PER_ITEM"` → `422`, message: `"earn_category_id only applies when earn_mode is PER_ITEM"`.
- `null` (or omitted) = legacy behavior: all items count.

## Business Logic & Edge Cases
- When `earn_mode === "PER_ITEM"` and `earn_category_id` is **null**: base points = sum of all item quantities (unchanged).
- When `earn_mode === "PER_ITEM"` and `earn_category_id` is **set**: base points = sum of quantities of items whose product belongs to that category only. Items in other categories earn nothing.
- If an order has no items in the selected category, points earned = `0`.
- Tier multipliers, birthday bonus, and `min_order_baht` still apply on top of the filtered base count — unchanged.
- If the selected category is later deleted, the FK is set to `null` (program falls back to counting all items). No error surfaced to the user.

## Integration Notes
- **UI**: On the program config form, show a category dropdown bound to `earn_category_id` **only when** earn mode is `PER_ITEM`. Hide/clear it for other modes (mirror the backend rule to avoid the 422). An empty selection = "All categories".
- Populate the dropdown from the existing categories list endpoint.
- No new endpoints, no realtime changes, no migration impact for the client.

## Test Scenarios
1. **Happy path (filtered)**: Set `earn_mode=PER_ITEM`, `earn_category_id=<Drinks>` → saved; GET returns it.
2. **Happy path (all items)**: `earn_mode=PER_ITEM`, `earn_category_id=null` → counts all items.
3. **Validation error**: `earn_mode=PER_RECEIPT` + non-null `earn_category_id` → `422` with the message above; surface inline on the field.
4. **Mode switch**: User picks a category then switches earn mode away from PER_ITEM → FE must clear `earn_category_id` before submit.
