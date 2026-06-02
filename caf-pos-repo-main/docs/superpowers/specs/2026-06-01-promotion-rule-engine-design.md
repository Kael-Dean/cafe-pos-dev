# Promotion Rule Engine — Design Spec

**Date:** 2026-06-01
**Status:** Approved
**Phase:** 2 of 2 (Phase 1 = Calculator/Baseline, see `2026-06-01-promotion-calculator-design.md`)

---

## Overview

A rule engine that lets managers create named promotion rules (% off, combo deals, happy hour) that the POS evaluates at checkout. When items are in the cart, the system auto-detects eligible promotions and surfaces them for cashier confirmation. The cashier toggles which to apply; the discount is reflected in the order total before payment.

This is the write side of the promotions system — Phase 1 was read-only analysis, Phase 2 creates real promotions that affect orders.

---

## Promotion Types

| Type | Description |
|------|-------------|
| `PERCENT_OFF` | A flat percentage discount scoped to the whole order, a category, or specific products |
| `COMBO_BUNDLE` | Requires all listed products to be present in the cart; discounts those items |
| `COMBO_QUANTITY` | Requires a minimum quantity of matching items; discounts those items |
| `HAPPY_HOUR` | Time-of-day + day-of-week + optional date-range window; same scope options as PERCENT_OFF |

---

## Data Model

### New table: `promotions`

| Column | Type | Notes |
|--------|------|-------|
| `id` | String(24) CUID | PK |
| `store_id` | FK → stores CASCADE | multi-tenancy |
| `name` | String(120) | e.g. "Happy Hour Drinks" |
| `type` | Enum `PromotionType` | `PERCENT_OFF`, `COMBO_BUNDLE`, `COMBO_QUANTITY`, `HAPPY_HOUR` |
| `is_active` | Boolean | drives the list page tabs |
| `is_exclusive` | Boolean | if true, cannot stack with other promotions |
| `discount_pct` | Numeric(5,2) | required for all types |
| `scope` | Enum `PromotionScope` | `ORDER`, `CATEGORY`, `PRODUCT` |
| `product_ids_json` | JSON nullable | product CUIDs; used when scope=PRODUCT or for COMBO_BUNDLE/COMBO_QUANTITY |
| `category_id` | FK → categories nullable | used when scope=CATEGORY |
| `min_quantity` | Integer nullable | COMBO_QUANTITY: minimum matching items required |
| `bundle_product_ids_json` | JSON nullable | COMBO_BUNDLE: all these product CUIDs must appear in cart |
| `time_start` | Time nullable | HAPPY_HOUR: e.g. `15:00` |
| `time_end` | Time nullable | HAPPY_HOUR: e.g. `17:00` |
| `days_of_week_json` | JSON nullable | HAPPY_HOUR: list of ints 0–6 (0=Mon) |
| `valid_from` | Date nullable | overall validity window start |
| `valid_until` | Date nullable | overall validity window end |
| `created_at` | DateTime | TimestampMixin |
| `updated_at` | DateTime | TimestampMixin |

New enum values added to `app/enums.py`: `PromotionType`, `PromotionScope`.

### New table: `promotion_redemptions`

Append-only audit log of every time a promotion was applied to an order.

| Column | Type | Notes |
|--------|------|-------|
| `id` | String(24) CUID | PK |
| `promotion_id` | FK → promotions CASCADE | |
| `order_id` | FK → orders CASCADE | |
| `discount_amount` | Numeric(12,2) | actual baht saved on this order |
| `created_at` | DateTime | |

### Existing model changes

**`Order`** — no new columns. The existing `discount: Numeric(12,2)` field absorbs the total promotion discount, exactly as membership rewards do today. When both a promotion and a membership reward apply, they stack additively into `order.discount`.

**`CreateOrderRequest`** — one new field:
```python
promotion_ids: list[str] = Field(default_factory=list)
```

---

## Backend API

