# Stock Take Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manual stock-take feature that shows ingredient consumption over a period, accepts physical counts, and reconciles variances via tagged ADJUST movements.

**Architecture:** New `services/stock_takes.py` + `schemas/stock_takes.py` + `api/v1/stock_takes.py`. No new DB tables — history lives in `StockMovement` rows tagged with `STOCK_TAKE|` prefix. Period start is auto-derived from the most recent tagged movement (fallback: 30 days ago).

**Tech Stack:** FastAPI, SQLAlchemy 2.x async, PostgreSQL, Pydantic v2, pytest-asyncio

---

## File Structure

| Action | Path | Responsibility |
|---|---|---|
| Create | `api/app/schemas/stock_takes.py` | Pydantic request/response models |
| Create | `api/app/services/stock_takes.py` | preview, submit, history business logic |
| Create | `api/app/api/v1/stock_takes.py` | FastAPI router — 3 endpoints |
| Modify | `api/app/api/v1/router.py` | Register new router |
| Modify | `api/CLAUDE.md` | Document new module |
| Create | `api/tests/test_stock_takes_service.py` | Service-layer tests |
| Create | `api/tests/test_stock_takes_api.py` | API-layer tests |

---

## Task 1: Schemas

**Files:**
- Create: `api/app/schemas/stock_takes.py`

- [ ] **Step 1: Create the schema file**

```python
# api/app/schemas/stock_takes.py
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class StockTakePreviewItem(BaseModel):
    inventory_item_id: str
    name: str
    unit: str
    consumed_in_period: Decimal
    system_quantity: Decimal


class StockTakePreview(BaseModel):
    period_start: datetime
    period_end: datetime
    items: list[StockTakePreviewItem]


class StockTakeSubmitItem(BaseModel):
    inventory_item_id: str
    actual_quantity: Decimal = Field(ge=0)


class StockTakeSubmit(BaseModel):
    items: list[StockTakeSubmitItem]
    notes: str | None = Field(None, max_length=500)


class StockTakeAdjustResult(BaseModel):
    inventory_item_id: str
    name: str
    unit: str
    system_quantity: Decimal
    actual_quantity: Decimal
    variance: Decimal


class StockTakeHistoryItem(BaseModel):
    name: str
    unit: str
    system_quantity: Decimal
    actual_quantity: Decimal
    variance: Decimal


class StockTakeEvent(BaseModel):
    conducted_at: datetime
    conducted_by: str
    item_count: int
    items: list[StockTakeHistoryItem]
```

- [ ] **Step 2: Commit**

```bash
git add api/app/schemas/stock_takes.py
git commit -m "feat: add stock take Pydantic schemas"
```

---

## Task 2: Service — preview

**Files:**
- Create: `api/app/services/stock_takes.py`
- Modify: `api/tests/factories.py` (add `make_recipe_item`)
- Create: `api/tests/test_stock_takes_service.py`

- [ ] **Step 1: Add `make_recipe_item` to factories**

Open `api/tests/factories.py` and add this import and function:

```python
# add to existing imports at top of file
from decimal import Decimal

from app.models.catalog import RecipeItem
```

```python
# add after make_order_item
async def make_recipe_item(
    db: AsyncSession,
    *,
    product_id: str,
    inventory_item_id: str,
    quantity: Decimal = Decimal("1.000"),
) -> RecipeItem:
    recipe_item = RecipeItem(
        product_id=product_id,
        inventory_item_id=inventory_item_id,
        quantity=quantity,
    )
    db.add(recipe_item)
    await db.commit()
    return recipe_item
```

- [ ] **Step 2: Write the failing preview tests**

Create `api/tests/test_stock_takes_service.py`:

