from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy import (
    Enum as SAEnum,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.types import new_cuid
from app.enums import FulfillmentMode, PreOrderStatus


class PreOrder(Base):
    __tablename__ = "pre_orders"

    id: Mapped[str] = mapped_column(String(24), primary_key=True, default=new_cuid)
    store_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("stores.id", ondelete="CASCADE"), nullable=False, index=True
    )
    order_date: Mapped[date] = mapped_column(Date, nullable=False)
    due_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    customer_id: Mapped[str | None] = mapped_column(
        String(24), ForeignKey("customers.id", ondelete="SET NULL"), nullable=True
    )
    customer_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    customer_phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    deposit_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    deposit_paid: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[PreOrderStatus] = mapped_column(
        SAEnum(PreOrderStatus, name="pre_order_status"),
        nullable=False,
        default=PreOrderStatus.PENDING,
    )
    created_by_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    started_by_id: Mapped[str | None] = mapped_column(
        String(24), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    completed_by_id: Mapped[str | None] = mapped_column(
        String(24), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class PreOrderItem(Base):
    __tablename__ = "pre_order_items"

    id: Mapped[str] = mapped_column(String(24), primary_key=True, default=new_cuid)
    pre_order_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("pre_orders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_id: Mapped[str | None] = mapped_column(
        String(24), ForeignKey("products.id", ondelete="SET NULL"), nullable=True
    )
    product_name: Mapped[str] = mapped_column(String(200), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    line_total: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    fulfillment_mode: Mapped[FulfillmentMode | None] = mapped_column(
        SAEnum(FulfillmentMode, name="fulfillment_mode"),
        nullable=True,
    )


class ShoppingListItem(Base):
    __tablename__ = "shopping_list_items"
    __table_args__ = (
        UniqueConstraint("store_id", "inventory_item_id", name="uq_shopping_list_store_item"),
    )

    id: Mapped[str] = mapped_column(String(24), primary_key=True, default=new_cuid)
    store_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("stores.id", ondelete="CASCADE"), nullable=False, index=True
    )
    inventory_item_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("inventory_items.id", ondelete="CASCADE"), nullable=False
    )
    added_by_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    note: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
