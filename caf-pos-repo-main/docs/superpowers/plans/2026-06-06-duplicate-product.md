# Duplicate Product Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `POST /products/{product_id}/duplicate` — atomically clones a product with its recipe items, modifier group links, and cooking steps, then returns the new `ProductDetail`.

**Architecture:** One new `duplicate_product` service function in `services/catalog.py` (all writes in a single `async with db.begin()` block, then delegates to the existing `get_product_detail` for the response). One new route in `api/v1/products.py`. No new schemas or migrations.

**Tech Stack:** FastAPI, SQLAlchemy 2.x async, pytest-anyio, PostgreSQL

---

## Files

| File | Change |
|---|---|
| `app/services/catalog.py` | Add `duplicate_product` after `delete_product` |
| `app/api/v1/products.py` | Add `POST /{product_id}/duplicate` route |
| `tests/test_duplicate_product.py` | New — service-level + HTTP integration tests |

---

### Task 1: Service function + tests

**Files:**
- Modify: `app/services/catalog.py` (add after line ~248, after `delete_product`)
- Create: `tests/test_duplicate_product.py`

- [ ] **Step 1: Write failing test — basic field copy**

Create `api/tests/test_duplicate_product.py`:

```python
from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.catalog import CookingStep, ProductModifierGroup, RecipeItem
from app.services import catalog as svc
from tests.factories import make_category, make_item, make_modifier_group, make_product, make_recipe_item


@pytest.mark.anyio
async def test_duplicate_copies_basic_fields(db: AsyncSession, store_a):
    cat = await make_category(db, store_id=store_a.id, name="Hot Drinks")
    source = await make_product(
        db,
        store_id=store_a.id,
        name="Latte",
        price=Decimal("85.00"),
        category_id=cat.id,
        is_active=True,
        servings_per_batch=2,
    )

    result = await svc.duplicate_product(db, store_id=store_a.id, product_id=source.id)

    assert result.id != source.id
    assert result.name == "Copy of Latte"
    assert result.price == Decimal("85.00")
    assert result.category_id == cat.id
    assert result.is_active is True
    assert result.servings_per_batch == 2
    assert result.store_id == store_a.id
```

- [ ] **Step 2: Run test — expect failure**

```bash
cd api && uv run pytest tests/test_duplicate_product.py::test_duplicate_copies_basic_fields -v
```

Expected: `AttributeError: module 'app.services.catalog' has no attribute 'duplicate_product'`

- [ ] **Step 3: Implement `duplicate_product` in `app/services/catalog.py`**

All needed imports (`CookingStep`, `ProductModifierGroup`, `RecipeItem`, `InventoryItem`, `ProductDetail`, `ProductType`, `Decimal`, `select`) are already present at the top of the file. Add this function after `delete_product`:

```python
async def duplicate_product(
    db: AsyncSession, *, store_id: str, product_id: str
) -> ProductDetail:
    async with db.begin():
        source = await _load_product(db, store_id=store_id, product_id=product_id)

        r = await db.execute(select(RecipeItem).where(RecipeItem.product_id == source.id))
        source_recipe = list(r.scalars())

        r = await db.execute(
            select(ProductModifierGroup)
            .where(ProductModifierGroup.product_id == source.id)
            .order_by(ProductModifierGroup.sort_order)
        )
        source_pmgs = list(r.scalars())

        r = await db.execute(
            select(CookingStep)
            .where(CookingStep.product_id == source.id)
            .order_by(CookingStep.sort_order)
        )
        source_steps = list(r.scalars())

        new_name = f"Copy of {source.name}"[:120]
        clone = Product(
            store_id=store_id,
            category_id=source.category_id,
            name=new_name,
            description=source.description,
            price=source.price,
            is_active=source.is_active,
            product_type=source.product_type,
            servings_per_batch=source.servings_per_batch,
        )
        db.add(clone)
        await db.flush()

        if source.product_type == ProductType.PRODUCED:
            inv_item = InventoryItem(
                store_id=store_id,
                name=new_name,
                unit="piece",
                cost_per_unit=Decimal("0"),
                stock_on_hand=Decimal("0"),
                par_level=Decimal("0"),
            )
            db.add(inv_item)
            await db.flush()
            clone.finished_goods_item_id = inv_item.id

        db.add_all([
            RecipeItem(
                product_id=clone.id,
                inventory_item_id=ri.inventory_item_id,
                quantity=ri.quantity,
            )
            for ri in source_recipe
        ])
        db.add_all([
            ProductModifierGroup(
                product_id=clone.id,
                modifier_group_id=pmg.modifier_group_id,
                sort_order=pmg.sort_order,
            )
            for pmg in source_pmgs
        ])
        db.add_all([
            CookingStep(
                product_id=clone.id,
                sort_order=step.sort_order,
                instruction=step.instruction,
            )
            for step in source_steps
        ])

        clone_id = clone.id

    return await get_product_detail(db, store_id=store_id, product_id=clone_id)
```

