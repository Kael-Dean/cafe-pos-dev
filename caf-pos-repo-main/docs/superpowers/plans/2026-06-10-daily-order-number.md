# Daily-Reset Order Number Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-store, per-business-day `daily_number` (resets to 1 each day), a stored `business_date`, and a backend-generated `receipt_no` to every order — assigned atomically at creation, never recomputed.

**Architecture:** A new `order_daily_counters` table (PK: `store_id + business_date`) serves as the atomic allocator. An `ON CONFLICT DO UPDATE` upsert inside the existing `create_order` transaction atomically claims the next `daily_number` and rolls back if the order fails. `receipt_no` is derived as `IV{BuddhistYear}{MM}{DD}-{daily_number:04d}` and stored immutably on the `Order` row. Three new columns (`business_date DATE`, `daily_number INTEGER`, `receipt_no VARCHAR(32)`) are added to `orders` via migration `0023` with a full SQL backfill.

**Tech Stack:** FastAPI, SQLAlchemy 2.x async, PostgreSQL, Alembic, pytest-asyncio, `zoneinfo` (Python stdlib), `sqlalchemy.dialects.postgresql.insert` for the upsert.

> **Note on migration number:** The spec document says `0020`, but migrations `0020`, `0021`, `0022` already exist. The correct revision here is **`0023`** with `down_revision = "0022"`.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `api/app/models/orders.py` | Modify | Add `OrderDailyCounter` model; add `business_date`, `daily_number`, `receipt_no` to `Order` |
| `api/app/models/__init__.py` | Modify | Export `OrderDailyCounter` for Alembic autogenerate |
| `api/alembic/versions/0023_daily_order_number.py` | Create | Schema changes + full SQL backfill + downgrade |
| `api/app/services/orders.py` | Modify | Add `STORE_TZ`, `_business_date()`, `make_receipt_no()`; wire atomic upsert into `create_order` |
| `api/app/schemas/orders.py` | Modify | Add `daily_number`, `business_date`, `receipt_no` to `OrderRead` and `PromptPayQRResponse` |
| `api/tests/test_daily_order_number.py` | Create | All §9 tests from the spec |

---

## Task 1: Write failing model tests

**Files:**
- Create: `api/tests/test_daily_order_number.py`

- [ ] **Step 1: Create the test file**

```python
# api/tests/test_daily_order_number.py
"""Tests for daily-reset order numbering (spec §9)."""
from datetime import date
from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy import inspect as sa_inspect

from tests.conftest import make_category, make_product


# ── Model attribute tests (Task 1) ──────────────────────────────────────────

def test_order_model_has_new_columns():
    """Order ORM exposes daily_number, business_date, receipt_no columns."""
    from app.models.orders import Order
    mapper = sa_inspect(Order)
    col_names = {c.key for c in mapper.columns}
    assert "daily_number" in col_names
    assert "business_date" in col_names
    assert "receipt_no" in col_names


def test_order_daily_counter_model_importable():
    """OrderDailyCounter model exists and has the correct columns."""
    from app.models.orders import OrderDailyCounter
    mapper = sa_inspect(OrderDailyCounter)
    col_names = {c.key for c in mapper.columns}
    assert "store_id" in col_names
    assert "business_date" in col_names
    assert "last_number" in col_names
```

- [ ] **Step 2: Run the tests — expect FAIL (ImportError)**

Run from `api/`:
```
uv run pytest tests/test_daily_order_number.py -v
```
Expected: `ImportError: cannot import name 'OrderDailyCounter' from 'app.models.orders'`

---

## Task 2: Implement models + update `__init__.py`

**Files:**
- Modify: `api/app/models/orders.py`
- Modify: `api/app/models/__init__.py`

- [ ] **Step 1: Add imports to `api/app/models/orders.py`**

At the top of the file, add `Date` to the sqlalchemy imports and `date` from datetime:

```python
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    Sequence,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy import (
    Enum as SAEnum,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin
from app.db.types import new_cuid
from app.enums import Channel, OrderStatus, PaymentMethod
```

- [ ] **Step 2: Add three new columns to the `Order` model**

Inside `class Order`, add these three columns after `reward_redeemed` (the last existing column):

```python
    business_date: Mapped[date] = mapped_column(Date, nullable=False)
    daily_number: Mapped[int] = mapped_column(Integer, nullable=False)
    receipt_no: Mapped[str] = mapped_column(String(32), nullable=False, unique=True)
```

