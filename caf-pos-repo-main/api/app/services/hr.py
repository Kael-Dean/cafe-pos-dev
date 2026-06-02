import logging
from datetime import UTC, datetime
from datetime import date as date_type

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Conflict, Forbidden, NotFound
from app.core.security import hash_pin
from app.enums import LeaveStatus, TaskStatus
from app.models.hr import CashSession, Leave, ShiftAssignment, StaffTask
from app.models.identity import User
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
    StaffUpdate,
    TaskCreate,
    TaskRead,
    TaskUpdate,
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


async def get_staff(db: AsyncSession, *, store_id: str, user_id: str) -> User:
    return await _load_user(db, store_id=store_id, user_id=user_id)


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
            position=payload.position,
            pin_hash=hash_pin(payload.pin),
            phone=payload.phone,
            email=payload.email,
            address=payload.address,
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
        if payload.position is not None:
            user.position = payload.position
        if payload.pin is not None:
            user.pin_hash = hash_pin(payload.pin)
        if payload.phone is not None:
            user.phone = payload.phone
        if "email" in payload.model_fields_set:
            user.email = payload.email
        if "address" in payload.model_fields_set:
            user.address = payload.address
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
        leave.reviewed_at = datetime.now(UTC)
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
            start_time=payload.start_time,
            end_time=payload.end_time,
            notes=payload.notes,
            created_by_id=created_by_id,
        )
        db.add(shift)
    return await _shift_to_read(db, shift)


# ---------------------------------------------------------------------------
# Cash sessions
# ---------------------------------------------------------------------------


async def list_cash_sessions(
    db: AsyncSession,
    *,
    store_id: str,
    limit: int = 50,
) -> list[CashSessionRead]:
    stmt = (
        select(CashSession)
        .where(CashSession.store_id == store_id)
        .order_by(CashSession.opened_at.desc())
        .limit(limit)
    )
    rows = list((await db.execute(stmt)).scalars())
    return [_cash_session_to_read(s) for s in rows]


async def get_open_cash_session(
    db: AsyncSession,
    *,
    store_id: str,
) -> CashSessionRead | None:
    result = await db.execute(
        select(CashSession).where(
            CashSession.store_id == store_id,
            CashSession.closed_at.is_(None),
        )
    )
    session = result.scalar_one_or_none()
    return _cash_session_to_read(session) if session else None


async def open_cash_session(
    db: AsyncSession,
    *,
    store_id: str,
    opened_by_id: str,
    payload: CashSessionCreate,
) -> CashSessionRead:
    existing = await get_open_cash_session(db, store_id=store_id)
    if existing:
        raise Conflict("A cash session is already open for this store")
    async with db.begin():
        session = CashSession(
            store_id=store_id,
            opened_by_id=opened_by_id,
            cash_open=payload.cash_open,
            opened_at=datetime.now(UTC),
            notes=payload.notes,
        )
        db.add(session)
    return _cash_session_to_read(session)


async def close_cash_session(
    db: AsyncSession,
    *,
    store_id: str,
    session_id: str,
    closed_by_id: str,
    payload: CashSessionClose,
) -> CashSessionRead:
    async with db.begin():
        session = await _load_cash_session(db, store_id=store_id, session_id=session_id)
        if session.closed_at is not None:
            raise Conflict("Cash session is already closed")
        session.cash_close = payload.cash_close
        session.closed_by_id = closed_by_id
        session.closed_at = datetime.now(UTC)
        if payload.notes:
            session.notes = payload.notes
    return _cash_session_to_read(session)


# ---------------------------------------------------------------------------
# Tasks
# ---------------------------------------------------------------------------


async def list_tasks(
    db: AsyncSession,
    *,
    store_id: str,
    assignee_id: str | None = None,
    status: TaskStatus | None = None,
) -> list[TaskRead]:
    stmt = (
        select(StaffTask)
        .where(StaffTask.store_id == store_id)
        .order_by(StaffTask.created_at.desc())
    )
    if assignee_id is not None:
        stmt = stmt.where(StaffTask.assignee_id == assignee_id)
    if status is not None:
        stmt = stmt.where(StaffTask.status == status)
    rows = list((await db.execute(stmt)).scalars())
    return [await _task_to_read(db, t) for t in rows]


