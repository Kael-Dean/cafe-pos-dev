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
    Returns (product, modifier).
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

    chili = await make_item(
        db, store_id=store_a.id, name=f"Chili-{secrets.token_hex(4)}", stock=Decimal("100")
    )
    pepper = await make_item(
        db, store_id=store_a.id, name=f"Pepper-{secrets.token_hex(4)}", stock=Decimal("100")
    )

    product, modifier = await _setup_product_with_modifier(
        db,
        store_a.id,
        recipe={chili: Decimal("10"), pepper: Decimal("2")},
        modifier_name="50% Spicy",
    )
    # Override chili to 5g; pepper is untouched by this modifier
    db.add(
        ModifierRecipeItem(
            modifier_id=modifier.id,
            inventory_item_id=chili.id,
            quantity=Decimal("5"),
            mode="override",
        )
    )
    await db.commit()

    resp = await client.post(
        "/api/v1/orders",
        headers=_h(token),
        json={
            "idempotency_key": secrets.token_hex(8),
            "channel": "DINE_IN",
            "items": [{"product_id": product.id, "quantity": 1, "modifier_ids": [modifier.id]}],
        },
    )
    assert resp.status_code == 201, resp.text

    await db.refresh(chili)
    await db.refresh(pepper)
    assert chili.stock_on_hand == Decimal("95")  # 100 - 5 (overridden)
    assert pepper.stock_on_hand == Decimal("98")  # 100 - 2 (base recipe, untouched)


async def test_override_to_zero_skips_deduction(client, db, store_a, user_a):
    """Modifier with override=0 means the ingredient is not deducted at all."""
    token = await _login(client, store_a.slug, "1111")

    chili = await make_item(
        db, store_id=store_a.id, name=f"Chili-{secrets.token_hex(4)}", stock=Decimal("100")
    )
    pepper = await make_item(
        db, store_id=store_a.id, name=f"Pepper-{secrets.token_hex(4)}", stock=Decimal("100")
    )

    product, modifier = await _setup_product_with_modifier(
        db,
        store_a.id,
        recipe={chili: Decimal("10"), pepper: Decimal("2")},
        modifier_name="0% Spicy",
    )
    db.add(
        ModifierRecipeItem(
            modifier_id=modifier.id,
            inventory_item_id=chili.id,
            quantity=Decimal("0"),
            mode="override",
        )
    )
    db.add(
        ModifierRecipeItem(
            modifier_id=modifier.id,
            inventory_item_id=pepper.id,
            quantity=Decimal("0"),
            mode="override",
        )
    )
    await db.commit()

    resp = await client.post(
        "/api/v1/orders",
        headers=_h(token),
        json={
            "idempotency_key": secrets.token_hex(8),
            "channel": "DINE_IN",
            "items": [{"product_id": product.id, "quantity": 1, "modifier_ids": [modifier.id]}],
        },
    )
    assert resp.status_code == 201, resp.text

    await db.refresh(chili)
    await db.refresh(pepper)
    assert chili.stock_on_hand == Decimal("100")  # not deducted
    assert pepper.stock_on_hand == Decimal("100")  # not deducted


async def test_delta_subtracts_from_recipe(client, db, store_a, user_a):
    """Modifier with delta=-5 reduces syrup deduction from base 10 to 5."""
    token = await _login(client, store_a.slug, "1111")

    syrup = await make_item(
        db, store_id=store_a.id, name=f"Syrup-{secrets.token_hex(4)}", stock=Decimal("100")
    )

    product, modifier = await _setup_product_with_modifier(
        db,
        store_a.id,
        recipe={syrup: Decimal("10")},
        modifier_name="50% Sweet",
    )
    db.add(
        ModifierRecipeItem(
            modifier_id=modifier.id,
            inventory_item_id=syrup.id,
            quantity=Decimal("-5"),
            mode="delta",
        )
    )
    await db.commit()

    resp = await client.post(
        "/api/v1/orders",
        headers=_h(token),
        json={
            "idempotency_key": secrets.token_hex(8),
            "channel": "DINE_IN",
            "items": [{"product_id": product.id, "quantity": 1, "modifier_ids": [modifier.id]}],
        },
    )
    assert resp.status_code == 201, resp.text

    await db.refresh(syrup)
    assert syrup.stock_on_hand == Decimal("95")  # 100 - (10 - 5)