Also update `__table_args__` to add the composite unique and index constraints:

```python
    __table_args__ = (
        UniqueConstraint("store_id", "idempotency_key", name="uq_orders_store_idempotency"),
        UniqueConstraint("store_id", "business_date", "daily_number", name="uq_orders_store_date_daily"),
        Index("ix_orders_store_status", "store_id", "status"),
        Index("ix_orders_store_created", "store_id", "created_at"),
        Index("ix_orders_store_business_date", "store_id", "business_date"),
    )
```

- [ ] **Step 3: Add the `OrderDailyCounter` model to `api/app/models/orders.py`**

Append after the `OrderVoidLog` class:

```python
class OrderDailyCounter(Base):
    """Atomic per-store, per-day sequence allocator for daily_number."""

    __tablename__ = "order_daily_counters"

    store_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("stores.id", ondelete="CASCADE"), primary_key=True
    )
    business_date: Mapped[date] = mapped_column(Date, primary_key=True)
    last_number: Mapped[int] = mapped_column(Integer, nullable=False)
```

- [ ] **Step 4: Export `OrderDailyCounter` from `api/app/models/__init__.py`**

Add to the import line:
```python
from app.models.orders import Order, OrderDailyCounter, OrderItem, OrderVoidLog
```

Add to `__all__`:
```python
    "OrderDailyCounter",
```

- [ ] **Step 5: Run the model tests — expect PASS**

```
uv run pytest tests/test_daily_order_number.py::test_order_model_has_new_columns tests/test_daily_order_number.py::test_order_daily_counter_model_importable -v
```
Expected: 2 passed

- [ ] **Step 6: Lint**

```
uv run ruff check app/models/orders.py app/models/__init__.py
```
Expected: no issues

---

## Task 3: Write migration 0023

**Files:**
- Create: `api/alembic/versions/0023_daily_order_number.py`

- [ ] **Step 1: Create the migration file**

```python
# api/alembic/versions/0023_daily_order_number.py
"""add daily order number and receipt_no

Revision ID: 0023
Revises: 0022
Create Date: 2026-06-10
"""
import sqlalchemy as sa

from alembic import op

revision = "0023"
down_revision = "0022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Add new columns as nullable first (backfill before NOT NULL)
    op.add_column("orders", sa.Column("business_date", sa.Date(), nullable=True))
    op.add_column("orders", sa.Column("daily_number", sa.Integer(), nullable=True))
    op.add_column("orders", sa.Column("receipt_no", sa.String(32), nullable=True))

    # 2. Create the counter table
    op.create_table(
        "order_daily_counters",
        sa.Column(
            "store_id",
            sa.String(24),
            sa.ForeignKey("stores.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
        sa.Column("business_date", sa.Date(), primary_key=True, nullable=False),
        sa.Column("last_number", sa.Integer(), nullable=False),
    )

    bind = op.get_bind()

    # 3a. Backfill business_date from created_at (timestamptz → Asia/Bangkok date)
    bind.execute(sa.text(
        "UPDATE orders SET business_date = (created_at AT TIME ZONE 'Asia/Bangkok')::date"
    ))

    # 3b. Backfill daily_number as row-number within (store_id, business_date), ordered by created_at
    bind.execute(sa.text("""
        WITH numbered AS (
            SELECT id,
                   ROW_NUMBER() OVER (
                       PARTITION BY store_id, business_date
                       ORDER BY created_at, order_number
                   ) AS rn
            FROM orders
        )
        UPDATE orders o
        SET daily_number = n.rn
        FROM numbered n
        WHERE o.id = n.id
    """))

    # 3c. Backfill receipt_no using Buddhist year format
    bind.execute(sa.text("""
        UPDATE orders
        SET receipt_no =
            'IV'
            || (EXTRACT(YEAR FROM business_date)::int + 543)::text
            || lpad(EXTRACT(MONTH FROM business_date)::int::text, 2, '0')
            || lpad(EXTRACT(DAY   FROM business_date)::int::text, 2, '0')
            || '-'
            || lpad(daily_number::text, 4, '0')
    """))

    # 3d. Seed counter table with current max per store/day
    bind.execute(sa.text("""
        INSERT INTO order_daily_counters (store_id, business_date, last_number)
        SELECT store_id, business_date, MAX(daily_number)
        FROM orders
        GROUP BY store_id, business_date
    """))

    # 4. Enforce NOT NULL now that all rows are filled
    op.alter_column("orders", "business_date", nullable=False)
    op.alter_column("orders", "daily_number", nullable=False)
    op.alter_column("orders", "receipt_no", nullable=False)

    # 5. Add constraints and indexes
    op.create_unique_constraint(
        "uq_orders_store_date_daily", "orders", ["store_id", "business_date", "daily_number"]
    )
    op.create_unique_constraint("uq_orders_receipt_no", "orders", ["receipt_no"])
    op.create_index("ix_orders_store_business_date", "orders", ["store_id", "business_date"])


def downgrade() -> None:
    op.drop_index("ix_orders_store_business_date", table_name="orders")
    op.drop_constraint("uq_orders_receipt_no", "orders", type_="unique")
    op.drop_constraint("uq_orders_store_date_daily", "orders", type_="unique")
    op.drop_table("order_daily_counters")
    op.drop_column("orders", "receipt_no")
    op.drop_column("orders", "daily_number")
    op.drop_column("orders", "business_date")
```

