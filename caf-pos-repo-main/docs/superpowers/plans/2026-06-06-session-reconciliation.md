# Session Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the cash session close flow with a per-payment-method reconciliation system that saves system totals, tenant-entered actuals, and variance to the database.

**Architecture:** Add a `payment_groups` JSON config to `Store`, a `SessionPaymentEntry` child table for reconciliation rows, and four new/replaced HR endpoints. The close endpoint now requires one entry per configured payment group; it computes system totals from `PAID` orders in the session window, calculates variance, persists the entries, and closes the session in one transaction.

**Tech Stack:** FastAPI, SQLAlchemy 2.x async, PostgreSQL, Pydantic v2, pytest-asyncio, Alembic

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `api/tests/factories.py` | Add `payment_method` param to `make_order_direct` |
| Modify | `api/app/models/tenancy.py` | Add `payment_groups` JSON column to `Store` |
| Modify | `api/app/models/hr.py` | Add `SessionPaymentEntry` model |
| Modify | `api/app/models/__init__.py` | Export `SessionPaymentEntry` |
| Create | `api/alembic/versions/0022_session_reconciliation.py` | Migration for column + table |
| Modify | `api/app/schemas/hr.py` | Add 6 new schemas, remove `CashSessionClose` |
| Modify | `api/app/services/hr.py` | Add 3 service functions, replace `close_cash_session` |
| Modify | `api/app/api/v1/hr.py` | Add 2 routes, replace close route |
| Create | `api/tests/test_session_reconciliation.py` | Service + HTTP tests |

---

## Task 1: Data Layer — Factory, Models, Migration

**Files:**
- Modify: `api/tests/factories.py`
- Modify: `api/app/models/tenancy.py`
- Modify: `api/app/models/hr.py`
- Modify: `api/app/models/__init__.py`
- Create: `api/alembic/versions/0022_session_reconciliation.py`

- [ ] **Step 1: Extend `make_order_direct` to accept `payment_method`**

In `api/tests/factories.py`, add the `payment_method` parameter to the function signature and the `Order(...)` constructor:

```python
# Change the signature from:
async def make_order_direct(
    db: AsyncSession,
    *,
    store_id: str,
    created_by_id: str,
    total: Decimal = Decimal("100.00"),
    subtotal: Decimal | None = None,
    status: OrderStatus = OrderStatus.PAID,
    channel: Channel = Channel.DINE_IN,
    customer_id: str | None = None,
    idempotency_key: str | None = None,
) -> Order:

# To:
async def make_order_direct(
    db: AsyncSession,
    *,
    store_id: str,
    created_by_id: str,
    total: Decimal = Decimal("100.00"),
    subtotal: Decimal | None = None,
    status: OrderStatus = OrderStatus.PAID,
    channel: Channel = Channel.DINE_IN,
    payment_method: "PaymentMethod | None" = None,
    customer_id: str | None = None,
    idempotency_key: str | None = None,
) -> Order:
```

Add `PaymentMethod` to the import at the top of the file:
```python
from app.enums import Channel, OrderStatus, PaymentMethod, ProductType
```

In the `Order(...)` constructor inside `make_order_direct`, add:
```python
    order = Order(
        store_id=store_id,
        created_by_id=created_by_id,
        status=status,
        channel=channel,
        payment_method=payment_method,
        customer_id=customer_id,
        idempotency_key=idempotency_key or secrets.token_hex(8),
        subtotal=subtotal if subtotal is not None else total,
        total=total,
    )
```

- [ ] **Step 2: Add `payment_groups` JSON column to `Store`**

In `api/app/models/tenancy.py`, add `JSON` to the SQLAlchemy imports and the column to `Store`:

```python
from sqlalchemy import Boolean, ForeignKey, JSON, Numeric, String, UniqueConstraint

class Store(Base, TimestampMixin):
    # ... existing columns ...
    promptpay_id: Mapped[str | None] = mapped_column(String(20), nullable=True)
    payment_groups: Mapped[list | None] = mapped_column(JSON, nullable=True)

    tenant: Mapped[Tenant] = relationship(back_populates="stores")
```

- [ ] **Step 3: Add `SessionPaymentEntry` model to `api/app/models/hr.py`**

Add `JSON` to the existing SQLAlchemy imports at the top of `hr.py`:
```python
from sqlalchemy import (
    Date,
    DateTime,
    ForeignKey,
    Index,
    JSON,
    Numeric,
    String,
    Text,
    Time,
    UniqueConstraint,
)
```

