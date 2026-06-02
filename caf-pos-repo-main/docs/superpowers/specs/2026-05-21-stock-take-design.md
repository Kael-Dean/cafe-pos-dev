# Stock Take Feature — Design Spec

**Date:** 2026-05-21
**Status:** Approved

---

## Overview

A manual stock check feature that lets any authenticated store user trigger a reconciliation at any time. The system derives which ingredients to check from actual orders in the period since the last check, calculates theoretical consumption, and lets the manager enter physical counts. Variances are written as tagged `ADJUST` movements — no new database tables required.

---

## Scope

- Backend: new `services/stock_takes.py` + `api/v1/stock_takes.py`
- No new models or migrations
- No role gate — any authenticated store user (`StoreUser`) can trigger a check
- Frontend will handle the UI interaction; this spec covers the API contract only

---

## API Endpoints

All endpoints under `/api/v1/stock-takes`.

### `GET /api/v1/stock-takes/preview`

Returns the current period boundaries and per-ingredient consumption data.

**Auth:** `StoreUser`

**Response:**
```json
{
  "period_start": "2026-05-15T08:00:00Z",
  "period_end": "2026-05-20T23:59:59Z",
  "items": [
    {
      "inventory_item_id": "abc123",
      "name": "Milk",
      "unit": "L",
      "consumed_in_period": 12.500,
      "system_quantity": 4.200
    }
  ]
}
```

**Period derivation:**
- `period_start` = `created_at` of the most recent `ADJUST` movement with `reason LIKE 'STOCK_TAKE|%'` for this store. Falls back to 30 days ago if no prior check exists.
- `period_end` = current UTC timestamp.

**Item derivation:**
- Join `Order → OrderItem → Product → RecipeItem → InventoryItem`
- Filter: `Order.store_id = store_id`, `Order.status IN (PAID, IN_PROGRESS, READY, COMPLETED)`, `Order.created_at BETWEEN period_start AND period_end`
- Group by `inventory_item_id`; sum `order_item.quantity × recipe_item.quantity` = `consumed_in_period`
- `system_quantity` = current `InventoryItem.stock_on_hand`
- If no orders exist in the period, returns `items: []` (not an error)

---

### `POST /api/v1/stock-takes`

Submits actual physical counts. Creates `ADJUST` movements for any variance and updates `stock_on_hand`.

**Auth:** `StoreUser`

**Request body:**
```json
{
  "items": [
    { "inventory_item_id": "abc123", "actual_quantity": 3.800 }
  ],
  "notes": "End of day Tuesday"
}
```

**Logic (single `async with db.begin()`):**
1. For each item in the payload, load current `stock_on_hand`.
2. Calculate `delta = actual_quantity - stock_on_hand`.
3. Skip items where `delta == 0`.
4. For items with variance:
   - Set `item.stock_on_hand = actual_quantity`
   - Create `StockMovement`:
     - `type = ADJUST`
     - `quantity = abs(delta)`
     - `reason = f"STOCK_TAKE|{'+' if delta > 0 else ''}{delta}|{notes or ''}"`
     - `created_by_id = current_user.id`

**Response:** list of adjusted items:
```json
[
  {
    "inventory_item_id": "abc123",
    "name": "Milk",
    "unit": "L",
    "system_quantity": 4.200,
    "actual_quantity": 3.800,
    "variance": -0.400
  }
]
```

Items not included in the payload are left untouched.

---

### `GET /api/v1/stock-takes/history`

Returns past stock take events grouped by submission time.

**Auth:** `StoreUser`

**Grouping:** All `ADJUST` movements with `reason LIKE 'STOCK_TAKE|%'` for the store, grouped by exact `created_at` + `created_by_id`. PostgreSQL's `now()` returns the transaction start time, so all movements from a single submission have identical `created_at` timestamps.

**Response:**
```json
[
  {
    "conducted_at": "2026-05-20T18:30:00Z",
    "conducted_by": "Somchai",
    "item_count": 8,
    "items": [
      {
        "name": "Milk",
        "unit": "L",
        "system_quantity": 4.200,
        "actual_quantity": 3.800,
        "variance": -0.400
      }
    ]
  }
]
```

`actual_quantity` and `system_quantity` are reconstructed from the reason string:
- `actual_quantity = float(parts[1])`
- `delta = float(parts[2])`
- `system_quantity = actual_quantity - delta`

Results are ordered by `conducted_at` descending (most recent first).

---

## File Structure

```
api/app/services/stock_takes.py   — preview, submit, history logic
api/app/schemas/stock_takes.py    — Pydantic request/response schemas
api/app/api/v1/stock_takes.py     — FastAPI router (3 endpoints)
api/tests/test_stock_takes_service.py  — service-layer tests
api/tests/test_stock_takes_api.py      — API-layer tests
```

Register router in `api/app/api/v1/router.py`.
Add `stock_takes` to the API modules list in `CLAUDE.md`.

---

## Movement Reason Format

```
STOCK_TAKE|<actual_quantity>|<signed_delta>|<notes>
```

Examples:
- `STOCK_TAKE|3.800|-0.400|End of day Tuesday`
- `STOCK_TAKE|6.500|+1.500|`
- `STOCK_TAKE|0.000|-2.000|`

`actual_quantity` is stored explicitly so history can be reconstructed without replaying other movements. `signed_delta` uses a `+`/`-` prefix. Notes may be empty.

---

## Edge Cases

| Case | Behaviour |
|---|---|
| No orders in period | Preview returns `items: []`, submit with empty items is a no-op |
| No prior stock take | `period_start` defaults to 30 days ago |
| Item not found on submit | Return 404 for that item |
| Item inactive on submit | Return 409 for that item |
| `actual_quantity < 0` | Reject at schema validation level (min 0) |
| `delta == 0` for an item | Skip silently — no movement created |
| Product has no recipe | Its orders don't contribute any ingredients to the preview |

---

## Testing Plan

**Service tests (`test_stock_takes_service.py`):**
- Preview with no prior check falls back to 30 days
- Preview correctly aggregates consumption from multiple orders
- Preview excludes VOID orders
- Preview excludes ingredients from products with no recipe
- Submit creates ADJUST movements for items with variance
- Submit skips items where delta = 0
- Submit updates `stock_on_hand` to actual value
- History returns movements grouped correctly

**API tests (`test_stock_takes_api.py`):**
- `GET /preview` returns correct period and items
- `POST` with actual counts returns adjusted items list
- `POST` with empty items list returns empty list
- `GET /history` returns past checks in descending order
- Cross-store isolation: store_b cannot see store_a's stock takes
