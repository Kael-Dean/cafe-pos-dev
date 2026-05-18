"""Service-layer tests for the orders module (Tier 4).

Runs against real Postgres. Uses the shared conftest fixtures for db session,
stores, users, inventory items, and products.
"""
import secrets
from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.core.errors import Conflict, NotFound
from app.enums import Channel, MovementType, OrderStatus, PaymentMethod
from app.models.inventory import StockMovement
from app.schemas.orders import (
    CreateOrderRequest,
    OrderItemIn,
    PayOrderRequest,
    UpdateStatusRequest,
    VoidOrderRequest,
)
from app.services import orders as svc
from tests.conftest import make_category, make_item, make_product


# ---------- helpers ----------


def _idem() -> str:
    return secrets.token_hex(8)


def _create_req(product_id: str, qty: int = 1, modifier_ids: list[str] | None = None) -> CreateOrderRequest:
    return CreateOrderRequest(
        idempotency_key=_idem(),
        channel=Channel.DINE_IN,
        items=[OrderItemIn(product_id=product_id, quantity=qty, modifier_ids=modifier_ids or [])],
    )


# ---------- fixtures ----------


@pytest_asyncio.fixture(loop_scope="session")
async def category_a(db, store_a):
    return await make_category(db, store_id=store_a.id, name="Drinks-ord")


@pytest_asyncio.fixture(loop_scope="session")
async def product_a(db, store_a, category_a):
    return await make_product(db, store_id=store_a.id, name="Latte-ord", price=Decimal("85.00"), category_id=category_a.id)


@pytest_asyncio.fixture(loop_scope="session")
async def inv_beans(db, store_a):
    return await make_item(db, store_id=store_a.id, name="Beans-ord", unit="g", stock=Decimal("500"), par=Decimal("100"))


# ---------- tests ----------


@pytest.mark.asyncio
async def test_create_order_basic(db, store_a, user_a, product_a):
    """Order creation returns a PENDING order with the correct total."""
    req = _create_req(product_a.id)
    order = await svc.create_order(db, store_id=store_a.id, user_id=user_a.id, req=req)

    assert order.status == OrderStatus.PENDING
    assert order.total == product_a.price
    assert order.store_id == store_a.id
    assert order.order_number >= 1001


@pytest.mark.asyncio
async def test_create_order_deducts_inventory(db, store_a, user_a, product_a, inv_beans):
    """Creating an order with a recipe deducts stock and writes a SALE movement."""
    from app.models.catalog import RecipeItem

    recipe_qty = Decimal("18")
    db.add(RecipeItem(product_id=product_a.id, inventory_item_id=inv_beans.id, quantity=recipe_qty))
    await db.commit()

    await db.refresh(inv_beans)
    stock_before = inv_beans.stock_on_hand

    req = _create_req(product_a.id, qty=2)
    order = await svc.create_order(db, store_id=store_a.id, user_id=user_a.id, req=req)

    await db.refresh(inv_beans)
    assert inv_beans.stock_on_hand == stock_before - (recipe_qty * 2)

    movements = list((await db.execute(
        select(StockMovement).where(
            StockMovement.ref_order_id == order.id,
            StockMovement.type == MovementType.SALE,
        )
    )).scalars())
    assert len(movements) == 1
    assert movements[0].quantity == recipe_qty * 2


@pytest.mark.asyncio
async def test_create_order_idempotency(db, store_a, user_a, product_a):
    """Duplicate idempotency key raises Conflict."""
    req = _create_req(product_a.id)
    await svc.create_order(db, store_id=store_a.id, user_id=user_a.id, req=req)

    with pytest.raises(Conflict):
        await svc.create_order(db, store_id=store_a.id, user_id=user_a.id, req=req)


@pytest.mark.asyncio
async def test_create_order_cross_store_product_rejected(db, store_a, store_b, user_a, user_b):
    """Product from store B cannot be ordered in store A context."""
    product_b = await make_product(db, store_id=store_b.id, name="Espresso-B-ord", price=Decimal("60.00"))
    req = _create_req(product_b.id)

    with pytest.raises(NotFound):
        await svc.create_order(db, store_id=store_a.id, user_id=user_a.id, req=req)


@pytest.mark.asyncio
async def test_pay_order(db, store_a, user_a, product_a):
    """pay_order transitions PENDING → PAID and records the payment method."""
    order = await svc.create_order(db, store_id=store_a.id, user_id=user_a.id, req=_create_req(product_a.id))
    paid = await svc.pay_order(
        db,
        store_id=store_a.id,
        order_id=order.id,
        req=PayOrderRequest(payment_method=PaymentMethod.CASH),
    )
    assert paid.status == OrderStatus.PAID
    assert paid.payment_method == PaymentMethod.CASH