Add `import decimal` if not already present (it already is). Then append the new model class at the end of `hr.py`:

```python
class SessionPaymentEntry(Base, TimestampMixin):
    __tablename__ = "session_payment_entries"
    __table_args__ = (
        Index("ix_spe_session_id", "session_id"),
        Index("ix_spe_store_id", "store_id"),
    )

    id: Mapped[str] = mapped_column(String(24), primary_key=True, default=new_cuid)
    session_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("cash_sessions.id", ondelete="CASCADE"), nullable=False
    )
    store_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("stores.id", ondelete="CASCADE"), nullable=False
    )
    group_name: Mapped[str] = mapped_column(String(100), nullable=False)
    methods: Mapped[list] = mapped_column(JSON, nullable=False)
    system_total: Mapped[decimal.Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    actual_amount: Mapped[decimal.Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    variance: Mapped[decimal.Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
```

- [ ] **Step 4: Export `SessionPaymentEntry` from `api/app/models/__init__.py`**

In the import line for hr models:
```python
from app.models.hr import CashSession, Leave, SessionPaymentEntry, ShiftAssignment, StaffTask
```

Add `"SessionPaymentEntry"` to the `__all__` list (insert alphabetically):
```python
    "SessionPaymentEntry",
```

- [ ] **Step 5: Write the Alembic migration**

Create `api/alembic/versions/0022_session_reconciliation.py`:

```python
"""add session reconciliation support

Revision ID: 0022
Revises: 0021
Create Date: 2026-06-06
"""

import sqlalchemy as sa

from alembic import op

revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("stores", sa.Column("payment_groups", sa.JSON(), nullable=True))
    op.create_table(
        "session_payment_entries",
        sa.Column("id", sa.String(24), primary_key=True),
        sa.Column(
            "session_id",
            sa.String(24),
            sa.ForeignKey("cash_sessions.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "store_id",
            sa.String(24),
            sa.ForeignKey("stores.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("group_name", sa.String(100), nullable=False),
        sa.Column("methods", sa.JSON(), nullable=False),
        sa.Column("system_total", sa.Numeric(12, 2), nullable=False),
        sa.Column("actual_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("variance", sa.Numeric(12, 2), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_table("session_payment_entries")
    op.drop_column("stores", "payment_groups")
```

- [ ] **Step 6: Apply migration and confirm**

```bash
cd api && uv run alembic upgrade head
```

Expected: `Running upgrade 0021 -> 0022, add session reconciliation support`

- [ ] **Step 7: Commit**

```bash
git add api/tests/factories.py api/app/models/tenancy.py api/app/models/hr.py api/app/models/__init__.py api/alembic/versions/0022_session_reconciliation.py
git commit -m "feat(reconciliation): add SessionPaymentEntry model, migration, and factory update"
```

---

## Task 2: Pydantic Schemas

**Files:**
- Modify: `api/app/schemas/hr.py`

- [ ] **Step 1: Update imports in `api/app/schemas/hr.py`**

The file currently imports from `app.enums`: `LeaveStatus, LeaveType, Role, StaffPosition, TaskStatus`. Add `PaymentMethod`:

```python
from app.enums import LeaveStatus, LeaveType, PaymentMethod, Role, StaffPosition, TaskStatus
```

- [ ] **Step 2: Remove `CashSessionClose` and add new schemas**

Delete the existing `CashSessionClose` class (lines 98–100):
```python
class CashSessionClose(BaseModel):
    cash_close: decimal.Decimal = Field(ge=0, decimal_places=2)
    notes: str | None = Field(None, max_length=500)
```

In its place, add these schemas (insert before `CashSessionRead`):

```python
class PaymentGroupConfig(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    methods: list[PaymentMethod] = Field(min_length=1)


class ReconciliationEntryCreate(BaseModel):
    group_name: str = Field(min_length=1, max_length=100)
    actual_amount: decimal.Decimal = Field(ge=0, decimal_places=2)
    notes: str | None = Field(None, max_length=1000)


class CashSessionClosePayload(BaseModel):
    entries: list[ReconciliationEntryCreate] = Field(min_length=1)


class SessionPaymentEntryRead(BaseModel):
    id: str
    session_id: str
    group_name: str
    methods: list[str]
    system_total: decimal.Decimal
    actual_amount: decimal.Decimal
    variance: decimal.Decimal
    notes: str | None


class SessionGroupSummary(BaseModel):
    name: str
    methods: list[str]
    system_total: decimal.Decimal


class SessionSummaryRead(BaseModel):
    session_id: str
    period_from: datetime
    period_to: datetime
    groups: list[SessionGroupSummary]
```

