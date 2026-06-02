from datetime import datetime, timedelta, timezone
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFound
from app.enums import OrderStatus, PromotionScope, PromotionType
from app.models.catalog import Product
from app.models.orders import Order, OrderItem
from app.models.promotions import Promotion
from app.schemas.promotions import (
    EligiblePromotion,
    EvaluateItemIn,
    EvaluateResponse,
    PromotionBaselineResponse,
    PromotionCreate,
    PromotionUpdate,
)


async def get_promotion_baseline(
    db: AsyncSession,
    *,
    store_id: str,
    product_id: str,
    days: int = 30,
) -> PromotionBaselineResponse:
    since = datetime.now(timezone.utc) - timedelta(days=days)

    product_check = await db.execute(
        select(Product).where(Product.id == product_id, Product.store_id == store_id)
    )
    if not product_check.scalar_one_or_none():
        raise NotFound("Product not found")

    result = await db.execute(
        select(func.sum(OrderItem.quantity))
        .join(Order, Order.id == OrderItem.order_id)
        .where(
            Order.store_id == store_id,
            OrderItem.product_id == product_id,
            Order.status != OrderStatus.VOID,
            Order.created_at >= since,
        )
    )
    units_sold = Decimal(str(result.scalar() or 0)).quantize(Decimal("0.01"))
    avg_per_week = (units_sold / Decimal(days) * Decimal("7")).quantize(Decimal("0.01"))

    return PromotionBaselineResponse(
        product_id=product_id,
        sales_window_days=days,
        units_sold_in_window=units_sold,
        avg_units_per_week=avg_per_week,
    )


async def evaluate_promotions(
    db: AsyncSession,
    *,
    store_id: str,
    items: list[EvaluateItemIn],
) -> EvaluateResponse:
    now = datetime.now(timezone.utc)
    today = now.date()
    current_time = now.time()
    current_weekday = now.weekday()  # 0 = Monday

    promos_result = await db.execute(
        select(Promotion).where(Promotion.store_id == store_id, Promotion.is_active == True)  # noqa: E712
    )
    promotions = promos_result.scalars().all()

    product_ids = [item.product_id for item in items]
    prods_result = await db.execute(
        select(Product).where(Product.id.in_(product_ids), Product.store_id == store_id)
    )
    products_map = {p.id: p for p in prods_result.scalars().all()}

    cart_lines = [
        {
            "product_id": item.product_id,
            "category_id": products_map[item.product_id].category_id,
            "quantity": item.quantity,
            "line_total": products_map[item.product_id].price * item.quantity,
        }
        for item in items
        if item.product_id in products_map
    ]

    eligible = []
    for promo in promotions:
        if promo.valid_from and today < promo.valid_from:
            continue
        if promo.valid_until and today > promo.valid_until:
            continue
        if promo.type == PromotionType.HAPPY_HOUR:
            if promo.time_start is None or promo.time_end is None:
                continue
            if promo.time_start <= promo.time_end:
                in_window = promo.time_start <= current_time < promo.time_end
            else:  # spans midnight
                in_window = current_time >= promo.time_start or current_time < promo.time_end
            if not in_window:
                continue
            if promo.days_of_week_json is not None and current_weekday not in promo.days_of_week_json:
                continue

        discount_amount = _compute_discount(promo, cart_lines)
        if discount_amount > Decimal("0"):
            eligible.append(EligiblePromotion(
                promotion_id=promo.id,
                name=promo.name,
                type=promo.type,
                discount_amount=discount_amount,
                is_exclusive=promo.is_exclusive,
            ))

    return EvaluateResponse(eligible=eligible)


def _compute_discount(promo: Promotion, cart_lines: list[dict]) -> Decimal:
    if promo.discount_pct is None:
        return Decimal("0")
    if promo.type in (PromotionType.PERCENT_OFF, PromotionType.HAPPY_HOUR):
        return _scope_discount(promo, cart_lines)
    if promo.type == PromotionType.COMBO_BUNDLE:
        return _combo_bundle_discount(promo, cart_lines)
    if promo.type == PromotionType.COMBO_QUANTITY:
        return _combo_quantity_discount(promo, cart_lines)
    return Decimal("0")


def _scope_discount(promo: Promotion, cart_lines: list[dict]) -> Decimal:
    if promo.scope == PromotionScope.ORDER:
        base = sum((line["line_total"] for line in cart_lines), Decimal("0"))
    elif promo.scope == PromotionScope.CATEGORY:
        base = sum(
            (line["line_total"] for line in cart_lines if line["category_id"] == promo.category_id),
            Decimal("0"),
        )
    else:  # PRODUCT
        product_ids = set(promo.product_ids_json or [])
        base = sum(
            (line["line_total"] for line in cart_lines if line["product_id"] in product_ids),
            Decimal("0"),
        )
    return (base * promo.discount_pct / 100).quantize(Decimal("0.01"))


def _combo_bundle_discount(promo: Promotion, cart_lines: list[dict]) -> Decimal:
    bundle_ids = set(promo.bundle_product_ids_json or [])
    if not bundle_ids:
        return Decimal("0")
    cart_product_ids = {line["product_id"] for line in cart_lines}
    if not bundle_ids.issubset(cart_product_ids):
        return Decimal("0")
    base = sum(
        (line["line_total"] for line in cart_lines if line["product_id"] in bundle_ids),
        Decimal("0"),
    )
    return (base * promo.discount_pct / 100).quantize(Decimal("0.01"))