@pytest.mark.asyncio
async def test_pay_already_paid_raises(db, store_a, user_a, product_a):
    """Paying an already-paid order raises Conflict."""
    order = await svc.create_order(db, store_id=store_a.id, user_id=user_a.id, req=_create_req(product_a.id))
    pay_req = PayOrderRequest(payment_method=PaymentMethod.CASH)
    await svc.pay_order(db, store_id=store_a.id, order_id=order.id, req=pay_req)

    with pytest.raises(Conflict):
        await svc.pay_order(db, store_id=store_a.id, order_id=order.id, req=pay_req)


@pytest.mark.asyncio
async def test_status_transitions_happy_path(db, store_a, user_a, product_a):
    """PAID → IN_PROGRESS → READY → COMPLETED all succeed."""
    order = await svc.create_order(db, store_id=store_a.id, user_id=user_a.id, req=_create_req(product_a.id))
    await svc.pay_order(db, store_id=store_a.id, order_id=order.id, req=PayOrderRequest(payment_method=PaymentMethod.CARD))

    for next_status in (OrderStatus.IN_PROGRESS, OrderStatus.READY, OrderStatus.COMPLETED):
        order = await svc.update_status(
            db, store_id=store_a.id, order_id=order.id, req=UpdateStatusRequest(status=next_status)
        )
        assert order.status == next_status


@pytest.mark.asyncio
async def test_invalid_status_transition_raises(db, store_a, user_a, product_a):
    """Skipping a KDS step raises Conflict."""
    order = await svc.create_order(db, store_id=store_a.id, user_id=user_a.id, req=_create_req(product_a.id))
    await svc.pay_order(db, store_id=store_a.id, order_id=order.id, req=PayOrderRequest(payment_method=PaymentMethod.CASH))

    with pytest.raises(Conflict):
        await svc.update_status(
            db, store_id=store_a.id, order_id=order.id, req=UpdateStatusRequest(status=OrderStatus.COMPLETED)
        )


@pytest.mark.asyncio
async def test_void_reverses_stock(db, store_a, user_a, manager_a, product_a, inv_beans):
    """Voiding an order restores deducted inventory and writes ADJUST movements."""
    from app.models.catalog import RecipeItem

    existing = list((await db.execute(
        select(RecipeItem).where(
            RecipeItem.product_id == product_a.id,
            RecipeItem.inventory_item_id == inv_beans.id,
        )
    )).scalars())
    if not existing:
        db.add(RecipeItem(product_id=product_a.id, inventory_item_id=inv_beans.id, quantity=Decimal("10")))
        await db.commit()

    order = await svc.create_order(db, store_id=store_a.id, user_id=user_a.id, req=_create_req(product_a.id))
    await db.refresh(inv_beans)
    stock_after_sale = inv_beans.stock_on_hand

    await svc.void_order(
        db, store_id=store_a.id, order_id=order.id, user_id=manager_a.id, req=VoidOrderRequest(reason="test void")
    )
    await db.refresh(inv_beans)
    assert inv_beans.stock_on_hand > stock_after_sale

    adjust_movements = list((await db.execute(
        select(StockMovement).where(
            StockMovement.ref_order_id == order.id,
            StockMovement.type == MovementType.ADJUST,
        )
    )).scalars())
    assert len(adjust_movements) >= 1


@pytest.mark.asyncio
async def test_void_already_voided_raises(db, store_a, user_a, manager_a, product_a):
    """Voiding an already-voided order raises Conflict."""
    order = await svc.create_order(db, store_id=store_a.id, user_id=user_a.id, req=_create_req(product_a.id))
    await svc.void_order(db, store_id=store_a.id, order_id=order.id, user_id=manager_a.id, req=VoidOrderRequest())

    with pytest.raises(Conflict):
        await svc.void_order(db, store_id=store_a.id, order_id=order.id, user_id=manager_a.id, req=VoidOrderRequest())


@pytest.mark.asyncio
async def test_get_order_not_found(db, store_a):
    """Fetching a non-existent order raises NotFound."""
    with pytest.raises(NotFound):
        await svc.get_order(db, store_id=store_a.id, order_id="nonexistent000000000000")


@pytest.mark.asyncio
async def test_list_orders_filters_by_store(db, store_a, store_b, user_a, user_b, product_a):
    """list_orders only returns orders belonging to the requested store."""
    product_b = await make_product(db, store_id=store_b.id, name="Tea-B-ord", price=Decimal("40.00"))
    await svc.create_order(db, store_id=store_a.id, user_id=user_a.id, req=_create_req(product_a.id))
    await svc.create_order(db, store_id=store_b.id, user_id=user_b.id, req=_create_req(product_b.id))

    page = await svc.list_orders(db, store_id=store_a.id)
    for order in page.items:
        assert order.store_id == store_a.id
