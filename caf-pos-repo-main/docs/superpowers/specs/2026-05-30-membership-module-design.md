# Membership Module — Design Spec

**Date:** 2026-05-30
**Status:** Draft — awaiting implementation plan

---

## 1. Overview

A per-store loyalty membership system. Customers join with a name and phone number. They earn points on every purchase based on a rule the owner configures. When enough points accumulate, staff can redeem a reward during checkout. Owners control the earn rule, redemption threshold, reward type, and which products are eligible for the reward.

### Goals
- Zero friction checkout integration: phone lookup in ≤2 taps
- Owner-configurable without a developer
- Audit-safe: every point change has a paper trail
- Extensible: the data model supports tiers and expiry without a schema change

### Non-Goals (this spec)
- Mobile app / customer self-service portal
- LINE OA or SMS notifications (see §10)
- Multi-store shared membership
- Referral programs

---

## 2. Domain Model

### 2.1 `membership_programs` (new table)

One row per store. Created on first `PUT /membership/program` call.

| Column | Type | Notes |
|---|---|---|
| `id` | `String(24)` PK | CUID |
| `store_id` | `String(24)` FK → stores | `UNIQUE` — one program per store |
| `is_active` | `Boolean` | If false, no points are earned or redeemed |
| `earn_mode` | `Enum(EarnMode)` | See §3 |
| `baht_per_point` | `Numeric(10,2)` nullable | Required when `earn_mode = PER_BAHT` |
| `points_to_redeem` | `Integer` | Points required to unlock one reward |
| `reward_type` | `Enum(RewardType)` | See §3 |
| `reward_value` | `Numeric(10,2)` nullable | Baht off (FIXED) or percent (PERCENT) |
| `reward_scope` | `Enum(RewardScope)` | `ALL \| CATEGORY \| SPECIFIC_PRODUCTS` |
| `reward_category_id` | `String(24)` nullable FK → categories | Used when `reward_scope = CATEGORY` |
| `min_order_baht` | `Numeric(10,2)` nullable | Min order total to earn points. `NULL` = no minimum |
| `created_at` / `updated_at` | `DateTime` | Via `TimestampMixin` |

### 2.2 `membership_reward_products` (new table)

Many-to-many between a program and the specific products that a `FREE_ITEM` or scoped reward can be applied to. Only populated when `reward_scope = SPECIFIC_PRODUCTS`.

| Column | Type |
|---|---|
| `program_id` | `String(24)` FK → membership_programs, `CASCADE` |
| `product_id` | `String(24)` FK → products, `CASCADE` |

Composite PK `(program_id, product_id)`.

### 2.3 `membership_accounts` (new table)

One row per enrolled customer. A customer who is NOT a member has no row here.

| Column | Type | Notes |
|---|---|---|
| `id` | `String(24)` PK | CUID |
| `customer_id` | `String(24)` FK → customers | `UNIQUE` (1:1 with Customer) |
| `store_id` | `String(24)` FK → stores | Denormalized for query convenience |
| `points_balance` | `Integer` | Denormalized running total. Must match sum of `point_transactions` |
| `lifetime_points_earned` | `Integer` | Cumulative earned (never decremented). Used for future tier logic |
| `joined_at` | `DateTime` | When they enrolled |
| `created_at` / `updated_at` | `DateTime` | Via `TimestampMixin` |

> **Design note:** `points_balance` is denormalized for fast checkout lookups. It is always updated within the same transaction as the `PointTransaction` insert, so it cannot drift.

### 2.4 `point_transactions` (new table)

Append-only ledger. Never updated or deleted.

| Column | Type | Notes |
|---|---|---|
| `id` | `String(24)` PK | CUID |
| `account_id` | `String(24)` FK → membership_accounts | |
| `store_id` | `String(24)` FK → stores | |
| `type` | `Enum(PointTxType)` | `EARN \| REDEEM \| ADJUST \| EXPIRE` |
| `delta` | `Integer` | Positive = earn, Negative = redeem/expire |
| `balance_after` | `Integer` | Snapshot for audit / reconciliation |
| `order_id` | `String(24)` nullable FK → orders | Present on EARN and REDEEM |
| `note` | `Text` nullable | Required for ADJUST (reason from staff) |
| `created_by_id` | `String(24)` FK → users | Staff who triggered |
| `created_at` | `DateTime` | No `updated_at` — immutable |

