"""initial schema: tenants, stores, users, inventory_items, stock_movements

Revision ID: 0001_initial
Revises:
Create Date: 2026-04-30
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0001_initial"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


role_enum = sa.Enum("OWNER", "MANAGER", "BARISTA", "BAKER", name="role")
movement_type_enum = sa.Enum(
    "RECEIVE", "SALE", "WASTE", "ADJUST", "TRANSFER_IN", "TRANSFER_OUT", name="movement_type"
)


def upgrade() -> None:
    # Enum types are auto-created by create_table when first referenced via Column(Enum(...)).
    op.create_table(
        "tenants",
        sa.Column("id", sa.String(24), primary_key=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("slug", sa.String(60), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )

    op.create_table(
        "stores",
        sa.Column("id", sa.String(24), primary_key=True),
        sa.Column("tenant_id", sa.String(24), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("slug", sa.String(60), nullable=False),
        sa.Column("vat_enabled", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column(
            "vat_rate", sa.Numeric(5, 4), nullable=False, server_default=sa.text("0.0700")
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("tenant_id", "slug", name="uq_stores_tenant_slug"),
    )
    op.create_index("ix_stores_tenant_id", "stores", ["tenant_id"])

    op.create_table(
        "users",
        sa.Column("id", sa.String(24), primary_key=True),
        sa.Column("tenant_id", sa.String(24), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("store_id", sa.String(24), sa.ForeignKey("stores.id", ondelete="CASCADE"), nullable=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("pin_hash", sa.String(255), nullable=False),
        sa.Column("role", role_enum, nullable=False),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_users_tenant_id", "users", ["tenant_id"])
    op.create_index("ix_users_store_id", "users", ["store_id"])

    op.create_table(
        "inventory_items",
        sa.Column("id", sa.String(24), primary_key=True),
        sa.Column("store_id", sa.String(24), sa.ForeignKey("stores.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("unit", sa.String(24), nullable=False),
        sa.Column("cost_per_unit", sa.Numeric(10, 4), nullable=False, server_default=sa.text("0")),
        sa.Column("stock_on_hand", sa.Numeric(12, 3), nullable=False, server_default=sa.text("0")),
        sa.Column("par_level", sa.Numeric(12, 3), nullable=False, server_default=sa.text("0")),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("store_id", "name", name="uq_inventory_store_name"),
    )
    op.create_index("ix_inventory_items_store_id", "inventory_items", ["store_id"])

    op.create_table(
        "stock_movements",
        sa.Column("id", sa.String(24), primary_key=True),
        sa.Column("store_id", sa.String(24), sa.ForeignKey("stores.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "inventory_item_id",
            sa.String(24),
            sa.ForeignKey("inventory_items.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("type", movement_type_enum, nullable=False),
        sa.Column("quantity", sa.Numeric(12, 3), nullable=False),
        sa.Column("reason", sa.Text, nullable=True),
        sa.Column("ref_order_id", sa.String(24), nullable=True),
        sa.Column(
            "created_by_id",
            sa.String(24),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_movements_store_id", "stock_movements", ["store_id"])
    op.create_index("ix_movements_created_at", "stock_movements", ["created_at"])
    op.create_index("ix_movements_store_created", "stock_movements", ["store_id", "created_at"])
    op.create_index("ix_movements_item_created", "stock_movements", ["inventory_item_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_movements_item_created", table_name="stock_movements")
    op.drop_index("ix_movements_store_created", table_name="stock_movements")
    op.drop_index("ix_movements_created_at", table_name="stock_movements")
    op.drop_index("ix_movements_store_id", table_name="stock_movements")
    op.drop_table("stock_movements")

    op.drop_index("ix_inventory_items_store_id", table_name="inventory_items")
    op.drop_table("inventory_items")

    op.drop_index("ix_users_store_id", table_name="users")
    op.drop_index("ix_users_tenant_id", table_name="users")
    op.drop_table("users")

    op.drop_index("ix_stores_tenant_id", table_name="stores")
    op.drop_table("stores")

    op.drop_table("tenants")

    movement_type_enum.drop(op.get_bind(), checkfirst=True)
    role_enum.drop(op.get_bind(), checkfirst=True)
