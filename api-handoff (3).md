# API Handoff: Promotions Module (Phase 1 + Phase 2)

## Business Context

The Promotions module lets managers create and analyse discount rules that the POS evaluates at checkout. **Phase 1** is a read-only planning tool — a "Calculator" tab that shows margin impact and break-even volume for a proposed discount before it goes live. **Phase 2** is the rule engine — managers create named promotions (% off, combo deals, happy hour) and cashiers see eligible promotions at checkout, toggling which ones to apply before taking payment. All promotion discounts stack additively with membership rewards into the order's existing `discount` field.

---

## Phase 1 — Promotion Calculator

### GET /api/v1/promotions/calculator/baseline

- **Purpose**: Returns historical sales volume for a product, used as the baseline for break-even analysis
- **Auth**: `MANAGER` or `OWNER` role required
- **Query params**:

| Param | Type | Required | Default | Constraints |
|-------|------|----------|---------|-------------|
| `product_id` | string (CUID) | yes | — | must belong to authenticated store |
| `days` | integer | no | `30` | 1–365 |

- **Response** (200):
  ```json
  {
    "product_id": "clx123abc000000000",
    "sales_window_days": 30,
    "units_sold_in_window": "144.00",
    "avg_units_per_week": "33.60"
  }
  ```
- **Response (errors)**:
  - `404` — product not found or belongs to a different store
  - `422` — `days` out of range
  - `403` — authenticated user is not MANAGER or OWNER

- **Notes**:
  - Only counts items from non-VOID orders
  - If the product has no sales in the window, both fields return `"0.00"` (not null)
  - All decimal values are returned as strings with 2 decimal places

### Frontend Calculator Logic (all computed client-side)

The baseline endpoint provides `avg_units_per_week`. Everything else comes from `GET /api/v1/products/{id}` (`ProductDetail`). **The `RecipeItemRead` schema now includes `cost_per_unit: Decimal`** — use this to compute COGS:

```
cogs_per_unit = Σ(recipe_item.quantity × recipe_item.cost_per_unit) / product.servings_per_batch
```

Then compute locally:

```
discounted_price        = selling_price × (1 - discount_pct / 100)
original_contribution   = selling_price - cogs_per_unit
original_margin_pct     = original_contribution / selling_price × 100
discounted_contribution = discounted_price - cogs_per_unit
discounted_margin_pct   = discounted_contribution / discounted_price × 100
required_lift_pct       = (original_contribution / discounted_contribution - 1) × 100
break_even_units_per_week = avg_units_per_week × (1 + required_lift_pct / 100)
```

**Special case**: if `discounted_price ≤ cogs_per_unit`, skip lift calculation and show `below_cost` recommendation.

#### Recommendation logic (evaluate in priority order)

| Condition | Code | Badge colour | Display text |
|-----------|------|-------------|--------------|
| `cogs_per_unit == 0` | `no_cost_data` | Grey | "No Bill of Materials found — add ingredient costs for accurate analysis." |
| `discounted_price ≤ cogs_per_unit` | `below_cost` | Red | "Selling below cost — you lose money on every unit regardless of volume." |
| `required_lift_pct > 50` | `high_risk` | Red | "Needs 50%+ volume increase to break even. Only viable with a major traffic driver." |
| `required_lift_pct > 20` | `moderate_risk` | Amber | "Achievable if paired with upselling or a traffic event (happy hour, weekend special)." |
| `required_lift_pct ≤ 20` | `viable` | Green | "Low bar to break even. Safe to run as a regular promotion." |

#### When to fetch vs recalculate

- Product changes → fetch `/calculator/baseline` + recalculate
- Discount % changes → recalculate only (no fetch)
- Sales window changes → fetch `/calculator/baseline` + recalculate

---

## Phase 2 — Promotion Rule Engine

### Promotion CRUD (MANAGER / OWNER only)

#### POST /api/v1/promotions

- **Purpose**: Create a promotion rule
- **Auth**: `MANAGER` or `OWNER`
- **Request**:
  ```json
  {
    "name": "Happy Hour Drinks",
    "type": "HAPPY_HOUR",
    "is_exclusive": false,
    "discount_pct": "15.00",
    "scope": "CATEGORY",
    "category_id": "clxcat000000000000",
    "product_ids_json": null,
    "min_quantity": null,
    "bundle_product_ids_json": null,
    "time_start": "15:00:00",
    "time_end": "17:00:00",
    "days_of_week_json": [0, 1, 2, 3, 4],
    "valid_from": "2026-06-01",
    "valid_until": "2026-08-31"
  }
  ```
