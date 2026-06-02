
from tests.conftest import make_item


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
