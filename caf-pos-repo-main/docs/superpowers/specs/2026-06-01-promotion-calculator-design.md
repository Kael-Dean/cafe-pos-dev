# Promotion Calculator — Design Spec

**Date:** 2026-06-01  
**Status:** Approved  
**Phase:** 1 of 2 (Phase 2 = Promotion Rule Engine, separate spec)

---

## Overview

A planning tool that helps managers decide whether a proposed discount is financially viable. The manager picks a product, enters a discount percentage, and sees: the margin impact, how many more units per week they need to sell to break even, and a strategy recommendation.

This is a **read-only planning tool** — it does not create promotions or affect checkout. The promotion rule engine (which fires discounts at checkout) is Phase 2.

---

## Entry Point

The tool lives on the existing **Promotions page** (`/promotions`) as a new **"Calculator" tab** — the 4th tab alongside the existing ทั้งหมด / ใช้งานอยู่ / ปิดใช้งาน tabs.

No other pages are changed.

---

## Architecture

**Principle: hybrid computation.** The frontend already has product price and cost-per-unit from the product catalog API. All margin arithmetic is pure math — the frontend computes it locally so the UI responds instantly as the manager adjusts the discount. The backend's only job is to provide what it uniquely owns: the sales history query.

```
Frontend (already has)        Backend provides
─────────────────────         ─────────────────
selling_price                 units_sold_in_window
cogs_per_unit                 avg_units_per_week
  → all margin math
  → break-even lift
  → recommendation text
```

### New backend files

| Action | Path |
|--------|------|
| Create | `api/app/api/v1/promotions.py` |
| Create | `api/app/services/promotions.py` |
| Create | `api/app/schemas/promotions.py` |
| Create | `api/tests/test_promotions_api.py` |
| Modify | `api/app/api/v1/router.py` (register router) |
| Modify | `api/app/schemas/catalog.py` — add `cost_per_unit` to `RecipeItemRead` |
| Modify | `api/app/services/catalog.py` — join `InventoryItem` in `get_product_detail` to populate it |

No new models. No migrations.

---

## Backend Endpoint

```
GET /api/v1/promotions/calculator/baseline
  ?product_id=<cuid>        required
  &days=30                  optional, default 30, range 1–365
```

**Auth:** `StoreUser` + `MANAGER` or `OWNER` role (same pattern as other manager-only endpoints).

**What it does:** Counts `order_items.quantity` for the given `product_id` across all non-voided orders within the last `days` days for the authenticated store. Returns the raw count and a weekly average.

### Response schema

```python
class PromotionBaselineResponse(BaseModel):
    product_id: str
    sales_window_days: int
    units_sold_in_window: Decimal   # total units sold in the window
    avg_units_per_week: Decimal     # units_sold_in_window / (days / 7)
```

### Edge cases

| Situation | Behaviour |
|-----------|-----------|
| No orders for this product in the window | Returns `units_sold_in_window: 0`, `avg_units_per_week: 0` |
| Product not found / wrong store | 404 |
| `days` out of range | 422 with validation message |
| Non-manager role | 403 |

### Service query

```python
# Pseudocode — count order_items for non-voided orders in date window
SELECT SUM(order_items.quantity)
FROM order_items
JOIN orders ON orders.id = order_items.order_id
WHERE order_items.product_id = :product_id
  AND orders.store_id = :store_id
  AND orders.status != 'VOID'
  AND orders.created_at >= now() - interval ':days days'
```

---

## Frontend: Calculator Logic

The frontend receives `avg_units_per_week` from the baseline endpoint and computes everything else locally. All inputs the frontend already has come from the product catalog (price, cogs_per_unit).

### Pre-requisite: expose cost data in ProductDetail

`RecipeItemRead` currently returns only `id`, `inventory_item_id`, and `quantity` — no cost. The frontend cannot compute COGS without knowing the cost per unit of each ingredient.

The implementation must add `cost_per_unit: Decimal` to `RecipeItemRead` and join the `InventoryItem` table in `get_product_detail` to populate it. This is a non-breaking additive schema change (one new field on an existing response).

With this change, the frontend can compute COGS from the BOM it already loads:

```
cogs_per_unit = Σ(recipe_item.quantity × recipe_item.cost_per_unit) / product.servings_per_batch
```

