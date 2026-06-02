from fastapi import APIRouter

from app.deps import DbSession, StoreUser
from app.schemas.stock_takes import StockTakeAdjustResult, StockTakeEvent, StockTakePreview, StockTakeSubmit
from app.services import stock_takes as svc

router = APIRouter(prefix="/stock-takes", tags=["stock-takes"])


@router.get(
    "/preview",
    response_model=StockTakePreview,
    summary="Get stock take preview for current period",
    operation_id="stock_take_preview",
)
async def preview(user: StoreUser, db: DbSession) -> StockTakePreview:
    return await svc.get_preview(db, store_id=user.store_id)


@router.post(
    "",
    response_model=list[StockTakeAdjustResult],
    summary="Submit actual stock counts and reconcile variances",
    operation_id="stock_take_submit",
)
async def submit(
    payload: StockTakeSubmit,
    user: StoreUser,
    db: DbSession,
) -> list[StockTakeAdjustResult]:
    return await svc.submit_stock_take(db, store_id=user.store_id, user_id=user.id, payload=payload)


@router.get(
    "/history",
    response_model=list[StockTakeEvent],
    summary="List past stock take events",
    operation_id="stock_take_history",
)
async def history(user: StoreUser, db: DbSession) -> list[StockTakeEvent]:
    return await svc.get_history(db, store_id=user.store_id)
