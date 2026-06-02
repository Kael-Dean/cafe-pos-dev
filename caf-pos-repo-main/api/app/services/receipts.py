import base64
import binascii
import logging
from datetime import datetime
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Conflict, NotFound, Unprocessable
from app.enums import MovementType, ReceiptStatus
from app.models.identity import User
from app.models.inventory import InventoryItem, StockMovement
from app.models.receipts import StockLot, StockReceipt
from app.schemas.inventory import CreatedBy
from app.schemas.receipts import (
    StockLotCreate,
    StockLotRead,
    StockReceiptCreate,
    StockReceiptRead,
    StockReceiptsPage,
    StockReceiptSummary,
)

logger = logging.getLogger(__name__)

_DEFAULT_PAGE = 50
_MAX_PAGE = 200


async def create_receipt(
    db: AsyncSession,
    *,
    store_id: str,
    user_id: str,
    payload: StockReceiptCreate,
) -> StockReceiptRead:
    async with db.begin():
        receipt = StockReceipt(
            store_id=store_id,
            status=ReceiptStatus.DRAFT,
            supplier_name=payload.supplier_name,
            receipt_ref=payload.receipt_ref,
            note=payload.note,
            received_at=payload.received_at,
            created_by_id=user_id,
        )
        db.add(receipt)
    return await _receipt_to_read(db, receipt)


async def list_receipts(
    db: AsyncSession,
    *,
    store_id: str,
    status: ReceiptStatus | None = None,
    cursor: str | None = None,
    limit: int = _DEFAULT_PAGE,
) -> StockReceiptsPage:
    if limit <= 0 or limit > _MAX_PAGE:
        limit = _DEFAULT_PAGE

    lot_count_subq = (
        select(StockLot.receipt_id, func.count(StockLot.id).label("cnt"))
        .group_by(StockLot.receipt_id)
        .subquery()
    )

    stmt = (
        select(StockReceipt, func.coalesce(lot_count_subq.c.cnt, 0).label("lot_count"))
        .outerjoin(lot_count_subq, lot_count_subq.c.receipt_id == StockReceipt.id)
        .where(StockReceipt.store_id == store_id)
        .order_by(StockReceipt.created_at.desc(), StockReceipt.id.desc())
        .limit(limit + 1)
    )
    if status is not None:
        stmt = stmt.where(StockReceipt.status == status)
    if cursor:
        decoded = _decode_cursor(cursor)
        if decoded is not None:
            cur_at, cur_id = decoded
            stmt = stmt.where(
                (StockReceipt.created_at < cur_at)
                | ((StockReceipt.created_at == cur_at) & (StockReceipt.id < cur_id))
            )

    rows = list((await db.execute(stmt)).all())
    next_cursor: str | None = None
    if len(rows) > limit:
        last = rows[limit - 1][0]
        next_cursor = _encode_cursor(last.created_at, last.id)
        rows = rows[:limit]

    items = [
        StockReceiptSummary(
            id=r.id,
            status=r.status.value,
            supplier_name=r.supplier_name,
            receipt_ref=r.receipt_ref,
            received_at=r.received_at,
            lot_count=cnt,
            created_at=r.created_at,
        )
        for r, cnt in rows
    ]
    return StockReceiptsPage(items=items, next_cursor=next_cursor)


async def get_receipt(
    db: AsyncSession,
    *,
    store_id: str,
    receipt_id: str,
) -> StockReceiptRead:
    receipt = await _load_receipt(db, store_id=store_id, receipt_id=receipt_id)
    return await _receipt_to_read(db, receipt)


async def add_lot(
    db: AsyncSession,
    *,
    store_id: str,
    receipt_id: str,
    payload: StockLotCreate,
) -> StockReceiptRead:
    async with db.begin():
        receipt = await _load_receipt(db, store_id=store_id, receipt_id=receipt_id)
        _require_draft(receipt)

        item_result = await db.execute(
            select(InventoryItem).where(
                InventoryItem.id == payload.inventory_item_id,
                InventoryItem.store_id == store_id,
            )
        )
        item = item_result.scalar_one_or_none()
        if item is None:
            raise NotFound("Inventory item not found")
        if item.unit_size is None:
            raise Unprocessable("ITEM_MISSING_UNIT_SIZE")

        cost_per_unit = payload.unit_price / item.unit_size
        qty_received = payload.qty_packs * item.unit_size

        lot = StockLot(
            store_id=store_id,
            receipt_id=receipt.id,
            inventory_item_id=payload.inventory_item_id,
            qty_received=qty_received,
            qty_remaining=qty_received,
            cost_per_unit=cost_per_unit,
            expiry_date=payload.expiry_date,
        )
        db.add(lot)
    return await _receipt_to_read(db, receipt)


async def remove_lot(
    db: AsyncSession,
    *,
    store_id: str,
    receipt_id: str,
    lot_id: str,
) -> None:
    async with db.begin():
        receipt = await _load_receipt(db, store_id=store_id, receipt_id=receipt_id)
        _require_draft(receipt)

        result = await db.execute(
            select(StockLot).where(StockLot.id == lot_id, StockLot.receipt_id == receipt_id)
        )
        lot = result.scalar_one_or_none()
        if lot is None:
            raise NotFound("Lot not found")
        await db.delete(lot)


