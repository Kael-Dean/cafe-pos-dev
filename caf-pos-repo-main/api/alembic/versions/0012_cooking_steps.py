"""cooking steps

Revision ID: 0012
Revises: 0011
Create Date: 2026-05-14
"""
import sqlalchemy as sa

from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "cooking_steps",
        sa.Column("id", sa.String(24), primary_key=True),
        sa.Column(
            "product_id",
            sa.String(24),
            sa.ForeignKey("products.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("sort_order", sa.Integer, nullable=False),
        sa.Column("instruction", sa.String(500), nullable=False),
        sa.UniqueConstraint("product_id", "sort_order", name="uq_cooking_steps_product_order"),
    )
    op.create_index("ix_cooking_steps_product_id", "cooking_steps", ["product_id"])


def downgrade() -> None:
    op.drop_index("ix_cooking_steps_product_id", table_name="cooking_steps")
    op.drop_table("cooking_steps")