- **Response** (201): full `PromotionRead` object (see Data Models)
- **Response (errors)**:
  - `422` — validation failure (name too long, discount_pct out of range, etc.)
  - `403` — insufficient role

---

#### GET /api/v1/promotions

- **Purpose**: List all promotions for the store
- **Auth**: `MANAGER` or `OWNER`
- **Query params**:

| Param | Type | Required | Notes |
|-------|------|----------|-------|
| `active` | boolean | no | `true` = active only, `false` = inactive only, omit = all |

- **Response** (200):
  ```json
  {
    "items": [ /* PromotionRead[] */ ],
    "total": 3
  }
  ```

---

#### GET /api/v1/promotions/{promotion_id}

- **Purpose**: Get a single promotion rule
- **Auth**: `MANAGER` or `OWNER`
- **Response** (200): `PromotionRead`
- **Response (errors)**: `404` — not found or wrong store

---

#### PATCH /api/v1/promotions/{promotion_id}

- **Purpose**: Update any fields on a promotion (including toggling `is_active`)
- **Auth**: `MANAGER` or `OWNER`
- **Request**: all fields optional — only send what's changing:
  ```json
  {
    "is_active": false
  }
  ```
- **Response** (200): updated `PromotionRead`
- **Response (errors)**: `404`, `422`, `403`

---

#### DELETE /api/v1/promotions/{promotion_id}

- **Purpose**: Hard-delete a promotion
- **Auth**: `MANAGER` or `OWNER`
- **Response**: `204 No Content`
- **Response (errors)**: `404`

---

### POST /api/v1/promotions/evaluate

- **Purpose**: Given the current cart items, return all currently-eligible promotions with computed discount amounts
- **Auth**: Any authenticated store user (cashiers included)
- **Request**:
  ```json
  {
    "items": [
      { "product_id": "clxprd000000000001", "quantity": 2 },
      { "product_id": "clxprd000000000002", "quantity": 1 }
    ]
  }
  ```
- **Response** (200):
  ```json
  {
    "eligible": [
      {
        "promotion_id": "clxprm000000000001",
        "name": "Happy Hour Drinks",
        "type": "HAPPY_HOUR",
        "discount_amount": "45.00",
        "is_exclusive": false
      }
    ]
  }
  ```
- **Notes**:
  - `eligible` is empty array (never null) when no promotions apply
  - Eligibility is evaluated against server time (UTC) — HAPPY_HOUR windows are checked server-side
  - Only active promotions within their `valid_from`/`valid_until` window are returned
  - Product IDs not found in the store's catalog are silently skipped (no 404)
  - Call this after every cart add/remove; debounce aggressively

---

### Checkout Integration

Add `promotion_ids` to your `CreateOrderRequest`:

```json
{
  "items": [...],
  "payment_method": "CASH",
  "promotion_ids": ["clxprm000000000001"]
}
```

- `promotion_ids` defaults to `[]` — safe to omit if no promotions selected
- The backend re-validates eligibility at checkout (guards stale frontend state)
- If an exclusive promotion + any other is included → `422`
- If a promotion is inactive, expired, or outside its time window at the moment of checkout → `422`
- Promotion discount is absorbed into the existing `order.discount` field (same field membership uses — they stack additively)

---

## Data Models / DTOs

