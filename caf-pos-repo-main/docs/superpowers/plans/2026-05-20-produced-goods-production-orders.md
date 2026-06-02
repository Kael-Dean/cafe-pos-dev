# Produced Goods & Production Orders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `PRODUCED` product type with batch-yield tracking, auto-paired finished-goods inventory items, and a `/production-orders` module that atomically deducts raw ingredients and replenishes finished stock.

**Architecture:** `product_type` on `Product` branches the order-fulfillment stock-deduction path. `PRODUCED` products auto-create a linked `InventoryItem` on creation; production runs are recorded via a new `ProductionOrder` model that writes `StockMovement` records for both sides atomically. Cost/margin math stays frontend-only — `servings_per_batch` is returned in `ProductDetail`.

**Tech Stack:** FastAPI, SQLAlchemy 2.x async, Alembic, PostgreSQL, pytest-asyncio, uv

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `api/app/enums.py` | Modify | Add `ProductType`; add `PRODUCTION`, `PRODUCTION_USE` to `MovementType` |
| `api/app/models/catalog.py` | Modify | Add 3 columns to `Product` |
| `api/app/models/production.py` | Create | `ProductionOrder` ORM model |
| `api/app/models/__init__.py` | Modify | Import `ProductionOrder` |
| `api/alembic/versions/0016_produced_goods.py` | Create | Migration: enum values + product columns + production_orders table |
| `api/app/schemas/catalog.py` | Modify | Add `product_type`, `servings_per_batch`, `finished_goods_item_id` to product schemas |
| `api/app/schemas/production.py` | Create | `ProductionOrderCreate`, `ProductionOrderRead` |
| `api/app/services/catalog.py` | Modify | Auto-pair `InventoryItem` on PRODUCED create; handle type switching in update |
| `api/app/services/orders.py` | Modify | Branch stock deduction on `product_type` |
| `api/app/services/production.py` | Create | `create_production_order`, `list_production_orders`, `get_production_order` |
| `api/app/api/v1/production.py` | Create | Production router — POST, GET list, GET single |
| `api/app/api/v1/router.py` | Modify | Register production router |
| `api/tests/factories.py` | Modify | Add `make_produced_product`, `make_production_order` |
| `api/tests/test_catalog_service.py` | Modify | Tests for PRODUCED product creation and type switching |
| `api/tests/test_orders_service.py` | Modify | Regression + PRODUCED deduction tests |
| `api/tests/test_production_api.py` | Create | Full API test suite for `/production-orders` |
| `CLAUDE.md` | Modify | Add `ProductionOrder` to model map; add `production` to API modules |

---

## Task 1: Enums — ProductType and MovementType additions

**Files:**
- Modify: `api/app/enums.py`

- [ ] **Step 1: Add `ProductType` enum and two new `MovementType` values**

  Open `api/app/enums.py`. Add `ProductType` after the `Role` class and append two values to `MovementType`:

  ```python
  class ProductType(str, enum.Enum):
      MADE_TO_ORDER = "MADE_TO_ORDER"
      PRODUCED = "PRODUCED"
  ```

  Change `MovementType` to:

  ```python
  class MovementType(str, enum.Enum):
      RECEIVE = "RECEIVE"
      SALE = "SALE"
      WASTE = "WASTE"
      ADJUST = "ADJUST"
      TRANSFER_IN = "TRANSFER_IN"
      TRANSFER_OUT = "TRANSFER_OUT"
      PRODUCTION_USE = "PRODUCTION_USE"   # raw ingredients consumed in a production run
      PRODUCTION = "PRODUCTION"           # finished goods added by a production run
  ```

- [ ] **Step 2: Commit**

  ```bash
  cd api
  git add app/enums.py
  git commit -m "feat: add ProductType enum and PRODUCTION/PRODUCTION_USE movement types"
  ```

---

## Task 2: Product model — three new columns

**Files:**
- Modify: `api/app/models/catalog.py`

- [ ] **Step 1: Update imports in catalog.py**

  Change the SQLAlchemy import line from:
  ```python
  from sqlalchemy import Boolean, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
  ```
  to:
  ```python
  from sqlalchemy import Boolean, Enum as SAEnum, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
  ```

  Add `ProductType` to the enums import:
  ```python
  from app.enums import ProductType
  ```

- [ ] **Step 2: Add columns to the `Product` class**

  After the `is_active` column in `Product`, add:

  ```python
  product_type: Mapped[ProductType] = mapped_column(
      SAEnum(ProductType, name="product_type"),
      nullable=False,
      default=ProductType.MADE_TO_ORDER,
  )
  servings_per_batch: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
  finished_goods_item_id: Mapped[str | None] = mapped_column(
      String(24), ForeignKey("inventory_items.id", ondelete="SET NULL"), nullable=True
  )
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add app/models/catalog.py
  git commit -m "feat: add product_type, servings_per_batch, finished_goods_item_id to Product model"
  ```

---

## Task 3: ProductionOrder model

**Files:**
- Create: `api/app/models/production.py`
- Modify: `api/app/models/__init__.py`

- [ ] **Step 1: Create `api/app/models/production.py`**

  ```python
  from datetime import datetime

  from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
  from sqlalchemy.orm import Mapped, mapped_column

  from app.db.base import Base
  from app.db.types import new_cuid


  class ProductionOrder(Base):
      __tablename__ = "production_orders"

      id: Mapped[str] = mapped_column(String(24), primary_key=True, default=new_cuid)
      store_id: Mapped[str] = mapped_column(
          String(24), ForeignKey("stores.id", ondelete="CASCADE"), nullable=False, index=True
      )
      product_id: Mapped[str] = mapped_column(
          String(24), ForeignKey("products.id", ondelete="RESTRICT"), nullable=False
      )
      batches_count: Mapped[int] = mapped_column(Integer, nullable=False)
      units_produced: Mapped[int] = mapped_column(Integer, nullable=False)
      produced_by: Mapped[str] = mapped_column(
          String(24), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
      )
      produced_at: Mapped[datetime] = mapped_column(
          DateTime(timezone=True), server_default=func.now(), nullable=False
      )
      notes: Mapped[str | None] = mapped_column(Text, nullable=True)
  ```

