from fastapi import APIRouter, Depends

from app.deps import DbSession, StoreUser, require_role
from app.enums import Role
from app.schemas.operations import ProtocolCreate, ProtocolLogCreate, ProtocolLogRead, ProtocolRead
from app.services import operations as svc

router = APIRouter(prefix="/protocols", tags=["protocols"])

_ALL_STAFF = require_role(Role.OWNER, Role.MANAGER, Role.BARISTA, Role.BAKER)
_MANAGER_PLUS = require_role(Role.OWNER, Role.MANAGER)


@router.get(
    "",
    response_model=list[ProtocolRead],
    summary="List active protocols for this store",
    operation_id="protocols_list",
    dependencies=[Depends(_ALL_STAFF)],
)
async def list_protocols(user: StoreUser, db: DbSession) -> list[ProtocolRead]:
    protocols = await svc.list_protocols(db, store_id=user.store_id)
    return [ProtocolRead.model_validate(p) for p in protocols]


@router.post(
    "",
    response_model=ProtocolRead,
    status_code=201,
    summary="Create a new protocol (SOP)",
    operation_id="protocols_create",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def create_protocol(
    payload: ProtocolCreate,
    user: StoreUser,
    db: DbSession,
) -> ProtocolRead:
    protocol = await svc.create_protocol(db, store_id=user.store_id, user_id=user.id, payload=payload)
    return ProtocolRead.model_validate(protocol)


@router.get(
    "/logs/today",
    response_model=list[ProtocolLogRead],
    summary="Get today's protocol completion logs",
    operation_id="protocols_logs_today",
    dependencies=[Depends(_ALL_STAFF)],
)
async def get_today_logs(user: StoreUser, db: DbSession) -> list[ProtocolLogRead]:
    logs = await svc.get_today_protocol_logs(db, store_id=user.store_id)
    return [ProtocolLogRead.model_validate(log) for log in logs]


@router.post(
    "/log",
    response_model=ProtocolLogRead,
    status_code=201,
    summary="Log completed tasks for a protocol (upsert)",
    operation_id="protocols_log",
    dependencies=[Depends(_ALL_STAFF)],
)
async def log_protocol(
    payload: ProtocolLogCreate,
    user: StoreUser,
    db: DbSession,
) -> ProtocolLogRead:
    log = await svc.log_protocol(db, store_id=user.store_id, user_id=user.id, payload=payload)
    return ProtocolLogRead.model_validate(log)
