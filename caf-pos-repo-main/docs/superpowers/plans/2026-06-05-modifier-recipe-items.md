# Modifier Recipe Items Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow each modifier option to override or delta-adjust individual ingredient quantities in a product's recipe at order time, so stock deductions accurately reflect modifier choices like spiciness (skip chili at 0%), sweetness (reduce syrup + add water at 50%), and size.

**Architecture:** A new `modifier_recipe_items` table links a modifier to per-ingredient adjustments with two modes: `override` (replace the recipe quantity with an exact value, including 0 to skip deduction) and `delta` (add/subtract from the base recipe quantity). At order creation, the deduction loop applies overrides first, then deltas, before accumulating stock movements. Two new CRUD routes (`GET`/`PUT`) are added to the existing modifier-groups router. The existing `modifier.inventory_item_id/inventory_qty` additive field is unchanged — it handles add-on ingredients not in the base recipe (e.g. extra shot espresso).

**Tech Stack:** FastAPI, SQLAlchemy 2.x async, PostgreSQL, Alembic, pytest

---

## File Map

| File | Change |
|---|---|
| `api/app/models/catalog.py` | Add `ModifierRecipeItem` ORM model |
| `api/app/models/__init__.py` | Export `ModifierRecipeItem` |
| `api/alembic/versions/0021_modifier_recipe_items.py` | Create migration |
| `api/app/schemas/catalog.py` | Add `ModifierRecipeItemRead`, `ModifierRecipeItemInput`, `ModifierRecipeItemsBulkReplace` |
| `api/app/services/catalog.py` | Add `get_modifier_recipe_items`, `replace_modifier_recipe_items` |
| `api/app/api/v1/modifier_groups.py` | Add GET and PUT routes |
| `api/app/services/orders.py` | Update `_load_modifiers` + deduction loop |
| `api/tests/factories.py` | Add `make_modifier` and `make_modifier_recipe_item` helpers |
| `api/tests/test_modifier_recipe_items.py` | New test file: CRUD API tests |
| `api/tests/test_modifier_deduction.py` | New test file: order deduction behavior tests |

---

## Task 1: DB Model + Migration

**Files:**
- Modify: `api/app/models/catalog.py`
- Modify: `api/app/models/__init__.py`
- Create: `api/alembic/versions/0021_modifier_recipe_items.py`

- [ ] **Step 1: Write the failing test**

Create `api/tests/test_modifier_recipe_items.py` with just the model persistence test:

```python
import secrets
from decimal import Decimal

import pytest
from app.models.catalog import Modifier, ModifierRecipeItem
from tests.conftest import make_item, make_modifier_group


async def test_modifier_recipe_item_persists(db, store_a, user_a):
    group = await make_modifier_group(db, store_id=store_a.id)
    modifier = Modifier(group_id=group.id, name="50% Spicy", price_delta=Decimal("0"))
    db.add(modifier)
    await db.flush()

    chili = await make_item(db, store_id=store_a.id, name=f"Chili-{secrets.token_hex(4)}")

    mri = ModifierRecipeItem(
        modifier_id=modifier.id,
        inventory_item_id=chili.id,
        quantity=Decimal("5.000"),
        mode="override",
    )
    db.add(mri)
    await db.commit()
    await db.refresh(mri)

    assert mri.id is not None
    assert mri.quantity == Decimal("5.000")
    assert mri.mode == "override"
```

- [ ] **Step 2: Run test to verify it fails**

```
cd api && uv run pytest tests/test_modifier_recipe_items.py::test_modifier_recipe_item_persists -v
```

Expected: FAIL — `ImportError: cannot import name 'ModifierRecipeItem'`

- [ ] **Step 3: Add `ModifierRecipeItem` to `api/app/models/catalog.py`**

Add after the `ProductModifierGroup` class (before `CookingStep`):

```python
class ModifierRecipeItem(Base):
    __tablename__ = "modifier_recipe_items"
    __table_args__ = (
        UniqueConstraint("modifier_id", "inventory_item_id", name="uq_mri_modifier_item"),
    )

    id: Mapped[str] = mapped_column(String(24), primary_key=True, default=new_cuid)
    modifier_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("modifiers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    inventory_item_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("inventory_items.id", ondelete="CASCADE"), nullable=False
    )
    quantity: Mapped[Decimal] = mapped_column(Numeric(10, 3), nullable=False)
    mode: Mapped[str] = mapped_column(String(10), nullable=False, default="override")
```

