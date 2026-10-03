"""Service-layer tests for the dashboard/reports module (Tier 6).

Runs against real Postgres. Seeds data directly via factory helpers to avoid
the pusher dependency in the orders service.
"""
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest_asyncio

from app.enums import MovementType, OrderStatus, WastageReason
from app.models.inventory import StockMovement
from app.services import reports as svc
from app.services.inventory import _encode_waste_reason
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


# ---------- wastage report ----------


async def _seed_waste(
    db,
    *,
    store_id,
    item_id,
    user_id,
    qty,
    reason,
    note=None,
    created_at=None,
):
    """Insert a WASTE StockMovement directly with an encoded reason.

    record_waste() can't set created_at, so by_day tests seed rows directly.
    """
    mv = StockMovement(
        store_id=store_id,
        inventory_item_id=item_id,
        type=MovementType.WASTE,
        quantity=qty,
        reason=_encode_waste_reason(reason, note),
        created_by_id=user_id,
    )
    if created_at is not None:
        mv.created_at = created_at
    db.add(mv)
    await db.commit()
    return mv


@pytest_asyncio.fixture
async def waste_range() -> tuple[datetime, datetime]:
    now = _now()
    return now - timedelta(days=3), now + timedelta(days=1)


@pytest_asyncio.fixture
async def seeded_waste(db, store_a, user_a):
    """Two items wasted across two days with three distinct reasons.

    item_a (Milk, cost 0.05): EXPIRED 100 (day1, note), DAMAGED 200 (day2)
    item_b (Beans, cost 0.20): SPILLED 50 (day1)
    """
    now = _now()
    day1 = now - timedelta(days=2)
    day2 = now - timedelta(days=1)
    item_a = await make_item(db, store_id=store_a.id, name="Milk-w", unit="ml", cost_per_unit=Decimal("0.05"))
    item_b = await make_item(db, store_id=store_a.id, name="Beans-w", unit="g", cost_per_unit=Decimal("0.20"))
    await _seed_waste(
        db,
        store_id=store_a.id,
        item_id=item_a.id,
        user_id=user_a.id,
        qty=Decimal("100"),
        reason=WastageReason.EXPIRED,
        note="old batch",
        created_at=day1,
    )
    await _seed_waste(
        db,
        store_id=store_a.id,
        item_id=item_b.id,
        user_id=user_a.id,
        qty=Decimal("50"),
        reason=WastageReason.SPILLED,
        created_at=day1 + timedelta(seconds=1),  # same day, deterministic event order
    )
    await _seed_waste(
        db,
        store_id=store_a.id,
        item_id=item_a.id,
        user_id=user_a.id,
        qty=Decimal("200"),
        reason=WastageReason.DAMAGED,
        created_at=day2,
    )
    return {"item_a": item_a, "item_b": item_b, "day1": day1, "day2": day2}


async def test_wastage_empty_returns_zeros_and_empty_arrays(db, store_b, waste_range):
    from_, to = waste_range
    result = await svc.get_wastage_report(db, store_id=store_b.id, from_=from_, to=to)
    assert result.total_quantity == Decimal("0")
    assert result.total_cost == Decimal("0")
    assert result.event_count == 0
    assert result.by_reason == []
    assert result.by_day == []
    assert result.by_item == []
    assert result.events == []


async def test_wastage_totals_and_event_count(db, store_a, waste_range, seeded_waste):
    from_, to = waste_range
    result = await svc.get_wastage_report(db, store_id=store_a.id, from_=from_, to=to)
    assert result.event_count == 3
    assert result.total_quantity == Decimal("350")
    # 100*0.05 + 50*0.20 + 200*0.05 = 5 + 10 + 10
    assert result.total_cost == Decimal("25.00")


async def test_wastage_by_reason_groups_and_sums(db, store_a, waste_range, seeded_waste):
    from_, to = waste_range
    result = await svc.get_wastage_report(db, store_id=store_a.id, from_=from_, to=to)
    by_reason = {r.reason_code: r for r in result.by_reason}
    assert set(by_reason) == {"EXPIRED", "SPILLED", "DAMAGED"}
    assert by_reason["EXPIRED"].event_count == 1
    assert by_reason["EXPIRED"].total_quantity == Decimal("100")
    assert by_reason["EXPIRED"].estimated_cost == Decimal("5.00")
    assert by_reason["SPILLED"].estimated_cost == Decimal("10.00")
    assert by_reason["DAMAGED"].estimated_cost == Decimal("10.00")


async def test_wastage_by_item_groups_and_orders_by_cost(db, store_a, waste_range, seeded_waste):
    from_, to = waste_range
    result = await svc.get_wastage_report(db, store_id=store_a.id, from_=from_, to=to)
    # Milk: 300 qty @ 0.05 = 15.00 (cost-leader) > Beans: 50 @ 0.20 = 10.00
    assert [i.item_name for i in result.by_item] == ["Milk-w", "Beans-w"]
    milk = result.by_item[0]
    assert milk.unit == "ml"
    assert milk.event_count == 2
    assert milk.total_quantity == Decimal("300")
    assert milk.estimated_cost == Decimal("15.00")


async def test_wastage_by_day_buckets_ascending(db, store_a, waste_range, seeded_waste):
    from_, to = waste_range
    result = await svc.get_wastage_report(db, store_id=store_a.id, from_=from_, to=to)
    assert len(result.by_day) == 2
    day1_label = seeded_waste["day1"].strftime("%Y-%m-%d")
    day2_label = seeded_waste["day2"].strftime("%Y-%m-%d")
    assert [d.bucket for d in result.by_day] == [day1_label, day2_label]
    d1 = result.by_day[0]
    assert d1.event_count == 2
    assert d1.total_quantity == Decimal("150")
    assert d1.estimated_cost == Decimal("15.00")  # 5 + 10


async def test_wastage_events_register(db, store_a, user_a, waste_range, seeded_waste):
    from_, to = waste_range
    result = await svc.get_wastage_report(db, store_id=store_a.id, from_=from_, to=to)
    assert len(result.events) == 3
    # chronological ascending
    assert result.events[0].created_at <= result.events[1].created_at <= result.events[2].created_at
    first = result.events[0]
    assert first.reason_code == "EXPIRED"
    assert first.note == "old batch"
    assert first.item_name == "Milk-w"
    assert first.unit == "ml"
    assert first.quantity == Decimal("100")
    assert first.estimated_cost == Decimal("5.00")
    assert first.created_by_name == user_a.name


async def test_wastage_store_isolation(db, store_a, store_b, waste_range, seeded_waste):
    from_, to = waste_range
    result = await svc.get_wastage_report(db, store_id=store_b.id, from_=from_, to=to)
    assert result.event_count == 0
    assert result.events == []
