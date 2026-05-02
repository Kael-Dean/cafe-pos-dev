from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin
from app.db.types import new_cuid
from app.enums import (
    CashSessionStatus,
    DiscountType,
    PayoutType,
    ProtocolFrequency,
)


class CashSession(Base, TimestampMixin):
    __tablename__ = "cash_sessions"
    __table_args__ = (Index("ix_cash_sessions_store_date", "store_id", "session_date"),)

    id: Mapped[str] = mapped_column(String(24), primary_key=True, default=new_cuid)
    store_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("stores.id", ondelete="CASCADE"), nullable=False, index=True
    )
    session_date: Mapped[date] = mapped_column(Date, nullable=False)
    opening_balance: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False, default=Decimal("0"))
    closing_balance: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    status: Mapped[CashSessionStatus] = mapped_column(
        SAEnum(CashSessionStatus, name="cash_session_status"),
        nullable=False,
        default=CashSessionStatus.OPEN,
    )
    opened_by_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    closed_by_id: Mapped[str | None] = mapped_column(
        String(24), ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    payouts: Mapped[list["CashPayout"]] = relationship(
        "CashPayout", back_populates="session", cascade="all, delete-orphan"
    )


class CashPayout(Base):
    __tablename__ = "cash_payouts"

    id: Mapped[str] = mapped_column(String(24), primary_key=True, default=new_cuid)
    cash_session_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("cash_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    store_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("stores.id", ondelete="CASCADE"), nullable=False, index=True
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    payout_type: Mapped[PayoutType] = mapped_column(
        SAEnum(PayoutType, name="payout_type"), nullable=False
    )
    description: Mapped[str] = mapped_column(String(255), nullable=False)
    created_by_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    session: Mapped["CashSession"] = relationship("CashSession", back_populates="payouts")


class Promotion(Base, TimestampMixin):
    __tablename__ = "promotions"

    id: Mapped[str] = mapped_column(String(24), primary_key=True, default=new_cuid)
    store_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("stores.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    discount_type: Mapped[DiscountType] = mapped_column(
        SAEnum(DiscountType, name="discount_type"), nullable=False
    )
    discount_value: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    min_order_amount: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), nullable=False, default=Decimal("0")
    )
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_by_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )


class Protocol(Base, TimestampMixin):
    __tablename__ = "protocols"

    id: Mapped[str] = mapped_column(String(24), primary_key=True, default=new_cuid)
    store_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("stores.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    frequency: Mapped[ProtocolFrequency] = mapped_column(
        SAEnum(ProtocolFrequency, name="protocol_frequency"), nullable=False
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_by_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )

    tasks: Mapped[list["ProtocolTask"]] = relationship(
        "ProtocolTask",
        back_populates="protocol",
        cascade="all, delete-orphan",
        order_by="ProtocolTask.sort_order",
    )


class ProtocolTask(Base):
    __tablename__ = "protocol_tasks"

    id: Mapped[str] = mapped_column(String(24), primary_key=True, default=new_cuid)
    protocol_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("protocols.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    sort_order: Mapped[int] = mapped_column(nullable=False, default=0)

    protocol: Mapped["Protocol"] = relationship("Protocol", back_populates="tasks")


class ProtocolLog(Base):
    __tablename__ = "protocol_logs"
    __table_args__ = (Index("ix_protocol_logs_store_date", "store_id", "log_date"),)

    id: Mapped[str] = mapped_column(String(24), primary_key=True, default=new_cuid)
    protocol_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("protocols.id", ondelete="CASCADE"), nullable=False, index=True
    )
    store_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("stores.id", ondelete="CASCADE"), nullable=False, index=True
    )
    log_date: Mapped[date] = mapped_column(Date, nullable=False)
    completed_task_ids: Mapped[list[Any]] = mapped_column(JSON, nullable=False, default=list)
    completed_by_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
