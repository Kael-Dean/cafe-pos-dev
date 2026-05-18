"""Service-layer tests for the Catalog module (Tier 3).

Run with: pytest tests/test_catalog_service.py -v
All tests use the transactional `db` fixture — data is wiped between sessions.
"""
import secrets
from decimal import Decimal

import pytest
import pytest_asyncio

from app.models.catalog import ProductModifierGroup, RecipeItem
from app.schemas.catalog import (
    CategoryCreate,
    CategoryUpdate,
    ModifierCreate,
    ModifierGroupCreate,
    ModifierGroupUpdate,
    ProductCreate,
    ProductModifierGroupsReplace,
    ProductUpdate,
    RecipeBulkReplace,
    RecipeItemInput,
)
from app.services import catalog as svc
from tests.conftest import make_category, make_item, make_modifier_group, make_product


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def uid(prefix: str = "") -> str:
    return f"{prefix}{secrets.token_hex(4)}"


# ---------------------------------------------------------------------------
# Categories
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_categories_scoped_to_store(db, store_a, store_b):
    cat_a = await make_category(db, store_id=store_a.id, name=f"cat-{uid()}")
    await make_category(db, store_id=store_b.id, name=f"cat-{uid()}")

    result = await svc.list_categories(db, store_id=store_a.id)
    ids = [c.id for c in result]
    assert cat_a.id in ids
    # None of store_b's categories should appear
    result_b = await svc.list_categories(db, store_id=store_b.id)
    for c in result_b:
        assert c.id not in ids or c.store_id == store_b.id


@pytest.mark.asyncio
async def test_create_category(db, store_a):
    payload = CategoryCreate(name=f"Hot {uid()}", sort_order=2)
    cat = await svc.create_category(db, store_id=store_a.id, payload=payload)

    assert cat.id
    assert cat.store_id == store_a.id
    assert cat.sort_order == 2
    assert cat.is_active is True


@pytest.mark.asyncio
async def test_update_category(db, store_a):
    cat = await make_category(db, store_id=store_a.id, name=f"Old {uid()}")
    updated = await svc.update_category(
        db,
        store_id=store_a.id,
        category_id=cat.id,
        payload=CategoryUpdate(name="New Name", sort_order=5),
    )
    assert updated.name == "New Name"
    assert updated.sort_order == 5


@pytest.mark.asyncio
async def test_delete_category_with_active_products_raises_conflict(db, store_a):
    from app.core.errors import Conflict

    cat = await make_category(db, store_id=store_a.id, name=f"busy-{uid()}")
    await make_product(db, store_id=store_a.id, name=f"prod-{uid()}", category_id=cat.id)

    with pytest.raises(Conflict):
        await svc.delete_category(db, store_id=store_a.id, category_id=cat.id)


@pytest.mark.asyncio
async def test_delete_category_without_products_soft_deletes(db, store_a):
    cat = await make_category(db, store_id=store_a.id, name=f"empty-{uid()}")
    await svc.delete_category(db, store_id=store_a.id, category_id=cat.id)
    assert cat.is_active is False


@pytest.mark.asyncio
async def test_delete_category_cross_store_returns_404(db, store_a, store_b):
    from app.core.errors import NotFound

    cat_b = await make_category(db, store_id=store_b.id, name=f"other-{uid()}")
    with pytest.raises(NotFound):
        await svc.delete_category(db, store_id=store_a.id, category_id=cat_b.id)


# ---------------------------------------------------------------------------
# Products
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_products_scoped_to_store(db, store_a, store_b):
    p_a = await make_product(db, store_id=store_a.id, name=f"prod-a-{uid()}")
    p_b = await make_product(db, store_id=store_b.id, name=f"prod-b-{uid()}")

    result_a = await svc.list_products(db, store_id=store_a.id)
    ids_a = [p.id for p in result_a]
    assert p_a.id in ids_a
    assert p_b.id not in ids_a


@pytest.mark.asyncio
async def test_list_products_filter_by_category(db, store_a):
    cat = await make_category(db, store_id=store_a.id, name=f"filt-{uid()}")
    in_cat = await make_product(db, store_id=store_a.id, name=f"in-{uid()}", category_id=cat.id)
    await make_product(db, store_id=store_a.id, name=f"out-{uid()}")

    result = await svc.list_products(db, store_id=store_a.id, category_id=cat.id)
    ids = [p.id for p in result]
    assert in_cat.id in ids
    for p in result:
        assert p.category_id == cat.id


