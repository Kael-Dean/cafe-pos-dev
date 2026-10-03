from datetime import date
from decimal import Decimal

from app.enums import PreOrderStatus
from app.models.pre_orders import PreOrder, PreOrderItem
from tests.factories import make_item, make_product, make_recipe_item


async def _make_pending_demand(db, *, store_id, user_id, item, recipe_qty, order_qty):
    """Create a product whose recipe uses `item`, plus a PENDING pre-order for it,
    so aggregate_pending_demand sees `recipe_qty * order_qty` of `item`."""
    product = await make_product(db, store_id=store_id, name="Croissant-SL")
    await make_recipe_item(
        db, product_id=product.id, inventory_item_id=item.id,
        quantity=Decimal(recipe_qty),
    )
    pre_order = PreOrder(
        store_id=store_id,
        order_date=date(2026, 6, 5),
        due_date=date(2026, 6, 6),
        customer_name="Walk-in",
        customer_phone="0000000000",
        status=PreOrderStatus.PENDING,
        created_by_id=user_id,
    )
    db.add(pre_order)
    await db.flush()
    db.add(PreOrderItem(
        pre_order_id=pre_order.id,
        product_id=product.id,
        product_name=product.name,
        quantity=order_qty,
        unit_price=Decimal("0"),
        line_total=Decimal("0"),
    ))
    await db.commit()
    return product


