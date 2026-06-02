"""add promotions

Revision ID: 0019
Revises: 0018
Create Date: 2026-06-01
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None

# Pre-declare enum types with create_type=False so op.create_table never tries to
# auto-create them — we handle creation explicitly below.
promotion_type = postgresql.ENUM(
    "PERCENT_OFF", "COMBO_BUNDLE", "COMBO_QUANTITY", "HAPPY_HOUR",
    name="promotion_type", create_type=False,
)
promotion_scope = postgresql.ENUM(
    "ORDER", "CATEGORY", "PRODUCT",
    name="promotion_scope", create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()

    # Create enum types explicitly
    for ddl in [
        "CREATE TYPE promotion_type AS ENUM ('PERCENT_OFF', 'COMBO_BUNDLE', 'COMBO_QUANTITY', 'HAPPY_HOUR')",
        "CREATE TYPE promotion_scope AS ENUM ('ORDER', 'CATEGORY', 'PRODUCT')",
    ]:
        bind.execute(sa.text(ddl))

    op.create_table(
        "promotions",
        sa.Column("id", sa.String(24), primary_key=True),
        sa.Column("store_id", sa.String(24),
                  sa.ForeignKey("stores.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("type", promotion_type, nullable=False),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("is_exclusive", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("discount_pct", sa.Numeric(5, 2), nullable=True),
        sa.Column("scope", promotion_scope, nullable=False, server_default="ORDER"),
        sa.Column("product_ids_json", sa.JSON, nullable=True),
        sa.Column("category_id", sa.String(24),
                  sa.ForeignKey("categories.id", ondelete="SET NULL"), nullable=True),
        sa.Column("min_quantity", sa.Integer, nullable=True),
        sa.Column("bundle_product_ids_json", sa.JSON, nullable=True),
        sa.Column("time_start", sa.Time, nullable=True),
        sa.Column("time_end", sa.Time, nullable=True),
        sa.Column("days_of_week_json", sa.JSON, nullable=True),
        sa.Column("valid_from", sa.Date, nullable=True),
        sa.Column("valid_until", sa.Date, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_promotions_store_id", "promotions", ["store_id"])

    op.create_table(
        "promotion_redemptions",
        sa.Column("id", sa.String(24), primary_key=True),
        sa.Column("promotion_id", sa.String(24),
                  sa.ForeignKey("promotions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("order_id", sa.String(24),
                  sa.ForeignKey("orders.id", ondelete="CASCADE"), nullable=False),
        sa.Column("discount_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("order_id", "promotion_id", name="uq_redemption_order_promotion"),
    )
    op.create_index("ix_promotion_redemptions_promotion_id", "promotion_redemptions", ["promotion_id"])
    op.create_index("ix_promotion_redemptions_order_id", "promotion_redemptions", ["order_id"])


def downgrade() -> None:
    op.drop_table("promotion_redemptions")
    op.drop_table("promotions")
    bind = op.get_bind()
    for typ in ["promotion_scope", "promotion_type"]:
        bind.execute(sa.text(f"DROP TYPE IF EXISTS {typ}"))