### 2.5 Changes to existing tables

**`orders`** — add two nullable columns:

| Column | Type | Notes |
|---|---|---|
| `member_id` | `String(24)` nullable FK → membership_accounts | Which member was on this order |
| `points_earned` | `Integer` nullable | Points awarded for this order (0 if reward redeemed, still recorded) |
| `reward_redeemed` | `Boolean` | Whether a membership reward was applied |

The existing `discount` column on `Order` already handles the monetary discount. `reward_redeemed` is a flag so the order list can show the redemption icon.

---

## 3. Enums (additions to `app/enums.py`)

```python
class EarnMode(enum.StrEnum):
    PER_RECEIPT = "PER_RECEIPT"    # 1 point per paid order
    PER_BAHT    = "PER_BAHT"       # 1 point per N baht (N = baht_per_point)
    PER_ITEM    = "PER_ITEM"       # 1 point per item line (quantity × line count)


class RewardType(enum.StrEnum):
    DISCOUNT_FIXED   = "DISCOUNT_FIXED"    # N baht off total
    DISCOUNT_PERCENT = "DISCOUNT_PERCENT"  # N% off total
    FREE_ITEM        = "FREE_ITEM"         # one eligible item at 0 baht


class RewardScope(enum.StrEnum):
    ALL               = "ALL"               # any product in the order
    CATEGORY          = "CATEGORY"          # products in reward_category_id
    SPECIFIC_PRODUCTS = "SPECIFIC_PRODUCTS" # products in membership_reward_products


class PointTxType(enum.StrEnum):
    EARN   = "EARN"
    REDEEM = "REDEEM"
    ADJUST = "ADJUST"   # manual correction by manager/owner
    EXPIRE = "EXPIRE"   # future: automatic expiry job
```

---

## 4. API Endpoints

All routes live under `/api/v1/membership`. All require a valid JWT (`StoreUser`).

### 4.1 Program Configuration (Owner only)

```
GET  /membership/program
```
Returns the store's program config, or `404` if none exists yet.

```
PUT  /membership/program
```
Upserts the full program config. Body:

```json
{
  "is_active": true,
  "earn_mode": "PER_BAHT",
  "baht_per_point": 50,
  "points_to_redeem": 100,
  "reward_type": "FREE_ITEM",
  "reward_scope": "CATEGORY",
  "reward_category_id": "<cuid>",
  "min_order_baht": null
}
```

Validation rules:
- `baht_per_point` required and > 0 when `earn_mode = PER_BAHT`
- `reward_value` required and > 0 when `reward_type` is `DISCOUNT_FIXED` or `DISCOUNT_PERCENT`
- `reward_value` max 100 when `reward_type = DISCOUNT_PERCENT`
- `reward_category_id` required when `reward_scope = CATEGORY`
- `points_to_redeem` > 0

```
GET  /membership/program/reward-products
```
Lists product IDs (with name/price) in the `SPECIFIC_PRODUCTS` scope list.

```
PUT  /membership/program/reward-products
```
Replaces the full reward-products list. Body: `{ "product_ids": ["<cuid>", ...] }`. Validates all IDs belong to the store.

### 4.2 Checkout Flow (any staff)

```
POST /membership/lookup
```
Look up a member by phone number. Returns membership data and whether a reward is currently redeemable.

Request: `{ "phone": "0812345678" }`

Response:
```json
{
  "found": true,
  "account": {
    "id": "<cuid>",
    "customer_id": "<cuid>",
    "customer_name": "Somchai",
    "phone": "0812345678",
    "points_balance": 120,
    "lifetime_points_earned": 340,
    "joined_at": "2025-11-01T10:00:00Z"
  },
  "program": {
    "points_to_redeem": 100,
    "reward_type": "FREE_ITEM",
    "reward_scope": "CATEGORY",
    "reward_category_name": "Drinks"
  },
  "reward_redeemable": true,
  "eligible_reward_products": [
    { "id": "<cuid>", "name": "Latte", "price": 85 },
    { "id": "<cuid>", "name": "Americano", "price": 65 }
  ]
}
```

`found: false` returns `{ "found": false }` — never a 404 (avoids the "not found" error toast mid-checkout).

