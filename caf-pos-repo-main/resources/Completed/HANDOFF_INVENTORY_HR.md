# Backend Handoff — Inventory & Dashboard Features

**Date:** 2026-05-03
**Frontend Completed** | **Backend Tasks Required** as outlined below

---

## Executive Summary

Frontend has added 4 new major features to the Inventory and HR systems:

1. **Ingredient Deletion** — Delete button with confirmation modal
2. **Usage Dashboard** — Ingredient consumption dashboard (last 7 days / current month)
3. **Expiry Date Tracking** — Displays expiration dates with warning indicator for ≤ 7 days
4. **HR Module** — Staff management, leave requests, and shift scheduling

---

# Feature 1: Ingredient Deletion (Soft Delete)

## Frontend Endpoint

```http
DELETE /api/v1/inventory/{item_id}
```

## Backend Status ✅ Complete

* Endpoint `DELETE /api/v1/inventory/{item_id}` already exists
* Performs soft delete by setting `is_active = False`
* Permissions limited to:

  * `OWNER`
  * `MANAGER`

### Required Action:

**No further backend work needed**

---

# Feature 2: Usage Dashboard (Ingredient Consumption Tracking)

## Frontend Logic

Frontend currently fetches:

```http
GET /api/v1/inventory/movements?limit=200
```

Then:

* Filters `type = "SALE"`
* Calculates ingredient usage over:

  * Last 7 days
  * Current month

---

## Current Problem ⚠️

No `SALE` stock movements are being generated in the database.

### Result:

Usage dashboard displays:

> “No usage data available”

---

## Backend Requirements

---

### 2A — Automatically Generate SALE Movements on Order Completion

When an order is marked:

* `PAID`
* `COMPLETED`

Backend must:

### Process:

1. Loop through each `OrderItem`
2. Retrieve product BOM (`BOMItem`)
3. Deduct inventory quantities
4. Create `StockMovement` records with:

   * `type = SALE`

---

### Suggested Service Logic

```python
async def deduct_inventory_for_order(
    db: AsyncSession,
    *,
    store_id: str,
    order_id: str,
    order_items: list[OrderItemRead],
    cashier_user_id: str,
) -> None:
    for oi in order_items:
        bom_items = await bom.get_bom_for_product(db, product_id=oi.product_id)
        for bom_item in bom_items:
            qty_used = bom_item.quantity * oi.qty

            inv_item = await _load_item(
                db,
                store_id=store_id,
                item_id=bom_item.inventory_item_id
            )

            inv_item.stock_on_hand -= qty_used

            db.add(
                StockMovement(
                    store_id=store_id,
                    inventory_item_id=bom_item.inventory_item_id,
                    type=MovementType.SALE,
                    quantity=qty_used,
                    ref_order_id=order_id,
                    created_by_id=cashier_user_id,
                )
            )
```

---

### Must Be Triggered From:

Order completion service when order status changes to:

* `PAID`
* `COMPLETED`

---

### 2B — Optional Performance Optimization

If movement records become too large:

## Add Dedicated Endpoint:

```http
GET /api/v1/inventory/usage-stats?period=week|month
```

---

### Expected Response:

```json
[
  {
    "inventory_item_id": "cuid...",
    "name": "Fresh Milk",
    "unit": "ml",
    "total_qty": 15000.0
  }
]
```

### Query Logic:

* SQL `GROUP BY inventory_item_id`
* Filter:

```sql
type = 'SALE'
created_at >= period_start
```

---

# Feature 3: Expiry Date Tracking

## Frontend Create Request

```http
POST /api/v1/inventory
```

```json
{
  "name": "Fresh Milk",
  "unit": "ml",
  "par_level": 5000,
  "cost_per_unit": 0.05,
  "expiry_date": "2026-06-01"
}
```

---

## Frontend Update Request

```http
PATCH /api/v1/inventory/{item_id}
```

```json
{
  "expiry_date": "2026-07-15"
}
```

---

## Backend Status ✅ Complete

Already implemented:

* `expiry_date` column exists in `InventoryItem`
* Included in:

  * `InventoryItemCreate`
  * `InventoryItemUpdate`
  * `InventoryItemRead`
* Supported by:

  * `create_item()`
  * `update_item()`

---

## Required Verification ⚠️

Ensure migration has been applied:

```bash
alembic revision --autogenerate -m "add expiry_date to inventory_items"
alembic upgrade head
```

### Direct SQL Alternative:

```sql
ALTER TABLE inventory_items ADD COLUMN expiry_date DATE;
```

---

# Expected Frontend Response Shapes

## `GET /api/v1/inventory`

```json
[
  {
    "id": "cuid...",
    "name": "Fresh Milk",
    "unit": "ml",
    "cost_per_unit": "0.0500",
    "stock_on_hand": "4500.000",
    "par_level": "5000.000",
    "is_active": true,
    "status": "low",
    "expiry_date": "2026-06-01"
  }
]
```

