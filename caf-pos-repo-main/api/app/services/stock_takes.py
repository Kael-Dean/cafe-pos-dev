import logging
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Conflict, NotFound
from app.enums import MovementType, OrderStatus
from app.models import InventoryItem, StockMovement, User
from app.models.catalog import RecipeItem
from app.models.orders import Order, OrderItem
from app.schemas.stock_takes import (
    StockTakeAdjustResult,
    StockTakeEvent,
    StockTakeHistoryItem,
    StockTakePreview,
    StockTakePreviewItem,
    StockTakeSubmit,
)

logger = logging.getLogger(__name__)

_FALLBACK_DAYS = 30
_REVENUE_STATUSES = (
    OrderStatus.PAID,
    OrderStatus.IN_PROGRESS,
    OrderStatus.READY,
    OrderStatus.COMPLETED,
)


async def get_preview(db: AsyncSession, *, store_id: str) -> StockTakePreview:
    """Return a stock-take preview for the store.

    Aggregates ingredient consumption from revenue orders since the last
    stock-take adjustment, falling back to 30 days when no prior check exists.

    Args:
        db: Async database session.
        store_id: The store to preview.

    Returns:
        StockTakePreview with period bounds and per-item consumption data.
    """
    period_end = datetime.now(tz=UTC)
    period_start = await _last_check_at(db, store_id=store_id)

    consumption_rows = (
        await db.execute(
            select(
                RecipeItem.inventory_item_id,
                func.sum(OrderItem.quantity * RecipeItem.quantity).label("consumed"),
            )
            .select_from(Order)
            .join(OrderItem, OrderItem.order_id == Order.id)
            .join(RecipeItem, RecipeItem.product_id == OrderItem.product_id)
            .where(
                Order.store_id == store_id,
                Order.status.in_(_REVENUE_STATUSES),
                Order.created_at >= period_start,
                Order.created_at <= period_end,
                OrderItem.product_id.is_not(None),
            )
            .group_by(RecipeItem.inventory_item_id)
        )
    ).all()

    if not consumption_rows:
        return StockTakePreview(period_start=period_start, period_end=period_end, items=[])

    item_ids = [r.inventory_item_id for r in consumption_rows]
    items_by_id = {
        item.id: item
        for item in (
            await db.execute(
                select(InventoryItem).where(
                    InventoryItem.id.in_(item_ids),
                    InventoryItem.store_id == store_id,
                )
            )
        ).scalars()
    }

    preview_items = [
        StockTakePreviewItem(
            inventory_item_id=r.inventory_item_id,
            name=items_by_id[r.inventory_item_id].name,
            unit=items_by_id[r.inventory_item_id].unit,
            consumed_in_period=r.consumed,
            system_quantity=items_by_id[r.inventory_item_id].stock_on_hand,
        )
        for r in consumption_rows
        if r.inventory_item_id in items_by_id
    ]

    return StockTakePreview(period_start=period_start, period_end=period_end, items=preview_items)


async def submit_stock_take(
    db: AsyncSession,
    *,
    store_id: str,
    user_id: str,
    payload: StockTakeSubmit,
) -> list[StockTakeAdjustResult]:
    """Apply stock-take adjustments and create tagged ADJUST movements.

    Skips items where actual quantity matches system quantity. Raises
    NotFound when an item does not belong to the store, and Conflict when
    an item is inactive.

    Args:
        db: Async database session.
        store_id: The store performing the stock-take.
        user_id: The user submitting the stock-take.
        payload: Submitted items and optional notes.

    Returns:
        List of StockTakeAdjustResult for every item that had a non-zero variance.
    """
    results: list[StockTakeAdjustResult] = []

    async with db.begin():
        for entry in payload.items:
            item_result = await db.execute(
                select(InventoryItem).where(
                    InventoryItem.id == entry.inventory_item_id,
                    InventoryItem.store_id == store_id,
                )
            )
            item = item_result.scalar_one_or_none()
            if not item:
                raise NotFound(f"Inventory item {entry.inventory_item_id} not found")
            if not item.is_active:
                raise Conflict(f"Inventory item '{item.name}' is not active")

            delta = entry.actual_quantity - item.stock_on_hand
            if delta == 0:
                continue

            system_qty = item.stock_on_hand
            sign = "+" if delta > 0 else ""
            reason = f"STOCK_TAKE|{entry.actual_quantity}|{sign}{delta}|{payload.notes or ''}"

            item.stock_on_hand = entry.actual_quantity
            db.add(
                StockMovement(
                    store_id=store_id,
                    inventory_item_id=item.id,
                    type=MovementType.ADJUST,
                    quantity=abs(delta),
                    reason=reason,
                    created_by_id=user_id,
                )
            )
            results.append(
                StockTakeAdjustResult(
                    inventory_item_id=item.id,
                    name=item.name,
                    unit=item.unit,
                    system_quantity=system_qty,
                    actual_quantity=entry.actual_quantity,
                    variance=delta,
                )
            )

    return results