- [ ] **Step 3: Extend `CashSessionRead` and add `CashSessionDetailRead`**

`CashSessionRead` stays unchanged. Add `CashSessionDetailRead` immediately after it:

```python
class CashSessionDetailRead(CashSessionRead):
    entries: list[SessionPaymentEntryRead]
```

- [ ] **Step 4: Commit**

```bash
git add api/app/schemas/hr.py
git commit -m "feat(reconciliation): add reconciliation schemas"
```

---

## Task 3: Service — Payment Group Config (TDD)

**Files:**
- Create: `api/tests/test_session_reconciliation.py` (partial — payment group tests)
- Modify: `api/app/services/hr.py`

- [ ] **Step 1: Write failing tests for `get_payment_groups` and `set_payment_groups`**

Create `api/tests/test_session_reconciliation.py`:

```python
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Unprocessable
from app.enums import Channel, OrderStatus, PaymentMethod
from app.models.hr import CashSession
from app.schemas.hr import (
    CashSessionClosePayload,
    PaymentGroupConfig,
    ReconciliationEntryCreate,
)
from app.services import hr as svc
from tests.factories import make_order_direct


async def _make_session(db: AsyncSession, store_id: str, user_id: str) -> CashSession:
    session = CashSession(
        store_id=store_id,
        opened_by_id=user_id,
        cash_open=Decimal("500.00"),
        opened_at=datetime.now(UTC) - timedelta(hours=1),
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return session


# ---------------------------------------------------------------------------
# get_payment_groups
# ---------------------------------------------------------------------------


async def test_get_payment_groups_returns_default_when_not_set(db, store_a):
    groups = await svc.get_payment_groups(db, store_id=store_a.id)
    names = [g["name"] for g in groups]
    assert "Cash" in names
    assert "Online" in names
    assert len(groups) == 2


# ---------------------------------------------------------------------------
# set_payment_groups
# ---------------------------------------------------------------------------


async def test_set_payment_groups_saves_custom_config(db, store_a):
    payload = [
        PaymentGroupConfig(name="Cash", methods=[PaymentMethod.CASH]),
        PaymentGroupConfig(name="Card", methods=[PaymentMethod.CARD]),
        PaymentGroupConfig(
            name="QR",
            methods=[PaymentMethod.QR_PROMPTPAY, PaymentMethod.LINE_PAY, PaymentMethod.TRUEMONEY],
        ),
        PaymentGroupConfig(name="Other", methods=[PaymentMethod.OTHER]),
    ]
    result = await svc.set_payment_groups(db, store_id=store_a.id, groups=payload)
    assert len(result) == 4
    assert result[1]["name"] == "Card"


async def test_set_payment_groups_rejects_missing_method(db, store_a):
    payload = [
        PaymentGroupConfig(name="Cash", methods=[PaymentMethod.CASH]),
        PaymentGroupConfig(
            name="Online",
            methods=[PaymentMethod.CARD, PaymentMethod.QR_PROMPTPAY, PaymentMethod.LINE_PAY, PaymentMethod.TRUEMONEY],
        ),
        # OTHER is missing
    ]
    with pytest.raises(Unprocessable):
        await svc.set_payment_groups(db, store_id=store_a.id, groups=payload)


async def test_set_payment_groups_rejects_duplicate_method(db, store_a):
    payload = [
        PaymentGroupConfig(name="Cash", methods=[PaymentMethod.CASH]),
        PaymentGroupConfig(
            name="Online",
            methods=[PaymentMethod.CASH, PaymentMethod.CARD, PaymentMethod.QR_PROMPTPAY, PaymentMethod.LINE_PAY, PaymentMethod.TRUEMONEY, PaymentMethod.OTHER],
        ),
    ]
    with pytest.raises(Unprocessable):
        await svc.set_payment_groups(db, store_id=store_a.id, groups=payload)
```

- [ ] **Step 2: Run tests — expect failures (functions not defined)**

```bash
cd api && uv run pytest tests/test_session_reconciliation.py::test_get_payment_groups_returns_default_when_not_set tests/test_session_reconciliation.py::test_set_payment_groups_saves_custom_config -v
```

Expected: `AttributeError: module 'app.services.hr' has no attribute 'get_payment_groups'`

- [ ] **Step 3: Add new imports to `api/app/services/hr.py`**

Replace the existing import block at the top with:

```python
import logging
from datetime import UTC, datetime
from datetime import date as date_type
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Conflict, Forbidden, NotFound, Unprocessable
from app.core.security import hash_pin
from app.enums import LeaveStatus, OrderStatus, PaymentMethod, TaskStatus
from app.models.hr import CashSession, Leave, SessionPaymentEntry, ShiftAssignment, StaffTask
from app.models.identity import User
from app.models.orders import Order
from app.models.tenancy import Store
from app.schemas.hr import (
    CashSessionClosePayload,
    CashSessionCreate,
    CashSessionDetailRead,
    CashSessionRead,
    LeaveCreate,
    LeaveRead,
    LeaveReview,
    PaymentGroupConfig,
    ReconciliationEntryCreate,
    SessionGroupSummary,
    SessionPaymentEntryRead,
    SessionSummaryRead,
    ShiftCreate,
    ShiftRead,
    StaffCreate,
    StaffUpdate,
    TaskCreate,
    TaskRead,
    TaskUpdate,
)

logger = logging.getLogger(__name__)

_DEFAULT_PAYMENT_GROUPS: list[dict] = [
    {"name": "Cash", "methods": ["CASH"]},
    {"name": "Online", "methods": ["CARD", "QR_PROMPTPAY", "LINE_PAY", "TRUEMONEY", "OTHER"]},
]
```

- [ ] **Step 4: Add `get_payment_groups` and `set_payment_groups` to `api/app/services/hr.py`**

Insert these two functions immediately before the `# Cash sessions` section comment:

```python
# ---------------------------------------------------------------------------
# Payment group config
# ---------------------------------------------------------------------------


async def get_payment_groups(db: AsyncSession, *, store_id: str) -> list[dict]:
    result = await db.execute(select(Store).where(Store.id == store_id))
    store = result.scalar_one_or_none()
    if store is None or store.payment_groups is None:
        return _DEFAULT_PAYMENT_GROUPS
    return store.payment_groups


async def set_payment_groups(
    db: AsyncSession, *, store_id: str, groups: list[PaymentGroupConfig]
) -> list[dict]:
    all_methods = {m.value for m in PaymentMethod}
    seen: set[str] = set()
    for g in groups:
        for m in g.methods:
            method_val = m.value
            if method_val in seen:
                raise Unprocessable(f"Payment method '{method_val}' appears in more than one group")
            seen.add(method_val)
    missing = all_methods - seen
    if missing:
        raise Unprocessable(f"Payment methods not assigned to any group: {sorted(missing)}")

    groups_data = [{"name": g.name, "methods": [m.value for m in g.methods]} for g in groups]

    async with db.begin():
        result = await db.execute(select(Store).where(Store.id == store_id))
        store = result.scalar_one()
        store.payment_groups = groups_data

    return groups_data
```

- [ ] **Step 5: Run tests — expect green**

```bash
cd api && uv run pytest tests/test_session_reconciliation.py::test_get_payment_groups_returns_default_when_not_set tests/test_session_reconciliation.py::test_set_payment_groups_saves_custom_config tests/test_session_reconciliation.py::test_set_payment_groups_rejects_missing_method tests/test_session_reconciliation.py::test_set_payment_groups_rejects_duplicate_method -v
```

Expected: 4 passed

- [ ] **Step 6: Commit**

```bash
git add api/tests/test_session_reconciliation.py api/app/services/hr.py
git commit -m "feat(reconciliation): add get/set payment groups service functions"
```

---

## Task 4: Service — Session Summary (TDD)

**Files:**
- Modify: `api/tests/test_session_reconciliation.py` (append)
- Modify: `api/app/services/hr.py`

- [ ] **Step 1: Append session summary tests to `api/tests/test_session_reconciliation.py`**

