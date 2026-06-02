# Pre-Order Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pre-order system — create/manage pre-orders with customer info and negotiated pricing, ingredient summary with configurable stock threshold warnings, FIFO stock deduction on start, and a persistent per-store shopping list with a printable text endpoint.

**Architecture:** Standalone `pre_orders` module (models, schemas, service, router). Reuses `_deduct_fifo` from `services/orders.py` (signature extended with optional `reason` and `ref_order_id` params). Shopping list is a separate service + router under `/shopping-list`. Both routers require any authenticated store user (BARISTA+).

**Tech Stack:** FastAPI, SQLAlchemy 2.x async, PostgreSQL, Pydantic v2, pytest-asyncio

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `api/app/enums.py` | Add `PreOrderStatus` |
| Modify | `api/app/services/orders.py` | Extend `_deduct_fifo` with optional `reason`, `ref_order_id`, `order_number` |
| Create | `api/app/models/pre_orders.py` | `PreOrder`, `PreOrderItem`, `ShoppingListItem` ORM models |
| Modify | `api/app/models/__init__.py` | Register the three new models |
| Create | `api/alembic/versions/0012_pre_orders.py` | Migration: enum + 3 tables |
| Create | `api/app/schemas/pre_orders.py` | All Pydantic request/response schemas |
| Create | `api/tests/test_pre_orders_api.py` | API integration tests (RED → GREEN) |
| Create | `api/tests/test_shopping_list_api.py` | Shopping list integration tests (RED → GREEN) |
| Create | `api/app/services/pre_orders.py` | Pre-order business logic |
| Create | `api/app/services/shopping_list.py` | Shopping list CRUD |
| Create | `api/app/api/v1/pre_orders.py` | Pre-order HTTP router |
| Create | `api/app/api/v1/shopping_list.py` | Shopping list HTTP router |
| Modify | `api/app/api/v1/router.py` | Register both new routers |

---

## Task 1: Enum + `_deduct_fifo` signature extension

**Files:**
- Modify: `api/app/enums.py`
- Modify: `api/app/services/orders.py`

- [ ] **Step 1: Add `PreOrderStatus` to enums.py**

Append after the `ReceiptStatus` class (line 75):

```python
class PreOrderStatus(str, enum.Enum):
    PENDING = "PENDING"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"
```

- [ ] **Step 2: Extend `_deduct_fifo` in `api/app/services/orders.py`**

Replace the function signature and StockMovement creation (lines 264–316). The new signature makes `ref_order_id`, `order_number`, and `reason` all optional so existing callers (`create_order`) are unaffected:

```python
async def _deduct_fifo(
    db: AsyncSession,
    *,
    store_id: str,
    user_id: str,
    inventory_item_id: str,
    total_qty: Decimal,
    ref_order_id: str | None = None,
    order_number: int = 0,
    reason: str | None = None,
) -> None:
    inv_item = await db.get(InventoryItem, inventory_item_id)
    if not inv_item:
        return

    remaining = total_qty
    lots = list((await db.execute(
        select(StockLot)
        .where(
            StockLot.inventory_item_id == inventory_item_id,
            StockLot.store_id == store_id,
            StockLot.qty_remaining > 0,
        )
        .order_by(StockLot.created_at.asc())
    )).scalars())

    for lot in lots:
        if remaining <= 0:
            break
        consume = min(lot.qty_remaining, remaining)
        lot.qty_remaining = lot.qty_remaining - consume
        remaining -= consume

    inv_item.stock_on_hand = inv_item.stock_on_hand - total_qty
    if inv_item.stock_on_hand < 0:
        logger.warning(
            "inventory.fifo.negative_stock",
            extra={
                "inventory_item_id": inventory_item_id,
                "store_id": store_id,
                "total_qty": float(total_qty),
                "stock_on_hand": float(inv_item.stock_on_hand),
            },
        )

    db.add(StockMovement(
        store_id=store_id,
        inventory_item_id=inventory_item_id,
        type=MovementType.SALE,
        quantity=total_qty,
        reason=reason or f"Order #{order_number}",
        ref_order_id=ref_order_id,
        created_by_id=user_id,
    ))
```

- [ ] **Step 3: Commit**

```bash
git add api/app/enums.py api/app/services/orders.py
git commit -m "feat: add PreOrderStatus enum, extend _deduct_fifo with optional reason/ref params"
```

---

## Task 2: ORM Models

**Files:**
- Create: `api/app/models/pre_orders.py`
- Modify: `api/app/models/__init__.py`

- [ ] **Step 1: Create `api/app/models/pre_orders.py`**

```python
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean, Date, DateTime, Enum as SAEnum, ForeignKey,
    Integer, Numeric, String, Text, UniqueConstraint, func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.types import new_cuid
from app.enums import PreOrderStatus


class PreOrder(Base):
    __tablename__ = "pre_orders"

    id: Mapped[str] = mapped_column(String(24), primary_key=True, default=new_cuid)
    store_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("stores.id", ondelete="CASCADE"), nullable=False, index=True
    )
    order_date: Mapped[date] = mapped_column(Date, nullable=False)
    due_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    customer_id: Mapped[str | None] = mapped_column(
        String(24), ForeignKey("customers.id", ondelete="SET NULL"), nullable=True
    )
    customer_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    customer_phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    deposit_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    deposit_paid: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[PreOrderStatus] = mapped_column(
        SAEnum(PreOrderStatus, name="pre_order_status"),
        nullable=False,
        default=PreOrderStatus.PENDING,
    )
    created_by_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    started_by_id: Mapped[str | None] = mapped_column(
        String(24), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    completed_by_id: Mapped[str | None] = mapped_column(
        String(24), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class PreOrderItem(Base):
    __tablename__ = "pre_order_items"

    id: Mapped[str] = mapped_column(String(24), primary_key=True, default=new_cuid)
    pre_order_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("pre_orders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_id: Mapped[str | None] = mapped_column(
        String(24), ForeignKey("products.id", ondelete="SET NULL"), nullable=True
    )
    product_name: Mapped[str] = mapped_column(String(200), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    line_total: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)


class ShoppingListItem(Base):
    __tablename__ = "shopping_list_items"
    __table_args__ = (
        UniqueConstraint("store_id", "inventory_item_id", name="uq_shopping_list_store_item"),
    )

    id: Mapped[str] = mapped_column(String(24), primary_key=True, default=new_cuid)
    store_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("stores.id", ondelete="CASCADE"), nullable=False, index=True
    )
    inventory_item_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("inventory_items.id", ondelete="CASCADE"), nullable=False
    )
    added_by_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    note: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
```

- [ ] **Step 2: Register models in `api/app/models/__init__.py`**

Add import line after the receipts import:

```python
from app.models.pre_orders import PreOrder, PreOrderItem, ShoppingListItem
```

Add to `__all__`:

```python
"PreOrder",
"PreOrderItem",
"ShoppingListItem",
```

