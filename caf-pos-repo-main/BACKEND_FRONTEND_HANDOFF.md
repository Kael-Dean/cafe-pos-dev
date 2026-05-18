# Backend → Frontend Handoff

**Project:** Cafe POS  
**Backend:** FastAPI + SQLAlchemy 2.0 async + PostgreSQL  
**Base URL:** `https://<your-railway-domain>/api/v1`  
**OpenAPI Docs:** `https://<your-railway-domain>/docs`  
**Generated from:** commit `fb83eeb` (main branch, 2026-05-01)

---

## Table of Contents

1. [Auth & Security](#1-auth--security)
2. [Error Format](#2-error-format)
3. [Enums Reference](#3-enums-reference)
4. [Routes — Auth](#4-routes--auth)
5. [Routes — Inventory](#5-routes--inventory)
6. [Routes — Categories](#6-routes--categories)
7. [Routes — Products](#7-routes--products)
8. [Routes — Modifier Groups](#8-routes--modifier-groups)
9. [Routes — Orders](#9-routes--orders)
10. [Routes — Customers](#10-routes--customers)
11. [Routes — Realtime (KDS)](#11-routes--realtime-kds)
12. [Routes — Reports & Dashboard](#12-routes--reports--dashboard)
13. [Role × Route Matrix](#13-role--route-matrix)
14. [Data Model Notes](#14-data-model-notes)
15. [Seed / Demo Credentials](#15-seed--demo-credentials)
16. [Environment & CORS](#16-environment--cors)

---

## 1. Auth & Security

### Login flow

```
POST /api/v1/auth/login
  Body: { store_slug, pin }
  → { access_token, refresh_token, token_type: "bearer" }
```

Send `Authorization: Bearer <access_token>` on every protected request.

### Token lifetimes

| Token | Default TTL |
|-------|-------------|
| access | 8 hours (480 min) |
| refresh | 30 days (43 200 min) |

### JWT payload

```jsonc
{
  "sub":      "<user_cuid>",
  "store_id": "<store_cuid>",
  "role":     "OWNER" | "MANAGER" | "BARISTA" | "BAKER",
  "type":     "access" | "refresh",
  "iat":      1746000000,
  "exp":      1746028800
}
```

Algorithm: **HS256**. You can decode the payload locally (without verifying) to read `role` and `store_id` and skip an extra `/me` round-trip on app load.

### Refresh flow

```
POST /api/v1/auth/refresh
  Body: { refresh_token }
  → { access_token, token_type: "bearer" }
```

The refresh token is **not rotated** — keep the same refresh token until it expires.

### Logout

Stateless. Drop both tokens from storage; no server call required (the endpoint exists but is a no-op on the server).

### Rate limits

| Endpoint | Limit |
|----------|-------|
| `POST /auth/login` | 5 req / min per IP |
| All others | Unlimited |

---

## 2. Error Format

All errors return the same JSON envelope:

```jsonc
{
  "error": {
    "code":    "NOT_FOUND",       // machine-readable string
    "message": "Order not found"  // human-readable
  }
}
```

Validation errors (422) also include a `details` array with FastAPI's standard field-level breakdown.

| HTTP | code |
|------|------|
| 400 | `BAD_REQUEST` |
| 401 | `UNAUTHORIZED` |
| 403 | `FORBIDDEN` |
| 404 | `NOT_FOUND` |
| 409 | `CONFLICT` |
| 422 | `UNPROCESSABLE_ENTITY` |
| 429 | `RATE_LIMITED` |

---

## 3. Enums Reference

### Role
`OWNER` `MANAGER` `BARISTA` `BAKER`

### OrderStatus
`PENDING` `PAID` `IN_PROGRESS` `READY` `COMPLETED` `VOID`

### Channel
`DINE_IN` `TAKEAWAY` `DELIVERY`

### PaymentMethod
`CASH` `CARD` `QR_PROMPTPAY` `LINE_PAY` `TRUEMONEY` `OTHER`

### MovementType
`RECEIVE` `SALE` `WASTE` `ADJUST` `TRANSFER_IN` `TRANSFER_OUT`

### WastageReason
`EXPIRED` `SPILLED` `TRIAL` `DAMAGED` `OTHER`

### InventoryStatus _(computed, not stored)_
| Value | Condition |
|-------|-----------|
| `ok` | stock_on_hand ≥ par_level |
| `low` | stock_on_hand < par_level AND ≥ 50% of par_level |
| `critical` | stock_on_hand < 50% of par_level |

---

## 4. Routes — Auth

### `POST /api/v1/auth/login`
No auth required. Rate-limited 5/min per IP.

**Request body**
```jsonc
{
  "store_slug": "sukhumvit-49",  // 1–60 chars
  "pin":        "1234"           // 4–6 digits only
}
```

**Response 200**
```jsonc
{
  "access_token":  "<jwt>",
  "refresh_token": "<jwt>",
  "token_type":    "bearer"
}
```

---

### `POST /api/v1/auth/refresh`
No auth required.

**Request body**
```jsonc
{ "refresh_token": "<jwt>" }
```

**Response 200**
```jsonc
{ "access_token": "<jwt>", "token_type": "bearer" }
```

---

### `GET /api/v1/auth/me`
Requires `Authorization: Bearer <access_token>`.

**Response 200**
```jsonc
{
  "id":         "abc123def456ghi789jkl012",
  "name":       "Tan",
  "role":       "OWNER",
  "store_id":   "abc123def456ghi789jkl012",
  "store_name": "Sukhumvit 49",
  "tenant_id":  "abc123def456ghi789jkl012"
}
```

---

### `POST /api/v1/auth/logout`
Requires bearer token. Server no-op — just drop tokens client-side.  
**Response 204** No Content.

---

## 5. Routes — Inventory

All inventory routes require `Authorization: Bearer`.

---

### `GET /api/v1/inventory`

**Query params**

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `search` | string | — | Partial name match (max 120 chars) |
| `is_active` | bool | `true` | |

**Response 200** — array of `InventoryItemRead`
```jsonc
[
  {
    "id":            "abc123def456ghi789jkl012",
    "name":          "Espresso Beans",
    "unit":          "g",
    "cost_per_unit": "0.0030",
    "stock_on_hand": "8000.000",
    "par_level":     "6000.000",
    "is_active":     true,
    "status":        "ok"   // "ok" | "low" | "critical"
  }
]
```

---

### `GET /api/v1/inventory/low-stock`
Returns only items where `stock_on_hand < par_level`.

**Response 200** — same shape as list above.

---

### `GET /api/v1/inventory/movements`
Cursor-paginated movement log for the store.

**Query params**

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `item_id` | string | — | Filter to one inventory item |
| `cursor` | string | — | Opaque cursor from previous response |
| `limit` | int 1–200 | `50` | |

**Response 200**
```jsonc
{
  "items": [
    {
      "id":                "abc123def456ghi789jkl012",
      "type":              "RECEIVE",
      "inventory_item_id": "abc123def456ghi789jkl012",
      "quantity":          "500.000",
      "reason_code":       null,
      "note":              null,
      "supplier":          "Coffee Corp",
      "raw_reason":        null,
      "ref_order_id":      null,
      "created_by":        { "id": "abc123...", "name": "Tan" },
      "created_at":        "2026-05-01T05:00:00Z"
    }
  ],
  "next_cursor": "eyJ..."   // null when no more pages
}
```

---

### `GET /api/v1/inventory/{item_id}`
**Response 200** — single `InventoryItemRead`.

---

### `PATCH /api/v1/inventory/{item_id}`
Roles: **OWNER, MANAGER**.

**Request body** (all fields optional)
```jsonc
{
  "par_level":     "6000.000",   // ge=0, le=9999999.999
  "cost_per_unit": "0.0035"      // ge=0, le=99999.9999
}
```

**Response 200** — updated `InventoryItemRead`.

---

### `POST /api/v1/inventory/receive`
Record incoming stock. Roles: **OWNER, MANAGER, BARISTA, BAKER**.

**Request body**
```jsonc
{
  "item_id":       "abc123def456ghi789jkl012",
  "qty":           "500.000",      // gt=0, le=999999.999
  "cost_per_unit": "0.0030",       // ge=0, le=99999.9999
  "supplier":      "Coffee Corp",  // optional, max 120 chars
  "note":          "Batch A"       // optional, max 500 chars
}
```

**Response 200** — updated `InventoryItemRead`.

---

### `POST /api/v1/inventory/waste`
Record wastage. Roles: **OWNER, MANAGER, BARISTA, BAKER**.

**Request body**
```jsonc
{
  "item_id": "abc123def456ghi789jkl012",
  "qty":     "100.000",             // gt=0, le=999999.999
  "reason":  "EXPIRED",            // WastageReason enum
  "note":    "Milk left overnight" // optional, max 500 chars
}
```

**Response 200** — updated `InventoryItemRead`.

---

### `POST /api/v1/inventory/adjust`
Manual stock correction. Roles: **OWNER, MANAGER**.

**Request body**
```jsonc
{
  "item_id": "abc123def456ghi789jkl012",
  "delta":   "-50.000",  // negative removes stock; ge=-999999.999, le=999999.999
  "reason":  "Physical count shows 50 fewer units"  // min 3 chars, max 500
}
```

**Response 200** — updated `InventoryItemRead`.

---

## 6. Routes — Categories

All routes require `Authorization: Bearer`.

---

### `GET /api/v1/categories`

**Response 200**
```jsonc
[
  {
    "id":         "abc123def456ghi789jkl012",
    "store_id":   "abc123def456ghi789jkl012",
    "name":       "Coffee",
    "sort_order": 0,
    "is_active":  true,
    "created_at": "2026-04-01T00:00:00Z",
    "updated_at": "2026-04-01T00:00:00Z"
  }
]
```

---

### `POST /api/v1/categories`
Roles: **OWNER, MANAGER**.

**Request body**
```jsonc
{
  "name":       "Pastries",  // 1–80 chars, unique per store
  "sort_order": 1            // ge=0, default 0
}
```

**Response 201** — `CategoryRead`.

---

### `PATCH /api/v1/categories/{category_id}`
Roles: **OWNER, MANAGER**.

**Request body** (all optional)
```jsonc
{
  "name":       "Pastries & Cakes",
  "sort_order": 2
}
```

**Response 200** — `CategoryRead`.

---

### `DELETE /api/v1/categories/{category_id}`
Roles: **OWNER, MANAGER**.  
**Response 204** No Content.

---

## 7. Routes — Products

All routes require `Authorization: Bearer`.

---

### `GET /api/v1/products`

**Query params**

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `category_id` | string | — | Filter by category |
| `is_active` | bool | `true` | |
| `search` | string | — | Partial name match, max 120 chars |

**Response 200** — array of `ProductRead`
```jsonc
[
  {
    "id":          "abc123def456ghi789jkl012",
    "store_id":    "abc123def456ghi789jkl012",
    "category_id": "abc123def456ghi789jkl012",
    "name":        "Flat White",
    "description": null,
    "price":       "90.00",
    "is_active":   true,
    "created_at":  "2026-04-01T00:00:00Z",
    "updated_at":  "2026-04-01T00:00:00Z"
  }
]
```

---

### `POST /api/v1/products`
Roles: **OWNER, MANAGER**.

**Request body**
```jsonc
{
  "category_id": "abc123def456ghi789jkl012",  // optional
  "name":        "Flat White",                 // 1–120 chars
  "description": "Double ristretto",           // optional, max 500 chars
  "price":       "90.00",                      // ge=0, le=999999.99
  "is_active":   true
}
```

**Response 201** — `ProductRead`.

---

### `GET /api/v1/products/{product_id}`
Returns full product including recipe and attached modifier groups.

**Response 200** — `ProductDetail`
```jsonc
{
  "id":          "abc123def456ghi789jkl012",
  "store_id":    "abc123def456ghi789jkl012",
  "category_id": "abc123def456ghi789jkl012",
  "name":        "Flat White",
  "description": null,
  "price":       "90.00",
  "is_active":   true,
  "created_at":  "2026-04-01T00:00:00Z",
  "updated_at":  "2026-04-01T00:00:00Z",
  "recipe": [
    {
      "id":                "abc123def456ghi789jkl012",
      "inventory_item_id": "abc123def456ghi789jkl012",
      "quantity":          "18.000"
    }
  ],
  "modifier_groups": [
    {
      "id":         "abc123def456ghi789jkl012",
      "store_id":   "abc123def456ghi789jkl012",
      "name":       "Milk Type",
      "required":   true,
      "min_select": 1,
      "max_select": 1,
      "is_active":  true,
      "modifiers": [
        {
          "id":                "abc123def456ghi789jkl012",
          "name":              "Whole Milk",
          "price_delta":       "0.00",
          "inventory_item_id": "abc123def456ghi789jkl012",
          "inventory_qty":     "180.000",
          "sort_order":        0,
          "is_active":         true
        },
        {
          "id":                "abc123def456ghi789jkl012",
          "name":              "Oat Milk",
          "price_delta":       "10.00",
          "inventory_item_id": "abc123def456ghi789jkl012",
          "inventory_qty":     "200.000",
          "sort_order":        1,
          "is_active":         true
        }
      ]
    }
  ]
}
```

---

### `PATCH /api/v1/products/{product_id}`
Roles: **OWNER, MANAGER**.

**Request body** (all optional)
```jsonc
{
  "category_id": "abc123def456ghi789jkl012",
  "name":        "Flat White (Small)",
  "description": null,
  "price":       "80.00",
  "is_active":   false
}
```

**Response 200** — `ProductRead`.

---

### `DELETE /api/v1/products/{product_id}`
Roles: **OWNER, MANAGER**.  
**Response 204** No Content.

---

### `PUT /api/v1/products/{product_id}/recipe`
Bulk-replace the product's ingredient recipe. Send `items: []` to clear it.  
Roles: **OWNER, MANAGER**.

**Request body**
```jsonc
{
  "items": [
    { "inventory_item_id": "abc123def456ghi789jkl012", "quantity": "18.000" },
    { "inventory_item_id": "abc123def456ghi789jkl013", "quantity": "180.000" }
  ]
}
```

**Response 200** — array of `RecipeItemRead`
```jsonc
[
  { "id": "abc123...", "inventory_item_id": "abc123...", "quantity": "18.000" }
]
```

---

### `PUT /api/v1/products/{product_id}/modifier-groups`
Reorder or replace the modifier groups attached to a product. Array index determines `sort_order`.  
Roles: **OWNER, MANAGER**.

**Request body**
```jsonc
{ "modifier_group_ids": ["group_cuid_1", "group_cuid_2"] }
```

**Response 204** No Content.

---

## 8. Routes — Modifier Groups

All routes require `Authorization: Bearer`.

---

### `GET /api/v1/modifier-groups`

**Query params**

| Param | Type | Default |
|-------|------|---------|
| `is_active` | bool | `true` |

**Response 200**
```jsonc
[
  {
    "id":         "abc123def456ghi789jkl012",
    "store_id":   "abc123def456ghi789jkl012",
    "name":       "Milk Type",
    "required":   true,
    "min_select": 1,
    "max_select": 1,
    "is_active":  true,
    "modifiers": [
      {
        "id":                "abc123...",
        "name":              "Whole Milk",
        "price_delta":       "0.00",
        "inventory_item_id": "abc123...",
        "inventory_qty":     "180.000",
        "sort_order":        0,
        "is_active":         true
      }
    ]
  }
]
```

---

### `POST /api/v1/modifier-groups`
Roles: **OWNER, MANAGER**.

**Request body**
```jsonc
{
  "name":       "Milk Type",   // 1–80 chars
  "required":   true,
  "min_select": 1,             // ge=0
  "max_select": 1,             // ge=1, or null for unlimited
  "modifiers": [
    {
      "name":              "Whole Milk",
      "price_delta":       "0.00",        // ge=-9999.99, le=9999.99
      "inventory_item_id": "abc123...",   // optional — deducts stock on order
      "inventory_qty":     "180.000",     // required when inventory_item_id is set
      "sort_order":        0
    },
    {
      "name":              "Oat Milk",
      "price_delta":       "10.00",
      "inventory_item_id": "abc123...",
      "inventory_qty":     "200.000",
      "sort_order":        1
    }
  ]
}
```

**Response 201** — `ModifierGroupRead`.

---

### `PATCH /api/v1/modifier-groups/{group_id}`
Roles: **OWNER, MANAGER**.  
When `modifiers` is included it **bulk-replaces all modifiers** in the group.

**Request body** (all optional)
```jsonc
{
  "name":       "Milk",
  "required":   false,
  "min_select": 0,
  "max_select": null,
  "modifiers":  []   // sends empty array to remove all modifiers
}
```

**Response 200** — `ModifierGroupRead`.

---

### `DELETE /api/v1/modifier-groups/{group_id}`
Roles: **OWNER, MANAGER**.  
**Response 204** No Content.

---

## 9. Routes — Orders

All routes require `Authorization: Bearer`.

---

### `POST /api/v1/orders`
Create a new order. Inventory is automatically deducted via the product recipe and modifier links.  
Roles: **OWNER, MANAGER, BARISTA, BAKER**.

**Request body**
```jsonc
{
  "idempotency_key": "terminal-1-order-4821",  // max 120 chars — safe to retry
  "channel":         "DINE_IN",               // Channel enum
  "customer_id":     null,                     // optional
  "customer_note":   "No sugar",              // optional
  "items": [
    {
      "product_id":   "abc123def456ghi789jkl012",
      "quantity":     2,                        // ge=1
      "modifier_ids": ["mod_oat_milk_cuid"]    // selected modifier IDs
    }
  ]
}
```

**Response 201** — `OrderRead` (see shape below).

Duplicate `idempotency_key` within the same store returns the existing order (409 is not thrown — idempotent retry is safe).

---

### `GET /api/v1/orders`
Paginated order list.

**Query params**

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `status` | OrderStatus | — | Filter by status |
| `customer_id` | string | — | Filter by customer |
| `from` | datetime ISO 8601 | — | Inclusive lower bound |
| `to` | datetime ISO 8601 | — | Inclusive upper bound |
| `page` | int ≥1 | `1` | |
| `limit` | int 1–200 | `50` | |

**Response 200**
```jsonc
{
  "items": [ /* OrderRead[] */ ],
  "total": 142,
  "page":  1,
  "limit": 50
}
```

---

### `GET /api/v1/orders/{order_id}`

**Response 200** — `OrderRead`
```jsonc
{
  "id":             "abc123def456ghi789jkl012",
  "order_number":   1001,
  "store_id":       "abc123def456ghi789jkl012",
  "customer_id":    null,
  "status":         "PENDING",
  "channel":        "DINE_IN",
  "payment_method": null,
  "payment_ref":    null,
  "customer_note":  null,
  "subtotal":       "180.00",
  "discount":       "0.00",
  "tax":            "0.00",
  "total":          "180.00",
  "created_by_id":  "abc123def456ghi789jkl012",
  "items": [
    {
      "id":             "abc123def456ghi789jkl012",
      "order_id":       "abc123def456ghi789jkl012",
      "product_id":     "abc123def456ghi789jkl012",
      "product_name":   "Flat White",
      "quantity":       2,
      "unit_price":     "90.00",
      "line_total":     "180.00",
      "modifiers_json": { "Milk Type": "Oat Milk (+10)" }
    }
  ],
  "created_at": "2026-05-01T05:00:00Z",
  "updated_at": "2026-05-01T05:00:00Z"
}
```

---

### `PATCH /api/v1/orders/{order_id}/pay`
Mark an order paid. Sets `status → PAID`.  
Roles: **OWNER, MANAGER, BARISTA, BAKER**.

**Request body**
```jsonc
{
  "payment_method": "CASH",         // PaymentMethod enum
  "payment_ref":    null            // optional: QR trace ID, card ref, etc.
}
```

**Response 200** — `OrderRead`.

---

### `PATCH /api/v1/orders/{order_id}/status`
Advance or change status manually (KDS workflow).  
Roles: **OWNER, MANAGER, BARISTA, BAKER**.

**Request body**
```jsonc
{ "status": "IN_PROGRESS" }   // any valid OrderStatus
```

**Response 200** — `OrderRead`.

---

### `POST /api/v1/orders/{order_id}/void`
Void an order and restore inventory.  
Roles: **OWNER, MANAGER**.

**Request body**
```jsonc
{ "reason": "Customer cancelled" }   // optional
```

**Response 200** — `OrderRead` with `status: "VOID"`.

---

## 10. Routes — Customers

All routes require `Authorization: Bearer`.

---

### `GET /api/v1/customers`

**Query params**

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `name` | string | — | Partial match |
| `phone` | string | — | Partial match |
| `email` | string | — | Partial match |
| `page` | int ≥1 | `1` | |
| `limit` | int 1–200 | `50` | |

**Response 200** — `CustomersPage`
```jsonc
{
  "items": [
    {
      "id":       "abc123def456ghi789jkl012",
      "store_id": "abc123def456ghi789jkl012",
      "name":     "Somchai Jaidee",
      "phone":    "+66812345678",
      "email":    "somchai@example.com",
      "notes":    "Prefers oat milk",
      "is_active": true,
      "created_at": "2026-04-01T00:00:00Z",
      "updated_at": "2026-04-01T00:00:00Z",
      "recent_orders": [
        {
          "id":           "abc123def456ghi789jkl012",
          "order_number": 1042,
          "status":       "COMPLETED",
          "channel":      "DINE_IN",
          "total":        "180.00",
          "created_at":   "2026-04-30T10:00:00Z"
        }
      ]
    }
  ],
  "total": 38,
  "page":  1,
  "limit": 50
}
```

---

### `GET /api/v1/customers/{customer_id}`
**Response 200** — full `CustomerRead` (same shape as list item, with `recent_orders`).

---

### `POST /api/v1/customers`
Roles: **OWNER, MANAGER, BARISTA, BAKER**.

**Request body**
```jsonc
{
  "name":  "Somchai Jaidee",        // 1–120 chars
  "phone": "+66812345678",          // optional, max 30 chars
  "email": "somchai@example.com",   // optional, validated email format
  "notes": "Prefers oat milk"       // optional
}
```

**Response 201** — `CustomerRead`.

Phone and email are unique **per store**. Returns 409 on duplicate.

---

### `PATCH /api/v1/customers/{customer_id}`
Roles: **OWNER, MANAGER, BARISTA, BAKER**.

**Request body** (all optional)
```jsonc
{
  "name":  "Somchai J.",
  "phone": null,
  "email": "new@example.com",
  "notes": "Updated preference"
}
```

**Response 200** — `CustomerRead`.

---

### `DELETE /api/v1/customers/{customer_id}`
Roles: **OWNER, MANAGER**.  
Soft-delete (`is_active = false`). Order history is preserved.  
**Response 204** No Content.

---

## 11. Routes — Realtime (KDS)

Used to authorize Pusher private channels for the Kitchen Display System.

### `POST /api/v1/realtime/auth`
Requires `Authorization: Bearer`.  
Content-Type: `application/x-www-form-urlencoded`

**Form fields**

| Field | Notes |
|-------|-------|
| `socket_id` | Provided by the Pusher JS client |
| `channel_name` | Must be `kds-store-{store_id}` or end with `-kds-store-{store_id}` |

**Response 200** — Pusher auth object
```jsonc
{ "auth": "app_key:hmac_signature" }
```

If Pusher env vars are not set (disabled), returns `{ "auth": "" }`.

### Pusher events broadcast by the backend

| Event | Channel | Trigger |
|-------|---------|---------|
| `order.created` | `kds-store-{store_id}` | New order placed |
| `order.status_changed` | `kds-store-{store_id}` | Status updated |
| `order.voided` | `kds-store-{store_id}` | Order voided |
| `order.paid` | `kds-store-{store_id}` | Order paid |

Payload for all events is the full `OrderRead` object.

---

## 12. Routes — Reports & Dashboard

All routes require `Authorization: Bearer`. All routes except `dashboard/today` require role **OWNER or MANAGER**.

---

### `GET /api/v1/dashboard/today`
Any authenticated store user.

**Response 200**
```jsonc
{
  "revenue":     "4850.00",
  "order_count": 32,
  "avg_ticket":  "151.56",
  "top_items": [
    { "product_name": "Flat White", "quantity": 18, "revenue": "1620.00" }
  ]
}
```

---

### `GET /api/v1/reports/sales`
Roles: **OWNER, MANAGER**.

**Query params**

| Param | Type | Required | Notes |
|-------|------|----------|-------|
| `from` | datetime ISO 8601 | Yes | |
| `to` | datetime ISO 8601 | Yes | |
| `granularity` | string | No | `day` (default) \| `hour` \| `product` \| `category` \| `payment_method` |

**Response 200**
```jsonc
{
  "from_":         "2026-04-01T00:00:00Z",
  "to":            "2026-04-30T23:59:59Z",
  "granularity":   "day",
  "buckets": [
    { "bucket": "2026-04-01", "order_count": 34, "revenue": "5200.00" }
  ],
  "total_revenue": "152000.00",
  "total_orders":  982
}
```

`bucket` is a date string (`YYYY-MM-DD`) for `day`, hour string (`YYYY-MM-DDTHH`) for `hour`, or the entity name for `product` / `category` / `payment_method`.

---

### `GET /api/v1/reports/inventory-cogs`
Roles: **OWNER, MANAGER**.

**Query params:** `from` (datetime, required), `to` (datetime, required)

**Response 200**
```jsonc
{
  "from_": "2026-04-01T00:00:00Z",
  "to":    "2026-04-30T23:59:59Z",
  "items": [
    {
      "item_id":       "abc123...",
      "item_name":     "Espresso Beans",
      "unit":          "g",
      "quantity_sold": "18400.000",
      "cost_per_unit": "0.0030",
      "total_cogs":    "55.20"
    }
  ],
  "total_cogs": "1240.80"
}
```

---

### `GET /api/v1/reports/wastage`
Roles: **OWNER, MANAGER**.

**Query params:** `from` (datetime, required), `to` (datetime, required)

**Response 200**
```jsonc
{
  "from_": "2026-04-01T00:00:00Z",
  "to":    "2026-04-30T23:59:59Z",
  "by_reason": [
    {
      "reason_code":    "EXPIRED",
      "event_count":    3,
      "total_quantity": "1200.000",
      "estimated_cost": "1.44"
    }
  ],
  "total_quantity": "1200.000",
  "total_cost":     "1.44"
}
```

---

### `GET /api/v1/reports/low-stock`
Roles: **OWNER, MANAGER**.  
No query params.

**Response 200**
```jsonc
{
  "items": [
    {
      "item_id":       "abc123...",
      "item_name":     "Soy Milk",
      "unit":          "ml",
      "stock_on_hand": "400.000",
      "par_level":     "3000.000",
      "deficit":       "2600.000"
    }
  ],
  "total_items": 3
}
```

---

### `GET /api/v1/reports/cashier-shifts`
Roles: **OWNER, MANAGER**.

**Query params:** `from` (datetime, required), `to` (datetime, required)

**Response 200**
```jsonc
{
  "from_": "2026-04-01T00:00:00Z",
  "to":    "2026-04-30T23:59:59Z",
  "cashiers": [
    {
      "user_id":     "abc123...",
      "user_name":   "Nat",
      "order_count": 48,
      "revenue":     "7200.00",
      "void_count":  1
    }
  ]
}
```

---

## 13. Role × Route Matrix

✅ = allowed &nbsp;&nbsp; ❌ = forbidden &nbsp;&nbsp; — = any authenticated store user

| Action | OWNER | MANAGER | BARISTA | BAKER |
|--------|:-----:|:-------:|:-------:|:-----:|
| Login / Refresh / Me | ✅ | ✅ | ✅ | ✅ |
| View inventory list / detail | — | — | — | — |
| Update par level / cost | ✅ | ✅ | ❌ | ❌ |
| Receive / Waste stock | ✅ | ✅ | ✅ | ✅ |
| Adjust stock | ✅ | ✅ | ❌ | ❌ |
| View categories | — | — | — | — |
| Create / edit / delete category | ✅ | ✅ | ❌ | ❌ |
| View products | — | — | — | — |
| Create / edit / delete product | ✅ | ✅ | ❌ | ❌ |
| Edit product recipe / modifier groups | ✅ | ✅ | ❌ | ❌ |
| View modifier groups | — | — | — | — |
| Create / edit / delete modifier group | ✅ | ✅ | ❌ | ❌ |
| Create order | ✅ | ✅ | ✅ | ✅ |
| View orders | — | — | — | — |
| Pay order | ✅ | ✅ | ✅ | ✅ |
| Update order status | ✅ | ✅ | ✅ | ✅ |
| Void order | ✅ | ✅ | ❌ | ❌ |
| View customers | — | — | — | — |
| Create / update customer | ✅ | ✅ | ✅ | ✅ |
| Delete customer | ✅ | ✅ | ❌ | ❌ |
| Dashboard today | — | — | — | — |
| Sales / COGS / Wastage / Shifts reports | ✅ | ✅ | ❌ | ❌ |
| Low-stock report | ✅ | ✅ | ❌ | ❌ |

---

## 14. Data Model Notes

### IDs
All `id` fields are **24-character CUID2 strings** (e.g., `"abc123def456ghi789jkl012"`).

### Monetary values
All money fields (`price`, `subtotal`, `discount`, `tax`, `total`, `unit_price`, `line_total`, `revenue`, etc.) are returned as **decimal strings** (`"90.00"`) — not numbers. Use a Decimal library on the frontend when doing arithmetic to avoid floating-point drift.

### Timestamps
All `created_at` / `updated_at` fields are **ISO 8601 UTC** strings (`"2026-05-01T05:00:00Z"`).

### Quantity fields
Inventory quantities (`stock_on_hand`, `par_level`, `quantity`) are returned as **3-decimal-place strings** (`"8000.000"`).

### Pagination
Offset-paginated endpoints (`orders`, `customers`) return:
```jsonc
{ "items": [...], "total": 142, "page": 1, "limit": 50 }
```
Cursor-paginated endpoints (`inventory/movements`) return:
```jsonc
{ "items": [...], "next_cursor": "eyJ..." }  // next_cursor is null on last page
```

---

## 15. Seed / Demo Credentials

| Field | Value |
|-------|-------|
| `store_slug` | `sukhumvit-49` |
| Owner PIN | `1234` (user: Tan) |
| Manager PIN | `1234` (user: Ploy) |
| Barista PINs | `1111` Nat · `2222` Mint · `3333` Jay |

Pre-seeded inventory includes 22 items. Several are already in **low / critical** status on first load, which is useful for testing inventory alerts:

| Item | Status |
|------|--------|
| Soy Milk | critical (400 / 3000 ml) |
| Decaf Beans | critical (2100 / 4000 g) |
| Almond Croissant | critical (4 / 15 ea) |
| Lemon | low (28 / 30 ea) |
| Matcha Powder | low (400 / 600 g) |

---

## 16. Environment & CORS

The frontend origin must be listed in the Railway `CORS_ORIGINS` environment variable (comma-separated).

```
CORS_ORIGINS=https://your-frontend.vercel.app,http://localhost:3000
```

**Required Railway env vars**

| Var | Notes |
|-----|-------|
| `DATABASE_URL` | `postgresql+asyncpg://...` (auto-set by Railway Postgres plugin) |
| `JWT_SECRET` | Strong random string, ≥16 chars |
| `CORS_ORIGINS` | Comma-separated list of allowed frontend origins |

**Optional env vars**

| Var | Default | Notes |
|-----|---------|-------|
| `PUSHER_APP_ID` | — | All three Pusher vars required to enable KDS realtime |
| `PUSHER_KEY` | — | |
| `PUSHER_SECRET` | — | |
| `PUSHER_CLUSTER` | `ap1` | |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `480` | 8 hours |
| `REFRESH_TOKEN_EXPIRE_MINUTES` | `43200` | 30 days |
| `LOG_LEVEL` | `INFO` | |
| `ENVIRONMENT` | `local` | `local` \| `staging` \| `production` |
