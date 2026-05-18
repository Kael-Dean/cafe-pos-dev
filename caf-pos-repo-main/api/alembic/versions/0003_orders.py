"""orders: orders, order_items, order_void_logs

Revision ID: 0003_orders
Revises: 0002_catalog
Create Date: 2026-04-30
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0003_orders"
down_revision: Union[str, None] = "0002_catalog"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE SEQUENCE IF NOT EXISTS order_number_seq START 1001")

    op.create_table(
        "orders",
        sa.Column("id", sa.String(24), primary_key=True),
        sa.Column("order_number", sa.Integer, server_default=sa.text("nextval('order_number_seq')"), nullable=False),
        sa.Column("store_id", sa.String(24), sa.ForeignKey("stores.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "status",
            sa.Enum("PENDING", "PAID", "IN_PROGRESS", "READY", "COMPLETED", "VOID", name="order_status"),
            nullable=False,
            server_default="PENDING",
        ),
        sa.Column(
            "channel",
            sa.Enum("DINE_IN", "TAKEAWAY", "DELIVERY", name="channel"),
            nullable=False,
        ),
        sa.Column(
            "payment_method",
            sa.Enum("CASH", "CARD", "QR_PROMPTPAY", "LINE_PAY", "TRUEMONEY", "OTHER", name="payment_method"),
            nullable=True,
        ),
        sa.Column("payment_ref", sa.String(120), nullable=True),
        sa.Column("idempotency_key", sa.String(120), nullable=False),
        sa.Column("customer_note", sa.Text, nullable=True),
        sa.Column("subtotal", sa.Numeric(12, 2), nullable=False, server_default=sa.text("0")),
        sa.Column("total", sa.Numeric(12, 2), nullable=False, server_default=sa.text("0")),
        sa.Column("created_by_id", sa.String(24), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("store_id", "idempotency_key", name="uq_orders_store_idempotency"),
    )
    op.create_index("ix_orders_store_id", "orders", ["store_id"])
    op.create_index("ix_orders_store_status", "orders", ["store_id", "status"])
    op.create_index("ix_orders_store_created", "orders", ["store_id", "created_at"])

    op.create_table(
        "order_items",
        sa.Column("id", sa.String(24), primary_key=True),
        sa.Column("order_id", sa.String(24), sa.ForeignKey("orders.id", ondelete="CASCADE"), nullable=False),
        sa.Column("product_id", sa.String(24), sa.ForeignKey("products.id", ondelete="SET NULL"), nullable=True),
        sa.Column("product_name", sa.String(120), nullable=False),
        sa.Column("quantity", sa.Integer, nullable=False),
        sa.Column("unit_price", sa.Numeric(12, 2), nullable=False),
        sa.Column("modifiers_json", sa.JSON, nullable=True),
    )
    op.create_index("ix_order_items_order_id", "order_items", ["order_id"])

    op.create_table(
        "order_void_logs",
        sa.Column("id", sa.String(24), primary_key=True),
        sa.Column("order_id", sa.String(24), sa.ForeignKey("orders.id", ondelete="CASCADE"), nullable=False),
        sa.Column("voided_by_id", sa.String(24), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("reason", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_order_void_logs_order_id", "order_void_logs", ["order_id"])


def downgrade() -> None:
    op.drop_table("order_void_logs")
    op.drop_table("order_items")
    op.drop_table("orders")
    op.execute("DROP TYPE IF EXISTS order_status")
    op.execute("DROP TYPE IF EXISTS channel")
    op.execute("DROP TYPE IF EXISTS payment_method")
    op.execute("DROP SEQUENCE IF EXISTS order_number_seq")
