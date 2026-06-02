# Cooking Steps Feature Design

**Date:** 2026-05-14
**Status:** Approved

## Overview

Add ordered, plain-text cooking steps to products in the BOM builder. Kitchen staff can tap a "?" button on any order item to load the steps on-demand as an emergency reference (e.g. new or covering staff). Steps are intentionally lightweight — no photos, timers, or modifier-awareness.

## Data Model

New table: `cooking_steps`

| Column | Type | Constraints |
|---|---|---|
| `id` | `String(24)` CUID | PK |
| `product_id` | `String(24)` | FK → `products.id` ON DELETE CASCADE, indexed |
| `sort_order` | `Integer` | `≥ 0` |
| `instruction` | `String(500)` | non-null |

- `UniqueConstraint("product_id", "sort_order")` — keeps ordering unambiguous
- No timestamps — steps are operational reference data, not audited records
- Gaps in `sort_order` after deletes are harmless; display always uses `ORDER BY sort_order`

## API Endpoints

All endpoints sit under `/products/{product_id}/steps` in the products router.

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/products/{product_id}/steps` | All roles | List steps in sort_order — used by both BOM builder and kitchen display |
| `POST` | `/products/{product_id}/steps` | Manager+ | Add a single step |
| `PATCH` | `/products/{product_id}/steps/{step_id}` | Manager+ | Edit instruction or sort_order |
| `DELETE` | `/products/{product_id}/steps/{step_id}` | Manager+ | Remove a step |
| `PUT` | `/products/{product_id}/steps` | Manager+ | Bulk replace all steps (drag-to-reorder) |

## Schemas

```python
class CookingStepRead(_ORM):
    id: str
    sort_order: int
    instruction: str

class CookingStepCreate(BaseModel):
    instruction: str = Field(min_length=1, max_length=500)
    sort_order: int | None = Field(None, ge=0)  # defaults to max+1 if omitted

class CookingStepUpdate(BaseModel):
    instruction: str | None = Field(None, min_length=1, max_length=500)
    sort_order: int | None = Field(None, ge=0)

class CookingStepsBulkReplace(BaseModel):
    steps: list[CookingStepCreate]
```

## Service Logic

New functions added to `services/catalog.py` alongside existing recipe logic:

- **`list_steps(db, *, store_id, product_id)`** — verifies product belongs to store, returns steps ordered by `sort_order`
- **`add_step(db, *, store_id, product_id, payload)`** — inserts one row; if `sort_order` not provided, defaults to `max(existing sort_order) + 1` (or `0` if no steps exist)
- **`update_step(db, *, store_id, product_id, step_id, payload)`** — loads step by id + product_id, patches only provided fields
- **`delete_step(db, *, store_id, product_id, step_id)`** — loads and hard-deletes the row
- **`replace_steps(db, *, store_id, product_id, payload)`** — `DELETE WHERE product_id = ?` then bulk insert, wrapped in `async with db.begin()` — same pattern as `replace_recipe`

## Migration

File: `alembic/versions/0012_cooking_steps.py`

- `down_revision = "0011"`
- `CREATE TABLE cooking_steps` with all columns, FK, index, and unique constraint
- Reversible: `DROP TABLE cooking_steps`

## Kitchen Display Integration

The kitchen "?" button calls `GET /products/{product_id}/steps` on-demand when tapped. Steps are **not** embedded in the order response — no changes to `OrderItemRead` or the orders service. The `product_id` on each `OrderItemRead` is the key used for the lookup.

## Out of Scope

- Modifier-aware steps
- Step photos, estimated times, or rich formatting
- Steps embedded in order responses
- Test suite (reference/emergency data, no financial impact)
