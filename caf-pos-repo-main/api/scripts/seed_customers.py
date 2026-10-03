"""Idempotent seed for member customers (staff/employee name list).

Run locally with:  `uv run python scripts/seed_customers.py`
On Railway it is wired into `preDeployCommand` (see railway.toml) and runs on
every deploy — idempotent, so it is a no-op once the members exist.

Member data (name + mock phone) is embedded in `scripts/_members_seed_data.py`,
extracted from `resources/รายชื่อเจ้าหน้าที่และลูกจ้าง-เบอร์จำลอง.xlsx`. It is
embedded (not read from the xlsx at runtime) so the seed needs neither the
source spreadsheet nor openpyxl in the deployed image.

Target store is resolved by slug from the MEMBER_SEED_STORE_SLUG env var
(default "sukhumvit-49", the store seed.py creates). If the store does not
exist the script logs a warning and exits 0 — it must never block a deploy.

Idempotent: skips any (store_id, phone) already present, matching the
`uq_customers_store_phone` constraint.

Steps (all idempotent):
  1. Seed customers (one per MEMBERS entry).
  2. Ensure a MembershipProgram exists for the store.
  3. Create a MembershipAccount for each customer that doesn't have one.
"""
import asyncio
import os
import sys
from decimal import Decimal
from pathlib import Path

# Allow `python scripts/seed_customers.py` from the api/ root.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import async_session_maker, engine
from app.enums import EarnMode, RewardScope, RewardType
from app.models import Customer, Store
from app.models.membership import MembershipAccount, MembershipProgram
from scripts._members_seed_data import MEMBERS

STORE_SLUG = os.getenv("MEMBER_SEED_STORE_SLUG", "sukhumvit-49")

_HONORIFICS = ("นางสาว", "นาง", "นาย")  # longest first — order matters


def _strip_honorific(name: str) -> str:
    for h in _HONORIFICS:
        if name.startswith(h):
            return name[len(h):].strip()
    return name


async def _resolve_store(db: AsyncSession) -> Store | None:
    async with db.begin():
        result = await db.execute(select(Store).where(Store.slug == STORE_SLUG))
        return result.scalars().first()


async def _seed_customers(db: AsyncSession, store_id: str) -> tuple[int, int]:
    inserted = skipped = 0
    for name, phone in MEMBERS:
        async with db.begin():
            exists = await db.execute(
                select(Customer.id).where(
                    Customer.store_id == store_id, Customer.phone == phone
                )
            )
            if exists.scalar_one_or_none():
                skipped += 1
                continue
            db.add(Customer(store_id=store_id, name=_strip_honorific(name), phone=phone, is_active=True))
            inserted += 1
    return inserted, skipped


async def _ensure_membership_program(db: AsyncSession, store_id: str) -> None:
    async with db.begin():
        exists = await db.execute(
            select(MembershipProgram.id).where(MembershipProgram.store_id == store_id)
        )
        if exists.scalar_one_or_none():
            print("[seed_customers] membership program already exists — skipping.")
            return
        db.add(
            MembershipProgram(
                store_id=store_id,
                is_active=True,
                earn_mode=EarnMode.PER_BAHT,
                baht_per_point=Decimal("20.00"),  # 1 point per 20 baht
                points_to_redeem=100,
                reward_type=RewardType.DISCOUNT_FIXED,
                reward_value=Decimal("20.00"),  # 100 pts = 20 baht discount
                reward_scope=RewardScope.ALL,
                tier_bronze_threshold=100,
                tier_silver_threshold=500,
                tier_gold_threshold=1000,
            )
        )
    print("[seed_customers] membership program created.")


async def _seed_membership_accounts(db: AsyncSession, store_id: str) -> tuple[int, int]:
    inserted = skipped = 0
    async with db.begin():
        customers = (
            await db.execute(
                select(Customer.id).where(
                    Customer.store_id == store_id, Customer.is_active.is_(True)
                )
            )
        ).scalars().all()

    for customer_id in customers:
        async with db.begin():
            exists = await db.execute(
                select(MembershipAccount.id).where(
                    MembershipAccount.customer_id == customer_id
                )
            )
            if exists.scalar_one_or_none():
                skipped += 1
                continue
            db.add(MembershipAccount(customer_id=customer_id, store_id=store_id))
            inserted += 1
    return inserted, skipped


async def seed_customers() -> None:
    async with async_session_maker() as db:
        store = await _resolve_store(db)
        if store is None:
            print(
                f"[seed_customers] store slug '{STORE_SLUG}' not found — "
                "skipping member seed (no-op)."
            )
            await engine.dispose()
            return

        c_inserted, c_skipped = await _seed_customers(db, store.id)
        print(
            f"[seed_customers] customers: {c_inserted} inserted, "
            f"{c_skipped} skipped ({len(MEMBERS)} in source)."
        )

        await _ensure_membership_program(db, store.id)

        a_inserted, a_skipped = await _seed_membership_accounts(db, store.id)
        print(
            f"[seed_customers] membership accounts: {a_inserted} inserted, "
            f"{a_skipped} skipped."
        )

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(seed_customers())
