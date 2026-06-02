from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.exc import IntegrityError

from app.deps import DbSession, StoreUser, require_role
from app.enums import Role, TaskStatus
from app.schemas.hr import (
    CashSessionClose,
    CashSessionCreate,
    CashSessionRead,
    LeaveCreate,
    LeaveRead,
    LeaveReview,
    ShiftCreate,
    ShiftRead,
    StaffCreate,
    StaffRead,
    StaffUpdate,
    TaskCreate,
    TaskRead,
    TaskUpdate,
)
from app.services import hr as hr_svc

router = APIRouter(prefix="/hr", tags=["hr"])

_BARISTA_PLUS = require_role(Role.OWNER, Role.MANAGER, Role.BARISTA, Role.BAKER)
_MANAGER_PLUS = require_role(Role.OWNER, Role.MANAGER)


# ---------------------------------------------------------------------------
# Staff
# ---------------------------------------------------------------------------


@router.get(
    "/staff",
    response_model=list[StaffRead],
    summary="List all active staff in the current store",
    operation_id="hr_staff_list",
)
async def list_staff(user: StoreUser, db: DbSession) -> list[StaffRead]:
    rows = await hr_svc.list_staff(db, store_id=user.store_id)
    return [StaffRead.model_validate(r) for r in rows]


@router.get(
    "/staff/{user_id}",
    response_model=StaffRead,
    summary="Get a single staff member's full profile",
    operation_id="hr_staff_get",
)
async def get_staff(user_id: str, user: StoreUser, db: DbSession) -> StaffRead:
    staff = await hr_svc.get_staff(db, store_id=user.store_id, user_id=user_id)
    return StaffRead.model_validate(staff)


