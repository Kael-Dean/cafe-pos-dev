from decimal import Decimal

import pytest

from tests.factories import make_item, make_order_direct, make_order_item, make_product, make_recipe_item


async def _login(client, store_slug: str, pin: str) -> dict:
    r = await client.post("/api/v1/auth/login", json={"store_slug": store_slug, "pin": pin})
    assert r.status_code == 200, r.text
    token = r.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_preview_returns_period_and_items(client, db, store_a, user_a):
    milk = await make_item(db, store_id=store_a.id, name="Milk", unit="L", stock=Decimal("5.000"))
    latte = await make_product(db, store_id=store_a.id, name="Latte")
    await make_recipe_item(db, product_id=latte.id, inventory_item_id=milk.id, quantity=Decimal("0.200"))
    order = await make_order_direct(db, store_id=store_a.id, created_by_id=user_a.id)
    await make_order_item(db, order_id=order.id, product_id=latte.id, product_name="Latte", quantity=2)

    headers = await _login(client, store_a.slug, "1111")
    r = await client.get("/api/v1/stock-takes/preview", headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert "period_start" in body
    assert "period_end" in body
    assert len(body["items"]) == 1
    assert body["items"][0]["name"] == "Milk"
    assert Decimal(body["items"][0]["consumed_in_period"]) == Decimal("0.400")


@pytest.mark.asyncio
async def test_preview_empty_when_no_orders(client, db, store_a, user_a):
    headers = await _login(client, store_a.slug, "1111")
    r = await client.get("/api/v1/stock-takes/preview", headers=headers)
    assert r.status_code == 200
    assert r.json()["items"] == []


@pytest.mark.asyncio
async def test_submit_returns_adjusted_items(client, db, store_a, user_a):
    milk = await make_item(db, store_id=store_a.id, name="Milk", unit="L", stock=Decimal("5.000"))
    headers = await _login(client, store_a.slug, "1111")
    r = await client.post(
        "/api/v1/stock-takes",
        json={"items": [{"inventory_item_id": milk.id, "actual_quantity": "4.000"}], "notes": "Test"},
        headers=headers,
    )
    assert r.status_code == 200
    body = r.json()
    assert len(body) == 1
    assert body[0]["name"] == "Milk"
    assert Decimal(body[0]["variance"]) == Decimal("-1.000")


@pytest.mark.asyncio
async def test_submit_empty_items_returns_empty_list(client, db, store_a, user_a):
    headers = await _login(client, store_a.slug, "1111")
    r = await client.post("/api/v1/stock-takes", json={"items": []}, headers=headers)
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_history_returns_past_checks(client, db, store_a, user_a):
    milk = await make_item(db, store_id=store_a.id, name="Milk", unit="L", stock=Decimal("5.000"))
    headers = await _login(client, store_a.slug, "1111")
    await client.post(
        "/api/v1/stock-takes",
        json={"items": [{"inventory_item_id": milk.id, "actual_quantity": "4.000"}]},
        headers=headers,
    )
    r = await client.get("/api/v1/stock-takes/history", headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert len(body) == 1
    assert body[0]["item_count"] == 1
    assert body[0]["conducted_by"] == "Alice"


@pytest.mark.asyncio
async def test_cross_store_isolation_preview(client, db, store_a, store_b, user_a, user_b):
    milk = await make_item(db, store_id=store_a.id, name="Milk", unit="L", stock=Decimal("5.000"))
    latte = await make_product(db, store_id=store_a.id, name="Latte")
    await make_recipe_item(db, product_id=latte.id, inventory_item_id=milk.id, quantity=Decimal("0.200"))
    order = await make_order_direct(db, store_id=store_a.id, created_by_id=user_a.id)
    await make_order_item(db, order_id=order.id, product_id=latte.id, product_name="Latte", quantity=3)

    headers_b = await _login(client, store_b.slug, "9999")
    r = await client.get("/api/v1/stock-takes/preview", headers=headers_b)
    assert r.status_code == 200
    assert r.json()["items"] == []
