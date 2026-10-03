"""Service-layer tests for the orders module (Tier 4).

Runs against real Postgres. Uses the shared conftest fixtures for db session,
stores, users, inventory items, and products.
"""

import secrets
from datetime import date, timedelta
from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.core.errors import Conflict, NotFound, Unprocessable
from app.enums import Channel, MovementType, OrderStatus, PaymentMethod, WastageReason
from app.models.inventory import StockMovement
from app.schemas.orders import (
    CreateOrderRequest,
    OrderItemIn,
    PayOrderRequest,
    SetOrderDateRequest,
    UpdateStatusRequest,
    VoidOrderRequest,
)
from app.services import orders as svc
from tests.conftest import make_category, make_item, make_product
from tests.factories import make_produced_product

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


@pytest_asyncio.fixture
async def category_a(db, store_a):
    return await make_category(db, store_id=store_a.id, name="Drinks-ord")


@pytest_asyncio.fixture
async def product_a(db, store_a, category_a):
    return await make_product(
        db, store_id=store_a.id, name="Latte-ord", price=Decimal("85.00"), category_id=category_a.id
    )


@pytest_asyncio.fixture
async def inv_beans(db, store_a):
    return await make_item(
        db, store_id=store_a.id, name="Beans-ord", unit="g", stock=Decimal("500"), par=Decimal("100")
    )


# ---------- tests ----------


async def test_create_order_basic(db, store_a, user_a, product_a):
    """Order creation returns a PENDING order with the correct total."""
    req = _create_req(product_a.id)
    order = await svc.create_order(db, store_id=store_a.id, user_id=user_a.id, req=req)

    assert order.status == OrderStatus.PENDING
    assert order.total == product_a.price
    assert order.store_id == store_a.id
    assert order.order_number >= 1001


async def test_create_order_deducts_inventory(db, store_a, user_a, product_a, inv_beans):
    """Creating an order with a recipe deducts stock and writes a SALE movement."""
    from app.models.catalog import RecipeItem

    recipe_qty = Decimal("18")
    db.add(RecipeItem(product_id=product_a.id, inventory_item_id=inv_beans.id, quantity=recipe_qty))
    await db.commit()

    await db.refresh(inv_beans)
    stock_before = inv_beans.stock_on_hand
    await db.commit()

    req = _create_req(product_a.id, qty=2)
    order = await svc.create_order(db, store_id=store_a.id, user_id=user_a.id, req=req)

    await db.refresh(inv_beans)
    assert inv_beans.stock_on_hand == stock_before - (recipe_qty * 2)

    movements = list(
        (
            await db.execute(
                select(StockMovement).where(
                    StockMovement.ref_order_id == order.id,
                    StockMovement.type == MovementType.SALE,
                )
            )
        ).scalars()
    )
    assert len(movements) == 1
    assert movements[0].quantity == recipe_qty * 2


async def test_create_order_idempotency(db, store_a, user_a, product_a):
    """Duplicate idempotency key raises Conflict."""
    req = _create_req(product_a.id)
    await svc.create_order(db, store_id=store_a.id, user_id=user_a.id, req=req)

    with pytest.raises(Conflict):
        await svc.create_order(db, store_id=store_a.id, user_id=user_a.id, req=req)


async def test_create_order_cross_store_product_rejected(db, store_a, store_b, user_a, user_b):
    """Product from store B cannot be ordered in store A context."""
    product_b = await make_product(db, store_id=store_b.id, name="Espresso-B-ord", price=Decimal("60.00"))
    req = _create_req(product_b.id)

    with pytest.raises(NotFound):
        await svc.create_order(db, store_id=store_a.id, user_id=user_a.id, req=req)


async def test_pay_order(db, store_a, user_a, product_a):
    """pay_order transitions PENDING â†’ PAID and records the payment method."""
    order = await svc.create_order(db, store_id=store_a.id, user_id=user_a.id, req=_create_req(product_a.id))
    paid = await svc.pay_order(
        db,
        store_id=store_a.id,
        order_id=order.id,
        req=PayOrderRequest(payment_method=PaymentMethod.CASH),
    )
    assert paid.status == OrderStatus.PAID
    assert paid.payment_method == PaymentMethod.CASH


async def test_pay_already_paid_raises(db, store_a, user_a, product_a):
    """Paying an already-paid order raises Conflict."""
    order = await svc.create_order(db, store_id=store_a.id, user_id=user_a.id, req=_create_req(product_a.id))
    pay_req = PayOrderRequest(payment_method=PaymentMethod.CASH)
    await svc.pay_order(db, store_id=store_a.id, order_id=order.id, req=pay_req)

    with pytest.raises(Conflict):
        await svc.pay_order(db, store_id=store_a.id, order_id=order.id, req=pay_req)