```typescript
type PromotionType = 'PERCENT_OFF' | 'COMBO_BUNDLE' | 'COMBO_QUANTITY' | 'HAPPY_HOUR'
type PromotionScope = 'ORDER' | 'CATEGORY' | 'PRODUCT'

interface PromotionRead {
  id: string                          // CUID
  store_id: string
  name: string                        // max 120 chars
  type: PromotionType
  is_active: boolean
  is_exclusive: boolean               // cannot stack with any other promo if true
  discount_pct: string | null         // decimal string e.g. "15.00"
  scope: PromotionScope
  product_ids_json: string[] | null   // PERCENT_OFF/HAPPY_HOUR scope=PRODUCT, or COMBO_QUANTITY scope=PRODUCT
  category_id: string | null          // scope=CATEGORY
  min_quantity: number | null         // COMBO_QUANTITY: minimum total matching qty
  bundle_product_ids_json: string[] | null  // COMBO_BUNDLE: all must be in cart
  time_start: string | null           // "HH:MM:SS" — HAPPY_HOUR only
  time_end: string | null             // "HH:MM:SS" — HAPPY_HOUR only
  days_of_week_json: number[] | null  // 0=Mon, 1=Tue … 6=Sun — HAPPY_HOUR only
  valid_from: string | null           // "YYYY-MM-DD"
  valid_until: string | null          // "YYYY-MM-DD"
  created_at: string                  // ISO 8601
  updated_at: string
}

interface EligiblePromotion {
  promotion_id: string
  name: string
  type: PromotionType
  discount_amount: string             // decimal string e.g. "45.00"
  is_exclusive: boolean
}

interface EvaluateResponse {
  eligible: EligiblePromotion[]
}

interface PromotionListResponse {
  items: PromotionRead[]
  total: number
}

// Added to CreateOrderRequest (Phase 2)
interface CreateOrderRequest {
  // ...existing fields...
  promotion_ids: string[]             // defaults to [] if omitted
}

// Added to RecipeItemRead (Phase 1 prerequisite)
interface RecipeItemRead {
  id: string
  inventory_item_id: string
  quantity: string                    // decimal
  cost_per_unit: string              // decimal — NEW in Phase 1
}
```

---

## Enums & Constants

### PromotionType

| Value | Description | Relevant fields |
|-------|-------------|-----------------|
| `PERCENT_OFF` | Flat % off order / category / specific products | `scope`, `product_ids_json`, `category_id` |
| `COMBO_BUNDLE` | All listed products must be in cart | `bundle_product_ids_json` |
| `COMBO_QUANTITY` | Min qty of matching items required | `min_quantity`, `scope`, `product_ids_json`, `category_id` |
| `HAPPY_HOUR` | Time + day-of-week window; same scope options as PERCENT_OFF | `time_start`, `time_end`, `days_of_week_json`, `scope`, etc. |

### PromotionScope

| Value | Applies to | Required field |
|-------|-----------|----------------|
| `ORDER` | Entire subtotal | none |
| `CATEGORY` | Items in a specific category | `category_id` |
| `PRODUCT` | Specific products | `product_ids_json` |

### Days of week (days_of_week_json)

`0` = Monday, `1` = Tuesday, … `6` = Sunday. Server uses `datetime.weekday()` (Python convention, not JS `getDay()`).

---

## Validation Rules

### PromotionCreate / PromotionUpdate

| Field | Rule |
|-------|------|
| `name` | required on create, max 120 chars |
| `discount_pct` | required on create, `> 0` and `≤ 100` |
| `scope` | defaults to `ORDER` |
| `product_ids_json` | required when `scope = PRODUCT` (for PERCENT_OFF / HAPPY_HOUR / COMBO_QUANTITY) |
| `category_id` | required when `scope = CATEGORY` |
| `bundle_product_ids_json` | required for `COMBO_BUNDLE` |
| `min_quantity` | required for `COMBO_QUANTITY`, `≥ 1` |
| `time_start` / `time_end` | required for `HAPPY_HOUR` |
| `days_of_week_json` | optional for `HAPPY_HOUR`; if omitted, all days are valid |

### Calculator (client-side)

| Field | Rule |
|-------|------|
| `discount_pct` input | 0–99 (integer, % field) |
| `days` window | 1–365 |
| `product_id` | required before fetching baseline |

---

## Business Logic & Edge Cases

