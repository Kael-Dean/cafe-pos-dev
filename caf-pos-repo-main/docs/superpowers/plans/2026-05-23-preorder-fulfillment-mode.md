# Pre-Order Item Fulfillment Mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let managers mark each PRODUCED pre-order item as `FROM_INVENTORY` (pull from finished goods stock) or `PRODUCE_FRESH` (deduct raw ingredients), while the order is still PENDING.

**Architecture:** A nullable `fulfillment_mode` column on `pre_order_items` persists the choice. At read time, `_aggregate_ingredients` joins the finished goods inventory item to compute effective raw ingredient needs. At start time, `start_pre_order` deducts finished goods stock first, then deducts raw ingredients for any shortfall — blocking only if a FROM_INVENTORY fallback can't be covered by ingredients.

**Tech Stack:** FastAPI, SQLAlchemy 2.x async, PostgreSQL, Alembic, pytest-asyncio

---

## File Map

| File | Change |
|---|---|
| `app/enums.py` | Add `FulfillmentMode` enum |
| `app/models/pre_orders.py` | Add `fulfillment_mode` column to `PreOrderItem` |
| `alembic/versions/0017_pre_order_item_fulfillment_mode.py` | Migration: new Postgres enum + column |
| `app/schemas/pre_orders.py` | Add `fulfillment_mode` to `PreOrderItemRead`; add `FulfillmentModeUpdate` |
| `app/services/pre_orders.py` | Add `set_item_fulfillment`; update `_aggregate_ingredients`; rewrite `start_pre_order` |
| `app/api/v1/pre_orders.py` | Add `PATCH /{pre_order_id}/items/{item_id}/fulfillment` route |
| `tests/conftest.py` | Add `finished_goods_item_id` param to `make_product` |
| `tests/test_pre_orders_api.py` | New tests for PATCH endpoint, ingredient summary, and start logic |

---

## Task 1 — Enum, Model Column, Migration, Schemas

**Files:**
- Modify: `api/app/enums.py`
- Modify: `api/app/models/pre_orders.py`
- Create: `api/alembic/versions/0017_pre_order_item_fulfillment_mode.py`
- Modify: `api/app/schemas/pre_orders.py`

- [ ] **Step 1: Add `FulfillmentMode` to `app/enums.py`**

Add after the `PreOrderStatus` class (line 88):

```python
class FulfillmentMode(enum.StrEnum):
    PRODUCE_FRESH  = "PRODUCE_FRESH"
    FROM_INVENTORY = "FROM_INVENTORY"
```

- [ ] **Step 2: Add column to `PreOrderItem` model**

In `app/models/pre_orders.py`, add this import at the top alongside the existing `PreOrderStatus` import:

```python
from app.enums import FulfillmentMode, PreOrderStatus
```

Then add this column to `PreOrderItem` after `line_total`:

```python
fulfillment_mode: Mapped[FulfillmentMode | None] = mapped_column(
    SAEnum(FulfillmentMode, name="fulfillment_mode"),
    nullable=True,
)
```

- [ ] **Step 3: Write the Alembic migration**

Create `api/alembic/versions/0017_pre_order_item_fulfillment_mode.py`:

```python
"""Add fulfillment_mode column to pre_order_items.

Revision ID: 0017
Revises: 0016
Create Date: 2026-05-23
"""
import sqlalchemy as sa
from alembic import op

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "CREATE TYPE fulfillment_mode AS ENUM ('PRODUCE_FRESH', 'FROM_INVENTORY')"
    )
    op.add_column(
        "pre_order_items",
        sa.Column(
            "fulfillment_mode",
            sa.Enum("PRODUCE_FRESH", "FROM_INVENTORY", name="fulfillment_mode"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("pre_order_items", "fulfillment_mode")
    op.execute("DROP TYPE IF EXISTS fulfillment_mode")
```

- [ ] **Step 4: Run the migration**

```bash
cd api
uv run alembic upgrade head
```

Expected: `Running upgrade 0016 -> 0017`

- [ ] **Step 5: Update schemas in `app/schemas/pre_orders.py`**

