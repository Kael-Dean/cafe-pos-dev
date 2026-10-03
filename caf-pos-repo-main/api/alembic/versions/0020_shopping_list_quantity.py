"""shopping list item quantity

Revision ID: 0020
Revises: 0019
Create Date: 2026-06-05
"""
import sqlalchemy as sa

from alembic import op

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "shopping_list_items",
        sa.Column("quantity", sa.Numeric(10, 3), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("shopping_list_items", "quantity")
