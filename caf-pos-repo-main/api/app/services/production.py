from datetime import date, datetime, time
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFound, Unprocessable
from app.enums import MovementType, ProductType
from app.models.catalog import Product, RecipeItem
from app.models.inventory import InventoryItem, StockMovement
from app.models.production import ProductionOrder
from app.schemas.production import ProductionOrderCreate


async def create_production_order(
    db: AsyncSession,
    *,
    store_id: str,
    user_id: str,
    payload: ProductionOrderCreate,
) -> ProductionOrder:
    async with db.begin():
        product = await _load_produced_product(db, store_id=store_id, product_id=payload.product_id)

        recipe_result = await db.execute(
            select(RecipeItem).where(RecipeItem.product_id == product.id)
        )
        recipe_items = list(recipe_result.scalars())

        units_produced = payload.batches_count * product.servings_per_batch

        total_ingredient_cost = Decimal("0")
        for ri in recipe_items:
            total_qty = ri.quantity * payload.batches_count
            item_result = await db.execute(
                select(InventoryItem).where(InventoryItem.id == ri.inventory_item_id)
            )
            inv_item = item_result.scalar_one_or_none()
            if inv_item:
                inv_item.stock_on_hand -= total_qty
                total_ingredient_cost += total_qty * inv_item.cost_per_unit
            db.add(StockMovement(
                store_id=store_id,
                inventory_item_id=ri.inventory_item_id,
                type=MovementType.PRODUCTION_USE,
                quantity=total_qty,
                unit_cost=inv_item.cost_per_unit if inv_item else None,
                reason=f"Production: {product.name} ×{payload.batches_count}",
                created_by_id=user_id,
            ))

        fg_result = await db.execute(
            select(InventoryItem).where(InventoryItem.id == product.finished_goods_item_id)
        )
        fg_item = fg_result.scalar_one_or_none()
        if fg_item:
            fg_item.stock_on_hand += Decimal(str(units_produced))
            if units_produced:
                fg_item.cost_per_unit = total_ingredient_cost / Decimal(str(units_produced))
        db.add(StockMovement(
            store_id=store_id,
            inventory_item_id=product.finished_goods_item_id,
            type=MovementType.PRODUCTION,
            quantity=Decimal(str(units_produced)),
            reason=f"Production: {product.name} ×{payload.batches_count}",
            created_by_id=user_id,
        ))

        order = ProductionOrder(
            store_id=store_id,
            product_id=product.id,
            batches_count=payload.batches_count,
            units_produced=units_produced,
            produced_by=user_id,
            notes=payload.notes,
        )
        db.add(order)
        await db.flush()
        await db.refresh(order)

    return order


async def list_production_orders(
    db: AsyncSession,
    *,
    store_id: str,
    product_id: str | None = None,
    from_: date | None = None,
    to: date | None = None,
) -> list[ProductionOrder]:
    stmt = (
        select(ProductionOrder)
        .where(ProductionOrder.store_id == store_id)
        .order_by(ProductionOrder.produced_at.desc())
    )
    if product_id:
        stmt = stmt.where(ProductionOrder.product_id == product_id)
    if from_:
        stmt = stmt.where(ProductionOrder.produced_at >= datetime.combine(from_, time.min))
    if to:
        stmt = stmt.where(ProductionOrder.produced_at <= datetime.combine(to, time.max))
    result = await db.execute(stmt)
    return list(result.scalars())


async def get_production_order(
    db: AsyncSession,
    *,
    store_id: str,
    order_id: str,
) -> ProductionOrder:
    result = await db.execute(
        select(ProductionOrder).where(
            ProductionOrder.id == order_id,
            ProductionOrder.store_id == store_id,
        )
    )
    order = result.scalar_one_or_none()
    if not order:
        raise NotFound("Production order not found")
    return order


async def _load_produced_product(
    db: AsyncSession, *, store_id: str, product_id: str
) -> Product:
    result = await db.execute(
        select(Product).where(Product.id == product_id, Product.store_id == store_id)
    )
    product = result.scalar_one_or_none()
    if not product:
        raise NotFound("Product not found")
    if product.product_type != ProductType.PRODUCED:
        raise Unprocessable("Product is not a produced good")
    if not product.finished_goods_item_id:
        raise HTTPException(
            status_code=500,
            detail="PRODUCT_MISCONFIGURED: PRODUCED product has no finished_goods_item_id",
        )
    return product