- [ ] **Step 3: Commit**

```bash
git add api/app/models/pre_orders.py api/app/models/__init__.py
git commit -m "feat: add PreOrder, PreOrderItem, ShoppingListItem ORM models"
```

---

## Task 3: Alembic Migration

**Files:**
- Create: `api/alembic/versions/0012_pre_orders.py`

- [ ] **Step 1: Create `api/alembic/versions/0012_pre_orders.py`**

```python
"""pre-orders and shopping list

Revision ID: 0012
Revises: 0011
Create Date: 2026-05-14
"""
from alembic import op
import sqlalchemy as sa

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None

pre_order_status = sa.Enum("PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED", name="pre_order_status")


def upgrade() -> None:
    pre_order_status.create(op.get_bind())

    op.create_table(
        "pre_orders",
        sa.Column("id", sa.String(24), primary_key=True),
        sa.Column("store_id", sa.String(24), sa.ForeignKey("stores.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("order_date", sa.Date, nullable=False),
        sa.Column("due_date", sa.Date, nullable=False, index=True),
        sa.Column("customer_id", sa.String(24), sa.ForeignKey("customers.id", ondelete="SET NULL"), nullable=True),
        sa.Column("customer_name", sa.String(120), nullable=True),
        sa.Column("customer_phone", sa.String(30), nullable=True),
        sa.Column("deposit_amount", sa.Numeric(12, 2), nullable=True),
        sa.Column("deposit_paid", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("status", sa.Enum("PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED", name="pre_order_status", create_type=False), nullable=False, server_default="PENDING"),
        sa.Column("created_by_id", sa.String(24), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("started_by_id", sa.String(24), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("completed_by_id", sa.String(24), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "pre_order_items",
        sa.Column("id", sa.String(24), primary_key=True),
        sa.Column("pre_order_id", sa.String(24), sa.ForeignKey("pre_orders.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("product_id", sa.String(24), sa.ForeignKey("products.id", ondelete="SET NULL"), nullable=True),
        sa.Column("product_name", sa.String(200), nullable=False),
        sa.Column("quantity", sa.Integer, nullable=False),
        sa.Column("unit_price", sa.Numeric(12, 2), nullable=False),
        sa.Column("line_total", sa.Numeric(12, 2), nullable=False),
    )

    op.create_table(
        "shopping_list_items",
        sa.Column("id", sa.String(24), primary_key=True),
        sa.Column("store_id", sa.String(24), sa.ForeignKey("stores.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("inventory_item_id", sa.String(24), sa.ForeignKey("inventory_items.id", ondelete="CASCADE"), nullable=False),
        sa.Column("added_by_id", sa.String(24), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("note", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("store_id", "inventory_item_id", name="uq_shopping_list_store_item"),
    )


def downgrade() -> None:
    op.drop_table("shopping_list_items")
    op.drop_table("pre_order_items")
    op.drop_table("pre_orders")
    pre_order_status.drop(op.get_bind())
```

- [ ] **Step 2: Commit (skip `alembic upgrade head` if no local DB — Railway auto-migrates on deploy)**

```bash
git add api/alembic/versions/0012_pre_orders.py
git commit -m "feat: migration 0012 — pre_orders, pre_order_items, shopping_list_items tables"
```

---

## Task 4: Pydantic Schemas

**Files:**
- Create: `api/app/schemas/pre_orders.py`

- [ ] **Step 1: Create `api/app/schemas/pre_orders.py`**

```python
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class _Cfg(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------- Pre-Order Item ----------

class PreOrderItemIn(BaseModel):
    product_id: str | None = None
    product_name: str | None = Field(None, max_length=200)
    quantity: int = Field(ge=1)
    unit_price: Decimal | None = Field(None, ge=0)


class PreOrderItemRead(_Cfg):
    id: str
    product_id: str | None
    product_name: str
    quantity: int
    unit_price: Decimal
    line_total: Decimal


# ---------- Pre-Order ----------

class PreOrderCreate(BaseModel):
    order_date: date
    due_date: date
    customer_id: str | None = None
    customer_name: str | None = Field(None, max_length=120)
    customer_phone: str | None = Field(None, max_length=30)
    deposit_amount: Decimal | None = Field(None, ge=0)
    deposit_paid: bool = False
    notes: str | None = None
    items: list[PreOrderItemIn] = Field(min_length=1)


class PreOrderUpdate(BaseModel):
    order_date: date | None = None
    due_date: date | None = None
    customer_id: str | None = None
    customer_name: str | None = Field(None, max_length=120)
    customer_phone: str | None = Field(None, max_length=30)
    deposit_amount: Decimal | None = Field(None, ge=0)
    deposit_paid: bool | None = None
    notes: str | None = None


class PreOrderRead(_Cfg):
    id: str
    store_id: str
    order_date: date
    due_date: date
    customer_id: str | None
    customer_name: str | None
    customer_phone: str | None
    deposit_amount: Decimal | None
    deposit_paid: bool
    notes: str | None
    status: str
    created_by_id: str
    started_by_id: str | None
    completed_by_id: str | None
    started_at: datetime | None
    completed_at: datetime | None
    items: list[PreOrderItemRead]
    created_at: datetime
    updated_at: datetime


class PreOrderSummary(_Cfg):
    id: str
    order_date: date
    due_date: date
    customer_name: str | None
    customer_phone: str | None
    status: str
    item_count: int
    created_at: datetime


class PreOrdersPage(BaseModel):
    items: list[PreOrderSummary]
    total: int


# ---------- Ingredient Summary ----------

class IngredientSummaryItem(BaseModel):
    inventory_item_id: str
    name: str
    unit: str
    qty_needed: Decimal
    stock_on_hand: Decimal
    usage_pct: float | None
    exceeds_threshold: bool
    on_shopping_list: bool


class IngredientSummary(BaseModel):
    items: list[IngredientSummaryItem]
    threshold: float


# ---------- Shopping List ----------

class ShoppingListItemCreate(BaseModel):
    inventory_item_id: str
    note: str | None = Field(None, max_length=255)


class ShoppingListItemRead(_Cfg):
    id: str
    inventory_item_id: str
    inventory_item_name: str
    unit: str
    note: str | None
    added_by_id: str
    created_at: datetime
```

- [ ] **Step 2: Commit**

```bash
git add api/app/schemas/pre_orders.py
git commit -m "feat: pre-order Pydantic schemas"
```

---

## Task 5: Write Failing Tests (RED)

**Files:**
- Create: `api/tests/test_pre_orders_api.py`
- Create: `api/tests/test_shopping_list_api.py`

- [ ] **Step 1: Create `api/tests/test_pre_orders_api.py`**

