from fastapi import APIRouter, Depends, Query

from app.deps import DbSession, StoreUser, require_role
from app.enums import Role
from app.schemas.promotions import (
    EvaluateRequest,
    EvaluateResponse,
    PromotionBaselineResponse,
    PromotionCreate,
    PromotionListResponse,
    PromotionRead,
    PromotionUpdate,
)
from app.services import promotions as svc

_MANAGER_PLUS = require_role(Role.OWNER, Role.MANAGER)

router = APIRouter(prefix="/promotions", tags=["promotions"])


@router.get(
    "/calculator/baseline",
    response_model=PromotionBaselineResponse,
    summary="Sales baseline for promotion break-even analysis",
    operation_id="promotions_calculator_baseline",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def get_promotion_baseline(
    product_id: str,
    days: int = Query(default=30, ge=1, le=365, description="Sales window in days (1–365)"),
    user: StoreUser = ...,
    db: DbSession = ...,
) -> PromotionBaselineResponse:
    return await svc.get_promotion_baseline(
        db,
        store_id=user.store_id,
        product_id=product_id,
        days=days,
    )


@router.post(
    "/evaluate",
    response_model=EvaluateResponse,
    summary="Evaluate cart for eligible promotions",
    operation_id="promotions_evaluate",
)
async def evaluate_promotions(
    payload: EvaluateRequest,
    user: StoreUser = ...,
    db: DbSession = ...,
) -> EvaluateResponse:
    return await svc.evaluate_promotions(db, store_id=user.store_id, items=payload.items)


@router.post(
    "",
    response_model=PromotionRead,
    status_code=201,
    summary="Create a promotion rule",
    operation_id="promotions_create",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def create_promotion(
    payload: PromotionCreate,
    user: StoreUser = ...,
    db: DbSession = ...,
) -> PromotionRead:
    return await svc.create_promotion(db, store_id=user.store_id, req=payload)


@router.get(
    "",
    response_model=PromotionListResponse,
    summary="List promotion rules",
    operation_id="promotions_list",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def list_promotions(
    active: bool | None = Query(None),
    user: StoreUser = ...,
    db: DbSession = ...,
) -> PromotionListResponse:
    items = await svc.list_promotions(db, store_id=user.store_id, active=active)
    return PromotionListResponse(items=items, total=len(items))


@router.get(
    "/{promotion_id}",
    response_model=PromotionRead,
    summary="Get a promotion rule",
    operation_id="promotions_get",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def get_promotion(
    promotion_id: str,
    user: StoreUser = ...,
    db: DbSession = ...,
) -> PromotionRead:
    return await svc.get_promotion(db, store_id=user.store_id, promotion_id=promotion_id)


@router.patch(
    "/{promotion_id}",
    response_model=PromotionRead,
    summary="Update a promotion rule",
    operation_id="promotions_update",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def update_promotion(
    promotion_id: str,
    payload: PromotionUpdate,
    user: StoreUser = ...,
    db: DbSession = ...,
) -> PromotionRead:
    return await svc.update_promotion(
        db, store_id=user.store_id, promotion_id=promotion_id, req=payload
    )


@router.delete(
    "/{promotion_id}",
    status_code=204,
    summary="Delete a promotion rule",
    operation_id="promotions_delete",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def delete_promotion(
    promotion_id: str,
    user: StoreUser = ...,
    db: DbSession = ...,
) -> None:
    await svc.delete_promotion(db, store_id=user.store_id, promotion_id=promotion_id)
