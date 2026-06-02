"""rename piece_price to unit_price on inventory_items

Revision ID: 0014
Revises: 0013
Create Date: 2026-05-14
"""
from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("inventory_items", "piece_price", new_column_name="unit_price")


def downgrade() -> None:
    op.alter_column("inventory_items", "unit_price", new_column_name="piece_price")
