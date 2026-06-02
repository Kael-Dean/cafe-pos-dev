# Batch Receipt Inventory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace single-item stock receiving with a receipt-based batch flow backed by FIFO lot tracking, so purchasing matches supplier bills and oldest stock is consumed first.

**Architecture:** Two new models (`StockReceipt`, `StockLot`) hold purchasing events and individual stock batches. The order service deducts from lots oldest-first instead of directly from `InventoryItem.stock_on_hand`. `stock_on_hand` is kept as a denormalized cache updated on confirm and deduction.

**Tech Stack:** FastAPI, SQLAlchemy 2.x async, PostgreSQL, Alembic, Pydantic v2, pytest-asyncio

**Spec:** `docs/superpowers/specs/2026-05-14-batch-receipt-inventory-design.md`

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Modify | `api/app/enums.py` | Add `ReceiptStatus` enum |
| Create | `api/app/models/receipts.py` | `StockReceipt` + `StockLot` ORM models |
| Modify | `api/app/models/inventory.py` | Remove `expiry_date` column |
| Modify | `api/app/models/__init__.py` | Export new models |
| Create | `api/alembic/versions/0011_batch_receipt_lots.py` | Migration: new tables, drop expiry_date, zero stock |
| Create | `api/app/schemas/receipts.py` | Pydantic schemas for receipt flow |
| Modify | `api/app/schemas/inventory.py` | Remove `expiry_date`, remove `ReceiveStockRequest` |
| Create | `api/app/services/receipts.py` | CRUD + confirm service functions |
| Modify | `api/app/services/inventory.py` | Remove `receive_stock`, update `list_expired` |
| Modify | `api/app/services/orders.py` | Replace direct deduction with `_deduct_fifo` |
| Create | `api/app/api/v1/receipts.py` | Receipt router |
| Modify | `api/app/api/v1/inventory.py` | Remove `/receive`, add `/{item_id}/lots` |
| Modify | `api/app/api/v1/router.py` | Register receipts router |
| Create | `api/tests/test_receipts_api.py` | Receipt lifecycle tests |
| Modify | `api/tests/test_inventory_api.py` | Remove test for deleted `/receive` endpoint |

---

## Task 1: Add ReceiptStatus Enum

**Files:**
- Modify: `api/app/enums.py`

- [ ] **Step 1: Add the enum**

  Open `api/app/enums.py` and append after `TaskStatus`:

  ```python
  class ReceiptStatus(str, enum.Enum):
      DRAFT = "DRAFT"
      CONFIRMED = "CONFIRMED"
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add api/app/enums.py
  git commit -m "feat: add ReceiptStatus enum"
  ```

---

## Task 2: StockReceipt + StockLot Models

**Files:**
- Create: `api/app/models/receipts.py`
- Modify: `api/app/models/inventory.py:38` — remove `expiry_date`
- Modify: `api/app/models/__init__.py`

- [ ] **Step 1: Create `api/app/models/receipts.py`**

  ```python
  from datetime import date, datetime
  from decimal import Decimal

  from sqlalchemy import Date, DateTime, Enum as SAEnum, ForeignKey, Index, Numeric, String, Text, func
  from sqlalchemy.orm import Mapped, mapped_column

  from app.db.base import Base
  from app.db.types import new_cuid
  from app.enums import ReceiptStatus


  class StockReceipt(Base):
      __tablename__ = "stock_receipts"

      id: Mapped[str] = mapped_column(String(24), primary_key=True, default=new_cuid)
      store_id: Mapped[str] = mapped_column(
          String(24), ForeignKey("stores.id", ondelete="CASCADE"), nullable=False, index=True
      )
      status: Mapped[ReceiptStatus] = mapped_column(
          SAEnum(ReceiptStatus, name="receipt_status"), nullable=False, default=ReceiptStatus.DRAFT
      )
      supplier_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
      receipt_ref: Mapped[str | None] = mapped_column(String(80), nullable=True)
      note: Mapped[str | None] = mapped_column(Text, nullable=True)
      received_at: Mapped[date] = mapped_column(Date, nullable=False)
      created_by_id: Mapped[str] = mapped_column(
          String(24), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
      )
      created_at: Mapped[datetime] = mapped_column(
          DateTime(timezone=True), server_default=func.now(), nullable=False
      )


  class StockLot(Base):
      __tablename__ = "stock_lots"
      __table_args__ = (
          Index("ix_lots_item_remaining", "inventory_item_id", "qty_remaining", "created_at"),
      )

      id: Mapped[str] = mapped_column(String(24), primary_key=True, default=new_cuid)
      store_id: Mapped[str] = mapped_column(
          String(24), ForeignKey("stores.id", ondelete="CASCADE"), nullable=False
      )
      receipt_id: Mapped[str] = mapped_column(
          String(24), ForeignKey("stock_receipts.id", ondelete="CASCADE"), nullable=False, index=True
      )
      inventory_item_id: Mapped[str] = mapped_column(
          String(24), ForeignKey("inventory_items.id", ondelete="CASCADE"), nullable=False
      )
      qty_received: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
      qty_remaining: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
      cost_per_unit: Mapped[Decimal] = mapped_column(Numeric(12, 4), nullable=False)
      expiry_date: Mapped[date | None] = mapped_column(Date, nullable=True)
      created_at: Mapped[datetime] = mapped_column(
          DateTime(timezone=True), server_default=func.now(), nullable=False
      )
  ```

- [ ] **Step 2: Remove `expiry_date` from `api/app/models/inventory.py`**

  Delete line 38:
  ```python
  expiry_date: Mapped[date | None] = mapped_column(Date, nullable=True)
  ```

  Also remove `date` from the import on line 1 if it is no longer used (it is only used by `expiry_date`):
  ```python
  # Before
  from datetime import date, datetime
  # After
  from datetime import datetime
  ```

- [ ] **Step 3: Update `api/app/models/__init__.py`**

  ```python
  from app.models.catalog import (
      Category,
      Modifier,
      ModifierGroup,
      Product,
      ProductModifierGroup,
      RecipeItem,
  )
  from app.models.customers import Customer
  from app.models.hr import CashSession, Leave, ShiftAssignment, StaffTask
  from app.models.identity import User
  from app.models.inventory import InventoryItem, StockMovement
  from app.models.orders import Order, OrderItem, OrderVoidLog
  from app.models.receipts import StockLot, StockReceipt
  from app.models.tenancy import Store, Tenant

  __all__ = [
      "Customer",
      "CashSession",
      "Leave",
      "ShiftAssignment",
      "StaffTask",
      "Tenant",
      "Store",
      "User",
      "InventoryItem",
      "StockMovement",
      "StockReceipt",
      "StockLot",
      "Category",
      "Product",
      "RecipeItem",
      "ModifierGroup",
      "Modifier",
      "ProductModifierGroup",
      "Order",
      "OrderItem",
      "OrderVoidLog",
  ]
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add api/app/models/receipts.py api/app/models/inventory.py api/app/models/__init__.py
  git commit -m "feat: add StockReceipt and StockLot models, remove expiry_date from InventoryItem"
  ```

