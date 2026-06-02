from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.enums import MovementType, OrderStatus
from app.models import StockMovement
from app.schemas.stock_takes import StockTakeSubmit, StockTakeSubmitItem
from app.services import stock_takes as svc
from tests.factories import (
    make_item,
    make_order_direct,
    make_order_item,
    make_product,
    make_recipe_item,
)


@pytest.mark.asyncio
async def test_preview_falls_back_to_30_days_when_no_prior_check(db, store_a, user_a):
    result = await svc.get_preview(db, store_id=store_a.id)
    expected_start = datetime.now(tz=UTC) - timedelta(days=30)
    diff = abs((result.period_start - expected_start).total_seconds())
    assert diff < 5
    assert result.items == []


@pytest.mark.asyncio
async def test_preview_aggregates_consumption_from_orders(db, store_a, user_a):
    milk = await make_item(db, store_id=store_a.id, name="Milk", unit="L", stock=Decimal("5.000"))
    latte = await make_product(db, store_id=store_a.id, name="Latte")
    await make_recipe_item(db, product_id=latte.id, inventory_item_id=milk.id, quantity=Decimal("0.200"))

    order = await make_order_direct(db, store_id=store_a.id, created_by_id=user_a.id, status=OrderStatus.PAID)
    await make_order_item(db, order_id=order.id, product_id=latte.id, product_name="Latte", quantity=3)

    result = await svc.get_preview(db, store_id=store_a.id)

    assert len(result.items) == 1
    item = result.items[0]
    assert item.inventory_item_id == milk.id
    assert item.name == "Milk"
    assert item.unit == "L"
    assert item.consumed_in_period == Decimal("0.600")
    assert item.system_quantity == Decimal("5.000")


@pytest.mark.asyncio
async def test_preview_excludes_void_orders(db, store_a, user_a):
    milk = await make_item(db, store_id=store_a.id, name="Milk", unit="L", stock=Decimal("5.000"))
    latte = await make_product(db, store_id=store_a.id, name="Latte")
    await make_recipe_item(db, product_id=latte.id, inventory_item_id=milk.id, quantity=Decimal("0.200"))

    void_order = await make_order_direct(db, store_id=store_a.id, created_by_id=user_a.id, status=OrderStatus.VOID)
    await make_order_item(db, order_id=void_order.id, product_id=latte.id, product_name="Latte", quantity=5)

    result = await svc.get_preview(db, store_id=store_a.id)
    assert result.items == []


@pytest.mark.asyncio
async def test_preview_excludes_products_with_no_recipe(db, store_a, user_a):
    latte = await make_product(db, store_id=store_a.id, name="Latte")
    order = await make_order_direct(db, store_id=store_a.id, created_by_id=user_a.id, status=OrderStatus.PAID)
    await make_order_item(db, order_id=order.id, product_id=latte.id, product_name="Latte", quantity=2)

    result = await svc.get_preview(db, store_id=store_a.id)
    assert result.items == []


@pytest.mark.asyncio
async def test_submit_creates_adjust_movement_for_variance(db, store_a, user_a):
    milk = await make_item(db, store_id=store_a.id, name="Milk", unit="L", stock=Decimal("5.000"))

    payload = StockTakeSubmit(
        items=[StockTakeSubmitItem(inventory_item_id=milk.id, actual_quantity=Decimal("4.000"))],
        notes="Evening check",
    )
    results = await svc.submit_stock_take(db, store_id=store_a.id, user_id=user_a.id, payload=payload)

    assert len(results) == 1
    assert results[0].system_quantity == Decimal("5.000")
    assert results[0].actual_quantity == Decimal("4.000")
    assert results[0].variance == Decimal("-1.000")

    movements = (
        await db.execute(
            select(StockMovement).where(
                StockMovement.inventory_item_id == milk.id,
                StockMovement.type == MovementType.ADJUST,
            )
        )
    ).scalars().all()
    assert len(movements) == 1
    assert movements[0].quantity == Decimal("1.000")
    assert movements[0].reason.startswith("STOCK_TAKE|4.000|-1.000|")