async def test_status_transitions_happy_path(db, store_a, user_a, product_a):
    """PAID â†’ IN_PROGRESS â†’ READY â†’ COMPLETED all succeed."""
    order = await svc.create_order(db, store_id=store_a.id, user_id=user_a.id, req=_create_req(product_a.id))
    await svc.pay_order(
        db, store_id=store_a.id, order_id=order.id, req=PayOrderRequest(payment_method=PaymentMethod.CARD)
    )

    for next_status in (OrderStatus.IN_PROGRESS, OrderStatus.READY, OrderStatus.COMPLETED):
        order = await svc.update_status(
            db, store_id=store_a.id, order_id=order.id, req=UpdateStatusRequest(status=next_status)
        )
        assert order.status == next_status


async def test_invalid_status_transition_raises(db, store_a, user_a, product_a):
    """Skipping a KDS step raises Conflict."""
    order = await svc.create_order(db, store_id=store_a.id, user_id=user_a.id, req=_create_req(product_a.id))
    await svc.pay_order(
        db, store_id=store_a.id, order_id=order.id, req=PayOrderRequest(payment_method=PaymentMethod.CASH)
    )

    with pytest.raises(Conflict):
        await svc.update_status(
            db, store_id=store_a.id, order_id=order.id, req=UpdateStatusRequest(status=OrderStatus.COMPLETED)
        )


async def test_void_reverses_stock(db, store_a, user_a, manager_a, product_a, inv_beans):
    """Voiding an order restores deducted inventory and writes ADJUST movements."""
    from app.models.catalog import RecipeItem

    existing = list(
        (
            await db.execute(
                select(RecipeItem).where(
                    RecipeItem.product_id == product_a.id,
                    RecipeItem.inventory_item_id == inv_beans.id,
                )
            )
        ).scalars()
    )
    if not existing:
        db.add(RecipeItem(product_id=product_a.id, inventory_item_id=inv_beans.id, quantity=Decimal("10")))
        await db.commit()

    order = await svc.create_order(db, store_id=store_a.id, user_id=user_a.id, req=_create_req(product_a.id))
    await db.refresh(inv_beans)
    stock_after_sale = inv_beans.stock_on_hand
    await db.commit()

    await svc.void_order(
        db,
        store_id=store_a.id,
        order_id=order.id,
        user_id=manager_a.id,
        req=VoidOrderRequest(reason="test void"),
    )
    await db.refresh(inv_beans)
    assert inv_beans.stock_on_hand > stock_after_sale

    adjust_movements = list(
        (
            await db.execute(
                select(StockMovement).where(
                    StockMovement.ref_order_id == order.id,
                    StockMovement.type == MovementType.ADJUST,
                )
            )
        ).scalars()
    )
    assert len(adjust_movements) >= 1


async def test_void_already_voided_raises(db, store_a, user_a, manager_a, product_a):
    """Voiding an already-voided order raises Conflict."""
    order = await svc.create_order(db, store_id=store_a.id, user_id=user_a.id, req=_create_req(product_a.id))
    await svc.void_order(
        db, store_id=store_a.id, order_id=order.id, user_id=manager_a.id, req=VoidOrderRequest()
    )

    with pytest.raises(Conflict):
        await svc.void_order(
            db, store_id=store_a.id, order_id=order.id, user_id=manager_a.id, req=VoidOrderRequest()
        )


async def test_void_no_restock_writes_off_as_waste(db, store_a, user_a, manager_a, product_a, inv_beans):
    """Voiding with restock=False keeps stock down and records the loss as WASTE.

    Simulates a test/wrong order that was already prepared: the ingredients were
    physically used, so they must not be returned to inventory.
    """
    from app.models.catalog import RecipeItem

    existing = list(
        (
            await db.execute(
                select(RecipeItem).where(
                    RecipeItem.product_id == product_a.id,
                    RecipeItem.inventory_item_id == inv_beans.id,
                )
            )
        ).scalars()
    )
    if not existing:
        db.add(RecipeItem(product_id=product_a.id, inventory_item_id=inv_beans.id, quantity=Decimal("10")))
        await db.commit()

    order = await svc.create_order(db, store_id=store_a.id, user_id=user_a.id, req=_create_req(product_a.id))
    await db.refresh(inv_beans)
    stock_after_sale = inv_beans.stock_on_hand
    await db.commit()

    await svc.void_order(
        db,
        store_id=store_a.id,
        order_id=order.id,
        user_id=manager_a.id,
        req=VoidOrderRequest(reason="test order, already made", restock=False),
    )
    await db.refresh(inv_beans)

    # Net inventory stays at the post-sale level — ingredients consumed, not returned.
    assert inv_beans.stock_on_hand == stock_after_sale

    waste = list(
        (
            await db.execute(
                select(StockMovement).where(
                    StockMovement.ref_order_id == order.id,
                    StockMovement.type == MovementType.WASTE,
                )
            )
        ).scalars()
    )
    assert len(waste) >= 1
    # The sale is still reversed with an ADJUST; the WASTE re-consumes the same qty.
    adjust = list(
        (
            await db.execute(
                select(StockMovement).where(
                    StockMovement.ref_order_id == order.id,
                    StockMovement.type == MovementType.ADJUST,
                )
            )
        ).scalars()
    )
    assert len(adjust) >= 1