---

## Task 3: Alembic Migration

**Files:**
- Create: `api/alembic/versions/0011_batch_receipt_lots.py`

- [ ] **Step 1: Create the migration file**

  Create `api/alembic/versions/0011_batch_receipt_lots.py`:

  ```python
  """batch receipt and stock lots

  Revision ID: 0011
  Revises: 0010
  Create Date: 2026-05-14
  """
  from alembic import op
  import sqlalchemy as sa

  revision = "0011"
  down_revision = "0010"
  branch_labels = None
  depends_on = None

  receipt_status = sa.Enum("DRAFT", "CONFIRMED", name="receipt_status")


  def upgrade() -> None:
      receipt_status.create(op.get_bind())

      op.create_table(
          "stock_receipts",
          sa.Column("id", sa.String(24), primary_key=True),
          sa.Column("store_id", sa.String(24), sa.ForeignKey("stores.id", ondelete="CASCADE"), nullable=False, index=True),
          sa.Column("status", sa.Enum("DRAFT", "CONFIRMED", name="receipt_status", create_type=False), nullable=False, server_default="DRAFT"),
          sa.Column("supplier_name", sa.String(120), nullable=True),
          sa.Column("receipt_ref", sa.String(80), nullable=True),
          sa.Column("note", sa.Text, nullable=True),
          sa.Column("received_at", sa.Date, nullable=False),
          sa.Column("created_by_id", sa.String(24), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
          sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
      )

      op.create_table(
          "stock_lots",
          sa.Column("id", sa.String(24), primary_key=True),
          sa.Column("store_id", sa.String(24), sa.ForeignKey("stores.id", ondelete="CASCADE"), nullable=False),
          sa.Column("receipt_id", sa.String(24), sa.ForeignKey("stock_receipts.id", ondelete="CASCADE"), nullable=False, index=True),
          sa.Column("inventory_item_id", sa.String(24), sa.ForeignKey("inventory_items.id", ondelete="CASCADE"), nullable=False),
          sa.Column("qty_received", sa.Numeric(12, 3), nullable=False),
          sa.Column("qty_remaining", sa.Numeric(12, 3), nullable=False),
          sa.Column("cost_per_unit", sa.Numeric(12, 4), nullable=False),
          sa.Column("expiry_date", sa.Date, nullable=True),
          sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
      )
      op.create_index("ix_lots_item_remaining", "stock_lots", ["inventory_item_id", "qty_remaining", "created_at"])

      op.drop_column("inventory_items", "expiry_date")
      op.execute("UPDATE inventory_items SET stock_on_hand = 0")


  def downgrade() -> None:
      op.add_column("inventory_items", sa.Column("expiry_date", sa.Date, nullable=True))
      op.drop_index("ix_lots_item_remaining", table_name="stock_lots")
      op.drop_table("stock_lots")
      op.drop_table("stock_receipts")
      receipt_status.drop(op.get_bind())
  ```

- [ ] **Step 2: Verify the down_revision matches the previous migration**

  Run: `ls api/alembic/versions/` and confirm `0010_hr_enhancements.py` exists. If the previous migration file has a different `revision` value inside it, update `down_revision` in 0011 to match.

  ```bash
  grep "^revision" api/alembic/versions/0010_hr_enhancements.py
  ```

  Expected output: `revision = "0010"`

- [ ] **Step 3: Apply migration**

  Run from `api/` directory:
  ```bash
  uv run alembic upgrade head
  ```

  Expected: migration runs with no errors, `stock_receipts` and `stock_lots` tables created.

- [ ] **Step 4: Commit**

  ```bash
  git add api/alembic/versions/0011_batch_receipt_lots.py
  git commit -m "feat: migration 0011 — stock_receipts, stock_lots, drop inventory expiry_date"
  ```

---

## Task 4: Schemas

**Files:**
- Create: `api/app/schemas/receipts.py`
- Modify: `api/app/schemas/inventory.py`

- [ ] **Step 1: Create `api/app/schemas/receipts.py`**

  ```python
  from datetime import date, datetime
  from decimal import Decimal

  from pydantic import BaseModel, ConfigDict, Field

  from app.schemas.inventory import CreatedBy


  class _Cfg(BaseModel):
      model_config = ConfigDict(from_attributes=True)


  class StockReceiptCreate(BaseModel):
      supplier_name: str | None = Field(None, max_length=120)
      receipt_ref: str | None = Field(None, max_length=80)
      note: str | None = Field(None, max_length=1000)
      received_at: date = Field(default_factory=date.today)


  class StockLotCreate(BaseModel):
      inventory_item_id: str
      qty_received: Decimal = Field(gt=0, le=Decimal("999999.999"))
      cost_per_unit: Decimal = Field(ge=0, le=Decimal("99999.9999"))
      expiry_date: date | None = None


  class StockLotRead(_Cfg):
      id: str
      inventory_item_id: str
      inventory_item_name: str
      qty_received: Decimal
      qty_remaining: Decimal
      cost_per_unit: Decimal
      expiry_date: date | None
      created_at: datetime


  class StockReceiptRead(_Cfg):
      id: str
      status: str
      supplier_name: str | None
      receipt_ref: str | None
      note: str | None
      received_at: date
      created_by: CreatedBy
      created_at: datetime
      lots: list[StockLotRead]


  class StockReceiptSummary(_Cfg):
      id: str
      status: str
      supplier_name: str | None
      receipt_ref: str | None
      received_at: date
      lot_count: int
      created_at: datetime


  class StockReceiptsPage(BaseModel):
      items: list[StockReceiptSummary]
      next_cursor: str | None = None


  class ExpiredLotRead(_Cfg):
      lot_id: str
      inventory_item_id: str
      inventory_item_name: str
      unit: str
      qty_remaining: Decimal
      expiry_date: date
  ```

