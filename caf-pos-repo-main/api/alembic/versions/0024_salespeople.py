"""add salespeople table and customers.sales_id

Revision ID: 0024
Revises: 0023
Create Date: 2026-06-12
"""

import sqlalchemy as sa

from alembic import op

revision = "0024"
down_revision = "0023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "salespeople",
        sa.Column("id", sa.String(24), primary_key=True),
        sa.Column("store_id", sa.String(24), sa.ForeignKey("stores.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("store_id", "name", name="uq_salespeople_store_name"),
    )

    op.add_column("customers", sa.Column("sales_id", sa.String(24), nullable=True))
    op.create_foreign_key(
        "fk_customers_sales_id",
        "customers",
        "salespeople",
        ["sales_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_customers_sales_id", "customers", ["sales_id"])


def downgrade() -> None:
    op.drop_index("ix_customers_sales_id", table_name="customers")
    op.drop_constraint("fk_customers_sales_id", "customers", type_="foreignkey")
    op.drop_column("customers", "sales_id")
    op.drop_table("salespeople")