### Inputs

| Field | Source |
|-------|--------|
| `selling_price` | `ProductDetail.price` |
| `cogs_per_unit` | Computed from `ProductDetail.recipe` (see above) |
| `discount_pct` | Manager input (number field, 0–99) |
| `avg_units_per_week` | Baseline endpoint (fetched when product is selected) |

### Calculations

```
discounted_price        = selling_price × (1 - discount_pct / 100)

original_contribution   = selling_price - cogs_per_unit
original_margin_pct     = original_contribution / selling_price × 100

discounted_contribution = discounted_price - cogs_per_unit
discounted_margin_pct   = discounted_contribution / discounted_price × 100

required_lift_pct       = (original_contribution / discounted_contribution - 1) × 100
break_even_units_per_week = avg_units_per_week × (1 + required_lift_pct / 100)
```

> **Special case:** if `discounted_price ≤ cogs_per_unit`, the contribution is zero or negative — skip the lift calculation and show the `below_cost` recommendation immediately.

### Strategy recommendation

Evaluate in this priority order:

| Condition | Code | Badge colour | Text |
|-----------|------|-------------|------|
| `cogs_per_unit == 0` | `no_cost_data` | Grey | "No Bill of Materials found — add ingredient costs for accurate analysis." |
| `discounted_price ≤ cogs_per_unit` | `below_cost` | Red | "Selling below cost — you lose money on every unit regardless of volume." |
| `required_lift_pct > 50` | `high_risk` | Red | "Needs 50%+ volume increase to break even. Only viable with a major traffic driver." |
| `required_lift_pct > 20` | `moderate_risk` | Amber | "Achievable if paired with upselling or a traffic event (happy hour, weekend special)." |
| `required_lift_pct ≤ 20` | `viable` | Green | "Low bar to break even. Safe to run as a regular promotion." |

---

## UI Layout (Calculator Tab)

### Inputs row
Three controls in a single horizontal row:
- **Product** — searchable dropdown, lists all products for the store
- **Discount %** — number input, 0–99
- **Sales window** — dropdown: 7 days / 30 days / 90 days (default 30)

When the product changes, fetch the baseline endpoint. When discount % or window changes, recalculate locally — no new network request (except when window changes, which needs a new baseline fetch).

### Metric cards (4 cards, single row)
| Card | Value | Colour |
|------|-------|--------|
| Selling Price | e.g. ฿10.00 | Neutral |
| Cost / Unit | e.g. ฿4.05 | Neutral |
| Current Margin | e.g. 59.5% | Green tint |
| After Discount | e.g. 49.4% | Amber tint |

### Break-even headline card
The primary output. Large typography:

```
To break even, you need to sell
58 units / week
Currently ~48 units/week · requires +20.8% lift
                                    [⚡ MODERATE RISK]
```

### Recommendation strip
A left-bordered callout (colour matches recommendation badge) with the recommendation text.

### Empty / loading states
- **No product selected:** Show a prompt — "Select a product to start the analysis."
- **Loading baseline:** Spinner on the break-even section only; metric cards can compute immediately since price/COGS are already known.
- **No sales history:** Show "No sales data for this window" in place of the units/week figure. Still show margin cards and lift % so the manager sees the cost impact even without a baseline.

---

## Testing

### Backend (pytest)

Three tests in `api/tests/test_promotions_api.py`:

1. **Happy path** — seed a product with orders in the window → response returns correct `units_sold_in_window` and `avg_units_per_week`
2. **No sales history** — product exists, no orders in window → both fields return `0`
3. **Role gate** — authenticated as cashier (not manager/owner) → 403

### Frontend (unit tests)

Test the calculation functions in isolation with known inputs:

```
price=10, cogs=4.05, discount=20
→ discounted_price=8.00
→ original_margin=59.5%
→ discounted_margin=49.375%
→ required_lift=20.76%
→ recommendation="moderate_risk"
```

Edge cases: `discount=0` (no change), `cogs=0` (no_cost_data), `discount=100` (below_cost).

---

## What This Spec Does Not Cover

- Creating or saving promotions (Phase 2)
- Applying discounts at checkout (Phase 2)
- Comparing multiple products side-by-side (future)
- Time-of-day or day-of-week sales breakdown (future)
- Export / print (future)