- [ ] **Step 2: Update `api/app/schemas/inventory.py`**

  Make three edits:

  **a) Remove `expiry_date` from `InventoryItemBase` (line 24):**
  ```python
  # Before
  class InventoryItemBase(_DecimalConfig):
      id: str
      name: str
      unit: str
      cost_per_unit: Decimal
      stock_on_hand: Decimal
      par_level: Decimal
      is_active: bool
      expiry_date: date | None = None
      unit_size: Decimal | None = None
      piece_price: Decimal | None = None

  # After
  class InventoryItemBase(_DecimalConfig):
      id: str
      name: str
      unit: str
      cost_per_unit: Decimal
      stock_on_hand: Decimal
      par_level: Decimal
      is_active: bool
      unit_size: Decimal | None = None
      piece_price: Decimal | None = None
  ```

  **b) Remove `expiry_date` from `InventoryItemCreate` (line 51):**
  ```python
  # Before
  class InventoryItemCreate(BaseModel):
      name: str = Field(min_length=1, max_length=120)
      unit: str = Field(min_length=1, max_length=24)
      par_level: Decimal = Field(default=Decimal("0"), ge=0, le=Decimal("9999999.999"))
      cost_per_unit: Decimal = Field(default=Decimal("0"), ge=0, le=Decimal("99999.9999"))
      is_active: bool = True
      expiry_date: date | None = None
      unit_size: Decimal | None = Field(None, gt=0, le=Decimal("9999999.999"))
      piece_price: Decimal | None = Field(None, ge=0, le=Decimal("99999.99"))

  # After
  class InventoryItemCreate(BaseModel):
      name: str = Field(min_length=1, max_length=120)
      unit: str = Field(min_length=1, max_length=24)
      par_level: Decimal = Field(default=Decimal("0"), ge=0, le=Decimal("9999999.999"))
      cost_per_unit: Decimal = Field(default=Decimal("0"), ge=0, le=Decimal("99999.9999"))
      is_active: bool = True
      unit_size: Decimal | None = Field(None, gt=0, le=Decimal("9999999.999"))
      piece_price: Decimal | None = Field(None, ge=0, le=Decimal("99999.99"))
  ```

  **c) Remove `expiry_date` from `InventoryItemUpdate` (line 67) and remove `ReceiveStockRequest` entirely (lines 70-75):**
  ```python
  # Before
  class InventoryItemUpdate(BaseModel):
      par_level: Decimal | None = Field(None, ge=0, le=Decimal("9999999.999"))
      cost_per_unit: Decimal | None = Field(None, ge=0, le=Decimal("99999.9999"))
      expiry_date: date | None = None


  class ReceiveStockRequest(BaseModel):
      item_id: str
      qty: Decimal = Field(gt=0, le=Decimal("999999.999"))
      cost_per_unit: Decimal = Field(ge=0, le=Decimal("99999.9999"))
      supplier: str | None = Field(None, max_length=120)
      note: str | None = Field(None, max_length=500)

  # After
  class InventoryItemUpdate(BaseModel):
      par_level: Decimal | None = Field(None, ge=0, le=Decimal("9999999.999"))
      cost_per_unit: Decimal | None = Field(None, ge=0, le=Decimal("99999.9999"))
  ```

  **d) Remove the `date` import** from line 1 since `InventoryItemBase`, `InventoryItemCreate`, and `InventoryItemUpdate` no longer use it:
  ```python
  # Before
  from datetime import date, datetime
  # After
  from datetime import datetime
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add api/app/schemas/receipts.py api/app/schemas/inventory.py
  git commit -m "feat: add receipt schemas, remove expiry_date and ReceiveStockRequest from inventory schemas"
  ```

---

## Task 5: Receipt Service

**Files:**
- Create: `api/app/services/receipts.py`