@pytest.mark.asyncio
async def test_submit_updates_stock_on_hand(db, store_a, user_a):
    milk = await make_item(db, store_id=store_a.id, name="Milk", unit="L", stock=Decimal("5.000"))
    payload = StockTakeSubmit(
        items=[StockTakeSubmitItem(inventory_item_id=milk.id, actual_quantity=Decimal("3.500"))],
    )
    await svc.submit_stock_take(db, store_id=store_a.id, user_id=user_a.id, payload=payload)

    await db.refresh(milk)
    assert milk.stock_on_hand == Decimal("3.500")


@pytest.mark.asyncio
async def test_submit_skips_items_with_zero_delta(db, store_a, user_a):
    milk = await make_item(db, store_id=store_a.id, name="Milk", unit="L", stock=Decimal("5.000"))
    payload = StockTakeSubmit(
        items=[StockTakeSubmitItem(inventory_item_id=milk.id, actual_quantity=Decimal("5.000"))],
    )
    results = await svc.submit_stock_take(db, store_id=store_a.id, user_id=user_a.id, payload=payload)

    assert results == []
    movements = (
        await db.execute(
            select(StockMovement).where(StockMovement.inventory_item_id == milk.id)
        )
    ).scalars().all()
    assert movements == []


@pytest.mark.asyncio
async def test_submit_raises_not_found_for_unknown_item(db, store_a, user_a):
    from app.core.errors import NotFound
    payload = StockTakeSubmit(
        items=[StockTakeSubmitItem(inventory_item_id="nonexistent_id_xyz", actual_quantity=Decimal("1.0"))],
    )
    with pytest.raises(NotFound):
        await svc.submit_stock_take(db, store_id=store_a.id, user_id=user_a.id, payload=payload)


@pytest.mark.asyncio
async def test_submit_raises_conflict_for_inactive_item(db, store_a, user_a):
    from app.core.errors import Conflict
    milk = await make_item(db, store_id=store_a.id, name="Milk", unit="L", stock=Decimal("5.000"), is_active=False)
    payload = StockTakeSubmit(
        items=[StockTakeSubmitItem(inventory_item_id=milk.id, actual_quantity=Decimal("4.000"))],
    )
    with pytest.raises(Conflict):
        await svc.submit_stock_take(db, store_id=store_a.id, user_id=user_a.id, payload=payload)


@pytest.mark.asyncio
async def test_history_returns_events_grouped_by_submit(db, store_a, user_a):
    milk = await make_item(db, store_id=store_a.id, name="Milk", unit="L", stock=Decimal("5.000"))

    payload = StockTakeSubmit(
        items=[StockTakeSubmitItem(inventory_item_id=milk.id, actual_quantity=Decimal("4.000"))],
        notes="First check",
    )
    await svc.submit_stock_take(db, store_id=store_a.id, user_id=user_a.id, payload=payload)

    events = await svc.get_history(db, store_id=store_a.id)

    assert len(events) == 1
    event = events[0]
    assert event.conducted_by == user_a.name
    assert event.item_count == 1
    assert len(event.items) == 1
    assert event.items[0].name == "Milk"
    assert event.items[0].actual_quantity == Decimal("4.000")
    assert event.items[0].system_quantity == Decimal("5.000")
    assert event.items[0].variance == Decimal("-1.000")


@pytest.mark.asyncio
async def test_history_returns_empty_list_when_no_checks(db, store_a):
    events = await svc.get_history(db, store_id=store_a.id)
    assert events == []


@pytest.mark.asyncio
async def test_history_cross_store_isolation(db, store_a, store_b, user_a, user_b):
    milk_a = await make_item(db, store_id=store_a.id, name="Milk", unit="L", stock=Decimal("5.000"))
    payload_a = StockTakeSubmit(
        items=[StockTakeSubmitItem(inventory_item_id=milk_a.id, actual_quantity=Decimal("3.000"))],
    )
    await svc.submit_stock_take(db, store_id=store_a.id, user_id=user_a.id, payload=payload_a)

    events_b = await svc.get_history(db, store_id=store_b.id)
    assert events_b == []
