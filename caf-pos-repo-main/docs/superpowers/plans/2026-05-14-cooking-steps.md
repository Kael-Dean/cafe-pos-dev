# Cooking Steps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add ordered plain-text cooking steps to products so kitchen staff can tap a "?" button to load them on-demand as an emergency reference.

**Architecture:** New `CookingStep` ORM model (mirrors `RecipeItem` pattern) with a dedicated `cooking_steps` table. Five new endpoints on the products router (`/products/{product_id}/steps`). Service logic lives in `services/catalog.py` alongside the existing recipe functions.

**Tech Stack:** FastAPI, SQLAlchemy 2.x async, PostgreSQL, Alembic, Pydantic v2, uv

---

## File Map

| Action | File | What changes |
|---|---|---|
| Create | `api/app/models/catalog.py` | Add `CookingStep` ORM class |
| Modify | `api/app/models/__init__.py` | Import and export `CookingStep` |
| Modify | `api/app/schemas/catalog.py` | Add 4 new schemas |
| Modify | `api/app/services/catalog.py` | Add 5 new service functions |
| Modify | `api/app/api/v1/products.py` | Add 5 new endpoints |
| Create | `api/alembic/versions/0012_cooking_steps.py` | Migration for `cooking_steps` table |

---

## Task 1: ORM Model

**Files:**
- Modify: `api/app/models/catalog.py`
- Modify: `api/app/models/__init__.py`

- [ ] **Step 1: Add `CookingStep` class to `api/app/models/catalog.py`**

  Append after the `ProductModifierGroup` class (end of file):

  ```python
  class CookingStep(Base):
      __tablename__ = "cooking_steps"
      __table_args__ = (UniqueConstraint("product_id", "sort_order", name="uq_cooking_steps_product_order"),)

      id: Mapped[str] = mapped_column(String(24), primary_key=True, default=new_cuid)
      product_id: Mapped[str] = mapped_column(
          String(24), ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True
      )
      sort_order: Mapped[int] = mapped_column(Integer, nullable=False)
      instruction: Mapped[str] = mapped_column(String(500), nullable=False)
  ```

