from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint,
    func,
)
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin
from app.db.types import new_cuid
from app.enums import EarnMode, MembershipTier, PointTxType, RewardScope, RewardType


class MembershipProgram(Base, TimestampMixin):
    __tablename__ = "membership_programs"

    id: Mapped[str] = mapped_column(String(24), primary_key=True, default=new_cuid)
    store_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("stores.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    earn_mode: Mapped[EarnMode] = mapped_column(
        SAEnum(EarnMode, name="earn_mode", create_type=False), nullable=False
    )
    baht_per_point: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    points_to_redeem: Mapped[int] = mapped_column(Integer, nullable=False, default=10)
    reward_type: Mapped[RewardType] = mapped_column(
        SAEnum(RewardType, name="reward_type", create_type=False), nullable=False
    )
    reward_value: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    reward_scope: Mapped[RewardScope] = mapped_column(
        SAEnum(RewardScope, name="reward_scope", create_type=False), nullable=False
    )
    reward_category_id: Mapped[str | None] = mapped_column(
        String(24), ForeignKey("categories.id", ondelete="SET NULL"), nullable=True
    )
    min_order_baht: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    points_expire_after_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tier_bronze_threshold: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tier_silver_threshold: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tier_gold_threshold: Mapped[int | None] = mapped_column(Integer, nullable=True)
    bronze_earn_multiplier: Mapped[Decimal] = mapped_column(
        Numeric(4, 2), nullable=False, default=Decimal("1.0")
    )
    silver_earn_multiplier: Mapped[Decimal] = mapped_column(
        Numeric(4, 2), nullable=False, default=Decimal("1.0")
    )
    gold_earn_multiplier: Mapped[Decimal] = mapped_column(
        Numeric(4, 2), nullable=False, default=Decimal("1.0")
    )


class MembershipRewardProduct(Base):
    __tablename__ = "membership_reward_products"

    program_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("membership_programs.id", ondelete="CASCADE"), primary_key=True
    )
    product_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("products.id", ondelete="CASCADE"), primary_key=True
    )


class MembershipAccount(Base, TimestampMixin):
    __tablename__ = "membership_accounts"

    id: Mapped[str] = mapped_column(String(24), primary_key=True, default=new_cuid)
    customer_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("customers.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    store_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("stores.id", ondelete="CASCADE"), nullable=False, index=True
    )
    points_balance: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    lifetime_points_earned: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    tier: Mapped[MembershipTier] = mapped_column(
        SAEnum(MembershipTier, name="membership_tier", create_type=False),
        nullable=False,
        default=MembershipTier.NONE,
    )
    date_of_birth: Mapped[date | None] = mapped_column(Date, nullable=True)
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class PointTransaction(Base):
    __tablename__ = "point_transactions"

    id: Mapped[str] = mapped_column(String(24), primary_key=True, default=new_cuid)
    account_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("membership_accounts.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    store_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("stores.id", ondelete="CASCADE"), nullable=False
    )
    type: Mapped[PointTxType] = mapped_column(
        SAEnum(PointTxType, name="point_tx_type", create_type=False), nullable=False
    )
    delta: Mapped[int] = mapped_column(Integer, nullable=False)
    balance_after: Mapped[int] = mapped_column(Integer, nullable=False)
    order_id: Mapped[str | None] = mapped_column(
        String(24), ForeignKey("orders.id", ondelete="SET NULL"), nullable=True
    )
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
