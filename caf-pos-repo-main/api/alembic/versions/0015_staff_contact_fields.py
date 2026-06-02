"""staff contact fields: phone, email, address, position

Revision ID: 0015
Revises: 0014
Create Date: 2026-05-19
"""
import sqlalchemy as sa

from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "CREATE TYPE staff_position AS ENUM ('JUNIOR', 'SENIOR', 'HEAD_OF_STAFF')"
    )

    op.add_column(
        "users",
        sa.Column(
            "position",
            sa.Enum("JUNIOR", "SENIOR", "HEAD_OF_STAFF", name="staff_position", create_type=False),
            nullable=True,
        ),
    )
    op.add_column("users", sa.Column("phone", sa.String(20), nullable=True))
    op.add_column("users", sa.Column("email", sa.String(255), nullable=True))
    op.add_column("users", sa.Column("address", sa.String(500), nullable=True))

    # Backfill position for existing rows
    op.execute("UPDATE users SET position = 'JUNIOR' WHERE position IS NULL")
    op.alter_column("users", "position", nullable=False)

    op.create_unique_constraint("uq_staff_store_phone", "users", ["store_id", "phone"])
    op.create_unique_constraint("uq_staff_store_email", "users", ["store_id", "email"])


def downgrade() -> None:
    op.drop_constraint("uq_staff_store_email", "users", type_="unique")
    op.drop_constraint("uq_staff_store_phone", "users", type_="unique")
    op.drop_column("users", "address")
    op.drop_column("users", "email")
    op.drop_column("users", "phone")
    op.drop_column("users", "position")
    op.execute("DROP TYPE IF EXISTS staff_position")