Add import at top:

```python
from app.enums import FulfillmentMode
```

Add `fulfillment_mode` to `PreOrderItemRead`:

```python
class PreOrderItemRead(_Cfg):
    id: str
    product_id: str | None
    product_name: str
    quantity: int
    unit_price: Decimal
    line_total: Decimal
    fulfillment_mode: FulfillmentMode | None = None
```

Add new request schema after `PreOrderItemRead`:

```python
class FulfillmentModeUpdate(BaseModel):
    fulfillment_mode: FulfillmentMode
```

- [ ] **Step 6: Commit**

```bash
git add api/app/enums.py api/app/models/pre_orders.py \
        api/alembic/versions/0017_pre_order_item_fulfillment_mode.py \
        api/app/schemas/pre_orders.py
git commit -m "feat: add fulfillment_mode column to pre_order_items"
```

---

## Task 2 — PATCH endpoint: set_item_fulfillment

**Files:**
- Modify: `api/tests/conftest.py`
- Modify: `api/tests/test_pre_orders_api.py`
- Modify: `api/app/services/pre_orders.py`
- Modify: `api/app/api/v1/pre_orders.py`

- [ ] **Step 1: Update `make_product` factory to accept `finished_goods_item_id`**

In `tests/conftest.py`, update `make_product` (currently around line 256):

```python
async def make_product(
    db: AsyncSession,
    *,
    store_id: str,
    name: str = "Latte",
    price: Decimal = Decimal("85.00"),
    category_id: str | None = None,
    is_active: bool = True,
    product_type: str = "MADE_TO_ORDER",
    servings_per_batch: int = 1,
    finished_goods_item_id: str | None = None,
) -> Product:
    product = Product(
        store_id=store_id,
        name=name,
        price=price,
        category_id=category_id,
        is_active=is_active,
        product_type=product_type,
        servings_per_batch=servings_per_batch,
        finished_goods_item_id=finished_goods_item_id,
    )
    db.add(product)
    await db.commit()
    return product
```

- [ ] **Step 2: Write failing tests for the PATCH endpoint**

Add to `tests/test_pre_orders_api.py`:

```python
async def _make_produced_product(db, store_id, *, fg_stock=Decimal("0"), raw_stock=Decimal("10000"), servings_per_batch=75):
    """Helper: PRODUCED product with finished goods item + one raw ingredient in recipe."""
    uid = secrets.token_hex(4)
    cat = await make_category(db, store_id=store_id, name=f"Cat-{uid}")
    fg_item = await make_item(
        db, store_id=store_id, name=f"FG-{uid}", unit="piece", stock=fg_stock
    )
    raw_item = await make_item(
        db, store_id=store_id, name=f"Flour-{uid}", unit="g", stock=raw_stock
    )
    product = await make_product(
        db,
        store_id=store_id,
        name=f"Chiffon-{uid}",
        price=Decimal("80.00"),
        category_id=cat.id,
        product_type="PRODUCED",
        servings_per_batch=servings_per_batch,
        finished_goods_item_id=fg_item.id,
    )
    db.add(RecipeItem(
        product_id=product.id,
        inventory_item_id=raw_item.id,
        quantity=Decimal("500"),
    ))
    await db.commit()
    return product, fg_item, raw_item


async def test_set_fulfillment_mode_from_inventory(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    product, fg_item, _ = await _make_produced_product(db, store_a.id)

    create_resp = await client.post("/api/v1/pre-orders", headers=_h(token), json={
        "order_date": _today(), "due_date": _due(),
        "customer_name": "M", "customer_phone": "303",
        "items": [{"product_id": product.id, "quantity": 50}],
    })
    assert create_resp.status_code == 201
    po_id = create_resp.json()["id"]
    item_id = create_resp.json()["items"][0]["id"]

    resp = await client.patch(
        f"/api/v1/pre-orders/{po_id}/items/{item_id}/fulfillment",
        headers=_h(token),
        json={"fulfillment_mode": "FROM_INVENTORY"},
    )
    assert resp.status_code == 200
    item = next(i for i in resp.json()["items"] if i["id"] == item_id)
    assert item["fulfillment_mode"] == "FROM_INVENTORY"


async def test_set_fulfillment_mode_blocked_on_non_produced(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    product, _ = await _make_product_with_recipe(db, store_a.id)  # MADE_TO_ORDER

    create_resp = await client.post("/api/v1/pre-orders", headers=_h(token), json={
        "order_date": _today(), "due_date": _due(),
        "customer_name": "N", "customer_phone": "404",
        "items": [{"product_id": product.id, "quantity": 5}],
    })
    po_id = create_resp.json()["id"]
    item_id = create_resp.json()["items"][0]["id"]

    resp = await client.patch(
        f"/api/v1/pre-orders/{po_id}/items/{item_id}/fulfillment",
        headers=_h(token),
        json={"fulfillment_mode": "FROM_INVENTORY"},
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["message"] == "ITEM_NOT_PRODUCED"


async def test_set_fulfillment_mode_blocked_when_not_pending(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    product, fg_item, raw_item = await _make_produced_product(
        db, store_a.id, fg_stock=Decimal("100"), raw_stock=Decimal("10000")
    )

    create_resp = await client.post("/api/v1/pre-orders", headers=_h(token), json={
        "order_date": _today(), "due_date": _due(),
        "customer_name": "O", "customer_phone": "505",
        "items": [{"product_id": product.id, "quantity": 50}],
    })
    po_id = create_resp.json()["id"]
    item_id = create_resp.json()["items"][0]["id"]
    await client.post(f"/api/v1/pre-orders/{po_id}/start", headers=_h(token))

    resp = await client.patch(
        f"/api/v1/pre-orders/{po_id}/items/{item_id}/fulfillment",
        headers=_h(token),
        json={"fulfillment_mode": "FROM_INVENTORY"},
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["message"] == "PRE_ORDER_NOT_PENDING"
```

