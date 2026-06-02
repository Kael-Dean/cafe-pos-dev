from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Index, Numeric, String, Text, func
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.types import new_cuid
from app.enums import ReceiptStatus


class StockReceipt(Base):
    __tablename__ = "stock_receipts"

    id: Mapped[str] = mapped_column(String(24), primary_key=True, default=new_cuid)
    store_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("stores.id", ondelete="CASCADE"), nullable=False, index=True
    )
    status: Mapped[ReceiptStatus] = mapped_column(
        SAEnum(ReceiptStatus, name="receipt_status"), nullable=False, default=ReceiptStatus.DRAFT
    )
    supplier_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    receipt_ref: Mapped[str | None] = mapped_column(String(80), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    received_at: Mapped[date] = mapped_column(Date, nullable=False)
    created_by_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class StockLot(Base):
    __tablename__ = "stock_lots"
    __table_args__ = (
        Index("ix_lots_item_remaining", "inventory_item_id", "qty_remaining", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(24), primary_key=True, default=new_cuid)
    store_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("stores.id", ondelete="CASCADE"), nullable=False
    )
    receipt_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("stock_receipts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    inventory_item_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("inventory_items.id", ondelete="CASCADE"), nullable=False
    )
    qty_received: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    qty_remaining: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    cost_per_unit: Mapped[Decimal] = mapped_column(Numeric(12, 4), nullable=False)
    expiry_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