- [ ] **Step 2: Run the migration**

```
uv run alembic upgrade head
```
Expected: no errors, `Running upgrade 0022 -> 0023, add daily order number and receipt_no`

- [ ] **Step 3: Commit models + migration together**

```
git add api/app/models/orders.py api/app/models/__init__.py api/alembic/versions/0023_daily_order_number.py
git commit -m "feat: add OrderDailyCounter model and migration 0023 for daily order numbering"
```

---

## Task 4: `make_receipt_no` helper + `_business_date` (TDD)

**Files:**
- Modify: `api/tests/test_daily_order_number.py`
- Modify: `api/app/services/orders.py`

- [ ] **Step 1: Add failing unit tests to the test file**

Append to `api/tests/test_daily_order_number.py`:

```python
# ── make_receipt_no unit tests (Task 4) ──────────────────────────────────────

def test_make_receipt_no_format():
    """Receipt number uses Buddhist year, zero-pads to 4 digits min."""
    from app.services.orders import make_receipt_no
    assert make_receipt_no(date(2026, 6, 10), 1) == "IV25690610-0001"
    assert make_receipt_no(date(2026, 6, 10), 9999) == "IV25690610-9999"
    # More than 9999 orders: pad extends naturally (no cap)
    assert make_receipt_no(date(2026, 6, 10), 10000) == "IV25690610-10000"


def test_make_receipt_no_buddhist_year():
    """Year is Gregorian + 543."""
    from app.services.orders import make_receipt_no
    # 2026 + 543 = 2569
    assert make_receipt_no(date(2026, 1, 1), 1).startswith("IV2569")
    # 2000 + 543 = 2543
    assert make_receipt_no(date(2000, 12, 31), 1).startswith("IV2543")
```

- [ ] **Step 2: Run — expect FAIL**

```
uv run pytest tests/test_daily_order_number.py::test_make_receipt_no_format tests/test_daily_order_number.py::test_make_receipt_no_buddhist_year -v
```
Expected: `ImportError: cannot import name 'make_receipt_no' from 'app.services.orders'`

- [ ] **Step 3: Add `STORE_TZ`, `_business_date`, and `make_receipt_no` to `api/app/services/orders.py`**

Add imports near the top (after existing imports):
```python
from zoneinfo import ZoneInfo

from sqlalchemy.dialects.postgresql import insert as pg_insert
```

Add `OrderDailyCounter` to the models import line:
```python
from app.models.orders import Order, OrderDailyCounter, OrderItem, OrderVoidLog
```

Add these three definitions after the existing module-level constants (`_DEFAULT_PAGE`, `_MAX_PAGE`, `_VALID_TRANSITIONS`):

```python
STORE_TZ = ZoneInfo("Asia/Bangkok")


def _business_date() -> _date:
    """Return the current Asia/Bangkok calendar date. Extracted for testability."""
    return datetime.now(STORE_TZ).date()


def make_receipt_no(business_date: _date, daily_number: int) -> str:
    """Format the receipt number in Thai Buddhist calendar series."""
    be_year = business_date.year + 543
    return f"IV{be_year}{business_date.month:02d}{business_date.day:02d}-{daily_number:04d}"
```

- [ ] **Step 4: Run — expect PASS**

