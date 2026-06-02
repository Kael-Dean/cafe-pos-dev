from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import and_, case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.enums import MovementType, OrderStatus
from app.models import Category, InventoryItem, Order, OrderItem, Product, StockMovement
from app.models.identity import User
from app.schemas.reports import (
    CashierShift,
    CashierShiftsReportRead,
    CogsItem,
    CogsReportRead,
    DashboardTodayRead,
    LowStockItem,
    LowStockReportRead,
    SalesBucket,
    SalesReportRead,
    TopItem,
    WastageByReason,
    WastageReportRead,
)

_REVENUE_STATUSES = (OrderStatus.PAID, OrderStatus.IN_PROGRESS, OrderStatus.READY, OrderStatus.COMPLETED)


async def get_dashboard_today(db: AsyncSession, store_id: str) -> DashboardTodayRead:
    today = date.today()
    base_filter = and_(
        Order.store_id == store_id,
        func.date(Order.created_at) == today,
        Order.status.in_(_REVENUE_STATUSES),
    )

    summary_row = (
        await db.execute(
            select(
                func.coalesce(func.sum(Order.total), Decimal("0")).label("revenue"),
                func.count(Order.id).label("order_count"),
            ).where(base_filter)
        )
    ).one()

    revenue: Decimal = summary_row.revenue or Decimal("0")
    order_count: int = summary_row.order_count or 0
    avg_ticket = (revenue / order_count).quantize(Decimal("0.01")) if order_count else Decimal("0")

    top_rows = await db.execute(
        select(
            OrderItem.product_name,
            func.sum(OrderItem.quantity).label("quantity"),
            func.sum(OrderItem.quantity * OrderItem.unit_price).label("revenue"),
        )
        .join(Order, Order.id == OrderItem.order_id)
        .where(base_filter)
        .group_by(OrderItem.product_name)
        .order_by(func.sum(OrderItem.quantity).desc())
        .limit(5)
    )
    top_items = [
        TopItem(product_name=r.product_name, quantity=r.quantity, revenue=r.revenue or Decimal("0"))
        for r in top_rows
    ]

    return DashboardTodayRead(
        revenue=revenue,
        order_count=order_count,
        avg_ticket=avg_ticket,
        top_items=top_items,
    )


