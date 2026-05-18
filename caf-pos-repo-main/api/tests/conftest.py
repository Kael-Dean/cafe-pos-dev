"""Pytest fixtures for the Cafe POS API.

Tests run against a real Postgres instance — enums and `Numeric(p, s)` semantics
do not survive a SQLite swap-in. Set `TEST_DATABASE_URL` to point at an empty DB
(e.g. `cafe_pos_test`); otherwise the fixture derives one from `DATABASE_URL` by
appending `_test` to the database name.

Per-test isolation: `TRUNCATE ... RESTART IDENTITY CASCADE` between tests rather
than nested-savepoint trickery — the service layer uses top-level
`async with db.begin()` blocks which would conflict with an outer transaction.

The `db` fixture is a single session used by service-layer tests AND by fixtures
to seed rows. The API client gets a NEW session per request (via the
`get_db` override), so nothing is shared between request handlers.
"""
import asyncio
import os
import secrets
import sys
from collections.abc import AsyncIterator
from decimal import Decimal

import pytest
import pytest_asyncio

# On Windows the default ProactorEventLoop + asyncpg SSL teardown leaks "Event loop is
# closed" errors when a test event loop is destroyed. Selector loop avoids the issue.
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

# Set required env vars BEFORE importing app modules so Settings validates.
os.environ.setdefault("JWT_SECRET", secrets.token_hex(32))
os.environ.setdefault(
    "DATABASE_URL", "postgresql+asyncpg://postgres:pos@localhost:5432/cafe_pos_test"
)
os.environ.setdefault("ENVIRONMENT", "test")

from app.core.ratelimit import limiter  # noqa: E402
from app.core.security import hash_pin  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.deps import get_db  # noqa: E402
from app.enums import Role  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models import Category, InventoryItem, ModifierGroup, Modifier, Product, Store, Tenant, User  # noqa: E402


def _resolve_test_url() -> str:
    explicit = os.environ.get("TEST_DATABASE_URL")
    if explicit:
        return explicit
    base = os.environ["DATABASE_URL"]
    if base.endswith("_test"):
        return base
    if "/" in base:
        head, _, tail = base.rpartition("/")
        return f"{head}/{tail.split('?')[0]}_test"
    return base + "_test"


TEST_DB_URL = _resolve_test_url()


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def _create_schema():
    """Apply schema once per session. Uses a throwaway engine that disposes immediately
    so we don't hold a connection across test event-loop boundaries."""
    engine = create_async_engine(TEST_DB_URL, future=True, poolclass=NullPool)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    await engine.dispose()
    yield


@pytest_asyncio.fixture(loop_scope="session")
async def test_engine(_create_schema):
    """Per-test engine with NullPool: every operation opens a fresh asyncpg connection
    on the *current* event loop, sidestepping pytest-asyncio's per-test loop changes."""
    engine = create_async_engine(TEST_DB_URL, future=True, poolclass=NullPool)
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture(loop_scope="session")
async def session_maker(test_engine):
    return async_sessionmaker(test_engine, expire_on_commit=False, class_=AsyncSession)


@pytest_asyncio.fixture(loop_scope="session")
async def db(test_engine, session_maker) -> AsyncIterator[AsyncSession]:
    async with session_maker() as session:
        yield session
    async with test_engine.begin() as conn:
        for table in reversed(Base.metadata.sorted_tables):
            await conn.execute(text(f'TRUNCATE TABLE "{table.name}" RESTART IDENTITY CASCADE'))
    try:
        limiter.reset()
    except Exception:
        pass


@pytest_asyncio.fixture(loop_scope="session")
async def app(db, session_maker):
    application = create_app()

    async def _override_db():
        async with session_maker() as session:
            yield session

    application.dependency_overrides[get_db] = _override_db
    return application


@pytest_asyncio.fixture(loop_scope="session")
async def client(app) -> AsyncIterator[AsyncClient]:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


# ---------- factories ----------


@pytest_asyncio.fixture(loop_scope="session")
async def tenant(db) -> Tenant:
    t = Tenant(name="Acme Cafe", slug=f"acme-{secrets.token_hex(3)}")
    db.add(t)
    await db.commit()
    return t


@pytest_asyncio.fixture(loop_scope="session")
async def store_a(db, tenant) -> Store:
    s = Store(tenant_id=tenant.id, name="Store A", slug="store-a", vat_enabled=False)
    db.add(s)
    await db.commit()
    return s


@pytest_asyncio.fixture(loop_scope="session")
async def store_b(db, tenant) -> Store:
    s = Store(tenant_id=tenant.id, name="Store B", slug="store-b", vat_enabled=False)
    db.add(s)
    await db.commit()
    return s


async def make_user(
    db: AsyncSession,
    *,
    tenant_id: str,
    store_id: str | None,
    name: str = "User",
    pin: str = "1234",
    role: Role = Role.BARISTA,
    is_active: bool = True,
) -> User:
    u = User(
        tenant_id=tenant_id,
        store_id=store_id,
        name=name,
        pin_hash=hash_pin(pin),
        role=role,
        is_active=is_active,
    )
    db.add(u)
    await db.commit()
    return u


@pytest_asyncio.fixture(loop_scope="session")
async def user_a(db, tenant, store_a) -> User:
    return await make_user(
        db, tenant_id=tenant.id, store_id=store_a.id, name="Alice", pin="1111", role=Role.BARISTA
    )


@pytest_asyncio.fixture(loop_scope="session")
async def manager_a(db, tenant, store_a) -> User:
    return await make_user(
        db, tenant_id=tenant.id, store_id=store_a.id, name="Mary", pin="2222", role=Role.MANAGER
    )


@pytest_asyncio.fixture(loop_scope="session")
async def user_b(db, tenant, store_b) -> User:
    return await make_user(
        db, tenant_id=tenant.id, store_id=store_b.id, name="Bob", pin="9999", role=Role.BARISTA
    )


async def make_item(
    db: AsyncSession,
    *,
    store_id: str,
    name: str = "Beans",
    unit: str = "g",
    cost: Decimal = Decimal("0.0030"),
    stock: Decimal = Decimal("100"),
    par: Decimal = Decimal("80"),
    is_active: bool = True,
) -> InventoryItem:
    item = InventoryItem(
        store_id=store_id,
        name=name,
        unit=unit,
        cost_per_unit=cost,
        stock_on_hand=stock,
        par_level=par,
        is_active=is_active,
    )
    db.add(item)
    await db.commit()
    return item


async def make_category(
    db: AsyncSession,
    *,
    store_id: str,
    name: str = "Drinks",
    sort_order: int = 0,
    is_active: bool = True,
) -> Category:
    cat = Category(store_id=store_id, name=name, sort_order=sort_order, is_active=is_active)
    db.add(cat)
    await db.commit()
    return cat


async def make_product(
    db: AsyncSession,
    *,
    store_id: str,
    name: str = "Latte",
    price: Decimal = Decimal("85.00"),
    category_id: str | None = None,
    is_active: bool = True,
) -> Product:
    product = Product(
        store_id=store_id,
        name=name,
        price=price,
        category_id=category_id,
        is_active=is_active,
    )
    db.add(product)
    await db.commit()
    return product


async def make_modifier_group(
    db: AsyncSession,
    *,
    store_id: str,
    name: str = "Milk Type",
    required: bool = False,
    modifiers: list[dict] | None = None,
) -> ModifierGroup:
    group = ModifierGroup(store_id=store_id, name=name, required=required)
    db.add(group)
    await db.flush()
    for m in modifiers or []:
        db.add(Modifier(group_id=group.id, **m))
    await db.commit()
    return group
