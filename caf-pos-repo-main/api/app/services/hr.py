import logging
from datetime import datetime, timezone
from datetime import date as date_type

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Conflict, Forbidden, NotFound
from app.core.security import hash_pin
from app.enums import LeaveStatus
from app.models.hr import Leave, ShiftAssignment
from app.models.identity import User
from app.schemas.hr import (
    LeaveCreate,
    LeaveRead,
    LeaveReview,
    ShiftCreate,
    ShiftRead,
    StaffCreate,
    StaffUpdate,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Staff
# ---------------------------------------------------------------------------


async def list_staff(db: AsyncSession, *, store_id: str) -> list[User]:
    result = await db.execute(
        select(User)
        .where(User.store_id == store_id, User.is_active.is_(True))
        .order_by(User.name)
    )
    return list(result.scalars())


async def create_staff(
    db: AsyncSession,
    *,
    store_id: str,
    tenant_id: str,
    payload: StaffCreate,
) -> User:
    async with db.begin():
        user = User(
            tenant_id=tenant_id,
            store_id=store_id,
            name=payload.name,
            role=payload.role,
            pin_hash=hash_pin(payload.pin),
        )
        db.add(user)
    return user


async def update_staff(
    db: AsyncSession,
    *,
    store_id: str,
    user_id: str,
    payload: StaffUpdate,
) -> User:
    async with db.begin():
        user = await _load_user(db, store_id=store_id, user_id=user_id)
        if payload.name is not None:
            user.name = payload.name
        if payload.role is not None:
            user.role = payload.role
        if payload.pin is not None:
            user.pin_hash = hash_pin(payload.pin)
    return user


async def delete_staff(db: AsyncSession, *, store_id: str, user_id: str) -> None:
    async with db.begin():
        user = await _load_user(db, store_id=store_id, user_id=user_id)
        user.is_active = False


# ---------------------------------------------------------------------------
# Leaves
# ---------------------------------------------------------------------------


async def list_leaves(
    db: AsyncSession,
    *,
    store_id: str,
    user_id: str | None = None,
) -> list[LeaveRead]:
    stmt = select(Leave).where(Leave.store_id == store_id).order_by(Leave.created_at.desc())
    if user_id:
        stmt = stmt.where(Leave.user_id == user_id)
    rows = list((await db.execute(stmt)).scalars())
    return [await _leave_to_read(db, lv) for lv in rows]


async def create_leave(
    db: AsyncSession,
    *,
    store_id: str,
    user_id: str,
    payload: LeaveCreate,
) -> LeaveRead:
    async with db.begin():
        leave = Leave(
            store_id=store_id,
            user_id=user_id,
            start_date=payload.start_date,
            end_date=payload.end_date,
            leave_type=payload.leave_type,
            note=payload.note,
            status=LeaveStatus.PENDING,
        )
        db.add(leave)
    return await _leave_to_read(db, leave)


async def review_leave(
    db: AsyncSession,
    *,
    store_id: str,
    leave_id: str,
    reviewer_id: str,
    payload: LeaveReview,
) -> LeaveRead:
    if payload.status == LeaveStatus.PENDING:
        raise Forbidden("Cannot set status back to PENDING")
    async with db.begin():
        leave = await _load_leave(db, store_id=store_id, leave_id=leave_id)
        if leave.status != LeaveStatus.PENDING:
            raise Conflict(f"Leave is already {leave.status.value}")
        leave.status = payload.status
        leave.reviewed_by_id = reviewer_id
        leave.reviewed_at = datetime.now(timezone.utc)
        if payload.note:
            leave.note = payload.note
    return await _leave_to_read(db, leave)


# ---------------------------------------------------------------------------
# Shifts
# ---------------------------------------------------------------------------


async def list_shifts(
    db: AsyncSession,
    *,
    store_id: str,
    week_start: date_type | None = None,
) -> list[ShiftRead]:
    from datetime import timedelta

    stmt = (
        select(ShiftAssignment)
        .where(ShiftAssignment.store_id == store_id)
        .order_by(ShiftAssignment.assignment_date, ShiftAssignment.created_at)
    )
    if week_start:
        week_end = week_start + timedelta(days=6)
        stmt = stmt.where(
            ShiftAssignment.assignment_date >= week_start,
            ShiftAssignment.assignment_date <= week_end,
        )
    rows = list((await db.execute(stmt)).scalars())
    return [await _shift_to_read(db, s) for s in rows]


async def create_shift(
    db: AsyncSession,
    *,
    store_id: str,
    created_by_id: str,
    payload: ShiftCreate,
) -> ShiftRead:
    async with db.begin():
        shift = ShiftAssignment(
            store_id=store_id,
            user_id=payload.user_id,
            assignment_date=payload.assignment_date,
            shift_type=payload.shift_type,
            notes=payload.notes,
            created_by_id=created_by_id,
        )
        db.add(shift)
    return await _shift_to_read(db, shift)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _load_user(db: AsyncSession, *, store_id: str, user_id: str) -> User:
    result = await db.execute(
        select(User).where(User.id == user_id, User.store_id == store_id)
    )
    user = result.scalar_one_or_none()
    if not user:
        raise NotFound("Staff member not found")
    return user


async def _load_leave(db: AsyncSession, *, store_id: str, leave_id: str) -> Leave:
    result = await db.execute(
        select(Leave).where(Leave.id == leave_id, Leave.store_id == store_id)
    )
    leave = result.scalar_one_or_none()
    if not leave:
        raise NotFound("Leave request not found")
    return leave


async def _leave_to_read(db: AsyncSession, leave: Leave) -> LeaveRead:
    user = await db.get(User, leave.user_id)
    return LeaveRead(
        id=leave.id,
        store_id=leave.store_id,
        user_id=leave.user_id,
        user_name=user.name if user else "Unknown",
        start_date=leave.start_date,
        end_date=leave.end_date,
        leave_type=leave.leave_type,
        status=leave.status,
        note=leave.note,
        reviewed_by_id=leave.reviewed_by_id,
        reviewed_at=leave.reviewed_at,
        created_at=leave.created_at,
        updated_at=leave.updated_at,
    )


async def _shift_to_read(db: AsyncSession, shift: ShiftAssignment) -> ShiftRead:
    user = await db.get(User, shift.user_id)
    return ShiftRead(
        id=shift.id,
        store_id=shift.store_id,
        user_id=shift.user_id,
        user_name=user.name if user else "Unknown",
        assignment_date=shift.assignment_date,
        shift_type=shift.shift_type,
        notes=shift.notes,
        created_by_id=shift.created_by_id,
        created_at=shift.created_at,
        updated_at=shift.updated_at,
    )
