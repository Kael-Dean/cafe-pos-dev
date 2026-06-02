# Promotion Rule Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a promotion rule engine that lets managers create named discount rules (% off, combo, happy hour) that the POS evaluates at checkout and applies with cashier confirmation.

**Architecture:** Four promotion types (`PERCENT_OFF`, `COMBO_BUNDLE`, `COMBO_QUANTITY`, `HAPPY_HOUR`) stored in a single `promotions` table. A stateless `POST /promotions/evaluate` endpoint checks cart items against active promotions; the cashier confirms and `promotion_ids` flow into `create_order`, which writes `promotion_redemptions` rows and sets `order.discount`.

**Tech Stack:** FastAPI, SQLAlchemy 2.x async, PostgreSQL, Alembic, pytest-asyncio

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Modify | `api/app/enums.py` | Add `PromotionType`, `PromotionScope` |
| Create | `api/app/models/promotions.py` | `Promotion`, `PromotionRedemption` ORM models |
| Modify | `api/app/models/__init__.py` | Import and re-export new models |
| Create | `api/alembic/versions/<hash>_add_promotions.py` | DB migration |
| Modify | `api/app/schemas/promotions.py` | CRUD + evaluate schemas |
| Modify | `api/app/services/promotions.py` | CRUD + evaluator + `apply_promotions` |
| Modify | `api/app/api/v1/promotions.py` | CRUD + evaluate endpoints |
| Modify | `api/app/schemas/orders.py` | Add `promotion_ids` to `CreateOrderRequest` |
| Modify | `api/app/services/orders.py` | Call `apply_promotions`, write redemptions |
| Modify | `api/tests/test_promotions_api.py` | Phase 2 tests |

---

## Task 1: Enums + Models + Migration

**Files:**
- Modify: `api/app/enums.py`
- Create: `api/app/models/promotions.py`
- Modify: `api/app/models/__init__.py`
- Create: `api/alembic/versions/<hash>_add_promotions.py`

- [ ] **Step 1: Add enums**

Append to `api/app/enums.py`:

```python
class PromotionType(enum.StrEnum):
    PERCENT_OFF = "PERCENT_OFF"
    COMBO_BUNDLE = "COMBO_BUNDLE"
    COMBO_QUANTITY = "COMBO_QUANTITY"
    HAPPY_HOUR = "HAPPY_HOUR"


class PromotionScope(enum.StrEnum):
    ORDER = "ORDER"
    CATEGORY = "CATEGORY"
    PRODUCT = "PRODUCT"
```

- [ ] **Step 2: Create `api/app/models/promotions.py`**

```python
from datetime import date, datetime, time
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    JSON,
    Numeric,
    String,
    Time,
    func,
)
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin
from app.db.types import new_cuid
from app.enums import PromotionScope, PromotionType


class Promotion(Base, TimestampMixin):
    __tablename__ = "promotions"

    id: Mapped[str] = mapped_column(String(24), primary_key=True, default=new_cuid)
    store_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("stores.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    type: Mapped[PromotionType] = mapped_column(
        SAEnum(PromotionType, name="promotion_type"), nullable=False
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_exclusive: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    discount_pct: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    scope: Mapped[PromotionScope] = mapped_column(
        SAEnum(PromotionScope, name="promotion_scope"),
        nullable=False,
        default=PromotionScope.ORDER,
    )
    product_ids_json: Mapped[list | None] = mapped_column(JSON, nullable=True)
    category_id: Mapped[str | None] = mapped_column(
        String(24), ForeignKey("categories.id", ondelete="SET NULL"), nullable=True
    )
    min_quantity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    bundle_product_ids_json: Mapped[list | None] = mapped_column(JSON, nullable=True)
    time_start: Mapped[time | None] = mapped_column(Time, nullable=True)
    time_end: Mapped[time | None] = mapped_column(Time, nullable=True)
    days_of_week_json: Mapped[list | None] = mapped_column(JSON, nullable=True)
    valid_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    valid_until: Mapped[date | None] = mapped_column(Date, nullable=True)


class PromotionRedemption(Base):
    __tablename__ = "promotion_redemptions"

    id: Mapped[str] = mapped_column(String(24), primary_key=True, default=new_cuid)
    promotion_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("promotions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    order_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("orders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    discount_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
```

- [ ] **Step 3: Register models in `api/app/models/__init__.py`**

Add the import line after the `membership` import block:

```python
from app.models.promotions import Promotion, PromotionRedemption
```

Add to `__all__`:

```python
"Promotion",
"PromotionRedemption",
```

- [ ] **Step 4: Generate and apply migration**

```bash
cd api
uv run alembic revision --autogenerate -m "add_promotions"
uv run alembic upgrade head
```

Expected: migration file created in `api/alembic/versions/`, `upgrade head` exits 0.

Review the generated migration before proceeding — confirm it creates `promotions` and `promotion_redemptions` tables and both enum types (`promotion_type`, `promotion_scope`).

- [ ] **Step 5: Commit**

```bash
git add api/app/enums.py api/app/models/promotions.py api/app/models/__init__.py api/alembic/versions/
git commit -m "feat: Promotion and PromotionRedemption models + migration"
```

---

## Task 2: Promotion CRUD