async def get_sales_report(
    db: AsyncSession,
    store_id: str,
    from_: datetime,
    to: datetime,
    granularity: str,
) -> SalesReportRead:
    base_filter = and_(
        Order.store_id == store_id,
        Order.created_at >= from_,
        Order.created_at <= to,
        Order.status.in_(_REVENUE_STATUSES),
    )

    totals_row = (
        await db.execute(
            select(
                func.coalesce(func.sum(Order.total), Decimal("0")).label("total_revenue"),
                func.count(Order.id).label("total_orders"),
            ).where(base_filter)
        )
    ).one()

    buckets: list[SalesBucket] = []

    if granularity == "day":
        bucket_expr = func.date_trunc("day", Order.created_at).label("bucket")
        rows = await db.execute(
            select(bucket_expr, func.count(Order.id).label("cnt"), func.sum(Order.total).label("rev"))
            .where(base_filter)
            .group_by(bucket_expr)
            .order_by(bucket_expr)
        )
        buckets = [
            SalesBucket(bucket=r.bucket.strftime("%Y-%m-%d"), order_count=r.cnt, revenue=r.rev or Decimal("0"))
            for r in rows
        ]

    elif granularity == "hour":
        bucket_expr = func.date_trunc("hour", Order.created_at).label("bucket")
        rows = await db.execute(
            select(bucket_expr, func.count(Order.id).label("cnt"), func.sum(Order.total).label("rev"))
            .where(base_filter)
            .group_by(bucket_expr)
            .order_by(bucket_expr)
        )
        buckets = [
            SalesBucket(bucket=r.bucket.strftime("%Y-%m-%dT%H:00"), order_count=r.cnt, revenue=r.rev or Decimal("0"))
            for r in rows
        ]

    elif granularity == "product":
        rows = await db.execute(
            select(
                OrderItem.product_name.label("bucket"),
                func.count(Order.id.distinct()).label("cnt"),
                func.sum(OrderItem.quantity * OrderItem.unit_price).label("rev"),
            )
            .join(Order, Order.id == OrderItem.order_id)
            .where(base_filter)
            .group_by(OrderItem.product_name)
            .order_by(func.sum(OrderItem.quantity * OrderItem.unit_price).desc())
        )
        buckets = [
            SalesBucket(bucket=r.bucket, order_count=r.cnt, revenue=r.rev or Decimal("0"))
            for r in rows
        ]

    elif granularity == "category":
        rows = await db.execute(
            select(
                func.coalesce(Category.name, "Uncategorized").label("bucket"),
                func.count(Order.id.distinct()).label("cnt"),
                func.sum(OrderItem.quantity * OrderItem.unit_price).label("rev"),
            )
            .join(Order, Order.id == OrderItem.order_id)
            .outerjoin(Product, Product.id == OrderItem.product_id)
            .outerjoin(Category, Category.id == Product.category_id)
            .where(base_filter)
            .group_by(func.coalesce(Category.name, "Uncategorized"))
            .order_by(func.sum(OrderItem.quantity * OrderItem.unit_price).desc())
        )
        buckets = [
            SalesBucket(bucket=r.bucket, order_count=r.cnt, revenue=r.rev or Decimal("0"))
            for r in rows
        ]

    else:  # payment_method
        rows = await db.execute(
            select(
                Order.payment_method.label("payment_method"),
                func.count(Order.id).label("cnt"),
                func.sum(Order.total).label("rev"),
            )
            .where(base_filter)
            .group_by(Order.payment_method)
            .order_by(func.sum(Order.total).desc())
        )
        buckets = [
            SalesBucket(
                bucket=r.payment_method.value if r.payment_method else "UNPAID",
                order_count=r.cnt,
                revenue=r.rev or Decimal("0"),
            )
            for r in rows
        ]

    return SalesReportRead(
        from_=from_,
        to=to,
        granularity=granularity,
        buckets=buckets,
        total_revenue=totals_row.total_revenue,
        total_orders=totals_row.total_orders,
    )


async def get_cogs_report(
    db: AsyncSession,
    store_id: str,
    from_: datetime,
    to: datetime,
    sort_by: str = "pieces",
) -> CogsReportRead:
    qty_sold = func.sum(func.abs(StockMovement.quantity))
    pieces_expr = (qty_sold / func.nullif(InventoryItem.unit_size, 0)).label("pieces_consumed")
    order_expr = (
        func.sum(func.abs(StockMovement.quantity) * InventoryItem.cost_per_unit).desc()
        if sort_by == "cost"
        else (qty_sold / func.nullif(InventoryItem.unit_size, 0)).desc().nulls_last()
    )
    rows = await db.execute(
        select(
            InventoryItem.id.label("item_id"),
            InventoryItem.name.label("item_name"),
            InventoryItem.unit.label("unit"),
            qty_sold.label("quantity_sold"),
            InventoryItem.cost_per_unit.label("cost_per_unit"),
            func.sum(func.abs(StockMovement.quantity) * InventoryItem.cost_per_unit).label("total_cogs"),
            InventoryItem.unit_size.label("unit_size"),
            pieces_expr,
        )
        .join(InventoryItem, InventoryItem.id == StockMovement.inventory_item_id)
        .where(
            and_(
                StockMovement.store_id == store_id,
                StockMovement.type == MovementType.SALE,
                StockMovement.created_at >= from_,
                StockMovement.created_at <= to,
            )
        )
        .group_by(
            InventoryItem.id,
            InventoryItem.name,
            InventoryItem.unit,
            InventoryItem.cost_per_unit,
            InventoryItem.unit_size,
        )
        .order_by(order_expr)
    )
    items = [
        CogsItem(
            item_id=r.item_id,
            item_name=r.item_name,
            unit=r.unit,
            quantity_sold=r.quantity_sold or Decimal("0"),
            cost_per_unit=r.cost_per_unit,
            total_cogs=r.total_cogs or Decimal("0"),
            unit_size=r.unit_size,
            pieces_consumed=r.pieces_consumed,
        )
        for r in rows
    ]
    total_cogs = sum((i.total_cogs for i in items), Decimal("0"))
    return CogsReportRead(from_=from_, to=to, items=items, total_cogs=total_cogs)


