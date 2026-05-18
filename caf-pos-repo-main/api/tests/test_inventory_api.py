from decimal import Decimal

import pytest

from tests.conftest import make_item


async def _login(client, store_slug: str, pin: str) -> str:
    resp = await client.post(
        "/api/v1/auth/login", json={"store_slug": store_slug, "pin": pin}
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def test_get_inventory_lists_seeded_items(client, db, store_a, user_a):
    await make_item(db, store_id=store_a.id, name="Espresso Beans")
    await make_item(db, store_id=store_a.id, name="Whole Milk")

    token = await _login(client, store_a.slug, "1111")
    resp = await client.get("/api/v1/inventory", headers=_headers(token))
    assert resp.status_code == 200, resp.text
    names = {row["name"] for row in resp.json()}
    assert {"Espresso Beans", "Whole Milk"}.issubset(names)


async def test_post_receive_increments_stock(client, db, store_a, user_a):
    item = await make_item(db, store_id=store_a.id, stock=Decimal("10"))

    token = await _login(client, store_a.slug, "1111")
    resp = await client.post(
        "/api/v1/inventory/receive",
        headers=_headers(token),
        json={
            "item_id": item.id,
            "qty": "5",
            "cost_per_unit": "0.50",
            "supplier": "TestCo",
        },
    )
    assert resp.status_code == 200, resp.text
    assert Decimal(resp.json()["stock_on_hand"]) == Decimal("15.000")


async def test_post_waste_allows_negative(client, db, store_a, user_a):
    item = await make_item(db, store_id=store_a.id, stock=Decimal("3"))

    token = await _login(client, store_a.slug, "1111")
    resp = await client.post(
        "/api/v1/inventory/waste",
        headers=_headers(token),
        json={"item_id": item.id, "qty": "5", "reason": "EXPIRED"},
    )
    assert resp.status_code == 200, resp.text
    assert Decimal(resp.json()["stock_on_hand"]) == Decimal("-2.000")


async def test_cross_store_get_returns_404(client, db, store_a, store_b, user_a):
    item_b = await make_item(db, store_id=store_b.id, name="Beans-B")
    token = await _login(client, store_a.slug, "1111")

    resp = await client.get(
        f"/api/v1/inventory/{item_b.id}", headers=_headers(token)
    )
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "NOT_FOUND"


async def test_barista_cannot_adjust(client, db, store_a, user_a):
    item = await make_item(db, store_id=store_a.id, stock=Decimal("100"))
    token = await _login(client, store_a.slug, "1111")

    resp = await client.post(
        "/api/v1/inventory/adjust",
        headers=_headers(token),
        json={"item_id": item.id, "delta": "5", "reason": "audit"},
    )
    assert resp.status_code == 403


async def test_manager_can_adjust(client, db, store_a, manager_a):
    item = await make_item(db, store_id=store_a.id, stock=Decimal("100"))
    token = await _login(client, store_a.slug, "2222")

    resp = await client.post(
        "/api/v1/inventory/adjust",
        headers=_headers(token),
        json={"item_id": item.id, "delta": "-5", "reason": "audit recount"},
    )
    assert resp.status_code == 200, resp.text
    assert Decimal(resp.json()["stock_on_hand"]) == Decimal("95.000")


async def test_movements_endpoint_returns_recent_first(client, db, store_a, user_a):
    item = await make_item(db, store_id=store_a.id, stock=Decimal("100"))
    token = await _login(client, store_a.slug, "1111")

    for i in range(3):
        await client.post(
            "/api/v1/inventory/receive",
            headers=_headers(token),
            json={"item_id": item.id, "qty": "1", "cost_per_unit": "0.10"},
        )

    resp = await client.get("/api/v1/inventory/movements", headers=_headers(token))
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["items"]) == 3
    assert all(m["type"] == "RECEIVE" for m in body["items"])
    assert body["items"][0]["created_by"]["name"] == user_a.name


async def test_low_stock_endpoint(client, db, store_a, user_a):
    await make_item(db, store_id=store_a.id, name="Low", stock=Decimal("2"), par=Decimal("10"))
    await make_item(db, store_id=store_a.id, name="Ok", stock=Decimal("50"), par=Decimal("10"))

    token = await _login(client, store_a.slug, "1111")
    resp = await client.get("/api/v1/inventory/low-stock", headers=_headers(token))
    assert resp.status_code == 200
    names = {row["name"] for row in resp.json()}
    assert "Low" in names
    assert "Ok" not in names


async def test_status_field_computed(client, db, store_a, user_a):
    await make_item(db, store_id=store_a.id, name="Crit", stock=Decimal("2"), par=Decimal("100"))
    await make_item(db, store_id=store_a.id, name="LowOnly", stock=Decimal("60"), par=Decimal("100"))
    await make_item(db, store_id=store_a.id, name="Fine", stock=Decimal("200"), par=Decimal("100"))

    token = await _login(client, store_a.slug, "1111")
    resp = await client.get("/api/v1/inventory", headers=_headers(token))
    statuses = {row["name"]: row["status"] for row in resp.json()}
    assert statuses["Crit"] == "critical"
    assert statuses["LowOnly"] == "low"
    assert statuses["Fine"] == "ok"
