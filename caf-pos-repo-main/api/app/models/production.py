from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.types import new_cuid


class ProductionOrder(Base):
    __tablename__ = "production_orders"

    id: Mapped[str] = mapped_column(String(24), primary_key=True, default=new_cuid)
    store_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("stores.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("products.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    batches_count: Mapped[int] = mapped_column(Integer, nullable=False)
    units_produced: Mapped[int] = mapped_column(Integer, nullable=False)
    produced_by: Mapped[str] = mapped_column(
        String(24), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    produced_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
