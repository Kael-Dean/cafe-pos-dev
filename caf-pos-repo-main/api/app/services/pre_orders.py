import logging
import math
from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.core.errors import Conflict, NotFound, Unprocessable
from app.enums import FulfillmentMode, PreOrderStatus, ProductType
from app.models.catalog import Product, RecipeItem
from app.models.inventory import InventoryItem
from app.models.pre_orders import PreOrder, PreOrderItem, ShoppingListItem
from app.schemas.pre_orders import (
    IngredientSummary,
    IngredientSummaryItem,
    PreOrderCreate,
    PreOrderItemIn,
    PreOrderItemRead,
    PreOrderRead,
    PreOrdersPage,
    PreOrderSummary,
    PreOrderUpdate,
)
from app.services.orders import _deduct_fifo

logger = logging.getLogger(__name__)

_DEFAULT_PAGE = 50
_MAX_PAGE = 200


async def create_pre_order(
    db: AsyncSession,
    *,
    store_id: str,
    user_id: str,
    payload: PreOrderCreate,
) -> PreOrderRead:
    if not payload.customer_id and not (payload.customer_name and payload.customer_phone):
        raise Unprocessable("CUSTOMER_REQUIRED")

    async with db.begin():
        pre_order = PreOrder(
            store_id=store_id,
            order_date=payload.order_date,
            due_date=payload.due_date,
            customer_id=payload.customer_id,
            customer_name=payload.customer_name,
            customer_phone=payload.customer_phone,
            deposit_amount=payload.deposit_amount,
            deposit_paid=payload.deposit_paid,
            notes=payload.notes,
            status=PreOrderStatus.PENDING,
            created_by_id=user_id,
        )
        db.add(pre_order)
        await db.flush()

        for item_in in payload.items:
            unit_price = item_in.unit_price
            product_name = item_in.product_name or ""

            if item_in.product_id:
                product = (await db.execute(
                    select(Product).where(
                        Product.id == item_in.product_id,
                        Product.store_id == store_id,
                        Product.is_active.is_(True),
                    )
                )).scalar_one_or_none()
                if not product:
                    raise NotFound(f"Product {item_in.product_id} not found or inactive")
                product_name = product.name
                if unit_price is None:
                    unit_price = product.price

            if unit_price is None:
                unit_price = Decimal("0")

            db.add(PreOrderItem(
                pre_order_id=pre_order.id,
                product_id=item_in.product_id,
                product_name=product_name,
                quantity=item_in.quantity,
                unit_price=unit_price,
                line_total=unit_price * item_in.quantity,
            ))

    return await _pre_order_to_read(db, pre_order)


async def list_pre_orders(
    db: AsyncSession,
    *,
    store_id: str,
    status: PreOrderStatus | None = None,
    page: int = 1,
    limit: int = _DEFAULT_PAGE,
) -> PreOrdersPage:
    if limit <= 0 or limit > _MAX_PAGE:
        limit = _DEFAULT_PAGE
    offset = (max(page, 1) - 1) * limit

    item_count_subq = (
        select(PreOrderItem.pre_order_id, func.count(PreOrderItem.id).label("cnt"))
        .group_by(PreOrderItem.pre_order_id)
        .subquery()
    )
    stmt = (
        select(PreOrder, func.coalesce(item_count_subq.c.cnt, 0).label("item_count"))
        .outerjoin(item_count_subq, item_count_subq.c.pre_order_id == PreOrder.id)
        .where(PreOrder.store_id == store_id)
        .order_by(PreOrder.due_date.asc())
    )
    if status:
        stmt = stmt.where(PreOrder.status == status)

    total_stmt = select(func.count()).select_from(
        select(PreOrder).where(PreOrder.store_id == store_id).subquery()
    )
    if status:
        total_stmt = select(func.count()).select_from(
            select(PreOrder).where(PreOrder.store_id == store_id, PreOrder.status == status).subquery()
        )

    total = (await db.execute(total_stmt)).scalar_one()
    rows = list((await db.execute(stmt.offset(offset).limit(limit))).all())

    items = [
        PreOrderSummary(
            id=po.id,
            order_date=po.order_date,
            due_date=po.due_date,
            customer_name=po.customer_name,
            customer_phone=po.customer_phone,
            status=po.status.value,
            item_count=cnt,
            created_at=po.created_at,
        )
        for po, cnt in rows
    ]
    return PreOrdersPage(items=items, total=total)


