"""add daily order number and receipt_no

Revision ID: 0023
Revises: 0022
Create Date: 2026-06-10
"""
import sqlalchemy as sa

from alembic import op

revision = "0023"
down_revision = "0022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Add new columns as nullable first (backfill before NOT NULL)
    op.add_column("orders", sa.Column("business_date", sa.Date(), nullable=True))
    op.add_column("orders", sa.Column("daily_number", sa.Integer(), nullable=True))
    op.add_column("orders", sa.Column("receipt_no", sa.String(32), nullable=True))

    # 2. Create the counter table
    op.create_table(
        "order_daily_counters",
        sa.Column(
            "store_id",
            sa.String(24),
            sa.ForeignKey("stores.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
        sa.Column("business_date", sa.Date(), primary_key=True, nullable=False),
        sa.Column("last_number", sa.Integer(), nullable=False),
    )

    bind = op.get_bind()

    # 3a. Backfill business_date from created_at (timestamptz -> Asia/Bangkok date)
    bind.execute(sa.text(
        "UPDATE orders SET business_date = (created_at AT TIME ZONE 'Asia/Bangkok')::date"
    ))

    # 3b. Backfill daily_number as row-number within (store_id, business_date), ordered by created_at
    bind.execute(sa.text("""
        WITH numbered AS (
            SELECT id,
                   ROW_NUMBER() OVER (
                       PARTITION BY store_id, business_date
                       ORDER BY created_at, order_number
                   ) AS rn
            FROM orders
        )
        UPDATE orders o
        SET daily_number = n.rn
        FROM numbered n
        WHERE o.id = n.id
    """))

    # 3c. Backfill receipt_no using Buddhist year format
    bind.execute(sa.text("""
        UPDATE orders
        SET receipt_no =
            'IV'
            || (EXTRACT(YEAR FROM business_date)::int + 543)::text
            || lpad(EXTRACT(MONTH FROM business_date)::int::text, 2, '0')
            || lpad(EXTRACT(DAY   FROM business_date)::int::text, 2, '0')
            || '-'
            || lpad(daily_number::text, 4, '0')
    """))

    # 3d. Seed counter table with current max per store/day
    bind.execute(sa.text("""
        INSERT INTO order_daily_counters (store_id, business_date, last_number)
        SELECT store_id, business_date, MAX(daily_number)
        FROM orders
        GROUP BY store_id, business_date
    """))

    # 4. Enforce NOT NULL now that all rows are filled
    op.alter_column("orders", "business_date", nullable=False)
    op.alter_column("orders", "daily_number", nullable=False)
    op.alter_column("orders", "receipt_no", nullable=False)

    # 5. Add constraints and indexes
    op.create_unique_constraint(
        "uq_orders_store_date_daily", "orders", ["store_id", "business_date", "daily_number"]
    )
    op.create_unique_constraint(
        "uq_orders_store_receipt_no", "orders", ["store_id", "receipt_no"]
    )
    op.create_index("ix_orders_store_business_date", "orders", ["store_id", "business_date"])


def downgrade() -> None:
    op.drop_index("ix_orders_store_business_date", table_name="orders")
    op.drop_constraint("uq_orders_store_receipt_no", "orders", type_="unique")
    op.drop_constraint("uq_orders_store_date_daily", "orders", type_="unique")
    op.drop_table("order_daily_counters")
    op.drop_column("orders", "receipt_no")
    op.drop_column("orders", "daily_number")
    op.drop_column("orders", "business_date")
