import decimal
from datetime import date, datetime, time

from sqlalchemy import (
    Date,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    Time,
    UniqueConstraint,
)
from sqlalchemy import (
    Enum as SAEnum,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin
from app.db.types import new_cuid
from app.enums import LeaveStatus, LeaveType, TaskStatus


class Leave(Base, TimestampMixin):
    __tablename__ = "leaves"
    __table_args__ = (
        Index("ix_leaves_store_id", "store_id"),
        Index("ix_leaves_user_id", "user_id"),
    )

    id: Mapped[str] = mapped_column(String(24), primary_key=True, default=new_cuid)
    store_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("stores.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    leave_type: Mapped[LeaveType] = mapped_column(
        SAEnum(LeaveType, name="leave_type"), nullable=False
    )
    status: Mapped[LeaveStatus] = mapped_column(
        SAEnum(LeaveStatus, name="leave_status"),
        nullable=False,
        default=LeaveStatus.PENDING,
    )
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed_by_id: Mapped[str | None] = mapped_column(
        String(24), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class ShiftAssignment(Base, TimestampMixin):
    __tablename__ = "shift_assignments"
    __table_args__ = (
        UniqueConstraint("store_id", "user_id", "assignment_date", name="uq_shift_user_date"),
        Index("ix_shifts_store_date", "store_id", "assignment_date"),
    )

    id: Mapped[str] = mapped_column(String(24), primary_key=True, default=new_cuid)
    store_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("stores.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    assignment_date: Mapped[date] = mapped_column(Date, nullable=False)
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )


class CashSession(Base, TimestampMixin):
    __tablename__ = "cash_sessions"
    __table_args__ = (Index("ix_cash_sessions_store_id", "store_id"),)

    id: Mapped[str] = mapped_column(String(24), primary_key=True, default=new_cuid)
    store_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("stores.id", ondelete="CASCADE"), nullable=False
    )
    opened_by_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    closed_by_id: Mapped[str | None] = mapped_column(
        String(24), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    cash_open: Mapped[decimal.Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    cash_close: Mapped[decimal.Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)


class StaffTask(Base, TimestampMixin):
    __tablename__ = "staff_tasks"
    __table_args__ = (
        Index("ix_tasks_store_id", "store_id"),
        Index("ix_tasks_assignee_id", "assignee_id"),
    )

    id: Mapped[str] = mapped_column(String(24), primary_key=True, default=new_cuid)
    store_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("stores.id", ondelete="CASCADE"), nullable=False
    )
    assignee_id: Mapped[str | None] = mapped_column(
        String(24), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_by_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[TaskStatus] = mapped_column(
        SAEnum(TaskStatus, name="task_status"),
        nullable=False,
        default=TaskStatus.TODO,
    )
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
