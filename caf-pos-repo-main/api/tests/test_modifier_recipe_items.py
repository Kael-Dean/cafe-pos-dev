import secrets
from decimal import Decimal

from app.models.catalog import Modifier, ModifierRecipeItem
from tests.conftest import make_item, make_modifier_group


async def test_modifier_recipe_item_persists(db, store_a):
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
        json={
            "items": [
                {"inventory_item_id": chili.id, "quantity": "0.000", "mode": "override"},
                {"inventory_item_id": pepper.id, "quantity": "0.000", "mode": "override"},
            ]
        },
        headers=_h(token),
    )

    # Second PUT: only chili
    resp = await client.put(
        f"/api/v1/modifier-groups/{group.id}/modifiers/{modifier.id}/recipe-items",
        json={
            "items": [
                {"inventory_item_id": chili.id, "quantity": "3.000", "mode": "override"},
            ]
        },
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