```python
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from app.enums import OrderStatus
from app.services import stock_takes as svc
from tests.factories import (
    make_category,
    make_item,
    make_order_direct,
    make_order_item,
    make_product,
    make_recipe_item,
    make_user,
)


@pytest.mark.asyncio
async def test_preview_falls_back_to_30_days_when_no_prior_check(db, store_a, user_a):
    result = await svc.get_preview(db, store_id=store_a.id)
    expected_start = datetime.now(tz=timezone.utc) - timedelta(days=30)
    diff = abs((result.period_start - expected_start).total_seconds())
    assert diff < 5
    assert result.items == []


@pytest.mark.asyncio
async def test_preview_aggregates_consumption_from_orders(db, store_a, user_a):
    milk = await make_item(db, store_id=store_a.id, name="Milk", unit="L", stock=Decimal("5.000"))
    latte = await make_product(db, store_id=store_a.id, name="Latte")
    await make_recipe_item(db, product_id=latte.id, inventory_item_id=milk.id, quantity=Decimal("0.200"))

    order = await make_order_direct(db, store_id=store_a.id, created_by_id=user_a.id, status=OrderStatus.PAID)
    await make_order_item(db, order_id=order.id, product_id=latte.id, product_name="Latte", quantity=3)

    result = await svc.get_preview(db, store_id=store_a.id)

    assert len(result.items) == 1
    item = result.items[0]
    assert item.inventory_item_id == milk.id
    assert item.name == "Milk"
    assert item.unit == "L"
    assert item.consumed_in_period == Decimal("0.600")
    assert item.system_quantity == Decimal("5.000")


@pytest.mark.asyncio
async def test_preview_excludes_void_orders(db, store_a, user_a):
    milk = await make_item(db, store_id=store_a.id, name="Milk", unit="L", stock=Decimal("5.000"))
    latte = await make_product(db, store_id=store_a.id, name="Latte")
    await make_recipe_item(db, product_id=latte.id, inventory_item_id=milk.id, quantity=Decimal("0.200"))

    void_order = await make_order_direct(db, store_id=store_a.id, created_by_id=user_a.id, status=OrderStatus.VOID)
    await make_order_item(db, order_id=void_order.id, product_id=latte.id, product_name="Latte", quantity=5)

    result = await svc.get_preview(db, store_id=store_a.id)
    assert result.items == []


@pytest.mark.asyncio
async def test_preview_excludes_products_with_no_recipe(db, store_a, user_a):
    latte = await make_product(db, store_id=store_a.id, name="Latte")
    order = await make_order_direct(db, store_id=store_a.id, created_by_id=user_a.id, status=OrderStatus.PAID)
    await make_order_item(db, order_id=order.id, product_id=latte.id, product_name="Latte", quantity=2)

    result = await svc.get_preview(db, store_id=store_a.id)
    assert result.items == []
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd api && uv run pytest tests/test_stock_takes_service.py -v
```

Expected: `ImportError` or `ModuleNotFoundError` — service does not exist yet.

- [ ] **Step 4: Create the service file with preview logic**

Create `api/app/services/stock_takes.py`:

```python
import logging
from collections import defaultdict
from datetime import datetime, timedelta, timezone
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
    period_end = datetime.now(tz=timezone.utc)
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


async def _last_check_at(db: AsyncSession, *, store_id: str) -> datetime:
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
        return datetime.now(tz=timezone.utc) - timedelta(days=_FALLBACK_DAYS)
    return last
```

- [ ] **Step 5: Run preview tests to verify they pass**

```bash
cd api && uv run pytest tests/test_stock_takes_service.py -v
```

Expected: 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add api/app/services/stock_takes.py api/tests/factories.py api/tests/test_stock_takes_service.py
git commit -m "feat: add stock take service — preview endpoint with consumption aggregation"
```

---

## Task 3: Service — submit

**Files:**
- Modify: `api/app/services/stock_takes.py` (add `submit_stock_take`)
- Modify: `api/tests/test_stock_takes_service.py` (add submit tests)

- [ ] **Step 1: Write the failing submit tests**

Append to `api/tests/test_stock_takes_service.py`:

```python
from app.schemas.stock_takes import StockTakeSubmit, StockTakeSubmitItem
from sqlalchemy import select
from app.models import StockMovement
from app.enums import MovementType


@pytest.mark.asyncio
async def test_submit_creates_adjust_movement_for_variance(db, store_a, user_a):
    milk = await make_item(db, store_id=store_a.id, name="Milk", unit="L", stock=Decimal("5.000"))

    payload = StockTakeSubmit(
        items=[StockTakeSubmitItem(inventory_item_id=milk.id, actual_quantity=Decimal("4.000"))],
        notes="Evening check",
    )
    results = await svc.submit_stock_take(db, store_id=store_a.id, user_id=user_a.id, payload=payload)

    assert len(results) == 1
    assert results[0].system_quantity == Decimal("5.000")
    assert results[0].actual_quantity == Decimal("4.000")
    assert results[0].variance == Decimal("-1.000")

    movements = (
        await db.execute(
            select(StockMovement).where(
                StockMovement.inventory_item_id == milk.id,
                StockMovement.type == MovementType.ADJUST,
            )
        )
    ).scalars().all()
    assert len(movements) == 1
    assert movements[0].quantity == Decimal("1.000")
    assert movements[0].reason.startswith("STOCK_TAKE|4.000|-1.000|")


