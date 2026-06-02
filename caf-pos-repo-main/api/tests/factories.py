"""Factory helpers for test data creation.

Re-exports the make_* helpers from conftest and adds make_customer and
make_order_direct for modules that need those entities without going through
the full service layer (e.g. report tests that just need seeded rows).
"""
import secrets
from decimal import Decimal

from sqlalchemy.ext.asyncio import AsyncSession

from app.enums import Channel, OrderStatus, ProductType
from app.models import Customer, Product
from app.models.catalog import RecipeItem
from app.models.orders import Order, OrderItem
from app.models.production import ProductionOrder

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


async def make_produced_product(
    db: AsyncSession,
    *,
    store_id: str,
    name: str = "Cookies",
    price: Decimal = Decimal("25.00"),
    servings_per_batch: int = 12,
) -> Product:
    """Creates a PRODUCED product and auto-pairs its finished-goods InventoryItem."""
    from app.schemas.catalog import ProductCreate
    from app.services import catalog as svc

    payload = ProductCreate(
        name=name,
        price=price,
        product_type=ProductType.PRODUCED,
        servings_per_batch=servings_per_batch,
    )
    return await svc.create_product(db, store_id=store_id, payload=payload)


async def make_recipe_item(
    db: AsyncSession,
    *,
    product_id: str,
    inventory_item_id: str,
    quantity: Decimal = Decimal("1.000"),
) -> RecipeItem:
    recipe_item = RecipeItem(
        product_id=product_id,
        inventory_item_id=inventory_item_id,
        quantity=quantity,
    )
    db.add(recipe_item)
    await db.commit()
    return recipe_item


async def make_production_order(
    db: AsyncSession,
    *,
    store_id: str,
    product_id: str,
    produced_by: str,
    batches_count: int = 1,
    notes: str | None = None,
) -> ProductionOrder:
    """Records a production run, deducting ingredients and adding finished goods."""
    from app.schemas.production import ProductionOrderCreate
    from app.services import production as svc

    payload = ProductionOrderCreate(
        product_id=product_id,
        batches_count=batches_count,
        notes=notes,
    )
    return await svc.create_production_order(
        db, store_id=store_id, user_id=produced_by, payload=payload
    )