```python
from datetime import date, timedelta
from decimal import Decimal

import pytest

from tests.conftest import make_category, make_item, make_product
from app.models.catalog import RecipeItem


async def _login(client, store_slug: str, pin: str) -> str:
    resp = await client.post("/api/v1/auth/login", json={"store_slug": store_slug, "pin": pin})
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _today() -> str:
    return date.today().isoformat()


def _due(days: int = 7) -> str:
    return (date.today() + timedelta(days=days)).isoformat()


async def _make_product_with_recipe(db, store_id):
    """Helper: product linked to one inventory item via recipe."""
    cat = await make_category(db, store_id=store_id, name=f"Cat-{id(db)}")
    item = await make_item(db, store_id=store_id, name=f"Flour-{id(db)}", unit="g", stock=Decimal("5000"))
    product = await make_product(db, store_id=store_id, name=f"Cake-{id(db)}", price=Decimal("150.00"), category_id=cat.id)
    db.add(RecipeItem(product_id=product.id, inventory_item_id=item.id, quantity=Decimal("200")))
    await db.commit()
    return product, item


async def test_create_pre_order_inline_customer(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    product, _ = await _make_product_with_recipe(db, store_a.id)

    resp = await client.post("/api/v1/pre-orders", headers=_h(token), json={
        "order_date": _today(),
        "due_date": _due(),
        "customer_name": "Alice",
        "customer_phone": "0812345678",
        "items": [{"product_id": product.id, "quantity": 2}],
    })
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["status"] == "PENDING"
    assert data["customer_name"] == "Alice"
    assert len(data["items"]) == 1
    assert Decimal(data["items"][0]["unit_price"]) == Decimal("150.00")
    assert Decimal(data["items"][0]["line_total"]) == Decimal("300.00")


async def test_create_pre_order_negotiated_price(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    product, _ = await _make_product_with_recipe(db, store_a.id)

    resp = await client.post("/api/v1/pre-orders", headers=_h(token), json={
        "order_date": _today(),
        "due_date": _due(),
        "customer_name": "Bob",
        "customer_phone": "0899999999",
        "items": [{"product_id": product.id, "quantity": 10, "unit_price": "120.00"}],
    })
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert Decimal(data["items"][0]["unit_price"]) == Decimal("120.00")
    assert Decimal(data["items"][0]["line_total"]) == Decimal("1200.00")


async def test_create_pre_order_requires_customer(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    product, _ = await _make_product_with_recipe(db, store_a.id)

    resp = await client.post("/api/v1/pre-orders", headers=_h(token), json={
        "order_date": _today(),
        "due_date": _due(),
        "items": [{"product_id": product.id, "quantity": 1}],
    })
    assert resp.status_code == 422
    assert resp.json()["error"]["message"] == "CUSTOMER_REQUIRED"


async def test_list_pre_orders_ordered_by_due_date(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    product, _ = await _make_product_with_recipe(db, store_a.id)

    base = {"order_date": _today(), "customer_name": "X", "customer_phone": "111",
            "items": [{"product_id": product.id, "quantity": 1}]}

    await client.post("/api/v1/pre-orders", headers=_h(token), json={**base, "due_date": _due(10)})
    await client.post("/api/v1/pre-orders", headers=_h(token), json={**base, "due_date": _due(3)})
    await client.post("/api/v1/pre-orders", headers=_h(token), json={**base, "due_date": _due(7)})

    resp = await client.get("/api/v1/pre-orders", headers=_h(token))
    assert resp.status_code == 200
    due_dates = [r["due_date"] for r in resp.json()["items"]]
    assert due_dates == sorted(due_dates)


async def test_get_pre_order(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    product, _ = await _make_product_with_recipe(db, store_a.id)

    create_resp = await client.post("/api/v1/pre-orders", headers=_h(token), json={
        "order_date": _today(), "due_date": _due(),
        "customer_name": "C", "customer_phone": "222",
        "items": [{"product_id": product.id, "quantity": 1}],
    })
    po_id = create_resp.json()["id"]

    resp = await client.get(f"/api/v1/pre-orders/{po_id}", headers=_h(token))
    assert resp.status_code == 200
    assert resp.json()["id"] == po_id


async def test_patch_pre_order(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    product, _ = await _make_product_with_recipe(db, store_a.id)

    create_resp = await client.post("/api/v1/pre-orders", headers=_h(token), json={
        "order_date": _today(), "due_date": _due(),
        "customer_name": "Old", "customer_phone": "000",
        "items": [{"product_id": product.id, "quantity": 1}],
    })
    po_id = create_resp.json()["id"]

    resp = await client.patch(f"/api/v1/pre-orders/{po_id}", headers=_h(token),
                              json={"customer_name": "New", "deposit_amount": "500.00", "deposit_paid": True})
    assert resp.status_code == 200
    assert resp.json()["customer_name"] == "New"
    assert Decimal(resp.json()["deposit_amount"]) == Decimal("500.00")
    assert resp.json()["deposit_paid"] is True


async def test_add_and_remove_item(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    product, _ = await _make_product_with_recipe(db, store_a.id)
    product2, _ = await _make_product_with_recipe(db, store_a.id)

    create_resp = await client.post("/api/v1/pre-orders", headers=_h(token), json={
        "order_date": _today(), "due_date": _due(),
        "customer_name": "D", "customer_phone": "333",
        "items": [{"product_id": product.id, "quantity": 1}],
    })
    po_id = create_resp.json()["id"]

    add_resp = await client.post(f"/api/v1/pre-orders/{po_id}/items", headers=_h(token),
                                 json={"product_id": product2.id, "quantity": 3})
    assert add_resp.status_code == 201
    assert len(add_resp.json()["items"]) == 2

    item_id = add_resp.json()["items"][1]["id"]
    del_resp = await client.delete(f"/api/v1/pre-orders/{po_id}/items/{item_id}", headers=_h(token))
    assert del_resp.status_code == 200
    assert len(del_resp.json()["items"]) == 1


async def test_ingredient_summary(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    product, item = await _make_product_with_recipe(db, store_a.id)

    create_resp = await client.post("/api/v1/pre-orders", headers=_h(token), json={
        "order_date": _today(), "due_date": _due(),
        "customer_name": "E", "customer_phone": "444",
        "items": [{"product_id": product.id, "quantity": 5}],
    })
    po_id = create_resp.json()["id"]

    # 5 items × 200g = 1000g needed; stock = 5000g; usage = 20%
    resp = await client.get(f"/api/v1/pre-orders/{po_id}/ingredients?threshold=50", headers=_h(token))
    assert resp.status_code == 200
    data = resp.json()
    assert data["threshold"] == 50
    assert len(data["items"]) == 1
    ing = data["items"][0]
    assert ing["inventory_item_id"] == item.id
    assert Decimal(ing["qty_needed"]) == Decimal("1000")
    assert ing["exceeds_threshold"] is False
    assert ing["on_shopping_list"] is False


async def test_ingredient_summary_exceeds_threshold(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    product, item = await _make_product_with_recipe(db, store_a.id)

    create_resp = await client.post("/api/v1/pre-orders", headers=_h(token), json={
        "order_date": _today(), "due_date": _due(),
        "customer_name": "F", "customer_phone": "555",
        "items": [{"product_id": product.id, "quantity": 20}],
    })
    po_id = create_resp.json()["id"]

    # 20 × 200g = 4000g needed; stock = 5000g; usage = 80% > 50% threshold
    resp = await client.get(f"/api/v1/pre-orders/{po_id}/ingredients?threshold=50", headers=_h(token))
    assert resp.json()["items"][0]["exceeds_threshold"] is True


async def test_start_order_deducts_stock(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    product, item = await _make_product_with_recipe(db, store_a.id)

    create_resp = await client.post("/api/v1/pre-orders", headers=_h(token), json={
        "order_date": _today(), "due_date": _due(),
        "customer_name": "G", "customer_phone": "666",
        "items": [{"product_id": product.id, "quantity": 3}],
    })
    po_id = create_resp.json()["id"]

    resp = await client.post(f"/api/v1/pre-orders/{po_id}/start", headers=_h(token))
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "IN_PROGRESS"

    inv_resp = await client.get(f"/api/v1/inventory/{item.id}", headers=_h(token))
    # 3 items × 200g = 600g deducted from 5000g
    assert Decimal(inv_resp.json()["stock_on_hand"]) == Decimal("4400.000")


async def test_start_blocks_if_already_started(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    product, _ = await _make_product_with_recipe(db, store_a.id)

    create_resp = await client.post("/api/v1/pre-orders", headers=_h(token), json={
        "order_date": _today(), "due_date": _due(),
        "customer_name": "H", "customer_phone": "777",
        "items": [{"product_id": product.id, "quantity": 1}],
    })
    po_id = create_resp.json()["id"]
    await client.post(f"/api/v1/pre-orders/{po_id}/start", headers=_h(token))

    resp = await client.post(f"/api/v1/pre-orders/{po_id}/start", headers=_h(token))
    assert resp.status_code == 409
    assert resp.json()["error"]["message"] == "PRE_ORDER_ALREADY_STARTED"


async def test_complete_order(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    product, _ = await _make_product_with_recipe(db, store_a.id)

    create_resp = await client.post("/api/v1/pre-orders", headers=_h(token), json={
        "order_date": _today(), "due_date": _due(),
        "customer_name": "I", "customer_phone": "888",
        "items": [{"product_id": product.id, "quantity": 1}],
    })
    po_id = create_resp.json()["id"]
    await client.post(f"/api/v1/pre-orders/{po_id}/start", headers=_h(token))

    resp = await client.post(f"/api/v1/pre-orders/{po_id}/complete", headers=_h(token))
    assert resp.status_code == 200
    assert resp.json()["status"] == "COMPLETED"


async def test_cancel_pending(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    product, _ = await _make_product_with_recipe(db, store_a.id)

    create_resp = await client.post("/api/v1/pre-orders", headers=_h(token), json={
        "order_date": _today(), "due_date": _due(),
        "customer_name": "J", "customer_phone": "999",
        "items": [{"product_id": product.id, "quantity": 1}],
    })
    po_id = create_resp.json()["id"]

    resp = await client.post(f"/api/v1/pre-orders/{po_id}/cancel", headers=_h(token))
    assert resp.status_code == 200
    assert resp.json()["status"] == "CANCELLED"


async def test_cancel_blocked_after_start(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    product, _ = await _make_product_with_recipe(db, store_a.id)

    create_resp = await client.post("/api/v1/pre-orders", headers=_h(token), json={
        "order_date": _today(), "due_date": _due(),
        "customer_name": "K", "customer_phone": "101",
        "items": [{"product_id": product.id, "quantity": 1}],
    })
    po_id = create_resp.json()["id"]
    await client.post(f"/api/v1/pre-orders/{po_id}/start", headers=_h(token))

    resp = await client.post(f"/api/v1/pre-orders/{po_id}/cancel", headers=_h(token))
    assert resp.status_code == 422
    assert resp.json()["error"]["message"] == "PRE_ORDER_NOT_PENDING"


async def test_edit_blocked_after_start(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    product, _ = await _make_product_with_recipe(db, store_a.id)

    create_resp = await client.post("/api/v1/pre-orders", headers=_h(token), json={
        "order_date": _today(), "due_date": _due(),
        "customer_name": "L", "customer_phone": "202",
        "items": [{"product_id": product.id, "quantity": 1}],
    })
    po_id = create_resp.json()["id"]
    await client.post(f"/api/v1/pre-orders/{po_id}/start", headers=_h(token))

    resp = await client.patch(f"/api/v1/pre-orders/{po_id}", headers=_h(token),
                              json={"customer_name": "Changed"})
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "PRE_ORDER_NOT_PENDING"
```