```python
# ---------------------------------------------------------------------------
# get_session_summary
# ---------------------------------------------------------------------------


async def test_get_session_summary_buckets_orders_by_group(db, store_a, user_a):
    session = await _make_session(db, store_a.id, user_a.id)
    await make_order_direct(
        db, store_id=store_a.id, created_by_id=user_a.id,
        total=Decimal("100.00"), payment_method=PaymentMethod.CASH,
    )
    await make_order_direct(
        db, store_id=store_a.id, created_by_id=user_a.id,
        total=Decimal("200.00"), payment_method=PaymentMethod.CARD,
    )
    await make_order_direct(
        db, store_id=store_a.id, created_by_id=user_a.id,
        total=Decimal("150.00"), payment_method=PaymentMethod.QR_PROMPTPAY,
    )

    summary = await svc.get_session_summary(db, store_id=store_a.id, session_id=session.id)

    assert summary.session_id == session.id
    cash_group = next(g for g in summary.groups if g.name == "Cash")
    online_group = next(g for g in summary.groups if g.name == "Online")
    assert cash_group.system_total == Decimal("100.00")
    assert online_group.system_total == Decimal("350.00")


async def test_get_session_summary_returns_zero_for_empty_group(db, store_a, user_a):
    session = await _make_session(db, store_a.id, user_a.id)
    await make_order_direct(
        db, store_id=store_a.id, created_by_id=user_a.id,
        total=Decimal("500.00"), payment_method=PaymentMethod.CASH,
    )

    summary = await svc.get_session_summary(db, store_id=store_a.id, session_id=session.id)

    online_group = next(g for g in summary.groups if g.name == "Online")
    assert online_group.system_total == Decimal("0")
```

- [ ] **Step 2: Run tests — expect failures**

```bash
cd api && uv run pytest tests/test_session_reconciliation.py::test_get_session_summary_buckets_orders_by_group -v
```

Expected: `AttributeError: module 'app.services.hr' has no attribute 'get_session_summary'`

- [ ] **Step 3: Add `get_session_summary` to `api/app/services/hr.py`**

Insert this function immediately after `set_payment_groups`:

```python
async def get_session_summary(
    db: AsyncSession, *, store_id: str, session_id: str
) -> SessionSummaryRead:
    session = await _load_cash_session(db, store_id=store_id, session_id=session_id)
    end_time = session.closed_at or datetime.now(UTC)

    stmt = (
        select(Order.payment_method, func.sum(Order.total).label("total"))
        .where(
            Order.store_id == store_id,
            Order.status == OrderStatus.PAID,
            Order.created_at >= session.opened_at,
            Order.created_at <= end_time,
        )
        .group_by(Order.payment_method)
    )
    rows = (await db.execute(stmt)).all()
    method_totals: dict[str, Decimal] = {
        row.payment_method.value: Decimal(str(row.total))
        for row in rows
        if row.payment_method is not None
    }

    groups = await get_payment_groups(db, store_id=store_id)
    group_summaries = [
        SessionGroupSummary(
            name=g["name"],
            methods=g["methods"],
            system_total=sum(method_totals.get(m, Decimal("0")) for m in g["methods"]),
        )
        for g in groups
    ]

    return SessionSummaryRead(
        session_id=session_id,
        period_from=session.opened_at,
        period_to=end_time,
        groups=group_summaries,
    )
```

- [ ] **Step 4: Run tests — expect green**

```bash
cd api && uv run pytest tests/test_session_reconciliation.py::test_get_session_summary_buckets_orders_by_group tests/test_session_reconciliation.py::test_get_session_summary_returns_zero_for_empty_group -v
```

Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
git add api/tests/test_session_reconciliation.py api/app/services/hr.py
git commit -m "feat(reconciliation): add get_session_summary service function"
```

---

## Task 5: Service — Replace `close_cash_session` (TDD)

**Files:**
- Modify: `api/tests/test_session_reconciliation.py` (append)
- Modify: `api/app/services/hr.py`

- [ ] **Step 1: Append close session tests to `api/tests/test_session_reconciliation.py`**

```python
# ---------------------------------------------------------------------------
# close_cash_session (reconciliation)
# ---------------------------------------------------------------------------


async def test_close_session_persists_entries_and_variance(db, store_a, user_a, manager_a):
    session = await _make_session(db, store_a.id, user_a.id)
    await make_order_direct(
        db, store_id=store_a.id, created_by_id=user_a.id,
        total=Decimal("400.00"), payment_method=PaymentMethod.CASH,
    )
    await make_order_direct(
        db, store_id=store_a.id, created_by_id=user_a.id,
        total=Decimal("600.00"), payment_method=PaymentMethod.CARD,
    )

    payload = CashSessionClosePayload(entries=[
        ReconciliationEntryCreate(group_name="Cash", actual_amount=Decimal("380.00"), notes="Short 20"),
        ReconciliationEntryCreate(group_name="Online", actual_amount=Decimal("600.00"), notes=None),
    ])
    result = await svc.close_cash_session(
        db, store_id=store_a.id, session_id=session.id,
        closed_by_id=manager_a.id, payload=payload,
    )

    assert result.closed_at is not None
    cash_entry = next(e for e in result.entries if e.group_name == "Cash")
    assert cash_entry.system_total == Decimal("400.00")
    assert cash_entry.actual_amount == Decimal("380.00")
    assert cash_entry.variance == Decimal("-20.00")
    assert cash_entry.notes == "Short 20"

    online_entry = next(e for e in result.entries if e.group_name == "Online")
    assert online_entry.system_total == Decimal("600.00")
    assert online_entry.variance == Decimal("0.00")


