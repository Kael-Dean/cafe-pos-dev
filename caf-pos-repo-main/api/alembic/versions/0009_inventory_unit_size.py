"""inventory_unit_size: add unit_size/piece_price to inventory_items, unit_cost to stock_movements

Revision ID: 0009_inventory_unit_size
Revises: 0008_hr
Create Date: 2026-05-04
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0009_inventory_unit_size"
down_revision: str | None = "0008_hr"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("inventory_items", sa.Column("unit_size", sa.Numeric(12, 3), nullable=True))
    op.add_column("inventory_items", sa.Column("piece_price", sa.Numeric(12, 2), nullable=True))
    op.add_column("stock_movements", sa.Column("unit_cost", sa.Numeric(12, 4), nullable=True))


def downgrade() -> None:
    op.drop_column("stock_movements", "unit_cost")
    op.drop_column("inventory_items", "piece_price")
    op.drop_column("inventory_items", "unit_size")