async def get_pre_order(
    db: AsyncSession, *, store_id: str, pre_order_id: str
) -> PreOrderRead:
    pre_order = await _load_pre_order(db, store_id=store_id, pre_order_id=pre_order_id)
    return await _pre_order_to_read(db, pre_order)


async def update_pre_order(
    db: AsyncSession,
    *,
    store_id: str,
    pre_order_id: str,
    payload: PreOrderUpdate,
) -> PreOrderRead:
    async with db.begin():
        pre_order = await _load_pre_order(db, store_id=store_id, pre_order_id=pre_order_id)
        _require_pending(pre_order)

        if payload.order_date is not None:
            pre_order.order_date = payload.order_date
        if payload.due_date is not None:
            pre_order.due_date = payload.due_date
        if payload.customer_id is not None:
            pre_order.customer_id = payload.customer_id
        if payload.customer_name is not None:
            pre_order.customer_name = payload.customer_name
        if payload.customer_phone is not None:
            pre_order.customer_phone = payload.customer_phone
        if payload.deposit_amount is not None:
            pre_order.deposit_amount = payload.deposit_amount
        if payload.deposit_paid is not None:
            pre_order.deposit_paid = payload.deposit_paid
        if payload.notes is not None:
            pre_order.notes = payload.notes
        await db.flush()
        await db.refresh(pre_order)

    return await _pre_order_to_read(db, pre_order)


async def add_item(
    db: AsyncSession,
    *,
    store_id: str,
    pre_order_id: str,
    item_in: PreOrderItemIn,
) -> PreOrderRead:
    async with db.begin():
        pre_order = await _load_pre_order(db, store_id=store_id, pre_order_id=pre_order_id)
        _require_pending(pre_order)

        unit_price = item_in.unit_price
        product_name = item_in.product_name or ""

        if item_in.product_id:
            product = (await db.execute(
                select(Product).where(
                    Product.id == item_in.product_id,
                    Product.store_id == store_id,
                    Product.is_active.is_(True),
                )
            )).scalar_one_or_none()
            if not product:
                raise NotFound(f"Product {item_in.product_id} not found or inactive")
            product_name = product.name
            if unit_price is None:
                unit_price = product.price

        if unit_price is None:
            unit_price = Decimal("0")

        db.add(PreOrderItem(
            pre_order_id=pre_order.id,
            product_id=item_in.product_id,
            product_name=product_name,
            quantity=item_in.quantity,
            unit_price=unit_price,
            line_total=unit_price * item_in.quantity,
        ))
        await db.flush()
        await db.refresh(pre_order)

    return await _pre_order_to_read(db, pre_order)


async def remove_item(
    db: AsyncSession,
    *,
    store_id: str,
    pre_order_id: str,
    item_id: str,
) -> PreOrderRead:
    async with db.begin():
        pre_order = await _load_pre_order(db, store_id=store_id, pre_order_id=pre_order_id)
        _require_pending(pre_order)

        poi = (await db.execute(
            select(PreOrderItem).where(
                PreOrderItem.id == item_id,
                PreOrderItem.pre_order_id == pre_order_id,
            )
        )).scalar_one_or_none()
        if poi is None:
            raise NotFound("PRE_ORDER_ITEM_NOT_FOUND")
        await db.delete(poi)
        await db.flush()
        await db.refresh(pre_order)

    return await _pre_order_to_read(db, pre_order)


