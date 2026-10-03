from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFound
from app.enums import ProductType
from app.models.catalog import CookingStep, ModifierRecipeItem, ProductModifierGroup
from app.models.inventory import InventoryItem
from app.services import catalog as svc
from tests.factories import (
    make_category,
    make_item,
    make_modifier,
    make_modifier_group,
    make_modifier_recipe_item,
    make_product,
    make_recipe_item,
)


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
    async with db.begin():
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
        product_type=ProductType.PRODUCED,
        finished_goods_item_id=finished.id,
    )

    result = await svc.duplicate_product(db, store_id=store_a.id, product_id=source.id)

    assert result.finished_goods_item_id is not None
    assert result.finished_goods_item_id != finished.id  # new inventory item

    # Verify unit and par_level are copied from source's finished goods item
    async with db.begin():
        r = await db.execute(select(InventoryItem).where(InventoryItem.id == result.finished_goods_item_id))
        cloned_inv = r.scalar_one()
    assert cloned_inv.unit == finished.unit
    assert cloned_inv.par_level == finished.par_level


@pytest.mark.anyio
async def test_duplicate_shares_modifier_recipe_items(db: AsyncSession, store_a):
    # ModifierRecipeItem rows are scoped to modifier_id (not product_id).
    # Duplicating a product reuses the same modifier group links, so the clone
    # inherits the existing MRI overrides automatically — no new rows are created.
    source = await make_product(db, store_id=store_a.id, name="Latte")
    grp = await make_modifier_group(db, store_id=store_a.id, name="Milk Type")
    db.add(ProductModifierGroup(product_id=source.id, modifier_group_id=grp.id, sort_order=0))
    await db.commit()
    mod = await make_modifier(db, group_id=grp.id, name="Oat Milk")
    item = await make_item(db, store_id=store_a.id, name="Oat Milk Carton")
    await make_modifier_recipe_item(
        db, modifier_id=mod.id, inventory_item_id=item.id, quantity=Decimal("200.000"), mode="override"
    )
    await db.commit()

    result = await svc.duplicate_product(db, store_id=store_a.id, product_id=source.id)

    # Exactly one MRI row for this modifier — not duplicated
    async with db.begin():
        r = await db.execute(
            select(ModifierRecipeItem).where(ModifierRecipeItem.modifier_id == mod.id)
        )
        all_mris = list(r.scalars())
    assert len(all_mris) == 1
    assert all_mris[0].inventory_item_id == item.id
    assert all_mris[0].quantity == Decimal("200.000")
    assert all_mris[0].mode == "override"
    # Clone links to the same modifier group, so MRI overrides apply to it too
    assert len(result.modifier_groups) == 1
    assert result.modifier_groups[0].id == grp.id


@pytest.mark.anyio
async def test_duplicate_not_found(db: AsyncSession, store_a):
    with pytest.raises(NotFound):
        await svc.duplicate_product(db, store_id=store_a.id, product_id="nonexistent000000000000")


@pytest.mark.anyio
async def test_duplicate_wrong_store(db: AsyncSession, store_a, store_b):
    source = await make_product(db, store_id=store_a.id, name="Latte")

    with pytest.raises(NotFound):
        await svc.duplicate_product(db, store_id=store_b.id, product_id=source.id)


# ---------------------------------------------------------------------------
# HTTP integration tests
# ---------------------------------------------------------------------------


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