@pytest.mark.asyncio
async def test_list_products_filter_by_search(db, store_a):
    token = uid("search-")
    match = await make_product(db, store_id=store_a.id, name=f"Mocha {token}")
    await make_product(db, store_id=store_a.id, name=f"Espresso {uid()}")

    result = await svc.list_products(db, store_id=store_a.id, search=token)
    ids = [p.id for p in result]
    assert match.id in ids


@pytest.mark.asyncio
async def test_create_product(db, store_a):
    cat = await make_category(db, store_id=store_a.id, name=f"cat-{uid()}")
    payload = ProductCreate(
        name=f"Flat White {uid()}",
        price=Decimal("90.00"),
        category_id=cat.id,
        description="Smooth",
    )
    product = await svc.create_product(db, store_id=store_a.id, payload=payload)

    assert product.id
    assert product.store_id == store_a.id
    assert product.price == Decimal("90.00")
    assert product.category_id == cat.id


@pytest.mark.asyncio
async def test_update_product_fields(db, store_a):
    product = await make_product(db, store_id=store_a.id, name=f"old-{uid()}")
    updated = await svc.update_product(
        db,
        store_id=store_a.id,
        product_id=product.id,
        payload=ProductUpdate(name="Updated Name", price=Decimal("99.00")),
    )
    assert updated.name == "Updated Name"
    assert updated.price == Decimal("99.00")


@pytest.mark.asyncio
async def test_delete_product_soft_deletes(db, store_a):
    product = await make_product(db, store_id=store_a.id, name=f"del-{uid()}")
    await svc.delete_product(db, store_id=store_a.id, product_id=product.id)
    assert product.is_active is False


@pytest.mark.asyncio
async def test_get_product_detail_cross_store_returns_404(db, store_a, store_b):
    from app.core.errors import NotFound

    p_b = await make_product(db, store_id=store_b.id, name=f"cross-{uid()}")
    with pytest.raises(NotFound):
        await svc.get_product_detail(db, store_id=store_a.id, product_id=p_b.id)


# ---------------------------------------------------------------------------
# Recipe (BOM)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_replace_recipe_bulk_replaces(db, store_a):
    from sqlalchemy import select

    product = await make_product(db, store_id=store_a.id, name=f"recipe-{uid()}")
    item1 = await make_item(db, store_id=store_a.id, name=f"milk-{uid()}")
    item2 = await make_item(db, store_id=store_a.id, name=f"coffee-{uid()}")

    # First replace
    result = await svc.replace_recipe(
        db,
        store_id=store_a.id,
        product_id=product.id,
        payload=RecipeBulkReplace(
            items=[RecipeItemInput(inventory_item_id=item1.id, quantity=Decimal("200"))]
        ),
    )
    assert len(result) == 1
    assert result[0].inventory_item_id == item1.id

    # Second replace should discard the first and set a new set
    result2 = await svc.replace_recipe(
        db,
        store_id=store_a.id,
        product_id=product.id,
        payload=RecipeBulkReplace(
            items=[
                RecipeItemInput(inventory_item_id=item2.id, quantity=Decimal("18")),
            ]
        ),
    )
    assert len(result2) == 1
    assert result2[0].inventory_item_id == item2.id

    # Confirm only one RecipeItem row exists in DB for this product
    from sqlalchemy.ext.asyncio import AsyncSession
    rows = (await db.execute(select(RecipeItem).where(RecipeItem.product_id == product.id))).scalars().all()
    assert len(rows) == 1


@pytest.mark.asyncio
async def test_get_product_detail_includes_recipe(db, store_a):
    product = await make_product(db, store_id=store_a.id, name=f"detail-{uid()}")
    item = await make_item(db, store_id=store_a.id, name=f"beans-{uid()}")

    await svc.replace_recipe(
        db,
        store_id=store_a.id,
        product_id=product.id,
        payload=RecipeBulkReplace(
            items=[RecipeItemInput(inventory_item_id=item.id, quantity=Decimal("15"))]
        ),
    )

    detail = await svc.get_product_detail(db, store_id=store_a.id, product_id=product.id)
    assert len(detail.recipe) == 1
    assert detail.recipe[0].inventory_item_id == item.id
    assert detail.recipe[0].quantity == Decimal("15")


