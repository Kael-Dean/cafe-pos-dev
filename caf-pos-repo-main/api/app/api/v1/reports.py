from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Query

from app.deps import DbSession, StoreUser, require_role
from app.enums import Role
from app.schemas.reports import (
    CashierShiftsReportRead,
    CogsReportRead,
    DashboardTodayRead,
    LowStockReportRead,
    SalesReportRead,
    WastageReportRead,
)
from app.services import reports as svc

router = APIRouter(tags=["reports"])

_MANAGER_PLUS = require_role(Role.OWNER, Role.MANAGER)


@router.get(
    "/dashboard/today",
    response_model=DashboardTodayRead,
    operation_id="reports_dashboard_today",
)
async def get_dashboard_today(user: StoreUser, db: DbSession) -> DashboardTodayRead:
    return await svc.get_dashboard_today(db=db, store_id=user.store_id)


@router.get(
    "/reports/sales",
    response_model=SalesReportRead,
    operation_id="reports_sales",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def get_sales_report(
    user: StoreUser,
    db: DbSession,
    from_: datetime = Query(alias="from"),
    to: datetime = Query(),
    granularity: Literal["day", "hour", "product", "category", "payment_method"] = Query(default="day"),
) -> SalesReportRead:
    return await svc.get_sales_report(db=db, store_id=user.store_id, from_=from_, to=to, granularity=granularity)


@router.get(
    "/reports/inventory-cogs",
    response_model=CogsReportRead,
    operation_id="reports_inventory_cogs",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def get_cogs_report(
    user: StoreUser,
    db: DbSession,
    from_: datetime = Query(alias="from"),
    to: datetime = Query(),
) -> CogsReportRead:
    return await svc.get_cogs_report(db=db, store_id=user.store_id, from_=from_, to=to)


@router.get(
    "/reports/wastage",
    response_model=WastageReportRead,
    operation_id="reports_wastage",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def get_wastage_report(
    user: StoreUser,
    db: DbSession,
    from_: datetime = Query(alias="from"),
    to: datetime = Query(),
) -> WastageReportRead:
    return await svc.get_wastage_report(db=db, store_id=user.store_id, from_=from_, to=to)


@router.get(
    "/reports/low-stock",
    response_model=LowStockReportRead,
    operation_id="reports_low_stock",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def get_low_stock_report(user: StoreUser, db: DbSession) -> LowStockReportRead:
    return await svc.get_low_stock_report(db=db, store_id=user.store_id)


@router.get(
    "/reports/cashier-shifts",
    response_model=CashierShiftsReportRead,
    operation_id="reports_cashier_shifts",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def get_cashier_shifts_report(
    user: StoreUser,
    db: DbSession,
    from_: datetime = Query(alias="from"),
    to: datetime = Query(),
) -> CashierShiftsReportRead:
    return await svc.get_cashier_shifts_report(db=db, store_id=user.store_id, from_=from_, to=to)
