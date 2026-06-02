"""hr_enhancements: shift times, cash sessions, staff tasks

Revision ID: 0010_hr_enhancements
Revises: 0009_inventory_unit_size
Create Date: 2026-05-05
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0010_hr_enhancements"
down_revision: str | None = "0009_inventory_unit_size"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # --- shift_assignments: replace shift_type enum with start_time / end_time ---
    op.add_column(
        "shift_assignments",
        sa.Column("start_time", sa.Time, nullable=False, server_default="08:00:00"),
    )
    op.add_column(
        "shift_assignments",
        sa.Column("end_time", sa.Time, nullable=False, server_default="17:00:00"),
    )
    op.alter_column("shift_assignments", "start_time", server_default=None)
    op.alter_column("shift_assignments", "end_time", server_default=None)
    op.drop_column("shift_assignments", "shift_type")
    op.execute("DROP TYPE IF EXISTS shift_type")

    # --- cash_sessions ---
    op.create_table(
        "cash_sessions",
        sa.Column("id", sa.String(24), primary_key=True),
        sa.Column(
            "store_id",
            sa.String(24),
            sa.ForeignKey("stores.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "opened_by_id",
            sa.String(24),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "closed_by_id",
            sa.String(24),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("cash_open", sa.Numeric(12, 2), nullable=False),
        sa.Column("cash_close", sa.Numeric(12, 2), nullable=True),
        sa.Column("opened_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index("ix_cash_sessions_store_id", "cash_sessions", ["store_id"])

    # --- staff_tasks ---
    # Drop orphaned enum in case a previous deploy failed mid-migration
    op.execute("DROP TYPE IF EXISTS task_status")

    op.create_table(
        "staff_tasks",
        sa.Column("id", sa.String(24), primary_key=True),
        sa.Column(
            "store_id",
            sa.String(24),
            sa.ForeignKey("stores.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "assignee_id",
            sa.String(24),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_by_id",
            sa.String(24),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column(
            "status",
            sa.Enum("TODO", "IN_PROGRESS", "PENDING_REVIEW", "DONE", name="task_status"),
            nullable=False,
            server_default="TODO",
        ),
        sa.Column("due_date", sa.Date, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index("ix_tasks_store_id", "staff_tasks", ["store_id"])
    op.create_index("ix_tasks_assignee_id", "staff_tasks", ["assignee_id"])


def downgrade() -> None:
    op.drop_index("ix_tasks_assignee_id", table_name="staff_tasks")
    op.drop_index("ix_tasks_store_id", table_name="staff_tasks")
    op.drop_table("staff_tasks")
    op.execute("DROP TYPE IF EXISTS task_status")

    op.drop_index("ix_cash_sessions_store_id", table_name="cash_sessions")
    op.drop_table("cash_sessions")

    op.execute(
        "CREATE TYPE shift_type AS ENUM "
        "('MORNING', 'AFTERNOON', 'EVENING', 'FULL_DAY', 'OFF')"
    )
    op.add_column(
        "shift_assignments",
        sa.Column(
            "shift_type",
            sa.Enum("MORNING", "AFTERNOON", "EVENING", "FULL_DAY", "OFF", name="shift_type"),
            nullable=False,
            server_default="MORNING",
        ),
    )
    op.alter_column("shift_assignments", "shift_type", server_default=None)
    op.drop_column("shift_assignments", "end_time")
    op.drop_column("shift_assignments", "start_time")