- [ ] **Step 4: Export `ModifierRecipeItem` in `api/app/models/__init__.py`**

In the `from app.models.catalog import (...)` block, add `ModifierRecipeItem` to the import and to `__all__`:

```python
from app.models.catalog import (
    Category,
    CookingStep,
    Modifier,
    ModifierGroup,
    ModifierRecipeItem,   # ← add
    Product,
    ProductModifierGroup,
    RecipeItem,
)
```

And in `__all__`:

```python
"ModifierRecipeItem",   # ← add after "Modifier"
```

- [ ] **Step 5: Create the Alembic migration**

Create `api/alembic/versions/0021_modifier_recipe_items.py`:

```python
"""add modifier_recipe_items table

Revision ID: 0021
Revises: 0020
Create Date: 2026-06-05
"""

import sqlalchemy as sa
from alembic import op

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "modifier_recipe_items",
        sa.Column("id", sa.String(24), primary_key=True),
        sa.Column(
            "modifier_id",
            sa.String(24),
            sa.ForeignKey("modifiers.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "inventory_item_id",
            sa.String(24),
            sa.ForeignKey("inventory_items.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("quantity", sa.Numeric(10, 3), nullable=False),
        sa.Column(
            "mode", sa.String(10), nullable=False, server_default="override"
        ),
        sa.UniqueConstraint(
            "modifier_id", "inventory_item_id", name="uq_mri_modifier_item"
        ),
    )


def downgrade() -> None:
    op.drop_table("modifier_recipe_items")
```

- [ ] **Step 6: Apply migration**

```
cd api && uv run alembic upgrade head
```

Expected: `Running upgrade 0020 -> 0021`

- [ ] **Step 7: Run test to verify it passes**

```
cd api && uv run pytest tests/test_modifier_recipe_items.py::test_modifier_recipe_item_persists -v
```

Expected: PASS

- [ ] **Step 8: Commit**

```
git add api/app/models/catalog.py api/app/models/__init__.py api/alembic/versions/0021_modifier_recipe_items.py api/tests/test_modifier_recipe_items.py
git commit -m "feat(catalog): add ModifierRecipeItem model and migration 0021"
```

---

## Task 2: Schemas + Factory Helpers

**Files:**
- Modify: `api/app/schemas/catalog.py`
- Modify: `api/tests/factories.py`

- [ ] **Step 1: Add schemas to `api/app/schemas/catalog.py`**

Add after `RecipeBulkReplace` (around line 115):

```python
from typing import Literal


class ModifierRecipeItemRead(_ORM):
    id: str
    inventory_item_id: str
    quantity: Decimal
    mode: str


class ModifierRecipeItemInput(BaseModel):
    inventory_item_id: str
    quantity: Decimal = Field(ge=Decimal("-999999.999"), le=Decimal("999999.999"))
    mode: Literal["override", "delta"] = "override"


class ModifierRecipeItemsBulkReplace(BaseModel):
    items: list[ModifierRecipeItemInput]
```

Note: `quantity` allows negative values because `delta` mode can subtract.

- [ ] **Step 2: Add factory helpers to `api/tests/factories.py`**

Add these two helpers at the bottom of the file:

```python
async def make_modifier(
    db: AsyncSession,
    *,
    group_id: str,
    name: str = "Option",
    price_delta: Decimal = Decimal("0"),
) -> "Modifier":
    from app.models.catalog import Modifier

    modifier = Modifier(group_id=group_id, name=name, price_delta=price_delta)
    db.add(modifier)
    await db.commit()
    await db.refresh(modifier)
    return modifier


async def make_modifier_recipe_item(
    db: AsyncSession,
    *,
    modifier_id: str,
    inventory_item_id: str,
    quantity: Decimal = Decimal("5.000"),
    mode: str = "override",
) -> "ModifierRecipeItem":
    from app.models.catalog import ModifierRecipeItem

    mri = ModifierRecipeItem(
        modifier_id=modifier_id,
        inventory_item_id=inventory_item_id,
        quantity=quantity,
        mode=mode,
    )
    db.add(mri)
    await db.commit()
    await db.refresh(mri)
    return mri
```