async def set_item_fulfillment(
    db: AsyncSession,
    *,
    store_id: str,
    pre_order_id: str,
    item_id: str,
    mode: FulfillmentMode,
) -> PreOrderRead:
    async with db.begin():
        pre_order = await _load_pre_order(db, store_id=store_id, pre_order_id=pre_order_id)
        _require_pending(pre_order)

        row = (await db.execute(
            select(PreOrderItem, Product)
            .join(Product, Product.id == PreOrderItem.product_id)
            .where(
                PreOrderItem.id == item_id,
                PreOrderItem.pre_order_id == pre_order_id,
            )
        )).one_or_none()

        if row is None:
            raise NotFound("PRE_ORDER_ITEM_NOT_FOUND")

        poi, product = row

        if product.product_type != ProductType.PRODUCED:
            raise Unprocessable("ITEM_NOT_PRODUCED")

        if mode == FulfillmentMode.FROM_INVENTORY and not product.finished_goods_item_id:
            raise Unprocessable("NO_FINISHED_GOODS_ITEM")

        poi.fulfillment_mode = mode
        await db.flush()
        await db.refresh(pre_order)

    return await _pre_order_to_read(db, pre_order)


async def get_ingredient_summary(
    db: AsyncSession,
    *,
    store_id: str,
    pre_order_id: str,
    threshold: float = 50.0,
) -> IngredientSummary:
    await _load_pre_order(db, store_id=store_id, pre_order_id=pre_order_id)

    aggregated = await _aggregate_ingredients(db, pre_order_id=pre_order_id)

    inv_items_list = list((await db.execute(
        select(InventoryItem).where(InventoryItem.id.in_(aggregated.keys()))
    )).scalars())
    inv_map = {inv.id: inv for inv in inv_items_list}

    sl_ids = set((await db.execute(
        select(ShoppingListItem.inventory_item_id).where(ShoppingListItem.store_id == store_id)
    )).scalars())

    result: list[IngredientSummaryItem] = []
    for inv_item_id, qty_needed in aggregated.items():
        inv_item = inv_map.get(inv_item_id)
        if not inv_item:
            continue
        if inv_item.stock_on_hand > 0:
            usage_pct: float | None = float(qty_needed / inv_item.stock_on_hand * 100)
            exceeds = usage_pct > threshold
        else:
            usage_pct = None
            exceeds = True
        result.append(IngredientSummaryItem(
            inventory_item_id=inv_item_id,
            name=inv_item.name,
            unit=inv_item.unit,
            qty_needed=qty_needed,
            stock_on_hand=inv_item.stock_on_hand,
            usage_pct=usage_pct,
            exceeds_threshold=exceeds,
            on_shopping_list=inv_item_id in sl_ids,
        ))

    return IngredientSummary(items=result, threshold=threshold)