**Files:**
- Modify: `api/app/schemas/promotions.py`
- Modify: `api/app/services/promotions.py`
- Modify: `api/app/api/v1/promotions.py`
- Modify: `api/tests/test_promotions_api.py`

- [ ] **Step 1: Write failing tests**

Append to `api/tests/test_promotions_api.py`:

```python
# ---------------------------------------------------------------------------
# Phase 2 — CRUD
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_create_promotion_persists(db, store_a):
    from app.enums import PromotionScope, PromotionType
    from app.schemas.promotions import PromotionCreate
    from app.services import promotions as svc

    req = PromotionCreate(
        name="Weekend 10% Off",
        type=PromotionType.PERCENT_OFF,
        discount_pct=10,
        scope=PromotionScope.ORDER,
    )
    promo = await svc.create_promotion(db, store_id=store_a.id, req=req)

    assert promo.id is not None
    assert promo.name == "Weekend 10% Off"
    assert promo.is_active is True
    assert promo.is_exclusive is False


@pytest.mark.asyncio
async def test_list_promotions_active_filter(db, store_a):
    from app.enums import PromotionScope, PromotionType
    from app.schemas.promotions import PromotionCreate, PromotionUpdate
    from app.services import promotions as svc

    p1 = await svc.create_promotion(db, store_id=store_a.id, req=PromotionCreate(
        name=f"Active-{uid()}", type=PromotionType.PERCENT_OFF,
        discount_pct=5, scope=PromotionScope.ORDER,
    ))
    p2 = await svc.create_promotion(db, store_id=store_a.id, req=PromotionCreate(
        name=f"Inactive-{uid()}", type=PromotionType.PERCENT_OFF,
        discount_pct=5, scope=PromotionScope.ORDER,
    ))
    await svc.update_promotion(db, store_id=store_a.id, promotion_id=p2.id,
                               req=PromotionUpdate(is_active=False))

    active = await svc.list_promotions(db, store_id=store_a.id, active=True)
    ids = [p.id for p in active]
    assert p1.id in ids
    assert p2.id not in ids


@pytest.mark.asyncio
async def test_delete_promotion(db, store_a):
    from app.enums import PromotionScope, PromotionType
    from app.core.errors import NotFound
    from app.schemas.promotions import PromotionCreate
    from app.services import promotions as svc

    promo = await svc.create_promotion(db, store_id=store_a.id, req=PromotionCreate(
        name=f"ToDelete-{uid()}", type=PromotionType.PERCENT_OFF,
        discount_pct=5, scope=PromotionScope.ORDER,
    ))
    await svc.delete_promotion(db, store_id=store_a.id, promotion_id=promo.id)

    with pytest.raises(NotFound):
        await svc.get_promotion(db, store_id=store_a.id, promotion_id=promo.id)


@pytest.mark.asyncio
async def test_crud_barista_cannot_create(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")  # barista
    resp = await client.post(
        "/api/v1/promotions",
        json={"name": "Test", "type": "PERCENT_OFF", "discount_pct": 10, "scope": "ORDER"},
        headers=_h(token),
    )
    assert resp.status_code == 403
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
cd api
uv run pytest tests/test_promotions_api.py::test_create_promotion_persists -v
```

Expected: `ImportError` or `AttributeError` — `PromotionCreate` and service functions don't exist yet.

- [ ] **Step 3: Replace `api/app/schemas/promotions.py` with full schema file**

```python
from datetime import date, datetime, time
from decimal import Decimal

from pydantic import BaseModel, Field

from app.enums import PromotionScope, PromotionType


class PromotionBaselineResponse(BaseModel):
    product_id: str
    sales_window_days: int
    units_sold_in_window: Decimal
    avg_units_per_week: Decimal


class PromotionCreate(BaseModel):
    name: str = Field(max_length=120)
    type: PromotionType
    is_exclusive: bool = False
    discount_pct: Decimal = Field(gt=0, le=100)
    scope: PromotionScope = PromotionScope.ORDER
    product_ids_json: list[str] | None = None
    category_id: str | None = None
    min_quantity: int | None = Field(None, ge=1)
    bundle_product_ids_json: list[str] | None = None
    time_start: time | None = None
    time_end: time | None = None
    days_of_week_json: list[int] | None = None
    valid_from: date | None = None
    valid_until: date | None = None


class PromotionUpdate(BaseModel):
    name: str | None = Field(None, max_length=120)
    is_active: bool | None = None
    is_exclusive: bool | None = None
    discount_pct: Decimal | None = Field(None, gt=0, le=100)
    scope: PromotionScope | None = None
    product_ids_json: list[str] | None = None
    category_id: str | None = None
    min_quantity: int | None = Field(None, ge=1)
    bundle_product_ids_json: list[str] | None = None
    time_start: time | None = None
    time_end: time | None = None
    days_of_week_json: list[int] | None = None
    valid_from: date | None = None
    valid_until: date | None = None


class PromotionRead(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    store_id: str
    name: str
    type: PromotionType
    is_active: bool
    is_exclusive: bool
    discount_pct: Decimal
    scope: PromotionScope
    product_ids_json: list[str] | None
    category_id: str | None
    min_quantity: int | None
    bundle_product_ids_json: list[str] | None
    time_start: time | None
    time_end: time | None
    days_of_week_json: list[int] | None
    valid_from: date | None
    valid_until: date | None
    created_at: datetime
    updated_at: datetime


class PromotionListResponse(BaseModel):
    items: list[PromotionRead]
    total: int


class EvaluateItemIn(BaseModel):
    product_id: str
    quantity: int = Field(ge=1)


class EligiblePromotion(BaseModel):
    promotion_id: str
    name: str
    type: PromotionType
    discount_amount: Decimal
    is_exclusive: bool


class EvaluateRequest(BaseModel):
    items: list[EvaluateItemIn] = Field(min_length=1)


class EvaluateResponse(BaseModel):
    eligible: list[EligiblePromotion]
```

