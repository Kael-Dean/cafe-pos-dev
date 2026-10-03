"""add image_url to products

Revision ID: 0025
Revises: 0024
Create Date: 2026-06-15
"""
import sqlalchemy as sa

from alembic import op

revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("products", sa.Column("image_url", sa.String(512), nullable=True))


def downgrade() -> None:
    op.drop_column("products", "image_url")
