# Design Spec: Staff Model Expansion + Team CRUD Routes

**Date:** 2026-05-19
**Status:** Approved

---

## Overview

Expand the `User` model to carry full staff contact details and a job position, then surface a complete Team management API for the frontend "Team" page. The page lets OWNER/MANAGER users list staff, view individual profiles, onboard new members, edit details, and resign (soft-deactivate) staff.

---

## New Fields on `User`

| Column | Type | Nullable | Constraints |
|---|---|---|---|
| `phone` | `String(20)` | No | Unique per store |
| `email` | `String(255)` | Yes | Unique per store (when set) |
| `address` | `String(500)` | Yes | — |
| `position` | `SAEnum(StaffPosition)` | No | Default: `JUNIOR` |

**Note:** `position` is a display/HR concept only — it has no effect on system access, which is still controlled exclusively by `role`.

---

## New Enum: `StaffPosition`

Added to `app/enums.py`:

```python
class StaffPosition(str, Enum):
    JUNIOR = "JUNIOR"
    SENIOR = "SENIOR"
    HEAD_OF_STAFF = "HEAD_OF_STAFF"
```

---

## Schema Changes (`schemas/hr.py`)

### `StaffRead` — add new fields
```python
class StaffRead(BaseModel):
    id: str
    name: str
    role: Role
    position: StaffPosition
    phone: str
    email: str | None
    address: str | None
    is_active: bool
```

### `StaffCreate` — add new required/optional fields
```python
class StaffCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    role: Role
    position: StaffPosition
    pin: str = Field(min_length=4, max_length=8)
    phone: str = Field(min_length=7, max_length=20)
    email: str | None = Field(None, max_length=255)
    address: str | None = Field(None, max_length=500)
```

### `StaffUpdate` — all fields optional

Uses Pydantic `model_fields_set` to distinguish "field omitted" from "field explicitly set to null":

```python
from pydantic import BaseModel, Field
from typing import Annotated

class StaffUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=120)
    role: Role | None = None
    position: StaffPosition | None = None
    pin: str | None = Field(None, min_length=4, max_length=8)
    phone: str | None = Field(None, min_length=7, max_length=20)
    email: str | None = Field(None, max_length=255)
    address: str | None = Field(None, max_length=500)
```

**PATCH semantics for nullable fields (`email`, `address`):**
- Field **omitted** → leave unchanged
- Field **set to a string** → update to that value
- Field **set to `null`** → clear the value (set to `NULL` in DB)

The service uses `payload.model_fields_set` to detect which fields were explicitly included in the request body, then applies only those. Non-nullable fields (`name`, `role`, `position`, `pin`, `phone`) follow the existing pattern — `None` means "omit."

---

## Service Changes (`services/hr.py`)

- `create_staff`: set `phone`, `email`, `address`, `position` from payload
- `update_staff`: apply each new field if provided in payload
- `get_staff`: new function — fetch single staff by `user_id` + `store_id`, raise 404 if not found

---

## API Changes (`api/v1/hr.py`)

### New endpoint
```
GET /api/v1/hr/staff/{user_id}
```
- Returns `StaffRead` for a single staff member
- Auth: any authenticated store user
- 404 if not found or belongs to another store

### Existing endpoints — updated response shape
All existing staff endpoints (`POST`, `PATCH`, `DELETE`) now return/accept the expanded schema.

---

## Migration

New Alembic migration adds four columns to `users`:
- `phone VARCHAR(20) NOT NULL` — unique constraint scoped to store via `UniqueConstraint('store_id', 'phone')`
- `email VARCHAR(255) NULL` — unique constraint: `UniqueConstraint('store_id', 'email')` with `nulls_not_distinct=False` (nulls allowed, non-null values unique per store)
- `address VARCHAR(500) NULL`
- `position staff_position NOT NULL DEFAULT 'JUNIOR'`

**Existing rows:** migration sets `phone = ''` as a placeholder (there are no production staff rows yet — dev/seed data only). A note in the migration reminds the developer to clear placeholder data before going live.

---

## Uniqueness Behaviour

- Two staff at the same store cannot share a phone number.
- Two staff at the same store cannot share an email address (when both are non-null).
- Staff at **different** stores may share phone/email — constraint is scoped to `(store_id, phone)` and `(store_id, email)`.
- On conflict, the service raises a 409 with code `STAFF_PHONE_TAKEN` or `STAFF_EMAIL_TAKEN`.

---

## Out of Scope

- Phone format validation (no E.164 enforcement — frontend handles formatting)
- Email format validation beyond Pydantic's built-in `EmailStr` (not adding; keep it a plain string to avoid dependency)
- Photo/avatar upload
- Emergency contact fields