- [ ] **Step 2: Register in `api/app/models/__init__.py`**

  Add import at the top:
  ```python
  from app.models.production import ProductionOrder
  ```

  Add `"ProductionOrder"` to `__all__`.

  Full updated `__all__`:
  ```python
  __all__ = [
      "CookingStep",
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
      "PreOrder",
      "PreOrderItem",
      "ShoppingListItem",
      "ProductionOrder",
  ]
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add app/models/production.py app/models/__init__.py
  git commit -m "feat: add ProductionOrder model"
  ```

---

## Task 4: Alembic migration 0016

**Files:**
- Create: `api/alembic/versions/0016_produced_goods.py`

- [ ] **Step 1: Generate autogenerate stub**

  Run from `api/`:
  ```bash
  uv run alembic revision --autogenerate -m "produced_goods"
  ```

  This creates a file like `alembic/versions/<hash>_produced_goods.py`. Rename it to `0016_produced_goods.py` and open it.

- [ ] **Step 2: Replace the generated file content**

  Autogenerate will NOT handle adding values to an existing Postgres enum. Replace the entire file with:

  ```python
  """Add product_type, servings_per_batch, finished_goods_item_id to products; add production_orders table.

  Revision ID: 0016
  Revises: 0015
  Create Date: 2026-05-20
  """
  import sqlalchemy as sa
  from alembic import op

  revision = "0016"
  down_revision = "0015"
  branch_labels = None
  depends_on = None


  def upgrade() -> None:
      # 1. Extend movement_type enum (Postgres allows ADD VALUE but not DROP VALUE)
      op.execute("ALTER TYPE movement_type ADD VALUE IF NOT EXISTS 'PRODUCTION_USE'")
      op.execute("ALTER TYPE movement_type ADD VALUE IF NOT EXISTS 'PRODUCTION'")

      # 2. Create product_type enum
      op.execute("CREATE TYPE product_type AS ENUM ('MADE_TO_ORDER', 'PRODUCED')")

      # 3. Add columns to products
      op.add_column(
          "products",
          sa.Column(
              "product_type",
              sa.Enum("MADE_TO_ORDER", "PRODUCED", name="product_type"),
              nullable=False,
              server_default="MADE_TO_ORDER",
          ),
      )
      op.add_column(
          "products",
          sa.Column("servings_per_batch", sa.Integer(), nullable=False, server_default="1"),
      )
      op.add_column(
          "products",
          sa.Column("finished_goods_item_id", sa.String(24), nullable=True),
      )
      op.create_foreign_key(
          "fk_products_finished_goods_item",
          "products",
          "inventory_items",
          ["finished_goods_item_id"],
          ["id"],
          ondelete="SET NULL",
      )

      # 4. Create production_orders table
      op.create_table(
          "production_orders",
          sa.Column("id", sa.String(24), primary_key=True),
          sa.Column(
              "store_id",
              sa.String(24),
              sa.ForeignKey("stores.id", ondelete="CASCADE"),
              nullable=False,
              index=True,
          ),
          sa.Column(
              "product_id",
              sa.String(24),
              sa.ForeignKey("products.id", ondelete="RESTRICT"),
              nullable=False,
          ),
          sa.Column("batches_count", sa.Integer(), nullable=False),
          sa.Column("units_produced", sa.Integer(), nullable=False),
          sa.Column(
              "produced_by",
              sa.String(24),
              sa.ForeignKey("users.id", ondelete="RESTRICT"),
              nullable=False,
          ),
          sa.Column(
              "produced_at",
              sa.DateTime(timezone=True),
              server_default=sa.text("now()"),
              nullable=False,
          ),
          sa.Column("notes", sa.Text(), nullable=True),
      )
      op.create_index("ix_production_orders_store_id", "production_orders", ["store_id"])


  def downgrade() -> None:
      op.drop_table("production_orders")
      op.drop_constraint("fk_products_finished_goods_item", "products", type_="foreignkey")
      op.drop_column("products", "finished_goods_item_id")
      op.drop_column("products", "servings_per_batch")
      op.drop_column("products", "product_type")
      op.execute("DROP TYPE IF EXISTS product_type")
      # Note: Postgres does not support removing enum values — PRODUCTION_USE and PRODUCTION
      # remain in movement_type enum after downgrade.
  ```

- [ ] **Step 3: Apply the migration**

  ```bash
  uv run alembic upgrade head
  ```

  Expected output ends with: `Running upgrade 0015 -> 0016, Add product_type, servings_per_batch ...`

- [ ] **Step 4: Commit**

  ```bash
  git add alembic/versions/0016_produced_goods.py
  git commit -m "feat: migration 0016 — product_type, servings_per_batch, production_orders"
  ```

---

## Task 5: Extend catalog schemas

**Files:**
- Modify: `api/app/schemas/catalog.py`

- [ ] **Step 1: Add `ProductType` import**

  Add to the imports at the top of `catalog.py`:
  ```python
  from app.enums import ProductType
  ```

- [ ] **Step 2: Extend `ProductRead`**

  Add three fields:
  ```python
  class ProductRead(_ORM):
      id: str
      store_id: str
      category_id: str | None
      name: str
      description: str | None
      price: Decimal
      is_active: bool
      product_type: ProductType
      servings_per_batch: int
      finished_goods_item_id: str | None
      created_at: datetime
      updated_at: datetime
  ```

- [ ] **Step 3: Extend `ProductCreate`**

  ```python
  class ProductCreate(BaseModel):
      category_id: str | None = None
      name: str = Field(min_length=1, max_length=120)
      description: str | None = Field(None, max_length=500)
      price: Decimal = Field(ge=Decimal("0"), le=Decimal("999999.99"))
      is_active: bool = True
      product_type: ProductType = ProductType.MADE_TO_ORDER
      servings_per_batch: int = Field(1, ge=1)
  ```

  Note: `finished_goods_item_id` is NOT in create payload — it is set automatically by the service.

- [ ] **Step 4: Extend `ProductUpdate`**

  ```python
  class ProductUpdate(BaseModel):
      category_id: str | None = None
      name: str | None = Field(None, min_length=1, max_length=120)
      description: str | None = None
      price: Decimal | None = Field(None, ge=Decimal("0"), le=Decimal("999999.99"))
      is_active: bool | None = None
      product_type: ProductType | None = None
      servings_per_batch: int | None = Field(None, ge=1)
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add app/schemas/catalog.py
  git commit -m "feat: add product_type, servings_per_batch, finished_goods_item_id to catalog schemas"
  ```