- [ ] **Step 4: Add CRUD functions to `api/app/services/promotions.py`**

Append after the existing `get_promotion_baseline` function:

```python
from sqlalchemy import select

from app.core.errors import NotFound
from app.models.promotions import Promotion, PromotionRedemption
from app.schemas.promotions import PromotionCreate, PromotionUpdate


async def create_promotion(
    db: AsyncSession, *, store_id: str, req: PromotionCreate
) -> Promotion:
    async with db.begin():
        promo = Promotion(store_id=store_id, **req.model_dump())
        db.add(promo)
    return promo


async def list_promotions(
    db: AsyncSession, *, store_id: str, active: bool | None = None
) -> list[Promotion]:
    q = select(Promotion).where(Promotion.store_id == store_id).order_by(Promotion.created_at.desc())
    if active is not None:
        q = q.where(Promotion.is_active == active)
    result = await db.execute(q)
    return list(result.scalars().all())


async def get_promotion(
    db: AsyncSession, *, store_id: str, promotion_id: str
) -> Promotion:
    result = await db.execute(
        select(Promotion).where(Promotion.id == promotion_id, Promotion.store_id == store_id)
    )
    promo = result.scalar_one_or_none()
    if not promo:
        raise NotFound("Promotion not found")
    return promo


async def update_promotion(
    db: AsyncSession, *, store_id: str, promotion_id: str, req: PromotionUpdate
) -> Promotion:
    async with db.begin():
        promo = await get_promotion(db, store_id=store_id, promotion_id=promotion_id)
        for k, v in req.model_dump(exclude_unset=True).items():
            setattr(promo, k, v)
    return promo


async def delete_promotion(
    db: AsyncSession, *, store_id: str, promotion_id: str
) -> None:
    async with db.begin():
        promo = await get_promotion(db, store_id=store_id, promotion_id=promotion_id)
        await db.delete(promo)
```

Note: the existing imports in `services/promotions.py` (`datetime`, `timedelta`, `timezone`, `Decimal`, `func`, `select`, `AsyncSession`, `NotFound`, `OrderStatus`, `Product`, `Order`, `OrderItem`, `PromotionBaselineResponse`) may already cover some of these — remove any duplicates.

- [ ] **Step 5: Add CRUD endpoints to `api/app/api/v1/promotions.py`**

The router currently only has `GET /calculator/baseline`. Preserve that endpoint, then add below it. The full updated file:

```python
from fastapi import APIRouter, Depends, Query

from app.deps import DbSession, StoreUser, require_role
from app.enums import Role
from app.schemas.promotions import (
    EvaluateRequest,
    EvaluateResponse,
    PromotionBaselineResponse,
    PromotionCreate,
    PromotionListResponse,
    PromotionRead,
    PromotionUpdate,
)
from app.services import promotions as svc

_MANAGER_PLUS = require_role(Role.OWNER, Role.MANAGER)

router = APIRouter(prefix="/promotions", tags=["promotions"])


@router.get(
    "/calculator/baseline",
    response_model=PromotionBaselineResponse,
    summary="Sales baseline for promotion break-even analysis",
    operation_id="promotions_calculator_baseline",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def get_promotion_baseline(
    product_id: str,
    days: int = Query(default=30, ge=1, le=365, description="Sales window in days (1–365)"),
    user: StoreUser = ...,
    db: DbSession = ...,
) -> PromotionBaselineResponse:
    return await svc.get_promotion_baseline(
        db,
        store_id=user.store_id,
        product_id=product_id,
        days=days,
    )


@router.post(
    "/evaluate",
    response_model=EvaluateResponse,
    summary="Evaluate cart for eligible promotions",
    operation_id="promotions_evaluate",
)
async def evaluate_promotions(
    payload: EvaluateRequest,
    user: StoreUser = ...,
    db: DbSession = ...,
) -> EvaluateResponse:
    return await svc.evaluate_promotions(db, store_id=user.store_id, items=payload.items)


@router.post(
    "",
    response_model=PromotionRead,
    status_code=201,
    summary="Create a promotion rule",
    operation_id="promotions_create",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def create_promotion(
    payload: PromotionCreate,
    user: StoreUser = ...,
    db: DbSession = ...,
) -> PromotionRead:
    return await svc.create_promotion(db, store_id=user.store_id, req=payload)


@router.get(
    "",
    response_model=PromotionListResponse,
    summary="List promotion rules",
    operation_id="promotions_list",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def list_promotions(
    active: bool | None = Query(None),
    user: StoreUser = ...,
    db: DbSession = ...,
) -> PromotionListResponse:
    items = await svc.list_promotions(db, store_id=user.store_id, active=active)
    return PromotionListResponse(items=items, total=len(items))


@router.get(
    "/{promotion_id}",
    response_model=PromotionRead,
    summary="Get a promotion rule",
    operation_id="promotions_get",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def get_promotion(
    promotion_id: str,
    user: StoreUser = ...,
    db: DbSession = ...,
) -> PromotionRead:
    return await svc.get_promotion(db, store_id=user.store_id, promotion_id=promotion_id)


@router.patch(
    "/{promotion_id}",
    response_model=PromotionRead,
    summary="Update a promotion rule",
    operation_id="promotions_update",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def update_promotion(
    promotion_id: str,
    payload: PromotionUpdate,
    user: StoreUser = ...,
    db: DbSession = ...,
) -> PromotionRead:
    return await svc.update_promotion(
        db, store_id=user.store_id, promotion_id=promotion_id, req=payload
    )


@router.delete(
    "/{promotion_id}",
    status_code=204,
    summary="Delete a promotion rule",
    operation_id="promotions_delete",
    dependencies=[Depends(_MANAGER_PLUS)],
)
async def delete_promotion(
    promotion_id: str,
    user: StoreUser = ...,
    db: DbSession = ...,
) -> None:
    await svc.delete_promotion(db, store_id=user.store_id, promotion_id=promotion_id)
```

