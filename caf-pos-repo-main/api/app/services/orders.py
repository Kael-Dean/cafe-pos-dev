import logging
from datetime import datetime
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Conflict, NotFound
from app.enums import MovementType, OrderStatus
from app.models.catalog import Modifier, Product, RecipeItem
from app.models.inventory import InventoryItem, StockMovement
from app.models.orders import Order, OrderItem, OrderVoidLog
from app.realtime.pusher import PusherClient
from app.schemas.orders import (
    CreateOrderRequest,
    OrderItemRead,
    OrderRead,
    OrdersPage,
    PayOrderRequest,
    UpdateStatusRequest,
    VoidOrderRequest,
)

logger = logging.getLogger(__name__)

_DEFAULT_PAGE = 50
_MAX_PAGE = 200

_VALID_TRANSITIONS: dict[OrderStatus, set[OrderStatus]] = {
    OrderStatus.PAID: {OrderStatus.IN_PROGRESS},
    OrderStatus.IN_PROGRESS: {OrderStatus.READY},
    OrderStatus.READY: {OrderStatus.COMPLETED},
}


async def create_order(
    db: AsyncSession,
    pusher: PusherClient | None = None,
    *,
    store_id: str,
    user_id: str,
    req: CreateOrderRequest,
) -> Order:
    try:
        async with db.begin():
            existing = await _find_by_idempotency(db, store_id=store_id, key=req.idempotency_key)
            if existing:
                raise Conflict("Duplicate idempotency_key — order already exists")
            line_data = []
            grand_total = Decimal("0")

            for item_in in req.items:
                product = await _load_product(db, store_id=store_id, product_id=item_in.product_id)
                modifiers, mod_inv = await _load_modifiers(db, modifier_ids=item_in.modifier_ids)

                price_delta = sum((m.price_delta for m in modifiers), Decimal("0"))
                unit_price = product.price + price_delta
                grand_total += unit_price * item_in.quantity

                line_data.append({
                    "product_id": product.id,
                    "product_name": product.name,
                    "quantity": item_in.quantity,
                    "unit_price": unit_price,
                    "line_total": unit_price * item_in.quantity,
                    "modifiers_json": _snapshot_modifiers(modifiers) if modifiers else None,
                    "mod_inv": mod_inv,
                })

            order = Order(
                store_id=store_id,
                status=OrderStatus.PENDING,
                channel=req.channel,
                idempotency_key=req.idempotency_key,
                customer_id=req.customer_id,
                customer_note=req.customer_note,
                subtotal=grand_total,
                total=grand_total,
                created_by_id=user_id,
            )
            db.add(order)
            await db.flush()

            inv_deductions: dict[str, Decimal] = {}

            for ld in line_data:
                db.add(OrderItem(
                    order_id=order.id,
                    product_id=ld["product_id"],
                    product_name=ld["product_name"],
                    quantity=ld["quantity"],
                    unit_price=ld["unit_price"],
                    line_total=ld["line_total"],
                    modifiers_json=ld["modifiers_json"],
                ))

                for ri in await _load_recipe(db, product_id=ld["product_id"]):
                    qty = ri.quantity * ld["quantity"]
                    inv_deductions[ri.inventory_item_id] = inv_deductions.get(ri.inventory_item_id, Decimal("0")) + qty

                for inv_item_id, qty_per_unit in ld["mod_inv"]:
                    qty = qty_per_unit * ld["quantity"]
                    inv_deductions[inv_item_id] = inv_deductions.get(inv_item_id, Decimal("0")) + qty

            for inv_item_id, total_qty in inv_deductions.items():
                inv_item = await db.get(InventoryItem, inv_item_id)
                if inv_item:
                    inv_item.stock_on_hand = inv_item.stock_on_hand - total_qty
                    db.add(StockMovement(
                        store_id=store_id,
                        inventory_item_id=inv_item_id,
                        type=MovementType.SALE,
                        quantity=total_qty,
                        reason=f"Order #{order.order_number}",
                        ref_order_id=order.id,
                        created_by_id=user_id,
                    ))

    except IntegrityError:
        raise Conflict("Duplicate idempotency_key — order already exists")

    await _publish_order_created(pusher, order, line_data)
    return order