- [ ] **Step 1: Write the failing test first**

  Create `api/tests/test_receipts_api.py`:

  ```python
  from datetime import date
  from decimal import Decimal

  import pytest

  from tests.conftest import make_item


  async def _login(client, store_slug: str, pin: str) -> str:
      resp = await client.post("/api/v1/auth/login", json={"store_slug": store_slug, "pin": pin})
      assert resp.status_code == 200, resp.text
      return resp.json()["access_token"]


  def _headers(token: str) -> dict:
      return {"Authorization": f"Bearer {token}"}


  async def test_create_draft_receipt(client, db, store_a, manager_a):
      token = await _login(client, store_a.slug, "2222")
      resp = await client.post(
          "/api/v1/receipts",
          headers=_headers(token),
          json={"supplier_name": "Thai Dairy Co.", "receipt_ref": "INV-001", "received_at": "2026-05-14"},
      )
      assert resp.status_code == 201, resp.text
      data = resp.json()
      assert data["status"] == "DRAFT"
      assert data["supplier_name"] == "Thai Dairy Co."
      assert data["receipt_ref"] == "INV-001"
      assert data["lots"] == []


  async def test_barista_cannot_create_receipt(client, db, store_a, user_a):
      token = await _login(client, store_a.slug, "1111")
      resp = await client.post(
          "/api/v1/receipts",
          headers=_headers(token),
          json={"received_at": "2026-05-14"},
      )
      assert resp.status_code == 403


  async def test_add_lot_to_draft(client, db, store_a, manager_a):
      token = await _login(client, store_a.slug, "2222")
      item = await make_item(db, store_id=store_a.id, name="Milk-Lot", stock=Decimal("0"))

      receipt_resp = await client.post(
          "/api/v1/receipts",
          headers=_headers(token),
          json={"received_at": "2026-05-14"},
      )
      receipt_id = receipt_resp.json()["id"]

      resp = await client.post(
          f"/api/v1/receipts/{receipt_id}/lots",
          headers=_headers(token),
          json={
              "inventory_item_id": item.id,
              "qty_received": "10.000",
              "cost_per_unit": "85.0000",
              "expiry_date": "2026-06-15",
          },
      )
      assert resp.status_code == 201, resp.text
      data = resp.json()
      assert len(data["lots"]) == 1
      assert Decimal(data["lots"][0]["qty_received"]) == Decimal("10.000")
      assert data["lots"][0]["expiry_date"] == "2026-06-15"


  async def test_confirm_receipt_increments_stock(client, db, store_a, manager_a):
      token = await _login(client, store_a.slug, "2222")
      item = await make_item(db, store_id=store_a.id, name="Beans-Confirm", stock=Decimal("0"))

      receipt_resp = await client.post(
          "/api/v1/receipts", headers=_headers(token), json={"received_at": "2026-05-14"}
      )
      receipt_id = receipt_resp.json()["id"]

      await client.post(
          f"/api/v1/receipts/{receipt_id}/lots",
          headers=_headers(token),
          json={"inventory_item_id": item.id, "qty_received": "12.000", "cost_per_unit": "85.0000"},
      )

      resp = await client.post(f"/api/v1/receipts/{receipt_id}/confirm", headers=_headers(token))
      assert resp.status_code == 200, resp.text
      assert resp.json()["status"] == "CONFIRMED"

      inv_resp = await client.get(f"/api/v1/inventory/{item.id}", headers=_headers(token))
      assert Decimal(inv_resp.json()["stock_on_hand"]) == Decimal("12.000")


  async def test_confirm_empty_receipt_returns_422(client, db, store_a, manager_a):
      token = await _login(client, store_a.slug, "2222")
      receipt_resp = await client.post(
          "/api/v1/receipts", headers=_headers(token), json={"received_at": "2026-05-14"}
      )
      receipt_id = receipt_resp.json()["id"]

      resp = await client.post(f"/api/v1/receipts/{receipt_id}/confirm", headers=_headers(token))
      assert resp.status_code == 422
      assert resp.json()["error"]["code"] == "RECEIPT_HAS_NO_LOTS"


  async def test_confirm_already_confirmed_returns_409(client, db, store_a, manager_a):
      token = await _login(client, store_a.slug, "2222")
      item = await make_item(db, store_id=store_a.id, name="Beans-409", stock=Decimal("0"))

      receipt_resp = await client.post(
          "/api/v1/receipts", headers=_headers(token), json={"received_at": "2026-05-14"}
      )
      receipt_id = receipt_resp.json()["id"]
      await client.post(
          f"/api/v1/receipts/{receipt_id}/lots",
          headers=_headers(token),
          json={"inventory_item_id": item.id, "qty_received": "5.000", "cost_per_unit": "50.0000"},
      )
      await client.post(f"/api/v1/receipts/{receipt_id}/confirm", headers=_headers(token))

      resp = await client.post(f"/api/v1/receipts/{receipt_id}/confirm", headers=_headers(token))
      assert resp.status_code == 409
      assert resp.json()["error"]["code"] == "RECEIPT_ALREADY_CONFIRMED"


  async def test_add_lot_to_confirmed_returns_409(client, db, store_a, manager_a):
      token = await _login(client, store_a.slug, "2222")
      item = await make_item(db, store_id=store_a.id, name="Beans-Confirmed", stock=Decimal("0"))

      receipt_resp = await client.post(
          "/api/v1/receipts", headers=_headers(token), json={"received_at": "2026-05-14"}
      )
      receipt_id = receipt_resp.json()["id"]
      await client.post(
          f"/api/v1/receipts/{receipt_id}/lots",
          headers=_headers(token),
          json={"inventory_item_id": item.id, "qty_received": "5.000", "cost_per_unit": "50.0000"},
      )
      await client.post(f"/api/v1/receipts/{receipt_id}/confirm", headers=_headers(token))

      item2 = await make_item(db, store_id=store_a.id, name="Milk-Confirmed", stock=Decimal("0"))
      resp = await client.post(
          f"/api/v1/receipts/{receipt_id}/lots",
          headers=_headers(token),
          json={"inventory_item_id": item2.id, "qty_received": "3.000", "cost_per_unit": "40.0000"},
      )
      assert resp.status_code == 409
      assert resp.json()["error"]["code"] == "RECEIPT_ALREADY_CONFIRMED"


  async def test_remove_lot_from_draft(client, db, store_a, manager_a):
      token = await _login(client, store_a.slug, "2222")
      item = await make_item(db, store_id=store_a.id, name="Beans-Remove", stock=Decimal("0"))

      receipt_resp = await client.post(
          "/api/v1/receipts", headers=_headers(token), json={"received_at": "2026-05-14"}
      )
      receipt_id = receipt_resp.json()["id"]
      lot_resp = await client.post(
          f"/api/v1/receipts/{receipt_id}/lots",
          headers=_headers(token),
          json={"inventory_item_id": item.id, "qty_received": "5.000", "cost_per_unit": "50.0000"},
      )
      lot_id = lot_resp.json()["lots"][0]["id"]

      resp = await client.delete(f"/api/v1/receipts/{receipt_id}/lots/{lot_id}", headers=_headers(token))
      assert resp.status_code == 204

      get_resp = await client.get(f"/api/v1/receipts/{receipt_id}", headers=_headers(token))
      assert get_resp.json()["lots"] == []


  async def test_get_item_lots(client, db, store_a, manager_a):
      token = await _login(client, store_a.slug, "2222")
      item = await make_item(db, store_id=store_a.id, name="Milk-Lots", stock=Decimal("0"))

      receipt_resp = await client.post(
          "/api/v1/receipts", headers=_headers(token), json={"received_at": "2026-05-14"}
      )
      receipt_id = receipt_resp.json()["id"]
      await client.post(
          f"/api/v1/receipts/{receipt_id}/lots",
          headers=_headers(token),
          json={"inventory_item_id": item.id, "qty_received": "8.000", "cost_per_unit": "85.0000"},
      )
      await client.post(f"/api/v1/receipts/{receipt_id}/confirm", headers=_headers(token))

      resp = await client.get(f"/api/v1/inventory/{item.id}/lots", headers=_headers(token))
      assert resp.status_code == 200, resp.text
      data = resp.json()
      assert len(data) == 1
      assert Decimal(data[0]["qty_remaining"]) == Decimal("8.000")


  async def test_list_receipts(client, db, store_a, manager_a):
      token = await _login(client, store_a.slug, "2222")
      await client.post("/api/v1/receipts", headers=_headers(token), json={"received_at": "2026-05-14", "supplier_name": "SupplierX"})

      resp = await client.get("/api/v1/receipts", headers=_headers(token))
      assert resp.status_code == 200, resp.text
      names = [r["supplier_name"] for r in resp.json()["items"]]
      assert "SupplierX" in names
  ```

- [ ] **Step 2: Run tests — expect FAIL (404 on all receipt routes)**

  ```bash
  cd api && uv run pytest tests/test_receipts_api.py -v 2>&1 | head -40
  ```

  Expected: all tests fail with connection errors or 404 — routes don't exist yet.

