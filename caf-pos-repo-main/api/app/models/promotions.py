from datetime import date, datetime, time
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Integer,
    JSON,
    Numeric,
    String,
    Time,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin
from app.db.types import new_cuid
from app.enums import PromotionScope, PromotionType


class Promotion(Base, TimestampMixin):
    __tablename__ = "promotions"

    id: Mapped[str] = mapped_column(String(24), primary_key=True, default=new_cuid)
    store_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("stores.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    type: Mapped[PromotionType] = mapped_column(
        SAEnum(PromotionType, name="promotion_type"), nullable=False
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_exclusive: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    discount_pct: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    scope: Mapped[PromotionScope] = mapped_column(
        SAEnum(PromotionScope, name="promotion_scope"),
        nullable=False,
        default=PromotionScope.ORDER,
    )
    product_ids_json: Mapped[list | None] = mapped_column(JSON, nullable=True)
    category_id: Mapped[str | None] = mapped_column(
        String(24), ForeignKey("categories.id", ondelete="SET NULL"), nullable=True
    )
    min_quantity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    bundle_product_ids_json: Mapped[list | None] = mapped_column(JSON, nullable=True)
    time_start: Mapped[time | None] = mapped_column(Time, nullable=True)
    time_end: Mapped[time | None] = mapped_column(Time, nullable=True)
    days_of_week_json: Mapped[list | None] = mapped_column(JSON, nullable=True)
    valid_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    valid_until: Mapped[date | None] = mapped_column(Date, nullable=True)


class PromotionRedemption(Base):
    __tablename__ = "promotion_redemptions"
    __table_args__ = (
        UniqueConstraint("order_id", "promotion_id", name="uq_redemption_order_promotion"),
    )

    id: Mapped[str] = mapped_column(String(24), primary_key=True, default=new_cuid)
    promotion_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("promotions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    order_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("orders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    discount_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
