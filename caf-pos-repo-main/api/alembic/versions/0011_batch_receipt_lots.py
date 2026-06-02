"""batch receipt and stock lots

Revision ID: 0011
Revises: 0010_hr_enhancements
Create Date: 2026-05-14
"""
import sqlalchemy as sa

from alembic import op

revision = "0011"
down_revision = "0010_hr_enhancements"
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.execute("DROP TYPE IF EXISTS receipt_status")

    op.create_table(
        "stock_receipts",
        sa.Column("id", sa.String(24), primary_key=True),
        sa.Column("store_id", sa.String(24), sa.ForeignKey("stores.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("status", sa.Enum("DRAFT", "CONFIRMED", name="receipt_status"), nullable=False, server_default="DRAFT"),
        sa.Column("supplier_name", sa.String(120), nullable=True),
        sa.Column("receipt_ref", sa.String(80), nullable=True),
        sa.Column("note", sa.Text, nullable=True),
        sa.Column("received_at", sa.Date, nullable=False),
        sa.Column("created_by_id", sa.String(24), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "stock_lots",
        sa.Column("id", sa.String(24), primary_key=True),
        sa.Column("store_id", sa.String(24), sa.ForeignKey("stores.id", ondelete="CASCADE"), nullable=False),
        sa.Column("receipt_id", sa.String(24), sa.ForeignKey("stock_receipts.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("inventory_item_id", sa.String(24), sa.ForeignKey("inventory_items.id", ondelete="CASCADE"), nullable=False),
        sa.Column("qty_received", sa.Numeric(12, 3), nullable=False),
        sa.Column("qty_remaining", sa.Numeric(12, 3), nullable=False),
        sa.Column("cost_per_unit", sa.Numeric(12, 4), nullable=False),
        sa.Column("expiry_date", sa.Date, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_lots_item_remaining", "stock_lots", ["inventory_item_id", "qty_remaining", "created_at"])

    op.drop_column("inventory_items", "expiry_date")
    op.execute("UPDATE inventory_items SET stock_on_hand = 0")


def downgrade() -> None:
    op.add_column("inventory_items", sa.Column("expiry_date", sa.Date, nullable=True))
    op.drop_index("ix_lots_item_remaining", table_name="stock_lots")
    op.drop_table("stock_lots")
    op.drop_table("stock_receipts")
    receipt_status.drop(op.get_bind())  # noqa: F821