- [ ] **Step 2: Create `api/tests/test_shopping_list_api.py`**

```python
import pytest

from tests.conftest import make_item


async def _login(client, store_slug: str, pin: str) -> str:
    resp = await client.post("/api/v1/auth/login", json={"store_slug": store_slug, "pin": pin})
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def test_add_to_shopping_list(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    item = await make_item(db, store_id=store_a.id, name="Sugar-SL")

    resp = await client.post("/api/v1/shopping-list", headers=_h(token),
                             json={"inventory_item_id": item.id, "note": "buy 5kg"})
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["inventory_item_id"] == item.id
    assert data["note"] == "buy 5kg"


async def test_add_idempotent(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    item = await make_item(db, store_id=store_a.id, name="Butter-SL")

    r1 = await client.post("/api/v1/shopping-list", headers=_h(token),
                           json={"inventory_item_id": item.id})
    r2 = await client.post("/api/v1/shopping-list", headers=_h(token),
                           json={"inventory_item_id": item.id})
    assert r1.status_code == 201
    assert r2.status_code == 200
    assert r1.json()["id"] == r2.json()["id"]


async def test_list_shopping_list(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    item = await make_item(db, store_id=store_a.id, name="Eggs-SL")
    await client.post("/api/v1/shopping-list", headers=_h(token),
                      json={"inventory_item_id": item.id})

    resp = await client.get("/api/v1/shopping-list", headers=_h(token))
    assert resp.status_code == 200
    ids = [r["inventory_item_id"] for r in resp.json()]
    assert item.id in ids


async def test_remove_from_shopping_list(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    item = await make_item(db, store_id=store_a.id, name="Salt-SL")

    add_resp = await client.post("/api/v1/shopping-list", headers=_h(token),
                                 json={"inventory_item_id": item.id})
    sl_id = add_resp.json()["id"]

    del_resp = await client.delete(f"/api/v1/shopping-list/{sl_id}", headers=_h(token))
    assert del_resp.status_code == 204

    list_resp = await client.get("/api/v1/shopping-list", headers=_h(token))
    ids = [r["inventory_item_id"] for r in list_resp.json()]
    assert item.id not in ids


async def test_print_shopping_list(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    item = await make_item(db, store_id=store_a.id, name="Milk-Print", unit="L")
    await client.post("/api/v1/shopping-list", headers=_h(token),
                      json={"inventory_item_id": item.id, "note": "get 10L"})

    resp = await client.get("/api/v1/shopping-list/print", headers=_h(token))
    assert resp.status_code == 200
    assert "text/plain" in resp.headers["content-type"]
    assert "Milk-Print" in resp.text


async def test_shopping_list_isolated_by_store(client, db, store_a, store_b, user_a, user_b):
    token_a = await _login(client, store_a.slug, "1111")
    token_b = await _login(client, store_b.slug, "9999")
    item_a = await make_item(db, store_id=store_a.id, name="StoreA-Item-SL")

    await client.post("/api/v1/shopping-list", headers=_h(token_a),
                      json={"inventory_item_id": item_a.id})

    resp_b = await client.get("/api/v1/shopping-list", headers=_h(token_b))
    ids_b = [r["inventory_item_id"] for r in resp_b.json()]
    assert item_a.id not in ids_b
```