@pytest.mark.asyncio
async def test_submit_updates_stock_on_hand(db, store_a, user_a):
    milk = await make_item(db, store_id=store_a.id, name="Milk", unit="L", stock=Decimal("5.000"))
    payload = StockTakeSubmit(
        items=[StockTakeSubmitItem(inventory_item_id=milk.id, actual_quantity=Decimal("3.500"))],
    )
    await svc.submit_stock_take(db, store_id=store_a.id, user_id=user_a.id, payload=payload)

    await db.refresh(milk)
    assert milk.stock_on_hand == Decimal("3.500")


@pytest.mark.asyncio
async def test_submit_skips_items_with_zero_delta(db, store_a, user_a):
    milk = await make_item(db, store_id=store_a.id, name="Milk", unit="L", stock=Decimal("5.000"))
    payload = StockTakeSubmit(
        items=[StockTakeSubmitItem(inventory_item_id=milk.id, actual_quantity=Decimal("5.000"))],
    )
    results = await svc.submit_stock_take(db, store_id=store_a.id, user_id=user_a.id, payload=payload)

    assert results == []
    movements = (
        await db.execute(
            select(StockMovement).where(StockMovement.inventory_item_id == milk.id)
        )
    ).scalars().all()
    assert movements == []


@pytest.mark.asyncio
async def test_submit_raises_not_found_for_unknown_item(db, store_a, user_a):
    from app.core.errors import NotFound
    payload = StockTakeSubmit(
        items=[StockTakeSubmitItem(inventory_item_id="nonexistent_id_xyz", actual_quantity=Decimal("1.0"))],
    )
    with pytest.raises(NotFound):
        await svc.submit_stock_take(db, store_id=store_a.id, user_id=user_a.id, payload=payload)


@pytest.mark.asyncio
async def test_submit_raises_conflict_for_inactive_item(db, store_a, user_a):
    from app.core.errors import Conflict
    milk = await make_item(db, store_id=store_a.id, name="Milk", unit="L", stock=Decimal("5.000"), is_active=False)
    payload = StockTakeSubmit(
        items=[StockTakeSubmitItem(inventory_item_id=milk.id, actual_quantity=Decimal("4.000"))],
    )
    with pytest.raises(Conflict):
        await svc.submit_stock_take(db, store_id=store_a.id, user_id=user_a.id, payload=payload)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd api && uv run pytest tests/test_stock_takes_service.py::test_submit_creates_adjust_movement_for_variance -v
```

Expected: `AttributeError: module has no attribute 'submit_stock_take'`

- [ ] **Step 3: Add `submit_stock_take` to the service**

Append to `api/app/services/stock_takes.py` (after `get_preview`):

```python
async def submit_stock_take(
    db: AsyncSession,
    *,
    store_id: str,
    user_id: str,
    payload: StockTakeSubmit,
) -> list[StockTakeAdjustResult]:
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
```

- [ ] **Step 4: Run submit tests to verify they pass**

```bash
cd api && uv run pytest tests/test_stock_takes_service.py -v
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add api/app/services/stock_takes.py api/tests/test_stock_takes_service.py
git commit -m "feat: add stock take submit — creates tagged ADJUST movements and reconciles stock"
```

---

## Task 4: Service — history

**Files:**
- Modify: `api/app/services/stock_takes.py` (add `get_history`)
- Modify: `api/tests/test_stock_takes_service.py` (add history tests)

- [ ] **Step 1: Write failing history tests**

Append to `api/tests/test_stock_takes_service.py`:

```python
@pytest.mark.asyncio
async def test_history_returns_events_grouped_by_submit(db, store_a, user_a):
    milk = await make_item(db, store_id=store_a.id, name="Milk", unit="L", stock=Decimal("5.000"))

    payload = StockTakeSubmit(
        items=[StockTakeSubmitItem(inventory_item_id=milk.id, actual_quantity=Decimal("4.000"))],
        notes="First check",
    )
    await svc.submit_stock_take(db, store_id=store_a.id, user_id=user_a.id, payload=payload)

    events = await svc.get_history(db, store_id=store_a.id)

    assert len(events) == 1
    event = events[0]
    assert event.conducted_by == user_a.name
    assert event.item_count == 1
    assert len(event.items) == 1
    assert event.items[0].name == "Milk"
    assert event.items[0].actual_quantity == Decimal("4.000")
    assert event.items[0].system_quantity == Decimal("5.000")
    assert event.items[0].variance == Decimal("-1.000")


@pytest.mark.asyncio
async def test_history_returns_empty_list_when_no_checks(db, store_a):
    events = await svc.get_history(db, store_id=store_a.id)
    assert events == []


