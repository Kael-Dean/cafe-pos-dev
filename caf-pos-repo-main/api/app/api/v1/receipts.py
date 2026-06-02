from fastapi import APIRouter, Depends, Query

from app.deps import DbSession, StoreUser, require_role
from app.enums import ReceiptStatus, Role
from app.schemas.receipts import (
    StockLotCreate,
    StockReceiptCreate,
    StockReceiptRead,
    StockReceiptsPage,
)
from app.services import receipts as svc

router = APIRouter(prefix="/receipts", tags=["receipts"])

_MANAGER_PLUS = require_role(Role.OWNER, Role.MANAGER)


@router.post(
    "",
    response_model=StockReceiptRead,
    status_code=201,
    summary="Create a new DRAFT receipt",
    operation_id="receipts_create",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def create_receipt(
    payload: StockReceiptCreate,
    user: StoreUser,
    db: DbSession,
) -> StockReceiptRead:
    return await svc.create_receipt(db, store_id=user.store_id, user_id=user.id, payload=payload)


@router.get(
    "",
    response_model=StockReceiptsPage,
    summary="Paginated list of receipts",
    operation_id="receipts_list",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def list_receipts(
    user: StoreUser,
    db: DbSession,
    status: ReceiptStatus | None = Query(None),
    cursor: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
) -> StockReceiptsPage:
    return await svc.list_receipts(
        db, store_id=user.store_id, status=status, cursor=cursor, limit=limit
    )


@router.get(
    "/{receipt_id}",
    response_model=StockReceiptRead,
    summary="Get receipt with all lots",
    operation_id="receipts_get",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def get_receipt(receipt_id: str, user: StoreUser, db: DbSession) -> StockReceiptRead:
    return await svc.get_receipt(db, store_id=user.store_id, receipt_id=receipt_id)


@router.post(
    "/{receipt_id}/lots",
    response_model=StockReceiptRead,
    status_code=201,
    summary="Add a lot to a DRAFT receipt",
    operation_id="receipts_add_lot",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def add_lot(
    receipt_id: str,
    payload: StockLotCreate,
    user: StoreUser,
    db: DbSession,
) -> StockReceiptRead:
    return await svc.add_lot(db, store_id=user.store_id, receipt_id=receipt_id, payload=payload)


@router.delete(
    "/{receipt_id}/lots/{lot_id}",
    status_code=204,
    summary="Remove a lot from a DRAFT receipt",
    operation_id="receipts_remove_lot",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def remove_lot(receipt_id: str, lot_id: str, user: StoreUser, db: DbSession) -> None:
    await svc.remove_lot(db, store_id=user.store_id, receipt_id=receipt_id, lot_id=lot_id)


@router.post(
    "/{receipt_id}/confirm",
    response_model=StockReceiptRead,
    summary="Confirm receipt — applies stock atomically, locks receipt",
    operation_id="receipts_confirm",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def confirm_receipt(receipt_id: str, user: StoreUser, db: DbSession) -> StockReceiptRead:
    return await svc.confirm_receipt(
        db, store_id=user.store_id, user_id=user.id, receipt_id=receipt_id
    )