---

## Task 6: Production schemas

**Files:**
- Create: `api/app/schemas/production.py`

- [ ] **Step 1: Create `api/app/schemas/production.py`**

  ```python
  from datetime import datetime

  from pydantic import BaseModel, ConfigDict, Field


  class ProductionOrderCreate(BaseModel):
      product_id: str
      batches_count: int = Field(ge=1)
      notes: str | None = Field(None, max_length=500)


  class ProductionOrderRead(BaseModel):
      model_config = ConfigDict(from_attributes=True)

      id: str
      store_id: str
      product_id: str
      batches_count: int
      units_produced: int
      produced_by: str
      produced_at: datetime
      notes: str | None
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add app/schemas/production.py
  git commit -m "feat: add ProductionOrderCreate and ProductionOrderRead schemas"
  ```

---

## Task 7: Catalog service — create_product auto-pair (TDD)

**Files:**
- Modify: `api/app/services/catalog.py`
- Modify: `api/tests/test_catalog_service.py`

- [ ] **Step 1: Write failing tests**

  Append to `api/tests/test_catalog_service.py`:

  ```python
  # ---------------------------------------------------------------------------
  # Product type — PRODUCED creation
  # ---------------------------------------------------------------------------


  @pytest.mark.asyncio
  async def test_create_produced_product_auto_creates_inventory_item(db, store_a):
      from app.enums import ProductType
      from app.models.inventory import InventoryItem
      from sqlalchemy import select

      payload = ProductCreate(
          name=f"Cookies-{uid()}",
          price=Decimal("25.00"),
          product_type=ProductType.PRODUCED,
          servings_per_batch=24,
      )
      product = await svc.create_product(db, store_id=store_a.id, payload=payload)

      assert product.product_type == ProductType.PRODUCED
      assert product.servings_per_batch == 24
      assert product.finished_goods_item_id is not None

      result = await db.execute(
          select(InventoryItem).where(InventoryItem.id == product.finished_goods_item_id)
      )
      inv_item = result.scalar_one_or_none()
      assert inv_item is not None
      assert inv_item.unit == "piece"
      assert inv_item.store_id == store_a.id


  @pytest.mark.asyncio
  async def test_create_made_to_order_product_no_inventory_item(db, store_a):
      from app.enums import ProductType

      payload = ProductCreate(
          name=f"Latte-{uid()}",
          price=Decimal("85.00"),
          product_type=ProductType.MADE_TO_ORDER,
      )
      product = await svc.create_product(db, store_id=store_a.id, payload=payload)

      assert product.product_type == ProductType.MADE_TO_ORDER
      assert product.finished_goods_item_id is None
  ```

- [ ] **Step 2: Run tests — expect FAIL**

  ```bash
  uv run pytest tests/test_catalog_service.py::test_create_produced_product_auto_creates_inventory_item tests/test_catalog_service.py::test_create_made_to_order_product_no_inventory_item -v
  ```

  Expected: both tests FAIL (TypeError or AttributeError because `product_type` argument not handled yet).

- [ ] **Step 3: Update `create_product` in `api/app/services/catalog.py`**

  Add imports at the top of the file:
  ```python
  from decimal import Decimal

  from app.enums import ProductType
  from app.models.inventory import InventoryItem
  ```

  Replace the `create_product` function:

  ```python
  async def create_product(
      db: AsyncSession, *, store_id: str, payload: ProductCreate
  ) -> Product:
      async with db.begin():
          if payload.category_id:
              await _load_category(db, store_id=store_id, category_id=payload.category_id)
          product = Product(
              store_id=store_id,
              category_id=payload.category_id,
              name=payload.name,
              description=payload.description,
              price=payload.price,
              is_active=payload.is_active,
              product_type=payload.product_type,
              servings_per_batch=payload.servings_per_batch,
          )
          db.add(product)

          if payload.product_type == ProductType.PRODUCED:
              await db.flush()
              inv_item = InventoryItem(
                  store_id=store_id,
                  name=payload.name,
                  unit="piece",
                  cost_per_unit=Decimal("0"),
                  stock_on_hand=Decimal("0"),
                  par_level=Decimal("0"),
              )
              db.add(inv_item)
              await db.flush()
              product.finished_goods_item_id = inv_item.id

      return product
  ```

