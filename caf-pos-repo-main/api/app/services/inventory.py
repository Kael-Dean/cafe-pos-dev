import base64
import binascii
import logging
from datetime import datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Conflict, NotFound, Unprocessable
from app.enums import MovementType, WastageReason
from app.models import InventoryItem, StockMovement, User
from app.schemas.inventory import (
    AdjustRequest,
    CreatedBy,
    InventoryItemCreate,
    InventoryItemUpdate,
    MovementsPage,
    ReceiveStockRequest,
    StockMovementRead,
    WasteRequest,
)

logger = logging.getLogger(__name__)

_RECEIVE_PREFIX = "RECEIVE"
_DEFAULT_PAGE = 50
_MAX_PAGE = 200


async def create_item(
    db: AsyncSession,
    *,
    store_id: str,
    payload: InventoryItemCreate,
) -> InventoryItem:
    async with db.begin():
        existing = await db.execute(
            select(InventoryItem).where(
                InventoryItem.store_id == store_id,
                InventoryItem.name == payload.name,
            )
        )
        if existing.scalar_one_or_none():
            raise Conflict("An inventory item with this name already exists")
        item = InventoryItem(
            store_id=store_id,
            name=payload.name,
            unit=payload.unit,
            par_level=payload.par_level,
            cost_per_unit=payload.cost_per_unit,
            is_active=payload.is_active,
            expiry_date=payload.expiry_date,
        )
        db.add(item)
    return item


async def list_items(
    db: AsyncSession,
    *,
    store_id: str,
    search: str | None = None,
    is_active: bool | None = True,
) -> list[InventoryItem]:
    stmt = select(InventoryItem).where(InventoryItem.store_id == store_id).order_by(InventoryItem.name)
    if is_active is not None:
        stmt = stmt.where(InventoryItem.is_active.is_(is_active))
    if search:
        stmt = stmt.where(InventoryItem.name.ilike(f"%{search}%"))
    result = await db.execute(stmt)
    return list(result.scalars())


async def get_item(db: AsyncSession, *, store_id: str, item_id: str) -> InventoryItem:
    item = await _load_item(db, store_id=store_id, item_id=item_id)
    return item


async def update_item(
    db: AsyncSession,
    *,
    store_id: str,
    item_id: str,
    payload: InventoryItemUpdate,
) -> InventoryItem:
    async with db.begin():
        item = await _load_item(db, store_id=store_id, item_id=item_id)
        if payload.par_level is not None:
            item.par_level = payload.par_level
        if payload.cost_per_unit is not None:
            item.cost_per_unit = payload.cost_per_unit
        if payload.expiry_date is not None:
            item.expiry_date = payload.expiry_date
    return item


async def delete_item(
    db: AsyncSession,
    *,
    store_id: str,
    item_id: str,
) -> None:
    async with db.begin():
        item = await _load_item(db, store_id=store_id, item_id=item_id)
        item.is_active = False


async def receive_stock(
    db: AsyncSession,
    *,
    store_id: str,
    user_id: str,
    req: ReceiveStockRequest,
) -> InventoryItem:
    async with db.begin():
        item = await _load_item(db, store_id=store_id, item_id=req.item_id)
        _require_active(item)
        item.stock_on_hand = item.stock_on_hand + req.qty
        item.cost_per_unit = req.cost_per_unit
        db.add(
            StockMovement(
                store_id=store_id,
                inventory_item_id=item.id,
                type=MovementType.RECEIVE,
                quantity=req.qty,
                reason=_encode_receive_reason(req.supplier, req.note),
                created_by_id=user_id,
            )
        )
    return item


async def record_waste(
    db: AsyncSession,
    *,
    store_id: str,
    user_id: str,
    req: WasteRequest,
) -> InventoryItem:
    async with db.begin():
        item = await _load_item(db, store_id=store_id, item_id=req.item_id)
        _require_active(item)
        new_soh = item.stock_on_hand - req.qty
        if new_soh < 0:
            logger.warning(
                "inventory.waste.negative_stock",
                extra={
                    "item_id": item.id,
                    "store_id": store_id,
                    "previous_stock": float(item.stock_on_hand),
                    "qty": float(req.qty),
                    "new_stock": float(new_soh),
                    "reason": req.reason.value,
                },
            )
        item.stock_on_hand = new_soh
        db.add(
            StockMovement(
                store_id=store_id,
                inventory_item_id=item.id,
                type=MovementType.WASTE,
                quantity=req.qty,
                reason=_encode_waste_reason(req.reason, req.note),
                created_by_id=user_id,
            )
        )
    return item


async def adjust_stock(
    db: AsyncSession,
    *,
    store_id: str,
    user_id: str,
    req: AdjustRequest,
) -> InventoryItem:
    if req.delta == 0:
        raise Unprocessable("delta must be non-zero")
    async with db.begin():
        item = await _load_item(db, store_id=store_id, item_id=req.item_id)
        _require_active(item)
        item.stock_on_hand = item.stock_on_hand + req.delta
        if item.stock_on_hand < 0:
            logger.warning(
                "inventory.adjust.negative_stock",
                extra={
                    "item_id": item.id,
                    "store_id": store_id,
                    "delta": float(req.delta),
                    "new_stock": float(item.stock_on_hand),
                },
            )
        db.add(
            StockMovement(
                store_id=store_id,
                inventory_item_id=item.id,
                type=MovementType.ADJUST,
                quantity=abs(req.delta),
                reason=_encode_adjust_reason(req.delta, req.reason),
                created_by_id=user_id,
            )
        )
    return item