async def confirm_receipt(
    db: AsyncSession,
    *,
    store_id: str,
    user_id: str,
    receipt_id: str,
) -> StockReceiptRead:
    async with db.begin():
        receipt = await _load_receipt(db, store_id=store_id, receipt_id=receipt_id)
        _require_draft(receipt)

        lots = list((await db.execute(
            select(StockLot).where(StockLot.receipt_id == receipt_id)
        )).scalars())

        if not lots:
            raise Unprocessable("RECEIPT_HAS_NO_LOTS")

        receipt.status = ReceiptStatus.CONFIRMED

        latest_cost_by_item: dict[str, Decimal] = {}

        for lot in lots:
            item = await db.get(InventoryItem, lot.inventory_item_id)
            if item:
                item.stock_on_hand = item.stock_on_hand + lot.qty_received
                latest_cost_by_item[lot.inventory_item_id] = lot.cost_per_unit
                db.add(StockMovement(
                    store_id=store_id,
                    inventory_item_id=lot.inventory_item_id,
                    type=MovementType.RECEIVE,
                    quantity=lot.qty_received,
                    unit_cost=lot.cost_per_unit,
                    reason=f"Receipt {receipt.receipt_ref or receipt.id}",
                    created_by_id=user_id,
                ))

        for item_id, cost in latest_cost_by_item.items():
            item = await db.get(InventoryItem, item_id)
            if item:
                item.cost_per_unit = cost

    return await _receipt_to_read(db, receipt)


async def list_item_lots(
    db: AsyncSession,
    *,
    store_id: str,
    item_id: str,
    active_only: bool = True,
) -> list[StockLotRead]:
    stmt = (
        select(StockLot, InventoryItem.name, InventoryItem.unit_size)
        .join(InventoryItem, InventoryItem.id == StockLot.inventory_item_id)
        .where(StockLot.inventory_item_id == item_id, StockLot.store_id == store_id)
        .order_by(StockLot.created_at.asc())
    )
    if active_only:
        stmt = stmt.where(StockLot.qty_remaining > 0)

    rows = list((await db.execute(stmt)).all())
    return [
        StockLotRead(
            id=lot.id,
            inventory_item_id=lot.inventory_item_id,
            inventory_item_name=item_name,
            qty_packs=lot.qty_received / unit_size if unit_size else lot.qty_received,
            qty_received=lot.qty_received,
            qty_remaining=lot.qty_remaining,
            unit_price=lot.cost_per_unit * unit_size if unit_size else lot.cost_per_unit,
            cost_per_unit=lot.cost_per_unit,
            expiry_date=lot.expiry_date,
            created_at=lot.created_at,
        )
        for lot, item_name, unit_size in rows
    ]


# -- helpers ----------------------------------------------------------------


async def _load_receipt(
    db: AsyncSession, *, store_id: str, receipt_id: str
) -> StockReceipt:
    result = await db.execute(
        select(StockReceipt).where(
            StockReceipt.id == receipt_id,
            StockReceipt.store_id == store_id,
        )
    )
    receipt = result.scalar_one_or_none()
    if receipt is None:
        raise NotFound("Receipt not found")
    return receipt


def _require_draft(receipt: StockReceipt) -> None:
    if receipt.status != ReceiptStatus.DRAFT:
        raise Conflict("RECEIPT_ALREADY_CONFIRMED")


async def _receipt_to_read(db: AsyncSession, receipt: StockReceipt) -> StockReceiptRead:
    user = await db.get(User, receipt.created_by_id)

    rows = list((await db.execute(
        select(StockLot, InventoryItem.name, InventoryItem.unit_size)
        .join(InventoryItem, InventoryItem.id == StockLot.inventory_item_id)
        .where(StockLot.receipt_id == receipt.id)
        .order_by(StockLot.created_at)
    )).all())

    lots = [
        StockLotRead(
            id=lot.id,
            inventory_item_id=lot.inventory_item_id,
            inventory_item_name=item_name,
            qty_packs=lot.qty_received / unit_size if unit_size else lot.qty_received,
            qty_received=lot.qty_received,
            qty_remaining=lot.qty_remaining,
            unit_price=lot.cost_per_unit * unit_size if unit_size else lot.cost_per_unit,
            cost_per_unit=lot.cost_per_unit,
            expiry_date=lot.expiry_date,
            created_at=lot.created_at,
        )
        for lot, item_name, unit_size in rows
    ]

    return StockReceiptRead(
        id=receipt.id,
        status=receipt.status.value,
        supplier_name=receipt.supplier_name,
        receipt_ref=receipt.receipt_ref,
        note=receipt.note,
        received_at=receipt.received_at,
        created_by=CreatedBy(id=receipt.created_by_id, name=user.name if user else "Unknown"),
        created_at=receipt.created_at,
        lots=lots,
    )


def _encode_cursor(created_at: datetime, ident: str) -> str:
    raw = f"{created_at.isoformat()}|{ident}".encode()
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