async def test_void_request_defaults_to_restock():
    """Omitting restock defaults to True — preserves legacy void behavior."""
    assert VoidOrderRequest().restock is True


@pytest.mark.parametrize("stage", [OrderStatus.IN_PROGRESS, OrderStatus.READY, OrderStatus.COMPLETED])
async def test_void_allowed_at_any_stage(db, store_a, user_a, manager_a, product_a, stage):
    """An order can be voided even after it has progressed through the kitchen."""
    order = await svc.create_order(db, store_id=store_a.id, user_id=user_a.id, req=_create_req(product_a.id))
    await svc.pay_order(
        db, store_id=store_a.id, order_id=order.id, req=PayOrderRequest(payment_method=PaymentMethod.CASH)
    )
    for s in (OrderStatus.IN_PROGRESS, OrderStatus.READY, OrderStatus.COMPLETED):
        await svc.update_status(db, store_id=store_a.id, order_id=order.id, req=UpdateStatusRequest(status=s))
        if s == stage:
            break

    voided = await svc.void_order(
        db, store_id=store_a.id, order_id=order.id, user_id=manager_a.id, req=VoidOrderRequest()
    )
    assert voided.status == OrderStatus.VOID


async def test_get_order_not_found(db, store_a):
    """Fetching a non-existent order raises NotFound."""
    with pytest.raises(NotFound):
        await svc.get_order(db, store_id=store_a.id, order_id="nonexistent000000000000")


async def test_list_orders_filters_by_store(db, store_a, store_b, user_a, user_b, product_a):
    """list_orders only returns orders belonging to the requested store."""
    product_b = await make_product(db, store_id=store_b.id, name="Tea-B-ord", price=Decimal("40.00"))
    await svc.create_order(db, store_id=store_a.id, user_id=user_a.id, req=_create_req(product_a.id))
    await svc.create_order(db, store_id=store_b.id, user_id=user_b.id, req=_create_req(product_b.id))

    page = await svc.list_orders(db, store_id=store_a.id)
    for order in page.items:
        assert order.store_id == store_a.id


# ---------------------------------------------------------------------------
# PRODUCED product — stock deduction branches
# ---------------------------------------------------------------------------


def uid(prefix: str = "") -> str:
    return f"{prefix}{secrets.token_hex(4)}"


async def test_ordering_produced_product_deducts_finished_goods_not_ingredients(db, store_a, user_a):
    from app.models.catalog import RecipeItem
    from app.models.inventory import InventoryItem
    from app.services import orders as order_svc

    # Create raw ingredient with stock
    flour = await make_item(db, store_id=store_a.id, name=f"Flour-{uid()}", stock=Decimal("500"))

    # Create PRODUCED product with recipe and 50 finished goods in stock
    cookies = await make_produced_product(
        db, store_id=store_a.id, name=f"Cookie-{uid()}", servings_per_batch=12
    )

    # Add recipe: 300g flour per batch
    db.add(
        RecipeItem(
            product_id=cookies.id,
            inventory_item_id=flour.id,
            quantity=Decimal("300"),
        )
    )
    await db.commit()

    # Seed finished goods stock
    result = await db.execute(select(InventoryItem).where(InventoryItem.id == cookies.finished_goods_item_id))
    fg_item = result.scalar_one()
    fg_item.stock_on_hand = Decimal("50")
    await db.commit()

    req = CreateOrderRequest(
        items=[OrderItemIn(product_id=cookies.id, quantity=3, modifier_ids=[])],
        channel="DINE_IN",
        idempotency_key=uid("ord-"),
    )
    await order_svc.create_order(db, store_id=store_a.id, user_id=user_a.id, req=req)

    # Finished goods should be decremented by 3
    await db.refresh(fg_item)
    assert fg_item.stock_on_hand == Decimal("47")

    # Raw flour should NOT be touched
    await db.refresh(flour)
    assert flour.stock_on_hand == Decimal("500")


