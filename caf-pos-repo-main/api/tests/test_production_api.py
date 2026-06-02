"""Tests for the production orders feature (service layer and API layer)."""
import secrets
from decimal import Decimal

import pytest

from tests.conftest import make_item
from tests.factories import make_produced_product


def uid(prefix: str = "") -> str:
    return f"{prefix}{secrets.token_hex(4)}"


# ---------------------------------------------------------------------------
# Service-layer tests
# ---------------------------------------------------------------------------


async def test_create_production_order_deducts_ingredients_adds_finished_goods(
    db, store_a, user_a
):
    from sqlalchemy import select

    from app.enums import MovementType
    from app.models.catalog import RecipeItem
    from app.models.inventory import InventoryItem, StockMovement
    from app.schemas.production import ProductionOrderCreate
    from app.services import production as svc

    flour = await make_item(db, store_id=store_a.id, name=f"Flour-{uid()}", stock=Decimal("1000"))
    butter = await make_item(db, store_id=store_a.id, name=f"Butter-{uid()}", stock=Decimal("500"))

    cookies = await make_produced_product(
        db, store_id=store_a.id, name=f"Cookie-{uid()}", servings_per_batch=24
    )

    # Recipe: 500g flour + 250g butter per batch
    db.add(RecipeItem(product_id=cookies.id, inventory_item_id=flour.id, quantity=Decimal("500")))
    db.add(RecipeItem(product_id=cookies.id, inventory_item_id=butter.id, quantity=Decimal("250")))
    await db.commit()

    payload = ProductionOrderCreate(product_id=cookies.id, batches_count=2, notes="AM batch")
    order = await svc.create_production_order(
        db, store_id=store_a.id, user_id=user_a.id, payload=payload
    )

    assert order.batches_count == 2
    assert order.units_produced == 48  # 2 × 24
    assert order.notes == "AM batch"

    await db.refresh(flour)
    await db.refresh(butter)
    assert flour.stock_on_hand == Decimal("0")    # 1000 - (500 × 2)
    assert butter.stock_on_hand == Decimal("0")   # 500 - (250 × 2)

    fg_result = await db.execute(
        select(InventoryItem).where(InventoryItem.id == cookies.finished_goods_item_id)
    )
    fg = fg_result.scalar_one()
    assert fg.stock_on_hand == Decimal("48")

    # Verify movement types
    movements = list((await db.execute(
        select(StockMovement).where(StockMovement.inventory_item_id == flour.id)
    )).scalars())
    assert any(m.type == MovementType.PRODUCTION_USE for m in movements)

    fg_movements = list((await db.execute(
        select(StockMovement).where(StockMovement.inventory_item_id == cookies.finished_goods_item_id)
    )).scalars())
    assert any(m.type == MovementType.PRODUCTION for m in fg_movements)


async def test_create_production_order_rejects_made_to_order_product(db, store_a, user_a):
    from app.core.errors import Unprocessable
    from app.schemas.production import ProductionOrderCreate
    from app.services import production as svc
    from tests.conftest import make_product

    product = await make_product(db, store_id=store_a.id, name=f"Latte-{uid()}")
    payload = ProductionOrderCreate(product_id=product.id, batches_count=1)

    with pytest.raises(Unprocessable):
        await svc.create_production_order(
            db, store_id=store_a.id, user_id=user_a.id, payload=payload
        )


async def test_create_production_order_sets_cost_per_unit_on_finished_goods(
    db, store_a, user_a
):
    """cost_per_unit on the finished-goods item must equal total ingredient cost / units_produced."""
    from decimal import Decimal

    from sqlalchemy import select

    from app.models.catalog import RecipeItem
    from app.models.inventory import InventoryItem
    from app.schemas.production import ProductionOrderCreate
    from app.services import production as svc

    # Arrange: flour at ฿0.50/g, sugar at ฿0.20/g
    flour = await make_item(
        db, store_id=store_a.id, name=f"Flour-cost-{uid()}", unit="g",
        stock=Decimal("2000"), cost_per_unit=Decimal("0.5000")
    )

    sugar = await make_item(
        db, store_id=store_a.id, name=f"Sugar-cost-{uid()}", unit="g",
        stock=Decimal("1000"), cost_per_unit=Decimal("0.2000")
    )

    cookies = await make_produced_product(
        db, store_id=store_a.id, name=f"CostCookie-{uid()}", servings_per_batch=10
    )

    # Recipe: 100g flour + 50g sugar per batch
    db.add(RecipeItem(product_id=cookies.id, inventory_item_id=flour.id, quantity=Decimal("100")))
    db.add(RecipeItem(product_id=cookies.id, inventory_item_id=sugar.id, quantity=Decimal("50")))
    await db.commit()

    # Act: run 2 batches → 20 units
    payload = ProductionOrderCreate(product_id=cookies.id, batches_count=2)
    await svc.create_production_order(
        db, store_id=store_a.id, user_id=user_a.id, payload=payload
    )

    # Assert:
    # total cost = (100g × 2 batches × 0.50) + (50g × 2 batches × 0.20)
    #            = 100 + 20 = 120
    # cost_per_serving = 120 / 20 = 6.0000
    fg_result = await db.execute(
        select(InventoryItem).where(InventoryItem.id == cookies.finished_goods_item_id)
    )
    fg = fg_result.scalar_one()
    await db.refresh(fg)
    assert fg.cost_per_unit == Decimal("6.0000")