async def test_delta_adds_ingredient_not_in_recipe(client, db, store_a, user_a):
    """Modifier with delta on an ingredient not in base recipe adds that deduction."""
    token = await _login(client, store_a.slug, "1111")

    syrup = await make_item(
        db, store_id=store_a.id, name=f"Syrup-{secrets.token_hex(4)}", stock=Decimal("100")
    )
    water = await make_item(
        db, store_id=store_a.id, name=f"Water-{secrets.token_hex(4)}", stock=Decimal("100")
    )

    product, modifier = await _setup_product_with_modifier(
        db,
        store_a.id,
        recipe={syrup: Decimal("10")},  # water not in base recipe
        modifier_name="50% Sweet + water",
    )
    db.add(
        ModifierRecipeItem(
            modifier_id=modifier.id,
            inventory_item_id=syrup.id,
            quantity=Decimal("-5"),
            mode="delta",
        )
    )
    db.add(
        ModifierRecipeItem(
            modifier_id=modifier.id,
            inventory_item_id=water.id,
            quantity=Decimal("3"),
            mode="delta",
        )
    )
    await db.commit()

    resp = await client.post(
        "/api/v1/orders",
        headers=_h(token),
        json={
            "idempotency_key": secrets.token_hex(8),
            "channel": "DINE_IN",
            "items": [{"product_id": product.id, "quantity": 1, "modifier_ids": [modifier.id]}],
        },
    )
    assert resp.status_code == 201, resp.text

    await db.refresh(syrup)
    await db.refresh(water)
    assert syrup.stock_on_hand == Decimal("95")  # 100 - (10 - 5)
    assert water.stock_on_hand == Decimal("97")  # 100 - (0 + 3)


async def test_recipe_items_scale_with_order_quantity(client, db, store_a, user_a):
    """Deductions multiply by order quantity, including modifier overrides."""
    token = await _login(client, store_a.slug, "1111")

    chili = await make_item(
        db, store_id=store_a.id, name=f"Chili-{secrets.token_hex(4)}", stock=Decimal("100")
    )

    product, modifier = await _setup_product_with_modifier(
        db,
        store_a.id,
        recipe={chili: Decimal("10")},
        modifier_name="50% Spicy",
    )
    db.add(
        ModifierRecipeItem(
            modifier_id=modifier.id,
            inventory_item_id=chili.id,
            quantity=Decimal("5"),
            mode="override",
        )
    )
    await db.commit()

    resp = await client.post(
        "/api/v1/orders",
        headers=_h(token),
        json={
            "idempotency_key": secrets.token_hex(8),
            "channel": "DINE_IN",
            "items": [{"product_id": product.id, "quantity": 3, "modifier_ids": [modifier.id]}],
        },
    )
    assert resp.status_code == 201, resp.text

    await db.refresh(chili)
    assert chili.stock_on_hand == Decimal("85")  # 100 - (5 * 3)


async def test_no_modifier_recipe_items_uses_base_recipe(client, db, store_a, user_a):
    """Without any ModifierRecipeItem rows, base recipe deduction is unchanged."""
    token = await _login(client, store_a.slug, "1111")

    chili = await make_item(
        db, store_id=store_a.id, name=f"Chili-{secrets.token_hex(4)}", stock=Decimal("100")
    )

    product, modifier = await _setup_product_with_modifier(
        db,
        store_a.id,
        recipe={chili: Decimal("10")},
        modifier_name="100% Spicy (no override)",
    )
    # No ModifierRecipeItem rows added

    resp = await client.post(
        "/api/v1/orders",
        headers=_h(token),
        json={
            "idempotency_key": secrets.token_hex(8),
            "channel": "DINE_IN",
            "items": [{"product_id": product.id, "quantity": 1, "modifier_ids": [modifier.id]}],
        },
    )
    assert resp.status_code == 201, resp.text

    await db.refresh(chili)
    assert chili.stock_on_hand == Decimal("90")  # 100 - 10 (base recipe)
