"""membership module

Revision ID: 0018
Revises: 0017
Create Date: 2026-05-31
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None

# Pre-declare enum types with create_type=False so op.create_table never tries to
# auto-create them — we handle creation explicitly below.
earn_mode      = postgresql.ENUM("PER_RECEIPT", "PER_BAHT", "PER_ITEM",
                                 name="earn_mode", create_type=False)
reward_type    = postgresql.ENUM("DISCOUNT_FIXED", "DISCOUNT_PERCENT", "FREE_ITEM",
                                 name="reward_type", create_type=False)
reward_scope   = postgresql.ENUM("ALL", "CATEGORY", "SPECIFIC_PRODUCTS",
                                 name="reward_scope", create_type=False)
point_tx_type  = postgresql.ENUM("EARN", "REDEEM", "ADJUST", "EXPIRE",
                                 name="point_tx_type", create_type=False)
membership_tier = postgresql.ENUM("NONE", "BRONZE", "SILVER", "GOLD",
                                  name="membership_tier", create_type=False)


def upgrade() -> None:
    bind = op.get_bind()

    # Create enum types explicitly
    for ddl in [
        "CREATE TYPE earn_mode AS ENUM ('PER_RECEIPT', 'PER_BAHT', 'PER_ITEM')",
        "CREATE TYPE reward_type AS ENUM ('DISCOUNT_FIXED', 'DISCOUNT_PERCENT', 'FREE_ITEM')",
        "CREATE TYPE reward_scope AS ENUM ('ALL', 'CATEGORY', 'SPECIFIC_PRODUCTS')",
        "CREATE TYPE point_tx_type AS ENUM ('EARN', 'REDEEM', 'ADJUST', 'EXPIRE')",
        "CREATE TYPE membership_tier AS ENUM ('NONE', 'BRONZE', 'SILVER', 'GOLD')",
    ]:
        bind.execute(sa.text(ddl))

    op.create_table(
        "membership_programs",
        sa.Column("id", sa.String(24), primary_key=True),
        sa.Column("store_id", sa.String(24),
                  sa.ForeignKey("stores.id", ondelete="CASCADE"), nullable=False),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("earn_mode", earn_mode, nullable=False),
        sa.Column("baht_per_point", sa.Numeric(10, 2), nullable=True),
        sa.Column("points_to_redeem", sa.Integer, nullable=False, server_default="10"),
        sa.Column("reward_type", reward_type, nullable=False),
        sa.Column("reward_value", sa.Numeric(10, 2), nullable=True),
        sa.Column("reward_scope", reward_scope, nullable=False),
        sa.Column("reward_category_id", sa.String(24),
                  sa.ForeignKey("categories.id", ondelete="SET NULL"), nullable=True),
        sa.Column("min_order_baht", sa.Numeric(10, 2), nullable=True),
        sa.Column("points_expire_after_days", sa.Integer, nullable=True),
        sa.Column("tier_bronze_threshold", sa.Integer, nullable=True),
        sa.Column("tier_silver_threshold", sa.Integer, nullable=True),
        sa.Column("tier_gold_threshold", sa.Integer, nullable=True),
        sa.Column("bronze_earn_multiplier", sa.Numeric(4, 2), nullable=False, server_default="1.0"),
        sa.Column("silver_earn_multiplier", sa.Numeric(4, 2), nullable=False, server_default="1.0"),
        sa.Column("gold_earn_multiplier", sa.Numeric(4, 2), nullable=False, server_default="1.0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("store_id", name="uq_membership_programs_store"),
    )

    op.create_table(
        "membership_accounts",
        sa.Column("id", sa.String(24), primary_key=True),
        sa.Column("customer_id", sa.String(24),
                  sa.ForeignKey("customers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("store_id", sa.String(24),
                  sa.ForeignKey("stores.id", ondelete="CASCADE"), nullable=False),
        sa.Column("points_balance", sa.Integer, nullable=False, server_default="0"),
        sa.Column("lifetime_points_earned", sa.Integer, nullable=False, server_default="0"),
        sa.Column("tier", membership_tier, nullable=False, server_default="NONE"),
        sa.Column("date_of_birth", sa.Date, nullable=True),
        sa.Column("joined_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("customer_id", name="uq_membership_accounts_customer"),
    )
    op.create_index("ix_membership_accounts_store", "membership_accounts", ["store_id"])

    op.create_table(
        "membership_reward_products",
        sa.Column("program_id", sa.String(24),
                  sa.ForeignKey("membership_programs.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("product_id", sa.String(24),
                  sa.ForeignKey("products.id", ondelete="CASCADE"), primary_key=True),
    )

    op.create_table(
        "point_transactions",
        sa.Column("id", sa.String(24), primary_key=True),
        sa.Column("account_id", sa.String(24),
                  sa.ForeignKey("membership_accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("store_id", sa.String(24),
                  sa.ForeignKey("stores.id", ondelete="CASCADE"), nullable=False),
        sa.Column("type", point_tx_type, nullable=False),
        sa.Column("delta", sa.Integer, nullable=False),
        sa.Column("balance_after", sa.Integer, nullable=False),
        sa.Column("order_id", sa.String(24),
                  sa.ForeignKey("orders.id", ondelete="SET NULL"), nullable=True),
        sa.Column("note", sa.Text, nullable=True),
        sa.Column("created_by_id", sa.String(24),
                  sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_point_transactions_account", "point_transactions", ["account_id"])

    # Extend orders table
    op.add_column("orders", sa.Column("member_id", sa.String(24),
                  sa.ForeignKey("membership_accounts.id", ondelete="SET NULL"), nullable=True))
    op.add_column("orders", sa.Column("points_earned", sa.Integer, nullable=True))
    op.add_column("orders", sa.Column("reward_redeemed", sa.Boolean,
                  nullable=False, server_default="false"))


def downgrade() -> None:
    op.drop_column("orders", "reward_redeemed")
    op.drop_column("orders", "points_earned")
    op.drop_column("orders", "member_id")
    op.drop_table("point_transactions")
    op.drop_table("membership_reward_products")
    op.drop_table("membership_accounts")
    op.drop_table("membership_programs")
    bind = op.get_bind()
    for typ in ["membership_tier", "point_tx_type", "reward_scope", "reward_type", "earn_mode"]:
        bind.execute(sa.text(f"DROP TYPE IF EXISTS {typ}"))