```
uv run pytest tests/test_daily_order_number.py::test_make_receipt_no_format tests/test_daily_order_number.py::test_make_receipt_no_buddhist_year -v
```
Expected: 2 passed

- [ ] **Step 5: Lint**

```
uv run ruff check app/services/orders.py
```
Expected: no issues

- [ ] **Step 6: Commit**

```
git add api/app/services/orders.py api/tests/test_daily_order_number.py
git commit -m "feat: add make_receipt_no helper and STORE_TZ constant for daily order numbering"
```

---

## Task 5: Wire atomic counter upsert into `create_order` (TDD)

**Files:**
- Modify: `api/tests/test_daily_order_number.py`
- Modify: `api/app/services/orders.py`

- [ ] **Step 1: Add failing integration tests**

Append to `api/tests/test_daily_order_number.py`:

```python
# ── Integration fixtures ─────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def cat_a(db, store_a):
    return await make_category(db, store_id=store_a.id, name="DOR-Cat-A")


@pytest_asyncio.fixture
async def prod_a(db, store_a, cat_a):
    return await make_product(
        db, store_id=store_a.id, name="DOR-Prod-A", price=Decimal("50.00"), category_id=cat_a.id
    )


@pytest_asyncio.fixture
async def cat_b(db, store_b):
    return await make_category(db, store_id=store_b.id, name="DOR-Cat-B")


@pytest_asyncio.fixture
async def prod_b(db, store_b, cat_b):
    return await make_product(
        db, store_id=store_b.id, name="DOR-Prod-B", price=Decimal("50.00"), category_id=cat_b.id
    )


import secrets
from app.enums import Channel
from app.schemas.orders import CreateOrderRequest, OrderItemIn
from app.services import orders as svc


def _req(product_id: str) -> CreateOrderRequest:
    return CreateOrderRequest(
        idempotency_key=secrets.token_hex(8),
        channel=Channel.DINE_IN,
        items=[OrderItemIn(product_id=product_id, quantity=1, modifier_ids=[])],
    )


# ── Counter + daily_number integration tests (Task 5) ────────────────────────

async def test_daily_number_increments_within_day(db, store_a, user_a, prod_a):
    """First two orders of the day receive daily_number 1 and 2."""
    o1 = await svc.create_order(db, store_id=store_a.id, user_id=user_a.id, req=_req(prod_a.id))
    o2 = await svc.create_order(db, store_id=store_a.id, user_id=user_a.id, req=_req(prod_a.id))
    assert o1.daily_number == 1
    assert o2.daily_number == 2


async def test_daily_number_resets_on_new_day(db, store_a, user_a, prod_a):
    """First order on a different business_date receives daily_number 1."""
    from datetime import timedelta
    from unittest.mock import patch

    today = _business_date_for_test()
    tomorrow = today + timedelta(days=1)

    o1 = await svc.create_order(db, store_id=store_a.id, user_id=user_a.id, req=_req(prod_a.id))
    assert o1.daily_number == 1
    assert o1.business_date == today

    with patch("app.services.orders._business_date", return_value=tomorrow):
        o2 = await svc.create_order(db, store_id=store_a.id, user_id=user_a.id, req=_req(prod_a.id))
    assert o2.daily_number == 1
    assert o2.business_date == tomorrow


async def test_per_store_isolation(db, store_a, store_b, user_a, user_b, prod_a, prod_b):
    """Store A and Store B maintain independent daily counters."""
    oa = await svc.create_order(db, store_id=store_a.id, user_id=user_a.id, req=_req(prod_a.id))
    ob = await svc.create_order(db, store_id=store_b.id, user_id=user_b.id, req=_req(prod_b.id))
    oa2 = await svc.create_order(db, store_id=store_a.id, user_id=user_a.id, req=_req(prod_a.id))

    assert oa.daily_number == 1
    assert ob.daily_number == 1   # store B has its own counter starting at 1
    assert oa2.daily_number == 2  # store A's counter continues independently


async def test_receipt_no_stored_on_order(db, store_a, user_a, prod_a):
    """receipt_no is stored on the order and matches the expected format."""
    from app.services.orders import make_receipt_no
    o = await svc.create_order(db, store_id=store_a.id, user_id=user_a.id, req=_req(prod_a.id))
    expected = make_receipt_no(o.business_date, o.daily_number)
    assert o.receipt_no == expected
    assert o.receipt_no.startswith("IV")
    assert "-" in o.receipt_no


def _business_date_for_test():
    """Helper to get today's Bangkok date without importing STORE_TZ."""
    from app.services.orders import _business_date
    return _business_date()
```