`eligible_reward_products` is populated only when `reward_redeemable: true`. It is the list the frontend shows so staff can ask "which drink would you like free?"

```
POST /membership/register
```
Register a new member during checkout. Creates a `Customer` (if no customer exists with that phone) and a `MembershipAccount`.

Request:
```json
{
  "name": "Malee Jaidee",
  "phone": "0891234567"
}
```

Response: same shape as the `account` block in `/lookup`.

Error `409` if the phone is already registered as a member.

### 4.3 Order Integration

The existing `POST /orders` request gains three optional fields:

```json
{
  "...existing fields...",
  "member_id": "<membership_account_id>",
  "redeem_reward": false,
  "reward_product_id": null
}
```

- `member_id` — attach member to order; points are earned after order creation
- `redeem_reward: true` — deduct `points_to_redeem` and apply the computed discount; requires `member_id`
- `reward_product_id` — required when `reward_type = FREE_ITEM`; must be in the order and in scope

The service computes the discount amount (never trusted from the client):
- `DISCOUNT_FIXED`: `order.discount += program.reward_value`
- `DISCOUNT_PERCENT`: `order.discount += round(subtotal * reward_value / 100, 2)`
- `FREE_ITEM`: `order.discount += unit_price of reward_product_id in this order`

The discount is capped at `subtotal` so the total never goes negative.

### 4.4 Member Management (Manager / Owner)

```
GET  /membership/members?page=1&limit=50&name=&phone=
```
Paginated list of members with `points_balance` and `lifetime_points_earned`.

```
GET  /membership/members/{account_id}
```
Full member profile including the last 20 point transactions.

```
POST /membership/members/{account_id}/adjust
```
Manual point adjustment (manager/owner only). Creates a `PointTransaction` of type `ADJUST`.

Request: `{ "delta": -50, "note": "Correction: duplicate earn on order #1042" }`

Validation: `note` is required. Result balance cannot go below 0.

---

## 5. Checkout Flow — Step-by-Step

This is the intended frontend UX flow; the backend API supports it exactly.

```
Staff presses [Membership] button during checkout
│
├─ "Is the customer a member?"
│   ├─ YES → enter phone → POST /membership/lookup
│   │         ├─ found=true → show name, balance, reward status
│   │         │   └─ reward_redeemable=true → "Use reward? [Yes] [No]"
│   │         │       ├─ Yes (FREE_ITEM) → show eligible products, staff selects one
│   │         │       └─ No → proceed with member attached (points will still earn)
│   │         └─ found=false → "Phone not registered. Join today? [Yes] [No]"
│   │
│   └─ NO → "Interested in joining?"
│       ├─ YES → collect name + phone → POST /membership/register → confirm join
│       └─ NO → skip, complete order normally
│
└─ Complete order → POST /orders (with member_id and optional redeem_reward fields)
```

---

## 6. Point Earning Logic

Points are earned inside `create_order`, in the same `async with db.begin()` transaction block as stock deductions. This keeps earning atomic with order creation and consistent with the existing pattern.

```
If program.is_active AND order.member_id is set:
    If program.min_order_baht is set AND order.subtotal < min_order_baht:
        earned = 0
    Else:
        PER_RECEIPT → earned = 1
        PER_BAHT    → earned = floor(order.subtotal / program.baht_per_point)
        PER_ITEM    → earned = sum(item.quantity for item in order.items)

    If redeem_reward was also applied this order:
        earned = 0  (no double-dipping: reward applied = no earn on same order)

    Insert PointTransaction(type=EARN, delta=+earned, order_id=order.id)
    account.points_balance += earned
    account.lifetime_points_earned += earned
    order.points_earned = earned
```

> **Design decision:** earning is suppressed when a reward is redeemed on the same order. This is the industry standard (Starbucks, most Thai café apps). It prevents "redeem + immediately earn back" loops.

---

## 7. Reward Redemption Logic

Also runs inside `create_order`'s transaction:

```
If redeem_reward:
    Validate: account.points_balance >= program.points_to_redeem
    Validate: order subtotal > 0
    Validate: if FREE_ITEM, reward_product_id is in order.items AND in scope

    Compute discount_amount (see §4.3)
    order.discount = min(discount_amount, order.subtotal)
    order.total = order.subtotal - order.discount + order.tax
    order.reward_redeemed = True

    Insert PointTransaction(type=REDEEM, delta=-points_to_redeem, order_id=order.id)
    account.points_balance -= points_to_redeem
```

