import logging
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.enums import MovementType, WastageReason
from app.models import StockMovement
from app.schemas.inventory import (
    AdjustRequest,
    InventoryItemUpdate,
    ReceiveStockRequest,
    WasteRequest,
)
from app.services import inventory as inv

from tests.conftest import make_item


async def test_receive_increments_stock_and_creates_movement(db, store_a, user_a):
    item = await make_item(db, store_id=store_a.id, stock=Decimal("100"), cost=Decimal("0.50"))

    updated = await inv.receive_stock(
        db,
        store_id=store_a.id,
        user_id=user_a.id,
        req=ReceiveStockRequest(
            item_id=item.id,
            qty=Decimal("50"),
            cost_per_unit=Decimal("0.55"),
            supplier="Boncafe",
            note="weekly delivery",
        ),
    )

    assert updated.stock_on_hand == Decimal("150.000")
    assert updated.cost_per_unit == Decimal("0.5500")

    movements = (
        await db.execute(
            select(StockMovement).where(StockMovement.inventory_item_id == item.id)
        )
    ).scalars().all()
    assert len(movements) == 1
    m = movements[0]
    assert m.type == MovementType.RECEIVE
    assert m.quantity == Decimal("50.000")
    assert "supplier=Boncafe" in (m.reason or "")
    assert m.created_by_id == user_a.id


async def test_record_waste_allows_negative_stock(db, store_a, user_a, caplog):
    item = await make_item(db, store_id=store_a.id, stock=Decimal("10"))

    with caplog.at_level(logging.WARNING):
        updated = await inv.record_waste(
            db,
            store_id=store_a.id,
            user_id=user_a.id,
            req=WasteRequest(
                item_id=item.id,
                qty=Decimal("15"),
                reason=WastageReason.EXPIRED,
                note="opened jug overnight",
            ),
        )

    assert updated.stock_on_hand == Decimal("-5.000")
    assert any(
        "negative_stock" in r.message or "negative" in r.getMessage().lower()
        for r in caplog.records
    ), "expected a negative-stock warning log"

    movement = (
        await db.execute(select(StockMovement).where(StockMovement.inventory_item_id == item.id))
    ).scalar_one()
    assert movement.type == MovementType.WASTE
    assert movement.reason == "EXPIRED|opened jug overnight"


async def test_cross_store_isolation_returns_404(db, store_a, store_b, user_a):
    item_b = await make_item(db, store_id=store_b.id, name="Beans-B")

    from app.core.errors import NotFound

    with pytest.raises(NotFound):
        await inv.get_item(db, store_id=store_a.id, item_id=item_b.id)


async def test_low_stock_query_filters_by_par(db, store_a):
    critical = await make_item(
        db, store_id=store_a.id, name="Beans", stock=Decimal("400"), par=Decimal("1500")
    )
    low = await make_item(
        db, store_id=store_a.id, name="Milk", stock=Decimal("2100"), par=Decimal("4000")
    )
    ok = await make_item(
        db, store_id=store_a.id, name="Sugar", stock=Decimal("8000"), par=Decimal("6000")
    )

    rows = await inv.low_stock(db, store_id=store_a.id)
    ids = {r.id for r in rows}
    assert ids == {critical.id, low.id}
    assert ok.id not in ids


async def test_atomicity_rollback_on_movement_failure(db, store_a, user_a, monkeypatch):
    item = await make_item(db, store_id=store_a.id, stock=Decimal("100"))
    original_stock = item.stock_on_hand

    from app.models import inventory as inv_models

    def boom(*args, **kwargs):
        raise RuntimeError("simulated insert failure")

    monkeypatch.setattr(inv_models.StockMovement, "__init__", boom)

    with pytest.raises(RuntimeError):
        await inv.receive_stock(
            db,
            store_id=store_a.id,
            user_id=user_a.id,
            req=ReceiveStockRequest(
                item_id=item.id, qty=Decimal("50"), cost_per_unit=Decimal("0.55")
            ),
        )

    db.expire_all()
    refreshed = await inv.get_item(db, store_id=store_a.id, item_id=item.id)
    assert refreshed.stock_on_hand == original_stock


async def test_adjust_positive_delta_increments(db, store_a, manager_a):
    item = await make_item(db, store_id=store_a.id, stock=Decimal("100"))

    updated = await inv.adjust_stock(
        db,
        store_id=store_a.id,
        user_id=manager_a.id,
        req=AdjustRequest(item_id=item.id, delta=Decimal("5"), reason="found extra crate"),
    )
    assert updated.stock_on_hand == Decimal("105.000")

    movement = (
        await db.execute(select(StockMovement).where(StockMovement.inventory_item_id == item.id))
    ).scalar_one()
    assert movement.type == MovementType.ADJUST
    assert movement.quantity == Decimal("5.000")
    assert movement.reason and movement.reason.startswith("ADJUST+|")


async def test_adjust_negative_delta_decrements(db, store_a, manager_a):
    item = await make_item(db, store_id=store_a.id, stock=Decimal("100"))

    updated = await inv.adjust_stock(
        db,
        store_id=store_a.id,
        user_id=manager_a.id,
        req=AdjustRequest(item_id=item.id, delta=Decimal("-3"), reason="count discrepancy"),
    )
    assert updated.stock_on_hand == Decimal("97.000")

    movement = (
        await db.execute(select(StockMovement).where(StockMovement.inventory_item_id == item.id))
    ).scalar_one()
    assert movement.quantity == Decimal("3.000")
    assert movement.reason and movement.reason.startswith("ADJUST-|")


async def test_inactive_item_rejects_receive(db, store_a, user_a):
    item = await make_item(db, store_id=store_a.id, is_active=False)

    from app.core.errors import Conflict

    with pytest.raises(Conflict):
        await inv.receive_stock(
            db,
            store_id=store_a.id,
            user_id=user_a.id,
            req=ReceiveStockRequest(
                item_id=item.id, qty=Decimal("10"), cost_per_unit=Decimal("0.50")
            ),
        )


async def test_update_item_changes_par_and_cost(db, store_a, manager_a):
    item = await make_item(
        db, store_id=store_a.id, par=Decimal("100"), cost=Decimal("0.50")
    )
    updated = await inv.update_item(
        db,
        store_id=store_a.id,
        item_id=item.id,
        payload=InventoryItemUpdate(par_level=Decimal("200"), cost_per_unit=Decimal("0.75")),
    )
    assert updated.par_level == Decimal("200.000")
    assert updated.cost_per_unit == Decimal("0.7500")


async def test_movements_pagination(db, store_a, user_a):
    item = await make_item(db, store_id=store_a.id, stock=Decimal("1000"))
    for _ in range(5):
        await inv.receive_stock(
            db,
            store_id=store_a.id,
            user_id=user_a.id,
            req=ReceiveStockRequest(
                item_id=item.id, qty=Decimal("1"), cost_per_unit=Decimal("0.1")
            ),
        )

    page = await inv.list_movements(db, store_id=store_a.id, limit=2)
    assert len(page.items) == 2
    assert page.next_cursor is not None

    page2 = await inv.list_movements(db, store_id=store_a.id, limit=2, cursor=page.next_cursor)
    assert len(page2.items) == 2
    first_ids = {m.id for m in page.items}
    second_ids = {m.id for m in page2.items}
    assert first_ids.isdisjoint(second_ids)
