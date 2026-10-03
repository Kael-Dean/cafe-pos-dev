"""add modifier_recipe_items table

Revision ID: 0021
Revises: 0020
Create Date: 2026-06-05
"""

import sqlalchemy as sa

from alembic import op

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "modifier_recipe_items",
        sa.Column("id", sa.String(24), primary_key=True),
        sa.Column(
            "modifier_id",
            sa.String(24),
            sa.ForeignKey("modifiers.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "inventory_item_id",
            sa.String(24),
            sa.ForeignKey("inventory_items.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("quantity", sa.Numeric(10, 3), nullable=False),
        sa.Column("mode", sa.String(10), nullable=False, server_default="override"),
        sa.UniqueConstraint("modifier_id", "inventory_item_id", name="uq_mri_modifier_item"),
    )


def downgrade() -> None:
    op.drop_table("modifier_recipe_items")