- [ ] **Step 6: Run CRUD tests — confirm they pass**

```bash
cd api
uv run pytest tests/test_promotions_api.py::test_create_promotion_persists tests/test_promotions_api.py::test_list_promotions_active_filter tests/test_promotions_api.py::test_delete_promotion tests/test_promotions_api.py::test_crud_barista_cannot_create -v
```

Expected: 4 passed.

- [ ] **Step 7: Commit**

```bash
git add api/app/schemas/promotions.py api/app/services/promotions.py api/app/api/v1/promotions.py api/tests/test_promotions_api.py
git commit -m "feat: promotion CRUD endpoints"
```

---

## Task 3: Evaluate Endpoint

**Files:**
- Modify: `api/app/services/promotions.py`
- Modify: `api/tests/test_promotions_api.py`

(Schemas and router endpoint already written in Task 2 Steps 3 and 5.)

- [ ] **Step 1: Write failing evaluate tests**

Append to `api/tests/test_promotions_api.py`:

```python
# ---------------------------------------------------------------------------
# Phase 2 — Evaluate
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_evaluate_percent_off_order_scope(db, store_a):
    from app.enums import PromotionScope, PromotionType
    from app.schemas.promotions import EvaluateItemIn, EvaluateRequest, PromotionCreate
    from app.services import promotions as svc

    product = await make_product(db, store_id=store_a.id, name=f"eval-{uid()}", price=Decimal("100.00"))
    await svc.create_promotion(db, store_id=store_a.id, req=PromotionCreate(
        name="10% off order", type=PromotionType.PERCENT_OFF,
        discount_pct=10, scope=PromotionScope.ORDER,
    ))

    result = await svc.evaluate_promotions(
        db, store_id=store_a.id,
        items=[EvaluateItemIn(product_id=product.id, quantity=2)],
    )

    assert len(result.eligible) == 1
    assert result.eligible[0].discount_amount == Decimal("20.00")  # 10% of 200


@pytest.mark.asyncio
async def test_evaluate_happy_hour_in_window(db, store_a):
    from datetime import time
    from app.enums import PromotionScope, PromotionType
    from app.schemas.promotions import EvaluateItemIn, PromotionCreate
    from app.services import promotions as svc

    product = await make_product(db, store_id=store_a.id, name=f"hh-{uid()}", price=Decimal("80.00"))
    # time window covers the entire day so it's always eligible
    await svc.create_promotion(db, store_id=store_a.id, req=PromotionCreate(
        name="Happy Hour", type=PromotionType.HAPPY_HOUR,
        discount_pct=15, scope=PromotionScope.ORDER,
        time_start=time(0, 0), time_end=time(23, 59, 59),
        days_of_week_json=[0, 1, 2, 3, 4, 5, 6],
    ))

    result = await svc.evaluate_promotions(
        db, store_id=store_a.id,
        items=[EvaluateItemIn(product_id=product.id, quantity=1)],
    )

    assert len(result.eligible) == 1
    assert result.eligible[0].type == PromotionType.HAPPY_HOUR


@pytest.mark.asyncio
async def test_evaluate_happy_hour_expired(db, store_a):
    from datetime import date, time
    from app.enums import PromotionScope, PromotionType
    from app.schemas.promotions import EvaluateItemIn, PromotionCreate
    from app.services import promotions as svc

    product = await make_product(db, store_id=store_a.id, name=f"hh-exp-{uid()}", price=Decimal("80.00"))
    await svc.create_promotion(db, store_id=store_a.id, req=PromotionCreate(
        name="Expired HH", type=PromotionType.HAPPY_HOUR,
        discount_pct=15, scope=PromotionScope.ORDER,
        time_start=time(0, 0), time_end=time(23, 59, 59),
        days_of_week_json=[0, 1, 2, 3, 4, 5, 6],
        valid_until=date(2020, 1, 1),  # in the past
    ))

    result = await svc.evaluate_promotions(
        db, store_id=store_a.id,
        items=[EvaluateItemIn(product_id=product.id, quantity=1)],
    )

    assert result.eligible == []


@pytest.mark.asyncio
async def test_evaluate_combo_bundle_eligible(db, store_a):
    from app.enums import PromotionScope, PromotionType
    from app.schemas.promotions import EvaluateItemIn, PromotionCreate
    from app.services import promotions as svc

    p1 = await make_product(db, store_id=store_a.id, name=f"bundle-a-{uid()}", price=Decimal("50.00"))
    p2 = await make_product(db, store_id=store_a.id, name=f"bundle-b-{uid()}", price=Decimal("50.00"))
    await svc.create_promotion(db, store_id=store_a.id, req=PromotionCreate(
        name="Bundle", type=PromotionType.COMBO_BUNDLE,
        discount_pct=20, scope=PromotionScope.PRODUCT,
        bundle_product_ids_json=[p1.id, p2.id],
    ))

    result = await svc.evaluate_promotions(
        db, store_id=store_a.id,
        items=[
            EvaluateItemIn(product_id=p1.id, quantity=1),
            EvaluateItemIn(product_id=p2.id, quantity=1),
        ],
    )

    assert len(result.eligible) == 1
    assert result.eligible[0].discount_amount == Decimal("20.00")  # 20% of 100


@pytest.mark.asyncio
async def test_evaluate_combo_bundle_missing_product(db, store_a):
    from app.enums import PromotionScope, PromotionType
    from app.schemas.promotions import EvaluateItemIn, PromotionCreate
    from app.services import promotions as svc

    p1 = await make_product(db, store_id=store_a.id, name=f"bundle-c-{uid()}", price=Decimal("50.00"))
    p2 = await make_product(db, store_id=store_a.id, name=f"bundle-d-{uid()}", price=Decimal("50.00"))
    await svc.create_promotion(db, store_id=store_a.id, req=PromotionCreate(
        name="Bundle2", type=PromotionType.COMBO_BUNDLE,
        discount_pct=20, scope=PromotionScope.PRODUCT,
        bundle_product_ids_json=[p1.id, p2.id],
    ))

    result = await svc.evaluate_promotions(
        db, store_id=store_a.id,
        items=[EvaluateItemIn(product_id=p1.id, quantity=1)],  # p2 missing
    )

    assert result.eligible == []


@pytest.mark.asyncio
async def test_evaluate_combo_quantity_eligible(db, store_a):
    from app.enums import PromotionScope, PromotionType
    from app.schemas.promotions import EvaluateItemIn, PromotionCreate
    from app.services import promotions as svc

    product = await make_product(db, store_id=store_a.id, name=f"qty-{uid()}", price=Decimal("40.00"))
    await svc.create_promotion(db, store_id=store_a.id, req=PromotionCreate(
        name="Buy 3+", type=PromotionType.COMBO_QUANTITY,
        discount_pct=10, scope=PromotionScope.PRODUCT,
        product_ids_json=[product.id], min_quantity=3,
    ))

    result = await svc.evaluate_promotions(
        db, store_id=store_a.id,
        items=[EvaluateItemIn(product_id=product.id, quantity=3)],
    )

    assert len(result.eligible) == 1
    assert result.eligible[0].discount_amount == Decimal("12.00")  # 10% of 120


@pytest.mark.asyncio
async def test_evaluate_combo_quantity_below_min(db, store_a):
    from app.enums import PromotionScope, PromotionType
    from app.schemas.promotions import EvaluateItemIn, PromotionCreate
    from app.services import promotions as svc

    product = await make_product(db, store_id=store_a.id, name=f"qty2-{uid()}", price=Decimal("40.00"))
    await svc.create_promotion(db, store_id=store_a.id, req=PromotionCreate(
        name="Buy 3+ v2", type=PromotionType.COMBO_QUANTITY,
        discount_pct=10, scope=PromotionScope.PRODUCT,
        product_ids_json=[product.id], min_quantity=3,
    ))

    result = await svc.evaluate_promotions(
        db, store_id=store_a.id,
        items=[EvaluateItemIn(product_id=product.id, quantity=2)],  # below min
    )

    assert result.eligible == []


@pytest.mark.asyncio
async def test_evaluate_barista_can_access(client, db, store_a, user_a):
    token = await _login(client, store_a.slug, "1111")  # barista
    product = await make_product(db, store_id=store_a.id, name=f"eval-api-{uid()}")
    resp = await client.post(
        "/api/v1/promotions/evaluate",
        json={"items": [{"product_id": product.id, "quantity": 1}]},
        headers=_h(token),
    )
    assert resp.status_code == 200
    assert "eligible" in resp.json()
```

