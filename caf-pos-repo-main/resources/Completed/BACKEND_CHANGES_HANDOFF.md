# Backend Changes Handoff

**Project:** Cafe POS  
**Date:** 2026-05-01  
**Changed by:** Claude Code (on behalf of the frontend team)  
**Deployment target:** Railway (existing FastAPI + PostgreSQL service)

---

## Summary

One new API endpoint was added to the backend: **`POST /api/v1/inventory`**, which allows the frontend to create brand-new inventory items (ingredients) from the UI.

Previously, inventory items could only be created by directly editing the database or running the seed script. The existing `POST /api/v1/inventory/receive` endpoint only adds stock quantity to items that already exist — it cannot create new ones. This change fills that gap.

**No database migration is required.** The new endpoint writes to the existing `inventory_items` table, which already has all the necessary columns.

---

## Files Changed

### 1. `api/app/schemas/inventory.py`

**What changed:** Added a new Pydantic request schema called `InventoryItemCreate`.

**Where:** Inserted between `InventoryItemRead` and `InventoryItemUpdate` (around line 42).

```python
class InventoryItemCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    unit: str = Field(min_length=1, max_length=24)
    par_level: Decimal = Field(default=Decimal("0"), ge=0, le=Decimal("9999999.999"))
    cost_per_unit: Decimal = Field(default=Decimal("0"), ge=0, le=Decimal("99999.9999"))
    is_active: bool = True
```

**Why:** FastAPI requires a Pydantic model to validate and document the request body for the new endpoint.

---

### 2. `api/app/services/inventory.py`

**What changed:** Added `InventoryItemCreate` to the import block, and added a new `create_item()` async service function before the existing `list_items()` function.

**New import line added:**
```python
InventoryItemCreate,   # added to the existing import block from app.schemas.inventory
```

**New function added (lines 31–55):**
```python
async def create_item(
    db: AsyncSession,
    *,
    store_id: str,
    payload: InventoryItemCreate,
) -> InventoryItem:
    async with db.begin():
        existing = await db.execute(
            select(InventoryItem).where(
                InventoryItem.store_id == store_id,
                InventoryItem.name == payload.name,
            )
        )
        if existing.scalar_one_or_none():
            raise Conflict("An inventory item with this name already exists")
        item = InventoryItem(
            store_id=store_id,
            name=payload.name,
            unit=payload.unit,
            par_level=payload.par_level,
            cost_per_unit=payload.cost_per_unit,
            is_active=payload.is_active,
        )
        db.add(item)
    return item
```

**Why:** Keeps business logic in the service layer (consistent with the rest of the codebase). The function checks for a duplicate name within the same store and raises a `Conflict` error (HTTP 409) if one is found — matching the same pattern used for customers.

---

### 3. `api/app/api/v1/inventory.py`

**What changed:** Added `InventoryItemCreate` to the import block, and added a new `POST ""` route handler before the existing `GET ""` (list) handler.

**New import line added:**
```python
InventoryItemCreate,   # added to the existing import block from app.schemas.inventory
```

**New route added (lines 22–36):**
```python
@router.post(
    "",
    response_model=InventoryItemRead,
    status_code=201,
    summary="Create a new inventory item",
    operation_id="inventory_create",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def create_item(
    payload: InventoryItemCreate,
    user: StoreUser,
    db: DbSession,
) -> InventoryItemRead:
    item = await inv.create_item(db, store_id=user.store_id, payload=payload)
    return InventoryItemRead.model_validate(item)
```

**Why:** This is the actual HTTP endpoint. It is restricted to `OWNER` and `MANAGER` roles (via `_MANAGER_PLUS`) — Baristas and Bakers cannot create new ingredients.

---

## New Endpoint Reference

### `POST /api/v1/inventory`

Requires `Authorization: Bearer <access_token>`.  
Roles allowed: **OWNER, MANAGER**.

**Request body**
```json
{
  "name": "Oat Milk",
  "unit": "ml",
  "par_level": "3000.000",
  "cost_per_unit": "0.0500",
  "is_active": true
}
```

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `name` | string | Yes | 1–120 chars, unique per store |
| `unit` | string | Yes | 1–24 chars (e.g. `ml`, `g`, `ea`, `kg`) |
| `par_level` | decimal string | No | Default `0`, range 0–9,999,999.999 |
| `cost_per_unit` | decimal string | No | Default `0`, range 0–99,999.9999 |
| `is_active` | boolean | No | Default `true` |

**Response 201** — `InventoryItemRead`
```json
{
  "id": "abc123def456ghi789jkl012",
  "name": "Oat Milk",
  "unit": "ml",
  "cost_per_unit": "0.0500",
  "stock_on_hand": "0.000",
  "par_level": "3000.000",
  "is_active": true,
  "status": "critical"
}
```

> Note: `stock_on_hand` starts at `0.000`. Use the existing `POST /api/v1/inventory/receive` endpoint to add initial stock after creation.

**Error responses**

| HTTP | Condition |
|------|-----------|
| 401 | Missing or invalid bearer token |
| 403 | Authenticated user is BARISTA or BAKER |
| 409 | An item with the same `name` already exists in this store |
| 422 | Validation failure (e.g. `name` is empty, `unit` exceeds 24 chars) |

---

## Deployment Steps

No special steps are needed beyond the normal deploy process.

1. Pull the latest code into the Railway service (or push the updated branch).
2. Railway will redeploy automatically. The new route will appear in `/docs` once the service restarts.
3. **No `alembic upgrade head` is needed** — the `inventory_items` table already exists with all required columns.

---

## Quick Smoke Test

After deploying, verify the endpoint works using the `/docs` interactive UI or curl:

```bash
# 1. Get a token (use the Owner PIN)
TOKEN=$(curl -s -X POST https://<your-railway-domain>/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"store_slug":"sukhumvit-49","pin":"1234"}' | jq -r .access_token)

# 2. Create a new ingredient
curl -s -X POST https://<your-railway-domain>/api/v1/inventory \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Ingredient","unit":"g"}' | jq .

# Expected: HTTP 201 with an id, stock_on_hand: "0.000"

# 3. Try creating the same name again
# Expected: HTTP 409 {"error": {"code": "CONFLICT", "message": "An inventory item with this name already exists"}}
```