- [ ] **Step 4: Run tests — expect PASS**

  ```bash
  uv run pytest tests/test_catalog_service.py::test_create_produced_product_auto_creates_inventory_item tests/test_catalog_service.py::test_create_made_to_order_product_no_inventory_item -v
  ```

  Expected: both PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add app/services/catalog.py tests/test_catalog_service.py
  git commit -m "feat: auto-create paired InventoryItem when creating a PRODUCED product"
  ```

---

## Task 8: Add make_produced_product factory

**Files:**
- Modify: `api/tests/factories.py`

- [ ] **Step 1: Add `make_produced_product` to `api/tests/factories.py`**

  Add imports at the top:
  ```python
  from app.enums import ProductType
  from app.models import Product
  ```

  Append the function:

  ```python
  async def make_produced_product(
      db: AsyncSession,
      *,
      store_id: str,
      name: str = "Cookies",
      price: Decimal = Decimal("25.00"),
      servings_per_batch: int = 12,
  ) -> Product:
      """Creates a PRODUCED product and auto-pairs its finished-goods InventoryItem."""
      from app.schemas.catalog import ProductCreate
      from app.services import catalog as svc

      payload = ProductCreate(
          name=name,
          price=price,
          product_type=ProductType.PRODUCED,
          servings_per_batch=servings_per_batch,
      )
      return await svc.create_product(db, store_id=store_id, payload=payload)
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add tests/factories.py
  git commit -m "test: add make_produced_product factory"
  ```

---

## Task 9: Catalog service — update_product type switching (TDD)

**Files:**
- Modify: `api/app/services/catalog.py`
- Modify: `api/tests/test_catalog_service.py`

- [ ] **Step 1: Write failing tests**

  Append to `api/tests/test_catalog_service.py`:

  ```python
  @pytest.mark.asyncio
  async def test_switch_made_to_order_to_produced_creates_inventory_item(db, store_a):
      from app.enums import ProductType
      from app.models.inventory import InventoryItem
      from app.schemas.catalog import ProductUpdate
      from sqlalchemy import select

      product = await make_product(db, store_id=store_a.id, name=f"Brownie-{uid()}")
      assert product.finished_goods_item_id is None

      updated = await svc.update_product(
          db,
          store_id=store_a.id,
          product_id=product.id,
          payload=ProductUpdate(product_type=ProductType.PRODUCED, servings_per_batch=16),
      )

      assert updated.product_type == ProductType.PRODUCED
      assert updated.finished_goods_item_id is not None

      result = await db.execute(
          select(InventoryItem).where(InventoryItem.id == updated.finished_goods_item_id)
      )
      assert result.scalar_one_or_none() is not None


  @pytest.mark.asyncio
  async def test_switch_produced_to_made_to_order_nulls_link_preserves_item(db, store_a):
      from app.enums import ProductType
      from app.models.inventory import InventoryItem
      from app.schemas.catalog import ProductUpdate
      from sqlalchemy import select
      from tests.factories import make_produced_product

      product = await make_produced_product(db, store_id=store_a.id, name=f"Muffin-{uid()}")
      original_inv_id = product.finished_goods_item_id
      assert original_inv_id is not None

      updated = await svc.update_product(
          db,
          store_id=store_a.id,
          product_id=product.id,
          payload=ProductUpdate(product_type=ProductType.MADE_TO_ORDER),
      )

      assert updated.product_type == ProductType.MADE_TO_ORDER
      assert updated.finished_goods_item_id is None

      # InventoryItem still exists
      result = await db.execute(
          select(InventoryItem).where(InventoryItem.id == original_inv_id)
      )
      assert result.scalar_one_or_none() is not None
  ```

- [ ] **Step 2: Run tests — expect FAIL**

  ```bash
  uv run pytest tests/test_catalog_service.py::test_switch_made_to_order_to_produced_creates_inventory_item tests/test_catalog_service.py::test_switch_produced_to_made_to_order_nulls_link_preserves_item -v
  ```

  Expected: both FAIL.

- [ ] **Step 3: Update `update_product` in `api/app/services/catalog.py`**

  Replace the `update_product` function:

  ```python
  async def update_product(
      db: AsyncSession, *, store_id: str, product_id: str, payload: ProductUpdate
  ) -> Product:
      async with db.begin():
          product = await _load_product(db, store_id=store_id, product_id=product_id)

          if "category_id" in payload.model_fields_set:
              if payload.category_id:
                  await _load_category(db, store_id=store_id, category_id=payload.category_id)
              product.category_id = payload.category_id

          simple_fields = payload.model_fields_set - {"category_id", "product_type"}
          for field in simple_fields:
              setattr(product, field, getattr(payload, field))

          if "product_type" in payload.model_fields_set and payload.product_type is not None:
              new_type = payload.product_type
              if new_type == ProductType.PRODUCED and product.product_type != ProductType.PRODUCED:
                  inv_item = InventoryItem(
                      store_id=store_id,
                      name=product.name,
                      unit="piece",
                      cost_per_unit=Decimal("0"),
                      stock_on_hand=Decimal("0"),
                      par_level=Decimal("0"),
                  )
                  db.add(inv_item)
                  await db.flush()
                  product.finished_goods_item_id = inv_item.id
              elif new_type == ProductType.MADE_TO_ORDER and product.product_type != ProductType.MADE_TO_ORDER:
                  product.finished_goods_item_id = None
              product.product_type = new_type

      return product
  ```

- [ ] **Step 4: Run tests — expect PASS**

  ```bash
  uv run pytest tests/test_catalog_service.py::test_switch_made_to_order_to_produced_creates_inventory_item tests/test_catalog_service.py::test_switch_produced_to_made_to_order_nulls_link_preserves_item -v
  ```

  Expected: both PASS.

- [ ] **Step 5: Run full catalog test suite to check for regressions**

  ```bash
  uv run pytest tests/test_catalog_service.py -v
  ```

  Expected: all pass.

- [ ] **Step 6: Commit**

  ```bash
  git add app/services/catalog.py tests/test_catalog_service.py
  git commit -m "feat: handle product_type switching in update_product with auto-pair logic"
  ```

---

## Task 10: Orders service — branch on product_type (TDD)

**Files:**
- Modify: `api/app/services/orders.py`
- Modify: `api/tests/test_orders_service.py`

- [ ] **Step 1: Write failing tests**

  Append to `api/tests/test_orders_service.py`. First check that file's imports and add what's missing; then append:

  ```python
  # ---------------------------------------------------------------------------
  # PRODUCED product — stock deduction branches
  # ---------------------------------------------------------------------------

  from tests.factories import make_produced_product


  @pytest.mark.asyncio
  async def test_ordering_produced_product_deducts_finished_goods_not_ingredients(
      db, store_a, user_a
  ):
      from decimal import Decimal
      from app.enums import ProductType
      from app.models.catalog import RecipeItem
      from app.models.inventory import InventoryItem
      from app.schemas.orders import CreateOrderRequest, OrderItemRequest
      from app.services import orders as order_svc
      from sqlalchemy import select

      # Create raw ingredient with stock
      flour = await make_item(db, store_id=store_a.id, name=f"Flour-{uid()}", stock=Decimal("500"))

      # Create PRODUCED product with recipe and 50 finished goods in stock
      cookies = await make_produced_product(
          db, store_id=store_a.id, name=f"Cookie-{uid()}", servings_per_batch=12
      )

      # Add recipe: 300g flour per batch
      db.add(RecipeItem(
          product_id=cookies.id,
          inventory_item_id=flour.id,
          quantity=Decimal("300"),
      ))
      await db.commit()

      # Seed finished goods stock
      result = await db.execute(
          select(InventoryItem).where(InventoryItem.id == cookies.finished_goods_item_id)
      )
      fg_item = result.scalar_one()
      fg_item.stock_on_hand = Decimal("50")
      await db.commit()

      req = CreateOrderRequest(
          items=[OrderItemRequest(product_id=cookies.id, quantity=3, modifier_ids=[])],
          channel="DINE_IN",
          idempotency_key=uid("ord-"),
      )
      await order_svc.create_order(db, store_id=store_a.id, user_id=user_a.id, req=req)

      # Finished goods should be decremented by 3
      await db.refresh(fg_item)
      assert fg_item.stock_on_hand == Decimal("47")

      # Raw flour should NOT be touched
      await db.refresh(flour)
      assert flour.stock_on_hand == Decimal("500")


  @pytest.mark.asyncio
  async def test_ordering_made_to_order_still_deducts_recipe_ingredients(db, store_a, user_a):
      from decimal import Decimal
      from app.models.catalog import RecipeItem
      from app.schemas.orders import CreateOrderRequest, OrderItemRequest
      from app.services import orders as order_svc

      milk = await make_item(db, store_id=store_a.id, name=f"Milk-{uid()}", stock=Decimal("1000"))
      product = await make_product(db, store_id=store_a.id, name=f"Latte-{uid()}")

      db.add(RecipeItem(
          product_id=product.id,
          inventory_item_id=milk.id,
          quantity=Decimal("200"),
      ))
      await db.commit()

      req = CreateOrderRequest(
          items=[OrderItemRequest(product_id=product.id, quantity=2, modifier_ids=[])],
          channel="DINE_IN",
          idempotency_key=uid("ord-"),
      )
      await order_svc.create_order(db, store_id=store_a.id, user_id=user_a.id, req=req)

      await db.refresh(milk)
      assert milk.stock_on_hand == Decimal("600")  # 1000 - (200 × 2)
  ```

  Note: `uid` is already defined in `test_catalog_service.py` — add it to `test_orders_service.py` as well if not already present:

  ```python
  import secrets
  def uid(prefix: str = "") -> str:
      return f"{prefix}{secrets.token_hex(4)}"
  ```

- [ ] **Step 2: Run tests — expect FAIL**

  ```bash
  uv run pytest tests/test_orders_service.py::test_ordering_produced_product_deducts_finished_goods_not_ingredients tests/test_orders_service.py::test_ordering_made_to_order_still_deducts_recipe_ingredients -v
  ```

  Expected: FAIL (`test_ordering_produced_product_deducts_finished_goods_not_ingredients` deducts recipe ingredients instead of finished goods).

- [ ] **Step 3: Update `create_order` in `api/app/services/orders.py`**

  Add `ProductType` to the imports:
  ```python
  from app.enums import MovementType, OrderStatus, ProductType, ReceiptStatus
  ```

  In `line_data.append({...})`, add two new keys:
  ```python
  line_data.append({
      "product_id": product.id,
      "product_name": product.name,
      "quantity": item_in.quantity,
      "unit_price": unit_price,
      "line_total": unit_price * item_in.quantity,
      "modifiers_json": _snapshot_modifiers(modifiers) if modifiers else None,
      "mod_inv": mod_inv,
      "product_type": product.product_type,
      "finished_goods_item_id": product.finished_goods_item_id,
  })
  ```

  Replace the recipe-deduction block inside the `for ld in line_data:` loop:

  ```python
  for ld in line_data:
      db.add(OrderItem(
          order_id=order.id,
          product_id=ld["product_id"],
          product_name=ld["product_name"],
          quantity=ld["quantity"],
          unit_price=ld["unit_price"],
          line_total=ld["line_total"],
          modifiers_json=ld["modifiers_json"],
      ))

      if ld["product_type"] == ProductType.PRODUCED:
          if not ld["finished_goods_item_id"]:
              raise HTTPException(
                  status_code=500,
                  detail="PRODUCT_MISCONFIGURED: PRODUCED product has no finished_goods_item_id",
              )
          qty = Decimal(str(ld["quantity"]))
          inv_deductions[ld["finished_goods_item_id"]] = (
              inv_deductions.get(ld["finished_goods_item_id"], Decimal("0")) + qty
          )
      else:
          for ri in await _load_recipe(db, product_id=ld["product_id"]):
              qty = ri.quantity * ld["quantity"]
              inv_deductions[ri.inventory_item_id] = (
                  inv_deductions.get(ri.inventory_item_id, Decimal("0")) + qty
              )

      for inv_item_id, qty_per_unit in ld["mod_inv"]:
          qty = qty_per_unit * ld["quantity"]
          inv_deductions[inv_item_id] = (
              inv_deductions.get(inv_item_id, Decimal("0")) + qty
          )
  ```

  Add `HTTPException` to the FastAPI import at the top of `orders.py`:
  ```python
  from fastapi import HTTPException
  ```

- [ ] **Step 4: Run tests — expect PASS**

  ```bash
  uv run pytest tests/test_orders_service.py::test_ordering_produced_product_deducts_finished_goods_not_ingredients tests/test_orders_service.py::test_ordering_made_to_order_still_deducts_recipe_ingredients -v
  ```

  Expected: both PASS.

- [ ] **Step 5: Run full orders test suite for regressions**

  ```bash
  uv run pytest tests/test_orders_service.py -v
  ```

  Expected: all pass.

- [ ] **Step 6: Commit**

  ```bash
  git add app/services/orders.py tests/test_orders_service.py
  git commit -m "feat: branch order stock deduction on product_type — PRODUCED deducts finished goods"
  ```

---

## Task 11: Production service (TDD)

**Files:**
- Create: `api/app/services/production.py`
- Create: `api/tests/test_production_api.py` (service-layer tests in this task, API-layer in Task 13)

- [ ] **Step 1: Write failing service-layer tests**

  Create `api/tests/test_production_api.py`:

  ```python
  """Tests for the production orders feature (service layer and API layer)."""
  import secrets
  from decimal import Decimal

  import pytest

  from tests.conftest import make_item
  from tests.factories import make_produced_product


  def uid(prefix: str = "") -> str:
      return f"{prefix}{secrets.token_hex(4)}"


  # ---------------------------------------------------------------------------
  # Service-layer tests
  # ---------------------------------------------------------------------------


  @pytest.mark.asyncio
  async def test_create_production_order_deducts_ingredients_adds_finished_goods(
      db, store_a, user_a
  ):
      from decimal import Decimal
      from app.enums import MovementType
      from app.models.catalog import RecipeItem
      from app.models.inventory import InventoryItem, StockMovement
      from app.schemas.production import ProductionOrderCreate
      from app.services import production as svc
      from sqlalchemy import select

      flour = await make_item(db, store_id=store_a.id, name=f"Flour-{uid()}", stock=Decimal("1000"))
      butter = await make_item(db, store_id=store_a.id, name=f"Butter-{uid()}", stock=Decimal("500"))

      cookies = await make_produced_product(
          db, store_id=store_a.id, name=f"Cookie-{uid()}", servings_per_batch=24
      )

      # Recipe: 500g flour + 250g butter per batch
      db.add(RecipeItem(product_id=cookies.id, inventory_item_id=flour.id, quantity=Decimal("500")))
      db.add(RecipeItem(product_id=cookies.id, inventory_item_id=butter.id, quantity=Decimal("250")))
      await db.commit()

      payload = ProductionOrderCreate(product_id=cookies.id, batches_count=2, notes="AM batch")
      order = await svc.create_production_order(
          db, store_id=store_a.id, user_id=user_a.id, payload=payload
      )

      assert order.batches_count == 2
      assert order.units_produced == 48  # 2 × 24
      assert order.notes == "AM batch"

      await db.refresh(flour)
      await db.refresh(butter)
      assert flour.stock_on_hand == Decimal("0")    # 1000 - (500 × 2)
      assert butter.stock_on_hand == Decimal("0")   # 500 - (250 × 2)

      fg_result = await db.execute(
          select(InventoryItem).where(InventoryItem.id == cookies.finished_goods_item_id)
      )
      fg = fg_result.scalar_one()
      assert fg.stock_on_hand == Decimal("48")

      # Verify movement types
      movements = list((await db.execute(
          select(StockMovement).where(StockMovement.inventory_item_id == flour.id)
      )).scalars())
      assert any(m.type == MovementType.PRODUCTION_USE for m in movements)

      fg_movements = list((await db.execute(
          select(StockMovement).where(StockMovement.inventory_item_id == cookies.finished_goods_item_id)
      )).scalars())
      assert any(m.type == MovementType.PRODUCTION for m in fg_movements)


  @pytest.mark.asyncio
  async def test_create_production_order_rejects_made_to_order_product(db, store_a, user_a):
      from app.core.errors import Unprocessable
      from app.schemas.production import ProductionOrderCreate
      from app.services import production as svc
      from tests.conftest import make_product

      product = await make_product(db, store_id=store_a.id, name=f"Latte-{uid()}")
      payload = ProductionOrderCreate(product_id=product.id, batches_count=1)

      with pytest.raises(Unprocessable):
          await svc.create_production_order(
              db, store_id=store_a.id, user_id=user_a.id, payload=payload
          )


  @pytest.mark.asyncio
  async def test_list_production_orders_scoped_to_store(db, store_a, store_b, user_a, user_b):
      from app.schemas.production import ProductionOrderCreate
      from app.services import production as svc

      cookies_a = await make_produced_product(db, store_id=store_a.id, name=f"CookieA-{uid()}")
      cookies_b = await make_produced_product(db, store_id=store_b.id, name=f"CookieB-{uid()}")

      await svc.create_production_order(
          db, store_id=store_a.id, user_id=user_a.id,
          payload=ProductionOrderCreate(product_id=cookies_a.id, batches_count=1),
      )
      await svc.create_production_order(
          db, store_id=store_b.id, user_id=user_b.id,
          payload=ProductionOrderCreate(product_id=cookies_b.id, batches_count=1),
      )

      orders_a = await svc.list_production_orders(db, store_id=store_a.id)
      assert all(o.store_id == store_a.id for o in orders_a)
  ```

- [ ] **Step 2: Run tests — expect FAIL**

  ```bash
  uv run pytest tests/test_production_api.py::test_create_production_order_deducts_ingredients_adds_finished_goods tests/test_production_api.py::test_create_production_order_rejects_made_to_order_product tests/test_production_api.py::test_list_production_orders_scoped_to_store -v
  ```

  Expected: all FAIL with `ModuleNotFoundError: app.services.production`.

- [ ] **Step 3: Create `api/app/services/production.py`**

  ```python
  from datetime import date, datetime, time
  from decimal import Decimal

  from fastapi import HTTPException
  from sqlalchemy import select
  from sqlalchemy.ext.asyncio import AsyncSession

  from app.core.errors import NotFound, Unprocessable
  from app.enums import MovementType, ProductType
  from app.models.catalog import Product, RecipeItem
  from app.models.inventory import InventoryItem, StockMovement
  from app.models.production import ProductionOrder
  from app.schemas.production import ProductionOrderCreate


  async def create_production_order(
      db: AsyncSession,
      *,
      store_id: str,
      user_id: str,
      payload: ProductionOrderCreate,
  ) -> ProductionOrder:
      async with db.begin():
          product = await _load_produced_product(db, store_id=store_id, product_id=payload.product_id)

          recipe_result = await db.execute(
              select(RecipeItem).where(RecipeItem.product_id == product.id)
          )
          recipe_items = list(recipe_result.scalars())

          units_produced = payload.batches_count * product.servings_per_batch

          for ri in recipe_items:
              total_qty = ri.quantity * payload.batches_count
              item_result = await db.execute(
                  select(InventoryItem).where(InventoryItem.id == ri.inventory_item_id)
              )
              inv_item = item_result.scalar_one_or_none()
              if inv_item:
                  inv_item.stock_on_hand -= total_qty
              db.add(StockMovement(
                  store_id=store_id,
                  inventory_item_id=ri.inventory_item_id,
                  type=MovementType.PRODUCTION_USE,
                  quantity=total_qty,
                  reason=f"Production: {product.name} ×{payload.batches_count}",
                  created_by_id=user_id,
              ))

          fg_result = await db.execute(
              select(InventoryItem).where(InventoryItem.id == product.finished_goods_item_id)
          )
          fg_item = fg_result.scalar_one_or_none()
          if fg_item:
              fg_item.stock_on_hand += Decimal(str(units_produced))
          db.add(StockMovement(
              store_id=store_id,
              inventory_item_id=product.finished_goods_item_id,
              type=MovementType.PRODUCTION,
              quantity=Decimal(str(units_produced)),
              reason=f"Production: {product.name} ×{payload.batches_count}",
              created_by_id=user_id,
          ))

          order = ProductionOrder(
              store_id=store_id,
              product_id=product.id,
              batches_count=payload.batches_count,
              units_produced=units_produced,
              produced_by=user_id,
              notes=payload.notes,
          )
          db.add(order)

      return order


  async def list_production_orders(
      db: AsyncSession,
      *,
      store_id: str,
      product_id: str | None = None,
      from_: date | None = None,
      to: date | None = None,
  ) -> list[ProductionOrder]:
      stmt = (
          select(ProductionOrder)
          .where(ProductionOrder.store_id == store_id)
          .order_by(ProductionOrder.produced_at.desc())
      )
      if product_id:
          stmt = stmt.where(ProductionOrder.product_id == product_id)
      if from_:
          stmt = stmt.where(ProductionOrder.produced_at >= datetime.combine(from_, time.min))
      if to:
          stmt = stmt.where(ProductionOrder.produced_at <= datetime.combine(to, time.max))
      result = await db.execute(stmt)
      return list(result.scalars())


  async def get_production_order(
      db: AsyncSession,
      *,
      store_id: str,
      order_id: str,
  ) -> ProductionOrder:
      result = await db.execute(
          select(ProductionOrder).where(
              ProductionOrder.id == order_id,
              ProductionOrder.store_id == store_id,
          )
      )
      order = result.scalar_one_or_none()
      if not order:
          raise NotFound("Production order not found")
      return order


  async def _load_produced_product(
      db: AsyncSession, *, store_id: str, product_id: str
  ) -> Product:
      result = await db.execute(
          select(Product).where(Product.id == product_id, Product.store_id == store_id)
      )
      product = result.scalar_one_or_none()
      if not product:
          raise NotFound("Product not found")
      if product.product_type != ProductType.PRODUCED:
          raise Unprocessable("Product is not a produced good")
      if not product.finished_goods_item_id:
          raise HTTPException(
              status_code=500,
              detail="PRODUCT_MISCONFIGURED: PRODUCED product has no finished_goods_item_id",
          )
      return product
  ```

- [ ] **Step 4: Run tests — expect PASS**

  ```bash
  uv run pytest tests/test_production_api.py::test_create_production_order_deducts_ingredients_adds_finished_goods tests/test_production_api.py::test_create_production_order_rejects_made_to_order_product tests/test_production_api.py::test_list_production_orders_scoped_to_store -v
  ```

  Expected: all PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add app/services/production.py tests/test_production_api.py
  git commit -m "feat: add production service — create/list/get production orders"
  ```