Note: `make_product` in `tests/factories.py` currently doesn't accept a `price` keyword argument — check its signature in `conftest.py`. If it doesn't support `price`, add `price: Decimal = Decimal("85.00")` to the factory and pass it through to the `Product` constructor, then update `tests/factories.py` to re-export it.

- [ ] **Step 2: Run evaluate tests — confirm they fail**

```bash
cd api
uv run pytest tests/test_promotions_api.py::test_evaluate_percent_off_order_scope -v
```

Expected: `AttributeError: module 'app.services.promotions' has no attribute 'evaluate_promotions'`

- [ ] **Step 3: Add evaluator to `api/app/services/promotions.py`**

Append after the CRUD functions:

```python
from datetime import datetime, timezone
from app.enums import PromotionType, PromotionScope
from app.models.catalog import Product
from app.schemas.promotions import EvaluateItemIn, EligiblePromotion, EvaluateResponse


async def evaluate_promotions(
    db: AsyncSession,
    *,
    store_id: str,
    items: list[EvaluateItemIn],
) -> EvaluateResponse:
    now = datetime.now(timezone.utc)
    today = now.date()
    current_time = now.time()
    current_weekday = now.weekday()  # 0 = Monday

    promos_result = await db.execute(
        select(Promotion).where(Promotion.store_id == store_id, Promotion.is_active == True)  # noqa: E712
    )
    promotions = promos_result.scalars().all()

    product_ids = [item.product_id for item in items]
    prods_result = await db.execute(
        select(Product).where(Product.id.in_(product_ids), Product.store_id == store_id)
    )
    products_map = {p.id: p for p in prods_result.scalars().all()}

    cart_lines = [
        {
            "product_id": item.product_id,
            "category_id": products_map[item.product_id].category_id,
            "quantity": item.quantity,
            "line_total": products_map[item.product_id].price * item.quantity,
        }
        for item in items
        if item.product_id in products_map
    ]

    eligible = []
    for promo in promotions:
        if promo.valid_from and today < promo.valid_from:
            continue
        if promo.valid_until and today > promo.valid_until:
            continue
        if promo.type == PromotionType.HAPPY_HOUR:
            if promo.time_start is None or promo.time_end is None:
                continue
            if not (promo.time_start <= current_time < promo.time_end):
                continue
            if promo.days_of_week_json is not None and current_weekday not in promo.days_of_week_json:
                continue

        discount_amount = _compute_discount(promo, cart_lines)
        if discount_amount > Decimal("0"):
            eligible.append(EligiblePromotion(
                promotion_id=promo.id,
                name=promo.name,
                type=promo.type,
                discount_amount=discount_amount,
                is_exclusive=promo.is_exclusive,
            ))

    return EvaluateResponse(eligible=eligible)


def _compute_discount(promo: Promotion, cart_lines: list[dict]) -> Decimal:
    if promo.type in (PromotionType.PERCENT_OFF, PromotionType.HAPPY_HOUR):
        return _scope_discount(promo, cart_lines)
    if promo.type == PromotionType.COMBO_BUNDLE:
        return _combo_bundle_discount(promo, cart_lines)
    if promo.type == PromotionType.COMBO_QUANTITY:
        return _combo_quantity_discount(promo, cart_lines)
    return Decimal("0")


def _scope_discount(promo: Promotion, cart_lines: list[dict]) -> Decimal:
    if promo.scope == PromotionScope.ORDER:
        base = sum((line["line_total"] for line in cart_lines), Decimal("0"))
    elif promo.scope == PromotionScope.CATEGORY:
        base = sum(
            (line["line_total"] for line in cart_lines if line["category_id"] == promo.category_id),
            Decimal("0"),
        )
    else:  # PRODUCT
        product_ids = set(promo.product_ids_json or [])
        base = sum(
            (line["line_total"] for line in cart_lines if line["product_id"] in product_ids),
            Decimal("0"),
        )
    return (base * promo.discount_pct / 100).quantize(Decimal("0.01"))


def _combo_bundle_discount(promo: Promotion, cart_lines: list[dict]) -> Decimal:
    bundle_ids = set(promo.bundle_product_ids_json or [])
    if not bundle_ids:
        return Decimal("0")
    cart_product_ids = {line["product_id"] for line in cart_lines}
    if not bundle_ids.issubset(cart_product_ids):
        return Decimal("0")
    base = sum(
        (line["line_total"] for line in cart_lines if line["product_id"] in bundle_ids),
        Decimal("0"),
    )
    return (base * promo.discount_pct / 100).quantize(Decimal("0.01"))


def _combo_quantity_discount(promo: Promotion, cart_lines: list[dict]) -> Decimal:
    if promo.scope == PromotionScope.PRODUCT:
        product_ids = set(promo.product_ids_json or [])
        matching = [line for line in cart_lines if line["product_id"] in product_ids]
    elif promo.scope == PromotionScope.CATEGORY:
        matching = [line for line in cart_lines if line["category_id"] == promo.category_id]
    else:
        matching = cart_lines

    total_qty = sum(line["quantity"] for line in matching)
    if total_qty < (promo.min_quantity or 1):
        return Decimal("0")
    base = sum((line["line_total"] for line in matching), Decimal("0"))
    return (base * promo.discount_pct / 100).quantize(Decimal("0.01"))
```