Add `"Modifier"` and `"ModifierRecipeItem"` to the string annotations' imports at the top of the file (or use the actual imports):

```python
from app.models.catalog import RecipeItem  # already present — extend this line:
from app.models.catalog import Modifier, ModifierRecipeItem, RecipeItem
```

- [ ] **Step 3: Lint**

```
cd api && uv run ruff check . && uv run ruff format .
```

Fix any issues before continuing.

- [ ] **Step 4: Commit**

```
git add api/app/schemas/catalog.py api/tests/factories.py
git commit -m "feat(catalog): add ModifierRecipeItem schemas and factory helpers"
```

---

## Task 3: CRUD Service + API Routes (TDD)

**Files:**
- Modify: `api/app/services/catalog.py`
- Modify: `api/app/api/v1/modifier_groups.py`
- Modify: `api/tests/test_modifier_recipe_items.py`

- [ ] **Step 1: Write failing tests**

Append to `api/tests/test_modifier_recipe_items.py`:

```python
async def _login(client, store_slug: str, pin: str) -> str:
    resp = await client.post("/api/v1/auth/login", json={"store_slug": store_slug, "pin": pin})
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def test_replace_and_get_modifier_recipe_items(client, db, store_a, manager_a):
    """PUT bulk-replaces recipe items; GET returns them."""
    token = await _login(client, store_a.slug, "2222")

    chili = await make_item(db, store_id=store_a.id, name=f"Chili-{secrets.token_hex(4)}")
    pepper = await make_item(db, store_id=store_a.id, name=f"Pepper-{secrets.token_hex(4)}")

    group = await make_modifier_group(db, store_id=store_a.id)
    from tests.factories import make_modifier
    modifier = await make_modifier(db, group_id=group.id, name="50% Spicy")

    resp = await client.put(
        f"/api/v1/modifier-groups/{group.id}/modifiers/{modifier.id}/recipe-items",
        json={
            "items": [
                {"inventory_item_id": chili.id, "quantity": "5.000", "mode": "override"},
                {"inventory_item_id": pepper.id, "quantity": "-1.000", "mode": "delta"},
            ]
        },
        headers=_h(token),
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert len(data) == 2
    modes = {d["inventory_item_id"]: d["mode"] for d in data}
    assert modes[chili.id] == "override"
    assert modes[pepper.id] == "delta"

    # GET returns same items
    resp2 = await client.get(
        f"/api/v1/modifier-groups/{group.id}/modifiers/{modifier.id}/recipe-items",
        headers=_h(token),
    )
    assert resp2.status_code == 200, resp2.text
    assert len(resp2.json()) == 2


async def test_replace_clears_previous_items(client, db, store_a, manager_a):
    """Second PUT replaces all previous recipe items."""
    token = await _login(client, store_a.slug, "2222")

    chili = await make_item(db, store_id=store_a.id, name=f"Chili-{secrets.token_hex(4)}")
    pepper = await make_item(db, store_id=store_a.id, name=f"Pepper-{secrets.token_hex(4)}")

    group = await make_modifier_group(db, store_id=store_a.id)
    from tests.factories import make_modifier
    modifier = await make_modifier(db, group_id=group.id, name="0% Spicy")

    # First PUT: two items
    await client.put(
        f"/api/v1/modifier-groups/{group.id}/modifiers/{modifier.id}/recipe-items",
        json={"items": [
            {"inventory_item_id": chili.id, "quantity": "0.000", "mode": "override"},
            {"inventory_item_id": pepper.id, "quantity": "0.000", "mode": "override"},
        ]},
        headers=_h(token),
    )

    # Second PUT: only chili
    resp = await client.put(
        f"/api/v1/modifier-groups/{group.id}/modifiers/{modifier.id}/recipe-items",
        json={"items": [
            {"inventory_item_id": chili.id, "quantity": "3.000", "mode": "override"},
        ]},
        headers=_h(token),
    )
    assert resp.status_code == 200, resp.text
    assert len(resp.json()) == 1

    resp2 = await client.get(
        f"/api/v1/modifier-groups/{group.id}/modifiers/{modifier.id}/recipe-items",
        headers=_h(token),
    )
    assert len(resp2.json()) == 1  # pepper was removed
    assert resp2.json()[0]["inventory_item_id"] == chili.id


async def test_recipe_items_requires_manager(client, db, store_a, user_a):
    """Regular barista cannot write modifier recipe items."""
    token = await _login(client, store_a.slug, "1111")

    group = await make_modifier_group(db, store_id=store_a.id)
    from tests.factories import make_modifier
    modifier = await make_modifier(db, group_id=group.id, name="Any")

    resp = await client.put(
        f"/api/v1/modifier-groups/{group.id}/modifiers/{modifier.id}/recipe-items",
        json={"items": []},
        headers=_h(token),
    )
    assert resp.status_code == 403


async def test_recipe_items_wrong_store(client, db, store_b, user_b, store_a, manager_a):
    """Manager of store_a cannot touch modifier groups belonging to store_b."""
    token = await _login(client, store_a.slug, "2222")

    group_b = await make_modifier_group(db, store_id=store_b.id)
    from tests.factories import make_modifier
    modifier_b = await make_modifier(db, group_id=group_b.id, name="Any")

    resp = await client.put(
        f"/api/v1/modifier-groups/{group_b.id}/modifiers/{modifier_b.id}/recipe-items",
        json={"items": []},
        headers=_h(token),
    )
    assert resp.status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

```
cd api && uv run pytest tests/test_modifier_recipe_items.py -v -k "not persists"
```

Expected: FAIL — routes return 404 (not found = not yet registered)

- [ ] **Step 3: Add service functions to `api/app/services/catalog.py`**

Add these two functions. Place them near the existing modifier helpers (search for `remove_modifier`):

```python
async def get_modifier_recipe_items(
    db: AsyncSession,
    *,
    store_id: str,
    group_id: str,
    modifier_id: str,
) -> list[ModifierRecipeItem]:
    group = await db.scalar(
        select(ModifierGroup).where(
            ModifierGroup.id == group_id,
            ModifierGroup.store_id == store_id,
        )
    )
    if not group:
        raise NotFound(f"Modifier group {group_id} not found")
    modifier = await db.scalar(
        select(Modifier).where(
            Modifier.id == modifier_id,
            Modifier.group_id == group_id,
        )
    )
    if not modifier:
        raise NotFound(f"Modifier {modifier_id} not found in group {group_id}")
    result = await db.execute(
        select(ModifierRecipeItem).where(ModifierRecipeItem.modifier_id == modifier_id)
    )
    return list(result.scalars())