async def test_close_session_raises_409_if_already_closed(db, store_a, user_a, manager_a):
    from app.core.errors import Conflict

    session = await _make_session(db, store_a.id, user_a.id)
    payload = CashSessionClosePayload(entries=[
        ReconciliationEntryCreate(group_name="Cash", actual_amount=Decimal("0.00")),
        ReconciliationEntryCreate(group_name="Online", actual_amount=Decimal("0.00")),
    ])
    await svc.close_cash_session(
        db, store_id=store_a.id, session_id=session.id,
        closed_by_id=manager_a.id, payload=payload,
    )
    with pytest.raises(Conflict):
        await svc.close_cash_session(
            db, store_id=store_a.id, session_id=session.id,
            closed_by_id=manager_a.id, payload=payload,
        )


async def test_close_session_raises_422_for_unknown_group(db, store_a, user_a, manager_a):
    session = await _make_session(db, store_a.id, user_a.id)
    payload = CashSessionClosePayload(entries=[
        ReconciliationEntryCreate(group_name="Cash", actual_amount=Decimal("0.00")),
        ReconciliationEntryCreate(group_name="Nonexistent", actual_amount=Decimal("0.00")),
    ])
    with pytest.raises(Unprocessable):
        await svc.close_cash_session(
            db, store_id=store_a.id, session_id=session.id,
            closed_by_id=manager_a.id, payload=payload,
        )


async def test_close_session_raises_422_for_missing_group(db, store_a, user_a, manager_a):
    session = await _make_session(db, store_a.id, user_a.id)
    payload = CashSessionClosePayload(entries=[
        ReconciliationEntryCreate(group_name="Cash", actual_amount=Decimal("0.00")),
        # "Online" group missing
    ])
    with pytest.raises(Unprocessable):
        await svc.close_cash_session(
            db, store_id=store_a.id, session_id=session.id,
            closed_by_id=manager_a.id, payload=payload,
        )
```

- [ ] **Step 2: Run tests — expect failures**

```bash
cd api && uv run pytest tests/test_session_reconciliation.py::test_close_session_persists_entries_and_variance -v
```

Expected: `TypeError` or signature mismatch since `close_cash_session` still takes `CashSessionClose`

- [ ] **Step 3: Replace `close_cash_session` in `api/app/services/hr.py`**

Find and replace the entire existing `close_cash_session` function (which takes `payload: CashSessionClose`) with:

```python
async def close_cash_session(
    db: AsyncSession,
    *,
    store_id: str,
    session_id: str,
    closed_by_id: str,
    payload: CashSessionClosePayload,
) -> CashSessionDetailRead:
    async with db.begin():
        session = await _load_cash_session(db, store_id=store_id, session_id=session_id)
        if session.closed_at is not None:
            raise Conflict("Cash session is already closed")

        end_time = datetime.now(UTC)

        stmt = (
            select(Order.payment_method, func.sum(Order.total).label("total"))
            .where(
                Order.store_id == store_id,
                Order.status == OrderStatus.PAID,
                Order.created_at >= session.opened_at,
                Order.created_at <= end_time,
            )
            .group_by(Order.payment_method)
        )
        rows = (await db.execute(stmt)).all()
        method_totals: dict[str, Decimal] = {
            row.payment_method.value: Decimal(str(row.total))
            for row in rows
            if row.payment_method is not None
        }

        groups = await get_payment_groups(db, store_id=store_id)
        configured_names = {g["name"] for g in groups}
        submitted_names = {e.group_name for e in payload.entries}

        missing = configured_names - submitted_names
        if missing:
            raise Unprocessable(f"Missing reconciliation entries for groups: {sorted(missing)}")
        unknown = submitted_names - configured_names
        if unknown:
            raise Unprocessable(f"Unknown group names submitted: {sorted(unknown)}")

        group_method_map = {g["name"]: g["methods"] for g in groups}
        entry_reads: list[SessionPaymentEntryRead] = []

        for entry in payload.entries:
            methods = group_method_map[entry.group_name]
            system_total = sum(method_totals.get(m, Decimal("0")) for m in methods)
            variance = entry.actual_amount - system_total
            spe = SessionPaymentEntry(
                session_id=session.id,
                store_id=store_id,
                group_name=entry.group_name,
                methods=methods,
                system_total=system_total,
                actual_amount=entry.actual_amount,
                variance=variance,
                notes=entry.notes,
            )
            db.add(spe)
            entry_reads.append(SessionPaymentEntryRead(
                id=spe.id,
                session_id=spe.session_id,
                group_name=spe.group_name,
                methods=spe.methods,
                system_total=spe.system_total,
                actual_amount=spe.actual_amount,
                variance=spe.variance,
                notes=spe.notes,
            ))

        session.closed_by_id = closed_by_id
        session.closed_at = end_time

    return CashSessionDetailRead(
        id=session.id,
        store_id=session.store_id,
        opened_by_id=session.opened_by_id,
        closed_by_id=session.closed_by_id,
        cash_open=session.cash_open,
        cash_close=session.cash_close,
        opened_at=session.opened_at,
        closed_at=session.closed_at,
        notes=session.notes,
        created_at=session.created_at,
        updated_at=session.updated_at,
        entries=entry_reads,
    )
