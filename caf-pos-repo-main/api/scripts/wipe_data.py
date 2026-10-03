"""Wipe operational data from the configured database.

Run with:
cd api
$env:DATABASE_URL = "postgresql+asyncpg://USER:PASS@HOST:PORT/DB"
uv run python scripts/wipe_data.py

Preserves:
- tenants, stores, users (auth infrastructure)
- inventory_items rows (id, name, unit, cost_per_unit, par_level, etc.)
  but resets stock_on_hand to 0 on every row

Wipes (all rows truncated):
- catalog: categories, products, recipe_items, modifier_groups, modifiers,
  product_modifier_groups, cooking_steps
- inventory history: stock_movements, stock_receipts, stock_lots
- orders: orders, order_items, order_void_logs
- pre-orders: pre_orders, pre_order_items, shopping_list_items
- customers
- HR: leaves, shift_assignments, cash_sessions, staff_tasks
- production: production_orders
- membership: membership_programs, membership_reward_products,
  membership_accounts, point_transactions
- promotions: promotions, promotion_redemptions

Refuses to run without explicit confirmation. Pass --yes to skip the prompt
(for CI / scripted use). Always prints the target database first so you can
spot a misconfigured DATABASE_URL before pressing enter.
"""
import argparse
import asyncio
import sys
from pathlib import Path

# Allow `python scripts/wipe_data.py` from the api/ root.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import text
from sqlalchemy.engine.url import make_url

from app.config import get_settings
from app.db.session import async_session_maker, engine

TABLES_TO_TRUNCATE = [
    # catalog
    "cooking_steps",
    "product_modifier_groups",
    "modifiers",
    "modifier_groups",
    "recipe_items",
    "products",
    "categories",
    # inventory history (NOT inventory_items)
    "stock_lots",
    "stock_receipts",
    "stock_movements",
    # orders
    "order_void_logs",
    "order_items",
    "orders",
    # pre-orders
    "shopping_list_items",
    "pre_order_items",
    "pre_orders",
    # customers
    "customers",
    # HR
    "staff_tasks",
    "cash_sessions",
    "shift_assignments",
    "leaves",
    # production
    "production_orders",
    # membership
    "point_transactions",
    "membership_accounts",
    "membership_reward_products",
    "membership_programs",
    # promotions
    "promotion_redemptions",
    "promotions",
]


def _describe_target() -> str:
    url = make_url(get_settings().DATABASE_URL)
    host = url.host or "?"
    port = url.port or "?"
    db = url.database or "?"
    user = url.username or "?"
    return f"{user}@{host}:{port}/{db}"


def _confirm(target: str) -> bool:
    print(f"\n!!! ABOUT TO WIPE OPERATIONAL DATA FROM: {target}")
    print("This preserves tenants, stores, users, and inventory_items rows.")
    print("Everything else (orders, stock movements, catalog, etc.) will be deleted.")
    print("stock_on_hand on all inventory_items will be reset to 0.\n")
    answer = input("Type 'wipe' to continue, anything else to abort: ").strip().lower()
    return answer == "wipe"


async def wipe() -> None:
    table_list = ", ".join(TABLES_TO_TRUNCATE)
    truncate_sql = f"TRUNCATE TABLE {table_list} RESTART IDENTITY CASCADE;"
    reset_sql = "UPDATE inventory_items SET stock_on_hand = 0;"

    async with async_session_maker() as session:
        async with session.begin():
            await session.execute(text(truncate_sql))
            result = await session.execute(text(reset_sql))
            reset_count = result.rowcount

    await engine.dispose()
    print(f"\nTruncated {len(TABLES_TO_TRUNCATE)} tables.")
    print(f"Reset stock_on_hand=0 on {reset_count} inventory_items rows.")
    print("Done.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Skip interactive confirmation (use with care).",
    )
    args = parser.parse_args()

    target = _describe_target()
    if not args.yes and not _confirm(target):
        print("Aborted.")
        sys.exit(1)

    asyncio.run(wipe())


if __name__ == "__main__":
    main()