async def get_wastage_report(
    db: AsyncSession,
    store_id: str,
    from_: datetime,
    to: datetime,
) -> WastageReportRead:
    # Reason stored as "<CODE>|<note>"; SPLIT_PART extracts the code prefix.
    reason_code_expr = func.coalesce(
        func.nullif(func.split_part(StockMovement.reason, "|", 1), ""),
        "OTHER",
    ).label("reason_code")

    rows = await db.execute(
        select(
            reason_code_expr,
            func.count(StockMovement.id).label("event_count"),
            func.sum(func.abs(StockMovement.quantity)).label("total_quantity"),
            func.sum(func.abs(StockMovement.quantity) * InventoryItem.cost_per_unit).label("estimated_cost"),
        )
        .join(InventoryItem, InventoryItem.id == StockMovement.inventory_item_id)
        .where(
            and_(
                StockMovement.store_id == store_id,
                StockMovement.type == MovementType.WASTE,
                StockMovement.created_at >= from_,
                StockMovement.created_at <= to,
            )
        )
        .group_by(reason_code_expr)
        .order_by(func.sum(func.abs(StockMovement.quantity)).desc())
    )
    by_reason = [
        WastageByReason(
            reason_code=r.reason_code,
            event_count=r.event_count,
            total_quantity=r.total_quantity or Decimal("0"),
            estimated_cost=r.estimated_cost or Decimal("0"),
        )
        for r in rows
    ]
    total_quantity = sum((b.total_quantity for b in by_reason), Decimal("0"))
    total_cost = sum((b.estimated_cost for b in by_reason), Decimal("0"))
    return WastageReportRead(
        from_=from_,
        to=to,
        by_reason=by_reason,
        total_quantity=total_quantity,
        total_cost=total_cost,
    )


async def get_low_stock_report(db: AsyncSession, store_id: str) -> LowStockReportRead:
    rows = (
        await db.execute(
            select(InventoryItem)
            .where(
                and_(
                    InventoryItem.store_id == store_id,
                    InventoryItem.stock_on_hand < InventoryItem.par_level,
                    InventoryItem.is_active == True,  # noqa: E712
                )
            )
            .order_by(InventoryItem.stock_on_hand - InventoryItem.par_level)
        )
    ).scalars().all()

    items = [
        LowStockItem(
            item_id=item.id,
            item_name=item.name,
            unit=item.unit,
            stock_on_hand=item.stock_on_hand,
            par_level=item.par_level,
            deficit=item.par_level - item.stock_on_hand,
        )
        for item in rows
    ]
    return LowStockReportRead(items=items, total_items=len(items))


async def get_cashier_shifts_report(
    db: AsyncSession,
    store_id: str,
    from_: datetime,
    to: datetime,
) -> CashierShiftsReportRead:
    revenue_case = case((Order.status.in_(_REVENUE_STATUSES), Order.total), else_=None)
    void_case = case((Order.status == OrderStatus.VOID, Order.id), else_=None)
    non_void_case = case((Order.status != OrderStatus.VOID, Order.id), else_=None)

    rows = await db.execute(
        select(
            Order.created_by_id.label("user_id"),
            User.name.label("user_name"),
            func.count(non_void_case).label("order_count"),
            func.coalesce(func.sum(revenue_case), Decimal("0")).label("revenue"),
            func.count(void_case).label("void_count"),
        )
        .join(User, User.id == Order.created_by_id)
        .where(
            and_(
                Order.store_id == store_id,
                Order.created_at >= from_,
                Order.created_at <= to,
            )
        )
        .group_by(Order.created_by_id, User.name)
        .order_by(func.coalesce(func.sum(revenue_case), Decimal("0")).desc())
    )
    cashiers = [
        CashierShift(
            user_id=r.user_id,
            user_name=r.user_name,
            order_count=r.order_count,
            revenue=r.revenue or Decimal("0"),
            void_count=r.void_count,
        )
        for r in rows
    ]
    return CashierShiftsReportRead(from_=from_, to=to, cashiers=cashiers)
