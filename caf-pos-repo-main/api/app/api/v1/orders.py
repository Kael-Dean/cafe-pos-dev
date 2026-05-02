from datetime import datetime

from fastapi import APIRouter, Depends, Query

from app.deps import DbSession, PusherDep, StoreUser, require_role
from app.enums import OrderStatus, Role
from app.schemas.orders import (
    CreateOrderRequest,
    OrderRead,
    OrdersPage,
    PayOrderRequest,
    UpdateStatusRequest,
    VoidOrderRequest,
)
from app.services import orders as svc

router = APIRouter(prefix="/orders", tags=["orders"])

_BARISTA_PLUS = require_role(Role.OWNER, Role.MANAGER, Role.BARISTA, Role.BAKER)
_MANAGER_PLUS = require_role(Role.OWNER, Role.MANAGER)


@router.post(
    "",
    response_model=OrderRead,
    status_code=201,
    summary="Create order — atomic BOM deduction + idempotency guard",
    operation_id="orders_create",
    dependencies=[Depends(_BARISTA_PLUS)],
)
async def create_order(
    payload: CreateOrderRequest,
    user: StoreUser,
    db: DbSession,
    pusher: PusherDep,
) -> OrderRead:
    order = await svc.create_order(db, pusher, store_id=user.store_id, user_id=user.id, req=payload)
    return await svc.get_order(db, store_id=user.store_id, order_id=order.id)


@router.get(
    "",
    response_model=OrdersPage,
    summary="List orders with optional filters",
    operation_id="orders_list",
)
async def list_orders(
    user: StoreUser,
    db: DbSession,
    status: list[OrderStatus] | None = Query(None),
    customer_id: str | None = Query(None),
    from_dt: datetime | None = Query(None, alias="from"),
    to_dt: datetime | None = Query(None, alias="to"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
) -> OrdersPage:
    return await svc.list_orders(
        db,
        store_id=user.store_id,
        status=status,
        customer_id=customer_id,
        from_dt=from_dt,
        to_dt=to_dt,
        page=page,
        limit=limit,
    )


@router.get(
    "/{order_id}",
    response_model=OrderRead,
    summary="Order detail including items and modifier snapshots",
    operation_id="orders_get",
)
async def get_order(order_id: str, user: StoreUser, db: DbSession) -> OrderRead:
    return await svc.get_order(db, store_id=user.store_id, order_id=order_id)


@router.patch(
    "/{order_id}/pay",
    response_model=OrderRead,
    summary="Mark order paid — transitions PENDING → PAID",
    operation_id="orders_pay",
    dependencies=[Depends(_BARISTA_PLUS)],
)
async def pay_order(
    order_id: str,
    payload: PayOrderRequest,
    user: StoreUser,
    db: DbSession,
) -> OrderRead:
    order = await svc.pay_order(db, store_id=user.store_id, order_id=order_id, req=payload)
    return await svc.get_order(db, store_id=user.store_id, order_id=order.id)


@router.patch(
    "/{order_id}/status",
    response_model=OrderRead,
    summary="Advance KDS status — PAID→IN_PROGRESS→READY→COMPLETED",
    operation_id="orders_update_status",
    dependencies=[Depends(_BARISTA_PLUS)],
)
async def update_status(
    order_id: str,
    payload: UpdateStatusRequest,
    user: StoreUser,
    db: DbSession,
    pusher: PusherDep,
) -> OrderRead:
    order = await svc.update_status(db, pusher, store_id=user.store_id, order_id=order_id, req=payload)
    return await svc.get_order(db, store_id=user.store_id, order_id=order.id)


@router.post(
    "/{order_id}/void",
    response_model=OrderRead,
    summary="Void order — reverses stock deductions and writes void log",
    operation_id="orders_void",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def void_order(
    order_id: str,
    payload: VoidOrderRequest,
    user: StoreUser,
    db: DbSession,
    pusher: PusherDep,
) -> OrderRead:
    order = await svc.void_order(
        db, pusher, store_id=user.store_id, order_id=order_id, user_id=user.id, req=payload
    )
    return await svc.get_order(db, store_id=user.store_id, order_id=order.id)
