# Promotion Calculator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `GET /api/v1/promotions/calculator/baseline` endpoint that returns sales history for a product so the frontend can compute break-even analysis for a proposed discount. Also expose ingredient `cost_per_unit` on the existing product-detail response so the frontend can derive COGS from the BOM it already loads.

**Architecture:** Hybrid computation — the backend provides only the sales history query (units sold in a rolling window), while the frontend does all margin arithmetic locally. The product detail response is enriched with `cost_per_unit` on each recipe item (one extra IN query, no schema migration). A new `/promotions` router is created now so Phase 2 (rule engine) has a home.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2.x async, pytest-asyncio, uv. All commands run from the `api/` directory.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `api/app/schemas/catalog.py` | Add `cost_per_unit` field to `RecipeItemRead` |
| Modify | `api/app/services/catalog.py` | Join `InventoryItem` in `get_product_detail` to populate it |
| Modify | `api/tests/test_catalog_service.py` | Add test for `cost_per_unit` on recipe items |
| Create | `api/app/schemas/promotions.py` | `PromotionBaselineResponse` Pydantic schema |
| Create | `api/app/services/promotions.py` | `get_promotion_baseline` — aggregates order history |
| Create | `api/app/api/v1/promotions.py` | FastAPI router with the calculator endpoint |
| Modify | `api/app/api/v1/router.py` | Register the promotions router |
| Create | `api/tests/test_promotions_api.py` | Full API test suite (3 tests) |

---

## Task 1: Expose `cost_per_unit` on recipe items in product detail

The product detail endpoint already returns recipe items, but each item only has `id`, `inventory_item_id`, and `quantity`. The frontend needs `cost_per_unit` per ingredient to compute COGS.

**Files:**
- Modify: `api/app/schemas/catalog.py`
- Modify: `api/app/services/catalog.py`
- Modify (add test): `api/tests/test_catalog_service.py`

- [ ] **Step 1: Write the failing test**

Add this test at the end of the product-detail section in `api/tests/test_catalog_service.py` (after the existing `test_get_product_detail_includes_recipe` test, around line 240):

```python
@pytest.mark.asyncio
async def test_get_product_detail_recipe_includes_cost_per_unit(db, store_a):
    product = await make_product(db, store_id=store_a.id, name=f"cost-product-{uid()}")
    item = await make_item(
        db, store_id=store_a.id, name=f"beans-{uid()}", cost_per_unit=Decimal("2.5000")
    )
    await svc.replace_recipe(
        db,
        store_id=store_a.id,
        product_id=product.id,
        payload=RecipeBulkReplace(
            items=[RecipeItemInput(inventory_item_id=item.id, quantity=Decimal("10"))]
        ),
    )

    detail = await svc.get_product_detail(db, store_id=store_a.id, product_id=product.id)
    assert len(detail.recipe) == 1
    assert detail.recipe[0].cost_per_unit == Decimal("2.5000")
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd api
uv run pytest tests/test_catalog_service.py::test_get_product_detail_recipe_includes_cost_per_unit -v
```

