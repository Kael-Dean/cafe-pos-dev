"""store_promptpay_id: add promptpay_id to stores table

Revision ID: 0006_store_promptpay_id
Revises: 0005_order_fields
Create Date: 2026-05-01
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0006_store_promptpay_id"
down_revision: Union[str, None] = "0005_order_fields"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("stores", sa.Column("promptpay_id", sa.String(20), nullable=True))


def downgrade() -> None:
    op.drop_column("stores", "promptpay_id")
