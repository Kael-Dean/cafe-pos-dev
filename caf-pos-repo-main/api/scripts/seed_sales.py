"""Idempotent seed for salespeople and customer-salesperson assignments.

Run locally with:  `uv run python scripts/seed_sales.py`
On Railway it is wired into `preDeployCommand` (see railway.toml) and runs on
every deploy — idempotent, so it is a no-op once data exists.

Target store is resolved by slug from the MEMBER_SEED_STORE_SLUG env var
(default "sukhumvit-49"). If the store does not exist the script logs a warning
and exits 0 — it must never block a deploy.

Idempotent:
  1. Upsert the 3 salespeople for the store (skip if (store_id, name) exists).
  2. For each phone→nickname, look up customer by (store_id, phone) and set
     sales_id only if not already set to that salesperson. Re-running = no-op.
"""

import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import async_session_maker, engine
from app.models import Customer, Store
from app.models.sales import Salesperson
from scripts._sales_seed_data import MEMBER_SALES, SALESPEOPLE

STORE_SLUG = os.getenv("MEMBER_SEED_STORE_SLUG", "sukhumvit-49")


async def _resolve_store(db: AsyncSession) -> Store | None:
    async with db.begin():
        result = await db.execute(select(Store).where(Store.slug == STORE_SLUG))
        return result.scalars().first()


async def _upsert_salespeople(db: AsyncSession, store_id: str) -> dict[str, str]:
    """Upsert salespeople; return name→id mapping."""
    name_to_id: dict[str, str] = {}
    for name in SALESPEOPLE:
        async with db.begin():
            existing = (
                (
                    await db.execute(
                        select(Salesperson).where(Salesperson.store_id == store_id, Salesperson.name == name)
                    )
                )
                .scalars()
                .first()
            )
            if existing:
                name_to_id[name] = existing.id
                continue
            sp = Salesperson(store_id=store_id, name=name)
            db.add(sp)
            await db.flush()
            name_to_id[name] = sp.id
    return name_to_id


async def _assign_customers(db: AsyncSession, store_id: str, name_to_id: dict[str, str]) -> tuple[int, int]:
    assigned = skipped = 0
    for phone, nickname in MEMBER_SALES.items():
        sales_id = name_to_id.get(nickname)
        if not sales_id:
            skipped += 1
            continue
        async with db.begin():
            customer = (
                (
                    await db.execute(
                        select(Customer).where(Customer.store_id == store_id, Customer.phone == phone)
                    )
                )
                .scalars()
                .first()
            )
            if not customer:
                skipped += 1
                continue
            if customer.sales_id == sales_id:
                skipped += 1
                continue
            customer.sales_id = sales_id
            assigned += 1
    return assigned, skipped


async def seed_sales() -> None:
    async with async_session_maker() as db:
        store = await _resolve_store(db)
        if store is None:
            print(f"[seed_sales] store slug '{STORE_SLUG}' not found — skipping sales seed (no-op).")
            await engine.dispose()
            return

        name_to_id = await _upsert_salespeople(db, store.id)
        print(f"[seed_sales] salespeople: {len(name_to_id)} upserted.")

        assigned, skipped = await _assign_customers(db, store.id, name_to_id)
        print(
            f"[seed_sales] customer assignments: {assigned} assigned, "
            f"{skipped} skipped ({len(MEMBER_SALES)} in source)."
        )

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(seed_sales())
