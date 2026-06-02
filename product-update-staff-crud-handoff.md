# API Handoff: Product Update + Staff CRUD

## Business Context
This document covers two independent but commonly needed management flows: editing an existing product's details (price, category, name, etc.) and managing staff members (create, list, update, deactivate). Both are manager-only operations and form the backbone of the store management UI.

---

## Endpoints

### PATCH /api/v1/products/{product_id}
- **Purpose**: Update any combination of product fields — price, category, name, description, or active status
- **Auth**: MANAGER or OWNER
- **Request** (all fields optional — send only what you want to change):
  ```json
  {
    "category_id": "string | null — reassign or clear category",
    "name": "string — 1–120 chars",
    "description": "string | null — max 500 chars",
    "price": "decimal string — e.g. \"25.00\", min 0, max 999999.99",
    "is_active": "boolean"
  }
  ```
- **Response** (200):
  ```json
  {
    "id": "string (CUID)",
    "category_id": "string | null",
    "name": "string",
    "description": "string | null",
    "price": "string (decimal)",
    "is_active": "boolean",
    "created_at": "ISO 8601",
    "updated_at": "ISO 8601"
  }
  ```
- **Response** (error): `404` product not found or belongs to another store; `403` insufficient role; `422` validation failure
- **Notes**:
  - Sending `"category_id": null` explicitly clears the category (uncategorised product).
  - Omitting `category_id` entirely leaves it unchanged.
  - Price is a decimal string — parse with a decimal library, not `parseFloat`.

---

### GET /api/v1/hr/staff
- **Purpose**: List all active staff in the current store
- **Auth**: Any authenticated store user
- **Response** (200):
  ```json
  [
    {
      "id": "string (CUID)",
      "name": "string",
      "role": "OWNER | MANAGER | BARISTA | BAKER",
      "position": "JUNIOR | SENIOR | HEAD_OF_STAFF",
      "phone": "string | null",
      "email": "string | null",
      "address": "string | null",
      "is_active": true
    }
  ]
  ```
- **Notes**: Only active staff returned. Deactivated staff are excluded.

---

### GET /api/v1/hr/staff/{user_id}
- **Purpose**: Fetch a single staff member's full profile
- **Auth**: Any authenticated store user
- **Response** (200): Same shape as list item above
- **Response** (error): `404` not found or belongs to another store

---

### POST /api/v1/hr/staff
- **Purpose**: Create (onboard) a new staff member
- **Auth**: MANAGER or OWNER
- **Request**:
  ```json
  {
    "name": "string — required, 1–120 chars",
    "role": "OWNER | MANAGER | BARISTA | BAKER — required",
    "position": "JUNIOR | SENIOR | HEAD_OF_STAFF — required",
    "pin": "string — required, 4–8 digits",
    "phone": "string — required, 7–20 chars, unique per store",
    "email": "string | null — optional, max 255 chars, unique per store when set",
    "address": "string | null — optional, max 500 chars"
  }
  ```
- **Response** (201): `StaffRead` shape above
- **Response** (error):
  - `422` missing required field or validation failure
  - `409` phone or email already used by another staff member in this store
  - `403` insufficient role

---

### PATCH /api/v1/hr/staff/{user_id}
- **Purpose**: Update a staff member's details (all fields optional)
- **Auth**: MANAGER or OWNER
- **Request**:
  ```json
  {
    "name": "string | null",
    "role": "OWNER | MANAGER | BARISTA | BAKER | null",
    "position": "JUNIOR | SENIOR | HEAD_OF_STAFF | null",
    "pin": "string | null — 4–8 digits",
    "phone": "string | null — 7–20 chars",
    "email": "string | null",
    "address": "string | null"
  }
  ```
- **Notes**:
  - For `email` and `address`: omitting the field leaves it unchanged; sending `null` explicitly **clears** the value.
  - For all other fields: `null` means "omit" (leave unchanged).
  - `409` if new phone/email conflicts with an existing staff member.
