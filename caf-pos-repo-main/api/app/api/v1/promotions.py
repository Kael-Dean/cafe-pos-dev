from fastapi import APIRouter, Depends

from app.deps import DbSession, StoreUser, require_role
from app.enums import Role
from app.schemas.operations import PromotionCreate, PromotionRead, PromotionUpdate
from app.services import operations as svc

router = APIRouter(prefix="/promotions", tags=["promotions"])

_ALL_STAFF = require_role(Role.OWNER, Role.MANAGER, Role.BARISTA, Role.BAKER)
_MANAGER_PLUS = require_role(Role.OWNER, Role.MANAGER)


@router.get(
    "",
    response_model=list[PromotionRead],
    summary="List all promotions for this store",
    operation_id="promotions_list",
    dependencies=[Depends(_ALL_STAFF)],
)
async def list_promotions(user: StoreUser, db: DbSession) -> list[PromotionRead]:
    promos = await svc.list_promotions(db, store_id=user.store_id)
    return [PromotionRead.model_validate(p) for p in promos]


@router.post(
    "",
    response_model=PromotionRead,
    status_code=201,
    summary="Create a promotion",
    operation_id="promotions_create",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def create_promotion(
    payload: PromotionCreate,
    user: StoreUser,
    db: DbSession,
) -> PromotionRead:
    promo = await svc.create_promotion(db, store_id=user.store_id, user_id=user.id, payload=payload)
    return PromotionRead.model_validate(promo)


@router.patch(
    "/{promo_id}",
    response_model=PromotionRead,
    summary="Update a promotion",
    operation_id="promotions_update",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def update_promotion(
    promo_id: str,
    payload: PromotionUpdate,
    user: StoreUser,
    db: DbSession,
) -> PromotionRead:
    promo = await svc.update_promotion(db, store_id=user.store_id, promo_id=promo_id, payload=payload)
    return PromotionRead.model_validate(promo)


@router.delete(
    "/{promo_id}",
    status_code=204,
    summary="Delete a promotion",
    operation_id="promotions_delete",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def delete_promotion(promo_id: str, user: StoreUser, db: DbSession) -> None:
    await svc.delete_promotion(db, store_id=user.store_id, promo_id=promo_id)