---

## Task 12: Add make_production_order factory

**Files:**
- Modify: `api/tests/factories.py`

- [ ] **Step 1: Append `make_production_order` to `api/tests/factories.py`**

  ```python
  async def make_production_order(
      db: AsyncSession,
      *,
      store_id: str,
      product_id: str,
      produced_by: str,
      batches_count: int = 1,
      notes: str | None = None,
  ):
      """Records a production run, deducting ingredients and adding finished goods."""
      from app.schemas.production import ProductionOrderCreate
      from app.services import production as svc

      payload = ProductionOrderCreate(
          product_id=product_id,
          batches_count=batches_count,
          notes=notes,
      )
      return await svc.create_production_order(
          db, store_id=store_id, user_id=produced_by, payload=payload
      )
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add tests/factories.py
  git commit -m "test: add make_production_order factory"
  ```

---

## Task 13: Production router and API tests

**Files:**
- Create: `api/app/api/v1/production.py`
- Modify: `api/app/api/v1/router.py`
- Modify: `api/tests/test_production_api.py`

- [ ] **Step 1: Write failing API tests**

  Append to `api/tests/test_production_api.py`:

  ```python
  # ---------------------------------------------------------------------------
  # API-layer tests
  # ---------------------------------------------------------------------------


  async def _login(client, store_slug: str, pin: str) -> str:
      resp = await client.post(
          "/api/v1/auth/login", json={"store_slug": store_slug, "pin": pin}
      )
      assert resp.status_code == 200, resp.text
      return resp.json()["access_token"]


  def _headers(token: str) -> dict:
      return {"Authorization": f"Bearer {token}"}


  @pytest.mark.asyncio
  async def test_api_create_production_order_returns_201(client, db, store_a, user_a):
      from app.models.catalog import RecipeItem

      flour = await make_item(db, store_id=store_a.id, name=f"Flour-API-{uid()}", stock=Decimal("1000"))
      cookies = await make_produced_product(
          db, store_id=store_a.id, name=f"CookieAPI-{uid()}", servings_per_batch=12
      )
      db.add(RecipeItem(product_id=cookies.id, inventory_item_id=flour.id, quantity=Decimal("400")))
      await db.commit()

      token = await _login(client, store_a.slug, "1111")
      resp = await client.post(
          "/api/v1/production-orders",
          headers=_headers(token),
          json={"product_id": cookies.id, "batches_count": 1, "notes": "Test run"},
      )
      assert resp.status_code == 201, resp.text
      data = resp.json()
      assert data["units_produced"] == 12
      assert data["batches_count"] == 1
      assert data["notes"] == "Test run"
      assert data["store_id"] == store_a.id


  @pytest.mark.asyncio
  async def test_api_list_production_orders(client, db, store_a, user_a):
      cookies = await make_produced_product(
          db, store_id=store_a.id, name=f"CookieList-{uid()}", servings_per_batch=6
      )
      from tests.factories import make_production_order
      await make_production_order(
          db, store_id=store_a.id, product_id=cookies.id, produced_by=user_a.id, batches_count=2
      )

      token = await _login(client, store_a.slug, "1111")
      resp = await client.get("/api/v1/production-orders", headers=_headers(token))
      assert resp.status_code == 200, resp.text
      ids = [o["product_id"] for o in resp.json()]
      assert cookies.id in ids


  @pytest.mark.asyncio
  async def test_api_get_production_order_by_id(client, db, store_a, user_a):
      cookies = await make_produced_product(
          db, store_id=store_a.id, name=f"CookieGet-{uid()}", servings_per_batch=8
      )
      from tests.factories import make_production_order
      order = await make_production_order(
          db, store_id=store_a.id, product_id=cookies.id, produced_by=user_a.id
      )

      token = await _login(client, store_a.slug, "1111")
      resp = await client.get(f"/api/v1/production-orders/{order.id}", headers=_headers(token))
      assert resp.status_code == 200, resp.text
      assert resp.json()["id"] == order.id


  @pytest.mark.asyncio
  async def test_api_create_production_order_404_for_unknown_product(client, db, store_a, user_a):
      token = await _login(client, store_a.slug, "1111")
      resp = await client.post(
          "/api/v1/production-orders",
          headers=_headers(token),
          json={"product_id": "nonexistent000000000000", "batches_count": 1},
      )
      assert resp.status_code == 404


  @pytest.mark.asyncio
  async def test_api_create_production_order_422_for_made_to_order(client, db, store_a, user_a):
      from tests.conftest import make_product
      product = await make_product(db, store_id=store_a.id, name=f"Latte-422-{uid()}")

      token = await _login(client, store_a.slug, "1111")
      resp = await client.post(
          "/api/v1/production-orders",
          headers=_headers(token),
          json={"product_id": product.id, "batches_count": 1},
      )
      assert resp.status_code == 422
  ```

