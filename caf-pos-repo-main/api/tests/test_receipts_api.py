from decimal import Decimal

from tests.conftest import make_item


async def _login(client, store_slug: str, pin: str) -> str:
    resp = await client.post("/api/v1/auth/login", json={"store_slug": store_slug, "pin": pin})
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def test_create_draft_receipt(client, db, store_a, manager_a):
    token = await _login(client, store_a.slug, "2222")
    resp = await client.post(
        "/api/v1/receipts",
        headers=_headers(token),
        json={"supplier_name": "Thai Dairy Co.", "receipt_ref": "INV-001", "received_at": "2026-05-14"},
    )
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["status"] == "DRAFT"
    assert data["supplier_name"] == "Thai Dairy Co."
    assert data["receipt_ref"] == "INV-001"
    assert data["lots"] == []


async def test_barista_cannot_create_receipt(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    resp = await client.post(
        "/api/v1/receipts",
        headers=_headers(token),
        json={"received_at": "2026-05-14"},
    )
    assert resp.status_code == 403


async def test_add_lot_to_draft(client, db, store_a, manager_a):
    token = await _login(client, store_a.slug, "2222")
    item = await make_item(
        db, store_id=store_a.id, name="Milk-Lot", stock=Decimal("0"),
        unit_size=Decimal("2"),
    )

    receipt_resp = await client.post(
        "/api/v1/receipts",
        headers=_headers(token),
        json={"received_at": "2026-05-14"},
    )
    receipt_id = receipt_resp.json()["id"]

    resp = await client.post(
        f"/api/v1/receipts/{receipt_id}/lots",
        headers=_headers(token),
        json={
            "inventory_item_id": item.id,
            "qty_packs": "5",
            "unit_price": "170.00",
            "expiry_date": "2026-06-15",
        },
    )
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert len(data["lots"]) == 1
    assert Decimal(data["lots"][0]["qty_packs"]) == Decimal("5")
    assert Decimal(data["lots"][0]["qty_received"]) == Decimal("10")  # 5 packs × 2 units
    assert Decimal(data["lots"][0]["unit_price"]) == Decimal("170.00")
    assert Decimal(data["lots"][0]["cost_per_unit"]) == Decimal("85.0000")
    assert data["lots"][0]["expiry_date"] == "2026-06-15"


async def test_confirm_receipt_increments_stock(client, db, store_a, manager_a):
    token = await _login(client, store_a.slug, "2222")
    item = await make_item(
        db, store_id=store_a.id, name="Beans-Confirm", stock=Decimal("0"),
        unit_size=Decimal("3"),
    )

    receipt_resp = await client.post(
        "/api/v1/receipts", headers=_headers(token), json={"received_at": "2026-05-14"}
    )
    receipt_id = receipt_resp.json()["id"]

    await client.post(
        f"/api/v1/receipts/{receipt_id}/lots",
        headers=_headers(token),
        json={"inventory_item_id": item.id, "qty_packs": "4", "unit_price": "255.00"},
    )

    resp = await client.post(f"/api/v1/receipts/{receipt_id}/confirm", headers=_headers(token))
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "CONFIRMED"

    inv_resp = await client.get(f"/api/v1/inventory/{item.id}", headers=_headers(token))
    assert Decimal(inv_resp.json()["stock_on_hand"]) == Decimal("12")  # 4 packs × 3 units


async def test_confirm_empty_receipt_returns_422(client, db, store_a, manager_a):
    token = await _login(client, store_a.slug, "2222")
    receipt_resp = await client.post(
        "/api/v1/receipts", headers=_headers(token), json={"received_at": "2026-05-14"}
    )
    receipt_id = receipt_resp.json()["id"]

    resp = await client.post(f"/api/v1/receipts/{receipt_id}/confirm", headers=_headers(token))
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "RECEIPT_HAS_NO_LOTS"


async def test_confirm_already_confirmed_returns_409(client, db, store_a, manager_a):
    token = await _login(client, store_a.slug, "2222")
    item = await make_item(db, store_id=store_a.id, name="Beans-409", stock=Decimal("0"))

    receipt_resp = await client.post(
        "/api/v1/receipts", headers=_headers(token), json={"received_at": "2026-05-14"}
    )
    receipt_id = receipt_resp.json()["id"]
    await client.post(
        f"/api/v1/receipts/{receipt_id}/lots",
        headers=_headers(token),
        json={"inventory_item_id": item.id, "qty_packs": "5", "unit_price": "10.00"},
    )
    await client.post(f"/api/v1/receipts/{receipt_id}/confirm", headers=_headers(token))

    resp = await client.post(f"/api/v1/receipts/{receipt_id}/confirm", headers=_headers(token))
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "RECEIPT_ALREADY_CONFIRMED"


async def test_add_lot_to_confirmed_returns_409(client, db, store_a, manager_a):
    token = await _login(client, store_a.slug, "2222")
    item = await make_item(db, store_id=store_a.id, name="Beans-Confirmed", stock=Decimal("0"))

    receipt_resp = await client.post(
        "/api/v1/receipts", headers=_headers(token), json={"received_at": "2026-05-14"}
    )
    receipt_id = receipt_resp.json()["id"]
    await client.post(
        f"/api/v1/receipts/{receipt_id}/lots",
        headers=_headers(token),
        json={"inventory_item_id": item.id, "qty_packs": "5", "unit_price": "10.00"},
    )
    await client.post(f"/api/v1/receipts/{receipt_id}/confirm", headers=_headers(token))

    item2 = await make_item(db, store_id=store_a.id, name="Milk-Confirmed", stock=Decimal("0"))
    resp = await client.post(
        f"/api/v1/receipts/{receipt_id}/lots",
        headers=_headers(token),
        json={"inventory_item_id": item2.id, "qty_packs": "3", "unit_price": "10.00"},
    )
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "RECEIPT_ALREADY_CONFIRMED"


async def test_remove_lot_from_draft(client, db, store_a, manager_a):
    token = await _login(client, store_a.slug, "2222")
    item = await make_item(db, store_id=store_a.id, name="Beans-Remove", stock=Decimal("0"))

    receipt_resp = await client.post(
        "/api/v1/receipts", headers=_headers(token), json={"received_at": "2026-05-14"}
    )
    receipt_id = receipt_resp.json()["id"]
    lot_resp = await client.post(
        f"/api/v1/receipts/{receipt_id}/lots",
        headers=_headers(token),
        json={"inventory_item_id": item.id, "qty_packs": "5", "unit_price": "10.00"},
    )
    lot_id = lot_resp.json()["lots"][0]["id"]

    resp = await client.delete(f"/api/v1/receipts/{receipt_id}/lots/{lot_id}", headers=_headers(token))
    assert resp.status_code == 204

    get_resp = await client.get(f"/api/v1/receipts/{receipt_id}", headers=_headers(token))
    assert get_resp.json()["lots"] == []


async def test_get_item_lots(client, db, store_a, manager_a):
    token = await _login(client, store_a.slug, "2222")
    item = await make_item(db, store_id=store_a.id, name="Milk-Lots", stock=Decimal("0"))

    receipt_resp = await client.post(
        "/api/v1/receipts", headers=_headers(token), json={"received_at": "2026-05-14"}
    )
    receipt_id = receipt_resp.json()["id"]
    await client.post(
        f"/api/v1/receipts/{receipt_id}/lots",
        headers=_headers(token),
        json={"inventory_item_id": item.id, "qty_packs": "8", "unit_price": "10.00"},
    )
    await client.post(f"/api/v1/receipts/{receipt_id}/confirm", headers=_headers(token))

    resp = await client.get(f"/api/v1/inventory/{item.id}/lots", headers=_headers(token))
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert len(data) == 1
    assert Decimal(data[0]["qty_remaining"]) == Decimal("8")  # 8 packs × unit_size=1


async def test_list_receipts(client, db, store_a, manager_a):
    token = await _login(client, store_a.slug, "2222")
    await client.post("/api/v1/receipts", headers=_headers(token), json={"received_at": "2026-05-14", "supplier_name": "SupplierX"})

    resp = await client.get("/api/v1/receipts", headers=_headers(token))
    assert resp.status_code == 200, resp.text
    names = [r["supplier_name"] for r in resp.json()["items"]]
    assert "SupplierX" in names


async def test_fifo_deducts_oldest_lot_first(client, db, store_a, manager_a):
    """Confirm two lots then place a simulated deduction — oldest lot consumed first."""
    token = await _login(client, store_a.slug, "2222")
    item = await make_item(
        db, store_id=store_a.id, name="FIFO-Milk", stock=Decimal("0"),
        unit_size=Decimal("1"),
    )

    # Receipt 1 (older) — 4 packs × 1 = 4 units
    r1 = await client.post("/api/v1/receipts", headers=_headers(token), json={"received_at": "2026-05-01"})
    r1_id = r1.json()["id"]
    await client.post(f"/api/v1/receipts/{r1_id}/lots", headers=_headers(token),
        json={"inventory_item_id": item.id, "qty_packs": "4", "unit_price": "80.00"})
    await client.post(f"/api/v1/receipts/{r1_id}/confirm", headers=_headers(token))

    # Receipt 2 (newer) — 6 packs × 1 = 6 units
    r2 = await client.post("/api/v1/receipts", headers=_headers(token), json={"received_at": "2026-05-10"})
    r2_id = r2.json()["id"]
    await client.post(f"/api/v1/receipts/{r2_id}/lots", headers=_headers(token),
        json={"inventory_item_id": item.id, "qty_packs": "6", "unit_price": "80.00"})
    await client.post(f"/api/v1/receipts/{r2_id}/confirm", headers=_headers(token))

    # Verify total stock = 10
    inv_resp = await client.get(f"/api/v1/inventory/{item.id}", headers=_headers(token))
    assert Decimal(inv_resp.json()["stock_on_hand"]) == Decimal("10.000")

    # Directly call _deduct_fifo to consume 5 units
    from app.services.orders import _deduct_fifo
    async with db.begin():
        await _deduct_fifo(
            db,
            store_id=store_a.id,
            user_id=manager_a.id,
            inventory_item_id=item.id,
            total_qty=Decimal("5"),
            ref_order_id="test_order_id",
            order_number=999,
        )

    # Fetch lots and check FIFO: older lot (4 units) fully consumed, newer lot (6-1=5 remaining)
    lots_resp = await client.get(f"/api/v1/inventory/{item.id}/lots?status=all", headers=_headers(token))
    lots = sorted(lots_resp.json(), key=lambda x: x["created_at"])
    assert Decimal(lots[0]["qty_remaining"]) == Decimal("0.000")   # older lot exhausted
    assert Decimal(lots[1]["qty_remaining"]) == Decimal("5.000")   # newer lot: 6 - 1 consumed
