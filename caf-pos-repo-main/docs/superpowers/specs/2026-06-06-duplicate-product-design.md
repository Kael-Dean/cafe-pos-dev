# Duplicate Product — Design Spec

**Date:** 2026-06-06
**Status:** Approved
**Branch:** feat/duplicate-product (to be created)

---

## Goal

Allow managers to duplicate an existing product (including its recipe, modifier groups, and cooking steps) so they can quickly create a similar product without re-entering all data from scratch.

---

## Route

```
POST /api/v1/products/{product_id}/duplicate
```

- **Auth:** MANAGER or OWNER role required
- **Path param:** `product_id` — the source product to clone
- **Request body:** none
- **Response:** `ProductDetail` (HTTP 201)

---

## Behavior

### Name

The clone's name is `"Copy of {original_name}"`, truncated to 120 characters. The 8-char prefix means names ≥ 113 chars are silently clipped — no error raised.

### Fields Copied

| Field | Behavior |
|---|---|
| `name` | `"Copy of {original_name}"` (truncated to 120 chars) |
| `category_id` | Copied as-is |
| `description` | Copied as-is |
| `price` | Copied as-is |
| `product_type` | Copied as-is |
| `servings_per_batch` | Copied as-is |
| `is_active` | Copied as-is |
| Recipe items | New `RecipeItem` rows, same `inventory_item_id` and `quantity` |
| Modifier group links | New `ProductModifierGroup` rows, same group IDs and `sort_order` |
| Cooking steps | New `CookingStep` rows, same `instruction` and `sort_order` |
| `finished_goods_item_id` | `PRODUCED` type: new `InventoryItem` created. `MADE_TO_ORDER`: `None` |

### Store Isolation

Source product must belong to the requesting user's `store_id` (enforced by `_load_product` as with all other product operations).

---

## Service Layer

One new function `duplicate_product` in `app/services/catalog.py`:

```python
async def duplicate_product(
    db: AsyncSession, *, store_id: str, product_id: str
) -> ProductDetail:
```

All writes happen inside a single `async with db.begin()` block:

1. Load source product via `_load_product` (store ownership check + NotFound)
2. Load source recipe items, modifier group links (`ProductModifierGroup`), and cooking steps
3. Compute new name: `f"Copy of {product.name}"[:120]`
4. Insert new `Product` row; flush to obtain new ID
5. If `product_type == PRODUCED`: insert new `InventoryItem`, set `finished_goods_item_id`
6. Bulk-insert new `RecipeItem` rows
7. Bulk-insert new `ProductModifierGroup` rows
8. Bulk-insert new `CookingStep` rows
9. Assemble and return `ProductDetail` (same shape as `get_product_detail`)

No calls to other service functions (avoids nested transaction conflict per CLAUDE.md convention).

---

## Router

Add to `app/api/v1/products.py`:

```python
@router.post(
    "/{product_id}/duplicate",
    response_model=ProductDetail,
    status_code=201,
    summary="Duplicate a product with its recipe, modifier groups, and cooking steps",
    operation_id="products_duplicate",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def duplicate_product(
    product_id: str, user: StoreUser, db: DbSession
) -> ProductDetail:
    return await svc.duplicate_product(db, store_id=user.store_id, product_id=product_id)
```

No new schemas needed — response uses existing `ProductDetail`.

---

## Error Cases

| Condition | Error |
|---|---|
| `product_id` not found or belongs to different store | `NotFound` |
| DB constraint violation | rolls back (single transaction) |

---

## Tests

File: `api/tests/test_duplicate_product.py`

- `test_duplicate_product_copies_basic_fields` — name, price, category, type all match source (with "Copy of" prefix)
- `test_duplicate_product_copies_recipe` — new product has same recipe items (different row IDs)
- `test_duplicate_product_copies_modifier_groups` — new product has same modifier groups linked
- `test_duplicate_product_copies_cooking_steps` — new product has same steps
- `test_duplicate_produced_product_creates_new_inventory_item` — PRODUCED clone gets its own `finished_goods_item_id`
- `test_duplicate_product_not_found` — 404 for unknown product
- `test_duplicate_product_wrong_store` — 404 for product in another store
- `test_duplicate_product_requires_manager_role` — BARISTA gets 403

---

## Files Changed

| File | Change |
|---|---|
| `app/services/catalog.py` | Add `duplicate_product` function |
| `app/api/v1/products.py` | Add `POST /{product_id}/duplicate` route |
| `tests/test_duplicate_product.py` | New test file |

No schema changes, no migrations needed.
