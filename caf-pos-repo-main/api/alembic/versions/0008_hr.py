"""hr: add leaves and shift_assignments tables

Revision ID: 0008_hr
Revises: 0007_inventory_expiry_date
Create Date: 2026-05-03
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0008_hr"
down_revision: Union[str, None] = "0007_inventory_expiry_date"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "leaves",
        sa.Column("id", sa.String(24), primary_key=True),
        sa.Column("store_id", sa.String(24), sa.ForeignKey("stores.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.String(24), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("start_date", sa.Date, nullable=False),
        sa.Column("end_date", sa.Date, nullable=False),
        sa.Column(
            "leave_type",
            sa.Enum("VACATION", "SICK", "PERSONAL", "OTHER", name="leave_type"),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.Enum("PENDING", "APPROVED", "REJECTED", name="leave_status"),
            nullable=False,
            server_default="PENDING",
        ),
        sa.Column("note", sa.Text, nullable=True),
        sa.Column("reviewed_by_id", sa.String(24), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_leaves_store_id", "leaves", ["store_id"])
    op.create_index("ix_leaves_user_id", "leaves", ["user_id"])

    op.create_table(
        "shift_assignments",
        sa.Column("id", sa.String(24), primary_key=True),
        sa.Column("store_id", sa.String(24), sa.ForeignKey("stores.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.String(24), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("assignment_date", sa.Date, nullable=False),
        sa.Column(
            "shift_type",
            sa.Enum("MORNING", "AFTERNOON", "EVENING", "FULL_DAY", "OFF", name="shift_type"),
            nullable=False,
        ),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("created_by_id", sa.String(24), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("store_id", "user_id", "assignment_date", name="uq_shift_user_date"),
    )
    op.create_index("ix_shifts_store_date", "shift_assignments", ["store_id", "assignment_date"])


def downgrade() -> None:
    op.drop_index("ix_shifts_store_date", table_name="shift_assignments")
    op.drop_table("shift_assignments")
    op.drop_index("ix_leaves_user_id", table_name="leaves")
    op.drop_index("ix_leaves_store_id", table_name="leaves")
    op.drop_table("leaves")
    op.execute("DROP TYPE IF EXISTS shift_type")
    op.execute("DROP TYPE IF EXISTS leave_status")
    op.execute("DROP TYPE IF EXISTS leave_type")
