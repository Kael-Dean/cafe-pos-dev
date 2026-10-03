"""add session reconciliation support

Revision ID: 0022
Revises: 0021
Create Date: 2026-06-06
"""

import sqlalchemy as sa

from alembic import op

revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("stores", sa.Column("payment_groups", sa.JSON(), nullable=True))
    op.create_table(
        "session_payment_entries",
        sa.Column("id", sa.String(24), primary_key=True),
        sa.Column(
            "session_id",
            sa.String(24),
            sa.ForeignKey("cash_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "store_id",
            sa.String(24),
            sa.ForeignKey("stores.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("group_name", sa.String(100), nullable=False),
        sa.Column("methods", sa.JSON(), nullable=False),
        sa.Column("system_total", sa.Numeric(12, 2), nullable=False),
        sa.Column("actual_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("variance", sa.Numeric(12, 2), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_spe_session_id", "session_payment_entries", ["session_id"])
    op.create_index("ix_spe_store_id", "session_payment_entries", ["store_id"])


def downgrade() -> None:
    op.drop_index("ix_spe_session_id", table_name="session_payment_entries")
    op.drop_index("ix_spe_store_id", table_name="session_payment_entries")
    op.drop_table("session_payment_entries")
    op.drop_column("stores", "payment_groups")
