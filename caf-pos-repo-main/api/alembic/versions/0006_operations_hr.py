"""operations & hr: cash, promotions, protocols, leaves, shifts

Revision ID: 0006_operations_hr
Revises: 0005_order_fields
Create Date: 2026-05-02
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0006_operations_hr"
down_revision: Union[str, None] = "0005_order_fields"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── cash_sessions ────────────────────────────────────────────────────────
    op.create_table(
        "cash_sessions",
        sa.Column("id", sa.String(24), primary_key=True),
        sa.Column("store_id", sa.String(24), sa.ForeignKey("stores.id", ondelete="CASCADE"), nullable=False),
        sa.Column("session_date", sa.Date, nullable=False),
        sa.Column("opening_balance", sa.Numeric(10, 2), nullable=False, server_default=sa.text("0")),
        sa.Column("closing_balance", sa.Numeric(10, 2), nullable=True),
        sa.Column(
            "status",
            sa.Enum("OPEN", "CLOSED", name="cash_session_status"),
            nullable=False,
            server_default="OPEN",
        ),
        sa.Column("opened_by_id", sa.String(24), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("closed_by_id", sa.String(24), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_cash_sessions_store_id", "cash_sessions", ["store_id"])
    op.create_index("ix_cash_sessions_store_date", "cash_sessions", ["store_id", "session_date"])

    # ── cash_payouts ─────────────────────────────────────────────────────────
    op.create_table(
        "cash_payouts",
        sa.Column("id", sa.String(24), primary_key=True),
        sa.Column("cash_session_id", sa.String(24), sa.ForeignKey("cash_sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("store_id", sa.String(24), sa.ForeignKey("stores.id", ondelete="CASCADE"), nullable=False),
        sa.Column("amount", sa.Numeric(10, 2), nullable=False),
        sa.Column(
            "payout_type",
            sa.Enum("PAYOUT", "PETTY_CASH", "WITHDRAWAL", name="payout_type"),
            nullable=False,
        ),
        sa.Column("description", sa.String(255), nullable=False),
        sa.Column("created_by_id", sa.String(24), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_cash_payouts_session_id", "cash_payouts", ["cash_session_id"])
    op.create_index("ix_cash_payouts_store_id", "cash_payouts", ["store_id"])

    # ── promotions ───────────────────────────────────────────────────────────
    op.create_table(
        "promotions",
        sa.Column("id", sa.String(24), primary_key=True),
        sa.Column("store_id", sa.String(24), sa.ForeignKey("stores.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column(
            "discount_type",
            sa.Enum("PERCENT", "FIXED", name="discount_type"),
            nullable=False,
        ),
        sa.Column("discount_value", sa.Numeric(10, 2), nullable=False),
        sa.Column("min_order_amount", sa.Numeric(10, 2), nullable=False, server_default=sa.text("0")),
        sa.Column("start_date", sa.Date, nullable=True),
        sa.Column("end_date", sa.Date, nullable=True),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column("created_by_id", sa.String(24), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_promotions_store_id", "promotions", ["store_id"])

    # ── protocols ────────────────────────────────────────────────────────────
    op.create_table(
        "protocols",
        sa.Column("id", sa.String(24), primary_key=True),
        sa.Column("store_id", sa.String(24), sa.ForeignKey("stores.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column(
            "frequency",
            sa.Enum("DAILY", "OPENING", "CLOSING", "WEEKLY", name="protocol_frequency"),
            nullable=False,
        ),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column("created_by_id", sa.String(24), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_protocols_store_id", "protocols", ["store_id"])

    # ── protocol_tasks ───────────────────────────────────────────────────────
    op.create_table(
        "protocol_tasks",
        sa.Column("id", sa.String(24), primary_key=True),
        sa.Column("protocol_id", sa.String(24), sa.ForeignKey("protocols.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default=sa.text("0")),
    )
    op.create_index("ix_protocol_tasks_protocol_id", "protocol_tasks", ["protocol_id"])

    # ── protocol_logs ────────────────────────────────────────────────────────
    op.create_table(
        "protocol_logs",
        sa.Column("id", sa.String(24), primary_key=True),
        sa.Column("protocol_id", sa.String(24), sa.ForeignKey("protocols.id", ondelete="CASCADE"), nullable=False),
        sa.Column("store_id", sa.String(24), sa.ForeignKey("stores.id", ondelete="CASCADE"), nullable=False),
        sa.Column("log_date", sa.Date, nullable=False),
        sa.Column("completed_task_ids", sa.JSON, nullable=False, server_default=sa.text("'[]'::json")),
        sa.Column("completed_by_id", sa.String(24), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_protocol_logs_protocol_id", "protocol_logs", ["protocol_id"])
    op.create_index("ix_protocol_logs_store_date", "protocol_logs", ["store_id", "log_date"])

    # ── leave_requests ───────────────────────────────────────────────────────
    op.create_table(
        "leave_requests",
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
    op.create_index("ix_leave_requests_store_id", "leave_requests", ["store_id"])
    op.create_index("ix_leave_requests_store_user", "leave_requests", ["store_id", "user_id"])

    # ── shift_assignments ────────────────────────────────────────────────────
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
        sa.UniqueConstraint("store_id", "user_id", "assignment_date", name="uq_shift_store_user_date"),
    )
    op.create_index("ix_shift_assignments_store_id", "shift_assignments", ["store_id"])
    op.create_index("ix_shift_assignments_store_date", "shift_assignments", ["store_id", "assignment_date"])


def downgrade() -> None:
    op.drop_table("shift_assignments")
    op.drop_table("leave_requests")
    op.drop_table("protocol_logs")
    op.drop_table("protocol_tasks")
    op.drop_table("protocols")
    op.drop_table("promotions")
    op.drop_table("cash_payouts")
    op.drop_table("cash_sessions")
    op.execute("DROP TYPE IF EXISTS shift_type")
    op.execute("DROP TYPE IF EXISTS leave_status")
    op.execute("DROP TYPE IF EXISTS leave_type")
    op.execute("DROP TYPE IF EXISTS protocol_frequency")
    op.execute("DROP TYPE IF EXISTS discount_type")
    op.execute("DROP TYPE IF EXISTS payout_type")
    op.execute("DROP TYPE IF EXISTS cash_session_status")