async def list_orders(
    db: AsyncSession,
    *,
    store_id: str,
    status: list[OrderStatus] | None = None,
    customer_id: str | None = None,
    from_dt: datetime | None = None,
    to_dt: datetime | None = None,
    page: int = 1,
    limit: int = _DEFAULT_PAGE,
) -> OrdersPage:
    if limit <= 0 or limit > _MAX_PAGE:
        limit = _DEFAULT_PAGE
    offset = (max(page, 1) - 1) * limit

    stmt = select(Order).where(Order.store_id == store_id)
    if status:
        stmt = stmt.where(Order.status.in_(status))
    if customer_id:
        stmt = stmt.where(Order.customer_id == customer_id)
    if from_dt:
        stmt = stmt.where(Order.created_at >= from_dt)
    if to_dt:
        stmt = stmt.where(Order.created_at <= to_dt)

    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = list((await db.execute(stmt.order_by(Order.created_at.desc()).offset(offset).limit(limit))).scalars())
    items = [await _order_to_read(db, o) for o in rows]
    return OrdersPage(items=items, total=total, page=page, limit=limit)


async def get_order(db: AsyncSession, *, store_id: str, order_id: str) -> OrderRead:
    order = await _load_order(db, store_id=store_id, order_id=order_id)
    return await _order_to_read(db, order)


async def pay_order(
    db: AsyncSession,
    *,
    store_id: str,
    order_id: str,
    req: PayOrderRequest,
) -> Order:
    async with db.begin():
        order = await _load_order(db, store_id=store_id, order_id=order_id)
        if order.status != OrderStatus.PENDING:
            raise Conflict(f"Cannot pay an order with status {order.status.value}")
        order.status = OrderStatus.PAID
        order.payment_method = req.payment_method
        order.payment_ref = req.payment_ref
    return order


async def update_status(
    db: AsyncSession,
    pusher: PusherClient | None = None,
    *,
    store_id: str,
    order_id: str,
    req: UpdateStatusRequest,
) -> Order:
    async with db.begin():
        order = await _load_order(db, store_id=store_id, order_id=order_id)
        previous = order.status
        allowed = _VALID_TRANSITIONS.get(order.status, set())
        if req.status not in allowed:
            raise Conflict(f"Cannot transition {order.status.value} → {req.status.value}")
        order.status = req.status

    await _publish_status_changed(pusher, order, previous=previous)
    return order


async def void_order(
    db: AsyncSession,
    pusher: PusherClient | None = None,
    *,
    store_id: str,
    order_id: str,
    user_id: str,
    req: VoidOrderRequest,
) -> Order:
    async with db.begin():
        order = await _load_order(db, store_id=store_id, order_id=order_id)
        if order.status == OrderStatus.VOID:
            raise Conflict("Order is already voided")

        sale_movements = list((await db.execute(
            select(StockMovement).where(
                StockMovement.ref_order_id == order.id,
                StockMovement.type == MovementType.SALE,
            )
        )).scalars())

        for mv in sale_movements:
            inv_item = await db.get(InventoryItem, mv.inventory_item_id)
            if inv_item:
                inv_item.stock_on_hand = inv_item.stock_on_hand + mv.quantity
            db.add(StockMovement(
                store_id=store_id,
                inventory_item_id=mv.inventory_item_id,
                type=MovementType.ADJUST,
                quantity=mv.quantity,
                reason=f"VOID|Order #{order.order_number}",
                ref_order_id=order.id,
                created_by_id=user_id,
            ))

        order.status = OrderStatus.VOID
        db.add(OrderVoidLog(order_id=order.id, voided_by_id=user_id, reason=req.reason))

    await _publish_order_voided(pusher, order, user_id=user_id, reason=req.reason)
    return order


# -- helpers ----------------------------------------------------------------


async def _load_order(db: AsyncSession, *, store_id: str, order_id: str) -> Order:
    result = await db.execute(
        select(Order).where(Order.id == order_id, Order.store_id == store_id)
    )
    order = result.scalar_one_or_none()
    if not order:
        raise NotFound("Order not found")
    return order