- [ ] **Step 4: Run evaluate tests — confirm they pass**

```bash
cd api
uv run pytest tests/test_promotions_api.py -k "evaluate" -v
```

Expected: 8 passed.

- [ ] **Step 5: Run full suite — confirm no regressions**

```bash
cd api
uv run pytest tests/test_promotions_api.py -v
```

Expected: all existing Phase 1 tests still pass.

- [ ] **Step 6: Commit**

```bash
git add api/app/services/promotions.py api/tests/test_promotions_api.py
git commit -m "feat: promotion evaluate endpoint"
```

---

## Task 4: Checkout Integration

**Files:**
- Modify: `api/app/schemas/orders.py`
- Modify: `api/app/services/orders.py`
- Modify: `api/app/services/promotions.py`
- Modify: `api/tests/test_promotions_api.py`

- [ ] **Step 1: Write failing checkout tests**

Append to `api/tests/test_promotions_api.py`:

```python
# ---------------------------------------------------------------------------
# Phase 2 — Checkout integration
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_order_with_promotion_applies_discount(client, db, store_a, manager_a, user_a):
    from app.enums import PromotionScope, PromotionType
    from app.models.promotions import PromotionRedemption
    from app.schemas.promotions import PromotionCreate
    from app.services import promotions as svc
    from sqlalchemy import select

    token = await _login(client, store_a.slug, "1111")  # barista
    product = await make_product(db, store_id=store_a.id, name=f"promo-order-{uid()}", price=Decimal("100.00"))
    promo = await svc.create_promotion(db, store_id=store_a.id, req=PromotionCreate(
        name="10off", type=PromotionType.PERCENT_OFF,
        discount_pct=10, scope=PromotionScope.ORDER,
    ))

    resp = await client.post(
        "/api/v1/orders",
        json={
            "idempotency_key": uid(),
            "channel": "DINE_IN",
            "items": [{"product_id": product.id, "quantity": 2}],
            "promotion_ids": [promo.id],
        },
        headers=_h(token),
    )
    assert resp.status_code == 201
    body = resp.json()
    assert Decimal(body["discount"]) == Decimal("20.00")   # 10% of 200
    assert Decimal(body["total"]) == Decimal("180.00")

    # PromotionRedemption row written
    row = (await db.execute(
        select(PromotionRedemption).where(PromotionRedemption.order_id == body["id"])
    )).scalar_one_or_none()
    assert row is not None
    assert row.discount_amount == Decimal("20.00")


@pytest.mark.asyncio
async def test_order_exclusive_stacking_returns_422(client, db, store_a, user_a):
    from app.enums import PromotionScope, PromotionType
    from app.schemas.promotions import PromotionCreate
    from app.services import promotions as svc

    token = await _login(client, store_a.slug, "1111")
    product = await make_product(db, store_id=store_a.id, name=f"excl-{uid()}", price=Decimal("100.00"))
    exclusive = await svc.create_promotion(db, store_id=store_a.id, req=PromotionCreate(
        name="Exclusive", type=PromotionType.PERCENT_OFF,
        discount_pct=20, scope=PromotionScope.ORDER, is_exclusive=True,
    ))
    other = await svc.create_promotion(db, store_id=store_a.id, req=PromotionCreate(
        name="Other", type=PromotionType.PERCENT_OFF,
        discount_pct=5, scope=PromotionScope.ORDER,
    ))

    resp = await client.post(
        "/api/v1/orders",
        json={
            "idempotency_key": uid(),
            "channel": "DINE_IN",
            "items": [{"product_id": product.id, "quantity": 1}],
            "promotion_ids": [exclusive.id, other.id],
        },
        headers=_h(token),
    )
    assert resp.status_code == 422
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
cd api
uv run pytest tests/test_promotions_api.py::test_order_with_promotion_applies_discount -v
```

