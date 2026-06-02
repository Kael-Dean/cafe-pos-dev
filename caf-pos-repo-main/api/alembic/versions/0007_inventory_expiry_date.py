"""inventory_expiry_date: add expiry_date to inventory_items

Revision ID: 0007_inventory_expiry_date
Revises: 0006_store_promptpay_id
Create Date: 2026-05-03
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0007_inventory_expiry_date"
down_revision: str | None = "0006_store_promptpay_id"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "inventory_items",
        sa.Column("expiry_date", sa.Date, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("inventory_items", "expiry_date")