```

- [ ] **Step 4: Remove the old `CashSessionClose` import from `api/app/services/hr.py`**

The import block was already updated in Task 3 Step 3 — `CashSessionClose` should not appear. Verify it is absent.

- [ ] **Step 5: Run all reconciliation service tests — expect green**

```bash
cd api && uv run pytest tests/test_session_reconciliation.py -v -k "not (test_get_payment_groups_returns_200 or test_patch_payment_groups or test_get_session_summary_returns or test_close_session_with_entries)"
```

Expected: all 9 service tests pass

- [ ] **Step 6: Commit**

```bash
git add api/tests/test_session_reconciliation.py api/app/services/hr.py
git commit -m "feat(reconciliation): replace close_cash_session with reconciliation-based version"
```

---

## Task 6: HTTP Routes

**Files:**
- Modify: `api/app/api/v1/hr.py`

- [ ] **Step 1: Update imports in `api/app/api/v1/hr.py`**

Replace the existing `CashSessionClose` import with the new schemas. The import block for hr schemas should become:

```python
from app.schemas.hr import (
    CashSessionClosePayload,
    CashSessionCreate,
    CashSessionDetailRead,
    CashSessionRead,
    LeaveCreate,
    LeaveRead,
    LeaveReview,
    PaymentGroupConfig,
    SessionSummaryRead,
    ShiftCreate,
    ShiftRead,
    StaffCreate,
    StaffRead,
    StaffUpdate,
    TaskCreate,
    TaskRead,
    TaskUpdate,
)
```

- [ ] **Step 2: Add payment group routes to `api/app/api/v1/hr.py`**

Insert these two routes immediately before the `# Cash sessions` section comment:

```python
# ---------------------------------------------------------------------------
# Payment group config
# ---------------------------------------------------------------------------


@router.get(
    "/payment-groups",
    response_model=list[PaymentGroupConfig],
    summary="Get store's payment group configuration",
    operation_id="hr_payment_groups_get",
)
async def get_payment_groups(user: StoreUser, db: DbSession) -> list[PaymentGroupConfig]:
    groups = await hr_svc.get_payment_groups(db, store_id=user.store_id)
    return [PaymentGroupConfig(name=g["name"], methods=g["methods"]) for g in groups]


@router.patch(
    "/payment-groups",
    response_model=list[PaymentGroupConfig],
    summary="Replace store's payment group configuration",
    operation_id="hr_payment_groups_update",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def set_payment_groups(
    payload: list[PaymentGroupConfig], user: StoreUser, db: DbSession
) -> list[PaymentGroupConfig]:
    groups = await hr_svc.set_payment_groups(db, store_id=user.store_id, groups=payload)
    return [PaymentGroupConfig(name=g["name"], methods=g["methods"]) for g in groups]
```

- [ ] **Step 3: Add session summary route**

Insert this route immediately after `get_current_cash_session` and before `open_cash_session`:

```python
@router.get(
    "/cash-sessions/{session_id}/summary",
    response_model=SessionSummaryRead,
    summary="Get system sales totals by payment group for a session",
    operation_id="hr_cash_sessions_summary",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def get_cash_session_summary(
    session_id: str, user: StoreUser, db: DbSession
) -> SessionSummaryRead:
    return await hr_svc.get_session_summary(db, store_id=user.store_id, session_id=session_id)
```

- [ ] **Step 4: Replace the close route**

Find the existing close route:

```python
@router.patch(
    "/cash-sessions/{session_id}/close",
    response_model=CashSessionRead,
    summary="Close a cash session (record closing float)",
    operation_id="hr_cash_sessions_close",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def close_cash_session(
    session_id: str, payload: CashSessionClose, user: StoreUser, db: DbSession
) -> CashSessionRead:
    return await hr_svc.close_cash_session(
        db,
        store_id=user.store_id,
        session_id=session_id,
        closed_by_id=user.id,
        payload=payload,
    )
```

Replace it with:

```python
@router.patch(
    "/cash-sessions/{session_id}/close",
    response_model=CashSessionDetailRead,
    summary="Close a cash session with per-payment-group reconciliation",
    operation_id="hr_cash_sessions_close",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def close_cash_session(
    session_id: str, payload: CashSessionClosePayload, user: StoreUser, db: DbSession
) -> CashSessionDetailRead:
    return await hr_svc.close_cash_session(
        db,
        store_id=user.store_id,
        session_id=session_id,
        closed_by_id=user.id,
        payload=payload,
    )
```

- [ ] **Step 5: Commit**

```bash
git add api/app/api/v1/hr.py
git commit -m "feat(reconciliation): add payment group and session summary routes, update close route"
```

---

## Task 7: HTTP Tests

**Files:**
- Modify: `api/tests/test_session_reconciliation.py` (append)

- [ ] **Step 1: Append HTTP tests to `api/tests/test_session_reconciliation.py`**

```python
# ---------------------------------------------------------------------------
# HTTP tests
# ---------------------------------------------------------------------------


async def _login(client, store_slug: str, pin: str) -> str:
    resp = await client.post("/api/v1/auth/login", json={"store_slug": store_slug, "pin": pin})
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def test_get_payment_groups_returns_200(client, db, store_a, manager_a):
    token = await _login(client, store_a.slug, "2222")
    resp = await client.get("/api/v1/hr/payment-groups", headers=_headers(token))
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert any(g["name"] == "Cash" for g in data)


async def test_patch_payment_groups_requires_manager(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    resp = await client.patch(
        "/api/v1/hr/payment-groups",
        headers=_headers(token),
        json=[
            {"name": "Cash", "methods": ["CASH"]},
            {"name": "Online", "methods": ["CARD", "QR_PROMPTPAY", "LINE_PAY", "TRUEMONEY", "OTHER"]},
        ],
    )
    assert resp.status_code == 403


async def test_get_session_summary_returns_groups(client, db, store_a, user_a, manager_a):
    token = await _login(client, store_a.slug, "2222")
    open_resp = await client.post(
        "/api/v1/hr/cash-sessions", headers=_headers(token), json={"cash_open": "500.00"}
    )
    assert open_resp.status_code == 201
    session_id = open_resp.json()["id"]

    await make_order_direct(
        db, store_id=store_a.id, created_by_id=user_a.id,
        total=Decimal("100.00"), payment_method=PaymentMethod.CASH,
    )

    resp = await client.get(
        f"/api/v1/hr/cash-sessions/{session_id}/summary", headers=_headers(token)
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "groups" in data
    cash_group = next(g for g in data["groups"] if g["name"] == "Cash")
    assert Decimal(cash_group["system_total"]) == Decimal("100.00")


async def test_close_session_with_entries_closes_session(client, db, store_a, user_a, manager_a):
    token = await _login(client, store_a.slug, "2222")
    open_resp = await client.post(
        "/api/v1/hr/cash-sessions", headers=_headers(token), json={"cash_open": "500.00"}
    )
    assert open_resp.status_code == 201
    session_id = open_resp.json()["id"]

    resp = await client.patch(
        f"/api/v1/hr/cash-sessions/{session_id}/close",
        headers=_headers(token),
        json={
            "entries": [
                {"group_name": "Cash", "actual_amount": "0.00", "notes": None},
                {"group_name": "Online", "actual_amount": "0.00", "notes": None},
            ]
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["closed_at"] is not None
    assert len(data["entries"]) == 2
```

- [ ] **Step 2: Run all tests**

```bash
cd api && uv run pytest tests/test_session_reconciliation.py -v
```

Expected: all 13 tests pass

- [ ] **Step 3: Run full test suite to check for regressions**

```bash
cd api && uv run pytest -x -q
```

Expected: no new failures. Pre-existing failures (if any) should match the known baseline on this branch.

- [ ] **Step 4: Final commit**

```bash
git add api/tests/test_session_reconciliation.py
git commit -m "test(reconciliation): add HTTP tests for payment groups and session close"
```