- [ ] **Step 2: Run — expect FAIL**

```
uv run pytest tests/test_daily_order_number.py::test_daily_number_increments_within_day -v
```
Expected: fails — `order` has no attribute `daily_number` (it's None or AttributeError because service doesn't set it yet)

- [ ] **Step 3: Wire the counter upsert into `create_order` in `api/app/services/orders.py`**

Inside `create_order`, locate the block that constructs the `Order` object (currently around line 105):

```python
            order = Order(
                store_id=store_id,
                status=OrderStatus.PENDING,
                channel=req.channel,
                idempotency_key=req.idempotency_key,
                ...
            )
```

**Before** that `Order(...)` constructor call, insert the atomic counter upsert:

```python
            # Atomically claim the next daily_number for this store+day.
            # ON CONFLICT DO UPDATE takes a row-lock on the counter row, serializing
            # concurrent creates — no two orders get the same daily_number.
            _bdate = _business_date()
            _counter_stmt = (
                pg_insert(OrderDailyCounter)
                .values(store_id=store_id, business_date=_bdate, last_number=1)
                .on_conflict_do_update(
                    index_elements=["store_id", "business_date"],
                    set_={"last_number": OrderDailyCounter.last_number + 1},
                )
                .returning(OrderDailyCounter.last_number)
            )
            _daily_number = (await db.execute(_counter_stmt)).scalar_one()
            _receipt_no = make_receipt_no(_bdate, _daily_number)
```

Then update the `Order(...)` constructor call to include the three new fields:

```python
            order = Order(
                store_id=store_id,
                status=OrderStatus.PENDING,
                channel=req.channel,
                idempotency_key=req.idempotency_key,
                customer_id=req.customer_id,
                customer_note=req.customer_note,
                subtotal=grand_total,
                discount=promotion_discount,
                total=grand_total - promotion_discount,
                created_by_id=user_id,
                business_date=_bdate,
                daily_number=_daily_number,
                receipt_no=_receipt_no,
            )
```

- [ ] **Step 4: Run the integration tests — expect PASS**

```
uv run pytest tests/test_daily_order_number.py::test_daily_number_increments_within_day tests/test_daily_order_number.py::test_daily_number_resets_on_new_day tests/test_daily_order_number.py::test_per_store_isolation tests/test_daily_order_number.py::test_receipt_no_stored_on_order -v
```
Expected: 4 passed

- [ ] **Step 5: Run the full existing test suite to check for regressions**

```
uv run pytest tests/test_orders_service.py -v
```
Expected: all previously-passing tests still pass (the new columns have defaults via the service, so existing tests now need `business_date`, `daily_number`, `receipt_no` to be provided — they will be, since the service now sets them)

- [ ] **Step 6: Lint**

```
uv run ruff check app/services/orders.py
```
Expected: no issues

- [ ] **Step 7: Commit**

```
git add api/app/services/orders.py api/tests/test_daily_order_number.py
git commit -m "feat: wire atomic daily_number counter upsert into create_order"
```

---

## Task 6: Schema updates — expose new fields in API responses

**Files:**
- Modify: `api/app/schemas/orders.py`
- Modify: `api/tests/test_daily_order_number.py`

- [ ] **Step 1: Add failing schema test**

Append to `api/tests/test_daily_order_number.py`:

```python
# ── Schema / API response tests (Task 6) ─────────────────────────────────────

async def test_order_read_schema_includes_new_fields(db, store_a, user_a, prod_a):
    """OrderRead response includes daily_number, business_date, receipt_no."""
    from app.schemas.orders import OrderRead
    o = await svc.create_order(db, store_id=store_a.id, user_id=user_a.id, req=_req(prod_a.id))
    read = OrderRead.model_validate(o)
    assert read.daily_number == o.daily_number
    assert read.business_date == o.business_date
    assert read.receipt_no == o.receipt_no
```

- [ ] **Step 2: Run — expect FAIL**

```
uv run pytest tests/test_daily_order_number.py::test_order_read_schema_includes_new_fields -v
```
Expected: `ValidationError` — `daily_number`, `business_date`, `receipt_no` fields missing from `OrderRead`