---

## `GET /api/v1/inventory/movements`

```json
{
  "items": [
    {
      "id": "...",
      "type": "SALE",
      "inventory_item_id": "...",
      "quantity": "250.000",
      "reason_code": null,
      "note": null,
      "supplier": null,
      "created_by": {
        "id": "...",
        "name": "Somchai"
      },
      "created_at": "2026-05-03T10:30:00Z"
    }
  ],
  "next_cursor": null
}
```

---

# Feature 4: HR Module (Staff Management)

## Overview

Frontend HR dashboard currently uses:

```http
/api/v1/reports/cashier-shifts
```

This provides:

* Staff names
* Daily sales
* Bills processed

---

## Missing Backend Components ⚠️

Full HR management module is not yet implemented.

---

# Required HR Endpoints

## Staff Management

```http
GET    /api/v1/hr/staff
POST   /api/v1/hr/staff
PATCH  /api/v1/hr/staff/{user_id}
DELETE /api/v1/hr/staff/{user_id}
```

---

## Leave Management

```http
GET    /api/v1/hr/leaves
GET    /api/v1/hr/leaves/mine
POST   /api/v1/hr/leaves
PATCH  /api/v1/hr/leaves/{id}/review
```

---

## Shift Scheduling

```http
GET    /api/v1/hr/shifts?week_start=YYYY-MM-DD
POST   /api/v1/hr/shifts
```

---

# Frontend Expected Schemas

## Staff

```json
[
  {
    "id": "cuid...",
    "name": "Praew Somjai",
    "role": "BARISTA"
  }
]
```

### Supported Roles:

* OWNER
* MANAGER
* BARISTA
* BAKER

---

## Leave Requests

```json
[
  {
    "id": "cuid...",
    "store_id": "...",
    "user_id": "...",
    "user_name": "Praew Somjai",
    "start_date": "2026-05-10",
    "end_date": "2026-05-11",
    "leave_type": "SICK",
    "status": "PENDING",
    "note": "Fever",
    "reviewed_by_id": null,
    "reviewed_at": null,
    "created_at": "2026-05-03T08:00:00Z",
    "updated_at": "2026-05-03T08:00:00Z"
  }
]
```

### Leave Types:

* VACATION
* SICK
* PERSONAL
* OTHER

### Status:

* PENDING
* APPROVED
* REJECTED

---

## Shift Assignments

```json
[
  {
    "id": "cuid...",
    "store_id": "...",
    "user_id": "...",
    "user_name": "Praew Somjai",
    "assignment_date": "2026-05-05",
    "shift_type": "MORNING",
    "notes": null,
    "created_by_id": "...",
    "created_at": "2026-05-03T08:00:00Z",
    "updated_at": "2026-05-03T08:00:00Z"
  }
]
```

### Shift Types:

* MORNING
* AFTERNOON
* EVENING
* FULL_DAY
* OFF

---

# Recommended Backend Implementation

## Create:

### API Layer

```bash
api/app/api/v1/hr.py
```

### Schemas

```bash
api/app/schemas/hr.py
```

### Models

```bash
api/app/models/hr.py
```

### Services

```bash
api/app/services/hr.py
```

---

## Register Router

```python
from app.api.v1 import hr
api_router.include_router(hr.router)
```

---

## Migration

Run Alembic migration after model creation.

---

# Permission Matrix

## All Store Users:

* View staff
* Submit leave requests
* View own leave requests
* View shift schedules

---

## Manager / Owner Only:

* Add/edit/delete staff
* Approve or reject leave
* Assign shifts

---

# Development Priority

| # | Task                                        | Priority    | Estimated Time |
| - | ------------------------------------------- | ----------- | -------------- |
| 1 | Verify/apply `expiry_date` migration        | 🔴 Critical | ~5 min         |
| 2 | Generate SALE movements on order completion | 🔴 Critical | 2–4 hrs        |
| 3 | Implement HR module                         | 🟠 High     | 4–6 hrs        |
| 4 | Usage stats endpoint (optional)             | 🟡 Medium   | ~1 hr          |

---

# Relevant Backend Files

```bash
api/app/models/inventory.py
api/app/schemas/inventory.py
api/app/services/inventory.py
api/app/api/v1/inventory.py
api/app/services/order.py
alembic/versions/
```

---

# Final Backend Delivery Goals

### Must-Have:

* Expiry migration verified
* Inventory deduction on order completion
* SALE movement generation
* HR module CRUD
* Leave system
* Shift scheduling

---

## Bottom Line

Frontend is production-ready.

Backend remaining tasks focus primarily on:

* Operational inventory automation
* HR infrastructure
* Analytics support

Once completed, the system will support:

### Full café operations:

* Inventory
* Staff
* Scheduling
* Leave
* Dashboard analytics
