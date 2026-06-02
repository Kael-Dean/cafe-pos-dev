from fastapi import APIRouter, Depends, Query

from app.deps import DbSession, StoreUser, require_role
from app.enums import Role
from app.schemas.membership import (
    AccountRead,
    AdjustPointsRequest,
    LookupRequest,
    LookupResponse,
    MemberRead,
    MembersPage,
    ProgramRead,
    RegisterMemberRequest,
    RewardProductRead,
    SetRewardProductsRequest,
    UpsertProgramRequest,
)
from app.services import membership as svc

router = APIRouter(prefix="/membership", tags=["membership"])

_OWNER_ONLY = require_role(Role.OWNER)
_MANAGER_PLUS = require_role(Role.OWNER, Role.MANAGER)


@router.get("/program", response_model=ProgramRead | None, operation_id="membership_get_program")
async def get_program(user: StoreUser, db: DbSession) -> ProgramRead | None:
    return await svc.get_program(db, store_id=user.store_id)


@router.put(
    "/program",
    response_model=ProgramRead,
    operation_id="membership_upsert_program",
    dependencies=[Depends(_OWNER_ONLY)],
)
async def upsert_program(
    user: StoreUser, db: DbSession, req: UpsertProgramRequest
) -> ProgramRead:
    return await svc.upsert_program(db, store_id=user.store_id, req=req)


@router.get(
    "/program/reward-products",
    response_model=list[RewardProductRead],
    operation_id="membership_get_reward_products",
    dependencies=[Depends(_OWNER_ONLY)],
)
async def get_reward_products(user: StoreUser, db: DbSession) -> list[RewardProductRead]:
    return await svc.get_reward_products(db, store_id=user.store_id)


@router.put(
    "/program/reward-products",
    response_model=list[RewardProductRead],
    operation_id="membership_set_reward_products",
    dependencies=[Depends(_OWNER_ONLY)],
)
async def set_reward_products(
    user: StoreUser, db: DbSession, req: SetRewardProductsRequest
) -> list[RewardProductRead]:
    return await svc.set_reward_products(db, store_id=user.store_id, product_ids=req.product_ids)


@router.post("/lookup", response_model=LookupResponse, operation_id="membership_lookup")
async def lookup_member(user: StoreUser, db: DbSession, req: LookupRequest) -> LookupResponse:
    return await svc.lookup_member(db, store_id=user.store_id, phone=req.phone)


@router.post("/register", response_model=AccountRead, operation_id="membership_register")
async def register_member(
    user: StoreUser, db: DbSession, req: RegisterMemberRequest
) -> AccountRead:
    return await svc.register_member(db, store_id=user.store_id, user_id=user.id, req=req)


@router.get(
    "/members",
    response_model=MembersPage,
    operation_id="membership_list_members",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def list_members(
    user: StoreUser,
    db: DbSession,
    name: str | None = Query(default=None),
    phone: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=50, ge=1, le=200),
) -> MembersPage:
    return await svc.list_members(
        db, store_id=user.store_id, name=name, phone=phone, page=page, limit=limit
    )


@router.get(
    "/members/{account_id}",
    response_model=MemberRead,
    operation_id="membership_get_member",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def get_member(account_id: str, user: StoreUser, db: DbSession) -> MemberRead:
    return await svc.get_member(db, store_id=user.store_id, account_id=account_id)


@router.post(
    "/members/{account_id}/adjust",
    response_model=MemberRead,
    operation_id="membership_adjust_points",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def adjust_points(
    account_id: str, user: StoreUser, db: DbSession, req: AdjustPointsRequest
) -> MemberRead:
    return await svc.adjust_points(
        db, store_id=user.store_id, account_id=account_id, user_id=user.id, req=req
    )
