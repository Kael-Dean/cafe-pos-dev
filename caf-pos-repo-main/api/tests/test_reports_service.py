"""Service-layer tests for the dashboard/reports module (Tier 6).

Runs against real Postgres. Seeds data directly via factory helpers to avoid
the pusher dependency in the orders service.
"""
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest_asyncio

from app.enums import MovementType, OrderStatus
from app.models.inventory import StockMovement
from app.services import reports as svc
from tests.factories import make_item, make_order_direct, make_order_item


def _now() -> datetime:
    return datetime.now(UTC)


def _range() -> tuple[datetime, datetime]:
    now = _now()
    return now - timedelta(days=1), now + timedelta(days=1)


# ---------- fixtures ----------


@pytest_asyncio.fixture
async def paid_order(db, store_a, user_a):
    order = await make_order_direct(
        db,
        store_id=store_a.id,
        created_by_id=user_a.id,
        total=Decimal("250.00"),
        status=OrderStatus.PAID,
    )
    await make_order_item(db, order_id=order.id, product_name="Latte-rpt", quantity=2, unit_price=Decimal("85.00"))
    await make_order_item(db, order_id=order.id, product_name="Croissant-rpt", quantity=1, unit_price=Decimal("80.00"))
    return order


@pytest_asyncio.fixture
async def inv_item_rpt(db, store_a):
    return await make_item(
        db,
        store_id=store_a.id,
        name="Beans-rpt",
        unit="g",
        stock=Decimal("500"),
        par=Decimal("1000"),
    )


# ---------- dashboard ----------


async def test_dashboard_today_returns_zeros_for_empty_store(db, store_b):
    result = await svc.get_dashboard_today(db, store_id=store_b.id)
    assert result.revenue == Decimal("0")
    assert result.order_count == 0
    assert result.avg_ticket == Decimal("0")
    assert result.top_items == []


async def test_dashboard_today_counts_paid_orders(db, store_a, paid_order):
    result = await svc.get_dashboard_today(db, store_id=store_a.id)
    assert result.order_count >= 1
    assert result.revenue >= Decimal("250.00")
    assert result.avg_ticket > Decimal("0")


async def test_dashboard_today_top_items_populated(db, store_a, paid_order):
    result = await svc.get_dashboard_today(db, store_id=store_a.id)
    names = [item.product_name for item in result.top_items]
    assert any("Latte-rpt" in n or "Croissant-rpt" in n for n in names)


# ---------- sales report ----------


async def test_sales_report_day_granularity(db, store_a, paid_order):
    from_, to = _range()
    result = await svc.get_sales_report(db, store_id=store_a.id, from_=from_, to=to, granularity="day")
    assert result.granularity == "day"
    assert result.total_orders >= 1
    assert result.total_revenue >= Decimal("250.00")
    assert len(result.buckets) >= 1


async def test_sales_report_product_granularity(db, store_a, paid_order):
    from_, to = _range()
    result = await svc.get_sales_report(db, store_id=store_a.id, from_=from_, to=to, granularity="product")
    bucket_names = [b.bucket for b in result.buckets]
    assert any("Latte-rpt" in n or "Croissant-rpt" in n for n in bucket_names)


async def test_sales_report_empty_range_returns_zero(db, store_a):
    past = _now() - timedelta(days=365)
    far_past = past - timedelta(days=1)
    result = await svc.get_sales_report(db, store_id=store_a.id, from_=far_past, to=past, granularity="day")
    assert result.total_orders == 0
    assert result.total_revenue == Decimal("0")


# ---------- low-stock report ----------


async def test_low_stock_report_includes_below_par(db, store_a, inv_item_rpt):
    result = await svc.get_low_stock_report(db, store_id=store_a.id)
    ids = [item.item_id for item in result.items]
    assert inv_item_rpt.id in ids


async def test_low_stock_report_excludes_above_par(db, store_a):
    item = await make_item(
        db,
        store_id=store_a.id,
        name="HighStock-rpt",
        stock=Decimal("500"),
        par=Decimal("10"),
    )
    result = await svc.get_low_stock_report(db, store_id=store_a.id)
    ids = [i.item_id for i in result.items]
    assert item.id not in ids


# ---------- COGS report ----------


async def test_cogs_report_empty_when_no_movements(db, store_b):
    from_, to = _range()
    result = await svc.get_cogs_report(db, store_id=store_b.id, from_=from_, to=to)
    assert result.total_cogs == Decimal("0")
    assert result.items == []


async def test_cogs_report_includes_sale_movements(db, store_a, user_a, inv_item_rpt):
    inv_item_rpt.cost_per_unit = Decimal("0.05")
    db.add(StockMovement(
        store_id=store_a.id,
        inventory_item_id=inv_item_rpt.id,
        type=MovementType.SALE,
        quantity=Decimal("100"),
        reason="Order #9999",
        created_by_id=user_a.id,
    ))
    await db.commit()

    from_, to = _range()
    result = await svc.get_cogs_report(db, store_id=store_a.id, from_=from_, to=to)
    assert result.total_cogs > Decimal("0")
    item_ids = [i.item_id for i in result.items]
    assert inv_item_rpt.id in item_ids


# ---------- cashier shifts report ----------


async def test_cashier_shifts_groups_by_user(db, store_a, user_a, paid_order):
    from_, to = _range()
    result = await svc.get_cashier_shifts_report(db, store_id=store_a.id, from_=from_, to=to)
    user_ids = [c.user_id for c in result.cashiers]
    assert user_a.id in user_ids


async def test_cashier_shifts_empty_for_store_with_no_orders(db, store_b):
    from_, to = _range()
    result = await svc.get_cashier_shifts_report(db, store_id=store_b.id, from_=from_, to=to)
    assert result.cashiers == []
