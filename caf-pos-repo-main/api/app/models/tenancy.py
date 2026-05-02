from decimal import Decimal

from sqlalchemy import Boolean, ForeignKey, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin
from app.db.types import new_cuid


class Tenant(Base, TimestampMixin):
    __tablename__ = "tenants"

    id: Mapped[str] = mapped_column(String(24), primary_key=True, default=new_cuid)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    slug: Mapped[str] = mapped_column(String(60), nullable=False, unique=True)

    stores: Mapped[list["Store"]] = relationship(back_populates="tenant", cascade="all, delete-orphan")


class Store(Base, TimestampMixin):
    __tablename__ = "stores"
    __table_args__ = (UniqueConstraint("tenant_id", "slug", name="uq_stores_tenant_slug"),)

    id: Mapped[str] = mapped_column(String(24), primary_key=True, default=new_cuid)
    tenant_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    slug: Mapped[str] = mapped_column(String(60), nullable=False)
    vat_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    vat_rate: Mapped[Decimal] = mapped_column(Numeric(5, 4), nullable=False, default=Decimal("0.0700"))
    promptpay_id: Mapped[str | None] = mapped_column(String(20), nullable=True)

    tenant: Mapped[Tenant] = relationship(back_populates="stores")