- [ ] **Step 3: Commit the failing tests**

```bash
git add api/tests/test_pre_orders_api.py api/tests/test_shopping_list_api.py
git commit -m "test: pre-order and shopping list API tests (RED)"
```

---

## Task 6: Pre-Order Service

**Files:**
- Create: `api/app/services/pre_orders.py`

- [ ] **Step 1: Create `api/app/services/pre_orders.py`**

```python
import logging
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Conflict, NotFound, Unprocessable
from app.enums import PreOrderStatus
from app.models.catalog import Product, RecipeItem
from app.models.inventory import InventoryItem
from app.models.pre_orders import PreOrder, PreOrderItem, ShoppingListItem
from app.schemas.pre_orders import (
    IngredientSummary,
    IngredientSummaryItem,
    PreOrderCreate,
    PreOrderItemRead,
    PreOrderRead,
    PreOrderSummary,
    PreOrderUpdate,
    PreOrdersPage,
)
from app.services.orders import _deduct_fifo

logger = logging.getLogger(__name__)

_DEFAULT_PAGE = 50
_MAX_PAGE = 200


async def create_pre_order(
    db: AsyncSession,
    *,
    store_id: str,
    user_id: str,
    payload: PreOrderCreate,
) -> PreOrderRead:
    if not payload.customer_id and not (payload.customer_name and payload.customer_phone):
        raise Unprocessable("CUSTOMER_REQUIRED")

    async with db.begin():
        pre_order = PreOrder(
            store_id=store_id,
            order_date=payload.order_date,
            due_date=payload.due_date,
            customer_id=payload.customer_id,
            customer_name=payload.customer_name,
            customer_phone=payload.customer_phone,
            deposit_amount=payload.deposit_amount,
            deposit_paid=payload.deposit_paid,
            notes=payload.notes,
            status=PreOrderStatus.PENDING,
            created_by_id=user_id,
        )
        db.add(pre_order)
        await db.flush()

        for item_in in payload.items:
            unit_price = item_in.unit_price
            product_name = item_in.product_name or ""

            if item_in.product_id:
                product = (await db.execute(
                    select(Product).where(
                        Product.id == item_in.product_id,
                        Product.store_id == store_id,
                        Product.is_active.is_(True),
                    )
                )).scalar_one_or_none()
                if not product:
                    raise NotFound(f"Product {item_in.product_id} not found or inactive")
                product_name = product.name
                if unit_price is None:
                    unit_price = product.price

            if unit_price is None:
                unit_price = Decimal("0")

            db.add(PreOrderItem(
                pre_order_id=pre_order.id,
                product_id=item_in.product_id,
                product_name=product_name,
                quantity=item_in.quantity,
                unit_price=unit_price,
                line_total=unit_price * item_in.quantity,
            ))

    return await _pre_order_to_read(db, pre_order)


async def list_pre_orders(
    db: AsyncSession,
    *,
    store_id: str,
    status: PreOrderStatus | None = None,
    page: int = 1,
    limit: int = _DEFAULT_PAGE,
) -> PreOrdersPage:
    if limit <= 0 or limit > _MAX_PAGE:
        limit = _DEFAULT_PAGE
    offset = (max(page, 1) - 1) * limit

    item_count_subq = (
        select(PreOrderItem.pre_order_id, func.count(PreOrderItem.id).label("cnt"))
        .group_by(PreOrderItem.pre_order_id)
        .subquery()
    )
    stmt = (
        select(PreOrder, func.coalesce(item_count_subq.c.cnt, 0).label("item_count"))
        .outerjoin(item_count_subq, item_count_subq.c.pre_order_id == PreOrder.id)
        .where(PreOrder.store_id == store_id)
        .order_by(PreOrder.due_date.asc())
    )
    if status:
        stmt = stmt.where(PreOrder.status == status)

    total_stmt = select(func.count()).select_from(
        select(PreOrder).where(PreOrder.store_id == store_id).subquery()
    )
    if status:
        total_stmt = select(func.count()).select_from(
            select(PreOrder).where(PreOrder.store_id == store_id, PreOrder.status == status).subquery()
        )

    total = (await db.execute(total_stmt)).scalar_one()
    rows = list((await db.execute(stmt.offset(offset).limit(limit))).all())

    items = [
        PreOrderSummary(
            id=po.id,
            order_date=po.order_date,
            due_date=po.due_date,
            customer_name=po.customer_name,
            customer_phone=po.customer_phone,
            status=po.status.value,
            item_count=cnt,
            created_at=po.created_at,
        )
        for po, cnt in rows
    ]
    return PreOrdersPage(items=items, total=total)


async def get_pre_order(
    db: AsyncSession, *, store_id: str, pre_order_id: str
) -> PreOrderRead:
    pre_order = await _load_pre_order(db, store_id=store_id, pre_order_id=pre_order_id)
    return await _pre_order_to_read(db, pre_order)


async def update_pre_order(
    db: AsyncSession,
    *,
    store_id: str,
    pre_order_id: str,
    payload: PreOrderUpdate,
) -> PreOrderRead:
    async with db.begin():
        pre_order = await _load_pre_order(db, store_id=store_id, pre_order_id=pre_order_id)
        _require_pending(pre_order)

        if payload.order_date is not None:
            pre_order.order_date = payload.order_date
        if payload.due_date is not None:
            pre_order.due_date = payload.due_date
        if payload.customer_id is not None:
            pre_order.customer_id = payload.customer_id
        if payload.customer_name is not None:
            pre_order.customer_name = payload.customer_name
        if payload.customer_phone is not None:
            pre_order.customer_phone = payload.customer_phone
        if payload.deposit_amount is not None:
            pre_order.deposit_amount = payload.deposit_amount
        if payload.deposit_paid is not None:
            pre_order.deposit_paid = payload.deposit_paid
        if payload.notes is not None:
            pre_order.notes = payload.notes

    return await _pre_order_to_read(db, pre_order)


async def add_item(
    db: AsyncSession,
    *,
    store_id: str,
    pre_order_id: str,
    item_in,
) -> PreOrderRead:
    async with db.begin():
        pre_order = await _load_pre_order(db, store_id=store_id, pre_order_id=pre_order_id)
        _require_pending(pre_order)

        unit_price = item_in.unit_price
        product_name = item_in.product_name or ""

        if item_in.product_id:
            product = (await db.execute(
                select(Product).where(
                    Product.id == item_in.product_id,
                    Product.store_id == store_id,
                    Product.is_active.is_(True),
                )
            )).scalar_one_or_none()
            if not product:
                raise NotFound(f"Product {item_in.product_id} not found or inactive")
            product_name = product.name
            if unit_price is None:
                unit_price = product.price

        if unit_price is None:
            unit_price = Decimal("0")

        db.add(PreOrderItem(
            pre_order_id=pre_order.id,
            product_id=item_in.product_id,
            product_name=product_name,
            quantity=item_in.quantity,
            unit_price=unit_price,
            line_total=unit_price * item_in.quantity,
        ))

    return await _pre_order_to_read(db, pre_order)


async def remove_item(
    db: AsyncSession,
    *,
    store_id: str,
    pre_order_id: str,
    item_id: str,
) -> PreOrderRead:
    async with db.begin():
        pre_order = await _load_pre_order(db, store_id=store_id, pre_order_id=pre_order_id)
        _require_pending(pre_order)

        poi = (await db.execute(
            select(PreOrderItem).where(
                PreOrderItem.id == item_id,
                PreOrderItem.pre_order_id == pre_order_id,
            )
        )).scalar_one_or_none()
        if poi is None:
            raise NotFound("PRE_ORDER_ITEM_NOT_FOUND")
        await db.delete(poi)

    return await _pre_order_to_read(db, pre_order)


async def get_ingredient_summary(
    db: AsyncSession,
    *,
    store_id: str,
    pre_order_id: str,
    threshold: float = 50.0,
) -> IngredientSummary:
    await _load_pre_order(db, store_id=store_id, pre_order_id=pre_order_id)

    aggregated = await _aggregate_ingredients(db, pre_order_id=pre_order_id)

    sl_ids = set((await db.execute(
        select(ShoppingListItem.inventory_item_id).where(ShoppingListItem.store_id == store_id)
    )).scalars())

    result: list[IngredientSummaryItem] = []
    for inv_item_id, qty_needed in aggregated.items():
        inv_item = await db.get(InventoryItem, inv_item_id)
        if not inv_item:
            continue
        if inv_item.stock_on_hand > 0:
            usage_pct: float | None = float(qty_needed / inv_item.stock_on_hand * 100)
            exceeds = usage_pct > threshold
        else:
            usage_pct = None
            exceeds = True
        result.append(IngredientSummaryItem(
            inventory_item_id=inv_item_id,
            name=inv_item.name,
            unit=inv_item.unit,
            qty_needed=qty_needed,
            stock_on_hand=inv_item.stock_on_hand,
            usage_pct=usage_pct,
            exceeds_threshold=exceeds,
            on_shopping_list=inv_item_id in sl_ids,
        ))

    return IngredientSummary(items=result, threshold=threshold)


async def start_pre_order(
    db: AsyncSession,
    *,
    store_id: str,
    user_id: str,
    pre_order_id: str,
) -> PreOrderRead:
    async with db.begin():
        pre_order = await _load_pre_order(db, store_id=store_id, pre_order_id=pre_order_id)
        if pre_order.status != PreOrderStatus.PENDING:
            raise Conflict("PRE_ORDER_ALREADY_STARTED")

        aggregated = await _aggregate_ingredients(db, pre_order_id=pre_order_id)
        if not aggregated:
            raise Unprocessable("PRE_ORDER_NO_ITEMS")

        for inv_item_id, qty in aggregated.items():
            await _deduct_fifo(
                db,
                store_id=store_id,
                user_id=user_id,
                inventory_item_id=inv_item_id,
                total_qty=qty,
                reason=f"Pre-order {pre_order_id[:8]}",
            )

        pre_order.status = PreOrderStatus.IN_PROGRESS
        pre_order.started_by_id = user_id
        pre_order.started_at = datetime.now(timezone.utc)

    return await _pre_order_to_read(db, pre_order)


async def complete_pre_order(
    db: AsyncSession,
    *,
    store_id: str,
    user_id: str,
    pre_order_id: str,
) -> PreOrderRead:
    async with db.begin():
        pre_order = await _load_pre_order(db, store_id=store_id, pre_order_id=pre_order_id)
        if pre_order.status != PreOrderStatus.IN_PROGRESS:
            raise Unprocessable("PRE_ORDER_NOT_IN_PROGRESS")
        pre_order.status = PreOrderStatus.COMPLETED
        pre_order.completed_by_id = user_id
        pre_order.completed_at = datetime.now(timezone.utc)

    return await _pre_order_to_read(db, pre_order)


async def cancel_pre_order(
    db: AsyncSession,
    *,
    store_id: str,
    pre_order_id: str,
) -> PreOrderRead:
    async with db.begin():
        pre_order = await _load_pre_order(db, store_id=store_id, pre_order_id=pre_order_id)
        _require_pending(pre_order)
        pre_order.status = PreOrderStatus.CANCELLED

    return await _pre_order_to_read(db, pre_order)


# -- helpers ------------------------------------------------------------------


async def _load_pre_order(
    db: AsyncSession, *, store_id: str, pre_order_id: str
) -> PreOrder:
    po = (await db.execute(
        select(PreOrder).where(PreOrder.id == pre_order_id, PreOrder.store_id == store_id)
    )).scalar_one_or_none()
    if po is None:
        raise NotFound("PRE_ORDER_NOT_FOUND")
    return po


def _require_pending(pre_order: PreOrder) -> None:
    if pre_order.status != PreOrderStatus.PENDING:
        raise Unprocessable("PRE_ORDER_NOT_PENDING")


async def _aggregate_ingredients(
    db: AsyncSession, *, pre_order_id: str
) -> dict[str, Decimal]:
    items = list((await db.execute(
        select(PreOrderItem).where(PreOrderItem.pre_order_id == pre_order_id)
    )).scalars())

    aggregated: dict[str, Decimal] = {}
    for item in items:
        if not item.product_id:
            continue
        recipe_items = list((await db.execute(
            select(RecipeItem).where(RecipeItem.product_id == item.product_id)
        )).scalars())
        for ri in recipe_items:
            qty = ri.quantity * item.quantity
            aggregated[ri.inventory_item_id] = (
                aggregated.get(ri.inventory_item_id, Decimal("0")) + qty
            )
    return aggregated


async def _pre_order_to_read(db: AsyncSession, pre_order: PreOrder) -> PreOrderRead:
    items = list((await db.execute(
        select(PreOrderItem).where(PreOrderItem.pre_order_id == pre_order.id)
    )).scalars())
    return PreOrderRead(
        id=pre_order.id,
        store_id=pre_order.store_id,
        order_date=pre_order.order_date,
        due_date=pre_order.due_date,
        customer_id=pre_order.customer_id,
        customer_name=pre_order.customer_name,
        customer_phone=pre_order.customer_phone,
        deposit_amount=pre_order.deposit_amount,
        deposit_paid=pre_order.deposit_paid,
        notes=pre_order.notes,
        status=pre_order.status.value,
        created_by_id=pre_order.created_by_id,
        started_by_id=pre_order.started_by_id,
        completed_by_id=pre_order.completed_by_id,
        started_at=pre_order.started_at,
        completed_at=pre_order.completed_at,
        items=[PreOrderItemRead.model_validate(i) for i in items],
        created_at=pre_order.created_at,
        updated_at=pre_order.updated_at,
    )
```