async def list_movements(
    db: AsyncSession,
    *,
    store_id: str,
    item_id: str | None = None,
    cursor: str | None = None,
    limit: int = _DEFAULT_PAGE,
) -> MovementsPage:
    if limit <= 0 or limit > _MAX_PAGE:
        limit = _DEFAULT_PAGE

    stmt = (
        select(StockMovement, User.name)
        .join(User, User.id == StockMovement.created_by_id)
        .where(StockMovement.store_id == store_id)
        .order_by(StockMovement.created_at.desc(), StockMovement.id.desc())
        .limit(limit + 1)
    )
    if item_id:
        stmt = stmt.where(StockMovement.inventory_item_id == item_id)
    if cursor:
        decoded = _decode_cursor(cursor)
        if decoded is not None:
            cur_at, cur_id = decoded
            stmt = stmt.where(
                (StockMovement.created_at < cur_at)
                | ((StockMovement.created_at == cur_at) & (StockMovement.id < cur_id))
            )

    result = await db.execute(stmt)
    rows = result.all()
    next_cursor: str | None = None
    if len(rows) > limit:
        last = rows[limit - 1][0]
        next_cursor = _encode_cursor(last.created_at, last.id)
        rows = rows[:limit]

    items = [_movement_to_read(m, created_by_name=name) for (m, name) in rows]
    return MovementsPage(items=items, next_cursor=next_cursor)


async def low_stock(db: AsyncSession, *, store_id: str) -> list[InventoryItem]:
    result = await db.execute(
        select(InventoryItem)
        .where(
            InventoryItem.store_id == store_id,
            InventoryItem.is_active.is_(True),
            InventoryItem.par_level > 0,
            InventoryItem.stock_on_hand < InventoryItem.par_level,
        )
        .order_by(InventoryItem.name)
    )
    return list(result.scalars())


# -- helpers ----------------------------------------------------------------


async def _load_item(db: AsyncSession, *, store_id: str, item_id: str) -> InventoryItem:
    result = await db.execute(
        select(InventoryItem).where(InventoryItem.id == item_id, InventoryItem.store_id == store_id)
    )
    item = result.scalar_one_or_none()
    if not item:
        raise NotFound("Inventory item not found")
    return item


def _require_active(item: InventoryItem) -> None:
    if not item.is_active:
        raise Conflict("Item is not active")


def _encode_waste_reason(code: WastageReason, note: str | None) -> str:
    return f"{code.value}|{note or ''}"


def _encode_receive_reason(supplier: str | None, note: str | None) -> str:
    return f"{_RECEIVE_PREFIX}|supplier={supplier or ''};note={note or ''}"


def _encode_adjust_reason(delta: Decimal, reason: str) -> str:
    sign = "+" if delta >= 0 else "-"
    return f"ADJUST{sign}|{reason}"


def _decode_movement_reason(
    movement_type: MovementType, raw: str | None
) -> tuple[WastageReason | None, str | None, str | None, str | None]:
    """Returns (reason_code, note, supplier, raw)."""
    if not raw:
        return (None, None, None, None)
    if movement_type == MovementType.WASTE:
        if "|" in raw:
            head, _, tail = raw.partition("|")
            try:
                return (WastageReason(head), tail or None, None, raw)
            except ValueError:
                return (None, raw, None, raw)
        return (None, raw, None, raw)
    if movement_type == MovementType.RECEIVE:
        # f"RECEIVE|supplier=X;note=Y"
        _, _, tail = raw.partition("|")
        supplier: str | None = None
        note: str | None = None
        for part in tail.split(";"):
            if part.startswith("supplier="):
                supplier = part[len("supplier="):] or None
            elif part.startswith("note="):
                note = part[len("note="):] or None
        return (None, note, supplier, raw)
    return (None, raw, None, raw)


def _movement_to_read(movement: StockMovement, *, created_by_name: str) -> StockMovementRead:
    code, note, supplier, raw = _decode_movement_reason(movement.type, movement.reason)
    return StockMovementRead(
        id=movement.id,
        type=movement.type,
        inventory_item_id=movement.inventory_item_id,
        quantity=movement.quantity,
        reason_code=code,
        note=note,
        supplier=supplier,
        raw_reason=raw,
        ref_order_id=movement.ref_order_id,
        created_by=CreatedBy(id=movement.created_by_id, name=created_by_name),
        created_at=movement.created_at,
    )


def _encode_cursor(created_at: datetime, ident: str) -> str:
    raw = f"{created_at.isoformat()}|{ident}".encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _decode_cursor(cursor: str) -> tuple[datetime, str] | None:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        decoded = base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8")
    except (binascii.Error, UnicodeDecodeError):
        return None
    if "|" not in decoded:
        return None
    iso, _, ident = decoded.partition("|")
    try:
        return (datetime.fromisoformat(iso), ident)
    except ValueError:
        return None