- [ ] **Step 3: Update `OrderRead` in `api/app/schemas/orders.py`**

Add `from datetime import date` to imports at the top of the file.

Replace the existing `OrderRead` class with:

```python
class OrderRead(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    order_number: int
    daily_number: int
    business_date: date
    receipt_no: str
    store_id: str
    customer_id: str | None
    status: OrderStatus
    channel: Channel
    payment_method: PaymentMethod | None
    payment_ref: str | None
    customer_note: str | None
    subtotal: Decimal
    discount: Decimal
    tax: Decimal
    total: Decimal
    created_by_id: str
    items: list[OrderItemRead] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime
```

Also update `PromptPayQRResponse` to include the three new fields:

```python
class PromptPayQRResponse(BaseModel):
    order_id: str
    order_number: int
    daily_number: int
    business_date: date
    receipt_no: str
    amount: Decimal
    payload: str
    qr_image_base64: str
```

- [ ] **Step 4: Run — expect PASS**

```
uv run pytest tests/test_daily_order_number.py::test_order_read_schema_includes_new_fields -v
```
Expected: 1 passed

- [ ] **Step 5: Check the PromptPay route for PromptPayQRResponse construction**

Find and verify the PromptPay endpoint constructs `PromptPayQRResponse` correctly:

```
uv run grep -n "PromptPayQRResponse" api/app/api/v1/orders.py
```

If the endpoint constructs `PromptPayQRResponse(order_id=..., order_number=..., ...)` manually, add the three new keyword args:
```python
daily_number=order.daily_number,
business_date=order.business_date,
receipt_no=order.receipt_no,
```

- [ ] **Step 6: Lint**

```
uv run ruff check app/schemas/orders.py app/api/v1/orders.py
```
Expected: no issues

- [ ] **Step 7: Run all daily-number tests**

```
uv run pytest tests/test_daily_order_number.py -v
```
Expected: all tests pass

- [ ] **Step 8: Commit**

```
git add api/app/schemas/orders.py api/app/api/v1/orders.py api/tests/test_daily_order_number.py
git commit -m "feat: expose daily_number, business_date, receipt_no in OrderRead and PromptPayQRResponse"
```

---

## Task 7: Remaining §9 tests — void gap + timezone boundary + concurrency

**Files:**
- Modify: `api/tests/test_daily_order_number.py`

- [ ] **Step 1: Add remaining spec tests**

Append to `api/tests/test_daily_order_number.py`:

```python
# ── §9 edge-case tests (Task 7) ───────────────────────────────────────────────

async def test_void_leaves_gap_in_daily_sequence(db, store_a, user_a, prod_a):
    """Voiding order #2 leaves a gap; the 3rd create becomes #3 (not #2)."""
    from app.schemas.orders import VoidOrderRequest

    o1 = await svc.create_order(db, store_id=store_a.id, user_id=user_a.id, req=_req(prod_a.id))
    o2 = await svc.create_order(db, store_id=store_a.id, user_id=user_a.id, req=_req(prod_a.id))
    o3_before_void = await svc.create_order(
        db, store_id=store_a.id, user_id=user_a.id, req=_req(prod_a.id)
    )

    assert o1.daily_number == 1
    assert o2.daily_number == 2
    assert o3_before_void.daily_number == 3

    # Void the second order
    await svc.void_order(
        db,
        store_id=store_a.id,
        user_id=user_a.id,
        order_id=o2.id,
        req=VoidOrderRequest(reason="test void"),
    )

    # New order gets #4 — #2 is NOT reused
    o4 = await svc.create_order(db, store_id=store_a.id, user_id=user_a.id, req=_req(prod_a.id))
    assert o4.daily_number == 4

    # The voided order still holds daily_number=2
    from sqlalchemy import select
    from app.models.orders import Order
    refreshed_o2 = (await db.execute(select(Order).where(Order.id == o2.id))).scalar_one()
    assert refreshed_o2.daily_number == 2


async def test_timezone_boundary(db, store_a, user_a, prod_a):
    """Orders created before and after Bangkok midnight land on different business dates."""
    from datetime import timedelta
    from unittest.mock import patch

    today = _business_date_for_test()
    yesterday = today - timedelta(days=1)

    # Simulate an order "yesterday" in Bangkok
    with patch("app.services.orders._business_date", return_value=yesterday):
        o_yesterday = await svc.create_order(
            db, store_id=store_a.id, user_id=user_a.id, req=_req(prod_a.id)
        )

    # Simulate an order "today" in Bangkok (after midnight)
    with patch("app.services.orders._business_date", return_value=today):
        o_today = await svc.create_order(
            db, store_id=store_a.id, user_id=user_a.id, req=_req(prod_a.id)
        )

    assert o_yesterday.business_date == yesterday
    assert o_today.business_date == today
    # Each day starts at 1
    assert o_yesterday.daily_number == 1
    assert o_today.daily_number == 1


async def test_concurrency_no_duplicate_daily_numbers(db, store_a, user_a, prod_a):
    """Concurrent order creation produces distinct, contiguous daily_numbers."""
    import asyncio

    N = 5
    tasks = [
        svc.create_order(db, store_id=store_a.id, user_id=user_a.id, req=_req(prod_a.id))
        for _ in range(N)
    ]
    orders = await asyncio.gather(*tasks)

    daily_numbers = sorted(o.daily_number for o in orders)
    assert daily_numbers == list(range(1, N + 1)), f"Expected 1..{N}, got {daily_numbers}"

    receipt_nos = [o.receipt_no for o in orders]
    assert len(set(receipt_nos)) == N, "Duplicate receipt_no detected"
```

