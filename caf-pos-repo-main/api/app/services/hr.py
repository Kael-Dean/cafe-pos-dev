from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Forbidden, NotFound
from app.enums import LeaveStatus
from app.models.hr import LeaveRequest, ShiftAssignment
from app.models.identity import User
from app.schemas.hr import LeaveRequestCreate, LeaveReview, ShiftAssignmentCreate


async def list_staff(db: AsyncSession, *, store_id: str) -> list[User]:
    result = await db.execute(
        select(User)
        .where(User.store_id == store_id, User.is_active.is_(True))
        .order_by(User.name)
    )
    return list(result.scalars())


# ── Leave requests ────────────────────────────────────────────────────────────

async def list_leave_requests(
    db: AsyncSession, *, store_id: str, user_id: str | None = None
) -> list[tuple[LeaveRequest, str]]:
    stmt = (
        select(LeaveRequest, User.name)
        .join(User, LeaveRequest.user_id == User.id)
        .where(LeaveRequest.store_id == store_id)
        .order_by(LeaveRequest.created_at.desc())
    )
    if user_id:
        stmt = stmt.where(LeaveRequest.user_id == user_id)
    result = await db.execute(stmt)
    return list(result.tuples())


async def create_leave_request(
    db: AsyncSession, *, store_id: str, user_id: str, payload: LeaveRequestCreate
) -> tuple[LeaveRequest, str]:
    leave = LeaveRequest(
        store_id=store_id,
        user_id=user_id,
        start_date=payload.start_date,
        end_date=payload.end_date,
        leave_type=payload.leave_type,
        status=LeaveStatus.PENDING,
        note=payload.note,
    )
    async with db.begin():
        db.add(leave)
    await db.refresh(leave)
    user = await db.get(User, user_id)
    return leave, (user.name if user else "")


async def review_leave_request(
    db: AsyncSession,
    *,
    store_id: str,
    request_id: str,
    reviewer_id: str,
    payload: LeaveReview,
) -> tuple[LeaveRequest, str]:
    leave = await db.get(LeaveRequest, request_id)
    if not leave or leave.store_id != store_id:
        raise NotFound("Leave request not found")
    if leave.status != LeaveStatus.PENDING:
        raise Forbidden("Leave request has already been reviewed")

    async with db.begin():
        leave.status = payload.status
        leave.reviewed_by_id = reviewer_id
        leave.reviewed_at = datetime.utcnow()
        db.add(leave)
    await db.refresh(leave)
    user = await db.get(User, leave.user_id)
    return leave, (user.name if user else "")


# ── Shift assignments ─────────────────────────────────────────────────────────

async def get_weekly_schedule(
    db: AsyncSession, *, store_id: str, week_start: date
) -> list[tuple[ShiftAssignment, str]]:
    week_end = week_start + timedelta(days=6)
    result = await db.execute(
        select(ShiftAssignment, User.name)
        .join(User, ShiftAssignment.user_id == User.id)
        .where(
            ShiftAssignment.store_id == store_id,
            ShiftAssignment.assignment_date >= week_start,
            ShiftAssignment.assignment_date <= week_end,
        )
        .order_by(ShiftAssignment.assignment_date, User.name)
    )
    return list(result.tuples())


async def upsert_shift_assignment(
    db: AsyncSession, *, store_id: str, created_by_id: str, payload: ShiftAssignmentCreate
) -> tuple[ShiftAssignment, str]:
    existing = await db.execute(
        select(ShiftAssignment).where(
            ShiftAssignment.store_id == store_id,
            ShiftAssignment.user_id == payload.user_id,
            ShiftAssignment.assignment_date == payload.assignment_date,
        )
    )
    shift = existing.scalar_one_or_none()

    async with db.begin():
        if shift:
            shift.shift_type = payload.shift_type
            shift.notes = payload.notes
            shift.created_by_id = created_by_id
            db.add(shift)
        else:
            shift = ShiftAssignment(
                store_id=store_id,
                user_id=payload.user_id,
                assignment_date=payload.assignment_date,
                shift_type=payload.shift_type,
                notes=payload.notes,
                created_by_id=created_by_id,
            )
            db.add(shift)
    await db.refresh(shift)
    user = await db.get(User, shift.user_id)
    return shift, (user.name if user else "")