- [ ] **Step 4: Run test — expect pass**

```bash
cd api && uv run pytest tests/test_duplicate_product.py::test_duplicate_copies_basic_fields -v
```

Expected: PASS

- [ ] **Step 5: Write remaining service tests**

Append to `api/tests/test_duplicate_product.py`:

```python
@pytest.mark.anyio
async def test_duplicate_name_truncated_to_120(db: AsyncSession, store_a):
    long_name = "A" * 115  # "Copy of " (8) + 115 = 123, must be clipped to 120
    source = await make_product(db, store_id=store_a.id, name=long_name)

    result = await svc.duplicate_product(db, store_id=store_a.id, product_id=source.id)

    assert len(result.name) == 120
    assert result.name.startswith("Copy of ")


@pytest.mark.anyio
async def test_duplicate_copies_recipe(db: AsyncSession, store_a):
    source = await make_product(db, store_id=store_a.id, name="Cappuccino")
    beans = await make_item(db, store_id=store_a.id, name="Beans")
    milk = await make_item(db, store_id=store_a.id, name="Milk")
    await make_recipe_item(db, product_id=source.id, inventory_item_id=beans.id, quantity=Decimal("18"))
    await make_recipe_item(db, product_id=source.id, inventory_item_id=milk.id, quantity=Decimal("150"))

    result = await svc.duplicate_product(db, store_id=store_a.id, product_id=source.id)

    assert len(result.recipe) == 2
    cloned_inv_ids = {ri.inventory_item_id for ri in result.recipe}
    assert cloned_inv_ids == {beans.id, milk.id}


@pytest.mark.anyio
async def test_duplicate_copies_modifier_groups(db: AsyncSession, store_a):
    source = await make_product(db, store_id=store_a.id, name="Latte")
    grp = await make_modifier_group(db, store_id=store_a.id, name="Milk Type")
    db.add(ProductModifierGroup(product_id=source.id, modifier_group_id=grp.id, sort_order=0))
    await db.commit()

    result = await svc.duplicate_product(db, store_id=store_a.id, product_id=source.id)

    assert len(result.modifier_groups) == 1
    assert result.modifier_groups[0].id == grp.id


@pytest.mark.anyio
async def test_duplicate_copies_cooking_steps(db: AsyncSession, store_a):
    source = await make_product(db, store_id=store_a.id, name="Cold Brew")
    db.add_all([
        CookingStep(product_id=source.id, sort_order=0, instruction="Grind beans"),
        CookingStep(product_id=source.id, sort_order=1, instruction="Steep 12h"),
    ])
    await db.commit()

    result = await svc.duplicate_product(db, store_id=store_a.id, product_id=source.id)

    # Steps are not in ProductDetail — query the DB directly
    r = await db.execute(select(CookingStep).where(CookingStep.product_id == result.id))
    cloned_steps = list(r.scalars())
    assert len(cloned_steps) == 2
    assert {s.instruction for s in cloned_steps} == {"Grind beans", "Steep 12h"}


@pytest.mark.anyio
async def test_duplicate_produced_creates_new_inventory_item(db: AsyncSession, store_a):
    finished = await make_item(db, store_id=store_a.id, name="Croissant Finished")
    source = await make_product(
        db,
        store_id=store_a.id,
        name="Croissant",
        product_type="PRODUCED",
        finished_goods_item_id=finished.id,
    )

    result = await svc.duplicate_product(db, store_id=store_a.id, product_id=source.id)

    assert result.finished_goods_item_id is not None
    assert result.finished_goods_item_id != finished.id  # new inventory item


@pytest.mark.anyio
async def test_duplicate_not_found(db: AsyncSession, store_a):
    from app.core.errors import NotFound

    with pytest.raises(NotFound):
        await svc.duplicate_product(db, store_id=store_a.id, product_id="nonexistent000000000000")


@pytest.mark.anyio
async def test_duplicate_wrong_store(db: AsyncSession, store_a, store_b):
    from app.core.errors import NotFound

    source = await make_product(db, store_id=store_a.id, name="Latte")

    with pytest.raises(NotFound):
        await svc.duplicate_product(db, store_id=store_b.id, product_id=source.id)
```