- **Stacking**: multiple non-exclusive promotions can be combined. If any selected promotion has `is_exclusive: true`, no other promotion may be applied — disable the others in the UI immediately on selection.
- **Re-validation at checkout**: the backend re-runs eligibility when the order is submitted. If a HAPPY_HOUR expires in the seconds between evaluate and checkout, the order will return 422. Show a friendly error and re-call evaluate to refresh.
- **Promotion + membership stack**: promotion discount and membership reward both land in `order.discount` additively. No special handling needed on the frontend.
- **Cumulative discount cap**: total discount is capped at subtotal — order total cannot go negative (enforced in `create_order`).
- **Midnight-spanning HAPPY_HOUR**: `time_start > time_end` means the window spans midnight (e.g. 22:00–02:00). The backend handles this correctly.
- **COMBO_BUNDLE**: discount applies only to the bundle items' line totals, not the full cart.
- **COMBO_QUANTITY scope**: matching items determined by `scope` — ORDER (any item), CATEGORY, or PRODUCT.
- **No sales data (Phase 1)**: if a product has never been sold, `avg_units_per_week = 0`. Still render the margin cards; show "No sales data for this window" only for the break-even section.
- **No BOM (Phase 1)**: if `recipe` is empty or `cost_per_unit` fields are all 0, show `no_cost_data` recommendation — don't block the UI.

---

## Integration Notes

- **Recommended checkout flow**: On each item add/remove → debounce 300ms → call `POST /evaluate` → if `eligible.length > 0`, show badge → cashier opens bottom sheet → toggles promotions → `promotion_ids` sent with `CreateOrderRequest`
- **Optimistic UI**: Not safe for `promotion_ids` at checkout — always wait for the `POST /evaluate` response before showing available discounts. The discount amount displayed in the bottom sheet comes from the evaluate response (not computed client-side).
- **Exclusive lock**: When cashier selects an exclusive promotion, immediately disable all other checkboxes (do not wait for a new evaluate call).
- **Calculator tab fetch**: fetch baseline on product select and on window change; recalculate margin metrics on every discount % keystroke (no debounce needed — pure math).
- **List page filtering**: The `?active=true|false` param is server-side. The three tabs (ทั้งหมด / ใช้งานอยู่ / ปิดใช้งาน) map to: omit param / `active=true` / `active=false`.
- **Toggle active**: `PATCH /promotions/{id}` with `{ "is_active": false }` — no separate activate/deactivate endpoint.

---

## Test Scenarios

### Phase 1 — Calculator

1. **Happy path**: select product with sales + BOM → shows margin cards, break-even units, and a coloured recommendation
2. **No BOM**: product has no recipe items → `no_cost_data` grey badge, no crash
3. **No sales history**: product exists, no orders in window → break-even section shows "No sales data", margin cards still render
4. **Below cost**: discount % makes discounted price ≤ COGS → `below_cost` red badge, lift section hidden
5. **Role gate**: cashier (BARISTA) → 403 on baseline endpoint

### Phase 2 — Promotions Management

6. **Create PERCENT_OFF (ORDER scope)**: POST → 201 → appears in list under "ทั้งหมด" and "ใช้งานอยู่" tabs
7. **Create HAPPY_HOUR**: POST with `time_start`/`time_end`/`days_of_week_json` → 201
8. **Create COMBO_BUNDLE**: POST with `bundle_product_ids_json` → 201
9. **Toggle inactive**: PATCH `is_active: false` → disappears from ใช้งานอยู่ tab
10. **Delete**: DELETE → 204 → gone from all tabs

### Phase 2 — Checkout

11. **Evaluate — eligible**: cart contains items matching an active PERCENT_OFF → badge shows count
12. **Evaluate — HAPPY_HOUR outside window**: no promotions returned → no badge
13. **Evaluate — COMBO_BUNDLE missing item**: bundle product absent from cart → not in eligible list
14. **Exclusive selection**: select exclusive promo → all others disabled in UI
15. **Submit with promotion**: `promotion_ids` in request → order has non-zero `discount`, `PromotionRedemption` written
16. **Exclusive + another at checkout**: 422 with message naming the exclusive promotion
17. **Promotion expired at checkout**: `valid_until` passed between evaluate and submit → 422

---

## Open Questions / TODOs

- **Timezone**: HAPPY_HOUR time windows are evaluated against UTC server time. If the store operates in a non-UTC timezone, happy hour windows will need a timezone offset. This is flagged as a known limitation in the spec — no `timezone` field exists on the store yet.
- **Promotion usage limits** (e.g. max 50 redemptions/day) — not implemented; future scope.
- **Per-customer eligibility** (e.g. first order only) — not implemented; future scope.
- **Redemption reporting** — `promotion_redemptions` table is being written but there is no reporting endpoint yet. Future scope.
