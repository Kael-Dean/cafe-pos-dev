from decimal import Decimal

from fastapi.responses import PlainTextResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFound
from app.models.inventory import InventoryItem
from app.models.pre_orders import ShoppingListItem
from app.schemas.pre_orders import ShoppingListItemCreate, ShoppingListItemRead
from app.services.pre_orders import aggregate_pending_demand


def _suggested(demand: Decimal | None, stock_on_hand: Decimal) -> Decimal:
    """Net amount still to buy: demand from pending pre-orders minus what's on hand,
    floored at zero."""
    return max(Decimal("0"), (demand or Decimal("0")) - stock_on_hand)


async def list_shopping_list(
    db: AsyncSession, *, store_id: str
) -> list[ShoppingListItemRead]:
    rows = list((await db.execute(
        select(
            ShoppingListItem,
            InventoryItem.name,
            InventoryItem.unit,
            InventoryItem.stock_on_hand,
        )
        .join(InventoryItem, InventoryItem.id == ShoppingListItem.inventory_item_id)
        .where(ShoppingListItem.store_id == store_id)
        .order_by(ShoppingListItem.created_at.asc())
    )).all())

    demand = await aggregate_pending_demand(db, store_id=store_id)

    return [
        ShoppingListItemRead(
            id=sl.id,
            inventory_item_id=sl.inventory_item_id,
            inventory_item_name=name,
            unit=unit,
            quantity=sl.quantity,
            suggested_qty=_suggested(demand.get(sl.inventory_item_id), stock_on_hand),
            note=sl.note,
            added_by_id=sl.added_by_id,
            created_at=sl.created_at,
        )
        for sl, name, unit, stock_on_hand in rows
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
            return await _sl_to_read(db, existing, store_id=store_id), False

        sl = ShoppingListItem(
            store_id=store_id,
            inventory_item_id=payload.inventory_item_id,
            added_by_id=user_id,
            quantity=payload.quantity,
            note=payload.note,
        )
        db.add(sl)

    return await _sl_to_read(db, sl, store_id=store_id), True


async def update_shopping_list_item(
    db: AsyncSession,
    *,
    store_id: str,
    item_id: str,
    quantity: Decimal | None,
) -> ShoppingListItemRead:
    async with db.begin():
        sl = (await db.execute(
            select(ShoppingListItem).where(
                ShoppingListItem.id == item_id,
                ShoppingListItem.store_id == store_id,
            )
        )).scalar_one_or_none()
        if sl is None:
            raise NotFound("SHOPPING_LIST_ITEM_NOT_FOUND")
        sl.quantity = quantity

    return await _sl_to_read(db, sl, store_id=store_id)


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
        amount = item.quantity if item.quantity is not None else item.suggested_qty
        note = f"  ({item.note})" if item.note else ""
        lines.append(f"- {item.inventory_item_name}: {amount:g} {item.unit}{note}")
    lines.append("")
    return PlainTextResponse("\n".join(lines))


async def _sl_to_read(
    db: AsyncSession, sl: ShoppingListItem, *, store_id: str
) -> ShoppingListItemRead:
    inv_item = await db.get(InventoryItem, sl.inventory_item_id)
    demand = await aggregate_pending_demand(db, store_id=store_id)
    stock = inv_item.stock_on_hand if inv_item else Decimal("0")
    return ShoppingListItemRead(
        id=sl.id,
        inventory_item_id=sl.inventory_item_id,
        inventory_item_name=inv_item.name if inv_item else "Unknown",
        unit=inv_item.unit if inv_item else "",
        quantity=sl.quantity,
        suggested_qty=_suggested(demand.get(sl.inventory_item_id), stock),
        note=sl.note,
        added_by_id=sl.added_by_id,
        created_at=sl.created_at,
    )
