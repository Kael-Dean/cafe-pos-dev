from decimal import Decimal

from sqlalchemy import Boolean, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin
from app.db.types import new_cuid
from app.enums import ProductType


class Category(Base, TimestampMixin):
    __tablename__ = "categories"
    __table_args__ = (UniqueConstraint("store_id", "name", name="uq_categories_store_name"),)

    id: Mapped[str] = mapped_column(String(24), primary_key=True, default=new_cuid)
    store_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("stores.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class Product(Base, TimestampMixin):
    __tablename__ = "products"

    id: Mapped[str] = mapped_column(String(24), primary_key=True, default=new_cuid)
    store_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("stores.id", ondelete="CASCADE"), nullable=False, index=True
    )
    category_id: Mapped[str | None] = mapped_column(
        String(24), ForeignKey("categories.id", ondelete="SET NULL"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"))
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    product_type: Mapped[ProductType] = mapped_column(
        SAEnum(ProductType, name="product_type"),
        nullable=False,
        default=ProductType.MADE_TO_ORDER,
    )
    servings_per_batch: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    finished_goods_item_id: Mapped[str | None] = mapped_column(
        String(24), ForeignKey("inventory_items.id", ondelete="SET NULL"), nullable=True
    )


class RecipeItem(Base):
    __tablename__ = "recipe_items"
    __table_args__ = (UniqueConstraint("product_id", "inventory_item_id", name="uq_recipe_product_item"),)

    id: Mapped[str] = mapped_column(String(24), primary_key=True, default=new_cuid)
    product_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True
    )
    inventory_item_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("inventory_items.id", ondelete="CASCADE"), nullable=False
    )
    quantity: Mapped[Decimal] = mapped_column(Numeric(10, 3), nullable=False)


class ModifierGroup(Base, TimestampMixin):
    __tablename__ = "modifier_groups"

    id: Mapped[str] = mapped_column(String(24), primary_key=True, default=new_cuid)
    store_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("stores.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    min_select: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_select: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class Modifier(Base):
    __tablename__ = "modifiers"

    id: Mapped[str] = mapped_column(String(24), primary_key=True, default=new_cuid)
    group_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("modifier_groups.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    price_delta: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False, default=Decimal("0"))
    inventory_item_id: Mapped[str | None] = mapped_column(
        String(24), ForeignKey("inventory_items.id", ondelete="SET NULL"), nullable=True
    )
    inventory_qty: Mapped[Decimal | None] = mapped_column(Numeric(10, 3), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class ProductModifierGroup(Base):
    __tablename__ = "product_modifier_groups"
    __table_args__ = (UniqueConstraint("product_id", "modifier_group_id", name="uq_pmg_product_group"),)

    id: Mapped[str] = mapped_column(String(24), primary_key=True, default=new_cuid)
    product_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True
    )
    modifier_group_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("modifier_groups.id", ondelete="CASCADE"), nullable=False
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class CookingStep(Base):
    __tablename__ = "cooking_steps"
    __table_args__ = (UniqueConstraint("product_id", "sort_order", name="uq_cooking_steps_product_order"),)

    id: Mapped[str] = mapped_column(String(24), primary_key=True, default=new_cuid)
    product_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False)
    instruction: Mapped[str] = mapped_column(String(500), nullable=False)
