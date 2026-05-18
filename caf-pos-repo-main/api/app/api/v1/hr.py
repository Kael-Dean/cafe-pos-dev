from datetime import date

from fastapi import APIRouter, Depends, Query

from app.deps import DbSession, StoreUser, require_role
from app.enums import Role
from app.schemas.hr import (
    LeaveCreate,
    LeaveRead,
    LeaveReview,
    ShiftCreate,
    ShiftRead,
    StaffCreate,
    StaffRead,
    StaffUpdate,
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


@router.post(
    "/staff",
    response_model=StaffRead,
    status_code=201,
    summary="Create a new staff member",
    operation_id="hr_staff_create",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def create_staff(payload: StaffCreate, user: StoreUser, db: DbSession) -> StaffRead:
    staff = await hr_svc.create_staff(
        db, store_id=user.store_id, tenant_id=user.tenant_id, payload=payload
    )
    return StaffRead.model_validate(staff)


@router.patch(
    "/staff/{user_id}",
    response_model=StaffRead,
    summary="Update a staff member's name, role, or PIN",
    operation_id="hr_staff_update",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def update_staff(
    user_id: str, payload: StaffUpdate, user: StoreUser, db: DbSession
) -> StaffRead:
    staff = await hr_svc.update_staff(
        db, store_id=user.store_id, user_id=user_id, payload=payload
    )
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
    summary="Assign a shift to a staff member",
    operation_id="hr_shifts_create",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def create_shift(payload: ShiftCreate, user: StoreUser, db: DbSession) -> ShiftRead:
    return await hr_svc.create_shift(
        db, store_id=user.store_id, created_by_id=user.id, payload=payload
    )