- [ ] **Step 3: Create `api/app/services/receipts.py`**

  ```python
  import base64
  import binascii
  import logging
  from datetime import date, datetime
  from decimal import Decimal

  from sqlalchemy import func, select
  from sqlalchemy.ext.asyncio import AsyncSession

  from app.core.errors import Conflict, NotFound, Unprocessable
  from app.enums import MovementType, ReceiptStatus
  from app.models.inventory import InventoryItem, StockMovement
  from app.models.receipts import StockLot, StockReceipt
  from app.models.identity import User
  from app.schemas.inventory import CreatedBy
  from app.schemas.receipts import (
      StockLotCreate,
      StockLotRead,
      StockReceiptCreate,
      StockReceiptRead,
      StockReceiptSummary,
      StockReceiptsPage,
  )

  logger = logging.getLogger(__name__)

  _DEFAULT_PAGE = 50
  _MAX_PAGE = 200


  async def create_receipt(
      db: AsyncSession,
      *,
      store_id: str,
      user_id: str,
      payload: StockReceiptCreate,
  ) -> StockReceiptRead:
      async with db.begin():
          receipt = StockReceipt(
              store_id=store_id,
              status=ReceiptStatus.DRAFT,
              supplier_name=payload.supplier_name,
              receipt_ref=payload.receipt_ref,
              note=payload.note,
              received_at=payload.received_at,
              created_by_id=user_id,
          )
          db.add(receipt)
      return await _receipt_to_read(db, receipt)


  async def list_receipts(
      db: AsyncSession,
      *,
      store_id: str,
      status: ReceiptStatus | None = None,
      cursor: str | None = None,
      limit: int = _DEFAULT_PAGE,
  ) -> StockReceiptsPage:
      if limit <= 0 or limit > _MAX_PAGE:
          limit = _DEFAULT_PAGE

      lot_count_subq = (
          select(StockLot.receipt_id, func.count(StockLot.id).label("cnt"))
          .group_by(StockLot.receipt_id)
          .subquery()
      )

      stmt = (
          select(StockReceipt, func.coalesce(lot_count_subq.c.cnt, 0).label("lot_count"))
          .outerjoin(lot_count_subq, lot_count_subq.c.receipt_id == StockReceipt.id)
          .where(StockReceipt.store_id == store_id)
          .order_by(StockReceipt.created_at.desc(), StockReceipt.id.desc())
          .limit(limit + 1)
      )
      if status is not None:
          stmt = stmt.where(StockReceipt.status == status)
      if cursor:
          decoded = _decode_cursor(cursor)
          if decoded is not None:
              cur_at, cur_id = decoded
              stmt = stmt.where(
                  (StockReceipt.created_at < cur_at)
                  | ((StockReceipt.created_at == cur_at) & (StockReceipt.id < cur_id))
              )

      rows = list((await db.execute(stmt)).all())
      next_cursor: str | None = None
      if len(rows) > limit:
          last = rows[limit - 1][0]
          next_cursor = _encode_cursor(last.created_at, last.id)
          rows = rows[:limit]

      items = [
          StockReceiptSummary(
              id=r.id,
              status=r.status.value,
              supplier_name=r.supplier_name,
              receipt_ref=r.receipt_ref,
              received_at=r.received_at,
              lot_count=cnt,
              created_at=r.created_at,
          )
          for r, cnt in rows
      ]
      return StockReceiptsPage(items=items, next_cursor=next_cursor)


  async def get_receipt(
      db: AsyncSession,
      *,
      store_id: str,
      receipt_id: str,
  ) -> StockReceiptRead:
      receipt = await _load_receipt(db, store_id=store_id, receipt_id=receipt_id)
      return await _receipt_to_read(db, receipt)


  async def add_lot(
      db: AsyncSession,
      *,
      store_id: str,
      receipt_id: str,
      payload: StockLotCreate,
  ) -> StockReceiptRead:
      async with db.begin():
          receipt = await _load_receipt(db, store_id=store_id, receipt_id=receipt_id)
          _require_draft(receipt)

          item = await db.execute(
              select(InventoryItem).where(
                  InventoryItem.id == payload.inventory_item_id,
                  InventoryItem.store_id == store_id,
              )
          )
          if item.scalar_one_or_none() is None:
              raise NotFound("Inventory item not found")

          lot = StockLot(
              store_id=store_id,
              receipt_id=receipt.id,
              inventory_item_id=payload.inventory_item_id,
              qty_received=payload.qty_received,
              qty_remaining=payload.qty_received,
              cost_per_unit=payload.cost_per_unit,
              expiry_date=payload.expiry_date,
          )
          db.add(lot)
      return await _receipt_to_read(db, receipt)


  async def remove_lot(
      db: AsyncSession,
      *,
      store_id: str,
      receipt_id: str,
      lot_id: str,
  ) -> None:
      async with db.begin():
          receipt = await _load_receipt(db, store_id=store_id, receipt_id=receipt_id)
          _require_draft(receipt)

          result = await db.execute(
              select(StockLot).where(StockLot.id == lot_id, StockLot.receipt_id == receipt_id)
          )
          lot = result.scalar_one_or_none()
          if lot is None:
              raise NotFound("Lot not found")
          await db.delete(lot)


  async def confirm_receipt(
      db: AsyncSession,
      *,
      store_id: str,
      user_id: str,
      receipt_id: str,
  ) -> StockReceiptRead:
      async with db.begin():
          receipt = await _load_receipt(db, store_id=store_id, receipt_id=receipt_id)
          _require_draft(receipt)

          lots = list((await db.execute(
              select(StockLot).where(StockLot.receipt_id == receipt_id)
          )).scalars())

          if not lots:
              raise Unprocessable("RECEIPT_HAS_NO_LOTS")

          receipt.status = ReceiptStatus.CONFIRMED

          latest_cost_by_item: dict[str, Decimal] = {}

          for lot in lots:
              item = await db.get(InventoryItem, lot.inventory_item_id)
              if item:
                  item.stock_on_hand = item.stock_on_hand + lot.qty_received
                  latest_cost_by_item[lot.inventory_item_id] = lot.cost_per_unit
                  db.add(StockMovement(
                      store_id=store_id,
                      inventory_item_id=lot.inventory_item_id,
                      type=MovementType.RECEIVE,
                      quantity=lot.qty_received,
                      unit_cost=lot.cost_per_unit,
                      reason=f"Receipt {receipt.receipt_ref or receipt.id}",
                      created_by_id=user_id,
                  ))

          for item_id, cost in latest_cost_by_item.items():
              item = await db.get(InventoryItem, item_id)
              if item:
                  item.cost_per_unit = cost

      return await _receipt_to_read(db, receipt)


  # -- helpers ----------------------------------------------------------------


  async def _load_receipt(
      db: AsyncSession, *, store_id: str, receipt_id: str
  ) -> StockReceipt:
      result = await db.execute(
          select(StockReceipt).where(
              StockReceipt.id == receipt_id,
              StockReceipt.store_id == store_id,
          )
      )
      receipt = result.scalar_one_or_none()
      if receipt is None:
          raise NotFound("Receipt not found")
      return receipt


  def _require_draft(receipt: StockReceipt) -> None:
      if receipt.status != ReceiptStatus.DRAFT:
          raise Conflict("RECEIPT_ALREADY_CONFIRMED")


  async def _receipt_to_read(db: AsyncSession, receipt: StockReceipt) -> StockReceiptRead:
      user = await db.get(User, receipt.created_by_id)

      rows = list((await db.execute(
          select(StockLot, InventoryItem.name)
          .join(InventoryItem, InventoryItem.id == StockLot.inventory_item_id)
          .where(StockLot.receipt_id == receipt.id)
          .order_by(StockLot.created_at)
      )).all())

      lots = [
          StockLotRead(
              id=lot.id,
              inventory_item_id=lot.inventory_item_id,
              inventory_item_name=item_name,
              qty_received=lot.qty_received,
              qty_remaining=lot.qty_remaining,
              cost_per_unit=lot.cost_per_unit,
              expiry_date=lot.expiry_date,
              created_at=lot.created_at,
          )
          for lot, item_name in rows
      ]

      return StockReceiptRead(
          id=receipt.id,
          status=receipt.status.value,
          supplier_name=receipt.supplier_name,
          receipt_ref=receipt.receipt_ref,
          note=receipt.note,
          received_at=receipt.received_at,
          created_by=CreatedBy(id=receipt.created_by_id, name=user.name if user else "Unknown"),
          created_at=receipt.created_at,
          lots=lots,
      )


  def _encode_cursor(created_at: datetime, ident: str) -> str:
      raw = f"{created_at.isoformat()}|{ident}".encode("utf-8")
      return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


  def _decode_cursor(cursor: str) -> tuple[datetime, str] | None:
      try:
          padded = cursor + "=" * (-len(cursor) % 4)
          decoded = base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8")
      except (binascii.Error, UnicodeDecodeError):
          return None
      if "|" not in decoded:
          return None
      iso, _, ident = decoded.partition("|")
      try:
          return (datetime.fromisoformat(iso), ident)
      except ValueError:
          return None
  ```