async def create_task(
    db: AsyncSession,
    *,
    store_id: str,
    created_by_id: str,
    payload: TaskCreate,
) -> TaskRead:
    async with db.begin():
        task = StaffTask(
            store_id=store_id,
            created_by_id=created_by_id,
            assignee_id=payload.assignee_id,
            title=payload.title,
            description=payload.description,
            due_date=payload.due_date,
            status=TaskStatus.TODO,
        )
        db.add(task)
    return await _task_to_read(db, task)


async def update_task(
    db: AsyncSession,
    *,
    store_id: str,
    task_id: str,
    payload: TaskUpdate,
    is_manager: bool,
) -> TaskRead:
    async with db.begin():
        task = await _load_task(db, store_id=store_id, task_id=task_id)
        if payload.status == TaskStatus.DONE and not is_manager:
            raise Forbidden("Only managers can mark tasks as DONE — submit for review first")
        for field in payload.model_fields_set:
            setattr(task, field, getattr(payload, field))
    return await _task_to_read(db, task)


async def confirm_task(
    db: AsyncSession,
    *,
    store_id: str,
    task_id: str,
    confirmed_by_id: str,
) -> TaskRead:
    async with db.begin():
        task = await _load_task(db, store_id=store_id, task_id=task_id)
        if task.status != TaskStatus.PENDING_REVIEW:
            raise Conflict(
                f"Task must be in PENDING_REVIEW to confirm; current status: {task.status.value}"
            )
        task.status = TaskStatus.DONE
    return await _task_to_read(db, task)


async def delete_task(db: AsyncSession, *, store_id: str, task_id: str) -> None:
    async with db.begin():
        task = await _load_task(db, store_id=store_id, task_id=task_id)
        await db.delete(task)


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


async def _load_cash_session(
    db: AsyncSession, *, store_id: str, session_id: str
) -> CashSession:
    result = await db.execute(
        select(CashSession).where(
            CashSession.id == session_id,
            CashSession.store_id == store_id,
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise NotFound("Cash session not found")
    return session


async def _load_task(db: AsyncSession, *, store_id: str, task_id: str) -> StaffTask:
    result = await db.execute(
        select(StaffTask).where(
            StaffTask.id == task_id,
            StaffTask.store_id == store_id,
        )
    )
    task = result.scalar_one_or_none()
    if not task:
        raise NotFound("Task not found")
    return task


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
        start_time=shift.start_time,
        end_time=shift.end_time,
        notes=shift.notes,
        created_by_id=shift.created_by_id,
        created_at=shift.created_at,
        updated_at=shift.updated_at,
    )


def _cash_session_to_read(session: CashSession) -> CashSessionRead:
    return CashSessionRead(
        id=session.id,
        store_id=session.store_id,
        opened_by_id=session.opened_by_id,
        closed_by_id=session.closed_by_id,
        cash_open=session.cash_open,
        cash_close=session.cash_close,
        opened_at=session.opened_at,
        closed_at=session.closed_at,
        notes=session.notes,
        created_at=session.created_at,
        updated_at=session.updated_at,
    )


async def _task_to_read(db: AsyncSession, task: StaffTask) -> TaskRead:
    assignee_name: str | None = None
    if task.assignee_id:
        assignee = await db.get(User, task.assignee_id)
        assignee_name = assignee.name if assignee else None
    return TaskRead(
        id=task.id,
        store_id=task.store_id,
        assignee_id=task.assignee_id,
        assignee_name=assignee_name,
        created_by_id=task.created_by_id,
        title=task.title,
        description=task.description,
        status=task.status,
        due_date=task.due_date,
        created_at=task.created_at,
        updated_at=task.updated_at,
    )