@pytest.mark.asyncio
async def test_history_cross_store_isolation(db, store_a, store_b, user_a, user_b):
    milk_a = await make_item(db, store_id=store_a.id, name="Milk", unit="L", stock=Decimal("5.000"))
    payload_a = StockTakeSubmit(
        items=[StockTakeSubmitItem(inventory_item_id=milk_a.id, actual_quantity=Decimal("3.000"))],
    )
    await svc.submit_stock_take(db, store_id=store_a.id, user_id=user_a.id, payload=payload_a)

    events_b = await svc.get_history(db, store_id=store_b.id)
    assert events_b == []
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd api && uv run pytest tests/test_stock_takes_service.py::test_history_returns_events_grouped_by_submit -v
```

Expected: `AttributeError: module has no attribute 'get_history'`

- [ ] **Step 3: Add `get_history` to the service**

Append to `api/app/services/stock_takes.py`:

```python
async def get_history(db: AsyncSession, *, store_id: str) -> list[StockTakeEvent]:
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

    events = []
    for key in sorted(groups.keys(), key=lambda k: k[0], reverse=True):
        conducted_at, conducted_by = group_meta[key]
        items = [_parse_history_item(m, item_name, item_unit) for m, item_name, item_unit in groups[key]]
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
    movement: StockMovement, item_name: str, item_unit: str
) -> StockTakeHistoryItem:
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
```

- [ ] **Step 4: Run all service tests to verify they pass**

```bash
cd api && uv run pytest tests/test_stock_takes_service.py -v
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add api/app/services/stock_takes.py api/tests/test_stock_takes_service.py
git commit -m "feat: add stock take history — groups tagged ADJUST movements into events"
```

---

## Task 5: Router + API tests + registration

**Files:**
- Create: `api/app/api/v1/stock_takes.py`
- Create: `api/tests/test_stock_takes_api.py`
- Modify: `api/app/api/v1/router.py`

- [ ] **Step 1: Write failing API tests**

Create `api/tests/test_stock_takes_api.py`:

```python
from decimal import Decimal

import pytest

from tests.factories import make_item, make_order_direct, make_order_item, make_product, make_recipe_item, make_user


