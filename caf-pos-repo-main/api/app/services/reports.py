from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import and_, case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.enums import MovementType, OrderStatus
from app.models import (
    Category,
    Customer,
    InventoryItem,
    Order,
    OrderItem,
    Product,
    Salesperson,
    StockMovement,
)
from app.models.identity import User
from app.schemas.reports import (
    CashierShift,
    CashierShiftsReportRead,
    CogsItem,
    CogsReportRead,
    DashboardTodayRead,
    KpiItemRead,
    KpiMemberRead,
    KpiSalespersonRead,
    LowStockItem,
    LowStockReportRead,
    SalesBucket,
    SalespersonKpiReportRead,
    SalesReportRead,
    TopItem,
    WastageByDay,
    WastageByItem,
    WastageByReason,
    WastageEvent,
    WastageReportRead,
)
from app.services.inventory import _decode_movement_reason

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
            SalesBucket(
                bucket=r.bucket.strftime("%Y-%m-%d"), order_count=r.cnt, revenue=r.rev or Decimal("0")
            )
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
            SalesBucket(
                bucket=r.bucket.strftime("%Y-%m-%dT%H:00"), order_count=r.cnt, revenue=r.rev or Decimal("0")
            )
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
            SalesBucket(bucket=r.bucket, order_count=r.cnt, revenue=r.rev or Decimal("0")) for r in rows
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
            .group_by(Category.name)
            .order_by(func.sum(OrderItem.quantity * OrderItem.unit_price).desc())
        )
        buckets = [
            SalesBucket(bucket=r.bucket, order_count=r.cnt, revenue=r.rev or Decimal("0")) for r in rows
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
    # Shared filter for every aggregate. Waste qty is positive; cost is estimated
    # from the item's CURRENT cost_per_unit (movement.unit_cost is NULL for waste).
    base = and_(
        StockMovement.store_id == store_id,
        StockMovement.type == MovementType.WASTE,
        StockMovement.created_at >= from_,
        StockMovement.created_at <= to,
    )
    qty_expr = func.abs(StockMovement.quantity)
    cost_expr = qty_expr * InventoryItem.cost_per_unit
    # Reason stored as "<CODE>|<note>"; SPLIT_PART extracts the code prefix.
    reason_code_expr = func.coalesce(
        func.nullif(func.split_part(StockMovement.reason, "|", 1), ""),
        "OTHER",
    ).label("reason_code")

    by_reason = await _wastage_by_reason(db, base, reason_code_expr, qty_expr, cost_expr)
    by_day = await _wastage_by_day(db, base, qty_expr, cost_expr)
    by_item = await _wastage_by_item(db, base, qty_expr, cost_expr)
    events = await _wastage_events(db, base)

    total_quantity = sum((b.total_quantity for b in by_reason), Decimal("0"))
    total_cost = sum((b.estimated_cost for b in by_reason), Decimal("0"))
    event_count = sum(b.event_count for b in by_reason)
    return WastageReportRead(
        from_=from_,
        to=to,
        total_quantity=total_quantity,
        total_cost=total_cost,
        event_count=event_count,
        by_reason=by_reason,
        by_day=by_day,
        by_item=by_item,
        events=events,
    )


async def _wastage_by_reason(db, base, reason_code_expr, qty_expr, cost_expr) -> list[WastageByReason]:
    rows = await db.execute(
        select(
            reason_code_expr,
            func.count(StockMovement.id).label("event_count"),
            func.sum(qty_expr).label("total_quantity"),
            func.sum(cost_expr).label("estimated_cost"),
        )
        .join(InventoryItem, InventoryItem.id == StockMovement.inventory_item_id)
        .where(base)
        .group_by(reason_code_expr)
        .order_by(func.sum(qty_expr).desc())
    )
    return [
        WastageByReason(
            reason_code=r.reason_code,
            event_count=r.event_count,
            total_quantity=r.total_quantity or Decimal("0"),
            estimated_cost=r.estimated_cost or Decimal("0"),
        )
        for r in rows
    ]


async def _wastage_by_day(db, base, qty_expr, cost_expr) -> list[WastageByDay]:
    day_expr = func.date_trunc("day", StockMovement.created_at)
    rows = await db.execute(
        select(
            day_expr.label("bucket"),
            func.count(StockMovement.id).label("event_count"),
            func.sum(qty_expr).label("total_quantity"),
            func.sum(cost_expr).label("estimated_cost"),
        )
        .join(InventoryItem, InventoryItem.id == StockMovement.inventory_item_id)
        .where(base)
        .group_by(day_expr)
        .order_by(day_expr)
    )
    return [
        WastageByDay(
            bucket=r.bucket.strftime("%Y-%m-%d"),
            event_count=r.event_count,
            total_quantity=r.total_quantity or Decimal("0"),
            estimated_cost=r.estimated_cost or Decimal("0"),
        )
        for r in rows
    ]


async def _wastage_by_item(db, base, qty_expr, cost_expr) -> list[WastageByItem]:
    rows = await db.execute(
        select(
            InventoryItem.id.label("item_id"),
            InventoryItem.name.label("item_name"),
            InventoryItem.unit.label("unit"),
            func.count(StockMovement.id).label("event_count"),
            func.sum(qty_expr).label("total_quantity"),
            func.sum(cost_expr).label("estimated_cost"),
        )
        .join(InventoryItem, InventoryItem.id == StockMovement.inventory_item_id)
        .where(base)
        .group_by(InventoryItem.id, InventoryItem.name, InventoryItem.unit)
        .order_by(func.sum(cost_expr).desc())
    )
    return [
        WastageByItem(
            item_id=r.item_id,
            item_name=r.item_name,
            unit=r.unit,
            event_count=r.event_count,
            total_quantity=r.total_quantity or Decimal("0"),
            estimated_cost=r.estimated_cost or Decimal("0"),
        )
        for r in rows
    ]


async def _wastage_events(db, base) -> list[WastageEvent]:
    rows = await db.execute(
        select(
            StockMovement.id,
            StockMovement.created_at,
            StockMovement.quantity,
            StockMovement.reason,
            InventoryItem.name.label("item_name"),
            InventoryItem.unit,
            InventoryItem.cost_per_unit,
            User.name.label("created_by_name"),
        )
        .join(InventoryItem, InventoryItem.id == StockMovement.inventory_item_id)
        .join(User, User.id == StockMovement.created_by_id)
        .where(base)
        .order_by(StockMovement.created_at.asc(), StockMovement.id.asc())
    )
    events: list[WastageEvent] = []
    for r in rows:
        code, note, _supplier, _raw = _decode_movement_reason(MovementType.WASTE, r.reason)
        events.append(
            WastageEvent(
                id=r.id,
                created_at=r.created_at,
                item_name=r.item_name,
                unit=r.unit,
                quantity=abs(r.quantity),
                reason_code=code.value if code is not None else "OTHER",
                note=note,
                created_by_name=r.created_by_name,
                estimated_cost=abs(r.quantity) * r.cost_per_unit,
            )
        )
    return events


async def get_low_stock_report(db: AsyncSession, store_id: str) -> LowStockReportRead:
    rows = (
        (
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
        )
        .scalars()
        .all()
    )

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


async def get_salesperson_kpi_report(
    db: AsyncSession,
    *,
    store_id: str,
    from_: datetime,
    to: datetime,
) -> SalespersonKpiReportRead:
    # Fetch all active salespeople for the store
    salespeople = (
        (
            await db.execute(
                select(Salesperson)
                .where(Salesperson.store_id == store_id, Salesperson.is_active.is_(True))
                .order_by(Salesperson.name)
            )
        )
        .scalars()
        .all()
    )

    # Fetch all customers assigned to any of those salespeople
    sp_ids = [sp.id for sp in salespeople]
    if not sp_ids:
        return SalespersonKpiReportRead(from_=from_, to=to, salespeople=[])

    customers = (
        (
            await db.execute(
                select(Customer).where(
                    Customer.store_id == store_id,
                    Customer.sales_id.in_(sp_ids),
                    Customer.is_active.is_(True),
                )
            )
        )
        .scalars()
        .all()
    )

    # Fetch all revenue orders in the date range for customers assigned to a salesperson
    customer_ids = [c.id for c in customers]
    if not customer_ids:
        return SalespersonKpiReportRead(
            from_=from_,
            to=to,
            salespeople=[
                KpiSalespersonRead(
                    sales_id=sp.id,
                    sales_name=sp.name,
                    member_count=0,
                    buying_member_count=0,
                    total_items=0,
                    total_value=Decimal("0.00"),
                    members=[],
                )
                for sp in salespeople
            ],
        )

    orders = (
        (
            await db.execute(
                select(Order).where(
                    Order.store_id == store_id,
                    Order.customer_id.in_(customer_ids),
                    Order.status.in_(_REVENUE_STATUSES),
                    Order.created_at >= from_,
                    Order.created_at <= to,
                )
            )
        )
        .scalars()
        .all()
    )

    order_ids = [o.id for o in orders]

    # Fetch order items for those orders (only if orders exist)
    order_items: list[OrderItem] = []
    if order_ids:
        order_items = (
            (await db.execute(select(OrderItem).where(OrderItem.order_id.in_(order_ids)))).scalars().all()
        )

    # Group orders by customer
    orders_by_customer: dict[str, list[Order]] = defaultdict(list)
    for order in orders:
        if order.customer_id:
            orders_by_customer[order.customer_id].append(order)

    # Group items by order
    items_by_order: dict[str, list[OrderItem]] = defaultdict(list)
    for item in order_items:
        items_by_order[item.order_id].append(item)

    # Group customers by salesperson
    customers_by_sp: dict[str, list[Customer]] = defaultdict(list)
    for c in customers:
        if c.sales_id:
            customers_by_sp[c.sales_id].append(c)

    # Build KPI rows
    sp_reads: list[KpiSalespersonRead] = []
    for sp in salespeople:
        sp_customers = customers_by_sp.get(sp.id, [])
        member_reads: list[KpiMemberRead] = []
        sp_total_items = 0
        sp_total_value = Decimal("0.00")
        buying_count = 0

        for customer in sp_customers:
            c_orders = orders_by_customer.get(customer.id, [])
            product_totals: dict[str, dict] = {}
            c_total_items = 0
            c_total_value = Decimal("0.00")

            for order in c_orders:
                for item in items_by_order.get(order.id, []):
                    pname = item.product_name
                    if pname not in product_totals:
                        product_totals[pname] = {"quantity": 0, "value": Decimal("0.00")}
                    product_totals[pname]["quantity"] += item.quantity
                    product_totals[pname]["value"] += item.unit_price * item.quantity
                    c_total_items += item.quantity
                    c_total_value += item.unit_price * item.quantity

            if c_orders:
                buying_count += 1

            item_reads = [
                KpiItemRead(
                    product_name=pname,
                    quantity=data["quantity"],
                    value=data["value"],
                )
                for pname, data in sorted(product_totals.items())
            ]
            member_reads.append(
                KpiMemberRead(
                    customer_id=customer.id,
                    name=customer.name,
                    phone=customer.phone,
                    order_count=len(c_orders),
                    total_items=c_total_items,
                    total_value=c_total_value,
                    items=item_reads,
                )
            )
            sp_total_items += c_total_items
            sp_total_value += c_total_value

        sp_reads.append(
            KpiSalespersonRead(
                sales_id=sp.id,
                sales_name=sp.name,
                member_count=len(sp_customers),
                buying_member_count=buying_count,
                total_items=sp_total_items,
                total_value=sp_total_value,
                members=member_reads,
            )
        )

    return SalespersonKpiReportRead(from_=from_, to=to, salespeople=sp_reads)