- [ ] **Step 3: Run the failing tests**

```bash
cd api
uv run pytest tests/test_pre_orders_api.py::test_set_fulfillment_mode_from_inventory \
              tests/test_pre_orders_api.py::test_set_fulfillment_mode_blocked_on_non_produced \
              tests/test_pre_orders_api.py::test_set_fulfillment_mode_blocked_when_not_pending -v
```

Expected: 3 FAILED (route does not exist yet)

- [ ] **Step 4: Add `set_item_fulfillment` to `app/services/pre_orders.py`**

Add these imports at the top of `pre_orders.py`:

```python
from app.enums import FulfillmentMode, PreOrderStatus, ProductType
```

Add the function after `remove_item`:

```python
async def set_item_fulfillment(
    db: AsyncSession,
    *,
    store_id: str,
    pre_order_id: str,
    item_id: str,
    mode: FulfillmentMode,
) -> PreOrderRead:
    async with db.begin():
        pre_order = await _load_pre_order(db, store_id=store_id, pre_order_id=pre_order_id)
        _require_pending(pre_order)

        row = (await db.execute(
            select(PreOrderItem, Product)
            .join(Product, Product.id == PreOrderItem.product_id)
            .where(
                PreOrderItem.id == item_id,
                PreOrderItem.pre_order_id == pre_order_id,
            )
        )).one_or_none()

        if row is None:
            raise NotFound("PRE_ORDER_ITEM_NOT_FOUND")

        poi, product = row

        if product.product_type != ProductType.PRODUCED:
            raise Unprocessable("ITEM_NOT_PRODUCED")

        if mode == FulfillmentMode.FROM_INVENTORY and not product.finished_goods_item_id:
            raise Unprocessable("NO_FINISHED_GOODS_ITEM")

        poi.fulfillment_mode = mode
        await db.flush()
        await db.refresh(pre_order)

    return await _pre_order_to_read(db, pre_order)
```

- [ ] **Step 5: Add the route to `app/api/v1/pre_orders.py`**

Add this import:

```python
from app.schemas.pre_orders import (
    FulfillmentModeUpdate,
    IngredientSummary,
    PreOrderCreate,
    PreOrderItemIn,
    PreOrderRead,
    PreOrdersPage,
    PreOrderUpdate,
)
```