**Void handling:** When an order is voided via `void_order`, if `order.reward_redeemed` is true OR `order.points_earned > 0`, reverse the point transactions:
- For earned: Insert `ADJUST` with `delta = -points_earned`, note `"Auto-reversed: order #{order_number} voided"`
- For redeemed: Insert `ADJUST` with `delta = +points_to_redeem` at time of void, note `"Auto-reversed: order #{order_number} voided"`

This keeps the ledger consistent and never requires editing existing rows.

---

## 8. Business Rules & Edge Cases

| Scenario | Behaviour |
|---|---|
| Program not configured | `/lookup` returns 200 with a note field `"program_not_configured": true`; earn/redeem are no-ops in `create_order` |
| Program `is_active = false` | `/lookup` still works (balance visible); earn/redeem are skipped silently |
| Customer exists but not a member | `/lookup` returns `found: false`; staff can register them on the spot |
| Phone matches customer but not member | Same as above — the new `POST /register` links a new `MembershipAccount` to the existing `Customer` |
| Redeem, balance exactly equals `points_to_redeem` | Allowed; balance becomes 0 |
| Reward product no longer in menu (deleted/inactive) | `POST /orders` returns `422 REWARD_PRODUCT_UNAVAILABLE` |
| Order voided before kitchen starts | Points fully reversed (see §7) |
| Manual ADJUST brings balance below 0 | Rejected: `422 INSUFFICIENT_POINTS` |
| Two staff members process same member simultaneously | `points_balance` update is inside a `SELECT FOR UPDATE` on the `MembershipAccount` row to prevent double-earn race |

---

## 9. File Layout

Following the existing codebase patterns (router → service → model):

```
api/app/
  enums.py                          ← add EarnMode, RewardType, RewardScope, PointTxType
  models/
    membership.py                   ← MembershipProgram, MembershipAccount, PointTransaction
                                       MembershipRewardProduct (association table)
  schemas/
    membership.py                   ← all Pydantic request/response models
  services/
    membership.py                   ← get_program, upsert_program, lookup_member,
                                       register_member, list_members, get_member,
                                       adjust_points, _earn_points, _redeem_reward,
                                       _reverse_points (called by void_order)
  api/v1/
    membership.py                   ← router with all endpoints above
    router.py                       ← register membership router
  alembic/versions/
    0018_membership.py              ← new tables + order columns
```

`orders.py` service changes:
- `create_order` gains `member_id`, `redeem_reward`, `reward_product_id` params
- `void_order` calls `membership._reverse_points(db, order)` if applicable
- Import `from app.services import membership` (lazy import to avoid circular)

`models/__init__.py` — import `MembershipProgram`, `MembershipAccount`, `PointTransaction`.

---

## 10. Recommendations & Future Enhancements

These are not in scope for the initial implementation but are worth building the data model to support.

### High priority (ship in next iteration)

**Point expiry** — Add `points_expire_after_days: int | None` to `MembershipProgram`. A nightly scheduled job scans accounts whose last `EARN` transaction was older than the threshold and inserts `EXPIRE` transactions. This is industry standard and prevents unlimited point liability on the store's books. The `PointTxType.EXPIRE` value is already reserved for this.

**Birthday bonus** — Add `date_of_birth: Date | None` to `MembershipAccount` (collected optionally during registration). On birthday month: double points on every `EARN`. This is one of the highest-ROI loyalty features (increases foot traffic in birthday month).

### Medium priority

**Tier system** — Add `tier: Enum(BRONZE, SILVER, GOLD)` to `MembershipAccount`, computed from `lifetime_points_earned` thresholds set in `MembershipProgram`. Tiers can unlock a higher earn multiplier (`earn_multiplier: Numeric(4,2)` on the program config). The `lifetime_points_earned` column is already in the schema for this reason.

**LINE OA / SMS notifications** — In Thailand, LINE is the dominant channel. After each earn/redeem, push a LINE message: "คุณ Malee ได้รับ 5 แต้ม! ยอดรวม 85 แต้ม 🎉". This dramatically increases perceived value without any extra staff effort. Requires LINE Messaging API credentials stored in store config.