async def get_history(db: AsyncSession, *, store_id: str) -> list[StockTakeEvent]:
    """Return all stock-take events for the store, grouped by submission.

    Each event groups all ADJUST movements with a ``STOCK_TAKE|…`` reason
    that share the same ``(created_at, created_by_id)`` — PostgreSQL's
    ``now()`` freezes at transaction start, so every movement within a
    single ``submit_stock_take`` call has an identical timestamp.

    Args:
        db: Async database session.
        store_id: The store to query.

    Returns:
        List of StockTakeEvent ordered newest-first.
    """
    rows = (
        await db.execute(
            select(
                StockMovement,
                User.name.label("user_name"),
                InventoryItem.name.label("item_name"),
                InventoryItem.unit.label("item_unit"),
            )
            .join(User, User.id == StockMovement.created_by_id)
            .join(InventoryItem, InventoryItem.id == StockMovement.inventory_item_id)
            .where(
                StockMovement.store_id == store_id,
                StockMovement.type == MovementType.ADJUST,
                StockMovement.reason.like("STOCK_TAKE|%"),
            )
            .order_by(StockMovement.created_at.desc())
        )
    ).all()

    groups: dict[tuple, list] = defaultdict(list)
    group_meta: dict[tuple, tuple] = {}

    for movement, user_name, item_name, item_unit in rows:
        key = (movement.created_at, movement.created_by_id)
        groups[key].append((movement, item_name, item_unit))
        group_meta[key] = (movement.created_at, user_name)

    events: list[StockTakeEvent] = []
    for key in sorted(groups.keys(), key=lambda k: k[0], reverse=True):
        conducted_at, conducted_by = group_meta[key]
        items = [
            _parse_history_item(m, item_name, item_unit)
            for m, item_name, item_unit in groups[key]
        ]
        events.append(
            StockTakeEvent(
                conducted_at=conducted_at,
                conducted_by=conducted_by,
                item_count=len(items),
                items=items,
            )
        )

    return events


def _parse_history_item(
    movement: StockMovement,
    item_name: str,
    item_unit: str,
) -> StockTakeHistoryItem:
    """Parse a tagged ADJUST movement into a StockTakeHistoryItem.

    Reason format: ``STOCK_TAKE|<actual>|<signed_delta>|<notes>``

    Args:
        movement: The StockMovement row.
        item_name: Inventory item display name.
        item_unit: Inventory item unit string.

    Returns:
        StockTakeHistoryItem with reconstructed quantities.
    """
    parts = (movement.reason or "").split("|", 3)
    actual = Decimal(parts[1]) if len(parts) > 1 else Decimal("0")
    delta = Decimal(parts[2]) if len(parts) > 2 else Decimal("0")
    system = actual - delta
    return StockTakeHistoryItem(
        name=item_name,
        unit=item_unit,
        system_quantity=system,
        actual_quantity=actual,
        variance=delta,
    )


async def _last_check_at(db: AsyncSession, *, store_id: str) -> datetime:
    """Return the timestamp of the most recent stock-take adjustment for the store.

    Falls back to 30 days ago when no prior stock-take exists.

    Args:
        db: Async database session.
        store_id: The store to query.

    Returns:
        Aware UTC datetime of the last stock-take, or 30 days ago.
    """
    result = await db.execute(
        select(StockMovement.created_at)
        .where(
            StockMovement.store_id == store_id,
            StockMovement.type == MovementType.ADJUST,
            StockMovement.reason.like("STOCK_TAKE|%"),
        )
        .order_by(StockMovement.created_at.desc())
        .limit(1)
    )
    last = result.scalar_one_or_none()
    if last is None:
        return datetime.now(tz=UTC) - timedelta(days=_FALLBACK_DAYS)
    return last
