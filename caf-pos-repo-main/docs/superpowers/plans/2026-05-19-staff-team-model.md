# Staff Team Model Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the `User` model with contact fields and a job position, add a `GET /hr/staff/{user_id}` endpoint, and wire 409 conflict handling for phone/email uniqueness across all staff write routes.

**Architecture:** All new fields (`phone`, `email`, `address`, `position`) land directly on the `users` table. `phone` is nullable at the DB level (NULLs don't conflict with the unique constraint) but required by the `StaffCreate` schema. `StaffUpdate` uses Pydantic `model_fields_set` to distinguish "omit field" from "explicitly set to null" for `email` and `address`.

**Tech Stack:** FastAPI, SQLAlchemy 2.x async, Alembic, Pydantic v2, PostgreSQL, pytest-asyncio

---

## File Map

| Action | File |
|---|---|
| Modify | `api/app/enums.py` |
| Modify | `api/app/models/identity.py` |
| Modify | `api/tests/conftest.py` |
| Create | `api/alembic/versions/0015_staff_contact_fields.py` |
| Modify | `api/app/schemas/hr.py` |
| Modify | `api/app/services/hr.py` |
| Modify | `api/app/api/v1/hr.py` |
| Create | `api/tests/test_hr_api.py` |
| Modify | `.claude/docs/ai/recent-enhancements/product-update-staff-crud-handoff.md` |

---

## Task 1: Add `StaffPosition` enum

**Files:**
- Modify: `api/app/enums.py`

- [ ] **Step 1: Add enum at the end of `api/app/enums.py`**

```python
class StaffPosition(str, enum.Enum):
    JUNIOR = "JUNIOR"
    SENIOR = "SENIOR"
    HEAD_OF_STAFF = "HEAD_OF_STAFF"
```

- [ ] **Step 2: Verify import works**

```bash
cd api && uv run python -c "from app.enums import StaffPosition; print(list(StaffPosition))"
```

Expected output:
```
[<StaffPosition.JUNIOR: 'JUNIOR'>, <StaffPosition.SENIOR: 'SENIOR'>, <StaffPosition.HEAD_OF_STAFF: 'HEAD_OF_STAFF'>]
```

---

## Task 2: Expand `User` model + update `conftest.py`

**Files:**
- Modify: `api/app/models/identity.py`
- Modify: `api/tests/conftest.py`

- [ ] **Step 1: Update imports in `api/app/models/identity.py`**

Replace:
```python
from app.enums import Role
```
With:
```python
from app.enums import Role, StaffPosition
```

- [ ] **Step 2: Add four new columns to the `User` class after `role`**

Replace:
```python
    role: Mapped[Role] = mapped_column(SAEnum(Role, name="role"), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
```
With:
```python
    role: Mapped[Role] = mapped_column(SAEnum(Role, name="role"), nullable=False)
    position: Mapped[StaffPosition] = mapped_column(
        SAEnum(StaffPosition, name="staff_position"), nullable=False, default=StaffPosition.JUNIOR
    )
    phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    address: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
```

- [ ] **Step 3: Update `make_user` in `api/tests/conftest.py`**

Add `StaffPosition` to the import at the top of conftest:
```python
from app.enums import Role, StaffPosition
```

Replace the `make_user` function:
```python
async def make_user(
    db: AsyncSession,
    *,
    tenant_id: str,
    store_id: str | None,
    name: str = "User",
    pin: str = "1234",
    role: Role = Role.BARISTA,
    position: StaffPosition = StaffPosition.JUNIOR,
    phone: str | None = None,
    email: str | None = None,
    address: str | None = None,
    is_active: bool = True,
) -> User:
    u = User(
        tenant_id=tenant_id,
        store_id=store_id,
        name=name,
        pin_hash=hash_pin(pin),
        role=role,
        position=position,
        phone=phone,
        email=email,
        address=address,
        is_active=is_active,
    )
    db.add(u)
    await db.commit()
    return u
```

- [ ] **Step 4: Update `user_a` and `manager_a` fixtures to pass distinct phones**

Replace:
```python
@pytest_asyncio.fixture(loop_scope="session")
async def user_a(db, tenant, store_a) -> User:
    return await make_user(
        db, tenant_id=tenant.id, store_id=store_a.id, name="Alice", pin="1111", role=Role.BARISTA
    )


@pytest_asyncio.fixture(loop_scope="session")
async def manager_a(db, tenant, store_a) -> User:
    return await make_user(
        db, tenant_id=tenant.id, store_id=store_a.id, name="Mary", pin="2222", role=Role.MANAGER
    )
```
With:
```python
@pytest_asyncio.fixture(loop_scope="session")
async def user_a(db, tenant, store_a) -> User:
    return await make_user(
        db, tenant_id=tenant.id, store_id=store_a.id,
        name="Alice", pin="1111", role=Role.BARISTA, phone="0811111111"
    )


@pytest_asyncio.fixture(loop_scope="session")
async def manager_a(db, tenant, store_a) -> User:
    return await make_user(
        db, tenant_id=tenant.id, store_id=store_a.id,
        name="Mary", pin="2222", role=Role.MANAGER, phone="0822222222"
    )
```

---

## Task 3: Write and run Alembic migration

**Files:**
- Create: `api/alembic/versions/0015_staff_contact_fields.py`

- [ ] **Step 1: Create `api/alembic/versions/0015_staff_contact_fields.py`**

```python
"""staff contact fields: phone, email, address, position

Revision ID: 0015
Revises: 0014
Create Date: 2026-05-19
"""
import sqlalchemy as sa
from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "CREATE TYPE staff_position AS ENUM ('JUNIOR', 'SENIOR', 'HEAD_OF_STAFF')"
    )

    op.add_column(
        "users",
        sa.Column(
            "position",
            sa.Enum("JUNIOR", "SENIOR", "HEAD_OF_STAFF", name="staff_position", create_type=False),
            nullable=True,
        ),
    )
    op.add_column("users", sa.Column("phone", sa.String(20), nullable=True))
    op.add_column("users", sa.Column("email", sa.String(255), nullable=True))
    op.add_column("users", sa.Column("address", sa.String(500), nullable=True))

    # Backfill position for existing rows
    op.execute("UPDATE users SET position = 'JUNIOR' WHERE position IS NULL")
    op.alter_column("users", "position", nullable=False)

    op.create_unique_constraint("uq_staff_store_phone", "users", ["store_id", "phone"])
    op.create_unique_constraint("uq_staff_store_email", "users", ["store_id", "email"])


def downgrade() -> None:
    op.drop_constraint("uq_staff_store_email", "users", type_="unique")
    op.drop_constraint("uq_staff_store_phone", "users", type_="unique")
    op.drop_column("users", "address")
    op.drop_column("users", "email")
    op.drop_column("users", "phone")
    op.drop_column("users", "position")
    op.execute("DROP TYPE IF EXISTS staff_position")
```

- [ ] **Step 2: Apply the migration**

```bash
cd api && uv run alembic upgrade head
```

Expected: migration applies with no errors. Confirm with:
```bash
uv run alembic current
```
Expected output: `0015 (head)`

---

## Task 4: Update schemas

**Files:**
- Modify: `api/app/schemas/hr.py`

- [ ] **Step 1: Add `StaffPosition` to the import in `api/app/schemas/hr.py`**

Replace:
```python
from app.enums import LeaveStatus, LeaveType, Role, TaskStatus
```
With:
```python
from app.enums import LeaveStatus, LeaveType, Role, StaffPosition, TaskStatus
```

- [ ] **Step 2: Replace `StaffRead`, `StaffCreate`, `StaffUpdate`**

Replace:
```python
class StaffRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    role: Role
    is_active: bool


class StaffCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    role: Role
    pin: str = Field(min_length=4, max_length=8)


class StaffUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=120)
    role: Role | None = None
    pin: str | None = Field(None, min_length=4, max_length=8)
```
With:
```python
class StaffRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    role: Role
    position: StaffPosition
    phone: str | None
    email: str | None
    address: str | None
    is_active: bool


class StaffCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    role: Role
    position: StaffPosition
    pin: str = Field(min_length=4, max_length=8)
    phone: str = Field(min_length=7, max_length=20)
    email: str | None = Field(None, max_length=255)
    address: str | None = Field(None, max_length=500)


class StaffUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=120)
    role: Role | None = None
    position: StaffPosition | None = None
    pin: str | None = Field(None, min_length=4, max_length=8)
    phone: str | None = Field(None, min_length=7, max_length=20)
    # email and address use model_fields_set — null means "clear", omit means "leave unchanged"
    email: str | None = None
    address: str | None = None
```

---

## Task 5: Write failing tests

**Files:**
- Create: `api/tests/test_hr_api.py`

- [ ] **Step 1: Create `api/tests/test_hr_api.py`**

```python
import pytest

from tests.conftest import make_user
from app.enums import Role, StaffPosition


async def _login(client, store_slug: str, pin: str) -> str:
    resp = await client.post("/api/v1/auth/login", json={"store_slug": store_slug, "pin": pin})
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


_NEW_STAFF = {
    "name": "Bob Tester",
    "role": "BARISTA",
    "position": "JUNIOR",
    "pin": "9999",
    "phone": "0899999999",
    "email": "bob@cafe.com",
    "address": "123 Test Road",
}


# ---------------------------------------------------------------------------
# List staff
# ---------------------------------------------------------------------------

async def test_list_staff_includes_active_members(client, db, store_a, manager_a):
    token = await _login(client, store_a.slug, "2222")
    resp = await client.get("/api/v1/hr/staff", headers=_headers(token))
    assert resp.status_code == 200
    ids = [s["id"] for s in resp.json()]
    assert manager_a.id in ids


# ---------------------------------------------------------------------------
# Create staff
# ---------------------------------------------------------------------------

async def test_create_staff_returns_201_with_all_fields(client, db, store_a, manager_a):
    token = await _login(client, store_a.slug, "2222")
    resp = await client.post("/api/v1/hr/staff", headers=_headers(token), json=_NEW_STAFF)
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["name"] == "Bob Tester"
    assert data["position"] == "JUNIOR"
    assert data["phone"] == "0899999999"
    assert data["email"] == "bob@cafe.com"
    assert data["address"] == "123 Test Road"
    assert data["is_active"] is True
    assert "pin" not in data
    assert "pin_hash" not in data


async def test_create_staff_barista_returns_403(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    resp = await client.post("/api/v1/hr/staff", headers=_headers(token), json=_NEW_STAFF)
    assert resp.status_code == 403


async def test_create_staff_missing_phone_returns_422(client, db, store_a, manager_a):
    token = await _login(client, store_a.slug, "2222")
    payload = {k: v for k, v in _NEW_STAFF.items() if k != "phone"}
    resp = await client.post("/api/v1/hr/staff", headers=_headers(token), json=payload)
    assert resp.status_code == 422


async def test_create_staff_missing_position_returns_422(client, db, store_a, manager_a):
    token = await _login(client, store_a.slug, "2222")
    payload = {k: v for k, v in _NEW_STAFF.items() if k != "position"}
    resp = await client.post("/api/v1/hr/staff", headers=_headers(token), json=payload)
    assert resp.status_code == 422


async def test_create_staff_duplicate_phone_returns_409(client, db, store_a, manager_a):
    token = await _login(client, store_a.slug, "2222")
    await client.post("/api/v1/hr/staff", headers=_headers(token), json=_NEW_STAFF)
    dupe = {**_NEW_STAFF, "name": "Charlie", "email": "charlie@cafe.com", "pin": "8888"}
    resp = await client.post("/api/v1/hr/staff", headers=_headers(token), json=dupe)
    assert resp.status_code == 409


async def test_create_staff_duplicate_email_returns_409(client, db, store_a, manager_a):
    token = await _login(client, store_a.slug, "2222")
    payload_1 = {**_NEW_STAFF, "phone": "0877770001"}
    await client.post("/api/v1/hr/staff", headers=_headers(token), json=payload_1)
    payload_2 = {**_NEW_STAFF, "phone": "0877770002", "name": "Dana", "pin": "7777"}
    resp = await client.post("/api/v1/hr/staff", headers=_headers(token), json=payload_2)
    assert resp.status_code == 409


# ---------------------------------------------------------------------------
# Get single staff
# ---------------------------------------------------------------------------

async def test_get_staff_by_id_returns_full_profile(client, db, store_a, manager_a):
    token = await _login(client, store_a.slug, "2222")
    resp = await client.get(f"/api/v1/hr/staff/{manager_a.id}", headers=_headers(token))
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == manager_a.id
    assert data["phone"] == "0822222222"
    assert "position" in data


async def test_get_staff_barista_can_read(client, db, store_a, user_a, manager_a):
    token = await _login(client, store_a.slug, "1111")
    resp = await client.get(f"/api/v1/hr/staff/{manager_a.id}", headers=_headers(token))
    assert resp.status_code == 200


async def test_get_staff_not_found_returns_404(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    resp = await client.get("/api/v1/hr/staff/nonexistent000000000000", headers=_headers(token))
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Update staff
# ---------------------------------------------------------------------------

async def test_update_staff_name(client, db, store_a, manager_a, tenant):
    member = await make_user(
        db, tenant_id=tenant.id, store_id=store_a.id,
        name="Eve", pin="5555", phone="0855550001", role=Role.BARISTA,
    )
    token = await _login(client, store_a.slug, "2222")
    resp = await client.patch(
        f"/api/v1/hr/staff/{member.id}",
        headers=_headers(token),
        json={"name": "Eve Updated"},
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "Eve Updated"


async def test_update_staff_position(client, db, store_a, manager_a, tenant):
    member = await make_user(
        db, tenant_id=tenant.id, store_id=store_a.id,
        name="Frank", pin="4444", phone="0844440001",
        position=StaffPosition.JUNIOR, role=Role.BARISTA,
    )
    token = await _login(client, store_a.slug, "2222")
    resp = await client.patch(
        f"/api/v1/hr/staff/{member.id}",
        headers=_headers(token),
        json={"position": "SENIOR"},
    )
    assert resp.status_code == 200
    assert resp.json()["position"] == "SENIOR"


async def test_update_staff_clear_email(client, db, store_a, manager_a, tenant):
    member = await make_user(
        db, tenant_id=tenant.id, store_id=store_a.id,
        name="Grace", pin="3333", phone="0833330001",
        email="grace@cafe.com", role=Role.BARISTA,
    )
    token = await _login(client, store_a.slug, "2222")
    resp = await client.patch(
        f"/api/v1/hr/staff/{member.id}",
        headers=_headers(token),
        json={"email": None},
    )
    assert resp.status_code == 200
    assert resp.json()["email"] is None


async def test_update_staff_barista_returns_403(client, db, store_a, user_a, manager_a):
    token = await _login(client, store_a.slug, "1111")
    resp = await client.patch(
        f"/api/v1/hr/staff/{manager_a.id}",
        headers=_headers(token),
        json={"name": "Hacked"},
    )
    assert resp.status_code == 403


async def test_update_staff_duplicate_phone_returns_409(client, db, store_a, manager_a, tenant):
    member = await make_user(
        db, tenant_id=tenant.id, store_id=store_a.id,
        name="Hank", pin="2221", phone="0811110001", role=Role.BARISTA,
    )
    token = await _login(client, store_a.slug, "2222")
    # Try to update Hank's phone to manager_a's phone
    resp = await client.patch(
        f"/api/v1/hr/staff/{member.id}",
        headers=_headers(token),
        json={"phone": "0822222222"},
    )
    assert resp.status_code == 409


# ---------------------------------------------------------------------------
# Delete (resign) staff
# ---------------------------------------------------------------------------

async def test_delete_staff_soft_deactivates(client, db, store_a, manager_a, tenant):
    member = await make_user(
        db, tenant_id=tenant.id, store_id=store_a.id,
        name="Ida", pin="1112", phone="0811120001", role=Role.BARISTA,
    )
    token = await _login(client, store_a.slug, "2222")
    resp = await client.delete(f"/api/v1/hr/staff/{member.id}", headers=_headers(token))
    assert resp.status_code == 204

    list_resp = await client.get("/api/v1/hr/staff", headers=_headers(token))
    ids = [s["id"] for s in list_resp.json()]
    assert member.id not in ids


async def test_delete_staff_barista_returns_403(client, db, store_a, user_a, manager_a):
    token = await _login(client, store_a.slug, "1111")
    resp = await client.delete(f"/api/v1/hr/staff/{manager_a.id}", headers=_headers(token))
    assert resp.status_code == 403
```

- [ ] **Step 2: Run tests to confirm they fail as expected**

```bash
cd api && uv run pytest tests/test_hr_api.py -v 2>&1 | head -60
```

Expected: most tests fail with `404` or `422` (routes/fields not yet implemented). Tests for 403 and list may partially pass. Confirm no import errors.

---

## Task 6: Add `get_staff` to service + `GET /hr/staff/{user_id}` route

**Files:**
- Modify: `api/app/services/hr.py`
- Modify: `api/app/api/v1/hr.py`

- [ ] **Step 1: Add `get_staff` to `api/app/services/hr.py`**

Add after `list_staff`:
```python
async def get_staff(db: AsyncSession, *, store_id: str, user_id: str) -> User:
    return await _load_user(db, store_id=store_id, user_id=user_id)
```

- [ ] **Step 2: Add `GET /hr/staff/{user_id}` to `api/app/api/v1/hr.py`**

Add after `list_staff` route (before `create_staff`):
```python
@router.get(
    "/staff/{user_id}",
    response_model=StaffRead,
    summary="Get a single staff member's full profile",
    operation_id="hr_staff_get",
)
async def get_staff(user_id: str, user: StoreUser, db: DbSession) -> StaffRead:
    staff = await hr_svc.get_staff(db, store_id=user.store_id, user_id=user_id)
    return StaffRead.model_validate(staff)
```

- [ ] **Step 3: Run GET-related tests**

```bash
cd api && uv run pytest tests/test_hr_api.py -k "get_staff" -v
```

Expected: all three `test_get_staff_*` tests pass.

---

## Task 7: Update `create_staff` + 409 handling

**Files:**
- Modify: `api/app/services/hr.py`
- Modify: `api/app/api/v1/hr.py`

- [ ] **Step 1: Update `create_staff` in `api/app/services/hr.py`**

Replace:
```python
async def create_staff(
    db: AsyncSession,
    *,
    store_id: str,
    tenant_id: str,
    payload: StaffCreate,
) -> User:
    async with db.begin():
        user = User(
            tenant_id=tenant_id,
            store_id=store_id,
            name=payload.name,
            role=payload.role,
            pin_hash=hash_pin(payload.pin),
        )
        db.add(user)
    return user
```
With:
```python
async def create_staff(
    db: AsyncSession,
    *,
    store_id: str,
    tenant_id: str,
    payload: StaffCreate,
) -> User:
    async with db.begin():
        user = User(
            tenant_id=tenant_id,
            store_id=store_id,
            name=payload.name,
            role=payload.role,
            position=payload.position,
            pin_hash=hash_pin(payload.pin),
            phone=payload.phone,
            email=payload.email,
            address=payload.address,
        )
        db.add(user)
    return user
```

- [ ] **Step 2: Add `IntegrityError` import and 409 handling to `POST /hr/staff` in `api/app/api/v1/hr.py`**

Add to imports at the top of `api/app/api/v1/hr.py`:
```python
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.exc import IntegrityError
```

Replace the `create_staff` route handler:
```python
@router.post(
    "/staff",
    response_model=StaffRead,
    status_code=201,
    summary="Create a new staff member",
    operation_id="hr_staff_create",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def create_staff(payload: StaffCreate, user: StoreUser, db: DbSession) -> StaffRead:
    try:
        staff = await hr_svc.create_staff(
            db, store_id=user.store_id, tenant_id=user.tenant_id, payload=payload
        )
    except IntegrityError as e:
        orig = str(getattr(e, "orig", e))
        if "uq_staff_store_phone" in orig:
            raise HTTPException(409, detail="A staff member with this phone number already exists.")
        if "uq_staff_store_email" in orig:
            raise HTTPException(409, detail="A staff member with this email already exists.")
        raise
    return StaffRead.model_validate(staff)
```

- [ ] **Step 3: Run create-related tests**

```bash
cd api && uv run pytest tests/test_hr_api.py -k "create_staff" -v
```

Expected: all six `test_create_staff_*` tests pass.

---

## Task 8: Update `update_staff` + 409 handling

**Files:**
- Modify: `api/app/services/hr.py`
- Modify: `api/app/api/v1/hr.py`

- [ ] **Step 1: Update `update_staff` in `api/app/services/hr.py`**

Replace:
```python
async def update_staff(
    db: AsyncSession,
    *,
    store_id: str,
    user_id: str,
    payload: StaffUpdate,
) -> User:
    async with db.begin():
        user = await _load_user(db, store_id=store_id, user_id=user_id)
        if payload.name is not None:
            user.name = payload.name
        if payload.role is not None:
            user.role = payload.role
        if payload.pin is not None:
            user.pin_hash = hash_pin(payload.pin)
    return user
```
With:
```python
async def update_staff(
    db: AsyncSession,
    *,
    store_id: str,
    user_id: str,
    payload: StaffUpdate,
) -> User:
    async with db.begin():
        user = await _load_user(db, store_id=store_id, user_id=user_id)
        if payload.name is not None:
            user.name = payload.name
        if payload.role is not None:
            user.role = payload.role
        if payload.position is not None:
            user.position = payload.position
        if payload.pin is not None:
            user.pin_hash = hash_pin(payload.pin)
        if payload.phone is not None:
            user.phone = payload.phone
        if "email" in payload.model_fields_set:
            user.email = payload.email
        if "address" in payload.model_fields_set:
            user.address = payload.address
    return user
```

- [ ] **Step 2: Add 409 handling to `PATCH /hr/staff/{user_id}` in `api/app/api/v1/hr.py`**

Replace the `update_staff` route handler:
```python
@router.patch(
    "/staff/{user_id}",
    response_model=StaffRead,
    summary="Update a staff member's name, role, position, PIN, or contact details",
    operation_id="hr_staff_update",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def update_staff(
    user_id: str, payload: StaffUpdate, user: StoreUser, db: DbSession
) -> StaffRead:
    try:
        staff = await hr_svc.update_staff(
            db, store_id=user.store_id, user_id=user_id, payload=payload
        )
    except IntegrityError as e:
        orig = str(getattr(e, "orig", e))
        if "uq_staff_store_phone" in orig:
            raise HTTPException(409, detail="A staff member with this phone number already exists.")
        if "uq_staff_store_email" in orig:
            raise HTTPException(409, detail="A staff member with this email already exists.")
        raise
    return StaffRead.model_validate(staff)
```

- [ ] **Step 3: Run update and delete tests**

```bash
cd api && uv run pytest tests/test_hr_api.py -k "update_staff or delete_staff" -v
```

Expected: all update and delete tests pass.

---

## Task 9: Run full test suite

- [ ] **Step 1: Run all tests**

```bash
cd api && uv run pytest -v 2>&1 | tail -30
```

Expected: all tests pass. If any fail, fix the issue before continuing.

---

## Task 10: Update handoff doc

**Files:**
- Modify: `.claude/docs/ai/recent-enhancements/product-update-staff-crud-handoff.md`

- [ ] **Step 1: Replace the Staff CRUD section of the handoff doc**

In `.claude/docs/ai/recent-enhancements/product-update-staff-crud-handoff.md`, update the staff endpoints section to reflect the new fields. Replace the entire Staff CRUD section (everything from `### GET /api/v1/hr/staff` to the end of the staff endpoints) with:

```markdown
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

## Enums

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

## Validation Rules (mirror in UI)

| Field | Rule |
|-------|------|
| `name` | 1–120 characters, required |
| `phone` | 7–20 characters, required, unique per store |
| `email` | max 255 characters, optional, unique per store when set |
| `address` | max 500 characters, optional |
| `pin` | 4–8 characters |
| `position` | must be a valid `StaffPosition` value |

---

## Test Scenarios

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
```

---

## Task 11: Commit

- [ ] **Step 1: Stage all changed files**

```bash
git add api/app/enums.py \
        api/app/models/identity.py \
        api/tests/conftest.py \
        api/alembic/versions/0015_staff_contact_fields.py \
        api/app/schemas/hr.py \
        api/app/services/hr.py \
        api/app/api/v1/hr.py \
        api/tests/test_hr_api.py \
        .claude/docs/ai/recent-enhancements/product-update-staff-crud-handoff.md
```

- [ ] **Step 2: Commit**

```bash
git commit -m "feat: expand staff model with contact fields, position, and team CRUD routes"
```
