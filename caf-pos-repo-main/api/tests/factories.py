"""Factory helpers for test data creation.

Re-exports the make_* helpers from conftest and adds make_customer and
make_order_direct for modules that need those entities without going through
the full service layer (e.g. report tests that just need seeded rows).
"""
import secrets
from decimal import Decimal

from sqlalchemy.ext.asyncio import AsyncSession

from app.enums import Channel, OrderStatus
from app.models import Customer
from app.models.orders import Order, OrderItem

# Re-export conftest helpers so test modules can import from one place.
from tests.conftest import (  # noqa: F401
    make_category,
    make_item,
    make_modifier_group,
    make_product,
    make_user,
)


async def make_customer(
    db: AsyncSession,
    *,
    store_id: str,
    name: str = "Test Customer",
    phone: str | None = None,
    email: str | None = None,
    notes: str | None = None,
    is_active: bool = True,
) -> Customer:
    customer = Customer(
        store_id=store_id,
        name=name,
        phone=phone,
        email=email,
        notes=notes,
        is_active=is_active,
    )
    db.add(customer)
    await db.commit()
    return customer


async def make_order_direct(
    db: AsyncSession,
    *,
    store_id: str,
    created_by_id: str,
    total: Decimal = Decimal("100.00"),
    subtotal: Decimal | None = None,
    status: OrderStatus = OrderStatus.PAID,
    channel: Channel = Channel.DINE_IN,
    customer_id: str | None = None,
    idempotency_key: str | None = None,
) -> Order:
    """Insert an Order row directly, bypassing the service layer.

    Useful for seeding report tests where BOM logic and Pusher events are
    not relevant to what's being tested.
    """
    order = Order(
        store_id=store_id,
        created_by_id=created_by_id,
        status=status,
        channel=channel,
        customer_id=customer_id,
        idempotency_key=idempotency_key or secrets.token_hex(8),
        subtotal=subtotal if subtotal is not None else total,
        total=total,
    )
    db.add(order)
    await db.commit()
    return order


async def make_order_item(
    db: AsyncSession,
    *,
    order_id: str,
    product_name: str = "Latte",
    quantity: int = 1,
    unit_price: Decimal = Decimal("85.00"),
    product_id: str | None = None,
) -> OrderItem:
    item = OrderItem(
        order_id=order_id,
        product_id=product_id,
        product_name=product_name,
        quantity=quantity,
        unit_price=unit_price,
        line_total=unit_price * quantity,
    )
    db.add(item)
    await db.commit()
    return item