async def replace_modifier_recipe_items(
    db: AsyncSession,
    *,
    store_id: str,
    group_id: str,
    modifier_id: str,
    payload: ModifierRecipeItemsBulkReplace,
) -> list[ModifierRecipeItem]:
    async with db.begin():
        group = await db.scalar(
            select(ModifierGroup).where(
                ModifierGroup.id == group_id,
                ModifierGroup.store_id == store_id,
            )
        )
        if not group:
            raise NotFound(f"Modifier group {group_id} not found")
        modifier = await db.scalar(
            select(Modifier).where(
                Modifier.id == modifier_id,
                Modifier.group_id == group_id,
            )
        )
        if not modifier:
            raise NotFound(f"Modifier {modifier_id} not found in group {group_id}")

        await db.execute(
            delete(ModifierRecipeItem).where(ModifierRecipeItem.modifier_id == modifier_id)
        )

        new_items = [
            ModifierRecipeItem(
                modifier_id=modifier_id,
                inventory_item_id=item.inventory_item_id,
                quantity=item.quantity,
                mode=item.mode,
            )
            for item in payload.items
        ]
        for mri in new_items:
            db.add(mri)

        await db.flush()
        for mri in new_items:
            await db.refresh(mri)

        return new_items
```

Also add these imports to `catalog.py` if not already present:

```python
from sqlalchemy import delete  # add to existing SQLAlchemy imports
from app.models.catalog import ModifierRecipeItem  # add to model imports
from app.schemas.catalog import ModifierRecipeItemsBulkReplace  # add to schema imports
```

- [ ] **Step 4: Add routes to `api/app/api/v1/modifier_groups.py`**

Append after the existing `delete_modifier_from_group` route:

```python
from app.schemas.catalog import ModifierRecipeItemRead, ModifierRecipeItemsBulkReplace


