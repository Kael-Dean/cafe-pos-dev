# 06-06-2026 — Feature Handoff: Modifier Recipe Items + Shopping List Buy-Amount

> **Toolbox handoff.** Two backend features, written as *tools* you keep and reuse — same format as the master catalog (`05-06-2026 updates and functions of routes.md`). When you wire these up, append the tool rows to your `src/api/TOOLS.md` and link each screen to the tools it uses. Don't invent endpoints — the routes below are the real ones.

Source notes this consolidates: `api-handoff (9).md` (Modifier Recipe Items) + `HANDOFF_SHOPPING_LIST_QTY.md` (Shopping List amount-to-buy).

---

## Global conventions (the subset that matters here)

| Topic | Rule |
|---|---|
| **Base URL** | All routes under `/api/v1`. |
| **Auth** | Bearer JWT in `Authorization: Bearer <access_token>`. |
| **store_id** | Never sent by the client — read from the JWT. |
| **Error shape** | Non-2xx → `{"error": {"code": "SNAKE_CASE_CODE", "message": "..."}}`. Switch on `error.code`. |
| **Decimals** | Money/quantities are **JSON strings** (e.g. `"5.000"`, `"3.5"`). Parse before math; never JS-float them. |
| **Role legend** | `+BARISTA` = any floor staff (OWNER/MANAGER/BARISTA/BAKER); `+MANAGER` = OWNER or MANAGER. |

---

# Feature 1 — 🧩 Modifier Recipe Items

## What & why
Modifiers used to only adjust **price** (e.g. "Small = −5฿"). Now each modifier option can also adjust **which ingredients get deducted from stock and by how much**. Examples: "50% Spicy" overrides chili 10g → 5g and skips black pepper; "50% Sweet" reduces syrup and adds compensating water.

**The order flow does not change.** The backend applies the deduction math automatically at order time. Your only work is in **product/menu-management screens** — letting staff *configure* the per-ingredient adjustments for each modifier option.

## The tools

- **`modifier_groups_list_recipe_items`** — `GET /modifier-groups/{group_id}/modifiers/{modifier_id}/recipe-items` · **+BARISTA** · **When:** loading a modifier option's ingredient adjustments in the config screen. Returns `[]` when nothing is configured (means: use the full base recipe). → `list[ModifierRecipeItemRead]`. *404 if the group isn't in your store or the modifier isn't in that group.*
- **`modifier_groups_replace_recipe_items`** — `PUT /modifier-groups/{group_id}/modifiers/{modifier_id}/recipe-items` · **+MANAGER** · **When:** saving the adjustments. **Full replace** — overwrites all previous entries; send `{"items": []}` to clear. Idempotent (safe to retry / optimistic UI). · body `ModifierRecipeItemsBulkReplace` → `list[ModifierRecipeItemRead]` (200). *422 on bad `mode` or negative `override`; 403 for barista; 404 cross-store.*

## Shapes
```typescript
type ModifierRecipeMode = "override" | "delta";

interface ModifierRecipeItemRead {
  id: string;
  inventory_item_id: string;  // matches InventoryItem.id
  quantity: string;           // Decimal string e.g. "5.000"
  mode: ModifierRecipeMode;
}

interface ModifierRecipeItemInput {
  inventory_item_id: string;
  quantity: string;           // negative allowed for "delta" only
  mode: ModifierRecipeMode;   // defaults to "override" if omitted
}

interface ModifierRecipeItemsBulkReplace {
  items: ModifierRecipeItemInput[];
}
```

Example GET / PUT-response body:
```json
[
  { "id": "abc123...", "inventory_item_id": "inv_chili_id", "quantity": "5.000", "mode": "override" },
  { "id": "def456...", "inventory_item_id": "inv_water_id", "quantity": "3.000", "mode": "delta" }
]
```

## Modes