Add the route after `remove_item`:

```python
@router.patch(
    "/{pre_order_id}/items/{item_id}/fulfillment",
    response_model=PreOrderRead,
    summary="Set fulfillment mode on a PRODUCED item (PENDING only)",
    operation_id="pre_orders_set_fulfillment",
)
async def set_item_fulfillment(
    pre_order_id: str, item_id: str, payload: FulfillmentModeUpdate,
    user: StoreUser, db: DbSession,
) -> PreOrderRead:
    return await svc.set_item_fulfillment(
        db,
        store_id=user.store_id,
        pre_order_id=pre_order_id,
        item_id=item_id,
        mode=payload.fulfillment_mode,
    )
```

- [ ] **Step 6: Run tests — verify they pass**

```bash
cd api
uv run pytest tests/test_pre_orders_api.py::test_set_fulfillment_mode_from_inventory \
              tests/test_pre_orders_api.py::test_set_fulfillment_mode_blocked_on_non_produced \
              tests/test_pre_orders_api.py::test_set_fulfillment_mode_blocked_when_not_pending -v
```

Expected: 3 PASSED

- [ ] **Step 7: Commit**

```bash
git add tests/conftest.py tests/test_pre_orders_api.py \
        app/services/pre_orders.py app/api/v1/pre_orders.py
git commit -m "feat: PATCH endpoint to set fulfillment_mode on pre-order items"
```

---

## Task 3 — Ingredient Summary: updated `_aggregate_ingredients`

**Files:**
- Modify: `api/app/services/pre_orders.py`
- Modify: `api/tests/test_pre_orders_api.py`

- [ ] **Step 1: Write failing tests**

Add to `tests/test_pre_orders_api.py`:

```python
async def test_ingredient_summary_from_inventory_fully_covered(client, db, store_a, user_a):
    """FROM_INVENTORY with enough finished goods stock → no raw ingredients shown."""
    token = await _login(client, store_a.slug, "1111")
    # fg_stock=100 covers the order of 50 servings
    product, fg_item, raw_item = await _make_produced_product(
        db, store_a.id, fg_stock=Decimal("100"), raw_stock=Decimal("10000")
    )

    create_resp = await client.post("/api/v1/pre-orders", headers=_h(token), json={
        "order_date": _today(), "due_date": _due(),
        "customer_name": "P", "customer_phone": "606",
        "items": [{"product_id": product.id, "quantity": 50}],
    })
    po_id = create_resp.json()["id"]
    item_id = create_resp.json()["items"][0]["id"]

    # Set FROM_INVENTORY
    await client.patch(
        f"/api/v1/pre-orders/{po_id}/items/{item_id}/fulfillment",
        headers=_h(token),
        json={"fulfillment_mode": "FROM_INVENTORY"},
    )

    resp = await client.get(f"/api/v1/pre-orders/{po_id}/ingredients", headers=_h(token))
    assert resp.status_code == 200
    # Finished goods cover the full order — no raw ingredients needed
    assert resp.json()["items"] == []


async def test_ingredient_summary_from_inventory_partial_stock(client, db, store_a, user_a):
    """FROM_INVENTORY with stock=30, order=50, servings_per_batch=75.
    Shortfall = 20. Batches needed = ceil(20/75) = 1. Ingredient = 500g."""
    token = await _login(client, store_a.slug, "1111")
    product, fg_item, raw_item = await _make_produced_product(
        db, store_a.id, fg_stock=Decimal("30"), raw_stock=Decimal("10000")
    )

    create_resp = await client.post("/api/v1/pre-orders", headers=_h(token), json={
        "order_date": _today(), "due_date": _due(),
        "customer_name": "Q", "customer_phone": "707",
        "items": [{"product_id": product.id, "quantity": 50}],
    })
    po_id = create_resp.json()["id"]
    item_id = create_resp.json()["items"][0]["id"]

    await client.patch(
        f"/api/v1/pre-orders/{po_id}/items/{item_id}/fulfillment",
        headers=_h(token),
        json={"fulfillment_mode": "FROM_INVENTORY"},
    )

    resp = await client.get(f"/api/v1/pre-orders/{po_id}/ingredients", headers=_h(token))
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert len(items) == 1
    # 1 batch × 500g = 500g (not 50 × 500g = 25000g)
    assert Decimal(items[0]["qty_needed"]) == Decimal("500")
```

