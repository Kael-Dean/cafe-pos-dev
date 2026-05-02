from datetime import date

from fastapi import APIRouter, Depends, Query

from app.deps import DbSession, StoreUser, require_role
from app.enums import Role
from app.schemas.hr import (
    LeaveRequestCreate,
    LeaveRequestRead,
    LeaveReview,
    ShiftAssignmentCreate,
    ShiftAssignmentRead,
    StaffRead,
)
from app.services import hr as svc

router = APIRouter(prefix="/hr", tags=["hr"])

_ALL_STAFF = require_role(Role.OWNER, Role.MANAGER, Role.BARISTA, Role.BAKER)
_MANAGER_PLUS = require_role(Role.OWNER, Role.MANAGER)


def _leave_read(leave, user_name: str) -> LeaveRequestRead:
    data = LeaveRequestRead.model_validate(leave)
    data.user_name = user_name
    return data


def _shift_read(shift, user_name: str) -> ShiftAssignmentRead:
    data = ShiftAssignmentRead.model_validate(shift)
    data.user_name = user_name
    return data


@router.get(
    "/staff",
    response_model=list[StaffRead],
    summary="List all active staff for this store",
    operation_id="hr_list_staff",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def list_staff(user: StoreUser, db: DbSession) -> list[StaffRead]:
    staff = await svc.list_staff(db, store_id=user.store_id)
    return [StaffRead.model_validate(s) for s in staff]


@router.get(
    "/leaves",
    response_model=list[LeaveRequestRead],
    summary="List all leave requests for this store (admin)",
    operation_id="hr_list_all_leaves",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def list_all_leaves(user: StoreUser, db: DbSession) -> list[LeaveRequestRead]:
    rows = await svc.list_leave_requests(db, store_id=user.store_id)
    return [_leave_read(leave, name) for leave, name in rows]


@router.get(
    "/leaves/mine",
    response_model=list[LeaveRequestRead],
    summary="List the current user's own leave requests",
    operation_id="hr_list_my_leaves",
    dependencies=[Depends(_ALL_STAFF)],
)
async def list_my_leaves(user: StoreUser, db: DbSession) -> list[LeaveRequestRead]:
    rows = await svc.list_leave_requests(db, store_id=user.store_id, user_id=user.id)
    return [_leave_read(leave, name) for leave, name in rows]


@router.post(
    "/leaves",
    response_model=LeaveRequestRead,
    status_code=201,
    summary="Submit a leave request",
    operation_id="hr_create_leave",
    dependencies=[Depends(_ALL_STAFF)],
)
async def create_leave(
    payload: LeaveRequestCreate,
    user: StoreUser,
    db: DbSession,
) -> LeaveRequestRead:
    leave, name = await svc.create_leave_request(db, store_id=user.store_id, user_id=user.id, payload=payload)
    return _leave_read(leave, name)


@router.patch(
    "/leaves/{request_id}/review",
    response_model=LeaveRequestRead,
    summary="Approve or reject a leave request (admin)",
    operation_id="hr_review_leave",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def review_leave(
    request_id: str,
    payload: LeaveReview,
    user: StoreUser,
    db: DbSession,
) -> LeaveRequestRead:
    leave, name = await svc.review_leave_request(
        db, store_id=user.store_id, request_id=request_id, reviewer_id=user.id, payload=payload
    )
    return _leave_read(leave, name)


@router.get(
    "/shifts",
    response_model=list[ShiftAssignmentRead],
    summary="Get weekly shift schedule",
    operation_id="hr_get_shifts",
    dependencies=[Depends(_ALL_STAFF)],
)
async def get_shifts(
    user: StoreUser,
    db: DbSession,
    week_start: date = Query(..., description="Monday of the week (YYYY-MM-DD)"),
) -> list[ShiftAssignmentRead]:
    rows = await svc.get_weekly_schedule(db, store_id=user.store_id, week_start=week_start)
    return [_shift_read(shift, name) for shift, name in rows]


@router.post(
    "/shifts",
    response_model=ShiftAssignmentRead,
    status_code=201,
    summary="Assign or update a shift for a staff member",
    operation_id="hr_assign_shift",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def assign_shift(
    payload: ShiftAssignmentCreate,
    user: StoreUser,
    db: DbSession,
) -> ShiftAssignmentRead:
    shift, name = await svc.upsert_shift_assignment(
        db, store_id=user.store_id, created_by_id=user.id, payload=payload
    )
    return _shift_read(shift, name)