@router.get(
    "/{group_id}/modifiers/{modifier_id}/recipe-items",
    response_model=list[ModifierRecipeItemRead],
    summary="List recipe item overrides/deltas for a modifier option",
    operation_id="modifier_recipe_items_list",
)
async def list_modifier_recipe_items(
    group_id: str, modifier_id: str, user: StoreUser, db: DbSession
) -> list[ModifierRecipeItemRead]:
    items = await svc.get_modifier_recipe_items(
        db, store_id=user.store_id, group_id=group_id, modifier_id=modifier_id
    )
    return [ModifierRecipeItemRead.model_validate(i) for i in items]


@router.put(
    "/{group_id}/modifiers/{modifier_id}/recipe-items",
    response_model=list[ModifierRecipeItemRead],
    summary="Bulk-replace recipe item overrides/deltas for a modifier option",
    operation_id="modifier_recipe_items_replace",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def replace_modifier_recipe_items(
    group_id: str,
    modifier_id: str,
    payload: ModifierRecipeItemsBulkReplace,
    user: StoreUser,
    db: DbSession,
) -> list[ModifierRecipeItemRead]:
    items = await svc.replace_modifier_recipe_items(
        db,
        store_id=user.store_id,
        group_id=group_id,
        modifier_id=modifier_id,
        payload=payload,
    )
    return [ModifierRecipeItemRead.model_validate(i) for i in items]
```

- [ ] **Step 5: Run tests to verify they pass**

```
cd api && uv run pytest tests/test_modifier_recipe_items.py -v
```

Expected: all PASS

- [ ] **Step 6: Lint**

```
cd api && uv run ruff check . && uv run ruff format .
```

- [ ] **Step 7: Commit**

```
git add api/app/services/catalog.py api/app/api/v1/modifier_groups.py api/tests/test_modifier_recipe_items.py
git commit -m "feat(catalog): add modifier recipe item CRUD endpoints GET/PUT"
```

---

## Task 4: Order Deduction Logic (TDD)

**Files:**
- Create: `api/tests/test_modifier_deduction.py`
- Modify: `api/app/services/orders.py`

- [ ] **Step 1: Write failing tests**

Create `api/tests/test_modifier_deduction.py`:

```python
"""Tests: modifier recipe items affect stock deduction at order time."""
import secrets
from decimal import Decimal

from app.models.catalog import Modifier, ModifierRecipeItem, ProductModifierGroup, RecipeItem
from tests.conftest import make_item, make_modifier_group, make_product


async def _login(client, store_slug: str, pin: str) -> str:
    resp = await client.post("/api/v1/auth/login", json={"store_slug": store_slug, "pin": pin})
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _setup_product_with_modifier(db, store_id, *, recipe: dict, modifier_name: str):
    """
    Creates a product with a recipe and one modifier option linked to it.

    recipe: {inventory_item: quantity} dict — items must already exist.
    Returns (product, modifier, {name: inventory_item}) for assertions.
    """
    product = await make_product(
        db, store_id=store_id, name=f"Dish-{secrets.token_hex(4)}", price=Decimal("100")
    )
    for inv_item, qty in recipe.items():
        db.add(RecipeItem(product_id=product.id, inventory_item_id=inv_item.id, quantity=qty))

    group = await make_modifier_group(db, store_id=store_id)
    modifier = Modifier(group_id=group.id, name=modifier_name, price_delta=Decimal("0"))
    db.add(modifier)
    db.add(ProductModifierGroup(product_id=product.id, modifier_group_id=group.id, sort_order=0))
    await db.commit()
    await db.refresh(modifier)
    return product, modifier


async def test_override_replaces_recipe_quantity(client, db, store_a, user_a):
    """Modifier with override=5 deducts 5, not the base recipe value of 10."""
    token = await _login(client, store_a.slug, "1111")

    chili = await make_item(db, store_id=store_a.id, name=f"Chili-{secrets.token_hex(4)}", stock=Decimal("100"))
    pepper = await make_item(db, store_id=store_a.id, name=f"Pepper-{secrets.token_hex(4)}", stock=Decimal("100"))

    product, modifier = await _setup_product_with_modifier(
        db, store_a.id,
        recipe={chili: Decimal("10"), pepper: Decimal("2")},
        modifier_name="50% Spicy",
    )
    # Override chili to 5g; pepper is untouched by this modifier
    db.add(ModifierRecipeItem(
        modifier_id=modifier.id, inventory_item_id=chili.id,
        quantity=Decimal("5"), mode="override",
    ))
    await db.commit()

    resp = await client.post("/api/v1/orders", headers=_h(token), json={
        "idempotency_key": secrets.token_hex(8),
        "channel": "DINE_IN",
        "items": [{"product_id": product.id, "quantity": 1, "modifier_ids": [modifier.id]}],
    })
    assert resp.status_code == 201, resp.text

    await db.refresh(chili)
    await db.refresh(pepper)
    assert chili.stock_on_hand == Decimal("95")   # 100 - 5 (overridden)
    assert pepper.stock_on_hand == Decimal("98")  # 100 - 2 (base recipe, untouched)


async def test_override_to_zero_skips_deduction(client, db, store_a, user_a):
    """Modifier with override=0 means the ingredient is not deducted at all."""
    token = await _login(client, store_a.slug, "1111")

    chili = await make_item(db, store_id=store_a.id, name=f"Chili-{secrets.token_hex(4)}", stock=Decimal("100"))
    pepper = await make_item(db, store_id=store_a.id, name=f"Pepper-{secrets.token_hex(4)}", stock=Decimal("100"))

    product, modifier = await _setup_product_with_modifier(
        db, store_a.id,
        recipe={chili: Decimal("10"), pepper: Decimal("2")},
        modifier_name="0% Spicy",
    )
    # Override both to 0 — nothing should be deducted
    db.add(ModifierRecipeItem(
        modifier_id=modifier.id, inventory_item_id=chili.id,
        quantity=Decimal("0"), mode="override",
    ))
    db.add(ModifierRecipeItem(
        modifier_id=modifier.id, inventory_item_id=pepper.id,
        quantity=Decimal("0"), mode="override",
    ))
    await db.commit()

    resp = await client.post("/api/v1/orders", headers=_h(token), json={
        "idempotency_key": secrets.token_hex(8),
        "channel": "DINE_IN",
        "items": [{"product_id": product.id, "quantity": 1, "modifier_ids": [modifier.id]}],
    })
    assert resp.status_code == 201, resp.text

    await db.refresh(chili)
    await db.refresh(pepper)
    assert chili.stock_on_hand == Decimal("100")   # not deducted
    assert pepper.stock_on_hand == Decimal("100")  # not deducted


async def test_delta_subtracts_from_recipe(client, db, store_a, user_a):
    """Modifier with delta=-5 reduces syrup deduction from base 10 to 5."""
    token = await _login(client, store_a.slug, "1111")

    syrup = await make_item(db, store_id=store_a.id, name=f"Syrup-{secrets.token_hex(4)}", stock=Decimal("100"))

    product, modifier = await _setup_product_with_modifier(
        db, store_a.id,
        recipe={syrup: Decimal("10")},
        modifier_name="50% Sweet",
    )
    db.add(ModifierRecipeItem(
        modifier_id=modifier.id, inventory_item_id=syrup.id,
        quantity=Decimal("-5"), mode="delta",
    ))
    await db.commit()

    resp = await client.post("/api/v1/orders", headers=_h(token), json={
        "idempotency_key": secrets.token_hex(8),
        "channel": "DINE_IN",
        "items": [{"product_id": product.id, "quantity": 1, "modifier_ids": [modifier.id]}],
    })
    assert resp.status_code == 201, resp.text

    await db.refresh(syrup)
    assert syrup.stock_on_hand == Decimal("95")   # 100 - (10 - 5)


async def test_delta_adds_ingredient_not_in_recipe(client, db, store_a, user_a):
    """Modifier with delta on an ingredient not in base recipe adds that deduction."""
    token = await _login(client, store_a.slug, "1111")

    syrup = await make_item(db, store_id=store_a.id, name=f"Syrup-{secrets.token_hex(4)}", stock=Decimal("100"))
    water = await make_item(db, store_id=store_a.id, name=f"Water-{secrets.token_hex(4)}", stock=Decimal("100"))

    product, modifier = await _setup_product_with_modifier(
        db, store_a.id,
        recipe={syrup: Decimal("10")},  # water not in base recipe
        modifier_name="50% Sweet + water",
    )
    db.add(ModifierRecipeItem(
        modifier_id=modifier.id, inventory_item_id=syrup.id,
        quantity=Decimal("-5"), mode="delta",
    ))
    db.add(ModifierRecipeItem(
        modifier_id=modifier.id, inventory_item_id=water.id,
        quantity=Decimal("3"), mode="delta",  # adds water even though not in recipe
    ))
    await db.commit()

    resp = await client.post("/api/v1/orders", headers=_h(token), json={
        "idempotency_key": secrets.token_hex(8),
        "channel": "DINE_IN",
        "items": [{"product_id": product.id, "quantity": 1, "modifier_ids": [modifier.id]}],
    })
    assert resp.status_code == 201, resp.text

    await db.refresh(syrup)
    await db.refresh(water)
    assert syrup.stock_on_hand == Decimal("95")   # 100 - (10 - 5)
    assert water.stock_on_hand == Decimal("97")   # 100 - (0 + 3)


async def test_recipe_items_scale_with_order_quantity(client, db, store_a, user_a):
    """Deductions multiply by order quantity, including modifier overrides."""
    token = await _login(client, store_a.slug, "1111")

    chili = await make_item(db, store_id=store_a.id, name=f"Chili-{secrets.token_hex(4)}", stock=Decimal("100"))

    product, modifier = await _setup_product_with_modifier(
        db, store_a.id,
        recipe={chili: Decimal("10")},
        modifier_name="50% Spicy",
    )
    db.add(ModifierRecipeItem(
        modifier_id=modifier.id, inventory_item_id=chili.id,
        quantity=Decimal("5"), mode="override",
    ))
    await db.commit()

    resp = await client.post("/api/v1/orders", headers=_h(token), json={
        "idempotency_key": secrets.token_hex(8),
        "channel": "DINE_IN",
        "items": [{"product_id": product.id, "quantity": 3, "modifier_ids": [modifier.id]}],
    })
    assert resp.status_code == 201, resp.text

    await db.refresh(chili)
    assert chili.stock_on_hand == Decimal("85")   # 100 - (5 * 3)


async def test_no_modifier_recipe_items_uses_base_recipe(client, db, store_a, user_a):
    """Without any ModifierRecipeItem rows, base recipe deduction is unchanged."""
    token = await _login(client, store_a.slug, "1111")

    chili = await make_item(db, store_id=store_a.id, name=f"Chili-{secrets.token_hex(4)}", stock=Decimal("100"))

    product, modifier = await _setup_product_with_modifier(
        db, store_a.id,
        recipe={chili: Decimal("10")},
        modifier_name="100% Spicy (no override)",
    )
    # No ModifierRecipeItem rows added

    resp = await client.post("/api/v1/orders", headers=_h(token), json={
        "idempotency_key": secrets.token_hex(8),
        "channel": "DINE_IN",
        "items": [{"product_id": product.id, "quantity": 1, "modifier_ids": [modifier.id]}],
    })
    assert resp.status_code == 201, resp.text

    await db.refresh(chili)
    assert chili.stock_on_hand == Decimal("90")   # 100 - 10 (base recipe)
```

- [ ] **Step 2: Run tests to verify they fail**

```
cd api && uv run pytest tests/test_modifier_deduction.py -v
```

Expected: FAIL — stock values are wrong (deduction ignores modifier recipe items)

- [ ] **Step 3: Update `_load_modifiers` in `api/app/services/orders.py`**

Change the signature and body of `_load_modifiers` (currently around line 442):

```python
async def _load_modifiers(
    db: AsyncSession, *, modifier_ids: list[str]
) -> tuple[list[Modifier], list[tuple[str, Decimal]], list[ModifierRecipeItem]]:
    if not modifier_ids:
        return [], [], []
    result = await db.execute(select(Modifier).where(Modifier.id.in_(modifier_ids)))
    modifiers = list(result.scalars())
    inv_deductions = [
        (m.inventory_item_id, m.inventory_qty)
        for m in modifiers
        if m.inventory_item_id and m.inventory_qty
    ]
    mri_result = await db.execute(
        select(ModifierRecipeItem).where(ModifierRecipeItem.modifier_id.in_(modifier_ids))
    )
    mod_recipe_items = list(mri_result.scalars())
    return modifiers, inv_deductions, mod_recipe_items
```

Also add `ModifierRecipeItem` to the imports at the top of `orders.py`:

```python
from app.models.catalog import Modifier, ModifierRecipeItem, Product, RecipeItem
```

- [ ] **Step 4: Update the `_load_modifiers` call site and `line_data` in `create_order`**

In `create_order`, change the call at line ~60 from:

```python
modifiers, mod_inv = await _load_modifiers(db, modifier_ids=item_in.modifier_ids)
```

To:

```python
modifiers, mod_inv, mod_recipe_items = await _load_modifiers(db, modifier_ids=item_in.modifier_ids)
```

And in `line_data.append({...})`, add `"mod_recipe_items": mod_recipe_items` alongside `"mod_inv": mod_inv`.

- [ ] **Step 5: Replace the recipe deduction block in `create_order`**

Find the block that currently reads (around line 137–142):

```python
else:
    for ri in await _load_recipe(db, product_id=ld["product_id"]):
        qty = ri.quantity * ld["quantity"]
        inv_deductions[ri.inventory_item_id] = (
            inv_deductions.get(ri.inventory_item_id, Decimal("0")) + qty
        )
```

Replace with:

```python
else:
    recipe_qty: dict[str, Decimal] = {
        ri.inventory_item_id: ri.quantity
        for ri in await _load_recipe(db, product_id=ld["product_id"])
    }
    # Apply overrides first (can set quantity to 0 to skip deduction)
    for mri in ld["mod_recipe_items"]:
        if mri.mode == "override":
            recipe_qty[mri.inventory_item_id] = mri.quantity
    # Apply deltas second (adds/subtracts; can introduce ingredients not in base recipe)
    for mri in ld["mod_recipe_items"]:
        if mri.mode == "delta":
            recipe_qty[mri.inventory_item_id] = (
                recipe_qty.get(mri.inventory_item_id, Decimal("0")) + mri.quantity
            )
    for item_id, base_qty in recipe_qty.items():
        effective_qty = base_qty * ld["quantity"]
        if effective_qty > Decimal("0"):
            inv_deductions[item_id] = (
                inv_deductions.get(item_id, Decimal("0")) + effective_qty
            )
```

- [ ] **Step 6: Run tests to verify they pass**

```
cd api && uv run pytest tests/test_modifier_deduction.py -v
```

Expected: all PASS

- [ ] **Step 7: Run full test suite to verify no regressions**

```
cd api && uv run pytest --tb=short -q
```

Expected: all existing tests still pass.

- [ ] **Step 8: Lint**

```
cd api && uv run ruff check . && uv run ruff format .
```

- [ ] **Step 9: Commit**

```
git add api/app/services/orders.py api/tests/test_modifier_deduction.py
git commit -m "feat(orders): apply modifier recipe item overrides and deltas to stock deduction"
```

---

## Self-Review Checklist

- [x] **Override mode** (Task 4, test 1): modifier sets ingredient to exact value → covered
- [x] **Override to 0** (Task 4, test 2): ingredient skipped entirely → covered
- [x] **Delta subtract** (Task 4, test 3): reduces existing recipe quantity → covered
- [x] **Delta on new ingredient** (Task 4, test 4): adds ingredient not in base recipe → covered
- [x] **Quantity scaling** (Task 4, test 5): override × order_qty → covered
- [x] **No modifier recipe items** (Task 4, test 6): base recipe unchanged → covered
- [x] **CRUD: PUT bulk-replace** (Task 3, test 1): creates/replaces items → covered
- [x] **CRUD: idempotent replace** (Task 3, test 2): second PUT removes old items → covered
- [x] **CRUD: auth gate** (Task 3, test 3): barista gets 403 → covered
- [x] **CRUD: store isolation** (Task 3, test 4): cross-store 404 → covered
- [x] **Existing additive modifier** (`modifier.inventory_item_id`): unchanged — `mod_inv` path untouched
- [x] **PRODUCED products**: override/delta block is inside the `else` branch for `MADE_TO_ORDER` only — PRODUCED products deduct finished goods, not recipe; no change needed
- [x] **No placeholders**: all steps contain complete code
- [x] **Type consistency**: `mod_recipe_items` (list[ModifierRecipeItem]) used consistently across tasks 2–4