All endpoints live in the existing `api/app/api/v1/promotions.py` router (prefix `/promotions`).

### Promotion CRUD — manager/owner only

```
POST   /api/v1/promotions                    Create a promotion
GET    /api/v1/promotions?active=true|false  List all (optional filter by is_active)
GET    /api/v1/promotions/{id}               Get one
PATCH  /api/v1/promotions/{id}               Update (name, discount_pct, is_active, etc.)
DELETE /api/v1/promotions/{id}               Delete
```

### Evaluate endpoint — any authenticated store user

```
POST /api/v1/promotions/evaluate
```

**Request:**
```json
{
  "items": [
    {"product_id": "<cuid>", "quantity": 2},
    {"product_id": "<cuid>", "quantity": 1}
  ]
}
```

**Response:**
```json
{
  "eligible": [
    {
      "promotion_id": "<cuid>",
      "name": "Happy Hour Drinks",
      "type": "HAPPY_HOUR",
      "discount_amount": "45.00",
      "is_exclusive": false
    }
  ]
}
```

Pure read — no writes. The POS calls this after each item is added/removed. Returns only currently-eligible promotions (active, within validity window, conditions met, time matches server `now()`).

### Edge cases

| Situation | Behaviour |
|-----------|-----------|
| Promotion not found / wrong store | 404 |
| `promotion_ids` contains an inactive or ineligible promotion | 422 |
| `promotion_ids` contains an exclusive promotion + any other | 422 |
| `discount_pct` outside 0–100 | 422 with validation message |
| No items match promotion scope | promotion not returned from evaluate |

---

## Checkout Integration

In `create_order` (after computing `grand_total`, before writing the `Order` row):

1. If `req.promotion_ids` is non-empty, load and validate each promotion (active, belongs to this store, within validity window).
2. Re-evaluate eligibility against the actual cart items (guards against stale frontend data).
3. Enforce stacking: if any promotion in the list has `is_exclusive=True`, only that one may be applied — return 422 if others are also requested.
4. Compute `total_discount = sum(promo.discount_amount for promo in applied)`.
5. Write `Order` with `discount=total_discount`, `total=grand_total - total_discount`.
6. Write one `PromotionRedemption` row per applied promotion.
7. Continue with existing membership earn/redeem logic — promotion discount and membership discount stack additively in `order.discount`.

---

## Evaluator Logic

How each type determines eligibility and computes `discount_amount`:

### PERCENT_OFF / HAPPY_HOUR (same scope logic)

| Scope | Eligible when | Discount applied to |
|-------|---------------|---------------------|
| `ORDER` | Always (given active + window) | Full subtotal |
| `CATEGORY` | Any cart item belongs to that category (resolved via `products.category_id`) | Matching items' line totals |
| `PRODUCT` | Any cart item's product_id is in `product_ids_json` | Matching items' line totals |

HAPPY_HOUR additionally requires:
- `time_start ≤ now().time() < time_end` (server time, store timezone assumed UTC for now)
- `now().weekday()` is in `days_of_week_json`
- If `valid_from`/`valid_until` are set: `valid_from ≤ now().date() ≤ valid_until`

### COMBO_BUNDLE

- Eligible when every product_id in `bundle_product_ids_json` appears at least once in the cart.
- `discount_amount` = sum of matching bundle items' line totals × `discount_pct / 100`.

### COMBO_QUANTITY

- Eligible when the total quantity of items matching the promotion's scope ≥ `min_quantity`.
- `discount_amount` = matching items' line totals × `discount_pct / 100`.

---

## Frontend

### Promotions List Page (`/promotions`)

Fills the existing three tabs (ทั้งหมด / ใช้งานอยู่ / ปิดใช้งาน). Each row shows:
- Promotion name
- Type badge (colour-coded: `HAPPY HOUR` blue, `COMBO` purple, `% OFF` grey)
- Scope summary (e.g. "Category: Drinks · −15%")
- Active/Inactive status badge
- Edit button

