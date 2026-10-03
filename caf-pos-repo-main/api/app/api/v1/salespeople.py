from fastapi import APIRouter, Depends

from app.deps import DbSession, StoreUser, require_role
from app.enums import Role
from app.schemas.salespeople import SalespersonCreate, SalespersonRead, SalespersonUpdate
from app.services import salespeople as svc

router = APIRouter(prefix="/salespeople", tags=["salespeople"])

_BARISTA_PLUS = require_role(Role.OWNER, Role.MANAGER, Role.BARISTA, Role.BAKER)
_MANAGER_PLUS = require_role(Role.OWNER, Role.MANAGER)


@router.get(
    "",
    response_model=list[SalespersonRead],
    operation_id="salespeople_list",
    dependencies=[Depends(_BARISTA_PLUS)],
)
async def list_salespeople(user: StoreUser, db: DbSession) -> list[SalespersonRead]:
    return await svc.list_salespeople(db=db, store_id=user.store_id)


@router.post(
    "",
    response_model=SalespersonRead,
    status_code=201,
    summary="Create a salesperson",
    operation_id="salespeople_create",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def create_salesperson(payload: SalespersonCreate, user: StoreUser, db: DbSession) -> SalespersonRead:
    sp = await svc.create_salesperson(db, store_id=user.store_id, payload=payload)
    return SalespersonRead.model_validate(sp)


@router.patch(
    "/{sales_id}",
    response_model=SalespersonRead,
    summary="Rename or (de)activate a salesperson",
    operation_id="salespeople_update",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def update_salesperson(
    sales_id: str, payload: SalespersonUpdate, user: StoreUser, db: DbSession
) -> SalespersonRead:
    sp = await svc.update_salesperson(db, store_id=user.store_id, sales_id=sales_id, payload=payload)
    return SalespersonRead.model_validate(sp)


@router.delete(
    "/{sales_id}",
    status_code=204,
    summary="Soft-delete a salesperson",
    operation_id="salespeople_delete",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def delete_salesperson(sales_id: str, user: StoreUser, db: DbSession) -> None:
    await svc.delete_salesperson(db, store_id=user.store_id, sales_id=sales_id)
