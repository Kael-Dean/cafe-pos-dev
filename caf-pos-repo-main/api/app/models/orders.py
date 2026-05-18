from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Index,
    Integer,
    JSON,
    Numeric,
    Sequence,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin
from app.db.types import new_cuid
from app.enums import Channel, OrderStatus, PaymentMethod

order_number_seq = Sequence("order_number_seq", start=1001)


class Order(Base, TimestampMixin):
    __tablename__ = "orders"
    __table_args__ = (
        UniqueConstraint("store_id", "idempotency_key", name="uq_orders_store_idempotency"),
        Index("ix_orders_store_status", "store_id", "status"),
        Index("ix_orders_store_created", "store_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(24), primary_key=True, default=new_cuid)
    order_number: Mapped[int] = mapped_column(
        Integer, order_number_seq, server_default=order_number_seq.next_value(), nullable=False
    )
    store_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("stores.id", ondelete="CASCADE"), nullable=False, index=True
    )
    status: Mapped[OrderStatus] = mapped_column(
        SAEnum(OrderStatus, name="order_status"), nullable=False, default=OrderStatus.PENDING
    )
    channel: Mapped[Channel] = mapped_column(SAEnum(Channel, name="channel"), nullable=False)
    payment_method: Mapped[PaymentMethod | None] = mapped_column(
        SAEnum(PaymentMethod, name="payment_method"), nullable=True
    )
    payment_ref: Mapped[str | None] = mapped_column(String(120), nullable=True)
    idempotency_key: Mapped[str] = mapped_column(String(120), nullable=False)
    customer_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    subtotal: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"))
    discount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"))
    tax: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"))
    total: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"))
    customer_id: Mapped[str | None] = mapped_column(
        String(24), ForeignKey("customers.id", ondelete="SET NULL"), nullable=True
    )
    created_by_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )


class OrderItem(Base):
    __tablename__ = "order_items"

    id: Mapped[str] = mapped_column(String(24), primary_key=True, default=new_cuid)
    order_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("orders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_id: Mapped[str | None] = mapped_column(
        String(24), ForeignKey("products.id", ondelete="SET NULL"), nullable=True
    )
    product_name: Mapped[str] = mapped_column(String(120), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    line_total: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"))
    modifiers_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class OrderVoidLog(Base):
    __tablename__ = "order_void_logs"

    id: Mapped[str] = mapped_column(String(24), primary_key=True, default=new_cuid)
    order_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("orders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    voided_by_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
