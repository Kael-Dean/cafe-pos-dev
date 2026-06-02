from fastapi import APIRouter, Query

from app.deps import DbSession, StoreUser
from app.enums import PreOrderStatus
from app.schemas.pre_orders import (
    FulfillmentModeUpdate,
    IngredientSummary,
    PreOrderCreate,
    PreOrderItemIn,
    PreOrderRead,
    PreOrdersPage,
    PreOrderUpdate,
)
from app.services import pre_orders as svc

router = APIRouter(prefix="/pre-orders", tags=["pre-orders"])


@router.post("", response_model=PreOrderRead, status_code=201,
             summary="Create a pre-order", operation_id="pre_orders_create")
async def create_pre_order(
    payload: PreOrderCreate, user: StoreUser, db: DbSession
) -> PreOrderRead:
    return await svc.create_pre_order(db, store_id=user.store_id, user_id=user.id, payload=payload)


@router.get("", response_model=PreOrdersPage,
            summary="List pre-orders ordered by due date", operation_id="pre_orders_list")
async def list_pre_orders(
    user: StoreUser,
    db: DbSession,
    status: PreOrderStatus | None = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
) -> PreOrdersPage:
    return await svc.list_pre_orders(db, store_id=user.store_id, status=status, page=page, limit=limit)


@router.get("/{pre_order_id}", response_model=PreOrderRead,
            summary="Get pre-order detail", operation_id="pre_orders_get")
async def get_pre_order(pre_order_id: str, user: StoreUser, db: DbSession) -> PreOrderRead:
    return await svc.get_pre_order(db, store_id=user.store_id, pre_order_id=pre_order_id)


@router.patch("/{pre_order_id}", response_model=PreOrderRead,
              summary="Update pre-order header (PENDING only)", operation_id="pre_orders_update")
async def update_pre_order(
    pre_order_id: str, payload: PreOrderUpdate, user: StoreUser, db: DbSession
) -> PreOrderRead:
    return await svc.update_pre_order(db, store_id=user.store_id, pre_order_id=pre_order_id, payload=payload)


@router.post("/{pre_order_id}/items", response_model=PreOrderRead, status_code=201,
             summary="Add item to pre-order (PENDING only)", operation_id="pre_orders_add_item")
async def add_item(
    pre_order_id: str, payload: PreOrderItemIn, user: StoreUser, db: DbSession
) -> PreOrderRead:
    return await svc.add_item(db, store_id=user.store_id, pre_order_id=pre_order_id, item_in=payload)


@router.delete("/{pre_order_id}/items/{item_id}", response_model=PreOrderRead,
               summary="Remove item from pre-order (PENDING only)", operation_id="pre_orders_remove_item")
async def remove_item(
    pre_order_id: str, item_id: str, user: StoreUser, db: DbSession
) -> PreOrderRead:
    return await svc.remove_item(db, store_id=user.store_id, pre_order_id=pre_order_id, item_id=item_id)


@router.patch(
    "/{pre_order_id}/items/{item_id}/fulfillment",
    response_model=PreOrderRead,
    summary="Set fulfillment mode on a PRODUCED item (PENDING only)",
    operation_id="pre_orders_set_fulfillment",
)
async def set_item_fulfillment(
    pre_order_id: str, item_id: str, payload: FulfillmentModeUpdate,
    user: StoreUser, db: DbSession,
) -> PreOrderRead:
    return await svc.set_item_fulfillment(
        db,
        store_id=user.store_id,
        pre_order_id=pre_order_id,
        item_id=item_id,
        mode=payload.fulfillment_mode,
    )


@router.get("/{pre_order_id}/ingredients", response_model=IngredientSummary,
            summary="Ingredient summary with stock threshold check", operation_id="pre_orders_ingredients")
async def get_ingredient_summary(
    pre_order_id: str,
    user: StoreUser,
    db: DbSession,
    threshold: float = Query(50.0, ge=0, le=100),
) -> IngredientSummary:
    return await svc.get_ingredient_summary(
        db, store_id=user.store_id, pre_order_id=pre_order_id, threshold=threshold
    )


@router.post("/{pre_order_id}/start", response_model=PreOrderRead,
             summary="Start order — deducts stock, PENDING → IN_PROGRESS", operation_id="pre_orders_start")
async def start_pre_order(pre_order_id: str, user: StoreUser, db: DbSession) -> PreOrderRead:
    return await svc.start_pre_order(db, store_id=user.store_id, user_id=user.id, pre_order_id=pre_order_id)


@router.post("/{pre_order_id}/complete", response_model=PreOrderRead,
             summary="Complete order — IN_PROGRESS → COMPLETED", operation_id="pre_orders_complete")
async def complete_pre_order(pre_order_id: str, user: StoreUser, db: DbSession) -> PreOrderRead:
    return await svc.complete_pre_order(db, store_id=user.store_id, user_id=user.id, pre_order_id=pre_order_id)


@router.post("/{pre_order_id}/cancel", response_model=PreOrderRead,
             summary="Cancel order — PENDING → CANCELLED", operation_id="pre_orders_cancel")
async def cancel_pre_order(pre_order_id: str, user: StoreUser, db: DbSession) -> PreOrderRead:
    return await svc.cancel_pre_order(db, store_id=user.store_id, pre_order_id=pre_order_id)
