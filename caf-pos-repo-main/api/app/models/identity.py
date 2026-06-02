from sqlalchemy import Boolean, ForeignKey, String, UniqueConstraint
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin
from app.db.types import new_cuid
from app.enums import Role, StaffPosition


class User(Base, TimestampMixin):
    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("store_id", "phone", name="uq_staff_store_phone"),
        UniqueConstraint("store_id", "email", name="uq_staff_store_email"),
    )

    id: Mapped[str] = mapped_column(String(24), primary_key=True, default=new_cuid)
    tenant_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    store_id: Mapped[str | None] = mapped_column(
        String(24), ForeignKey("stores.id", ondelete="CASCADE"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    pin_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[Role] = mapped_column(SAEnum(Role, name="role"), nullable=False)
    position: Mapped[StaffPosition] = mapped_column(
        SAEnum(StaffPosition, name="staff_position"), nullable=False, default=StaffPosition.JUNIOR
    )
    phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    address: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
