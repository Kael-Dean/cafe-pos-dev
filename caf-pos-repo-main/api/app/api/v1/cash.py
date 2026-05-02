from fastapi import APIRouter, Depends

from app.deps import DbSession, StoreUser, require_role
from app.enums import Role
from app.schemas.operations import CashPayoutCreate, CashSessionClose, CashSessionCreate, CashSessionRead
from app.services import operations as svc

router = APIRouter(prefix="/cash", tags=["cash"])

_ALL_STAFF = require_role(Role.OWNER, Role.MANAGER, Role.BARISTA, Role.BAKER)
_MANAGER_PLUS = require_role(Role.OWNER, Role.MANAGER)


@router.get(
    "/sessions/today",
    response_model=CashSessionRead | None,
    summary="Get today's cash session for this store",
    operation_id="cash_get_today",
    dependencies=[Depends(_ALL_STAFF)],
)
async def get_today(user: StoreUser, db: DbSession) -> CashSessionRead | None:
    session = await svc.get_today_session(db, store_id=user.store_id)
    if not session:
        return None
    return CashSessionRead.model_validate(session)


@router.post(
    "/sessions",
    response_model=CashSessionRead,
    status_code=201,
    summary="Open a new cash session (drawer opening)",
    operation_id="cash_open_session",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def open_session(
    payload: CashSessionCreate,
    user: StoreUser,
    db: DbSession,
) -> CashSessionRead:
    session = await svc.open_cash_session(db, store_id=user.store_id, user_id=user.id, payload=payload)
    return CashSessionRead.model_validate(session)


@router.post(
    "/sessions/{session_id}/close",
    response_model=CashSessionRead,
    summary="Close a cash session (drawer closing / reconciliation)",
    operation_id="cash_close_session",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def close_session(
    session_id: str,
    payload: CashSessionClose,
    user: StoreUser,
    db: DbSession,
) -> CashSessionRead:
    session = await svc.close_cash_session(
        db, store_id=user.store_id, session_id=session_id, user_id=user.id, payload=payload
    )
    return CashSessionRead.model_validate(session)


@router.post(
    "/sessions/{session_id}/payouts",
    response_model=CashSessionRead,
    status_code=201,
    summary="Record a cash payout / withdrawal from the drawer",
    operation_id="cash_add_payout",
    dependencies=[Depends(_ALL_STAFF)],
)
async def add_payout(
    session_id: str,
    payload: CashPayoutCreate,
    user: StoreUser,
    db: DbSession,
) -> CashSessionRead:
    session = await svc.add_payout(
        db, store_id=user.store_id, session_id=session_id, user_id=user.id, payload=payload
    )
    return CashSessionRead.model_validate(session)
