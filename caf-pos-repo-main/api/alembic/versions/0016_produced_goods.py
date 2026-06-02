"""Add product_type, servings_per_batch, finished_goods_item_id to products; add production_orders table.

Revision ID: 0016
Revises: 0015
Create Date: 2026-05-20
"""
import sqlalchemy as sa

from alembic import op

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Extend movement_type enum (Postgres allows ADD VALUE but not DROP VALUE)
    op.execute("ALTER TYPE movement_type ADD VALUE IF NOT EXISTS 'PRODUCTION_USE'")
    op.execute("ALTER TYPE movement_type ADD VALUE IF NOT EXISTS 'PRODUCTION'")

    # 2. Create product_type enum
    op.execute("CREATE TYPE product_type AS ENUM ('MADE_TO_ORDER', 'PRODUCED')")

    # 3. Add columns to products
    op.add_column(
        "products",
        sa.Column(
            "product_type",
            sa.Enum("MADE_TO_ORDER", "PRODUCED", name="product_type"),
            nullable=False,
            server_default="MADE_TO_ORDER",
        ),
    )
    op.add_column(
        "products",
        sa.Column("servings_per_batch", sa.Integer(), nullable=False, server_default="1"),
    )
    op.add_column(
        "products",
        sa.Column("finished_goods_item_id", sa.String(24), nullable=True),
    )
    op.create_foreign_key(
        "fk_products_finished_goods_item",
        "products",
        "inventory_items",
        ["finished_goods_item_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # 4. Create production_orders table
    op.create_table(
        "production_orders",
        sa.Column("id", sa.String(24), primary_key=True),
        sa.Column(
            "store_id",
            sa.String(24),
            sa.ForeignKey("stores.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "product_id",
            sa.String(24),
            sa.ForeignKey("products.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("batches_count", sa.Integer(), nullable=False),
        sa.Column("units_produced", sa.Integer(), nullable=False),
        sa.Column(
            "produced_by",
            sa.String(24),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "produced_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("notes", sa.Text(), nullable=True),
    )
    op.create_index("ix_production_orders_store_id", "production_orders", ["store_id"])
    op.create_index("ix_production_orders_product_id", "production_orders", ["product_id"])


def downgrade() -> None:
    op.drop_table("production_orders")
    op.drop_constraint("fk_products_finished_goods_item", "products", type_="foreignkey")
    op.drop_column("products", "finished_goods_item_id")
    op.drop_column("products", "servings_per_batch")
    op.drop_column("products", "product_type")
    op.execute("DROP TYPE IF EXISTS product_type")
    # Note: Postgres does not support removing enum values — PRODUCTION_USE and PRODUCTION
    # remain in movement_type enum after downgrade.
