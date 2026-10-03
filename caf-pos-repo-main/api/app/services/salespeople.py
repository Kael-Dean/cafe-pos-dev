from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Conflict, NotFound
from app.models.sales import Salesperson
from app.schemas.salespeople import SalespersonCreate, SalespersonRead, SalespersonUpdate


async def list_salespeople(db: AsyncSession, *, store_id: str) -> list[SalespersonRead]:
    rows = (
        (
            await db.execute(
                select(Salesperson)
                .where(Salesperson.store_id == store_id, Salesperson.is_active.is_(True))
                .order_by(Salesperson.name)
            )
        )
        .scalars()
        .all()
    )
    return [SalespersonRead.model_validate(r) for r in rows]


async def get_salesperson(db: AsyncSession, *, store_id: str, sales_id: str) -> Salesperson:
    sp = (
        (
            await db.execute(
                select(Salesperson).where(
                    Salesperson.id == sales_id,
                    Salesperson.store_id == store_id,
                    Salesperson.is_active.is_(True),
                )
            )
        )
        .scalars()
        .first()
    )
    if not sp:
        raise NotFound("Salesperson not found")
    return sp


async def _load_salesperson(db: AsyncSession, *, store_id: str, sales_id: str) -> Salesperson:
    """Load a salesperson by id within the store, regardless of active state."""
    sp = (
        (
            await db.execute(
                select(Salesperson).where(
                    Salesperson.id == sales_id,
                    Salesperson.store_id == store_id,
                )
            )
        )
        .scalars()
        .first()
    )
    if not sp:
        raise NotFound("Salesperson not found")
    return sp


async def _name_taken(db: AsyncSession, *, store_id: str, name: str, exclude_id: str | None = None) -> bool:
    stmt = select(Salesperson.id).where(Salesperson.store_id == store_id, Salesperson.name == name)
    if exclude_id is not None:
        stmt = stmt.where(Salesperson.id != exclude_id)
    return (await db.execute(stmt.limit(1))).scalar_one_or_none() is not None


async def create_salesperson(db: AsyncSession, *, store_id: str, payload: SalespersonCreate) -> Salesperson:
    async with db.begin():
        if await _name_taken(db, store_id=store_id, name=payload.name):
            raise Conflict("A salesperson with this name already exists")
        sp = Salesperson(store_id=store_id, name=payload.name)
        db.add(sp)
    return sp


async def update_salesperson(
    db: AsyncSession, *, store_id: str, sales_id: str, payload: SalespersonUpdate
) -> Salesperson:
    async with db.begin():
        sp = await _load_salesperson(db, store_id=store_id, sales_id=sales_id)
        if payload.name is not None:
            if await _name_taken(db, store_id=store_id, name=payload.name, exclude_id=sp.id):
                raise Conflict("A salesperson with this name already exists")
            sp.name = payload.name
        if payload.is_active is not None:
            sp.is_active = payload.is_active
    return sp


async def delete_salesperson(db: AsyncSession, *, store_id: str, sales_id: str) -> None:
    """Soft-delete a salesperson; assigned customers keep their (now-inactive) link."""
    async with db.begin():
        sp = await _load_salesperson(db, store_id=store_id, sales_id=sales_id)
        sp.is_active = False