- [ ] **Step 6: Run all service tests — expect all pass**

```bash
cd api && uv run pytest tests/test_duplicate_product.py -v
```

Expected: 8 tests PASS

- [ ] **Step 7: Commit**

```bash
cd api && git add app/services/catalog.py tests/test_duplicate_product.py
git commit -m "feat(catalog): add duplicate_product service function"
```

---

### Task 2: Router endpoint + HTTP test

**Files:**
- Modify: `app/api/v1/products.py`
- Modify: `tests/test_duplicate_product.py` (append HTTP tests)

- [ ] **Step 1: Write failing HTTP tests**

The auth pattern used in this test suite: call `POST /api/v1/auth/login` with `store_slug` + `pin` to get a token, then pass it as `Authorization: Bearer <token>`. `user_a` PIN is `"1111"` (BARISTA role), `manager_a` PIN is `"2222"` (MANAGER role).

Append to `api/tests/test_duplicate_product.py`:

```python
async def _login(client, store_slug: str, pin: str) -> str:
    resp = await client.post("/api/v1/auth/login", json={"store_slug": store_slug, "pin": pin})
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.anyio
async def test_duplicate_endpoint_happy_path(client, db, store_a, manager_a):
    source = await make_product(db, store_id=store_a.id, name="Espresso")
    token = await _login(client, store_a.slug, "2222")

    resp = await client.post(f"/api/v1/products/{source.id}/duplicate", headers=_h(token))

    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["name"] == "Copy of Espresso"
    assert data["id"] != source.id


@pytest.mark.anyio
async def test_duplicate_endpoint_barista_gets_403(client, db, store_a, user_a):
    source = await make_product(db, store_id=store_a.id, name="Espresso")
    token = await _login(client, store_a.slug, "1111")

    resp = await client.post(f"/api/v1/products/{source.id}/duplicate", headers=_h(token))

    assert resp.status_code == 403


@pytest.mark.anyio
async def test_duplicate_endpoint_not_found(client, db, store_a, manager_a):
    token = await _login(client, store_a.slug, "2222")

    resp = await client.post("/api/v1/products/nonexistent000000000000/duplicate", headers=_h(token))

    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "NOT_FOUND"
```

- [ ] **Step 2: Run tests — expect failure**

```bash
cd api && uv run pytest tests/test_duplicate_product.py::test_duplicate_endpoint_happy_path tests/test_duplicate_product.py::test_duplicate_endpoint_barista_gets_403 tests/test_duplicate_product.py::test_duplicate_endpoint_not_found -v
```

Expected: `404 Not Found` on the duplicate call (route doesn't exist yet).

- [ ] **Step 3: Add the route to `app/api/v1/products.py`**

Add after `delete_product` (around line 96), before the recipe routes:

```python
@router.post(
    "/{product_id}/duplicate",
    response_model=ProductDetail,
    status_code=201,
    summary="Duplicate a product with its recipe, modifier groups, and cooking steps",
    operation_id="products_duplicate",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def duplicate_product(
    product_id: str, user: StoreUser, db: DbSession
) -> ProductDetail:
    return await svc.duplicate_product(db, store_id=user.store_id, product_id=product_id)
```

Also add `ProductDetail` to the import from `app.schemas.catalog` at the top of `products.py` — it is already imported (line 6), so no change needed.

- [ ] **Step 4: Run full test file — expect all pass**

```bash
cd api && uv run pytest tests/test_duplicate_product.py -v
```

Expected: all tests PASS

- [ ] **Step 5: Run full suite to catch regressions**

```bash
cd api && uv run pytest --tb=short -q
```

Expected: no new failures

- [ ] **Step 6: Lint**

```bash
cd api && uv run ruff check . && uv run ruff format --check .
```

Expected: no errors. If any, run `uv run ruff check --fix . && uv run ruff format .` then re-check.

- [ ] **Step 7: Commit**

```bash
git add app/api/v1/products.py tests/test_duplicate_product.py
git commit -m "feat(catalog): add POST /products/{id}/duplicate endpoint"
```