- [ ] **Step 2: Run API tests — expect FAIL**

  ```bash
  uv run pytest tests/test_production_api.py::test_api_create_production_order_returns_201 -v
  ```

  Expected: FAIL with 404 (route not registered yet).

- [ ] **Step 3: Create `api/app/api/v1/production.py`**

  ```python
  from datetime import date

  from fastapi import APIRouter, Query

  from app.deps import DbSession, StoreUser
  from app.schemas.production import ProductionOrderCreate, ProductionOrderRead
  from app.services import production as svc

  router = APIRouter(prefix="/production-orders", tags=["production"])


  @router.post(
      "",
      response_model=ProductionOrderRead,
      status_code=201,
      summary="Record a production run — atomically deducts ingredients and adds finished goods",
      operation_id="production_orders_create",
  )
  async def create_production_order(
      payload: ProductionOrderCreate, user: StoreUser, db: DbSession
  ) -> ProductionOrderRead:
      order = await svc.create_production_order(
          db, store_id=user.store_id, user_id=user.id, payload=payload
      )
      return ProductionOrderRead.model_validate(order)


  @router.get(
      "",
      response_model=list[ProductionOrderRead],
      summary="List production orders for the current store",
      operation_id="production_orders_list",
  )
  async def list_production_orders(
      user: StoreUser,
      db: DbSession,
      product_id: str | None = Query(None),
      from_: date | None = Query(None, alias="from"),
      to: date | None = Query(None),
  ) -> list[ProductionOrderRead]:
      orders = await svc.list_production_orders(
          db, store_id=user.store_id, product_id=product_id, from_=from_, to=to
      )
      return [ProductionOrderRead.model_validate(o) for o in orders]


  @router.get(
      "/{order_id}",
      response_model=ProductionOrderRead,
      summary="Get a single production order by ID",
      operation_id="production_orders_get",
  )
  async def get_production_order(
      order_id: str, user: StoreUser, db: DbSession
  ) -> ProductionOrderRead:
      order = await svc.get_production_order(db, store_id=user.store_id, order_id=order_id)
      return ProductionOrderRead.model_validate(order)
  ```