# ---------------------------------------------------------------------------
# Modifier Groups
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_modifier_group_with_modifiers(db, store_a):
    payload = ModifierGroupCreate(
        name=f"Size {uid()}",
        required=True,
        min_select=1,
        max_select=1,
        modifiers=[
            ModifierCreate(name="Small", price_delta=Decimal("0")),
            ModifierCreate(name="Large", price_delta=Decimal("15.00"), sort_order=1),
        ],
    )
    group = await svc.create_modifier_group(db, store_id=store_a.id, payload=payload)

    assert group.id
    assert group.required is True
    assert len(group.modifiers) == 2
    names = [m.name for m in group.modifiers]
    assert "Small" in names
    assert "Large" in names


@pytest.mark.asyncio
async def test_update_modifier_group_replaces_modifiers(db, store_a):
    group = await make_modifier_group(
        db,
        store_id=store_a.id,
        name=f"Temp {uid()}",
        modifiers=[{"name": "Hot"}, {"name": "Iced"}],
    )

    updated = await svc.update_modifier_group(
        db,
        store_id=store_a.id,
        group_id=group.id,
        payload=ModifierGroupUpdate(
            name="Temperature",
            modifiers=[ModifierCreate(name="Hot"), ModifierCreate(name="Warm"), ModifierCreate(name="Cold")],
        ),
    )

    assert updated.name == "Temperature"
    assert len(updated.modifiers) == 3
    names = [m.name for m in updated.modifiers]
    assert "Warm" in names
    assert "Hot" in names


@pytest.mark.asyncio
async def test_delete_modifier_group_soft_deletes(db, store_a):
    group_orm = await make_modifier_group(db, store_id=store_a.id, name=f"del-grp-{uid()}")
    await svc.delete_modifier_group(db, store_id=store_a.id, group_id=group_orm.id)
    assert group_orm.is_active is False


@pytest.mark.asyncio
async def test_list_modifier_groups_scoped_to_store(db, store_a, store_b):
    g_a = await make_modifier_group(db, store_id=store_a.id, name=f"grp-a-{uid()}")
    await make_modifier_group(db, store_id=store_b.id, name=f"grp-b-{uid()}")

    result = await svc.list_modifier_groups(db, store_id=store_a.id, is_active=None)
    ids = [g.id for g in result]
    assert g_a.id in ids
    for g in result:
        assert g.store_id == store_a.id


# ---------------------------------------------------------------------------
# Product ↔ ModifierGroup links
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_replace_product_modifier_groups(db, store_a):
    from sqlalchemy import select

    product = await make_product(db, store_id=store_a.id, name=f"pmg-{uid()}")
    g1 = await make_modifier_group(db, store_id=store_a.id, name=f"g1-{uid()}")
    g2 = await make_modifier_group(db, store_id=store_a.id, name=f"g2-{uid()}")

    await svc.replace_product_modifier_groups(
        db,
        store_id=store_a.id,
        product_id=product.id,
        payload=ProductModifierGroupsReplace(modifier_group_ids=[g1.id, g2.id]),
    )

    rows = (
        await db.execute(
            select(ProductModifierGroup)
            .where(ProductModifierGroup.product_id == product.id)
            .order_by(ProductModifierGroup.sort_order)
        )
    ).scalars().all()
    assert len(rows) == 2
    assert rows[0].modifier_group_id == g1.id
    assert rows[0].sort_order == 0
    assert rows[1].modifier_group_id == g2.id
    assert rows[1].sort_order == 1


@pytest.mark.asyncio
async def test_get_product_detail_includes_modifier_groups(db, store_a):
    product = await make_product(db, store_id=store_a.id, name=f"detail-mg-{uid()}")
    group = await make_modifier_group(
        db,
        store_id=store_a.id,
        name=f"grp-{uid()}",
        modifiers=[{"name": "Oat Milk", "price_delta": Decimal("10.00")}],
    )

    await svc.replace_product_modifier_groups(
        db,
        store_id=store_a.id,
        product_id=product.id,
        payload=ProductModifierGroupsReplace(modifier_group_ids=[group.id]),
    )

    detail = await svc.get_product_detail(db, store_id=store_a.id, product_id=product.id)
    assert len(detail.modifier_groups) == 1
    assert detail.modifier_groups[0].id == group.id
    assert len(detail.modifier_groups[0].modifiers) == 1
    assert detail.modifier_groups[0].modifiers[0].name == "Oat Milk"