async def _login(client, store_slug: str, pin: str) -> str:
    resp = await client.post("/api/v1/auth/login", json={"store_slug": store_slug, "pin": pin})
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def test_add_to_shopping_list(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    item = await make_item(db, store_id=store_a.id, name="Sugar-SL")

    resp = await client.post("/api/v1/shopping-list", headers=_h(token),
                             json={"inventory_item_id": item.id, "note": "buy 5kg"})
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["inventory_item_id"] == item.id
    assert data["note"] == "buy 5kg"


async def test_add_idempotent(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    item = await make_item(db, store_id=store_a.id, name="Butter-SL")

    r1 = await client.post("/api/v1/shopping-list", headers=_h(token),
                           json={"inventory_item_id": item.id})
    r2 = await client.post("/api/v1/shopping-list", headers=_h(token),
                           json={"inventory_item_id": item.id})
    assert r1.status_code == 201
    assert r2.status_code == 200
    assert r1.json()["id"] == r2.json()["id"]


async def test_list_shopping_list(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    item = await make_item(db, store_id=store_a.id, name="Eggs-SL")
    await client.post("/api/v1/shopping-list", headers=_h(token),
                      json={"inventory_item_id": item.id})

    resp = await client.get("/api/v1/shopping-list", headers=_h(token))
    assert resp.status_code == 200
    ids = [r["inventory_item_id"] for r in resp.json()]
    assert item.id in ids


async def test_remove_from_shopping_list(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    item = await make_item(db, store_id=store_a.id, name="Salt-SL")

    add_resp = await client.post("/api/v1/shopping-list", headers=_h(token),
                                 json={"inventory_item_id": item.id})
    sl_id = add_resp.json()["id"]

    del_resp = await client.delete(f"/api/v1/shopping-list/{sl_id}", headers=_h(token))
    assert del_resp.status_code == 204

    list_resp = await client.get("/api/v1/shopping-list", headers=_h(token))
    ids = [r["inventory_item_id"] for r in list_resp.json()]
    assert item.id not in ids


async def test_print_shopping_list(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    item = await make_item(db, store_id=store_a.id, name="Milk-Print", unit="L")
    await client.post("/api/v1/shopping-list", headers=_h(token),
                      json={"inventory_item_id": item.id, "note": "get 10L"})

    resp = await client.get("/api/v1/shopping-list/print", headers=_h(token))
    assert resp.status_code == 200
    assert "text/plain" in resp.headers["content-type"]
    assert "Milk-Print" in resp.text


async def test_shopping_list_isolated_by_store(client, db, store_a, store_b, user_a, user_b):
    token_a = await _login(client, store_a.slug, "1111")
    token_b = await _login(client, store_b.slug, "9999")
    item_a = await make_item(db, store_id=store_a.id, name="StoreA-Item-SL")

    await client.post("/api/v1/shopping-list", headers=_h(token_a),
                      json={"inventory_item_id": item_a.id})

    resp_b = await client.get("/api/v1/shopping-list", headers=_h(token_b))
    ids_b = [r["inventory_item_id"] for r in resp_b.json()]
    assert item_a.id not in ids_b


async def test_suggested_qty_from_pending_demand_net_of_stock(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    # stock 5; recipe needs 2 per unit; pre-order of 10 -> demand 20 -> suggest 15
    item = await make_item(db, store_id=store_a.id, name="Flour-Demand", stock=Decimal("5"))
    await _make_pending_demand(
        db, store_id=store_a.id, user_id=user_a.id, item=item, recipe_qty=2, order_qty=10,
    )
    await client.post("/api/v1/shopping-list", headers=_h(token),
                      json={"inventory_item_id": item.id})

    resp = await client.get("/api/v1/shopping-list", headers=_h(token))
    row = next(r for r in resp.json() if r["inventory_item_id"] == item.id)
    assert Decimal(row["suggested_qty"]) == Decimal("15")
    assert row["quantity"] is None


async def test_suggested_qty_floors_at_zero_when_stock_covers(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    # stock 100 >= demand 20 -> suggest 0
    item = await make_item(db, store_id=store_a.id, name="Sugar-Covered", stock=Decimal("100"))
    await _make_pending_demand(
        db, store_id=store_a.id, user_id=user_a.id, item=item, recipe_qty=2, order_qty=10,
    )
    await client.post("/api/v1/shopping-list", headers=_h(token),
                      json={"inventory_item_id": item.id})

    resp = await client.get("/api/v1/shopping-list", headers=_h(token))
    row = next(r for r in resp.json() if r["inventory_item_id"] == item.id)
    assert Decimal(row["suggested_qty"]) == Decimal("0")


async def test_add_with_explicit_quantity_override(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    item = await make_item(db, store_id=store_a.id, name="Yeast-Override")

    resp = await client.post("/api/v1/shopping-list", headers=_h(token),
                             json={"inventory_item_id": item.id, "quantity": "7.5"})
    assert resp.status_code == 201, resp.text
    assert Decimal(resp.json()["quantity"]) == Decimal("7.5")


async def test_patch_quantity_override_persists(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    item = await make_item(db, store_id=store_a.id, name="Egg-Patch")
    add = await client.post("/api/v1/shopping-list", headers=_h(token),
                            json={"inventory_item_id": item.id})
    sl_id = add.json()["id"]

    patch = await client.patch(f"/api/v1/shopping-list/{sl_id}", headers=_h(token),
                               json={"quantity": "12"})
    assert patch.status_code == 200, patch.text
    assert Decimal(patch.json()["quantity"]) == Decimal("12")

    resp = await client.get("/api/v1/shopping-list", headers=_h(token))
    row = next(r for r in resp.json() if r["id"] == sl_id)
    assert Decimal(row["quantity"]) == Decimal("12")
    assert "suggested_qty" in row


async def test_patch_missing_item_404(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    resp = await client.patch("/api/v1/shopping-list/nonexistent", headers=_h(token),
                              json={"quantity": "1"})
    assert resp.status_code == 404


async def test_print_includes_amount(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    item = await make_item(db, store_id=store_a.id, name="Milk-Amount", unit="L")
    await client.post("/api/v1/shopping-list", headers=_h(token),
                      json={"inventory_item_id": item.id, "quantity": "10"})

    resp = await client.get("/api/v1/shopping-list/print", headers=_h(token))
    assert resp.status_code == 200
    assert "Milk-Amount" in resp.text
    assert "10" in resp.text