- [ ] **Step 4: Commit service (tests still fail — routes not wired yet)**

  ```bash
  git add api/app/services/receipts.py
  git commit -m "feat: receipt service — CRUD and confirm"
  ```

---

## Task 6: Receipts Router + Inventory Lots Endpoint + Wire Router

**Files:**
- Create: `api/app/api/v1/receipts.py`
- Modify: `api/app/api/v1/inventory.py`
- Modify: `api/app/api/v1/router.py`

- [ ] **Step 1: Create `api/app/api/v1/receipts.py`**

  ```python
  from fastapi import APIRouter, Depends, Query

  from app.deps import DbSession, StoreUser, require_role
  from app.enums import ReceiptStatus, Role
  from app.schemas.receipts import (
      StockLotCreate,
      StockReceiptCreate,
      StockReceiptRead,
      StockReceiptsPage,
  )
  from app.services import receipts as svc

  router = APIRouter(prefix="/receipts", tags=["receipts"])

  _MANAGER_PLUS = require_role(Role.OWNER, Role.MANAGER)


  @router.post(
      "",
      response_model=StockReceiptRead,
      status_code=201,
      summary="Create a new DRAFT receipt",
      operation_id="receipts_create",
      dependencies=[Depends(_MANAGER_PLUS)],
  )
  async def create_receipt(
      payload: StockReceiptCreate,
      user: StoreUser,
      db: DbSession,
  ) -> StockReceiptRead:
      return await svc.create_receipt(db, store_id=user.store_id, user_id=user.id, payload=payload)


  @router.get(
      "",
      response_model=StockReceiptsPage,
      summary="Paginated list of receipts",
      operation_id="receipts_list",
      dependencies=[Depends(_MANAGER_PLUS)],
  )
  async def list_receipts(
      user: StoreUser,
      db: DbSession,
      status: ReceiptStatus | None = Query(None),
      cursor: str | None = Query(None),
      limit: int = Query(50, ge=1, le=200),
  ) -> StockReceiptsPage:
      return await svc.list_receipts(
          db, store_id=user.store_id, status=status, cursor=cursor, limit=limit
      )


  @router.get(
      "/{receipt_id}",
      response_model=StockReceiptRead,
      summary="Get receipt with all lots",
      operation_id="receipts_get",
      dependencies=[Depends(_MANAGER_PLUS)],
  )
  async def get_receipt(receipt_id: str, user: StoreUser, db: DbSession) -> StockReceiptRead:
      return await svc.get_receipt(db, store_id=user.store_id, receipt_id=receipt_id)


  @router.post(
      "/{receipt_id}/lots",
      response_model=StockReceiptRead,
      status_code=201,
      summary="Add a lot to a DRAFT receipt",
      operation_id="receipts_add_lot",
      dependencies=[Depends(_MANAGER_PLUS)],
  )
  async def add_lot(
      receipt_id: str,
      payload: StockLotCreate,
      user: StoreUser,
      db: DbSession,
  ) -> StockReceiptRead:
      return await svc.add_lot(db, store_id=user.store_id, receipt_id=receipt_id, payload=payload)


  @router.delete(
      "/{receipt_id}/lots/{lot_id}",
      status_code=204,
      summary="Remove a lot from a DRAFT receipt",
      operation_id="receipts_remove_lot",
      dependencies=[Depends(_MANAGER_PLUS)],
  )
  async def remove_lot(receipt_id: str, lot_id: str, user: StoreUser, db: DbSession) -> None:
      await svc.remove_lot(db, store_id=user.store_id, receipt_id=receipt_id, lot_id=lot_id)


  @router.post(
      "/{receipt_id}/confirm",
      response_model=StockReceiptRead,
      summary="Confirm receipt — applies stock atomically, locks receipt",
      operation_id="receipts_confirm",
      dependencies=[Depends(_MANAGER_PLUS)],
  )
  async def confirm_receipt(receipt_id: str, user: StoreUser, db: DbSession) -> StockReceiptRead:
      return await svc.confirm_receipt(
          db, store_id=user.store_id, user_id=user.id, receipt_id=receipt_id
      )
  ```

- [ ] **Step 2: Update `api/app/api/v1/inventory.py`**

  **a) Remove these imports** (no longer needed):
  ```python
  # Remove from imports:
  ReceiveStockRequest,
  ```

  **b) Add `StockLotRead` to imports** and import the receipts service:
  ```python
  from app.schemas.receipts import StockLotRead
  from app.services import receipts as receipt_svc
  ```

  **c) Remove the entire `/receive` endpoint** (the `async def receive(...)` function, roughly lines 146–159).

  **d) Add the `/{item_id}/lots` endpoint** before the `/{item_id}` GET endpoint:
  ```python
  @router.get(
      "/{item_id}/lots",
      response_model=list[StockLotRead],
      summary="List stock lots for one ingredient, oldest-first",
      operation_id="inventory_lots",
  )
  async def get_item_lots(
      item_id: str,
      user: StoreUser,
      db: DbSession,
      status: str | None = Query(None, pattern="^(active|all)$"),
  ) -> list[StockLotRead]:
      return await receipt_svc.list_item_lots(
          db, store_id=user.store_id, item_id=item_id, active_only=(status != "all")
      )
  ```

