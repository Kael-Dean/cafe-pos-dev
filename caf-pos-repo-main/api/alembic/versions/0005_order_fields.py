"""order_fields: add discount, tax to orders; line_total to order_items

Revision ID: 0005_order_fields
Revises: 0004_customers
Create Date: 2026-05-01
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0005_order_fields"
down_revision: str | None = "0004_customers"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "orders",
        sa.Column("discount", sa.Numeric(12, 2), nullable=False, server_default=sa.text("0")),
    )
    op.add_column(
        "orders",
        sa.Column("tax", sa.Numeric(12, 2), nullable=False, server_default=sa.text("0")),
    )
    op.add_column(
        "order_items",
        sa.Column("line_total", sa.Numeric(12, 2), nullable=False, server_default=sa.text("0")),
    )


def downgrade() -> None:
    op.drop_column("order_items", "line_total")
    op.drop_column("orders", "tax")
    op.drop_column("orders", "discount")