**Minimum points threshold for lookup** — Currently `/lookup` shows the reward as redeemable when `balance >= points_to_redeem`. A soft "next reward at X points" message motivating customers who are close to the threshold drives return visits. Include a `points_to_next_reward` field in the lookup response.

### Lower priority / optional

**QR code membership** — Instead of (or in addition to) phone lookup, generate a member QR from the customer app. Staff scans it. Eliminates typo risk and is faster. Requires a customer-facing app.

**Referral bonus** — Registering with a referral code earns the referrer bonus points. Requires a `referral_code` field on `MembershipAccount`.

**Partial redemption** — Allow redeeming less than a full `points_to_redeem` block (e.g., 50 pts = 25 baht partial discount). Simpler for customers, but requires changing `reward_type` logic significantly. Not recommended for MVP.

**Stamp card mode** — Some Thai cafés prefer a visual stamp card (every Nth receipt earns a stamp, Nth stamp = free item) over numeric points. This is functionally identical to `EarnMode.PER_RECEIPT` + `points_to_redeem = N`; the only difference is the UI representation. The backend already supports it — just needs a `display_mode: POINTS | STAMPS` flag on the program.

**Export / reporting** — Monthly CSV export of member activity for the owner. Top 10 members by spend. Loyalty ROI (discount given vs. incremental revenue). Add these to the existing `/reports` module.

---

## 11. Testing Plan

Following the project's real-Postgres + pytest pattern.

### Unit / integration tests (`tests/test_membership.py`)

**Program configuration**
- Owner can create and update program
- Non-owner cannot update program (403)
- Validation: `baht_per_point` required for `PER_BAHT` mode
- Validation: `reward_value` required for discount reward types

**Lookup**
- Returns `found: false` when phone unregistered
- Returns `found: true` with correct balance
- Returns `reward_redeemable: true` when balance ≥ threshold
- Returns `eligible_reward_products` scoped correctly (ALL / CATEGORY / SPECIFIC)

**Registration**
- Creates Customer + MembershipAccount for new phone
- Links MembershipAccount to existing Customer if phone already exists
- Returns 409 if phone already a member

**Earning — PER_RECEIPT**
- Order with member: 1 point earned, transaction recorded, balance updated
- Order without member: no transaction
- Order below `min_order_baht`: 0 points earned

**Earning — PER_BAHT**
- 150 baht order, 50 baht/point → 3 points
- 49 baht order, 50 baht/point → 0 points (floor division)

**Earning — PER_ITEM**
- Order with 2×Latte + 1×Muffin → 3 points

**Redemption — FREE_ITEM**
- discount = unit_price of reward_product; total reduced correctly
- Reward product not in order → 422
- Reward product out of scope → 422

**Redemption — DISCOUNT_FIXED / DISCOUNT_PERCENT**
- Correct discount computed
- Discount capped at subtotal (total never negative)

**No earn when reward redeemed on same order**

**Void reversal**
- Voiding an earn-order reverses points
- Voiding a redeem-order restores points

**Manual adjustment**
- Manager can adjust points with note
- Adjustment below zero rejected (422)
- Owner can also adjust

**Race condition guard**
- Concurrent earn on same account does not double-spend (SELECT FOR UPDATE)

---

## 12. Migration Notes

Migration `0018_membership.py`:

- Creates `earn_mode`, `reward_type`, `reward_scope`, `point_tx_type` Postgres enums with `create_type=False` pattern (see 0017 for reference)
- Creates `membership_programs`, `membership_accounts`, `point_transactions`, `membership_reward_products` tables
- Adds nullable `member_id`, `points_earned`, `reward_redeemed` columns to `orders`
- No data migration needed (all new)

Apply with: `uv run alembic upgrade head` (already runs as `preDeployCommand` on Railway)

---

## 13. Open Questions (resolved by design decision)

| Question | Decision |
|---|---|
| Should points be earned at order creation or at payment? | **Order creation** — consistent with stock deductions; void reversal handles cancellations |
| Should a reward earn points on the same transaction? | **No** — industry standard; prevents abuse |
| Should the discount amount come from the client? | **No** — always computed server-side from program config |
| 1:1 MembershipAccount on Customer, or fields on Customer? | **Separate table** — cleaner boundary, easier to extend with tiers |
| What if the store has no program configured? | **Graceful no-op** — lookup returns `program_not_configured`, earn/redeem skip silently |