async def test_ordering_made_to_order_still_deducts_recipe_ingredients(db, store_a, user_a):
    from app.models.catalog import RecipeItem
    from app.services import orders as order_svc

    milk = await make_item(db, store_id=store_a.id, name=f"Milk-{uid()}", stock=Decimal("1000"))
    product = await make_product(db, store_id=store_a.id, name=f"Latte-{uid()}")

    db.add(
        RecipeItem(
            product_id=product.id,
            inventory_item_id=milk.id,
            quantity=Decimal("200"),
        )
    )
    await db.commit()

    req = CreateOrderRequest(
        items=[OrderItemIn(product_id=product.id, quantity=2, modifier_ids=[])],
        channel="DINE_IN",
        idempotency_key=uid("ord-"),
    )
    await order_svc.create_order(db, store_id=store_a.id, user_id=user_a.id, req=req)

    await db.refresh(milk)
    assert milk.stock_on_hand == Decimal("600")  # 1000 - (200 × 2)


# ---------------------------------------------------------------------------
# Canceled-order write-off uses WastageReason.CANCELED + carries the reason
# ---------------------------------------------------------------------------


async def test_void_no_restock_uses_canceled_reason_with_note(
    db, store_a, user_a, manager_a, product_a, inv_beans
):
    """A no-restock void writes the waste off as CANCELED and embeds req.reason."""
    from app.models.catalog import RecipeItem

    db.add(RecipeItem(product_id=product_a.id, inventory_item_id=inv_beans.id, quantity=Decimal("10")))
    await db.commit()

    order = await svc.create_order(db, store_id=store_a.id, user_id=user_a.id, req=_create_req(product_a.id))
    await db.commit()

    await svc.void_order(
        db,
        store_id=store_a.id,
        order_id=order.id,
        user_id=manager_a.id,
        req=VoidOrderRequest(reason="ลูกค้าสั่งผิด", restock=False),
    )

    waste = list(
        (
            await db.execute(
                select(StockMovement).where(
                    StockMovement.ref_order_id == order.id,
                    StockMovement.type == MovementType.WASTE,
                )
            )
        ).scalars()
    )
    assert waste
    for mv in waste:
        head, _, note = mv.reason.partition("|")
        assert head == WastageReason.CANCELED.value
        assert "ลูกค้าสั่งผิด" in note


# ---------------------------------------------------------------------------
# Backdate an order — set_order_date
# ---------------------------------------------------------------------------


async def test_set_order_date_backdates_order(db, store_a, user_a, product_a):
    """Backdating recomputes business_date, daily_number, receipt_no, created_at."""
    order = await svc.create_order(db, store_id=store_a.id, user_id=user_a.id, req=_create_req(product_a.id))

    past = date.today() - timedelta(days=5)
    updated = await svc.set_order_date(
        db, store_id=store_a.id, order_id=order.id, req=SetOrderDateRequest(business_date=past)
    )

    assert updated.business_date == past
    assert updated.daily_number == 1  # first order claimed for that fresh day
    assert updated.receipt_no == svc.make_receipt_no(past, 1)
    assert updated.created_at.astimezone(svc.STORE_TZ).date() == past


async def test_set_order_date_future_raises(db, store_a, user_a, product_a):
    """A future date can't be set (you can't pre-date a sale)."""
    order = await svc.create_order(db, store_id=store_a.id, user_id=user_a.id, req=_create_req(product_a.id))
    future = date.today() + timedelta(days=1)

    with pytest.raises(Unprocessable):
        await svc.set_order_date(
            db, store_id=store_a.id, order_id=order.id, req=SetOrderDateRequest(business_date=future)
        )


async def test_set_order_date_voided_raises(db, store_a, user_a, manager_a, product_a):
    """A voided order's date can't be changed."""
    order = await svc.create_order(db, store_id=store_a.id, user_id=user_a.id, req=_create_req(product_a.id))
    await svc.void_order(
        db, store_id=store_a.id, order_id=order.id, user_id=manager_a.id, req=VoidOrderRequest()
    )

    with pytest.raises(Conflict):
        await svc.set_order_date(
            db,
            store_id=store_a.id,
            order_id=order.id,
            req=SetOrderDateRequest(business_date=date.today() - timedelta(days=1)),
        )


async def test_set_order_date_shifts_stock_movements(db, store_a, user_a, product_a, inv_beans):
    """The order's stock movements move to the new day (inventory reports follow)."""
    from app.models.catalog import RecipeItem

    db.add(RecipeItem(product_id=product_a.id, inventory_item_id=inv_beans.id, quantity=Decimal("10")))
    await db.commit()

    order = await svc.create_order(db, store_id=store_a.id, user_id=user_a.id, req=_create_req(product_a.id))
    await db.commit()

    past = date.today() - timedelta(days=3)
    await svc.set_order_date(
        db, store_id=store_a.id, order_id=order.id, req=SetOrderDateRequest(business_date=past)
    )

    movements = list(
        (await db.execute(select(StockMovement).where(StockMovement.ref_order_id == order.id))).scalars()
    )
    assert movements
    for mv in movements:
        assert mv.created_at.astimezone(svc.STORE_TZ).date() == past