- [ ] **Step 4: Register in `api/app/api/v1/router.py`**

  Update the file:

  ```python
  from fastapi import APIRouter

  from app.api.v1 import (
      auth, categories, customers, hr, inventory,
      modifier_groups, orders, pre_orders, production, products,
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
  api_router.include_router(production.router)
  api_router.include_router(realtime.router)
  api_router.include_router(reports.router)
  api_router.include_router(customers.router)
  api_router.include_router(hr.router)
  api_router.include_router(pre_orders.router)
  api_router.include_router(shopping_list.router)
  ```

- [ ] **Step 5: Run all API tests — expect PASS**

  ```bash
  uv run pytest tests/test_production_api.py -v
  ```

  Expected: all PASS.

- [ ] **Step 6: Run full test suite**

  ```bash
  uv run pytest -v
  ```

  Expected: all pass with no regressions.

- [ ] **Step 7: Commit**

  ```bash
  git add app/api/v1/production.py app/api/v1/router.py tests/test_production_api.py
  git commit -m "feat: add production orders router and API endpoints"
  ```

---

## Task 14: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the Models table**

  In the `Models (SQLAlchemy 2.x Mapped[...])` section, add a new row to the table:

  ```
  | `models/production.py` | `production_orders` |
  ```

- [ ] **Step 2: Update the API Modules list**

  Add `production` to the `API Modules (api/v1/)` line.