A **"+ สร้างโปรโมชัน"** button opens the creation form. Toggling active/inactive hits `PATCH /promotions/{id}`.

### Creation / Edit Form

Two-row header: name + type selector. Below that: discount% + scope + scope target (product picker or category dropdown, conditionally shown). A type-specific section renders below:

- **% OFF** — no extra fields beyond scope
- **COMBO_BUNDLE** — multi-select product picker for bundle products
- **COMBO_QUANTITY** — min quantity input + scope/product picker
- **HAPPY_HOUR** — time range (HH:MM), day-of-week toggles (Mon–Sun chips), optional valid_from/valid_until date pickers

An **Exclusive** checkbox at the bottom of every form type.

### Checkout: Eligible Promotions

When items are in the cart, the POS calls `POST /promotions/evaluate`. If any promotions are returned:
- A **"🎉 N promotions available"** badge appears near the order total.
- Tapping the badge opens a bottom sheet listing eligible promotions.
- Each row shows: name, type badge, baht-saved preview (e.g. "−฿45").
- Cashier toggles promotions on/off; the total updates live.
- If the cashier selects an exclusive promotion, all other items in the list are disabled.
- Selected `promotion_ids` are sent with `CreateOrderRequest` on checkout.

---

## New Files

| Action | Path |
|--------|------|
| Modify | `api/app/enums.py` — add `PromotionType`, `PromotionScope` |
| Create | `api/app/models/promotions.py` — `Promotion`, `PromotionRedemption` |
| Modify | `api/app/models/__init__.py` — import new models |
| Modify | `api/app/schemas/promotions.py` — add CRUD + evaluate schemas |
| Modify | `api/app/services/promotions.py` — add CRUD + evaluator + apply logic |
| Modify | `api/app/api/v1/promotions.py` — add CRUD + evaluate endpoints |
| Modify | `api/app/schemas/orders.py` — add `promotion_ids` to `CreateOrderRequest` |
| Modify | `api/app/services/orders.py` — call evaluator + write redemptions in `create_order` |
| Create | `api/alembic/versions/<hash>_add_promotions.py` — migration |
| Modify | `api/tests/test_promotions_api.py` — expand with Phase 2 tests |

---

## Testing

### Backend (pytest) — 12 tests in `test_promotions_api.py`

1. Create PERCENT_OFF promotion → 201, fields persisted correctly
2. Create HAPPY_HOUR promotion → 201, time/day fields persisted
3. Create COMBO_BUNDLE promotion → 201, bundle products persisted
4. Create COMBO_QUANTITY promotion → 201, min_quantity persisted
5. List promotions — `?active=true` returns only active rows
6. Evaluate — HAPPY_HOUR eligible (mock time within window) → discount_amount correct
7. Evaluate — HAPPY_HOUR ineligible (outside time window) → empty eligible list
8. Evaluate — COMBO_BUNDLE ineligible (missing bundle product) → empty eligible list
9. Evaluate — COMBO_QUANTITY ineligible (qty below min) → empty eligible list
10. Checkout — promotion applied: `order.discount` set, `PromotionRedemption` row written
11. Checkout — exclusive promotion + second promotion → 422
12. Role gate — cashier (BARISTA) cannot POST/PATCH/DELETE promotions → 403; can call evaluate → 200

### Frontend (unit tests)

- Evaluate called after each item add/remove
- Bottom sheet renders correct discount preview per promotion
- Selecting exclusive promotion disables other checkboxes
- Order total updates live as promotions are toggled on/off
- `promotion_ids` list sent correctly in `CreateOrderRequest`

---

## What This Spec Does Not Cover

- Promotion usage limits (e.g. "max 50 redemptions per day") — future
- Per-customer promotion eligibility (e.g. "first order only") — future
- Promo codes / vouchers — future
- Reporting on redemption frequency and discount impact — future