Expected: `422` or `TypeError` — `promotion_ids` is not a recognised field on `CreateOrderRequest`.

- [ ] **Step 3: Add `promotion_ids` to `CreateOrderRequest` in `api/app/schemas/orders.py`**

In `CreateOrderRequest`, add after `redeem_reward`:

```python
promotion_ids: list[str] = Field(default_factory=list)
```

- [ ] **Step 4: Add `apply_promotions` to `api/app/services/promotions.py`**

Append after the evaluator helpers:

```python
from fastapi import HTTPException


async def apply_promotions(
    db: AsyncSession,
    *,
    store_id: str,
    promotion_ids: list[str],
    cart_lines: list[dict],
) -> tuple[Decimal, list[tuple[str, Decimal]]]:
    """Validate and compute discounts for requested promotions.

    Called from inside create_order's transaction — does NOT start its own db.begin().
    Returns (total_discount, [(promotion_id, discount_amount), ...]).
    Raises HTTPException(422) on stacking violation or ineligible promotion.
    """
    promos_result = await db.execute(
        select(Promotion).where(
            Promotion.id.in_(promotion_ids),
            Promotion.store_id == store_id,
        )
    )
    promos = {p.id: p for p in promos_result.scalars().all()}

    for pid in promotion_ids:
        if pid not in promos:
            raise NotFound(f"Promotion {pid} not found")

    now = datetime.now(timezone.utc)
    today = now.date()
    current_time = now.time()
    current_weekday = now.weekday()

    applied: list[tuple[str, Decimal]] = []
    for pid in promotion_ids:
        promo = promos[pid]
        if not promo.is_active:
            raise HTTPException(status_code=422, detail=f"Promotion '{promo.name}' is not active")
        if promo.valid_from and today < promo.valid_from:
            raise HTTPException(status_code=422, detail=f"Promotion '{promo.name}' is not yet valid")
        if promo.valid_until and today > promo.valid_until:
            raise HTTPException(status_code=422, detail=f"Promotion '{promo.name}' has expired")
        if promo.type == PromotionType.HAPPY_HOUR:
            if promo.time_start is None or not (promo.time_start <= current_time < promo.time_end):
                raise HTTPException(status_code=422, detail=f"Promotion '{promo.name}' is outside its time window")
            if promo.days_of_week_json is not None and current_weekday not in promo.days_of_week_json:
                raise HTTPException(status_code=422, detail=f"Promotion '{promo.name}' does not run today")

        discount_amount = _compute_discount(promo, cart_lines)
        applied.append((pid, discount_amount))

    exclusive_ids = [pid for pid, _ in applied if promos[pid].is_exclusive]
    if exclusive_ids and len(applied) > 1:
        name = promos[exclusive_ids[0]].name
        raise HTTPException(
            status_code=422,
            detail=f"Promotion '{name}' is exclusive and cannot be combined with other promotions",
        )

    total_discount = sum((amt for _, amt in applied), Decimal("0"))
    return total_discount, applied
```