- [ ] **Step 3: Add `list_item_lots` to `api/app/services/receipts.py`**

  Append to `services/receipts.py` before the helpers section:

  ```python
  async def list_item_lots(
      db: AsyncSession,
      *,
      store_id: str,
      item_id: str,
      active_only: bool = True,
  ) -> list[StockLotRead]:
      stmt = (
          select(StockLot, InventoryItem.name)
          .join(InventoryItem, InventoryItem.id == StockLot.inventory_item_id)
          .where(StockLot.inventory_item_id == item_id, StockLot.store_id == store_id)
          .order_by(StockLot.created_at.asc())
      )
      if active_only:
          stmt = stmt.where(StockLot.qty_remaining > 0)

      rows = list((await db.execute(stmt)).all())
      return [
          StockLotRead(
              id=lot.id,
              inventory_item_id=lot.inventory_item_id,
              inventory_item_name=item_name,
              qty_received=lot.qty_received,
              qty_remaining=lot.qty_remaining,
              cost_per_unit=lot.cost_per_unit,
              expiry_date=lot.expiry_date,
              created_at=lot.created_at,
          )
          for lot, item_name in rows
      ]
  ```

- [ ] **Step 4: Register receipts router in `api/app/api/v1/router.py`**

  ```python
  from fastapi import APIRouter

  from app.api.v1 import auth, categories, customers, hr, inventory, modifier_groups, orders, products, realtime, receipts, reports

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
  ```

- [ ] **Step 5: Run receipt tests — expect PASS**

  ```bash
  cd api && uv run pytest tests/test_receipts_api.py -v
  ```

  Expected: all tests pass.

- [ ] **Step 6: Commit**

  ```bash
  git add api/app/api/v1/receipts.py api/app/api/v1/inventory.py api/app/api/v1/router.py api/app/services/receipts.py
  git commit -m "feat: receipts router, inventory lots endpoint, register router"
  ```

---

## Task 7: Update Inventory Service

**Files:**
- Modify: `api/app/services/inventory.py`

- [ ] **Step 1: Remove `receive_stock` from `api/app/services/inventory.py`**

  Delete the entire `receive_stock` function (lines 116–139) and its import of `ReceiveStockRequest` from the schema imports at the top.

  Also remove `ReceiveStockRequest` from the import block at the top of the file:
  ```python
  # Before
  from app.schemas.inventory import (
      AdjustRequest,
      CreatedBy,
      InventoryItemCreate,
      InventoryItemUpdate,
      MovementsPage,
      ReceiveStockRequest,
      StockMovementRead,
      SupplierHistoryItem,
      WasteRequest,
  )

  # After
  from app.schemas.inventory import (
      AdjustRequest,
      CreatedBy,
      InventoryItemCreate,
      InventoryItemUpdate,
      MovementsPage,
      StockMovementRead,
      SupplierHistoryItem,
      WasteRequest,
  )
  ```

- [ ] **Step 2: Update `list_expired` to query lots instead of inventory items**

  Replace the entire `list_expired` function (currently at lines 270–282):

  ```python
  async def list_expired(
      db: AsyncSession, *, store_id: str
  ) -> list["ExpiredLotRead"]:
      from datetime import date as _date
      from app.models.receipts import StockLot
      from app.schemas.receipts import ExpiredLotRead

      today = _date.today()
      result = await db.execute(
          select(StockLot, InventoryItem.name, InventoryItem.unit)
          .join(InventoryItem, InventoryItem.id == StockLot.inventory_item_id)
          .where(
              StockLot.store_id == store_id,
              StockLot.expiry_date.is_not(None),
              StockLot.expiry_date < today,
              StockLot.qty_remaining > 0,
          )
          .order_by(StockLot.expiry_date)
      )
      return [
          ExpiredLotRead(
              lot_id=lot.id,
              inventory_item_id=lot.inventory_item_id,
              inventory_item_name=item_name,
              unit=item_unit,
              qty_remaining=lot.qty_remaining,
              expiry_date=lot.expiry_date,
          )
          for lot, item_name, item_unit in result.all()
      ]
  ```

- [ ] **Step 3: Update the `/expired` route in `api/app/api/v1/inventory.py`**

  Update the `list_expired` endpoint response model and import:

  ```python
  # Add to imports at top of inventory.py
  from app.schemas.receipts import ExpiredLotRead

  # Update the endpoint
  @router.get(
      "/expired",
      response_model=list[ExpiredLotRead],
      summary="List lots whose expiry_date has passed and still have stock remaining",
      operation_id="inventory_expired",
  )
  async def list_expired(user: StoreUser, db: DbSession) -> list[ExpiredLotRead]:
      return await inv.list_expired(db, store_id=user.store_id)
  ```

- [ ] **Step 4: Also remove `expiry_date` handling from `update_item` in `api/app/services/inventory.py`**

  In `update_item` (around line 94–102), remove:
  ```python
  # Remove this block
  if payload.expiry_date is not None:
      item.expiry_date = payload.expiry_date
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add api/app/services/inventory.py api/app/api/v1/inventory.py
  git commit -m "feat: remove receive_stock, update list_expired to query lots"
  ```

---

## Task 8: FIFO Deduction in Order Service

**Files:**
- Modify: `api/app/services/orders.py`

- [ ] **Step 1: Write the failing test**

  Add to `api/tests/test_receipts_api.py`:

  ```python
  async def test_fifo_deducts_oldest_lot_first(client, db, store_a, manager_a):
      """Confirm two lots then place a simulated deduction — oldest lot consumed first."""
      from app.models.receipts import StockLot, StockReceipt
      from app.enums import ReceiptStatus
      from datetime import date

      token = await _login(client, store_a.slug, "2222")
      item = await make_item(db, store_id=store_a.id, name="FIFO-Milk", stock=Decimal("0"))

      # Receipt 1 (older) — 4 units
      r1 = await client.post("/api/v1/receipts", headers=_headers(token), json={"received_at": "2026-05-01"})
      r1_id = r1.json()["id"]
      await client.post(f"/api/v1/receipts/{r1_id}/lots", headers=_headers(token),
          json={"inventory_item_id": item.id, "qty_received": "4.000", "cost_per_unit": "80.0000"})
      await client.post(f"/api/v1/receipts/{r1_id}/confirm", headers=_headers(token))

      # Receipt 2 (newer) — 6 units
      r2 = await client.post("/api/v1/receipts", headers=_headers(token), json={"received_at": "2026-05-10"})
      r2_id = r2.json()["id"]
      await client.post(f"/api/v1/receipts/{r2_id}/lots", headers=_headers(token),
          json={"inventory_item_id": item.id, "qty_received": "6.000", "cost_per_unit": "85.0000"})
      await client.post(f"/api/v1/receipts/{r2_id}/confirm", headers=_headers(token))

      # Verify total stock = 10
      inv_resp = await client.get(f"/api/v1/inventory/{item.id}", headers=_headers(token))
      assert Decimal(inv_resp.json()["stock_on_hand"]) == Decimal("10.000")

      # Directly call _deduct_fifo to consume 5 units
      from app.services.orders import _deduct_fifo
      async with db.begin():
          await _deduct_fifo(
              db,
              store_id=store_a.id,
              user_id=manager_a.id,
              inventory_item_id=item.id,
              total_qty=Decimal("5"),
              ref_order_id="test_order_id",
              order_number=999,
          )

      # Fetch lots and check FIFO: older lot (4 units) fully consumed, newer lot (6-1=5 remaining)
      lots_resp = await client.get(f"/api/v1/inventory/{item.id}/lots?status=all", headers=_headers(token))
      lots = sorted(lots_resp.json(), key=lambda x: x["created_at"])
      assert Decimal(lots[0]["qty_remaining"]) == Decimal("0.000")   # older lot exhausted
      assert Decimal(lots[1]["qty_remaining"]) == Decimal("5.000")   # newer lot: 6 - 1 consumed
  ```