| Value | Meaning | Use when |
|---|---|---|
| `"override"` | Replace the base recipe quantity with this exact value | Fixed amount (e.g. "50% Spicy = exactly 5g chili"). `"0.000"` = skip deduction entirely. Must be `≥ 0`. |
| `"delta"` | Add this value to the base recipe quantity | Relative adjust (e.g. "+3ml water", "−5ml syrup"). Can introduce an ingredient **not** in the base recipe (implicit base of 0). Negative allowed. |

## Validation

| Field | Rule |
|---|---|
| `mode` | `"override"` or `"delta"` only → else 422. Defaults to `"override"` if omitted. |
| `quantity` | Decimal string, max 10 digits total, 3 decimals (`"5.000"`). |
| `quantity` (override) | `≥ 0`. Use `"0.000"` to disable — not a negative. |
| `quantity` (delta) | `-999999.999` … `999999.999`. |
| `inventory_item_id` | Valid inventory item in the same store. |
| `items` | `inventory_item_id` unique within one request. |

## Business logic & edge cases
- **Override fires first, then delta** if two selected modifiers touch the same ingredient. *Avoid designing groups where two options affect the same ingredient.*
- **Zero / negative resolved quantity → no deduction.** No "negative deduction" exists; it just does nothing.
- **`delta` can add non-recipe ingredients** (adds to implicit base 0).
- **PRODUCED products are unaffected** — this is `MADE_TO_ORDER` only. Recipe items are ignored for PRODUCED (they deduct finished goods).
- **`modifier.inventory_item_id` / `inventory_qty` is a separate, unchanged field** — that's for purely additive modifiers ("Extra Shot" adds espresso). Don't confuse the two.
- **Shared groups apply uniformly** — a "Sweetness" group linked to many products uses the same recipe-item quantities everywhere. Need different absolute amounts? Use separate groups.

## Config flow (management screen)
1. `products_get` → expand modifier group → select an option.
2. `modifier_groups_list_recipe_items` → render table (ingredient name, quantity, mode).
3. Resolve ingredient **names** via `GET /inventory` (`inventory_list`).
4. User edits → `modifier_groups_replace_recipe_items` (PUT) full list to save.
- **Order placement: no changes** to screen or payload.

## Test scenarios
1. **50% spicy:** PUT `[{chili,"5.000","override"},{pepper,"0.000","override"}]` → 200; order deducts 5g chili, 0g pepper.
2. **Clear all:** PUT `{"items": []}` → 200 `[]`; orders use full base recipe.
3. **Delta adds water:** PUT `[{water,"3.000","delta"}]` (not in recipe) → deduct 3ml water.
4. **Negative override:** → 422.
5. **Bad mode (`"multiply"`):** → 422.
6. **Cross-store group_id:** → 404.
7. **Barista PUT:** → 403.
8. **Empty state (GET before any PUT):** → 200 `[]` (not 404).

---

# Feature 2 — 🛒 Shopping List Buy-Amount

## What & why
The Shopping List used to show only the ingredient + unit (`Milk [g]`), no amount. The backend now computes a **suggested buy amount** per item and supports a **user override**. The UI should render the amount and let the user edit it.

## The tools

- **`shopping_list_list`** — `GET /shopping-list` · **StoreUser** · **When:** the shopping list screen. Each item now carries `suggested_qty` + `quantity`. → `list[ShoppingListItemRead]`.
- **`shopping_list_add`** — `POST /shopping-list` · **StoreUser** · **When:** add an ingredient (idempotent per item). Body may now include an optional `quantity` override at add time. · body `ShoppingListItemCreate` → `ShoppingListItemRead`. *201 if newly added, 200 if it already existed — both are success.*
- **`shopping_list_update`** — `PATCH /shopping-list/{item_id}` · **StoreUser** · **(NEW)** · **When:** user edits the amount. `{ "quantity": "12" }` to override, `{ "quantity": null }` to revert to the suggestion. → `ShoppingListItemRead`. *404 `SHOPPING_LIST_ITEM_NOT_FOUND` if the item isn't in the store.*
- **`shopping_list_remove`** — `DELETE /shopping-list/{item_id}` · **StoreUser** · unchanged · 204.
- **`shopping_list_print`** — `GET /shopping-list/print` · **StoreUser** · **When:** print view. Returns **text/plain** (not JSON); now includes the amount per line (`- Milk: 3.5 L  (note)`).