async def _find_by_idempotency(db: AsyncSession, *, store_id: str, key: str) -> Order | None:
    result = await db.execute(
        select(Order).where(Order.store_id == store_id, Order.idempotency_key == key)
    )
    return result.scalar_one_or_none()


async def _load_product(db: AsyncSession, *, store_id: str, product_id: str) -> Product:
    result = await db.execute(
        select(Product).where(
            Product.id == product_id,
            Product.store_id == store_id,
            Product.is_active.is_(True),
        )
    )
    product = result.scalar_one_or_none()
    if not product:
        raise NotFound(f"Product {product_id} not found or inactive")
    return product


async def _load_modifiers(
    db: AsyncSession, *, modifier_ids: list[str]
) -> tuple[list[Modifier], list[tuple[str, Decimal]]]:
    if not modifier_ids:
        return [], []
    result = await db.execute(select(Modifier).where(Modifier.id.in_(modifier_ids)))
    modifiers = list(result.scalars())
    inv_deductions = [
        (m.inventory_item_id, m.inventory_qty)
        for m in modifiers
        if m.inventory_item_id and m.inventory_qty
    ]
    return modifiers, inv_deductions


async def _load_recipe(db: AsyncSession, *, product_id: str) -> list[RecipeItem]:
    result = await db.execute(select(RecipeItem).where(RecipeItem.product_id == product_id))
    return list(result.scalars())


async def _order_to_read(db: AsyncSession, order: Order) -> OrderRead:
    result = await db.execute(select(OrderItem).where(OrderItem.order_id == order.id))
    items = [OrderItemRead.model_validate(oi) for oi in result.scalars()]
    return OrderRead(
        id=order.id,
        order_number=order.order_number,
        store_id=order.store_id,
        customer_id=order.customer_id,
        status=order.status,
        channel=order.channel,
        payment_method=order.payment_method,
        payment_ref=order.payment_ref,
        customer_note=order.customer_note,
        subtotal=order.subtotal,
        discount=order.discount,
        tax=order.tax,
        total=order.total,
        created_by_id=order.created_by_id,
        items=items,
        created_at=order.created_at,
        updated_at=order.updated_at,
    )


def _snapshot_modifiers(modifiers: list[Modifier]) -> dict:
    return {
        "modifiers": [
            {
                "id": m.id,
                "name": m.name,
                "price_delta": str(m.price_delta),
                "inventory_item_id": m.inventory_item_id,
                "inventory_qty": str(m.inventory_qty) if m.inventory_qty else None,
            }
            for m in modifiers
        ]
    }


async def _publish_order_created(pusher: PusherClient, order: Order, line_data: list[dict]) -> None:
    try:
        await pusher.publish(
            f"kds-store-{order.store_id}",
            "order.created",
            {
                "order_id": order.id,
                "order_number": order.order_number,
                "status": order.status.value,
                "channel": order.channel.value,
                "items": [
                    {"product_name": ld["product_name"], "quantity": ld["quantity"]}
                    for ld in line_data
                ],
            },
        )
    except Exception:
        logger.warning("pusher.order_created.failed", extra={"order_id": order.id})


async def _publish_status_changed(pusher: PusherClient, order: Order, *, previous: OrderStatus) -> None:
    try:
        await pusher.publish(
            f"kds-store-{order.store_id}",
            "order.status_changed",
            {
                "order_id": order.id,
                "previous_status": previous.value,
                "status": order.status.value,
            },
        )
    except Exception:
        logger.warning("pusher.status_changed.failed", extra={"order_id": order.id})


async def _publish_order_voided(pusher: PusherClient, order: Order, *, user_id: str, reason: str | None) -> None:
    try:
        await pusher.publish(
            f"kds-store-{order.store_id}",
            "order.voided",
            {"order_id": order.id, "voided_by": user_id, "reason": reason},
        )
    except Exception:
        logger.warning("pusher.order_voided.failed", extra={"order_id": order.id})