- [ ] **Step 2: Run the failing tests**

```bash
cd api
uv run pytest tests/test_pre_orders_api.py::test_ingredient_summary_from_inventory_fully_covered \
              tests/test_pre_orders_api.py::test_ingredient_summary_from_inventory_partial_stock -v
```

Expected: 2 FAILED

- [ ] **Step 3: Update `_aggregate_ingredients` in `app/services/pre_orders.py`**

Add `aliased` to the sqlalchemy.orm import at the top of the file:

```python
from sqlalchemy.orm import aliased
```

Also ensure `FulfillmentMode` is imported (already added in Task 2):

```python
from app.enums import FulfillmentMode, PreOrderStatus, ProductType
```

Replace the entire `_aggregate_ingredients` function:

```python
async def _aggregate_ingredients(
    db: AsyncSession, *, pre_order_id: str
) -> dict[str, Decimal]:
    FinishedGoodsItem = aliased(InventoryItem)

    rows = list((await db.execute(
        select(
            PreOrderItem.quantity.label("poi_qty"),
            PreOrderItem.fulfillment_mode,
            RecipeItem.inventory_item_id,
            RecipeItem.quantity.label("ri_qty"),
            Product.product_type,
            Product.servings_per_batch,
            FinishedGoodsItem.stock_on_hand.label("fg_stock"),
        )
        .join(RecipeItem, RecipeItem.product_id == PreOrderItem.product_id)
        .join(Product, Product.id == PreOrderItem.product_id)
        .outerjoin(FinishedGoodsItem, FinishedGoodsItem.id == Product.finished_goods_item_id)
        .where(PreOrderItem.pre_order_id == pre_order_id)
    )).all())

    aggregated: dict[str, Decimal] = {}
    for poi_qty, fulfillment_mode, inv_item_id, ri_qty, product_type, servings_per_batch, fg_stock in rows:
        if product_type == ProductType.PRODUCED and servings_per_batch > 0:
            poi_qty_dec = Decimal(poi_qty)
            if fulfillment_mode == FulfillmentMode.FROM_INVENTORY and fg_stock is not None:
                if fg_stock >= poi_qty_dec:
                    continue  # fully covered by finished goods stock
                shortfall = float(poi_qty_dec - fg_stock)
                batches_needed = Decimal(math.ceil(shortfall / servings_per_batch))
            else:
                batches_needed = Decimal(math.ceil(float(poi_qty) / servings_per_batch))
            ingredient_qty = ri_qty * batches_needed
        else:
            ingredient_qty = ri_qty * Decimal(poi_qty)
        aggregated[inv_item_id] = aggregated.get(inv_item_id, Decimal("0")) + ingredient_qty
    return aggregated
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd api
uv run pytest tests/test_pre_orders_api.py::test_ingredient_summary_from_inventory_fully_covered \
              tests/test_pre_orders_api.py::test_ingredient_summary_from_inventory_partial_stock -v
```

Expected: 2 PASSED

- [ ] **Step 5: Run the full pre-orders test file to check for regressions**

```bash
cd api
uv run pytest tests/test_pre_orders_api.py -v
```

Expected: all existing tests still PASSED

- [ ] **Step 6: Commit**

```bash
git add app/services/pre_orders.py tests/test_pre_orders_api.py
git commit -m "feat: ingredient summary excludes FROM_INVENTORY items covered by finished goods stock"
```

---

## Task 4 — Start: updated deduction logic

**Files:**
- Modify: `api/app/services/pre_orders.py`
- Modify: `api/tests/test_pre_orders_api.py`

- [ ] **Step 1: Write failing tests**

Add to `tests/test_pre_orders_api.py`:

```python
async def test_start_from_inventory_sufficient_deducts_finished_goods(client, db, store_a, user_a):
    """FROM_INVENTORY + fg_stock >= qty → deducts finished goods, no raw ingredient deduction."""
    token = await _login(client, store_a.slug, "1111")
    product, fg_item, raw_item = await _make_produced_product(
        db, store_a.id, fg_stock=Decimal("100"), raw_stock=Decimal("10000")
    )

    create_resp = await client.post("/api/v1/pre-orders", headers=_h(token), json={
        "order_date": _today(), "due_date": _due(),
        "customer_name": "R", "customer_phone": "808",
        "items": [{"product_id": product.id, "quantity": 50}],
    })
    po_id = create_resp.json()["id"]
    item_id = create_resp.json()["items"][0]["id"]

    await client.patch(
        f"/api/v1/pre-orders/{po_id}/items/{item_id}/fulfillment",
        headers=_h(token),
        json={"fulfillment_mode": "FROM_INVENTORY"},
    )

    start_resp = await client.post(f"/api/v1/pre-orders/{po_id}/start", headers=_h(token))
    assert start_resp.status_code == 200
    assert start_resp.json()["status"] == "IN_PROGRESS"

    fg_resp = await client.get(f"/api/v1/inventory/{fg_item.id}", headers=_h(token))
    assert Decimal(fg_resp.json()["stock_on_hand"]) == Decimal("50.000")  # 100 - 50

    raw_resp = await client.get(f"/api/v1/inventory/{raw_item.id}", headers=_h(token))
    assert Decimal(raw_resp.json()["stock_on_hand"]) == Decimal("10000.000")  # unchanged


async def test_start_from_inventory_partial_deducts_fg_and_raw(client, db, store_a, user_a):
    """FROM_INVENTORY + fg_stock=30, order=50, batch=75, recipe=500g.
    Available from FG = 30. Shortfall = 20 → 1 batch → deduct 500g raw."""
    token = await _login(client, store_a.slug, "1111")
    product, fg_item, raw_item = await _make_produced_product(
        db, store_a.id, fg_stock=Decimal("30"), raw_stock=Decimal("10000")
    )

    create_resp = await client.post("/api/v1/pre-orders", headers=_h(token), json={
        "order_date": _today(), "due_date": _due(),
        "customer_name": "S", "customer_phone": "909",
        "items": [{"product_id": product.id, "quantity": 50}],
    })
    po_id = create_resp.json()["id"]
    item_id = create_resp.json()["items"][0]["id"]

    await client.patch(
        f"/api/v1/pre-orders/{po_id}/items/{item_id}/fulfillment",
        headers=_h(token),
        json={"fulfillment_mode": "FROM_INVENTORY"},
    )

    start_resp = await client.post(f"/api/v1/pre-orders/{po_id}/start", headers=_h(token))
    assert start_resp.status_code == 200

    fg_resp = await client.get(f"/api/v1/inventory/{fg_item.id}", headers=_h(token))
    assert Decimal(fg_resp.json()["stock_on_hand"]) == Decimal("0.000")  # 30 - 30

    raw_resp = await client.get(f"/api/v1/inventory/{raw_item.id}", headers=_h(token))
    assert Decimal(raw_resp.json()["stock_on_hand"]) == Decimal("9500.000")  # 10000 - 500


async def test_start_from_inventory_insufficient_ingredients_blocks(client, db, store_a, user_a):
    """FROM_INVENTORY + fg_stock=0, raw_stock=100 < 500g needed → 422 INSUFFICIENT_INGREDIENTS."""
    token = await _login(client, store_a.slug, "1111")
    product, fg_item, raw_item = await _make_produced_product(
        db, store_a.id, fg_stock=Decimal("0"), raw_stock=Decimal("100")
    )

    create_resp = await client.post("/api/v1/pre-orders", headers=_h(token), json={
        "order_date": _today(), "due_date": _due(),
        "customer_name": "T", "customer_phone": "010",
        "items": [{"product_id": product.id, "quantity": 50}],
    })
    po_id = create_resp.json()["id"]
    item_id = create_resp.json()["items"][0]["id"]

    await client.patch(
        f"/api/v1/pre-orders/{po_id}/items/{item_id}/fulfillment",
        headers=_h(token),
        json={"fulfillment_mode": "FROM_INVENTORY"},
    )

    resp = await client.post(f"/api/v1/pre-orders/{po_id}/start", headers=_h(token))
    assert resp.status_code == 422
    assert resp.json()["error"]["message"] == "INSUFFICIENT_INGREDIENTS"


async def test_start_from_inventory_no_fg_stock_but_sufficient_raw_succeeds(client, db, store_a, user_a):
    """FROM_INVENTORY + fg_stock=0, raw_stock=10000 >= 500g needed → succeeds, deducts raw."""
    token = await _login(client, store_a.slug, "1111")
    product, fg_item, raw_item = await _make_produced_product(
        db, store_a.id, fg_stock=Decimal("0"), raw_stock=Decimal("10000")
    )

    create_resp = await client.post("/api/v1/pre-orders", headers=_h(token), json={
        "order_date": _today(), "due_date": _due(),
        "customer_name": "U", "customer_phone": "011",
        "items": [{"product_id": product.id, "quantity": 50}],
    })
    po_id = create_resp.json()["id"]
    item_id = create_resp.json()["items"][0]["id"]

    await client.patch(
        f"/api/v1/pre-orders/{po_id}/items/{item_id}/fulfillment",
        headers=_h(token),
        json={"fulfillment_mode": "FROM_INVENTORY"},
    )

    resp = await client.post(f"/api/v1/pre-orders/{po_id}/start", headers=_h(token))
    assert resp.status_code == 200

    raw_resp = await client.get(f"/api/v1/inventory/{raw_item.id}", headers=_h(token))
    assert Decimal(raw_resp.json()["stock_on_hand"]) == Decimal("9500.000")  # 10000 - 500
```