- [ ] **Step 2: Commit**

```bash
git add api/app/services/pre_orders.py
git commit -m "feat: pre-order service"
```

---

## Task 7: Shopping List Service

**Files:**
- Create: `api/app/services/shopping_list.py`

- [ ] **Step 1: Create `api/app/services/shopping_list.py`**

```python
from fastapi.responses import PlainTextResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFound
from app.models.inventory import InventoryItem
from app.models.pre_orders import ShoppingListItem
from app.schemas.pre_orders import ShoppingListItemCreate, ShoppingListItemRead


async def list_shopping_list(
    db: AsyncSession, *, store_id: str
) -> list[ShoppingListItemRead]:
    rows = list((await db.execute(
        select(ShoppingListItem, InventoryItem.name, InventoryItem.unit)
        .join(InventoryItem, InventoryItem.id == ShoppingListItem.inventory_item_id)
        .where(ShoppingListItem.store_id == store_id)
        .order_by(ShoppingListItem.created_at.asc())
    )).all())
    return [
        ShoppingListItemRead(
            id=sl.id,
            inventory_item_id=sl.inventory_item_id,
            inventory_item_name=name,
            unit=unit,
            note=sl.note,
            added_by_id=sl.added_by_id,
            created_at=sl.created_at,
        )
        for sl, name, unit in rows
    ]


async def add_to_shopping_list(
    db: AsyncSession,
    *,
    store_id: str,
    user_id: str,
    payload: ShoppingListItemCreate,
) -> tuple[ShoppingListItemRead, bool]:
    existing = (await db.execute(
        select(ShoppingListItem).where(
            ShoppingListItem.store_id == store_id,
            ShoppingListItem.inventory_item_id == payload.inventory_item_id,
        )
    )).scalar_one_or_none()

    if existing:
        return await _sl_to_read(db, existing), False

    async with db.begin():
        sl = ShoppingListItem(
            store_id=store_id,
            inventory_item_id=payload.inventory_item_id,
            added_by_id=user_id,
            note=payload.note,
        )
        db.add(sl)

    return await _sl_to_read(db, sl), True


async def remove_from_shopping_list(
    db: AsyncSession, *, store_id: str, item_id: str
) -> None:
    sl = (await db.execute(
        select(ShoppingListItem).where(
            ShoppingListItem.id == item_id,
            ShoppingListItem.store_id == store_id,
        )
    )).scalar_one_or_none()
    if sl is None:
        raise NotFound("SHOPPING_LIST_ITEM_NOT_FOUND")
    async with db.begin():
        await db.delete(sl)


async def print_shopping_list(
    db: AsyncSession, *, store_id: str
) -> PlainTextResponse:
    items = await list_shopping_list(db, store_id=store_id)
    if not items:
        return PlainTextResponse("Shopping list is empty.\n")
    lines = ["SHOPPING LIST", "=" * 30, ""]
    for item in items:
        note = f"  ({item.note})" if item.note else ""
        lines.append(f"- {item.inventory_item_name} [{item.unit}]{note}")
    lines.append("")
    return PlainTextResponse("\n".join(lines))


async def _sl_to_read(db: AsyncSession, sl: ShoppingListItem) -> ShoppingListItemRead:
    inv_item = await db.get(InventoryItem, sl.inventory_item_id)
    return ShoppingListItemRead(
        id=sl.id,
        inventory_item_id=sl.inventory_item_id,
        inventory_item_name=inv_item.name if inv_item else "Unknown",
        unit=inv_item.unit if inv_item else "",
        note=sl.note,
        added_by_id=sl.added_by_id,
        created_at=sl.created_at,
    )
```