@router.post(
    "/staff",
    response_model=StaffRead,
    status_code=201,
    summary="Create a new staff member",
    operation_id="hr_staff_create",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def create_staff(payload: StaffCreate, user: StoreUser, db: DbSession) -> StaffRead:
    try:
        staff = await hr_svc.create_staff(
            db, store_id=user.store_id, tenant_id=user.tenant_id, payload=payload
        )
    except IntegrityError as e:
        orig = str(getattr(e, "orig", e))
        if "uq_staff_store_phone" in orig:
            raise HTTPException(409, detail="A staff member with this phone number already exists.") from e
        if "uq_staff_store_email" in orig:
            raise HTTPException(409, detail="A staff member with this email already exists.") from e
        raise
    return StaffRead.model_validate(staff)


@router.patch(
    "/staff/{user_id}",
    response_model=StaffRead,
    summary="Update a staff member's name, role, position, PIN, or contact details",
    operation_id="hr_staff_update",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def update_staff(
    user_id: str, payload: StaffUpdate, user: StoreUser, db: DbSession
) -> StaffRead:
    try:
        staff = await hr_svc.update_staff(
            db, store_id=user.store_id, user_id=user_id, payload=payload
        )
    except IntegrityError as e:
        orig = str(getattr(e, "orig", e))
        if "uq_staff_store_phone" in orig:
            raise HTTPException(409, detail="A staff member with this phone number already exists.") from e
        if "uq_staff_store_email" in orig:
            raise HTTPException(409, detail="A staff member with this email already exists.") from e
        raise
    return StaffRead.model_validate(staff)


@router.delete(
    "/staff/{user_id}",
    status_code=204,
    summary="Soft-delete a staff member (sets is_active=False)",
    operation_id="hr_staff_delete",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def delete_staff(user_id: str, user: StoreUser, db: DbSession) -> None:
    await hr_svc.delete_staff(db, store_id=user.store_id, user_id=user_id)


# ---------------------------------------------------------------------------
# Leaves
# ---------------------------------------------------------------------------


@router.get(
    "/leaves",
    response_model=list[LeaveRead],
    summary="List leave requests (managers see all; others see own)",
    operation_id="hr_leaves_list",
)
async def list_leaves(user: StoreUser, db: DbSession) -> list[LeaveRead]:
    filter_user_id = None if user.role in {Role.OWNER, Role.MANAGER} else user.id
    return await hr_svc.list_leaves(db, store_id=user.store_id, user_id=filter_user_id)


@router.get(
    "/leaves/mine",
    response_model=list[LeaveRead],
    summary="List the current user's own leave requests",
    operation_id="hr_leaves_mine",
)
async def my_leaves(user: StoreUser, db: DbSession) -> list[LeaveRead]:
    return await hr_svc.list_leaves(db, store_id=user.store_id, user_id=user.id)


@router.post(
    "/leaves",
    response_model=LeaveRead,
    status_code=201,
    summary="Submit a leave request",
    operation_id="hr_leaves_create",
    dependencies=[Depends(_BARISTA_PLUS)],
)
async def create_leave(payload: LeaveCreate, user: StoreUser, db: DbSession) -> LeaveRead:
    return await hr_svc.create_leave(
        db, store_id=user.store_id, user_id=user.id, payload=payload
    )


@router.patch(
    "/leaves/{leave_id}/review",
    response_model=LeaveRead,
    summary="Approve or reject a leave request",
    operation_id="hr_leaves_review",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def review_leave(
    leave_id: str, payload: LeaveReview, user: StoreUser, db: DbSession
) -> LeaveRead:
    return await hr_svc.review_leave(
        db, store_id=user.store_id, leave_id=leave_id, reviewer_id=user.id, payload=payload
    )


# ---------------------------------------------------------------------------
# Shifts
# ---------------------------------------------------------------------------


@router.get(
    "/shifts",
    response_model=list[ShiftRead],
    summary="List shift assignments, optionally filtered to a week",
    operation_id="hr_shifts_list",
)
async def list_shifts(
    user: StoreUser,
    db: DbSession,
    week_start: date | None = Query(
        None, description="ISO date — filters to the 7-day window starting here"
    ),
) -> list[ShiftRead]:
    return await hr_svc.list_shifts(db, store_id=user.store_id, week_start=week_start)


@router.post(
    "/shifts",
    response_model=ShiftRead,
    status_code=201,
    summary="Assign a shift to a staff member with start and end times",
    operation_id="hr_shifts_create",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def create_shift(payload: ShiftCreate, user: StoreUser, db: DbSession) -> ShiftRead:
    return await hr_svc.create_shift(
        db, store_id=user.store_id, created_by_id=user.id, payload=payload
    )


# ---------------------------------------------------------------------------
# Cash sessions
# ---------------------------------------------------------------------------


@router.get(
    "/cash-sessions",
    response_model=list[CashSessionRead],
    summary="List recent cash sessions for this store",
    operation_id="hr_cash_sessions_list",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def list_cash_sessions(user: StoreUser, db: DbSession) -> list[CashSessionRead]:
    return await hr_svc.list_cash_sessions(db, store_id=user.store_id)


@router.get(
    "/cash-sessions/current",
    response_model=CashSessionRead | None,
    summary="Get the currently open cash session, if any",
    operation_id="hr_cash_sessions_current",
)
async def get_current_cash_session(user: StoreUser, db: DbSession) -> CashSessionRead | None:
    return await hr_svc.get_open_cash_session(db, store_id=user.store_id)


@router.post(
    "/cash-sessions",
    response_model=CashSessionRead,
    status_code=201,
    summary="Open a new cash session (record opening float)",
    operation_id="hr_cash_sessions_open",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def open_cash_session(
    payload: CashSessionCreate, user: StoreUser, db: DbSession
) -> CashSessionRead:
    return await hr_svc.open_cash_session(
        db, store_id=user.store_id, opened_by_id=user.id, payload=payload
    )


@router.patch(
    "/cash-sessions/{session_id}/close",
    response_model=CashSessionRead,
    summary="Close a cash session (record closing float)",
    operation_id="hr_cash_sessions_close",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def close_cash_session(
    session_id: str, payload: CashSessionClose, user: StoreUser, db: DbSession
) -> CashSessionRead:
    return await hr_svc.close_cash_session(
        db,
        store_id=user.store_id,
        session_id=session_id,
        closed_by_id=user.id,
        payload=payload,
    )


# ---------------------------------------------------------------------------
# Tasks (kanban)
# ---------------------------------------------------------------------------


@router.get(
    "/tasks",
    response_model=list[TaskRead],
    summary="List tasks; non-managers see only their own assigned tasks",
    operation_id="hr_tasks_list",
)
async def list_tasks(
    user: StoreUser,
    db: DbSession,
    status: TaskStatus | None = Query(None, description="Filter by task status"),
) -> list[TaskRead]:
    is_manager = user.role in {Role.OWNER, Role.MANAGER}
    assignee_filter = None if is_manager else user.id
    return await hr_svc.list_tasks(
        db, store_id=user.store_id, assignee_id=assignee_filter, status=status
    )


@router.post(
    "/tasks",
    response_model=TaskRead,
    status_code=201,
    summary="Create a new task and optionally assign it to a staff member",
    operation_id="hr_tasks_create",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def create_task(payload: TaskCreate, user: StoreUser, db: DbSession) -> TaskRead:
    return await hr_svc.create_task(
        db, store_id=user.store_id, created_by_id=user.id, payload=payload
    )


@router.patch(
    "/tasks/{task_id}",
    response_model=TaskRead,
    summary="Update a task; staff can move to IN_PROGRESS or PENDING_REVIEW only",
    operation_id="hr_tasks_update",
)
async def update_task(
    task_id: str, payload: TaskUpdate, user: StoreUser, db: DbSession
) -> TaskRead:
    is_manager = user.role in {Role.OWNER, Role.MANAGER}
    return await hr_svc.update_task(
        db,
        store_id=user.store_id,
        task_id=task_id,
        payload=payload,
        is_manager=is_manager,
    )


@router.patch(
    "/tasks/{task_id}/confirm",
    response_model=TaskRead,
    summary="Manager confirms a PENDING_REVIEW task as DONE",
    operation_id="hr_tasks_confirm",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def confirm_task(task_id: str, user: StoreUser, db: DbSession) -> TaskRead:
    return await hr_svc.confirm_task(
        db, store_id=user.store_id, task_id=task_id, confirmed_by_id=user.id
    )


@router.delete(
    "/tasks/{task_id}",
    status_code=204,
    summary="Delete a task",
    operation_id="hr_tasks_delete",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def delete_task(task_id: str, user: StoreUser, db: DbSession) -> None:
    await hr_svc.delete_task(db, store_id=user.store_id, task_id=task_id)