- [ ] **Step 5: Integrate promotions into `api/app/services/orders.py`**

**5a.** Add `"category_id"` to `line_data` inside the `create_order` item loop. Find the `line_data.append({...})` block (around line 65) and add:

```python
"category_id": product.category_id,
```

**5b.** After the item loop ends and before the `Order(...)` constructor, add promotion computation:

```python
promotion_discount = Decimal("0")
applied_promotions: list[tuple[str, Decimal]] = []
if req.promotion_ids:
    from app.services.promotions import apply_promotions
    promo_cart_lines = [
        {
            "product_id": ld["product_id"],
            "category_id": ld["category_id"],
            "quantity": ld["quantity"],
            "line_total": ld["line_total"],
        }
        for ld in line_data
    ]
    promotion_discount, applied_promotions = await apply_promotions(
        db,
        store_id=store_id,
        promotion_ids=req.promotion_ids,
        cart_lines=promo_cart_lines,
    )
```

**5c.** Update the `Order(...)` constructor — change `total=grand_total` to:

```python
order = Order(
    store_id=store_id,
    status=OrderStatus.PENDING,
    channel=req.channel,
    idempotency_key=req.idempotency_key,
    customer_id=req.customer_id,
    customer_note=req.customer_note,
    subtotal=grand_total,
    discount=promotion_discount,
    total=grand_total - promotion_discount,
    created_by_id=user_id,
)
```

**5d.** After the inventory deduction loop and before the membership block, write redemption rows:

```python
from app.models.promotions import PromotionRedemption

for promo_id, disc_amount in applied_promotions:
    db.add(PromotionRedemption(
        promotion_id=promo_id,
        order_id=order.id,
        discount_amount=disc_amount,
    ))
```

**5e.** Check `api/app/services/membership.py` — find `_redeem_reward` and verify it does `order.discount += reward_amount` (additive) rather than `order.discount = reward_amount` (overwrite). If it uses `=`, change it to `+=` and update `order.total = order.subtotal - order.discount` accordingly. This ensures promotion discount and membership reward stack correctly.

- [ ] **Step 6: Run checkout tests — confirm they pass**

```bash
cd api
uv run pytest tests/test_promotions_api.py::test_order_with_promotion_applies_discount tests/test_promotions_api.py::test_order_exclusive_stacking_returns_422 -v
```

Expected: 2 passed.

- [ ] **Step 7: Run full test suite**

```bash
cd api
uv run pytest -v
```

Expected: all tests pass. If any pre-existing failures appear, confirm they existed before this task by checking `git stash && uv run pytest` — pre-existing failures are not your responsibility.

- [ ] **Step 8: Commit**

```bash
git add api/app/schemas/orders.py api/app/services/orders.py api/app/services/promotions.py api/tests/test_promotions_api.py
git commit -m "feat: apply promotions at checkout with stacking validation"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|-----------------|------|
| 4 promotion types | Task 1 (enums), Task 2 (CRUD) |
| CRUD endpoints (manager/owner only) | Task 2 |
| Evaluate endpoint (any store user) | Task 3 |
| PERCENT_OFF scope logic (ORDER/CATEGORY/PRODUCT) | Task 3 |
| COMBO_BUNDLE eligibility | Task 3 |
| COMBO_QUANTITY eligibility | Task 3 |
| HAPPY_HOUR time + day + date-range check | Task 3 |
| `promotion_ids` on `CreateOrderRequest` | Task 4 |
| `apply_promotions` validates + computes | Task 4 |
| Stacking: exclusive promotion blocks others (422) | Task 4 |
| `PromotionRedemption` written per applied promo | Task 4 |
| `order.discount` set; membership stacks additively | Task 4 Step 5e |
| Role gate: barista cannot CRUD, can evaluate | Task 2 + Task 3 |

All requirements covered. No placeholders or TBDs.