- [ ] **Step 2: Commit**

```bash
git add api/app/services/shopping_list.py
git commit -m "feat: shopping list service"
```

---

## Task 8: Pre-Orders Router

**Files:**
- Create: `api/app/api/v1/pre_orders.py`

- [ ] **Step 1: Create `api/app/api/v1/pre_orders.py`**

```python
from fastapi import APIRouter, Depends, Query

from app.deps import DbSession, StoreUser
from app.enums import PreOrderStatus
from app.schemas.pre_orders import (
    IngredientSummary,
    PreOrderCreate,
    PreOrderItemIn,
    PreOrderRead,
    PreOrderUpdate,
    PreOrdersPage,
)
from app.services import pre_orders as svc

router = APIRouter(prefix="/pre-orders", tags=["pre-orders"])


@router.post("", response_model=PreOrderRead, status_code=201,
             summary="Create a pre-order", operation_id="pre_orders_create")
async def create_pre_order(
    payload: PreOrderCreate, user: StoreUser, db: DbSession
) -> PreOrderRead:
    return await svc.create_pre_order(db, store_id=user.store_id, user_id=user.id, payload=payload)


@router.get("", response_model=PreOrdersPage,
            summary="List pre-orders ordered by due date", operation_id="pre_orders_list")
async def list_pre_orders(
    user: StoreUser,
    db: DbSession,
    status: PreOrderStatus | None = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
) -> PreOrdersPage:
    return await svc.list_pre_orders(db, store_id=user.store_id, status=status, page=page, limit=limit)


@router.get("/{pre_order_id}", response_model=PreOrderRead,
            summary="Get pre-order detail", operation_id="pre_orders_get")
async def get_pre_order(pre_order_id: str, user: StoreUser, db: DbSession) -> PreOrderRead:
    return await svc.get_pre_order(db, store_id=user.store_id, pre_order_id=pre_order_id)


@router.patch("/{pre_order_id}", response_model=PreOrderRead,
              summary="Update pre-order header (PENDING only)", operation_id="pre_orders_update")
async def update_pre_order(
    pre_order_id: str, payload: PreOrderUpdate, user: StoreUser, db: DbSession
) -> PreOrderRead:
    return await svc.update_pre_order(db, store_id=user.store_id, pre_order_id=pre_order_id, payload=payload)


@router.post("/{pre_order_id}/items", response_model=PreOrderRead, status_code=201,
             summary="Add item to pre-order (PENDING only)", operation_id="pre_orders_add_item")
async def add_item(
    pre_order_id: str, payload: PreOrderItemIn, user: StoreUser, db: DbSession
) -> PreOrderRead:
    return await svc.add_item(db, store_id=user.store_id, pre_order_id=pre_order_id, item_in=payload)


@router.delete("/{pre_order_id}/items/{item_id}", response_model=PreOrderRead,
               summary="Remove item from pre-order (PENDING only)", operation_id="pre_orders_remove_item")
async def remove_item(
    pre_order_id: str, item_id: str, user: StoreUser, db: DbSession
) -> PreOrderRead:
    return await svc.remove_item(db, store_id=user.store_id, pre_order_id=pre_order_id, item_id=item_id)


@router.get("/{pre_order_id}/ingredients", response_model=IngredientSummary,
            summary="Ingredient summary with stock threshold check", operation_id="pre_orders_ingredients")
async def get_ingredient_summary(
    pre_order_id: str,
    user: StoreUser,
    db: DbSession,
    threshold: float = Query(50.0, ge=0, le=100),
) -> IngredientSummary:
    return await svc.get_ingredient_summary(
        db, store_id=user.store_id, pre_order_id=pre_order_id, threshold=threshold
    )


@router.post("/{pre_order_id}/start", response_model=PreOrderRead,
             summary="Start order — deducts stock, PENDING → IN_PROGRESS", operation_id="pre_orders_start")
async def start_pre_order(pre_order_id: str, user: StoreUser, db: DbSession) -> PreOrderRead:
    return await svc.start_pre_order(db, store_id=user.store_id, user_id=user.id, pre_order_id=pre_order_id)


@router.post("/{pre_order_id}/complete", response_model=PreOrderRead,
             summary="Complete order — IN_PROGRESS → COMPLETED", operation_id="pre_orders_complete")
async def complete_pre_order(pre_order_id: str, user: StoreUser, db: DbSession) -> PreOrderRead:
    return await svc.complete_pre_order(db, store_id=user.store_id, user_id=user.id, pre_order_id=pre_order_id)


@router.post("/{pre_order_id}/cancel", response_model=PreOrderRead,
             summary="Cancel order — PENDING → CANCELLED", operation_id="pre_orders_cancel")
async def cancel_pre_order(pre_order_id: str, user: StoreUser, db: DbSession) -> PreOrderRead:
    return await svc.cancel_pre_order(db, store_id=user.store_id, pre_order_id=pre_order_id)
```