- [ ] **Step 2: Run the failing tests**

```bash
cd api
uv run pytest \
  tests/test_pre_orders_api.py::test_start_from_inventory_sufficient_deducts_finished_goods \
  tests/test_pre_orders_api.py::test_start_from_inventory_partial_deducts_fg_and_raw \
  tests/test_pre_orders_api.py::test_start_from_inventory_insufficient_ingredients_blocks \
  tests/test_pre_orders_api.py::test_start_from_inventory_no_fg_stock_but_sufficient_raw_succeeds \
  -v
```

Expected: 4 FAILED

- [ ] **Step 3: Rewrite `start_pre_order` in `app/services/pre_orders.py`**

Replace the entire `start_pre_order` function:

```python
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

        FinishedGoodsItem = aliased(InventoryItem)
        rows = list((await db.execute(
            select(
                PreOrderItem.id.label("poi_id"),
                PreOrderItem.quantity.label("poi_qty"),
                PreOrderItem.fulfillment_mode,
                RecipeItem.inventory_item_id,
                RecipeItem.quantity.label("ri_qty"),
                Product.product_type,
                Product.servings_per_batch,
                Product.finished_goods_item_id,
                FinishedGoodsItem.stock_on_hand.label("fg_stock"),
            )
            .join(RecipeItem, RecipeItem.product_id == PreOrderItem.product_id)
            .join(Product, Product.id == PreOrderItem.product_id)
            .outerjoin(FinishedGoodsItem, FinishedGoodsItem.id == Product.finished_goods_item_id)
            .where(PreOrderItem.pre_order_id == pre_order_id)
        )).all())

        if not rows:
            raise Unprocessable("PRE_ORDER_NO_ITEMS")

        # fg_deductions: finished goods to pull from inventory (FROM_INVENTORY mode)
        # raw_blocked: raw ingredient needs from FROM_INVENTORY fallback — checked before deducting
        # raw_free: raw ingredient needs from PRODUCE_FRESH — deducted freely (negative allowed)
        fg_deductions: dict[str, Decimal] = {}
        raw_blocked: dict[str, Decimal] = {}
        raw_free: dict[str, Decimal] = {}
        processed_poi_ids: set[str] = set()

        for poi_id, poi_qty, fulfillment_mode, inv_item_id, ri_qty, product_type, servings_per_batch, fg_item_id, fg_stock in rows:
            if product_type == ProductType.PRODUCED and servings_per_batch > 0:
                poi_qty_dec = Decimal(poi_qty)
                if fulfillment_mode == FulfillmentMode.FROM_INVENTORY and fg_item_id and fg_stock is not None:
                    available = min(fg_stock, poi_qty_dec)
                    shortfall = poi_qty_dec - available
                    if poi_id not in processed_poi_ids:
                        if available > 0:
                            fg_deductions[fg_item_id] = (
                                fg_deductions.get(fg_item_id, Decimal("0")) + available
                            )
                        processed_poi_ids.add(poi_id)
                    if shortfall > 0:
                        batches = Decimal(math.ceil(float(shortfall) / servings_per_batch))
                        raw_blocked[inv_item_id] = (
                            raw_blocked.get(inv_item_id, Decimal("0")) + ri_qty * batches
                        )
                else:
                    batches = Decimal(math.ceil(float(poi_qty) / servings_per_batch))
                    raw_free[inv_item_id] = (
                        raw_free.get(inv_item_id, Decimal("0")) + ri_qty * batches
                    )
            else:
                raw_free[inv_item_id] = (
                    raw_free.get(inv_item_id, Decimal("0")) + ri_qty * Decimal(poi_qty)
                )

        # Block if any FROM_INVENTORY fallback ingredient is insufficient
        if raw_blocked:
            insufficient = []
            for inv_id, qty_needed in raw_blocked.items():
                inv_item = await db.get(InventoryItem, inv_id)
                if inv_item and inv_item.stock_on_hand < qty_needed:
                    insufficient.append(inv_id)
            if insufficient:
                raise Unprocessable("INSUFFICIENT_INGREDIENTS")

        # Deduct finished goods
        for fg_item_id, qty in fg_deductions.items():
            await _deduct_fifo(
                db,
                store_id=store_id,
                user_id=user_id,
                inventory_item_id=fg_item_id,
                total_qty=qty,
                reason=f"Pre-order {pre_order_id[:8]} (from inventory)",
            )

        # Deduct raw ingredients (blocked + free combined)
        all_raw = {**raw_blocked}
        for k, v in raw_free.items():
            all_raw[k] = all_raw.get(k, Decimal("0")) + v
        for inv_id, qty in all_raw.items():
            await _deduct_fifo(
                db,
                store_id=store_id,
                user_id=user_id,
                inventory_item_id=inv_id,
                total_qty=qty,
                reason=f"Pre-order {pre_order_id[:8]}",
            )

        pre_order.status = PreOrderStatus.IN_PROGRESS
        pre_order.started_by_id = user_id
        pre_order.started_at = datetime.now(UTC)
        await db.flush()
        await db.refresh(pre_order)

    return await _pre_order_to_read(db, pre_order)
```

- [ ] **Step 4: Run new tests — verify they pass**

```bash
cd api
uv run pytest \
  tests/test_pre_orders_api.py::test_start_from_inventory_sufficient_deducts_finished_goods \
  tests/test_pre_orders_api.py::test_start_from_inventory_partial_deducts_fg_and_raw \
  tests/test_pre_orders_api.py::test_start_from_inventory_insufficient_ingredients_blocks \
  tests/test_pre_orders_api.py::test_start_from_inventory_no_fg_stock_but_sufficient_raw_succeeds \
  -v
```

Expected: 4 PASSED

- [ ] **Step 5: Run full pre-orders test file**

```bash
cd api
uv run pytest tests/test_pre_orders_api.py -v
```

Expected: all tests PASSED

- [ ] **Step 6: Run full suite for regressions**

```bash
cd api
uv run pytest --tb=short -q
```

Expected: same pre-existing failures as before (4 unrelated production/catalog tests), no new failures.

- [ ] **Step 7: Commit**

```bash
git add app/services/pre_orders.py tests/test_pre_orders_api.py
git commit -m "feat: start pre-order respects FROM_INVENTORY fulfillment mode with shortfall fallback"
```