- [ ] **Step 3: Update the Domain Enums section**

  Note that `ProductType` has been added to `app/enums.py`.

- [ ] **Step 4: Commit**

  ```bash
  git add ../../CLAUDE.md
  git commit -m "docs: update CLAUDE.md with ProductionOrder model and production API module"
  ```

---

## Self-Review Checklist

- [x] Spec § Data Model → Tasks 1–4 (enums, model, migration)
- [x] Spec § Auto-Pair Inventory Item → Task 7 (create), Task 9 (update)
- [x] Spec § Order Flow (MADE_TO_ORDER unchanged) → Task 10 regression test
- [x] Spec § Order Flow (PRODUCED deducts finished goods) → Task 10
- [x] Spec § Production Order Flow → Task 11 (service), Task 13 (router)
- [x] Spec § Cost Calculation → no backend work required; `servings_per_batch` returned in `ProductDetail` via schema change (Task 5)
- [x] Spec § API Endpoints → Tasks 7/9 (product updates), Task 13 (production router)
- [x] Spec § Validation & Error Handling → `_load_produced_product` helper covers 404/422/500 guards
- [x] Spec § Testing → Tasks 7, 9, 10, 11, 13 all follow TDD with named test cases
- [x] `ProductDetail` inherits from `ProductRead` → gains new fields automatically via Task 5 ✓
- [x] `make_produced_product` used in Task 9 tests — factory created in Task 8 (before it) ✓
- [x] `make_production_order` used in Task 13 tests — factory created in Task 12 (before it) ✓
- [x] Migration revision chain: `down_revision = "0015"` ✓