## Shapes
```typescript
interface ShoppingListItemRead {
  id: string;
  inventory_item_id: string;
  inventory_item_name: string;
  unit: string;
  suggested_qty: string;        // decimal string — always present, recomputed live
  quantity: string | null;      // user override; null = use suggestion
  note: string | null;
  added_by_id: string;
  created_at: string;           // ISO 8601
}

interface ShoppingListItemCreate {
  inventory_item_id: string;
  quantity?: string;            // optional override at add time (≥ 0)
  note?: string;
}

interface ShoppingListItemUpdate {
  quantity: string | null;      // "12" to override, null to revert to suggestion
}
```

`suggested_qty` = `max(0, demand_from_PENDING_pre_orders − stock_on_hand)`.

## Render rule
Show **`quantity ?? suggested_qty`** next to the unit, as an editable number input:

```
Milk   [ 3.5 ] g     ← suggested_qty (no override yet)   — quantity === null
Flour  [ 12  ] g     ← quantity override set by user
```
Distinguish an unedited suggestion (`quantity === null`) from an explicit override visually if you can (greyed vs. bold, or a "suggested" tag).

## UX
- On input edit → `PATCH` with the new `quantity`.
- "Reset to suggested" → `PATCH` with `quantity: null`.
- The suggestion auto-updates as PENDING pre-orders and stock change, so a non-overridden item always reflects current demand.

## Notes / gotchas
- Demand counts **PENDING pre-orders only** — IN_PROGRESS pre-orders already deducted stock, so they don't count toward "still to buy".
- All decimals are JSON strings — parse before arithmetic.
- `shopping_list_add` is idempotent per item; handle both 201 and 200 as success.

---

# Cookbook

| Task | Tools, in order |
|---|---|
| Make a modifier change ingredient deductions (e.g. "50% Spicy = half the chili") | `products_get` → `modifier_groups_list_recipe_items` → (join names via `inventory_list`) → `modifier_groups_replace_recipe_items` |
| Turn a modifier back to the base recipe | `modifier_groups_replace_recipe_items` with `{"items": []}` |
| Show "what to buy" with amounts | `shopping_list_list` → render `quantity ?? suggested_qty` |
| User edits / resets a buy-amount | `shopping_list_update` `{quantity:"12"}` / `{quantity:null}` |
| Print the shopping list | `shopping_list_print` (text/plain, includes amounts) |

---

# Appendix — request bodies

**Modifier Recipe Items**
- `ModifierRecipeItemInput`: `inventory_item_id`, `quantity`(decimal string; negative allowed for `delta` only), `mode`(`"override"` | `"delta"`, defaults `"override"`)
- `ModifierRecipeItemsBulkReplace`: `items`: [`ModifierRecipeItemInput`] (each `inventory_item_id` unique; `[]` clears)
- Response `ModifierRecipeItemRead`: `id`, `inventory_item_id`, `quantity`, `mode`

**Shopping List**
- `ShoppingListItemCreate`: `inventory_item_id`, `quantity?`(≥0), `note?`
- `ShoppingListItemUpdate`: `quantity`(string `≥0`, or `null` to revert)

---

*Consolidated 2026-06-06 from `api-handoff (9).md` + `HANDOFF_SHOPPING_LIST_QTY.md`. Both features are also folded into the master catalog `HANDOFF_2026-06-06_routes-and-modifier-recipe-items.md`. Keep `src/api/TOOLS.md` in sync.*