async def start_pre_order(
    db: AsyncSession,
    *,
    store_id: str,
    user_id: str,
    pre_order_id: str,
) -> PreOrderRead:
    async with db.begin():
        pre_order = await _load_pre_order(db, store_id=store_id, pre_order_id=pre_order_id)
        if pre_order.status != PreOrderStatus.PENDING:
            raise Conflict("PRE_ORDER_ALREADY_STARTED")

        FinishedGoodsItem = aliased(InventoryItem)
        rows = list((await db.execute(
            select(
                PreOrderItem.id.label("poi_id"),
                PreOrderItem.quantity.label("poi_qty"),
                PreOrderItem.fulfillment_mode,
                RecipeItem.inventory_item_id,
                RecipeItem.quantity.label("ri_qty"),
                Product.product_type,
                Product.servings_per_batch,
                Product.finished_goods_item_id,
                FinishedGoodsItem.stock_on_hand.label("fg_stock"),
            )
            .join(RecipeItem, RecipeItem.product_id == PreOrderItem.product_id)
            .join(Product, Product.id == PreOrderItem.product_id)
            .outerjoin(FinishedGoodsItem, FinishedGoodsItem.id == Product.finished_goods_item_id)
            .where(PreOrderItem.pre_order_id == pre_order_id)
        )).all())

        if not rows:
            raise Unprocessable("PRE_ORDER_NO_ITEMS")

        fg_deductions: dict[str, Decimal] = {}
        raw_blocked: dict[str, Decimal] = {}
        raw_free: dict[str, Decimal] = {}
        processed_poi_ids: set[str] = set()

        for poi_id, poi_qty, fulfillment_mode, inv_item_id, ri_qty, product_type, servings_per_batch, fg_item_id, fg_stock in rows:
            if product_type == ProductType.PRODUCED and servings_per_batch > 0:
                poi_qty_dec = Decimal(poi_qty)
                if fulfillment_mode == FulfillmentMode.FROM_INVENTORY and fg_item_id and fg_stock is not None:
                    available = min(fg_stock, poi_qty_dec)
                    shortfall = poi_qty_dec - available
                    # processed_poi_ids: a PRODUCED item with N recipe rows produces N query rows.
                    # Only the first row per POI should contribute to fg_deductions.
                    if poi_id not in processed_poi_ids:
                        if available > 0:
                            fg_deductions[fg_item_id] = (
                                fg_deductions.get(fg_item_id, Decimal("0")) + available
                            )
                        processed_poi_ids.add(poi_id)
                    if shortfall > 0:
                        batches = Decimal(math.ceil(shortfall / Decimal(servings_per_batch)))
                        raw_blocked[inv_item_id] = (
                            raw_blocked.get(inv_item_id, Decimal("0")) + ri_qty * batches
                        )
                else:
                    batches = Decimal(math.ceil(Decimal(poi_qty) / Decimal(servings_per_batch)))
                    raw_free[inv_item_id] = (
                        raw_free.get(inv_item_id, Decimal("0")) + ri_qty * batches
                    )
            else:
                raw_free[inv_item_id] = (
                    raw_free.get(inv_item_id, Decimal("0")) + ri_qty * Decimal(poi_qty)
                )

        if raw_blocked:
            stock_rows = (await db.execute(
                select(InventoryItem.id, InventoryItem.stock_on_hand)
                .where(InventoryItem.id.in_(raw_blocked.keys()))
            )).all()
            stock_map = {row.id: row.stock_on_hand for row in stock_rows}
            if any(stock_map.get(inv_id, Decimal("0")) < qty_needed for inv_id, qty_needed in raw_blocked.items()):
                raise Unprocessable("INSUFFICIENT_INGREDIENTS")

        for fg_item_id, qty in fg_deductions.items():
            await _deduct_fifo(
                db,
                store_id=store_id,
                user_id=user_id,
                inventory_item_id=fg_item_id,
                total_qty=qty,
                reason=f"Pre-order {pre_order_id[:8]} (from inventory)",
            )

        all_raw = {**raw_blocked}
        for k, v in raw_free.items():
            all_raw[k] = all_raw.get(k, Decimal("0")) + v
        for inv_id, qty in all_raw.items():
            await _deduct_fifo(
                db,
                store_id=store_id,
                user_id=user_id,
                inventory_item_id=inv_id,
                total_qty=qty,
                reason=f"Pre-order {pre_order_id[:8]}",
            )

        pre_order.status = PreOrderStatus.IN_PROGRESS
        pre_order.started_by_id = user_id
        pre_order.started_at = datetime.now(UTC)
        await db.flush()
        await db.refresh(pre_order)

    return await _pre_order_to_read(db, pre_order)


async def complete_pre_order(
    db: AsyncSession,
    *,
    store_id: str,
    user_id: str,
    pre_order_id: str,
) -> PreOrderRead:
    async with db.begin():
        pre_order = await _load_pre_order(db, store_id=store_id, pre_order_id=pre_order_id)
        if pre_order.status != PreOrderStatus.IN_PROGRESS:
            raise Unprocessable("PRE_ORDER_NOT_IN_PROGRESS")
        pre_order.status = PreOrderStatus.COMPLETED
        pre_order.completed_by_id = user_id
        pre_order.completed_at = datetime.now(UTC)
        await db.flush()
        await db.refresh(pre_order)

    return await _pre_order_to_read(db, pre_order)