async def test_list_production_orders_scoped_to_store(db, store_a, store_b, user_a, user_b):
    from app.schemas.production import ProductionOrderCreate
    from app.services import production as svc

    cookies_a = await make_produced_product(db, store_id=store_a.id, name=f"CookieA-{uid()}")
    cookies_b = await make_produced_product(db, store_id=store_b.id, name=f"CookieB-{uid()}")

    await svc.create_production_order(
        db, store_id=store_a.id, user_id=user_a.id,
        payload=ProductionOrderCreate(product_id=cookies_a.id, batches_count=1),
    )
    await svc.create_production_order(
        db, store_id=store_b.id, user_id=user_b.id,
        payload=ProductionOrderCreate(product_id=cookies_b.id, batches_count=1),
    )

    orders_a = await svc.list_production_orders(db, store_id=store_a.id)
    assert all(o.store_id == store_a.id for o in orders_a)


# ---------------------------------------------------------------------------
# API-layer tests
# ---------------------------------------------------------------------------


async def _login(client, store_slug: str, pin: str) -> str:
    resp = await client.post(
        "/api/v1/auth/login", json={"store_slug": store_slug, "pin": pin}
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def test_api_create_production_order_returns_201(client, db, store_a, user_a):
    from app.models.catalog import RecipeItem

    flour = await make_item(db, store_id=store_a.id, name=f"Flour-API-{uid()}", stock=Decimal("1000"))
    cookies = await make_produced_product(
        db, store_id=store_a.id, name=f"CookieAPI-{uid()}", servings_per_batch=12
    )
    db.add(RecipeItem(product_id=cookies.id, inventory_item_id=flour.id, quantity=Decimal("400")))
    await db.commit()

    token = await _login(client, store_a.slug, "1111")
    resp = await client.post(
        "/api/v1/production-orders",
        headers=_headers(token),
        json={"product_id": cookies.id, "batches_count": 1, "notes": "Test run"},
    )
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["units_produced"] == 12
    assert data["batches_count"] == 1
    assert data["notes"] == "Test run"
    assert data["store_id"] == store_a.id


async def test_api_list_production_orders(client, db, store_a, user_a):
    cookies = await make_produced_product(
        db, store_id=store_a.id, name=f"CookieList-{uid()}", servings_per_batch=6
    )
    from tests.factories import make_production_order
    await make_production_order(
        db, store_id=store_a.id, product_id=cookies.id, produced_by=user_a.id, batches_count=2
    )

    token = await _login(client, store_a.slug, "1111")
    resp = await client.get("/api/v1/production-orders", headers=_headers(token))
    assert resp.status_code == 200, resp.text
    ids = [o["product_id"] for o in resp.json()]
    assert cookies.id in ids


async def test_api_get_production_order_by_id(client, db, store_a, user_a):
    cookies = await make_produced_product(
        db, store_id=store_a.id, name=f"CookieGet-{uid()}", servings_per_batch=8
    )
    from tests.factories import make_production_order
    order = await make_production_order(
        db, store_id=store_a.id, product_id=cookies.id, produced_by=user_a.id
    )

    token = await _login(client, store_a.slug, "1111")
    resp = await client.get(f"/api/v1/production-orders/{order.id}", headers=_headers(token))
    assert resp.status_code == 200, resp.text
    assert resp.json()["id"] == order.id


async def test_api_create_production_order_404_for_unknown_product(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")
    resp = await client.post(
        "/api/v1/production-orders",
        headers=_headers(token),
        json={"product_id": "nonexistent000000000000", "batches_count": 1},
    )
    assert resp.status_code == 404


async def test_api_create_production_order_422_for_made_to_order(client, db, store_a, user_a):
    from tests.conftest import make_product
    product = await make_product(db, store_id=store_a.id, name=f"Latte-422-{uid()}")

    token = await _login(client, store_a.slug, "1111")
    resp = await client.post(
        "/api/v1/production-orders",
        headers=_headers(token),
        json={"product_id": product.id, "batches_count": 1},
    )
    assert resp.status_code == 422