- [ ] **Step 2: Commit**

```bash
git add api/app/api/v1/pre_orders.py
git commit -m "feat: pre-orders API router"
```

---

## Task 9: Shopping List Router + Register All Routers

**Files:**
- Create: `api/app/api/v1/shopping_list.py`
- Modify: `api/app/api/v1/router.py`

- [ ] **Step 1: Create `api/app/api/v1/shopping_list.py`**

```python
from fastapi import APIRouter
from fastapi.responses import PlainTextResponse

from app.deps import DbSession, StoreUser
from app.schemas.pre_orders import ShoppingListItemCreate, ShoppingListItemRead
from app.services import shopping_list as svc

router = APIRouter(prefix="/shopping-list", tags=["shopping-list"])


@router.get("", response_model=list[ShoppingListItemRead],
            summary="List shopping list items", operation_id="shopping_list_list")
async def list_shopping_list(user: StoreUser, db: DbSession) -> list[ShoppingListItemRead]:
    return await svc.list_shopping_list(db, store_id=user.store_id)


@router.post("", response_model=ShoppingListItemRead,
             summary="Add ingredient to shopping list (idempotent)", operation_id="shopping_list_add")
async def add_to_shopping_list(
    payload: ShoppingListItemCreate, user: StoreUser, db: DbSession
):
    item, created = await svc.add_to_shopping_list(
        db, store_id=user.store_id, user_id=user.id, payload=payload
    )
    from fastapi.responses import JSONResponse
    from fastapi.encoders import jsonable_encoder
    status_code = 201 if created else 200
    return JSONResponse(content=jsonable_encoder(item), status_code=status_code)


@router.delete("/{item_id}", status_code=204,
               summary="Remove item from shopping list", operation_id="shopping_list_remove")
async def remove_from_shopping_list(item_id: str, user: StoreUser, db: DbSession) -> None:
    await svc.remove_from_shopping_list(db, store_id=user.store_id, item_id=item_id)


@router.get("/print", response_class=PlainTextResponse,
            summary="Printable shopping list as plain text", operation_id="shopping_list_print")
async def print_shopping_list(user: StoreUser, db: DbSession) -> PlainTextResponse:
    return await svc.print_shopping_list(db, store_id=user.store_id)
```

**Important:** The `/print` route must be declared BEFORE `/{item_id}` in the router file to avoid FastAPI treating `print` as a path parameter. The order above is correct.

- [ ] **Step 2: Register both routers in `api/app/api/v1/router.py`**

Replace the file:

```python
from fastapi import APIRouter

from app.api.v1 import (
    auth, categories, customers, hr, inventory,
    modifier_groups, orders, pre_orders, products,
    realtime, receipts, reports, shopping_list,
)

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth.router)
api_router.include_router(inventory.router)
api_router.include_router(receipts.router)
api_router.include_router(categories.router)
api_router.include_router(products.router)
api_router.include_router(modifier_groups.router)
api_router.include_router(orders.router)
api_router.include_router(realtime.router)
api_router.include_router(reports.router)
api_router.include_router(customers.router)
api_router.include_router(hr.router)
api_router.include_router(pre_orders.router)
api_router.include_router(shopping_list.router)
```

- [ ] **Step 3: Commit**

```bash
git add api/app/api/v1/shopping_list.py api/app/api/v1/router.py
git commit -m "feat: shopping list router, register pre-orders and shopping list in main router"
```

---

## Task 10: Verify & Final Commit

- [ ] **Step 1: Run tests (skip if no local DB)**

If `api/.env` exists with a valid `DATABASE_URL`:

```bash
cd api && uv run pytest tests/test_pre_orders_api.py tests/test_shopping_list_api.py -v
```

Expected: all tests pass.

Full suite:

```bash
uv run pytest --cov=app --cov-report=term-missing
```

- [ ] **Step 2: If tests pass, tag the feature complete**

```bash
git add -A
git commit -m "feat: pre-order system complete — FIFO stock deduction, ingredient summary, shopping list"
```

- [ ] **Step 3: Verify app boots (import check)**

```bash
cd api && uv run python -c "from app.main import create_app; create_app(); print('OK')"
```

Expected output: `OK`
