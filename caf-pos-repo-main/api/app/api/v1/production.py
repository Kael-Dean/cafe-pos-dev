from datetime import date

from fastapi import APIRouter, Query

from app.deps import DbSession, StoreUser
from app.schemas.production import ProductionOrderCreate, ProductionOrderRead
from app.services import production as svc

router = APIRouter(prefix="/production-orders", tags=["production"])


@router.post(
    "",
    response_model=ProductionOrderRead,
    status_code=201,
    summary="Record a production run — atomically deducts ingredients and adds finished goods",
    operation_id="production_orders_create",
)
async def create_production_order(
    payload: ProductionOrderCreate, user: StoreUser, db: DbSession
) -> ProductionOrderRead:
    order = await svc.create_production_order(
        db, store_id=user.store_id, user_id=user.id, payload=payload
    )
    return ProductionOrderRead.model_validate(order)


@router.get(
    "",
    response_model=list[ProductionOrderRead],
    summary="List production orders for the current store",
    operation_id="production_orders_list",
)
async def list_production_orders(
    user: StoreUser,
    db: DbSession,
    product_id: str | None = Query(None),
    from_: date | None = Query(None, alias="from"),
    to: date | None = Query(None),
) -> list[ProductionOrderRead]:
    orders = await svc.list_production_orders(
        db, store_id=user.store_id, product_id=product_id, from_=from_, to=to
    )
    return [ProductionOrderRead.model_validate(o) for o in orders]


@router.get(
    "/{order_id}",
    response_model=ProductionOrderRead,
    summary="Get a single production order by ID",
    operation_id="production_orders_get",
)
async def get_production_order(
    order_id: str, user: StoreUser, db: DbSession
) -> ProductionOrderRead:
    order = await svc.get_production_order(db, store_id=user.store_id, order_id=order_id)
    return ProductionOrderRead.model_validate(order)