async def _login(client, pin: str, store_id: str) -> dict:
    r = await client.post("/api/v1/auth/login", json={"pin": pin, "store_id": store_id})
    assert r.status_code == 200
    token = r.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_preview_returns_period_and_items(client, db, store_a, user_a):
    milk = await make_item(db, store_id=store_a.id, name="Milk", unit="L", stock=Decimal("5.000"))
    latte = await make_product(db, store_id=store_a.id, name="Latte")
    await make_recipe_item(db, product_id=latte.id, inventory_item_id=milk.id, quantity=Decimal("0.200"))
    order = await make_order_direct(db, store_id=store_a.id, created_by_id=user_a.id)
    await make_order_item(db, order_id=order.id, product_id=latte.id, product_name="Latte", quantity=2)

    headers = await _login(client, "1111", store_a.id)
    r = await client.get("/api/v1/stock-takes/preview", headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert "period_start" in body
    assert "period_end" in body
    assert len(body["items"]) == 1
    assert body["items"][0]["name"] == "Milk"
    assert Decimal(body["items"][0]["consumed_in_period"]) == Decimal("0.400")


@pytest.mark.asyncio
async def test_preview_empty_when_no_orders(client, db, store_a, user_a):
    headers = await _login(client, "1111", store_a.id)
    r = await client.get("/api/v1/stock-takes/preview", headers=headers)
    assert r.status_code == 200
    assert r.json()["items"] == []


@pytest.mark.asyncio
async def test_submit_returns_adjusted_items(client, db, store_a, user_a):
    milk = await make_item(db, store_id=store_a.id, name="Milk", unit="L", stock=Decimal("5.000"))
    headers = await _login(client, "1111", store_a.id)
    r = await client.post(
        "/api/v1/stock-takes",
        json={"items": [{"inventory_item_id": milk.id, "actual_quantity": "4.000"}], "notes": "Test"},
        headers=headers,
    )
    assert r.status_code == 200
    body = r.json()
    assert len(body) == 1
    assert body[0]["name"] == "Milk"
    assert Decimal(body[0]["variance"]) == Decimal("-1.000")


@pytest.mark.asyncio
async def test_submit_empty_items_returns_empty_list(client, db, store_a, user_a):
    headers = await _login(client, "1111", store_a.id)
    r = await client.post("/api/v1/stock-takes", json={"items": []}, headers=headers)
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_history_returns_past_checks(client, db, store_a, user_a):
    milk = await make_item(db, store_id=store_a.id, name="Milk", unit="L", stock=Decimal("5.000"))
    headers = await _login(client, "1111", store_a.id)
    await client.post(
        "/api/v1/stock-takes",
        json={"items": [{"inventory_item_id": milk.id, "actual_quantity": "4.000"}]},
        headers=headers,
    )
    r = await client.get("/api/v1/stock-takes/history", headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert len(body) == 1
    assert body[0]["item_count"] == 1
    assert body[0]["conducted_by"] == "Alice"


@pytest.mark.asyncio
async def test_cross_store_isolation_preview(client, db, store_a, store_b, user_a, user_b):
    milk = await make_item(db, store_id=store_a.id, name="Milk", unit="L", stock=Decimal("5.000"))
    latte = await make_product(db, store_id=store_a.id, name="Latte")
    await make_recipe_item(db, product_id=latte.id, inventory_item_id=milk.id, quantity=Decimal("0.200"))
    order = await make_order_direct(db, store_id=store_a.id, created_by_id=user_a.id)
    await make_order_item(db, order_id=order.id, product_id=latte.id, product_name="Latte", quantity=3)

    headers_b = await _login(client, "9999", store_b.id)
    r = await client.get("/api/v1/stock-takes/preview", headers=headers_b)
    assert r.status_code == 200
    assert r.json()["items"] == []
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd api && uv run pytest tests/test_stock_takes_api.py -v
```

Expected: connection error or 404 — router not registered yet.

- [ ] **Step 3: Create the router**

Create `api/app/api/v1/stock_takes.py`:

```python
from fastapi import APIRouter

from app.deps import DbSession, StoreUser
from app.schemas.stock_takes import StockTakeAdjustResult, StockTakeEvent, StockTakePreview, StockTakeSubmit
from app.services import stock_takes as svc

router = APIRouter(prefix="/stock-takes", tags=["stock-takes"])


@router.get(
    "/preview",
    response_model=StockTakePreview,
    summary="Get stock take preview for current period",
    operation_id="stock_take_preview",
)
async def preview(user: StoreUser, db: DbSession) -> StockTakePreview:
    return await svc.get_preview(db, store_id=user.store_id)


@router.post(
    "",
    response_model=list[StockTakeAdjustResult],
    summary="Submit actual stock counts and reconcile variances",
    operation_id="stock_take_submit",
)
async def submit(
    payload: StockTakeSubmit,
    user: StoreUser,
    db: DbSession,
) -> list[StockTakeAdjustResult]:
    return await svc.submit_stock_take(db, store_id=user.store_id, user_id=user.id, payload=payload)


@router.get(
    "/history",
    response_model=list[StockTakeEvent],
    summary="List past stock take events",
    operation_id="stock_take_history",
)
async def history(user: StoreUser, db: DbSession) -> list[StockTakeEvent]:
    return await svc.get_history(db, store_id=user.store_id)
```

- [ ] **Step 4: Register the router**

Open `api/app/api/v1/router.py` and add the import and `include_router` call:

```python
from app.api.v1 import (
    auth, categories, customers, hr, inventory,
    modifier_groups, orders, pre_orders, products,
    production, realtime, receipts, reports, shopping_list,
    stock_takes,
)

# ... existing includes ...
api_router.include_router(stock_takes.router)
```

- [ ] **Step 5: Run all API tests to verify they pass**

```bash
cd api && uv run pytest tests/test_stock_takes_api.py -v
```

Expected: all 6 tests PASS.

- [ ] **Step 6: Run full suite to check for regressions**

```bash
cd api && uv run pytest -v
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add api/app/api/v1/stock_takes.py api/app/api/v1/router.py api/tests/test_stock_takes_api.py
git commit -m "feat: add stock takes router and API endpoints"
```

---

## Task 6: CLAUDE.md update

**Files:**
- Modify: `api/CLAUDE.md`

- [ ] **Step 1: Add `stock_takes` to the API modules list in CLAUDE.md**

Find the line:
```
`auth`, `inventory`, `receipts`, `categories`, `products`, `modifier_groups`, `orders`, `pre_orders`, `shopping_list`, `production`, `realtime`, `reports`, `customers`, `hr`
```

Replace with:
```
`auth`, `inventory`, `receipts`, `categories`, `products`, `modifier_groups`, `orders`, `pre_orders`, `shopping_list`, `production`, `realtime`, `reports`, `customers`, `hr`, `stock_takes`
```

- [ ] **Step 2: Commit**

```bash
git add api/CLAUDE.md
git commit -m "docs: update CLAUDE.md with stock_takes API module"
```
