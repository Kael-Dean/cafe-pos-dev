import secrets
from decimal import Decimal

import pytest

from tests.factories import make_order_direct, make_order_item, make_product

uid = lambda: secrets.token_hex(4)


@pytest.mark.asyncio
async def test_get_promotion_baseline_counts_sold_units(db, store_a, user_a):
    from app.services import promotions as svc

    product = await make_product(db, store_id=store_a.id, name=f"baseline-{uid()}")
    order = await make_order_direct(db, store_id=store_a.id, created_by_id=user_a.id)
    await make_order_item(db, order_id=order.id, product_id=product.id, quantity=5)
    await make_order_item(db, order_id=order.id, product_id=product.id, quantity=3)

    result = await svc.get_promotion_baseline(
        db, store_id=store_a.id, product_id=product.id, days=30
    )

    assert result.product_id == product.id
    assert result.units_sold_in_window == Decimal("8.00")
    assert result.sales_window_days == 30
    assert result.avg_units_per_week > Decimal("0")


@pytest.mark.asyncio
async def test_get_promotion_baseline_excludes_void_orders(db, store_a, user_a):
    from app.enums import OrderStatus
    from app.services import promotions as svc

    product = await make_product(db, store_id=store_a.id, name=f"void-test-{uid()}")
    order = await make_order_direct(
        db, store_id=store_a.id, created_by_id=user_a.id, status=OrderStatus.VOID
    )
    await make_order_item(db, order_id=order.id, product_id=product.id, quantity=10)

    result = await svc.get_promotion_baseline(
        db, store_id=store_a.id, product_id=product.id, days=30
    )

    assert result.units_sold_in_window == Decimal("0.00")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _login(client, store_slug: str, pin: str) -> str:
    resp = await client.post("/api/v1/auth/login", json={"store_slug": store_slug, "pin": pin})
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# API tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_baseline_endpoint_happy_path(client, db, store_a, manager_a):
    """Manager gets correct baseline counts for a product with no sales (zero baseline)."""
    product = await make_product(db, store_id=store_a.id, name=f"api-product-{uid()}")
    token = await _login(client, store_a.slug, "2222")  # manager pin
    resp = await client.get(
        f"/api/v1/promotions/calculator/baseline?product_id={product.id}&days=30",
        headers=_h(token),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["product_id"] == product.id
    assert body["sales_window_days"] == 30
    assert Decimal(body["units_sold_in_window"]) == Decimal("0.00")
    assert Decimal(body["avg_units_per_week"]) == Decimal("0.00")


@pytest.mark.asyncio
async def test_baseline_endpoint_counts_order_items(client, db, store_a, manager_a, user_a):
    """Units from multiple order items for the same product are summed correctly."""
    product = await make_product(db, store_id=store_a.id, name=f"count-product-{uid()}")
    order = await make_order_direct(db, store_id=store_a.id, created_by_id=user_a.id)
    await make_order_item(db, order_id=order.id, product_id=product.id, quantity=4)
    await make_order_item(db, order_id=order.id, product_id=product.id, quantity=6)

    token = await _login(client, store_a.slug, "2222")
    resp = await client.get(
        f"/api/v1/promotions/calculator/baseline?product_id={product.id}&days=30",
        headers=_h(token),
    )
    assert resp.status_code == 200
    assert Decimal(resp.json()["units_sold_in_window"]) == Decimal("10.00")


@pytest.mark.asyncio
async def test_baseline_endpoint_barista_gets_403(client, db, store_a, user_a):
    """Barista role cannot access the calculator endpoint."""
    product = await make_product(db, store_id=store_a.id, name=f"role-product-{uid()}")
    token = await _login(client, store_a.slug, "1111")  # barista pin
    resp = await client.get(
        f"/api/v1/promotions/calculator/baseline?product_id={product.id}",
        headers=_h(token),
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_baseline_endpoint_unknown_product_gets_404(client, db, store_a, manager_a):
    """Returns 404 when product_id doesn't exist in caller's store."""
    token = await _login(client, store_a.slug, "2222")
    resp = await client.get(
        "/api/v1/promotions/calculator/baseline?product_id=nonexistent123456789012",
        headers=_h(token),
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Phase 2 — CRUD
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_promotion_persists(db, store_a):
    from app.enums import PromotionScope, PromotionType
    from app.schemas.promotions import PromotionCreate
    from app.services import promotions as svc

    req = PromotionCreate(
        name="Weekend 10% Off",
        type=PromotionType.PERCENT_OFF,
        discount_pct=10,
        scope=PromotionScope.ORDER,
    )
    promo = await svc.create_promotion(db, store_id=store_a.id, req=req)

    assert promo.id is not None
    assert promo.name == "Weekend 10% Off"
    assert promo.is_active is True
    assert promo.is_exclusive is False


@pytest.mark.asyncio
async def test_list_promotions_active_filter(db, store_a):
    from app.enums import PromotionScope, PromotionType
    from app.schemas.promotions import PromotionCreate, PromotionUpdate
    from app.services import promotions as svc

    p1 = await svc.create_promotion(db, store_id=store_a.id, req=PromotionCreate(
        name=f"Active-{uid()}", type=PromotionType.PERCENT_OFF,
        discount_pct=5, scope=PromotionScope.ORDER,
    ))
    p2 = await svc.create_promotion(db, store_id=store_a.id, req=PromotionCreate(
        name=f"Inactive-{uid()}", type=PromotionType.PERCENT_OFF,
        discount_pct=5, scope=PromotionScope.ORDER,
    ))
    await svc.update_promotion(db, store_id=store_a.id, promotion_id=p2.id,
                               req=PromotionUpdate(is_active=False))

    active = await svc.list_promotions(db, store_id=store_a.id, active=True)
    ids = [p.id for p in active]
    assert p1.id in ids
    assert p2.id not in ids


@pytest.mark.asyncio
async def test_delete_promotion(db, store_a):
    from app.enums import PromotionScope, PromotionType
    from app.core.errors import NotFound
    from app.schemas.promotions import PromotionCreate
    from app.services import promotions as svc

    promo = await svc.create_promotion(db, store_id=store_a.id, req=PromotionCreate(
        name=f"ToDelete-{uid()}", type=PromotionType.PERCENT_OFF,
        discount_pct=5, scope=PromotionScope.ORDER,
    ))
    await svc.delete_promotion(db, store_id=store_a.id, promotion_id=promo.id)

    with pytest.raises(NotFound):
        await svc.get_promotion(db, store_id=store_a.id, promotion_id=promo.id)


@pytest.mark.asyncio
async def test_crud_barista_cannot_create(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")  # barista
    resp = await client.post(
        "/api/v1/promotions",
        json={"name": "Test", "type": "PERCENT_OFF", "discount_pct": 10, "scope": "ORDER"},
        headers=_h(token),
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_http_create_promotion_returns_201(client, db, store_a, manager_a):
    token = await _login(client, store_a.slug, "2222")  # manager PIN
    resp = await client.post(
        "/api/v1/promotions",
        json={"name": "HTTP Test", "type": "PERCENT_OFF", "discount_pct": 15, "scope": "ORDER"},
        headers=_h(token),
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["name"] == "HTTP Test"
    assert Decimal(body["discount_pct"]) == Decimal("15")
    assert body["is_active"] is True
    assert "created_at" in body  # verifies db.refresh() loads server-side defaults


@pytest.mark.asyncio
async def test_http_list_promotions(client, db, store_a, manager_a):
    token = await _login(client, store_a.slug, "2222")  # manager
    await client.post(
        "/api/v1/promotions",
        json={"name": f"List-{uid()}", "type": "PERCENT_OFF", "discount_pct": 5, "scope": "ORDER"},
        headers=_h(token),
    )
    resp = await client.get("/api/v1/promotions", headers=_h(token))
    assert resp.status_code == 200
    body = resp.json()
    assert "items" in body
    assert "total" in body
    assert body["total"] >= 1


@pytest.mark.asyncio
async def test_http_delete_promotion_returns_204(client, db, store_a, manager_a):
    token = await _login(client, store_a.slug, "2222")  # manager
    create_resp = await client.post(
        "/api/v1/promotions",
        json={"name": f"Delete-{uid()}", "type": "PERCENT_OFF", "discount_pct": 5, "scope": "ORDER"},
        headers=_h(token),
    )
    promo_id = create_resp.json()["id"]
    del_resp = await client.delete(f"/api/v1/promotions/{promo_id}", headers=_h(token))
    assert del_resp.status_code == 204


# ---------------------------------------------------------------------------
# Phase 2 — Evaluate
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_evaluate_percent_off_order_scope(db, store_a):
    from app.enums import PromotionScope, PromotionType
    from app.schemas.promotions import EvaluateItemIn, EvaluateRequest, PromotionCreate
    from app.services import promotions as svc

    product = await make_product(db, store_id=store_a.id, name=f"eval-{uid()}", price=Decimal("100.00"))
    await svc.create_promotion(db, store_id=store_a.id, req=PromotionCreate(
        name="10% off order", type=PromotionType.PERCENT_OFF,
        discount_pct=10, scope=PromotionScope.ORDER,
    ))

    result = await svc.evaluate_promotions(
        db, store_id=store_a.id,
        items=[EvaluateItemIn(product_id=product.id, quantity=2)],
    )

    assert len(result.eligible) == 1
    assert result.eligible[0].discount_amount == Decimal("20.00")  # 10% of 200


@pytest.mark.asyncio
async def test_evaluate_happy_hour_in_window(db, store_a):
    from datetime import time
    from app.enums import PromotionScope, PromotionType
    from app.schemas.promotions import EvaluateItemIn, PromotionCreate
    from app.services import promotions as svc

    product = await make_product(db, store_id=store_a.id, name=f"hh-{uid()}", price=Decimal("80.00"))
    # time window covers the entire day so it's always eligible
    await svc.create_promotion(db, store_id=store_a.id, req=PromotionCreate(
        name="Happy Hour", type=PromotionType.HAPPY_HOUR,
        discount_pct=15, scope=PromotionScope.ORDER,
        time_start=time(0, 0), time_end=time(23, 59, 59),
        days_of_week_json=[0, 1, 2, 3, 4, 5, 6],
    ))

    result = await svc.evaluate_promotions(
        db, store_id=store_a.id,
        items=[EvaluateItemIn(product_id=product.id, quantity=1)],
    )

    assert len(result.eligible) == 1
    assert result.eligible[0].type == PromotionType.HAPPY_HOUR


@pytest.mark.asyncio
async def test_evaluate_happy_hour_expired(db, store_a):
    from datetime import date, time
    from app.enums import PromotionScope, PromotionType
    from app.schemas.promotions import EvaluateItemIn, PromotionCreate
    from app.services import promotions as svc

    product = await make_product(db, store_id=store_a.id, name=f"hh-exp-{uid()}", price=Decimal("80.00"))
    await svc.create_promotion(db, store_id=store_a.id, req=PromotionCreate(
        name="Expired HH", type=PromotionType.HAPPY_HOUR,
        discount_pct=15, scope=PromotionScope.ORDER,
        time_start=time(0, 0), time_end=time(23, 59, 59),
        days_of_week_json=[0, 1, 2, 3, 4, 5, 6],
        valid_until=date(2020, 1, 1),  # in the past
    ))

    result = await svc.evaluate_promotions(
        db, store_id=store_a.id,
        items=[EvaluateItemIn(product_id=product.id, quantity=1)],
    )

    assert result.eligible == []


@pytest.mark.asyncio
async def test_evaluate_combo_bundle_eligible(db, store_a):
    from app.enums import PromotionScope, PromotionType
    from app.schemas.promotions import EvaluateItemIn, PromotionCreate
    from app.services import promotions as svc

    p1 = await make_product(db, store_id=store_a.id, name=f"bundle-a-{uid()}", price=Decimal("50.00"))
    p2 = await make_product(db, store_id=store_a.id, name=f"bundle-b-{uid()}", price=Decimal("50.00"))
    await svc.create_promotion(db, store_id=store_a.id, req=PromotionCreate(
        name="Bundle", type=PromotionType.COMBO_BUNDLE,
        discount_pct=20, scope=PromotionScope.PRODUCT,
        bundle_product_ids_json=[p1.id, p2.id],
    ))

    result = await svc.evaluate_promotions(
        db, store_id=store_a.id,
        items=[
            EvaluateItemIn(product_id=p1.id, quantity=1),
            EvaluateItemIn(product_id=p2.id, quantity=1),
        ],
    )

    assert len(result.eligible) == 1
    assert result.eligible[0].discount_amount == Decimal("20.00")  # 20% of 100


@pytest.mark.asyncio
async def test_evaluate_combo_bundle_missing_product(db, store_a):
    from app.enums import PromotionScope, PromotionType
    from app.schemas.promotions import EvaluateItemIn, PromotionCreate
    from app.services import promotions as svc

    p1 = await make_product(db, store_id=store_a.id, name=f"bundle-c-{uid()}", price=Decimal("50.00"))
    p2 = await make_product(db, store_id=store_a.id, name=f"bundle-d-{uid()}", price=Decimal("50.00"))
    await svc.create_promotion(db, store_id=store_a.id, req=PromotionCreate(
        name="Bundle2", type=PromotionType.COMBO_BUNDLE,
        discount_pct=20, scope=PromotionScope.PRODUCT,
        bundle_product_ids_json=[p1.id, p2.id],
    ))

    result = await svc.evaluate_promotions(
        db, store_id=store_a.id,
        items=[EvaluateItemIn(product_id=p1.id, quantity=1)],  # p2 missing
    )

    assert result.eligible == []


@pytest.mark.asyncio
async def test_evaluate_combo_quantity_eligible(db, store_a):
    from app.enums import PromotionScope, PromotionType
    from app.schemas.promotions import EvaluateItemIn, PromotionCreate
    from app.services import promotions as svc

    product = await make_product(db, store_id=store_a.id, name=f"qty-{uid()}", price=Decimal("40.00"))
    await svc.create_promotion(db, store_id=store_a.id, req=PromotionCreate(
        name="Buy 3+", type=PromotionType.COMBO_QUANTITY,
        discount_pct=10, scope=PromotionScope.PRODUCT,
        product_ids_json=[product.id], min_quantity=3,
    ))

    result = await svc.evaluate_promotions(
        db, store_id=store_a.id,
        items=[EvaluateItemIn(product_id=product.id, quantity=3)],
    )

    assert len(result.eligible) == 1
    assert result.eligible[0].discount_amount == Decimal("12.00")  # 10% of 120


@pytest.mark.asyncio
async def test_evaluate_combo_quantity_below_min(db, store_a):
    from app.enums import PromotionScope, PromotionType
    from app.schemas.promotions import EvaluateItemIn, PromotionCreate
    from app.services import promotions as svc

    product = await make_product(db, store_id=store_a.id, name=f"qty2-{uid()}", price=Decimal("40.00"))
    await svc.create_promotion(db, store_id=store_a.id, req=PromotionCreate(
        name="Buy 3+ v2", type=PromotionType.COMBO_QUANTITY,
        discount_pct=10, scope=PromotionScope.PRODUCT,
        product_ids_json=[product.id], min_quantity=3,
    ))

    result = await svc.evaluate_promotions(
        db, store_id=store_a.id,
        items=[EvaluateItemIn(product_id=product.id, quantity=2)],  # below min
    )

    assert result.eligible == []


@pytest.mark.asyncio
async def test_evaluate_barista_can_access(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")  # barista
    product = await make_product(db, store_id=store_a.id, name=f"eval-api-{uid()}")
    resp = await client.post(
        "/api/v1/promotions/evaluate",
        json={"items": [{"product_id": product.id, "quantity": 1}]},
        headers=_h(token),
    )
    assert resp.status_code == 200
    assert "eligible" in resp.json()


@pytest.mark.asyncio
async def test_evaluate_percent_off_product_scope(db, store_a):
    """PERCENT_OFF with PRODUCT scope only discounts the matching product lines."""
    from app.enums import PromotionScope, PromotionType
    from app.schemas.promotions import EvaluateItemIn, PromotionCreate
    from app.services import promotions as svc

    target = await make_product(db, store_id=store_a.id, name=f"target-{uid()}", price=Decimal("100.00"))
    other = await make_product(db, store_id=store_a.id, name=f"other-{uid()}", price=Decimal("100.00"))
    await svc.create_promotion(db, store_id=store_a.id, req=PromotionCreate(
        name="10% product", type=PromotionType.PERCENT_OFF,
        discount_pct=10, scope=PromotionScope.PRODUCT,
        product_ids_json=[target.id],
    ))

    result = await svc.evaluate_promotions(
        db, store_id=store_a.id,
        items=[
            EvaluateItemIn(product_id=target.id, quantity=1),  # $100
            EvaluateItemIn(product_id=other.id, quantity=1),   # $100 — NOT discounted
        ],
    )

    assert len(result.eligible) == 1
    assert result.eligible[0].discount_amount == Decimal("10.00")  # 10% of $100, not $200


@pytest.mark.asyncio
async def test_evaluate_happy_hour_wrong_day(db, store_a):
    """HAPPY_HOUR is skipped when today's weekday is not in days_of_week_json."""
    from datetime import time, timezone
    from app.enums import PromotionScope, PromotionType
    from app.schemas.promotions import EvaluateItemIn, PromotionCreate
    from app.services import promotions as svc
    from datetime import datetime

    product = await make_product(db, store_id=store_a.id, name=f"hh-day-{uid()}", price=Decimal("80.00"))
    today_weekday = datetime.now(timezone.utc).weekday()
    # Use only weekdays that are NOT today (always 6 out of 7, so never empty)
    excluded_days = [d for d in range(7) if d != today_weekday]

    await svc.create_promotion(db, store_id=store_a.id, req=PromotionCreate(
        name="Wrong Day HH", type=PromotionType.HAPPY_HOUR,
        discount_pct=15, scope=PromotionScope.ORDER,
        time_start=time(0, 0), time_end=time(23, 59, 59),
        days_of_week_json=excluded_days,
    ))

    result = await svc.evaluate_promotions(
        db, store_id=store_a.id,
        items=[EvaluateItemIn(product_id=product.id, quantity=1)],
    )

    assert result.eligible == []


# ---------------------------------------------------------------------------
# Phase 2 — Checkout integration
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_order_with_promotion_applies_discount(client, db, store_a, manager_a, user_a):
    from app.enums import PromotionScope, PromotionType
    from app.models.promotions import PromotionRedemption
    from app.schemas.promotions import PromotionCreate
    from app.services import promotions as svc
    from sqlalchemy import select

    token = await _login(client, store_a.slug, "1111")  # barista
    product = await make_product(db, store_id=store_a.id, name=f"promo-order-{uid()}", price=Decimal("100.00"))
    promo = await svc.create_promotion(db, store_id=store_a.id, req=PromotionCreate(
        name="10off", type=PromotionType.PERCENT_OFF,
        discount_pct=10, scope=PromotionScope.ORDER,
    ))

    resp = await client.post(
        "/api/v1/orders",
        json={
            "idempotency_key": uid(),
            "channel": "DINE_IN",
            "items": [{"product_id": product.id, "quantity": 2}],
            "promotion_ids": [promo.id],
        },
        headers=_h(token),
    )
    assert resp.status_code == 201
    body = resp.json()
    assert Decimal(body["discount"]) == Decimal("20.00")   # 10% of 200
    assert Decimal(body["total"]) == Decimal("180.00")

    # PromotionRedemption row written
    row = (await db.execute(
        select(PromotionRedemption).where(PromotionRedemption.order_id == body["id"])
    )).scalar_one_or_none()
    assert row is not None
    assert row.discount_amount == Decimal("20.00")


@pytest.mark.asyncio
async def test_order_exclusive_stacking_returns_422(client, db, store_a, user_a):
    from app.enums import PromotionScope, PromotionType
    from app.schemas.promotions import PromotionCreate
    from app.services import promotions as svc

    token = await _login(client, store_a.slug, "1111")
    product = await make_product(db, store_id=store_a.id, name=f"excl-{uid()}", price=Decimal("100.00"))
    exclusive = await svc.create_promotion(db, store_id=store_a.id, req=PromotionCreate(
        name="Exclusive", type=PromotionType.PERCENT_OFF,
        discount_pct=20, scope=PromotionScope.ORDER, is_exclusive=True,
    ))
    other = await svc.create_promotion(db, store_id=store_a.id, req=PromotionCreate(
        name="Other", type=PromotionType.PERCENT_OFF,
        discount_pct=5, scope=PromotionScope.ORDER,
    ))

    resp = await client.post(
        "/api/v1/orders",
        json={
            "idempotency_key": uid(),
            "channel": "DINE_IN",
            "items": [{"product_id": product.id, "quantity": 1}],
            "promotion_ids": [exclusive.id, other.id],
        },
        headers=_h(token),
    )
    assert resp.status_code == 422
    assert "exclusive" in resp.json()["error"]["message"].lower()


@pytest.mark.asyncio
async def test_order_no_promotions_zero_discount(client, db, store_a, user_a):
    """Baseline: order without promotion_ids has discount=0."""
    token = await _login(client, store_a.slug, "1111")
    product = await make_product(db, store_id=store_a.id, name=f"no-promo-{uid()}", price=Decimal("100.00"))
    resp = await client.post(
        "/api/v1/orders",
        json={
            "idempotency_key": uid(),
            "channel": "DINE_IN",
            "items": [{"product_id": product.id, "quantity": 1}],
        },
        headers=_h(token),
    )
    assert resp.status_code == 201
    assert Decimal(resp.json()["discount"]) == Decimal("0.00")
    assert Decimal(resp.json()["total"]) == Decimal("100.00")


@pytest.mark.asyncio
async def test_order_promotion_and_membership_stack(client, db, store_a, user_a, manager_a):
    """Promotion + membership rewards stack additively but never exceed subtotal."""
    from app.enums import EarnMode, PromotionScope, PromotionType, RewardScope, RewardType
    from app.models.membership import MembershipAccount, MembershipProgram, PointTransaction
    from app.enums import PointTxType
    from app.schemas.promotions import PromotionCreate
    from app.services import promotions as svc
    from tests.factories import make_customer

    token = await _login(client, store_a.slug, "1111")  # barista

    # Create a product worth $100
    product = await make_product(
        db, store_id=store_a.id, name=f"stack-{uid()}", price=Decimal("100.00")
    )

    # Create a 60% promotion (discount = $60)
    promo = await svc.create_promotion(db, store_id=store_a.id, req=PromotionCreate(
        name=f"60off-{uid()}", type=PromotionType.PERCENT_OFF,
        discount_pct=60, scope=PromotionScope.ORDER,
    ))

    # Create a membership program with a fixed reward of $500 (much larger than order)
    async with db.begin():
        program = MembershipProgram(
            store_id=store_a.id,
            is_active=True,
            earn_mode=EarnMode.PER_RECEIPT,
            reward_type=RewardType.DISCOUNT_FIXED,
            reward_value=Decimal("500.00"),
            reward_scope=RewardScope.ALL,
            points_to_redeem=1,
        )
        db.add(program)
        await db.flush()
        await db.refresh(program)

    # Create a customer and membership account with enough points
    customer = await make_customer(db, store_id=store_a.id)
    async with db.begin():
        account = MembershipAccount(
            customer_id=customer.id,
            store_id=store_a.id,
            points_balance=10,
            lifetime_points_earned=10,
        )
        db.add(account)
        await db.flush()
        await db.refresh(account)

    resp = await client.post(
        "/api/v1/orders",
        json={
            "idempotency_key": uid(),
            "channel": "DINE_IN",
            "items": [{"product_id": product.id, "quantity": 1}],
            "promotion_ids": [promo.id],
            "member_id": account.id,
            "redeem_reward": True,
        },
        headers=_h(token),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    # Combined discount must never exceed subtotal ($100)
    assert Decimal(body["discount"]) <= Decimal(body["subtotal"])
    assert Decimal(body["discount"]) == Decimal("100.00")
    # Total must never be negative
    assert Decimal(body["total"]) >= Decimal("0.00")
    assert Decimal(body["total"]) == Decimal("0.00")
