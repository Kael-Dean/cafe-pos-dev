from fastapi.responses import PlainTextResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFound
from app.models.inventory import InventoryItem
from app.models.pre_orders import ShoppingListItem
from app.schemas.pre_orders import ShoppingListItemCreate, ShoppingListItemRead


async def list_shopping_list(
    db: AsyncSession, *, store_id: str
) -> list[ShoppingListItemRead]:
    rows = list((await db.execute(
        select(ShoppingListItem, InventoryItem.name, InventoryItem.unit)
        .join(InventoryItem, InventoryItem.id == ShoppingListItem.inventory_item_id)
        .where(ShoppingListItem.store_id == store_id)
        .order_by(ShoppingListItem.created_at.asc())
    )).all())
    return [
        ShoppingListItemRead(
            id=sl.id,
            inventory_item_id=sl.inventory_item_id,
            inventory_item_name=name,
            unit=unit,
            note=sl.note,
            added_by_id=sl.added_by_id,
            created_at=sl.created_at,
        )
        for sl, name, unit in rows
    ]


async def add_to_shopping_list(
    db: AsyncSession,
    *,
    store_id: str,
    user_id: str,
    payload: ShoppingListItemCreate,
) -> tuple[ShoppingListItemRead, bool]:
    async with db.begin():
        existing = (await db.execute(
            select(ShoppingListItem).where(
                ShoppingListItem.store_id == store_id,
                ShoppingListItem.inventory_item_id == payload.inventory_item_id,
            )
        )).scalar_one_or_none()

        if existing:
            return await _sl_to_read(db, existing), False

        sl = ShoppingListItem(
            store_id=store_id,
            inventory_item_id=payload.inventory_item_id,
            added_by_id=user_id,
            note=payload.note,
        )
        db.add(sl)

    return await _sl_to_read(db, sl), True


async def remove_from_shopping_list(
    db: AsyncSession, *, store_id: str, item_id: str
) -> None:
    async with db.begin():
        sl = (await db.execute(
            select(ShoppingListItem).where(
                ShoppingListItem.id == item_id,
                ShoppingListItem.store_id == store_id,
            )
        )).scalar_one_or_none()
        if sl is None:
            raise NotFound("SHOPPING_LIST_ITEM_NOT_FOUND")
        await db.delete(sl)


async def print_shopping_list(
    db: AsyncSession, *, store_id: str
) -> PlainTextResponse:
    items = await list_shopping_list(db, store_id=store_id)
    if not items:
        return PlainTextResponse("Shopping list is empty.\n")
    lines = ["SHOPPING LIST", "=" * 30, ""]
    for item in items:
        note = f"  ({item.note})" if item.note else ""
        lines.append(f"- {item.inventory_item_name} [{item.unit}]{note}")
    lines.append("")
    return PlainTextResponse("\n".join(lines))


async def _sl_to_read(db: AsyncSession, sl: ShoppingListItem) -> ShoppingListItemRead:
    inv_item = await db.get(InventoryItem, sl.inventory_item_id)
    return ShoppingListItemRead(
        id=sl.id,
        inventory_item_id=sl.inventory_item_id,
        inventory_item_name=inv_item.name if inv_item else "Unknown",
        unit=inv_item.unit if inv_item else "",
        note=sl.note,
        added_by_id=sl.added_by_id,
        created_at=sl.created_at,
    )
