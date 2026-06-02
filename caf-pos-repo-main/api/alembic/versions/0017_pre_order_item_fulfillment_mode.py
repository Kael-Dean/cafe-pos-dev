"""Add fulfillment_mode column to pre_order_items.

Revision ID: 0017
Revises: 0016
Create Date: 2026-05-23
"""
import sqlalchemy as sa
from alembic import op

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "CREATE TYPE fulfillment_mode AS ENUM ('PRODUCE_FRESH', 'FROM_INVENTORY')"
    )
    op.add_column(
        "pre_order_items",
        sa.Column(
            "fulfillment_mode",
            sa.Enum("PRODUCE_FRESH", "FROM_INVENTORY", name="fulfillment_mode", create_type=False),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("pre_order_items", "fulfillment_mode")
    op.execute("DROP TYPE IF EXISTS fulfillment_mode")
