"""pre-orders and shopping list

Revision ID: 0013
Revises: 0012
Create Date: 2026-05-14
"""
import sqlalchemy as sa

from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.execute("DROP TYPE IF EXISTS pre_order_status")

    op.create_table(
        "pre_orders",
        sa.Column("id", sa.String(24), primary_key=True),
        sa.Column("store_id", sa.String(24), sa.ForeignKey("stores.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("order_date", sa.Date, nullable=False),
        sa.Column("due_date", sa.Date, nullable=False, index=True),
        sa.Column("customer_id", sa.String(24), sa.ForeignKey("customers.id", ondelete="SET NULL"), nullable=True),
        sa.Column("customer_name", sa.String(120), nullable=True),
        sa.Column("customer_phone", sa.String(30), nullable=True),
        sa.Column("deposit_amount", sa.Numeric(12, 2), nullable=True),
        sa.Column("deposit_paid", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("status", sa.Enum("PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED", name="pre_order_status"), nullable=False, server_default="PENDING"),
        sa.Column("created_by_id", sa.String(24), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("started_by_id", sa.String(24), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("completed_by_id", sa.String(24), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "pre_order_items",
        sa.Column("id", sa.String(24), primary_key=True),
        sa.Column("pre_order_id", sa.String(24), sa.ForeignKey("pre_orders.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("product_id", sa.String(24), sa.ForeignKey("products.id", ondelete="SET NULL"), nullable=True),
        sa.Column("product_name", sa.String(200), nullable=False),
        sa.Column("quantity", sa.Integer, nullable=False),
        sa.Column("unit_price", sa.Numeric(12, 2), nullable=False),
        sa.Column("line_total", sa.Numeric(12, 2), nullable=False),
    )

    op.create_table(
        "shopping_list_items",
        sa.Column("id", sa.String(24), primary_key=True),
        sa.Column("store_id", sa.String(24), sa.ForeignKey("stores.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("inventory_item_id", sa.String(24), sa.ForeignKey("inventory_items.id", ondelete="CASCADE"), nullable=False),
        sa.Column("added_by_id", sa.String(24), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("note", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("store_id", "inventory_item_id", name="uq_shopping_list_store_item"),
    )


def downgrade() -> None:
    op.drop_table("shopping_list_items")
    op.drop_table("pre_order_items")
    op.drop_table("pre_orders")
    pre_order_status.drop(op.get_bind())  # noqa: F821