- [ ] **Step 2: Run all remaining tests**

```
uv run pytest tests/test_daily_order_number.py -v
```
Expected: all tests pass

- [ ] **Step 3: Run full test suite to check for regressions**

```
uv run pytest -x
```
Expected: no new failures compared to the pre-existing baseline (64 passed, 5 failed, 21 errors is the known baseline — no new failures introduced)

- [ ] **Step 4: Lint everything**

```
uv run ruff check .
```
Expected: no issues

- [ ] **Step 5: Final commit**

```
git add api/tests/test_daily_order_number.py
git commit -m "test: add edge-case tests for void gap, timezone boundary, and concurrency"
```

---

## Self-Review

### Spec coverage check

| Spec section | Covered by |
|---|---|
| §2.1 — `business_date`, `daily_number`, `receipt_no` columns | Task 2 (model) + Task 3 (migration) |
| §2.2 — `order_daily_counters` table | Task 2 (model) + Task 3 (migration) |
| §2.3 — UNIQUE constraints and INDEX | Task 3 migration + Task 2 `__table_args__` |
| §3 — Asia/Bangkok timezone | Task 4 (`STORE_TZ`, `_business_date()`) |
| §4 — Atomic ON CONFLICT DO UPDATE | Task 5 (service wiring) |
| §5 — `make_receipt_no` Buddhist year format | Task 4 (helper) |
| §6 — `OrderRead` + `PromptPayQRResponse` | Task 6 (schema updates) |
| §7 — Alembic backfill with SQL | Task 3 (migration upgrade) |
| §7 — `downgrade()` | Task 3 (migration downgrade) |
| §9.1 — Daily reset | `test_daily_number_resets_on_new_day` |
| §9.2 — Per-store isolation | `test_per_store_isolation` |
| §9.3 — Concurrency | `test_concurrency_no_duplicate_daily_numbers` |
| §9.4 — Void leaves gap | `test_void_leaves_gap_in_daily_sequence` |
| §9.5 — Backfill correctness | Migration SQL (no pytest test — relies on SQL correctness) |
| §9.6 — Timezone boundary | `test_timezone_boundary` |
| §9.7 — Receipt format | `test_make_receipt_no_format` + `test_make_receipt_no_buddhist_year` |

All requirements covered. No placeholders.

### Notes for the implementer

- **Migration number is `0023`**, not `0020` as stated in the spec — three migrations (`0020`, `0021`, `0022`) landed after the spec was written.
- The `pg_insert` upsert is the recommended mechanism from §4. Do not use the `MAX + FOR UPDATE` alternative.
- `_business_date()` is extracted as a function so tests can `patch("app.services.orders._business_date", ...)` without fighting Python's built-in `datetime` class.
- Existing `order_number` and `order_number_seq` are **untouched** — they remain the global reference used by inventory logs, void logs, and PromptPay QR.
- `receipt_no` has `unique=True` in the ORM model and `uq_orders_receipt_no` in the migration. If a collision somehow occurs (should be impossible given the `(store_id, business_date, daily_number)` unique constraint), Postgres will raise an `IntegrityError` and the transaction rolls back.