def _combo_quantity_discount(promo: Promotion, cart_lines: list[dict]) -> Decimal:
    if promo.scope == PromotionScope.PRODUCT:
        product_ids = set(promo.product_ids_json or [])
        matching = [line for line in cart_lines if line["product_id"] in product_ids]
    elif promo.scope == PromotionScope.CATEGORY:
        matching = [line for line in cart_lines if line["category_id"] == promo.category_id]
    else:
        matching = cart_lines

    total_qty = sum(line["quantity"] for line in matching)
    if total_qty < (promo.min_quantity or 1):
        return Decimal("0")
    base = sum((line["line_total"] for line in matching), Decimal("0"))
    return (base * promo.discount_pct / 100).quantize(Decimal("0.01"))


async def create_promotion(
    db: AsyncSession, *, store_id: str, req: PromotionCreate
) -> Promotion:
    async with db.begin():
        promo = Promotion(store_id=store_id, **req.model_dump())
        db.add(promo)
        await db.flush()
        await db.refresh(promo)
    return promo


async def list_promotions(
    db: AsyncSession, *, store_id: str, active: bool | None = None
) -> list[Promotion]:
    q = select(Promotion).where(Promotion.store_id == store_id).order_by(Promotion.created_at.desc())
    if active is not None:
        q = q.where(Promotion.is_active == active)
    result = await db.execute(q)
    return list(result.scalars().all())


async def get_promotion(
    db: AsyncSession, *, store_id: str, promotion_id: str
) -> Promotion:
    result = await db.execute(
        select(Promotion).where(Promotion.id == promotion_id, Promotion.store_id == store_id)
    )
    promo = result.scalar_one_or_none()
    if not promo:
        raise NotFound("Promotion not found")
    return promo


async def update_promotion(
    db: AsyncSession, *, store_id: str, promotion_id: str, req: PromotionUpdate
) -> Promotion:
    async with db.begin():
        promo = await get_promotion(db, store_id=store_id, promotion_id=promotion_id)
        for k, v in req.model_dump(exclude_unset=True).items():
            setattr(promo, k, v)
        await db.flush()
        await db.refresh(promo)
    return promo


async def delete_promotion(
    db: AsyncSession, *, store_id: str, promotion_id: str
) -> None:
    async with db.begin():
        promo = await get_promotion(db, store_id=store_id, promotion_id=promotion_id)
        await db.delete(promo)


async def apply_promotions(
    db: AsyncSession,
    *,
    store_id: str,
    promotion_ids: list[str],
    cart_lines: list[dict],
) -> tuple[Decimal, list[tuple[str, Decimal]]]:
    """Validate and compute discounts for requested promotions.

    Called from inside create_order's transaction — does NOT start its own db.begin().
    Returns (total_discount, [(promotion_id, discount_amount), ...]).
    Raises HTTPException(422) on stacking violation or ineligible promotion.
    """
    promos_result = await db.execute(
        select(Promotion).where(
            Promotion.id.in_(promotion_ids),
            Promotion.store_id == store_id,
        )
    )
    promos = {p.id: p for p in promos_result.scalars().all()}

    for pid in promotion_ids:
        if pid not in promos:
            raise HTTPException(status_code=422, detail=f"Promotion {pid} not found or not available")

    now = datetime.now(timezone.utc)
    today = now.date()
    current_time = now.time()
    current_weekday = now.weekday()

    applied: list[tuple[str, Decimal]] = []
    for pid in promotion_ids:
        promo = promos[pid]
        if not promo.is_active:
            raise HTTPException(status_code=422, detail=f"Promotion '{promo.name}' is not active")
        if promo.valid_from and today < promo.valid_from:
            raise HTTPException(status_code=422, detail=f"Promotion '{promo.name}' is not yet valid")
        if promo.valid_until and today > promo.valid_until:
            raise HTTPException(status_code=422, detail=f"Promotion '{promo.name}' has expired")
        if promo.type == PromotionType.HAPPY_HOUR:
            if promo.time_start is None or promo.time_end is None:
                raise HTTPException(status_code=422, detail=f"Promotion '{promo.name}' has no time window configured")
            if promo.time_start <= promo.time_end:
                in_window = promo.time_start <= current_time < promo.time_end
            else:
                in_window = current_time >= promo.time_start or current_time < promo.time_end
            if not in_window:
                raise HTTPException(status_code=422, detail=f"Promotion '{promo.name}' is outside its time window")
            if promo.days_of_week_json is not None and current_weekday not in promo.days_of_week_json:
                raise HTTPException(status_code=422, detail=f"Promotion '{promo.name}' does not run today")

        discount_amount = _compute_discount(promo, cart_lines)
        applied.append((pid, discount_amount))

    exclusive_ids = [pid for pid in promotion_ids if promos[pid].is_exclusive]
    if exclusive_ids and len(promotion_ids) > 1:
        name = promos[exclusive_ids[0]].name
        raise HTTPException(
            status_code=422,
            detail=f"Promotion '{name}' is exclusive and cannot be combined with other promotions",
        )

    total_discount = sum((amt for _, amt in applied), Decimal("0"))
    return total_discount, applied