- **Response** (200): `StaffRead` shape above
- **Response** (error): `404`, `409`, `403`, `422`

---

### DELETE /api/v1/hr/staff/{user_id}
- **Purpose**: Resign (soft-deactivate) a staff member
- **Auth**: MANAGER or OWNER
- **Response**: `204 No Content`
- **Response** (error): `404`, `403`
- **Notes**: Soft delete — `is_active` set to `false`. Staff member excluded from all future list responses. Historical records (orders, shifts) are preserved.

---

## Enums & Constants

### Role (controls system access)
| Value | Meaning |
|-------|---------|
| `OWNER` | Full access |
| `MANAGER` | Store management |
| `BARISTA` | Operational |
| `BAKER` | Operational |

### StaffPosition (display/HR only — no effect on system access)
| Value | Display Label |
|-------|--------------|
| `JUNIOR` | Junior |
| `SENIOR` | Senior |
| `HEAD_OF_STAFF` | Head of Staff |

---

## Validation Rules

### Product Update
| Field | Rule |
|-------|------|
| `name` | 1–120 characters |
| `description` | max 500 characters |
| `price` | ≥ 0, ≤ 999999.99, 2 decimal places |
| `category_id` | must be a valid CUID belonging to the same store, or `null` |

### Staff Create / Update
| Field | Rule |
|-------|------|
| `name` | 1–120 characters, required |
| `phone` | 7–20 characters, required, unique per store |
| `email` | max 255 characters, optional, unique per store when set |
| `address` | max 500 characters, optional |
| `pin` | 4–8 characters |
| `position` | must be a valid `StaffPosition` value |

---

## Business Logic & Edge Cases
- Product `store_id` comes from the JWT — you cannot update products belonging to another store even if you know the ID.
- A manager cannot assign a role higher than their own (enforced at the service layer — surface a generic permission error if a 403 is returned on staff create/update).
- Deactivated staff cannot log in but their historical records (orders, shifts, etc.) are preserved.
- Sending an empty PATCH body `{}` to either endpoint is valid and returns the unchanged resource.
- Phone uniqueness is enforced per store — same phone number can exist in different stores.
- NULL phones don't conflict with the unique constraint (Postgres NULLs are distinct).

## Integration Notes
- **Product edit flow**: Fetch product details (`GET /products/{id}`) → pre-fill form → send only changed fields via PATCH.
- **Staff management flow**: List staff (`GET /hr/staff`) → show edit/deactivate actions per row → PATCH or DELETE as needed.
- **Staff profile view**: Use `GET /hr/staff/{user_id}` to show a single staff member's contact details.
- **Optimistic UI**: Safe for staff name/role/position updates. Avoid for PIN changes (no confirmation possible client-side).

## Test Scenarios

### Product Update
1. **Happy path — price change**: PATCH `{ "price": "35.00" }` → 200 with updated price
2. **Happy path — reassign category**: PATCH `{ "category_id": "valid_cuid" }` → 200
3. **Clear category**: PATCH `{ "category_id": null }` → 200 with `category_id: null`
4. **Invalid price**: PATCH `{ "price": "-1" }` → 422
5. **Wrong store**: product_id from another store → 404
6. **Insufficient role**: barista attempts PATCH → 403

### Staff CRUD
1. **Create staff** — POST with all fields → 201 with full profile
2. **Missing phone** — POST without phone → 422
3. **Duplicate phone** — POST with phone already used in same store → 409
4. **Duplicate email** — POST with email already used in same store → 409
5. **Get profile** — GET by ID → 200 with phone, email, position
6. **Not found** — GET unknown ID → 404
7. **Update position** — PATCH `{ "position": "SENIOR" }` → 200
8. **Clear email** — PATCH `{ "email": null }` → 200 with `email: null`
9. **Omit email** — PATCH `{ "name": "New Name" }` → 200, email unchanged
10. **Resign** — DELETE → 204, excluded from future list responses
11. **Barista create/update/delete** → 403
