"""catalog: categories, products, recipe_items, modifier_groups, modifiers, product_modifier_groups

Revision ID: 0002_catalog
Revises: 0001_initial
Create Date: 2026-04-30
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002_catalog"
down_revision: Union[str, None] = "0001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "categories",
        sa.Column("id", sa.String(24), primary_key=True),
        sa.Column("store_id", sa.String(24), sa.ForeignKey("stores.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default=sa.text("0")),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("store_id", "name", name="uq_categories_store_name"),
    )
    op.create_index("ix_categories_store_id", "categories", ["store_id"])

    op.create_table(
        "products",
        sa.Column("id", sa.String(24), primary_key=True),
        sa.Column("store_id", sa.String(24), sa.ForeignKey("stores.id", ondelete="CASCADE"), nullable=False),
        sa.Column("category_id", sa.String(24), sa.ForeignKey("categories.id", ondelete="SET NULL"), nullable=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("price", sa.Numeric(12, 2), nullable=False, server_default=sa.text("0")),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_products_store_id", "products", ["store_id"])
    op.create_index("ix_products_category_id", "products", ["category_id"])

    op.create_table(
        "recipe_items",
        sa.Column("id", sa.String(24), primary_key=True),
        sa.Column("product_id", sa.String(24), sa.ForeignKey("products.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "inventory_item_id",
            sa.String(24),
            sa.ForeignKey("inventory_items.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("quantity", sa.Numeric(10, 3), nullable=False),
        sa.UniqueConstraint("product_id", "inventory_item_id", name="uq_recipe_product_item"),
    )
    op.create_index("ix_recipe_items_product_id", "recipe_items", ["product_id"])

    op.create_table(
        "modifier_groups",
        sa.Column("id", sa.String(24), primary_key=True),
        sa.Column("store_id", sa.String(24), sa.ForeignKey("stores.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("required", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("min_select", sa.Integer, nullable=False, server_default=sa.text("0")),
        sa.Column("max_select", sa.Integer, nullable=True),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_modifier_groups_store_id", "modifier_groups", ["store_id"])

    op.create_table(
        "modifiers",
        sa.Column("id", sa.String(24), primary_key=True),
        sa.Column("group_id", sa.String(24), sa.ForeignKey("modifier_groups.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("price_delta", sa.Numeric(10, 2), nullable=False, server_default=sa.text("0")),
        sa.Column(
            "inventory_item_id",
            sa.String(24),
            sa.ForeignKey("inventory_items.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("inventory_qty", sa.Numeric(10, 3), nullable=True),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default=sa.text("0")),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
    )
    op.create_index("ix_modifiers_group_id", "modifiers", ["group_id"])

    op.create_table(
        "product_modifier_groups",
        sa.Column("id", sa.String(24), primary_key=True),
        sa.Column("product_id", sa.String(24), sa.ForeignKey("products.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "modifier_group_id",
            sa.String(24),
            sa.ForeignKey("modifier_groups.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default=sa.text("0")),
        sa.UniqueConstraint("product_id", "modifier_group_id", name="uq_pmg_product_group"),
    )
    op.create_index("ix_product_modifier_groups_product_id", "product_modifier_groups", ["product_id"])


def downgrade() -> None:
    op.drop_index("ix_product_modifier_groups_product_id", table_name="product_modifier_groups")
    op.drop_table("product_modifier_groups")

    op.drop_index("ix_modifiers_group_id", table_name="modifiers")
    op.drop_table("modifiers")

    op.drop_index("ix_modifier_groups_store_id", table_name="modifier_groups")
    op.drop_table("modifier_groups")

    op.drop_index("ix_recipe_items_product_id", table_name="recipe_items")
    op.drop_table("recipe_items")

    op.drop_index("ix_products_category_id", table_name="products")
    op.drop_index("ix_products_store_id", table_name="products")
    op.drop_table("products")

    op.drop_index("ix_categories_store_id", table_name="categories")
    op.drop_table("categories")