- [ ] **Step 2: Register `CookingStep` in `api/app/models/__init__.py`**

  Add import at the top of the catalog import block:

  ```python
  from app.models.catalog import (
      Category,
      CookingStep,
      Modifier,
      ModifierGroup,
      Product,
      ProductModifierGroup,
      RecipeItem,
  )
  ```

  Add `"CookingStep"` to `__all__`:

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
  ]
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add api/app/models/catalog.py api/app/models/__init__.py
  git commit -m "feat: add CookingStep ORM model"
  ```

---

## Task 2: Pydantic Schemas

**Files:**
- Modify: `api/app/schemas/catalog.py`

- [ ] **Step 1: Add four cooking step schemas to `api/app/schemas/catalog.py`**

  Append after the `RecipeBulkReplace` class (around line 113):

  ```python
  # ---------------------------------------------------------------------------
  # Cooking Steps
  # ---------------------------------------------------------------------------


  class CookingStepRead(_ORM):
      id: str
      sort_order: int
      instruction: str


  class CookingStepCreate(BaseModel):
      instruction: str = Field(min_length=1, max_length=500)
      sort_order: int | None = Field(None, ge=0)


  class CookingStepUpdate(BaseModel):
      instruction: str | None = Field(None, min_length=1, max_length=500)
      sort_order: int | None = Field(None, ge=0)


  class CookingStepsBulkReplace(BaseModel):
      steps: list[CookingStepCreate]
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add api/app/schemas/catalog.py
  git commit -m "feat: add CookingStep Pydantic schemas"
  ```

---

## Task 3: Service Functions

**Files:**
- Modify: `api/app/services/catalog.py`

- [ ] **Step 1: Add `CookingStep` to the model imports at the top of `api/app/services/catalog.py`**

  Update the existing `from app.models.catalog import (...)` block:

  ```python
  from app.models.catalog import (
      Category,
      CookingStep,
      Modifier,
      ModifierGroup,
      Product,
      ProductModifierGroup,
      RecipeItem,
  )
  ```

- [ ] **Step 2: Add `CookingStep` schemas to the schema imports**

  Update the existing `from app.schemas.catalog import (...)` block to include:

  ```python
  from app.schemas.catalog import (
      CategoryCreate,
      CategoryUpdate,
      CookingStepCreate,
      CookingStepRead,
      CookingStepsBulkReplace,
      CookingStepUpdate,
      ModifierCreate,
      ModifierGroupCreate,
      ModifierGroupRead,
      ModifierGroupUpdate,
      ModifierRead,
      ModifierUpdate,
      ProductCreate,
      ProductDetail,
      ProductModifierGroupsReplace,
      ProductRead,
      ProductUpdate,
      RecipeBulkReplace,
      RecipeItemRead,
  )
  ```

- [ ] **Step 3: Add the five service functions after the `replace_recipe` function (around line 214)**

  Insert the following block, keeping it in the Recipe (BOM) section:

  ```python
  # ---------------------------------------------------------------------------
  # Cooking Steps
  # ---------------------------------------------------------------------------


  async def list_steps(
      db: AsyncSession, *, store_id: str, product_id: str
  ) -> list[CookingStepRead]:
      await _load_product(db, store_id=store_id, product_id=product_id)
      result = await db.execute(
          select(CookingStep)
          .where(CookingStep.product_id == product_id)
          .order_by(CookingStep.sort_order)
      )
      return [CookingStepRead.model_validate(s) for s in result.scalars()]


  async def add_step(
      db: AsyncSession, *, store_id: str, product_id: str, payload: CookingStepCreate
  ) -> CookingStepRead:
      async with db.begin():
          await _load_product(db, store_id=store_id, product_id=product_id)
          if payload.sort_order is not None:
              order = payload.sort_order
          else:
              r = await db.execute(
                  select(CookingStep.sort_order)
                  .where(CookingStep.product_id == product_id)
                  .order_by(CookingStep.sort_order.desc())
                  .limit(1)
              )
              max_order = r.scalar_one_or_none()
              order = 0 if max_order is None else max_order + 1
          step = CookingStep(
              product_id=product_id,
              sort_order=order,
              instruction=payload.instruction,
          )
          db.add(step)
      return CookingStepRead.model_validate(step)


  async def update_step(
      db: AsyncSession,
      *,
      store_id: str,
      product_id: str,
      step_id: str,
      payload: CookingStepUpdate,
  ) -> CookingStepRead:
      async with db.begin():
          await _load_product(db, store_id=store_id, product_id=product_id)
          step = await _load_step(db, product_id=product_id, step_id=step_id)
          for field in payload.model_fields_set:
              setattr(step, field, getattr(payload, field))
      return CookingStepRead.model_validate(step)


  async def delete_step(
      db: AsyncSession, *, store_id: str, product_id: str, step_id: str
  ) -> None:
      async with db.begin():
          await _load_product(db, store_id=store_id, product_id=product_id)
          step = await _load_step(db, product_id=product_id, step_id=step_id)
          await db.delete(step)


  async def replace_steps(
      db: AsyncSession, *, store_id: str, product_id: str, payload: CookingStepsBulkReplace
  ) -> list[CookingStepRead]:
      async with db.begin():
          await _load_product(db, store_id=store_id, product_id=product_id)
          await db.execute(delete(CookingStep).where(CookingStep.product_id == product_id))
          new_steps = [
              CookingStep(
                  product_id=product_id,
                  sort_order=s.sort_order if s.sort_order is not None else idx,
                  instruction=s.instruction,
              )
              for idx, s in enumerate(payload.steps)
          ]
          db.add_all(new_steps)
      return [CookingStepRead.model_validate(s) for s in new_steps]
  ```

- [ ] **Step 4: Add `_load_step` private helper at the bottom of the private helpers section**

  Append after `_load_modifier_group`:

  ```python
  async def _load_step(
      db: AsyncSession, *, product_id: str, step_id: str
  ) -> CookingStep:
      result = await db.execute(
          select(CookingStep).where(
              CookingStep.id == step_id, CookingStep.product_id == product_id
          )
      )
      step = result.scalar_one_or_none()
      if not step:
          raise NotFound("Cooking step not found")
      return step
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add api/app/services/catalog.py
  git commit -m "feat: add cooking step service functions"
  ```

---

## Task 4: API Router Endpoints

**Files:**
- Modify: `api/app/api/v1/products.py`

- [ ] **Step 1: Add cooking step schemas to imports in `api/app/api/v1/products.py`**

  Update the `from app.schemas.catalog import (...)` block:

  ```python
  from app.schemas.catalog import (
      CookingStepCreate,
      CookingStepRead,
      CookingStepsBulkReplace,
      CookingStepUpdate,
      ProductCreate,
      ProductDetail,
      ProductModifierGroupsReplace,
      ProductRead,
      ProductUpdate,
      RecipeBulkReplace,
      RecipeItemRead,
  )
  ```

- [ ] **Step 2: Append five cooking step endpoints at the end of `api/app/api/v1/products.py`**

  ```python
  # ---------------------------------------------------------------------------
  # Cooking Steps
  # ---------------------------------------------------------------------------


  @router.get(
      "/{product_id}/steps",
      response_model=list[CookingStepRead],
      summary="List cooking steps for a product (kitchen on-demand reference)",
      operation_id="products_list_steps",
  )
  async def list_steps(product_id: str, user: StoreUser, db: DbSession) -> list[CookingStepRead]:
      return await svc.list_steps(db, store_id=user.store_id, product_id=product_id)


  @router.post(
      "/{product_id}/steps",
      response_model=CookingStepRead,
      status_code=201,
      summary="Add a cooking step to a product",
      operation_id="products_add_step",
      dependencies=[Depends(_MANAGER_PLUS)],
  )
  async def add_step(
      product_id: str, payload: CookingStepCreate, user: StoreUser, db: DbSession
  ) -> CookingStepRead:
      return await svc.add_step(db, store_id=user.store_id, product_id=product_id, payload=payload)


  @router.patch(
      "/{product_id}/steps/{step_id}",
      response_model=CookingStepRead,
      summary="Update a cooking step's instruction or sort order",
      operation_id="products_update_step",
      dependencies=[Depends(_MANAGER_PLUS)],
  )
  async def update_step(
      product_id: str,
      step_id: str,
      payload: CookingStepUpdate,
      user: StoreUser,
      db: DbSession,
  ) -> CookingStepRead:
      return await svc.update_step(
          db, store_id=user.store_id, product_id=product_id, step_id=step_id, payload=payload
      )


  @router.delete(
      "/{product_id}/steps/{step_id}",
      status_code=204,
      summary="Remove a cooking step",
      operation_id="products_delete_step",
      dependencies=[Depends(_MANAGER_PLUS)],
  )
  async def delete_step(
      product_id: str, step_id: str, user: StoreUser, db: DbSession
  ) -> None:
      await svc.delete_step(db, store_id=user.store_id, product_id=product_id, step_id=step_id)


  @router.put(
      "/{product_id}/steps",
      response_model=list[CookingStepRead],
      summary="Bulk replace all cooking steps (use for drag-to-reorder)",
      operation_id="products_replace_steps",
      dependencies=[Depends(_MANAGER_PLUS)],
  )
  async def replace_steps(
      product_id: str, payload: CookingStepsBulkReplace, user: StoreUser, db: DbSession
  ) -> list[CookingStepRead]:
      return await svc.replace_steps(
          db, store_id=user.store_id, product_id=product_id, payload=payload
      )
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add api/app/api/v1/products.py
  git commit -m "feat: add cooking step API endpoints"
  ```

---

## Task 5: Alembic Migration

**Files:**
- Create: `api/alembic/versions/0012_cooking_steps.py`

- [ ] **Step 1: Create `api/alembic/versions/0012_cooking_steps.py`**

  ```python
  """cooking steps

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


  def upgrade() -> None:
      op.create_table(
          "cooking_steps",
          sa.Column("id", sa.String(24), primary_key=True),
          sa.Column(
              "product_id",
              sa.String(24),
              sa.ForeignKey("products.id", ondelete="CASCADE"),
              nullable=False,
          ),
          sa.Column("sort_order", sa.Integer, nullable=False),
          sa.Column("instruction", sa.String(500), nullable=False),
          sa.UniqueConstraint("product_id", "sort_order", name="uq_cooking_steps_product_order"),
      )
      op.create_index("ix_cooking_steps_product_id", "cooking_steps", ["product_id"])


  def downgrade() -> None:
      op.drop_index("ix_cooking_steps_product_id", table_name="cooking_steps")
      op.drop_table("cooking_steps")
  ```

- [ ] **Step 2: Apply migration locally (requires `api/.env` with `DATABASE_URL`)**

  ```bash
  cd api
  uv run alembic upgrade head
  ```

  Expected output ends with: `Running upgrade 0011 -> 0012, cooking steps`

  If `.env` is absent, skip this step — Railway will apply it on next deploy via `preDeployCommand`.

- [ ] **Step 3: Commit**

  ```bash
  git add api/alembic/versions/0012_cooking_steps.py
  git commit -m "feat: alembic migration 0012 — cooking_steps table"
  ```

---

## Task 6: Smoke Test

- [ ] **Step 1: Start the dev server**

  ```bash
  cd api
  uv run uvicorn app.main:app --reload --port 8000
  ```

- [ ] **Step 2: Open OpenAPI docs and verify the 5 new endpoints appear**

  Navigate to `http://localhost:8000/docs` and confirm these operation IDs are listed:
  - `products_list_steps`
  - `products_add_step`
  - `products_update_step`
  - `products_delete_step`
  - `products_replace_steps`

- [ ] **Step 3: Quick end-to-end via docs**

  1. Log in via `POST /auth/login` to get a manager token
  2. `POST /products/{product_id}/steps` with `{"instruction": "Boil water"}` → expect 201, `sort_order: 0`
  3. `POST /products/{product_id}/steps` with `{"instruction": "Add noodles"}` → expect 201, `sort_order: 1`
  4. `GET /products/{product_id}/steps` → expect both steps in order
  5. `PATCH /products/{product_id}/steps/{step_id}` with `{"instruction": "Boil 500ml water"}` → expect updated instruction
  6. `DELETE /products/{product_id}/steps/{step_id}` → expect 204
  7. `GET /products/{product_id}/steps` → expect only one step remaining
  8. `PUT /products/{product_id}/steps` with `{"steps": [{"instruction": "Step A", "sort_order": 0}, {"instruction": "Step B", "sort_order": 1}]}` → expect both returned in order

- [ ] **Step 4: Final commit**

  ```bash
  git add .
  git commit -m "chore: cooking steps feature complete"
  ```
