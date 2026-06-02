import secrets
from datetime import date, timedelta
from decimal import Decimal

from app.models.catalog import RecipeItem
from tests.conftest import make_category, make_item, make_product


async def _login(client, store_slug: str, pin: str) -> str:
    resp = await client.post("/api/v1/auth/login", json={"store_slug": store_slug, "pin": pin})
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _today() -> str:
    return date.today().isoformat()


def _due(days: int = 7) -> str:
    return (date.today() + timedelta(days=days)).isoformat()


async def _make_product_with_recipe(db, store_id):
    """Helper: product linked to one inventory item via recipe."""
    uid = secrets.token_hex(4)
    cat = await make_category(db, store_id=store_id, name=f"Cat-{uid}")
    item = await make_item(db, store_id=store_id, name=f"Flour-{uid}", unit="g", stock=Decimal("5000"))
    product = await make_product(db, store_id=store_id, name=f"Cake-{uid}", price=Decimal("150.00"), category_id=cat.id)
    db.add(RecipeItem(product_id=product.id, inventory_item_id=item.id, quantity=Decimal("200")))
    await db.commit()
    return product, item


async def test_create_pre_order_inline_customer(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    product, _ = await _make_product_with_recipe(db, store_a.id)

    resp = await client.post("/api/v1/pre-orders", headers=_h(token), json={
        "order_date": _today(),
        "due_date": _due(),
        "customer_name": "Alice",
        "customer_phone": "0812345678",
        "items": [{"product_id": product.id, "quantity": 2}],
    })
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["status"] == "PENDING"
    assert data["customer_name"] == "Alice"
    assert len(data["items"]) == 1
    assert Decimal(data["items"][0]["unit_price"]) == Decimal("150.00")
    assert Decimal(data["items"][0]["line_total"]) == Decimal("300.00")


async def test_create_pre_order_negotiated_price(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    product, _ = await _make_product_with_recipe(db, store_a.id)

    resp = await client.post("/api/v1/pre-orders", headers=_h(token), json={
        "order_date": _today(),
        "due_date": _due(),
        "customer_name": "Bob",
        "customer_phone": "0899999999",
        "items": [{"product_id": product.id, "quantity": 10, "unit_price": "120.00"}],
    })
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert Decimal(data["items"][0]["unit_price"]) == Decimal("120.00")
    assert Decimal(data["items"][0]["line_total"]) == Decimal("1200.00")


async def test_create_pre_order_requires_customer(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    product, _ = await _make_product_with_recipe(db, store_a.id)

    resp = await client.post("/api/v1/pre-orders", headers=_h(token), json={
        "order_date": _today(),
        "due_date": _due(),
        "items": [{"product_id": product.id, "quantity": 1}],
    })
    assert resp.status_code == 422
    assert resp.json()["error"]["message"] == "CUSTOMER_REQUIRED"


async def test_list_pre_orders_ordered_by_due_date(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    product, _ = await _make_product_with_recipe(db, store_a.id)

    base = {"order_date": _today(), "customer_name": "X", "customer_phone": "111",
            "items": [{"product_id": product.id, "quantity": 1}]}

    await client.post("/api/v1/pre-orders", headers=_h(token), json={**base, "due_date": _due(10)})
    await client.post("/api/v1/pre-orders", headers=_h(token), json={**base, "due_date": _due(3)})
    await client.post("/api/v1/pre-orders", headers=_h(token), json={**base, "due_date": _due(7)})

    resp = await client.get("/api/v1/pre-orders", headers=_h(token))
    assert resp.status_code == 200
    due_dates = [r["due_date"] for r in resp.json()["items"]]
    assert due_dates == sorted(due_dates)


async def test_get_pre_order(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    product, _ = await _make_product_with_recipe(db, store_a.id)

    create_resp = await client.post("/api/v1/pre-orders", headers=_h(token), json={
        "order_date": _today(), "due_date": _due(),
        "customer_name": "C", "customer_phone": "222",
        "items": [{"product_id": product.id, "quantity": 1}],
    })
    po_id = create_resp.json()["id"]

    resp = await client.get(f"/api/v1/pre-orders/{po_id}", headers=_h(token))
    assert resp.status_code == 200
    assert resp.json()["id"] == po_id


async def test_patch_pre_order(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    product, _ = await _make_product_with_recipe(db, store_a.id)

    create_resp = await client.post("/api/v1/pre-orders", headers=_h(token), json={
        "order_date": _today(), "due_date": _due(),
        "customer_name": "Old", "customer_phone": "000",
        "items": [{"product_id": product.id, "quantity": 1}],
    })
    po_id = create_resp.json()["id"]

    resp = await client.patch(f"/api/v1/pre-orders/{po_id}", headers=_h(token),
                              json={"customer_name": "New", "deposit_amount": "500.00", "deposit_paid": True})
    assert resp.status_code == 200
    assert resp.json()["customer_name"] == "New"
    assert Decimal(resp.json()["deposit_amount"]) == Decimal("500.00")
    assert resp.json()["deposit_paid"] is True


async def test_add_and_remove_item(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    product, _ = await _make_product_with_recipe(db, store_a.id)
    product2, _ = await _make_product_with_recipe(db, store_a.id)

    create_resp = await client.post("/api/v1/pre-orders", headers=_h(token), json={
        "order_date": _today(), "due_date": _due(),
        "customer_name": "D", "customer_phone": "333",
        "items": [{"product_id": product.id, "quantity": 1}],
    })
    po_id = create_resp.json()["id"]

    add_resp = await client.post(f"/api/v1/pre-orders/{po_id}/items", headers=_h(token),
                                 json={"product_id": product2.id, "quantity": 3})
    assert add_resp.status_code == 201
    assert len(add_resp.json()["items"]) == 2

    item_id = add_resp.json()["items"][1]["id"]
    del_resp = await client.delete(f"/api/v1/pre-orders/{po_id}/items/{item_id}", headers=_h(token))
    assert del_resp.status_code == 200
    assert len(del_resp.json()["items"]) == 1


async def test_ingredient_summary(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    product, item = await _make_product_with_recipe(db, store_a.id)

    create_resp = await client.post("/api/v1/pre-orders", headers=_h(token), json={
        "order_date": _today(), "due_date": _due(),
        "customer_name": "E", "customer_phone": "444",
        "items": [{"product_id": product.id, "quantity": 5}],
    })
    po_id = create_resp.json()["id"]

    # 5 items x 200g = 1000g needed; stock = 5000g; usage = 20%
    resp = await client.get(f"/api/v1/pre-orders/{po_id}/ingredients?threshold=50", headers=_h(token))
    assert resp.status_code == 200
    data = resp.json()
    assert data["threshold"] == 50
    assert len(data["items"]) == 1
    ing = data["items"][0]
    assert ing["inventory_item_id"] == item.id
    assert Decimal(ing["qty_needed"]) == Decimal("1000")
    assert ing["exceeds_threshold"] is False
    assert ing["on_shopping_list"] is False


async def test_ingredient_summary_exceeds_threshold(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    product, item = await _make_product_with_recipe(db, store_a.id)

    create_resp = await client.post("/api/v1/pre-orders", headers=_h(token), json={
        "order_date": _today(), "due_date": _due(),
        "customer_name": "F", "customer_phone": "555",
        "items": [{"product_id": product.id, "quantity": 20}],
    })
    po_id = create_resp.json()["id"]

    # 20 x 200g = 4000g needed; stock = 5000g; usage = 80% > 50% threshold
    resp = await client.get(f"/api/v1/pre-orders/{po_id}/ingredients?threshold=50", headers=_h(token))
    assert resp.json()["items"][0]["exceeds_threshold"] is True


async def test_start_order_deducts_stock(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    product, item = await _make_product_with_recipe(db, store_a.id)

    create_resp = await client.post("/api/v1/pre-orders", headers=_h(token), json={
        "order_date": _today(), "due_date": _due(),
        "customer_name": "G", "customer_phone": "666",
        "items": [{"product_id": product.id, "quantity": 3}],
    })
    po_id = create_resp.json()["id"]

    resp = await client.post(f"/api/v1/pre-orders/{po_id}/start", headers=_h(token))
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "IN_PROGRESS"

    inv_resp = await client.get(f"/api/v1/inventory/{item.id}", headers=_h(token))
    # 3 items x 200g = 600g deducted from 5000g
    assert Decimal(inv_resp.json()["stock_on_hand"]) == Decimal("4400.000")


async def test_start_blocks_if_already_started(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    product, _ = await _make_product_with_recipe(db, store_a.id)

    create_resp = await client.post("/api/v1/pre-orders", headers=_h(token), json={
        "order_date": _today(), "due_date": _due(),
        "customer_name": "H", "customer_phone": "777",
        "items": [{"product_id": product.id, "quantity": 1}],
    })
    po_id = create_resp.json()["id"]
    await client.post(f"/api/v1/pre-orders/{po_id}/start", headers=_h(token))

    resp = await client.post(f"/api/v1/pre-orders/{po_id}/start", headers=_h(token))
    assert resp.status_code == 409
    assert resp.json()["error"]["message"] == "PRE_ORDER_ALREADY_STARTED"


async def test_complete_order(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    product, _ = await _make_product_with_recipe(db, store_a.id)

    create_resp = await client.post("/api/v1/pre-orders", headers=_h(token), json={
        "order_date": _today(), "due_date": _due(),
        "customer_name": "I", "customer_phone": "888",
        "items": [{"product_id": product.id, "quantity": 1}],
    })
    po_id = create_resp.json()["id"]
    await client.post(f"/api/v1/pre-orders/{po_id}/start", headers=_h(token))

    resp = await client.post(f"/api/v1/pre-orders/{po_id}/complete", headers=_h(token))
    assert resp.status_code == 200
    assert resp.json()["status"] == "COMPLETED"


async def test_cancel_pending(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    product, _ = await _make_product_with_recipe(db, store_a.id)

    create_resp = await client.post("/api/v1/pre-orders", headers=_h(token), json={
        "order_date": _today(), "due_date": _due(),
        "customer_name": "J", "customer_phone": "999",
        "items": [{"product_id": product.id, "quantity": 1}],
    })
    po_id = create_resp.json()["id"]

    resp = await client.post(f"/api/v1/pre-orders/{po_id}/cancel", headers=_h(token))
    assert resp.status_code == 200
    assert resp.json()["status"] == "CANCELLED"


async def test_cancel_blocked_after_start(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    product, _ = await _make_product_with_recipe(db, store_a.id)

    create_resp = await client.post("/api/v1/pre-orders", headers=_h(token), json={
        "order_date": _today(), "due_date": _due(),
        "customer_name": "K", "customer_phone": "101",
        "items": [{"product_id": product.id, "quantity": 1}],
    })
    po_id = create_resp.json()["id"]
    await client.post(f"/api/v1/pre-orders/{po_id}/start", headers=_h(token))

    resp = await client.post(f"/api/v1/pre-orders/{po_id}/cancel", headers=_h(token))
    assert resp.status_code == 422
    assert resp.json()["error"]["message"] == "PRE_ORDER_NOT_PENDING"


async def test_ingredient_summary_produced_uses_batch_math(client, db, store_a, user_a):
    """PRODUCED product ordered for 50 servings with 75 servings/batch = 1 batch needed, not 50."""
    token = await _login(client, store_a.slug, "1111")

    uid = secrets.token_hex(4)
    cat = await make_category(db, store_id=store_a.id, name=f"Cat-{uid}")
    item = await make_item(db, store_id=store_a.id, name=f"Flour-{uid}", unit="g", stock=Decimal("10000"))
    # Recipe: 500g flour per batch; batch yields 75 servings
    product = await make_product(
        db,
        store_id=store_a.id,
        name=f"Chiffon-{uid}",
        price=Decimal("80.00"),
        category_id=cat.id,
        product_type="PRODUCED",
        servings_per_batch=75,
    )
    db.add(RecipeItem(product_id=product.id, inventory_item_id=item.id, quantity=Decimal("500")))
    await db.commit()

    create_resp = await client.post("/api/v1/pre-orders", headers=_h(token), json={
        "order_date": _today(), "due_date": _due(),
        "customer_name": "L", "customer_phone": "202",
        "items": [{"product_id": product.id, "quantity": 50}],
    })
    assert create_resp.status_code == 201, create_resp.text
    po_id = create_resp.json()["id"]

    resp = await client.get(f"/api/v1/pre-orders/{po_id}/ingredients", headers=_h(token))
    assert resp.status_code == 200
    ing = resp.json()["items"][0]
    # 50 servings / 75 per batch = 1 batch (ceiling) → 1 × 500g = 500g needed
    assert Decimal(ing["qty_needed"]) == Decimal("500"), (
        f"Expected 500g (1 batch), got {ing['qty_needed']} — batch math not applied"
    )


async def test_edit_blocked_after_start(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    product, _ = await _make_product_with_recipe(db, store_a.id)

    create_resp = await client.post("/api/v1/pre-orders", headers=_h(token), json={
        "order_date": _today(), "due_date": _due(),
        "customer_name": "L", "customer_phone": "202",
        "items": [{"product_id": product.id, "quantity": 1}],
    })
    po_id = create_resp.json()["id"]
    await client.post(f"/api/v1/pre-orders/{po_id}/start", headers=_h(token))

    resp = await client.patch(f"/api/v1/pre-orders/{po_id}", headers=_h(token),
                              json={"customer_name": "Changed"})
    assert resp.status_code == 422


async def _make_produced_product(db, store_id, *, fg_stock=Decimal("0"), raw_stock=Decimal("10000"), servings_per_batch=75):
    """Helper: PRODUCED product with finished goods item + one raw ingredient in recipe."""
    uid = secrets.token_hex(4)
    cat = await make_category(db, store_id=store_id, name=f"Cat-{uid}")
    fg_item = await make_item(
        db, store_id=store_id, name=f"FG-{uid}", unit="piece", stock=fg_stock
    )
    raw_item = await make_item(
        db, store_id=store_id, name=f"Flour-{uid}", unit="g", stock=raw_stock
    )
    product = await make_product(
        db,
        store_id=store_id,
        name=f"Chiffon-{uid}",
        price=Decimal("80.00"),
        category_id=cat.id,
        product_type="PRODUCED",
        servings_per_batch=servings_per_batch,
        finished_goods_item_id=fg_item.id,
    )
    db.add(RecipeItem(
        product_id=product.id,
        inventory_item_id=raw_item.id,
        quantity=Decimal("500"),
    ))
    await db.commit()
    return product, fg_item, raw_item


async def test_set_fulfillment_mode_from_inventory(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    product, fg_item, _ = await _make_produced_product(db, store_a.id)

    create_resp = await client.post("/api/v1/pre-orders", headers=_h(token), json={
        "order_date": _today(), "due_date": _due(),
        "customer_name": "M", "customer_phone": "303",
        "items": [{"product_id": product.id, "quantity": 50}],
    })
    assert create_resp.status_code == 201
    po_id = create_resp.json()["id"]
    item_id = create_resp.json()["items"][0]["id"]

    resp = await client.patch(
        f"/api/v1/pre-orders/{po_id}/items/{item_id}/fulfillment",
        headers=_h(token),
        json={"fulfillment_mode": "FROM_INVENTORY"},
    )
    assert resp.status_code == 200
    item = next(i for i in resp.json()["items"] if i["id"] == item_id)
    assert item["fulfillment_mode"] == "FROM_INVENTORY"


async def test_set_fulfillment_mode_blocked_on_non_produced(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    product, _ = await _make_product_with_recipe(db, store_a.id)  # MADE_TO_ORDER

    create_resp = await client.post("/api/v1/pre-orders", headers=_h(token), json={
        "order_date": _today(), "due_date": _due(),
        "customer_name": "N", "customer_phone": "404",
        "items": [{"product_id": product.id, "quantity": 5}],
    })
    po_id = create_resp.json()["id"]
    item_id = create_resp.json()["items"][0]["id"]

    resp = await client.patch(
        f"/api/v1/pre-orders/{po_id}/items/{item_id}/fulfillment",
        headers=_h(token),
        json={"fulfillment_mode": "FROM_INVENTORY"},
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["message"] == "ITEM_NOT_PRODUCED"


async def test_set_fulfillment_mode_blocked_when_not_pending(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    product, fg_item, raw_item = await _make_produced_product(
        db, store_a.id, fg_stock=Decimal("100"), raw_stock=Decimal("10000")
    )

    create_resp = await client.post("/api/v1/pre-orders", headers=_h(token), json={
        "order_date": _today(), "due_date": _due(),
        "customer_name": "O", "customer_phone": "505",
        "items": [{"product_id": product.id, "quantity": 50}],
    })
    po_id = create_resp.json()["id"]
    item_id = create_resp.json()["items"][0]["id"]
    await client.post(f"/api/v1/pre-orders/{po_id}/start", headers=_h(token))

    resp = await client.patch(
        f"/api/v1/pre-orders/{po_id}/items/{item_id}/fulfillment",
        headers=_h(token),
        json={"fulfillment_mode": "FROM_INVENTORY"},
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["message"] == "PRE_ORDER_NOT_PENDING"
    assert resp.json()["error"]["code"] == "PRE_ORDER_NOT_PENDING"


async def test_ingredient_summary_from_inventory_fully_covered(client, db, store_a, user_a):
    """FROM_INVENTORY with enough finished goods stock → no raw ingredients shown."""
    token = await _login(client, store_a.slug, "1111")
    # fg_stock=100 covers the order of 50 servings
    product, fg_item, raw_item = await _make_produced_product(
        db, store_a.id, fg_stock=Decimal("100"), raw_stock=Decimal("10000")
    )

    create_resp = await client.post("/api/v1/pre-orders", headers=_h(token), json={
        "order_date": _today(), "due_date": _due(),
        "customer_name": "P", "customer_phone": "606",
        "items": [{"product_id": product.id, "quantity": 50}],
    })
    po_id = create_resp.json()["id"]
    item_id = create_resp.json()["items"][0]["id"]

    # Set FROM_INVENTORY
    patch_resp = await client.patch(
        f"/api/v1/pre-orders/{po_id}/items/{item_id}/fulfillment",
        headers=_h(token),
        json={"fulfillment_mode": "FROM_INVENTORY"},
    )
    assert patch_resp.status_code == 200

    resp = await client.get(f"/api/v1/pre-orders/{po_id}/ingredients", headers=_h(token))
    assert resp.status_code == 200
    # Finished goods cover the full order — no raw ingredients needed
    assert resp.json()["items"] == []


async def test_ingredient_summary_from_inventory_partial_stock(client, db, store_a, user_a):
    """FROM_INVENTORY with stock=30, order=50, servings_per_batch=75.
    Shortfall = 20. Batches needed = ceil(20/75) = 1. Ingredient = 500g."""
    token = await _login(client, store_a.slug, "1111")
    product, fg_item, raw_item = await _make_produced_product(
        db, store_a.id, fg_stock=Decimal("30"), raw_stock=Decimal("10000")
    )

    create_resp = await client.post("/api/v1/pre-orders", headers=_h(token), json={
        "order_date": _today(), "due_date": _due(),
        "customer_name": "Q", "customer_phone": "707",
        "items": [{"product_id": product.id, "quantity": 50}],
    })
    po_id = create_resp.json()["id"]
    item_id = create_resp.json()["items"][0]["id"]

    patch_resp = await client.patch(
        f"/api/v1/pre-orders/{po_id}/items/{item_id}/fulfillment",
        headers=_h(token),
        json={"fulfillment_mode": "FROM_INVENTORY"},
    )
    assert patch_resp.status_code == 200

    resp = await client.get(f"/api/v1/pre-orders/{po_id}/ingredients", headers=_h(token))
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert len(items) == 1
    # 1 batch × 500g = 500g (not 50 × 500g = 25000g)
    assert Decimal(items[0]["qty_needed"]) == Decimal("500")


async def test_start_from_inventory_sufficient_deducts_finished_goods(client, db, store_a, user_a):
    """FROM_INVENTORY + fg_stock >= qty → deducts finished goods, no raw ingredient deduction."""
    token = await _login(client, store_a.slug, "1111")
    product, fg_item, raw_item = await _make_produced_product(
        db, store_a.id, fg_stock=Decimal("100"), raw_stock=Decimal("10000")
    )

    create_resp = await client.post("/api/v1/pre-orders", headers=_h(token), json={
        "order_date": _today(), "due_date": _due(),
        "customer_name": "R", "customer_phone": "808",
        "items": [{"product_id": product.id, "quantity": 50}],
    })
    assert create_resp.status_code == 201
    po_id = create_resp.json()["id"]
    item_id = create_resp.json()["items"][0]["id"]

    patch_resp = await client.patch(
        f"/api/v1/pre-orders/{po_id}/items/{item_id}/fulfillment",
        headers=_h(token),
        json={"fulfillment_mode": "FROM_INVENTORY"},
    )
    assert patch_resp.status_code == 200

    start_resp = await client.post(f"/api/v1/pre-orders/{po_id}/start", headers=_h(token))
    assert start_resp.status_code == 200
    assert start_resp.json()["status"] == "IN_PROGRESS"

    fg_resp = await client.get(f"/api/v1/inventory/{fg_item.id}", headers=_h(token))
    assert Decimal(fg_resp.json()["stock_on_hand"]) == Decimal("50.000")  # 100 - 50

    raw_resp = await client.get(f"/api/v1/inventory/{raw_item.id}", headers=_h(token))
    assert Decimal(raw_resp.json()["stock_on_hand"]) == Decimal("10000.000")  # unchanged


async def test_start_from_inventory_partial_deducts_fg_and_raw(client, db, store_a, user_a):
    """FROM_INVENTORY + fg_stock=30, order=50, batch=75, recipe=500g.
    Available from FG = 30. Shortfall = 20 → 1 batch → deduct 500g raw."""
    token = await _login(client, store_a.slug, "1111")
    product, fg_item, raw_item = await _make_produced_product(
        db, store_a.id, fg_stock=Decimal("30"), raw_stock=Decimal("10000")
    )

    create_resp = await client.post("/api/v1/pre-orders", headers=_h(token), json={
        "order_date": _today(), "due_date": _due(),
        "customer_name": "S", "customer_phone": "909",
        "items": [{"product_id": product.id, "quantity": 50}],
    })
    assert create_resp.status_code == 201
    po_id = create_resp.json()["id"]
    item_id = create_resp.json()["items"][0]["id"]

    patch_resp = await client.patch(
        f"/api/v1/pre-orders/{po_id}/items/{item_id}/fulfillment",
        headers=_h(token),
        json={"fulfillment_mode": "FROM_INVENTORY"},
    )
    assert patch_resp.status_code == 200

    start_resp = await client.post(f"/api/v1/pre-orders/{po_id}/start", headers=_h(token))
    assert start_resp.status_code == 200

    fg_resp = await client.get(f"/api/v1/inventory/{fg_item.id}", headers=_h(token))
    assert Decimal(fg_resp.json()["stock_on_hand"]) == Decimal("0.000")  # 30 - 30

    raw_resp = await client.get(f"/api/v1/inventory/{raw_item.id}", headers=_h(token))
    assert Decimal(raw_resp.json()["stock_on_hand"]) == Decimal("9500.000")  # 10000 - 500


async def test_start_from_inventory_insufficient_ingredients_blocks(client, db, store_a, user_a):
    """FROM_INVENTORY + fg_stock=0, raw_stock=100 < 500g needed → 422 INSUFFICIENT_INGREDIENTS."""
    token = await _login(client, store_a.slug, "1111")
    product, fg_item, raw_item = await _make_produced_product(
        db, store_a.id, fg_stock=Decimal("0"), raw_stock=Decimal("100")
    )

    create_resp = await client.post("/api/v1/pre-orders", headers=_h(token), json={
        "order_date": _today(), "due_date": _due(),
        "customer_name": "T", "customer_phone": "010",
        "items": [{"product_id": product.id, "quantity": 50}],
    })
    assert create_resp.status_code == 201
    po_id = create_resp.json()["id"]
    item_id = create_resp.json()["items"][0]["id"]

    patch_resp = await client.patch(
        f"/api/v1/pre-orders/{po_id}/items/{item_id}/fulfillment",
        headers=_h(token),
        json={"fulfillment_mode": "FROM_INVENTORY"},
    )
    assert patch_resp.status_code == 200

    resp = await client.post(f"/api/v1/pre-orders/{po_id}/start", headers=_h(token))
    assert resp.status_code == 422
    assert resp.json()["error"]["message"] == "INSUFFICIENT_INGREDIENTS"
    assert resp.json()["error"]["code"] == "INSUFFICIENT_INGREDIENTS"


async def test_start_from_inventory_no_fg_stock_but_sufficient_raw_succeeds(client, db, store_a, user_a):
    """FROM_INVENTORY + fg_stock=0, raw_stock=10000 >= 500g needed → succeeds, deducts raw."""
    token = await _login(client, store_a.slug, "1111")
    product, fg_item, raw_item = await _make_produced_product(
        db, store_a.id, fg_stock=Decimal("0"), raw_stock=Decimal("10000")
    )

    create_resp = await client.post("/api/v1/pre-orders", headers=_h(token), json={
        "order_date": _today(), "due_date": _due(),
        "customer_name": "U", "customer_phone": "011",
        "items": [{"product_id": product.id, "quantity": 50}],
    })
    assert create_resp.status_code == 201
    po_id = create_resp.json()["id"]
    item_id = create_resp.json()["items"][0]["id"]

    patch_resp = await client.patch(
        f"/api/v1/pre-orders/{po_id}/items/{item_id}/fulfillment",
        headers=_h(token),
        json={"fulfillment_mode": "FROM_INVENTORY"},
    )
    assert patch_resp.status_code == 200

    resp = await client.post(f"/api/v1/pre-orders/{po_id}/start", headers=_h(token))
    assert resp.status_code == 200

    raw_resp = await client.get(f"/api/v1/inventory/{raw_item.id}", headers=_h(token))
    assert Decimal(raw_resp.json()["stock_on_hand"]) == Decimal("9500.000")  # 10000 - 500
