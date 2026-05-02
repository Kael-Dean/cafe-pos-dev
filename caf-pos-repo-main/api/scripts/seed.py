"""Idempotent seed for local dev / staging.

Run with: `uv run python scripts/seed.py`

Creates (or no-ops if present):
- 1 tenant: "Cafe Co" (slug: cafe-co)
- 1 store: "Sukhumvit 49" (slug: sukhumvit-49)
- 5 users: 1 owner, 1 manager, 3 baristas (PINs documented below)
- 22 inventory items with realistic units, costs, and par levels

Default PINs (per handoff §8):
- owner   1234
- manager 1234
- barista 1111 / 2222 / 3333
"""
import asyncio
import sys
from decimal import Decimal
from pathlib import Path

# Allow `python scripts/seed.py` from the api/ root.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_pin
from app.db.session import async_session_maker, engine
from app.enums import Role
from app.models import InventoryItem, Store, Tenant, User

TENANT_SLUG = "cafe-co"
STORE_SLUG = "sukhumvit-49"


SEED_USERS = [
    ("Tan",    Role.OWNER,   "1234"),
    ("Ploy",   Role.MANAGER, "1234"),
    ("Nat",    Role.BARISTA, "1111"),
    ("Mint",   Role.BARISTA, "2222"),
    ("Jay",    Role.BARISTA, "3333"),
]


SEED_INVENTORY: list[tuple[str, str, Decimal, Decimal, Decimal]] = [
    # (name, unit, cost_per_unit, stock_on_hand, par_level)
    ("Espresso Beans",       "g",   Decimal("0.0030"), Decimal("8000"),  Decimal("6000")),
    ("Decaf Beans",          "g",   Decimal("0.0040"), Decimal("2100"),  Decimal("4000")),
    ("Whole Milk",           "ml",  Decimal("0.0008"), Decimal("12000"), Decimal("15000")),
    ("Oat Milk",             "ml",  Decimal("0.0020"), Decimal("4000"),  Decimal("6000")),
    ("Almond Milk",          "ml",  Decimal("0.0022"), Decimal("3000"),  Decimal("4000")),
    ("Soy Milk",             "ml",  Decimal("0.0018"), Decimal("400"),   Decimal("3000")),
    ("Vanilla Syrup",        "ml",  Decimal("0.0035"), Decimal("1500"),  Decimal("1000")),
    ("Caramel Syrup",        "ml",  Decimal("0.0035"), Decimal("1200"),  Decimal("1000")),
    ("Hazelnut Syrup",       "ml",  Decimal("0.0040"), Decimal("700"),   Decimal("1000")),
    ("Chocolate Powder",     "g",   Decimal("0.0025"), Decimal("3000"),  Decimal("2500")),
    ("Matcha Powder",        "g",   Decimal("0.0090"), Decimal("400"),   Decimal("600")),
    ("Sugar (white)",        "g",   Decimal("0.0006"), Decimal("9000"),  Decimal("8000")),
    ("Brown Sugar",          "g",   Decimal("0.0009"), Decimal("3000"),  Decimal("3000")),
    ("Black Tea",            "g",   Decimal("0.0050"), Decimal("800"),   Decimal("800")),
    ("Earl Grey Tea",        "g",   Decimal("0.0055"), Decimal("550"),   Decimal("600")),
    ("Lemon",                "ea",  Decimal("3.0000"), Decimal("28"),    Decimal("30")),
    ("Ice Cubes",            "g",   Decimal("0.0001"), Decimal("20000"), Decimal("15000")),
    ("Croissant",            "ea",  Decimal("18.0000"),Decimal("12"),    Decimal("20")),
    ("Almond Croissant",     "ea",  Decimal("22.0000"),Decimal("4"),     Decimal("15")),
    ("Banana Bread",         "slice", Decimal("16.0000"), Decimal("8"),  Decimal("10")),
    ("Disposable Cup 12oz",  "ea",  Decimal("1.5000"), Decimal("400"),   Decimal("500")),
    ("Disposable Lid",       "ea",  Decimal("0.5000"), Decimal("400"),   Decimal("500")),
]


async def seed() -> None:
    async with async_session_maker() as session:
        tenant = await _ensure_tenant(session)
        store = await _ensure_store(session, tenant.id)
        await _ensure_users(session, tenant.id, store.id)
        await _ensure_inventory(session, store.id)
    await engine.dispose()
    print(f"Seed complete. Login at /api/v1/auth/login with store_slug='{STORE_SLUG}'.")


async def _ensure_tenant(db: AsyncSession) -> Tenant:
    async with db.begin():
        result = await db.execute(select(Tenant).where(Tenant.slug == TENANT_SLUG))
        existing = result.scalar_one_or_none()
        if existing:
            return existing
        tenant = Tenant(name="Cafe Co", slug=TENANT_SLUG)
        db.add(tenant)
    return tenant


async def _ensure_store(db: AsyncSession, tenant_id: str) -> Store:
    async with db.begin():
        result = await db.execute(
            select(Store).where(Store.tenant_id == tenant_id, Store.slug == STORE_SLUG)
        )
        existing = result.scalar_one_or_none()
        if existing:
            return existing
        store = Store(
            tenant_id=tenant_id,
            name="Sukhumvit 49",
            slug=STORE_SLUG,
            vat_enabled=False,
            vat_rate=Decimal("0.0700"),
        )
        db.add(store)
    return store


async def _ensure_users(db: AsyncSession, tenant_id: str, store_id: str) -> None:
    for name, role, pin in SEED_USERS:
        async with db.begin():
            result = await db.execute(
                select(User).where(User.tenant_id == tenant_id, User.name == name)
            )
            if result.scalar_one_or_none():
                continue
            db.add(
                User(
                    tenant_id=tenant_id,
                    store_id=store_id,
                    name=name,
                    pin_hash=hash_pin(pin),
                    role=role,
                    is_active=True,
                )
            )


async def _ensure_inventory(db: AsyncSession, store_id: str) -> None:
    for name, unit, cost, stock, par in SEED_INVENTORY:
        async with db.begin():
            result = await db.execute(
                select(InventoryItem).where(
                    InventoryItem.store_id == store_id, InventoryItem.name == name
                )
            )
            if result.scalar_one_or_none():
                continue
            db.add(
                InventoryItem(
                    store_id=store_id,
                    name=name,
                    unit=unit,
                    cost_per_unit=cost,
                    stock_on_hand=stock,
                    par_level=par,
                    is_active=True,
                )
            )


if __name__ == "__main__":
    asyncio.run(seed())