- [ ] **Step 2: Run test — expect FAIL**

  ```bash
  cd api && uv run pytest tests/test_receipts_api.py::test_fifo_deducts_oldest_lot_first -v
  ```

  Expected: ImportError — `_deduct_fifo` does not exist yet.

- [ ] **Step 3: Add `_deduct_fifo` helper and update `create_order` in `api/app/services/orders.py`**

  **a) Add imports** at the top of `orders.py`:
  ```python
  from app.models.receipts import StockLot, StockReceipt
  from app.enums import ReceiptStatus
  from datetime import date as _date
  ```

  **b) Add `_deduct_fifo` helper** in the helpers section (after `_load_order`):

  ```python
  async def _deduct_fifo(
      db: AsyncSession,
      *,
      store_id: str,
      user_id: str,
      inventory_item_id: str,
      total_qty: Decimal,
      ref_order_id: str,
      order_number: int,
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
          reason=f"Order #{order_number}",
          ref_order_id=ref_order_id,
          created_by_id=user_id,
      ))
  ```

  **c) Replace the direct deduction loop in `create_order`** (lines 107–119):

  ```python
  # Before
  for inv_item_id, total_qty in inv_deductions.items():
      inv_item = await db.get(InventoryItem, inv_item_id)
      if inv_item:
          inv_item.stock_on_hand = inv_item.stock_on_hand - total_qty
          db.add(StockMovement(
              store_id=store_id,
              inventory_item_id=inv_item_id,
              type=MovementType.SALE,
              quantity=total_qty,
              reason=f"Order #{order.order_number}",
              ref_order_id=order.id,
              created_by_id=user_id,
          ))

  # After
  for inv_item_id, total_qty in inv_deductions.items():
      await _deduct_fifo(
          db,
          store_id=store_id,
          user_id=user_id,
          inventory_item_id=inv_item_id,
          total_qty=total_qty,
          ref_order_id=order.id,
          order_number=order.order_number,
      )
  ```

  **d) Update `void_order`** to also create a compensating lot when restoring stock (lines 222–234). Replace the stock restore block:

  ```python
  # Before
  for mv in sale_movements:
      inv_item = await db.get(InventoryItem, mv.inventory_item_id)
      if inv_item:
          inv_item.stock_on_hand = inv_item.stock_on_hand + mv.quantity
      db.add(StockMovement(
          store_id=store_id,
          inventory_item_id=mv.inventory_item_id,
          type=MovementType.ADJUST,
          quantity=mv.quantity,
          reason=f"VOID|Order #{order.order_number}",
          ref_order_id=order.id,
          created_by_id=user_id,
      ))

  # After
  cancel_receipt = StockReceipt(
      store_id=store_id,
      status=ReceiptStatus.CONFIRMED,
      receipt_ref="ORDER_CANCEL",
      note=f"Voided order #{order.order_number}",
      received_at=_date.today(),
      created_by_id=user_id,
  )
  db.add(cancel_receipt)
  await db.flush()

  for mv in sale_movements:
      inv_item = await db.get(InventoryItem, mv.inventory_item_id)
      if inv_item:
          inv_item.stock_on_hand = inv_item.stock_on_hand + mv.quantity
          db.add(StockLot(
              store_id=store_id,
              receipt_id=cancel_receipt.id,
              inventory_item_id=mv.inventory_item_id,
              qty_received=mv.quantity,
              qty_remaining=mv.quantity,
              cost_per_unit=inv_item.cost_per_unit,
          ))
      db.add(StockMovement(
          store_id=store_id,
          inventory_item_id=mv.inventory_item_id,
          type=MovementType.ADJUST,
          quantity=mv.quantity,
          reason=f"VOID|Order #{order.order_number}",
          ref_order_id=order.id,
          created_by_id=user_id,
      ))
  ```

- [ ] **Step 4: Run FIFO test — expect PASS**

  ```bash
  cd api && uv run pytest tests/test_receipts_api.py::test_fifo_deducts_oldest_lot_first -v
  ```

  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add api/app/services/orders.py
  git commit -m "feat: replace direct stock deduction with FIFO lot-aware _deduct_fifo"
  ```

---

## Task 9: Fix Existing Tests + Full Suite

**Files:**
- Modify: `api/tests/test_inventory_api.py`
- Modify: `api/tests/test_inventory_service.py` (if it references `receive_stock` or `expiry_date`)

- [ ] **Step 1: Remove the test for the deleted `/receive` endpoint**

  In `api/tests/test_inventory_api.py`, delete the entire `test_post_receive_increments_stock` function (lines 31–46).

- [ ] **Step 2: Check inventory service tests for broken references**

  ```bash
  grep -n "receive_stock\|expiry_date\|ReceiveStockRequest" api/tests/test_inventory_service.py
  ```

  For each match: remove or update the test to not reference the deleted function/field.

- [ ] **Step 3: Run the full test suite**

  ```bash
  cd api && uv run pytest -v
  ```

  Expected: all tests pass. If any test fails due to `expiry_date` appearing in request/response bodies, remove that field from the test payload or assertion.

- [ ] **Step 4: Commit**

  ```bash
  git add api/tests/
  git commit -m "test: remove receive endpoint test, update inventory tests for schema changes"
  ```

---

## Task 10: Smoke Test Dev Server

- [ ] **Step 1: Start the dev server**

  From `api/`:
  ```bash
  uv run uvicorn app.main:app --reload --port 8000
  ```

- [ ] **Step 2: Verify new routes appear in OpenAPI docs**

  Open `http://localhost:8000/docs` and confirm:
  - `POST /api/v1/receipts` is present
  - `GET /api/v1/receipts` is present
  - `POST /api/v1/receipts/{receipt_id}/confirm` is present
  - `GET /api/v1/inventory/{item_id}/lots` is present
  - `POST /api/v1/inventory/receive` is **absent**
  - `GET /api/v1/inventory/expired` returns `ExpiredLotRead` shape

- [ ] **Step 3: Final commit**

  ```bash
  git add -A
  git commit -m "chore: batch receipt inventory feature complete"
  ```