async def cancel_pre_order(
    db: AsyncSession,
    *,
    store_id: str,
    pre_order_id: str,
) -> PreOrderRead:
    async with db.begin():
        pre_order = await _load_pre_order(db, store_id=store_id, pre_order_id=pre_order_id)
        _require_pending(pre_order)
        pre_order.status = PreOrderStatus.CANCELLED
        await db.flush()
        await db.refresh(pre_order)

    return await _pre_order_to_read(db, pre_order)


# -- helpers ------------------------------------------------------------------


async def _load_pre_order(
    db: AsyncSession, *, store_id: str, pre_order_id: str
) -> PreOrder:
    po = (await db.execute(
        select(PreOrder).where(PreOrder.id == pre_order_id, PreOrder.store_id == store_id)
    )).scalar_one_or_none()
    if po is None:
        raise NotFound("PRE_ORDER_NOT_FOUND")
    return po


def _require_pending(pre_order: PreOrder) -> None:
    if pre_order.status != PreOrderStatus.PENDING:
        raise Unprocessable("PRE_ORDER_NOT_PENDING")


async def _aggregate_ingredients(
    db: AsyncSession, *, pre_order_id: str
) -> dict[str, Decimal]:
    FinishedGoodsItem = aliased(InventoryItem)

    rows = list((await db.execute(
        select(
            PreOrderItem.quantity.label("poi_qty"),
            PreOrderItem.fulfillment_mode,
            RecipeItem.inventory_item_id,
            RecipeItem.quantity.label("ri_qty"),
            Product.product_type,
            Product.servings_per_batch,
            FinishedGoodsItem.stock_on_hand.label("fg_stock"),
        )
        .join(RecipeItem, RecipeItem.product_id == PreOrderItem.product_id)
        .join(Product, Product.id == PreOrderItem.product_id)
        .outerjoin(FinishedGoodsItem, FinishedGoodsItem.id == Product.finished_goods_item_id)
        .where(PreOrderItem.pre_order_id == pre_order_id)
    )).all())

    aggregated: dict[str, Decimal] = {}
    for poi_qty, fulfillment_mode, inv_item_id, ri_qty, product_type, servings_per_batch, fg_stock in rows:
        if product_type == ProductType.PRODUCED and servings_per_batch > 0:
            poi_qty_dec = Decimal(poi_qty)
            if fulfillment_mode == FulfillmentMode.FROM_INVENTORY and fg_stock is not None:
                if fg_stock >= poi_qty_dec:
                    continue  # all recipe rows for this poi share the same fg_stock; skip each one
                shortfall = poi_qty_dec - fg_stock
                batches_needed = Decimal(math.ceil(shortfall / Decimal(servings_per_batch)))
            else:
                batches_needed = Decimal(math.ceil(float(poi_qty) / servings_per_batch))
            ingredient_qty = ri_qty * batches_needed
        else:
            ingredient_qty = ri_qty * Decimal(poi_qty)
        aggregated[inv_item_id] = aggregated.get(inv_item_id, Decimal("0")) + ingredient_qty
    return aggregated


async def _pre_order_to_read(db: AsyncSession, pre_order: PreOrder) -> PreOrderRead:
    items = list((await db.execute(
        select(PreOrderItem).where(PreOrderItem.pre_order_id == pre_order.id)
    )).scalars())
    return PreOrderRead(
        id=pre_order.id,
        store_id=pre_order.store_id,
        order_date=pre_order.order_date,
        due_date=pre_order.due_date,
        customer_id=pre_order.customer_id,
        customer_name=pre_order.customer_name,
        customer_phone=pre_order.customer_phone,
        deposit_amount=pre_order.deposit_amount,
        deposit_paid=pre_order.deposit_paid,
        notes=pre_order.notes,
        status=pre_order.status.value,
        created_by_id=pre_order.created_by_id,
        started_by_id=pre_order.started_by_id,
        completed_by_id=pre_order.completed_by_id,
        started_at=pre_order.started_at,
        completed_at=pre_order.completed_at,
        items=[PreOrderItemRead.model_validate(i) for i in items],
        created_at=pre_order.created_at,
        updated_at=pre_order.updated_at,
    )
