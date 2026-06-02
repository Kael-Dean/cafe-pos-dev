import logging
from datetime import date as _date
from datetime import datetime
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Conflict, NotFound
from app.enums import MovementType, OrderStatus, ProductType, ReceiptStatus
from app.models.catalog import Modifier, Product, RecipeItem
from app.models.inventory import InventoryItem, StockMovement
from app.models.orders import Order, OrderItem, OrderVoidLog
from app.models.promotions import PromotionRedemption
from app.models.receipts import StockLot, StockReceipt
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
                    "category_id": product.category_id,
                    "product_name": product.name,
                    "quantity": item_in.quantity,
                    "unit_price": unit_price,
                    "line_total": unit_price * item_in.quantity,
                    "modifiers_json": _snapshot_modifiers(modifiers) if modifiers else None,
                    "mod_inv": mod_inv,
                    "product_type": product.product_type,
                    "finished_goods_item_id": product.finished_goods_item_id,
                })

            promotion_discount = Decimal("0")
            applied_promotions: list[tuple[str, Decimal]] = []
            if req.promotion_ids:
                from app.services.promotions import apply_promotions
                promo_cart_lines = [
                    {
                        "product_id": ld["product_id"],
                        "category_id": ld["category_id"],
                        "quantity": ld["quantity"],
                        "line_total": ld["line_total"],
                    }
                    for ld in line_data
                ]
                promotion_discount, applied_promotions = await apply_promotions(
                    db,
                    store_id=store_id,
                    promotion_ids=req.promotion_ids,
                    cart_lines=promo_cart_lines,
                )

            order = Order(
                store_id=store_id,
                status=OrderStatus.PENDING,
                channel=req.channel,
                idempotency_key=req.idempotency_key,
                customer_id=req.customer_id,
                customer_note=req.customer_note,
                subtotal=grand_total,
                discount=promotion_discount,
                total=grand_total - promotion_discount,
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

                if ld["product_type"] == ProductType.PRODUCED:
                    if not ld["finished_goods_item_id"]:
                        raise HTTPException(
                            status_code=500,
                            detail="PRODUCT_MISCONFIGURED: PRODUCED product has no finished_goods_item_id",
                        )
                    qty = Decimal(str(ld["quantity"]))
                    inv_deductions[ld["finished_goods_item_id"]] = (
                        inv_deductions.get(ld["finished_goods_item_id"], Decimal("0")) + qty
                    )
                else:
                    for ri in await _load_recipe(db, product_id=ld["product_id"]):
                        qty = ri.quantity * ld["quantity"]
                        inv_deductions[ri.inventory_item_id] = (
                            inv_deductions.get(ri.inventory_item_id, Decimal("0")) + qty
                        )

                for inv_item_id, qty_per_unit in ld["mod_inv"]:
                    qty = qty_per_unit * ld["quantity"]
                    inv_deductions[inv_item_id] = inv_deductions.get(inv_item_id, Decimal("0")) + qty

            for inv_item_id, total_qty in inv_deductions.items():
                await _deduct_fifo(
                    db,
                    store_id=store_id,
                    user_id=user_id,
                    inventory_item_id=inv_item_id,
                    total_qty=total_qty,
                    ref_order_id=order.id,
                    order_number=order.order_number,
                )

            # Write promotion redemption rows
            if applied_promotions:
                for promo_id, disc_amount in applied_promotions:
                    db.add(PromotionRedemption(
                        promotion_id=promo_id,
                        order_id=order.id,
                        discount_amount=disc_amount,
                    ))

            # Membership: earn or redeem (mutually exclusive)
            if req.member_id:
                from app.services.membership import (
                    _earn_points,
                    _get_active_program,
                    _load_account_for_update,
                    _redeem_reward,
                )
                await db.flush()  # ensure OrderItems are persisted for FREE_ITEM scope check
                account = await _load_account_for_update(
                    db, account_id=req.member_id, store_id=store_id
                )
                program = await _get_active_program(db, store_id=store_id)
                if program:
                    if req.redeem_reward:
                        await _redeem_reward(
                            db,
                            store_id=store_id,
                            account=account,
                            program=program,
                            order=order,
                            reward_product_id=req.reward_product_id,
                            user_id=user_id,
                        )
                        order.points_earned = 0
                    else:
                        total_items = sum(ld["quantity"] for ld in line_data)
                        earned = await _earn_points(
                            db,
                            store_id=store_id,
                            account=account,
                            program=program,
                            order=order,
                            total_items=total_items,
                            user_id=user_id,
                        )
                        order.points_earned = earned
                    order.member_id = account.id

    except IntegrityError as e:
        raise Conflict("Duplicate idempotency_key — order already exists") from e

    await _publish_order_created(pusher, order, line_data)
    return order


async def list_orders(
    db: AsyncSession,
    *,
    store_id: str,
    statuses: list[OrderStatus] | None = None,
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
    if statuses:
        stmt = stmt.where(Order.status.in_(statuses))
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

        cancel_receipt = StockReceipt(
            store_id=store_id,
            status=ReceiptStatus.CONFIRMED,
            receipt_ref="ORDER_CANCEL",
            note=f"Voided order #{order.order_number}",
            received_at=_date.today(),
            created_by_id=user_id,
        )
        db.add(cancel_receipt)
        await db.flush()

        for mv in sale_movements:
            inv_item = await db.get(InventoryItem, mv.inventory_item_id)
            if inv_item:
                inv_item.stock_on_hand = inv_item.stock_on_hand + mv.quantity
                db.add(StockLot(
                    store_id=store_id,
                    receipt_id=cancel_receipt.id,
                    inventory_item_id=mv.inventory_item_id,
                    qty_received=mv.quantity,
                    qty_remaining=mv.quantity,
                    cost_per_unit=inv_item.cost_per_unit,
                ))
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

        # Reverse membership points if applicable
        from app.services.membership import _reverse_points
        await _reverse_points(db, order=order, user_id=user_id)

    await _publish_order_voided(pusher, order, user_id=user_id, reason=req.reason)
    return order


# -- helpers ----------------------------------------------------------------


async def _deduct_fifo(
    db: AsyncSession,
    *,
    store_id: str,
    user_id: str,
    inventory_item_id: str,
    total_qty: Decimal,
    ref_order_id: str | None = None,
    order_number: int = 0,
    reason: str | None = None,
) -> None:
    inv_item = await db.get(InventoryItem, inventory_item_id)
    if not inv_item:
        return

    remaining = total_qty
    lots = list((await db.execute(
        select(StockLot)
        .where(
            StockLot.inventory_item_id == inventory_item_id,
            StockLot.store_id == store_id,
            StockLot.qty_remaining > 0,
        )
        .order_by(StockLot.created_at.asc())
    )).scalars())

    for lot in lots:
        if remaining <= 0:
            break
        consume = min(lot.qty_remaining, remaining)
        lot.qty_remaining = lot.qty_remaining - consume
        remaining -= consume

    inv_item.stock_on_hand = inv_item.stock_on_hand - total_qty
    if inv_item.stock_on_hand < 0:
        logger.warning(
            "inventory.fifo.negative_stock",
            extra={
                "inventory_item_id": inventory_item_id,
                "store_id": store_id,
                "total_qty": float(total_qty),
                "stock_on_hand": float(inv_item.stock_on_hand),
            },
        )

    db.add(StockMovement(
        store_id=store_id,
        inventory_item_id=inventory_item_id,
        type=MovementType.SALE,
        quantity=total_qty,
        reason=reason or f"Order #{order_number}",
        ref_order_id=ref_order_id,
        created_by_id=user_id,
    ))


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