Expected: `FAILED` — `AttributeError: cost_per_unit` (field doesn't exist on `RecipeItemRead` yet).

- [ ] **Step 3: Add `cost_per_unit` to `RecipeItemRead` schema**

In `api/app/schemas/catalog.py`, find `RecipeItemRead` (around line 103) and replace it:

```python
class RecipeItemRead(_ORM):
    id: str
    inventory_item_id: str
    quantity: Decimal
    cost_per_unit: Decimal
```

- [ ] **Step 4: Enrich `get_product_detail` to populate the new field**

In `api/app/services/catalog.py`, `InventoryItem` is already imported (line 18). Find the recipe-loading block in `get_product_detail` (around line 118) and replace it:

**Before:**
```python
r = await db.execute(select(RecipeItem).where(RecipeItem.product_id == product.id))
recipe_items = list(r.scalars())
```

**After:**
```python
r = await db.execute(select(RecipeItem).where(RecipeItem.product_id == product.id))
recipe_items = list(r.scalars())

inv_ids = [ri.inventory_item_id for ri in recipe_items]
inv_map: dict[str, InventoryItem] = {}
if inv_ids:
    r = await db.execute(select(InventoryItem).where(InventoryItem.id.in_(inv_ids)))
    inv_map = {item.id: item for item in r.scalars()}
```

Then find the `recipe=` line in the `return ProductDetail(...)` block (line 153) and replace it:

**Before:**
```python
        recipe=[RecipeItemRead.model_validate(ri) for ri in recipe_items],
```

**After:**
```python
        recipe=[
            RecipeItemRead(
                id=ri.id,
                inventory_item_id=ri.inventory_item_id,
                quantity=ri.quantity,
                cost_per_unit=inv_map[ri.inventory_item_id].cost_per_unit
                if ri.inventory_item_id in inv_map
                else Decimal("0"),
            )
            for ri in recipe_items
        ],
```

- [ ] **Step 5: Run the new test to confirm it passes**

```bash
cd api
uv run pytest tests/test_catalog_service.py::test_get_product_detail_recipe_includes_cost_per_unit -v
```

Expected: `PASSED`

- [ ] **Step 6: Run the full catalog test suite to confirm no regressions**

```bash
cd api
uv run pytest tests/test_catalog_service.py -v
```

Expected: all tests `PASSED`.

- [ ] **Step 7: Commit**

```bash
git add api/app/schemas/catalog.py api/app/services/catalog.py api/tests/test_catalog_service.py
git commit -m "feat: expose cost_per_unit on recipe items in product detail response"
```

---

## Task 2: Promotion schemas and service

**Files:**
- Create: `api/app/schemas/promotions.py`
- Create: `api/app/services/promotions.py`

- [ ] **Step 1: Create the schema file**

Create `api/app/schemas/promotions.py`:

```python
from decimal import Decimal

from pydantic import BaseModel


class PromotionBaselineResponse(BaseModel):
    product_id: str
    sales_window_days: int
    units_sold_in_window: Decimal
    avg_units_per_week: Decimal
```

- [ ] **Step 2: Write the failing service test**

Create `api/tests/test_promotions_api.py` with just the service-level test for now:

```python
import secrets
from decimal import Decimal

import pytest

from tests.factories import make_order_direct, make_order_item, make_product

uid = lambda: secrets.token_hex(4)


@pytest.mark.asyncio
async def test_get_promotion_baseline_counts_sold_units(db, store_a, user_a):
    from app.services import promotions as svc

    product = await make_product(db, store_id=store_a.id, name=f"baseline-{uid()}")
    order = await make_order_direct(db, store_id=store_a.id, created_by_id=user_a.id)
    await make_order_item(db, order_id=order.id, product_id=product.id, quantity=5)
    await make_order_item(db, order_id=order.id, product_id=product.id, quantity=3)

    result = await svc.get_promotion_baseline(
        db, store_id=store_a.id, product_id=product.id, days=30
    )

    assert result.product_id == product.id
    assert result.units_sold_in_window == Decimal("8")
    assert result.sales_window_days == 30
    assert result.avg_units_per_week > Decimal("0")
```

- [ ] **Step 3: Run test to confirm it fails**

```bash
cd api
uv run pytest tests/test_promotions_api.py::test_get_promotion_baseline_counts_sold_units -v
```

Expected: `FAILED` — `ModuleNotFoundError: No module named 'app.services.promotions'`

- [ ] **Step 4: Create the service**

Create `api/app/services/promotions.py`:

```python
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.enums import OrderStatus
from app.models.orders import Order, OrderItem
from app.schemas.promotions import PromotionBaselineResponse


async def get_promotion_baseline(
    db: AsyncSession,
    *,
    store_id: str,
    product_id: str,
    days: int = 30,
) -> PromotionBaselineResponse:
    since = datetime.now(timezone.utc) - timedelta(days=days)

    result = await db.execute(
        select(func.sum(OrderItem.quantity))
        .join(Order, Order.id == OrderItem.order_id)
        .where(
            Order.store_id == store_id,
            OrderItem.product_id == product_id,
            Order.status != OrderStatus.VOID,
            Order.created_at >= since,
        )
    )
    units_sold = Decimal(str(result.scalar() or 0))
    avg_per_week = (units_sold / Decimal(str(days)) * Decimal("7")).quantize(Decimal("0.01"))

    return PromotionBaselineResponse(
        product_id=product_id,
        sales_window_days=days,
        units_sold_in_window=units_sold,
        avg_units_per_week=avg_per_week,
    )
```

- [ ] **Step 5: Run test to confirm it passes**

```bash
cd api
uv run pytest tests/test_promotions_api.py::test_get_promotion_baseline_counts_sold_units -v
```

Expected: `PASSED`

- [ ] **Step 6: Commit**

```bash
git add api/app/schemas/promotions.py api/app/services/promotions.py api/tests/test_promotions_api.py
git commit -m "feat: promotion baseline service and schema"
```

---

## Task 3: Promotions router, registration, and full API tests

**Files:**
- Create: `api/app/api/v1/promotions.py`
- Modify: `api/app/api/v1/router.py`
- Modify (add tests): `api/tests/test_promotions_api.py`

- [ ] **Step 1: Write the failing API tests**

Append the following to `api/tests/test_promotions_api.py` (after the service test from Task 2):

```python
# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _login(client, store_slug: str, pin: str) -> str:
    resp = await client.post("/api/v1/auth/login", json={"store_slug": store_slug, "pin": pin})
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# API tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_baseline_endpoint_happy_path(client, db, store_a, manager_a):
    """Manager gets correct baseline counts for a product with no sales (zero baseline)."""
    product = await make_product(db, store_id=store_a.id, name=f"api-product-{uid()}")
    token = await _login(client, store_a.slug, "2222")  # manager pin
    resp = await client.get(
        f"/api/v1/promotions/calculator/baseline?product_id={product.id}&days=30",
        headers=_h(token),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["product_id"] == product.id
    assert body["sales_window_days"] == 30
    assert Decimal(body["units_sold_in_window"]) == Decimal("0")
    assert Decimal(body["avg_units_per_week"]) == Decimal("0.00")


@pytest.mark.asyncio
async def test_baseline_endpoint_counts_order_items(client, db, store_a, manager_a, user_a):
    """Units from multiple order items for the same product are summed correctly."""
    product = await make_product(db, store_id=store_a.id, name=f"count-product-{uid()}")
    order = await make_order_direct(db, store_id=store_a.id, created_by_id=user_a.id)
    await make_order_item(db, order_id=order.id, product_id=product.id, quantity=4)
    await make_order_item(db, order_id=order.id, product_id=product.id, quantity=6)

    token = await _login(client, store_a.slug, "2222")
    resp = await client.get(
        f"/api/v1/promotions/calculator/baseline?product_id={product.id}&days=30",
        headers=_h(token),
    )
    assert resp.status_code == 200
    assert Decimal(resp.json()["units_sold_in_window"]) == Decimal("10")


@pytest.mark.asyncio
async def test_baseline_endpoint_barista_gets_403(client, db, store_a, user_a):
    """Barista role cannot access the calculator endpoint."""
    product = await make_product(db, store_id=store_a.id, name=f"role-product-{uid()}")
    token = await _login(client, store_a.slug, "1111")  # barista pin
    resp = await client.get(
        f"/api/v1/promotions/calculator/baseline?product_id={product.id}",
        headers=_h(token),
    )
    assert resp.status_code == 403
```

The final `api/tests/test_promotions_api.py` should contain **all** of the above (the service test from Task 2 plus these three API tests). Do not overwrite — append only.

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd api
uv run pytest tests/test_promotions_api.py -v -k "baseline_endpoint"
```

Expected: `FAILED` — `404 Not Found` (router not registered yet).

- [ ] **Step 3: Create the promotions router**

Create `api/app/api/v1/promotions.py`:

```python
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.deps import DbSession, StoreUser, require_role
from app.enums import Role
from app.models.identity import User
from app.schemas.promotions import PromotionBaselineResponse
from app.services import promotions as svc

router = APIRouter(prefix="/promotions", tags=["promotions"])


@router.get(
    "/calculator/baseline",
    response_model=PromotionBaselineResponse,
    summary="Sales baseline for promotion break-even analysis",
    operation_id="promotions_calculator_baseline",
)
async def get_promotion_baseline(
    product_id: str,
    days: int = Query(default=30, ge=1, le=365, description="Sales window in days (1–365)"),
    user: StoreUser = ...,
    db: DbSession = ...,
    _: Annotated[User, Depends(require_role(Role.MANAGER, Role.OWNER))] = ...,
) -> PromotionBaselineResponse:
    return await svc.get_promotion_baseline(
        db,
        store_id=user.store_id,
        product_id=product_id,
        days=days,
    )
```

- [ ] **Step 4: Register the router**

In `api/app/api/v1/router.py`, add `promotions` to the import block and register it:

```python
from app.api.v1 import (
    auth,
    categories,
    customers,
    hr,
    inventory,
    membership,
    modifier_groups,
    orders,
    pre_orders,
    production,
    products,
    promotions,
    realtime,
    receipts,
    reports,
    shopping_list,
    stock_takes,
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
api_router.include_router(production.router)
api_router.include_router(stock_takes.router)
api_router.include_router(membership.router)
api_router.include_router(promotions.router)
```

- [ ] **Step 5: Run the API tests to confirm they pass**

```bash
cd api
uv run pytest tests/test_promotions_api.py -v
```

Expected: all 4 tests `PASSED`.

- [ ] **Step 6: Run the full test suite to confirm no regressions**

```bash
cd api
uv run pytest
```

Expected: all tests pass. If pre-existing failures appear (catalog, production, stock takes modules had pre-existing failures before this work), confirm they are unrelated to this change.

- [ ] **Step 7: Commit**

```bash
git add api/app/api/v1/promotions.py api/app/api/v1/router.py api/tests/test_promotions_api.py
git commit -m "feat: promotions calculator baseline endpoint"
```

---

## Verification

After all tasks are complete:

1. Start the dev server: `uv run uvicorn app.main:app --reload --port 8000`
2. Open `http://localhost:8000/docs` and confirm the `promotions` section appears with `GET /api/v1/promotions/calculator/baseline`
3. Test the endpoint with a real product ID from your seeded data and confirm the response shape matches the spec

The frontend can now call:
```
GET /api/v1/promotions/calculator/baseline?product_id=<id>&days=30
Authorization: Bearer <manager-token>

→ {
    "product_id": "...",
    "sales_window_days": 30,
    "units_sold_in_window": "42.00",
    "avg_units_per_week": "9.80"
  }
```

And `GET /api/v1/products/{id}` now returns `cost_per_unit` on each recipe item, enabling the frontend to compute COGS without a separate call.
