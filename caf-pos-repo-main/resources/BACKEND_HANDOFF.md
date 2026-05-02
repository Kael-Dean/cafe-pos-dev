# Backend Handoff — Cafe POS (Python / FastAPI)

> **For:** Backend engineer joining the project
> **Stack:** Python 3.12 · FastAPI · SQLAlchemy 2.x async · PostgreSQL · Railway
> **Last updated:** 2026-04-30
> **Estimated read time:** ~30 minutes — please read end-to-end before writing code

Welcome. This document is your single source of truth for the backend. It covers:

1. What the project is
2. What exists today vs. what you need to build
3. The recommended build order
4. A full REST contract for the **Inventory module** — your first task, because the UI is already built
5. Conventions to follow
6. Decisions that are locked (don't re-litigate)
7. Local setup

If something is unclear, ask before guessing. The prototype encodes many product decisions you might miss.

---

## 1. Project overview

**Cafe POS** is a point-of-sale system for Thai coffee shops. Multi-tenant from day one (launching with one store: **Sukhumvit 49**). Online-only MVP. PIN-based cashier login.

| Layer | Tech | Notes |
|---|---|---|
| Backend (your work) | **Python 3.12 + FastAPI** | Async, served by Uvicorn |
| ORM | **SQLAlchemy 2.x async + asyncpg** | New-style 2.0 API (`select()`, `Mapped[...]`) |
| Migrations | **Alembic** | Async-aware; one head per env |
| Database | **PostgreSQL on Railway** | One DB per environment (dev / prod). pgAdmin for ops |
| Auth | **JWT bearer (stateless)** | `python-jose` + `passlib[bcrypt]`. PIN-based |
| Validation | **Pydantic v2** | Same models for request bodies and responses |
| Realtime (KDS) | **Pusher Channels** server SDK (`pusher` pip pkg) | Free tier, 200k msg/day |
| Tests | **pytest + httpx + pytest-asyncio** | Async test client, factory_boy for fixtures |
| Hosting | **Railway** (single service) | Builds from `Dockerfile` or Nixpacks |
| Frontend | Not your concern | Reference UI at [`prototype/`](prototype/) — open `Cafe POS Prototype.html` in a browser |

> **You will not write any frontend code.** The frontend is a separate Next.js codebase ([`app/`](app/)) maintained by another engineer. Your contract with them is the OpenAPI schema FastAPI generates at `/docs`.

### Reference docs (read in this order)

1. [`DECISIONS.md`](DECISIONS.md) — every architectural decision and *why*. **Note:** the auth/realtime/storage choices in D1 still apply, but the Next.js/Prisma references in earlier sections are stale. The current backend stack is Python/FastAPI as documented in this file.
2. [`POS_BUILD_PROMPT.md`](POS_BUILD_PROMPT.md) — full functional spec
3. [`POS_DESIGN_BRIEF.md`](POS_DESIGN_BRIEF.md) — UX expectations per screen
4. [`prototype/`](prototype/) — clickable reference UI
5. [`prototype/data.js`](prototype/data.js) — sample data shapes you'll need to produce

---

## 2. What exists today

### Useful as reference

- **Frontend prototype** ([`prototype/`](prototype/)) — fully working clickable UI. **Open `prototype/Cafe POS Prototype.html` in a browser, click around, and click "Inventory" in the sidebar.** That's the contract your inventory APIs need to satisfy.
- **Domain decisions** ([`DECISIONS.md`](DECISIONS.md)) — multi-tenant model, payment flow, VAT handling, etc.

### Stale — ignore unless told otherwise

- [`app/`](app/) folder — a Next.js scaffold from a prior plan that used tRPC + Prisma. The FE engineer will refit it to call your REST API. **You don't need to touch it.**
- [`app/prisma/schema.prisma`](app/prisma/schema.prisma) — was going to be the canonical schema; now it's just inspiration. Design your SQLAlchemy models fresh. The domain shape (Tenant → Store → Users / Products / Inventory / Orders) is still correct, but field names, types, and constraints are yours to choose idiomatically.
- [`app/prisma/seed.ts`](app/prisma/seed.ts) — TypeScript seed. You'll write a Python equivalent (`scripts/seed.py`).

### Not built — your scope

Everything else: the FastAPI app itself, models, migrations, auth, every endpoint, services, tests, deployment config.

---

## 3. Recommended build order

Each step unblocks the next. Don't skip ahead.

| Step | Module | Why this order |
|---|---|---|
| 1 | **Project skeleton + auth + JWT middleware** | Every other route depends on `current_user` and `store_id` |
| 2 | **Inventory module** ⭐ | Self-contained, UI is ready, good first end-to-end win |
| 3 | Product / Category CRUD + BOM (Recipe) | Needed to display the POS menu |
| 4 | Order creation + atomic stock deduction | Critical path, most complex business logic |
| 5 | KDS realtime via Pusher | After orders work |
| 6 | Dashboard / Reports (read-side aggregations) | |
| 7 | Customer CRM | |
| 8 | *(Phase 2)* Multi-store transfers, LINE OA, EDC integrations | Deferred |

---

## 4. Domain model — design fresh

You're designing the schema from scratch. Here's the domain shape — translate to SQLAlchemy 2.x `Mapped[...]` models. Use UUIDs (or short cuid-like strings via `python-cuid2`) for PKs. All `created_at`/`updated_at` columns server-default to `NOW()`.

### Aggregates

```
Tenant ─┬─ Store ─┬─ User           (PIN auth, role: OWNER | MANAGER | BARISTA | BAKER)
        │         ├─ Category ─── Product ─┬─ ProductModifierGroup ─── ModifierGroup ─── Modifier
        │         │                        └─ RecipeItem ─── InventoryItem
        │         ├─ InventoryItem ─── StockMovement
        │         ├─ Customer ─── (referenced by Order)
        │         └─ Order ─── OrderItem (modifiers stored as JSONB snapshot)
        │                  └─ OrderVoidLog
        └─ User (admin-level user without a single store)
```

### Critical fields and types

| Concept | Important fields | Type / constraint |
|---|---|---|
| `Store` | `tenant_id`, `name`, `slug`, `vat_enabled`, `vat_rate` | `(tenant_id, slug)` unique |
| `User` | `tenant_id`, `store_id NULLABLE`, `pin_hash`, `role`, `is_active` | `pin_hash` is bcrypt of 4–6 digit PIN |
| `InventoryItem` | `store_id`, `name`, `unit`, `cost_per_unit Numeric(10,4)`, `stock_on_hand Numeric(12,3)`, `par_level Numeric(12,3)` | `(store_id, name)` unique |
| `RecipeItem` | `product_id`, `inventory_item_id`, `quantity Numeric(10,3)` | `(product_id, inventory_item_id)` unique |
| `StockMovement` | `store_id`, `inventory_item_id`, `type`, `quantity Numeric(12,3)` (always positive — sign inferred from type), `reason TEXT NULLABLE`, `ref_order_id NULLABLE`, `created_by_id`, `created_at` | append-only |
| `Order` | `store_id`, `order_number`, `status`, `channel`, `subtotal/discount/tax/total Numeric(12,2)`, `payment_method`, `payment_ref`, `idempotency_key` | `(store_id, idempotency_key)` unique |
| `OrderItem` | `order_id`, `product_id`, `product_name SNAPSHOT`, `quantity INT`, `unit_price`, `modifiers JSONB`, `line_total` | preserve historic accuracy via snapshot |

### Enums (Postgres `ENUM` types via SQLAlchemy `Enum`)

```python
class Role(str, enum.Enum):
    OWNER = "OWNER"; MANAGER = "MANAGER"; BARISTA = "BARISTA"; BAKER = "BAKER"

class MovementType(str, enum.Enum):
    RECEIVE = "RECEIVE"          # purchase received
    SALE = "SALE"                # deducted by an order
    WASTE = "WASTE"              # spoilage / loss
    ADJUST = "ADJUST"            # audit correction
    TRANSFER_IN = "TRANSFER_IN"
    TRANSFER_OUT = "TRANSFER_OUT"

class WastageReason(str, enum.Enum):
    EXPIRED = "EXPIRED"; SPILLED = "SPILLED"; TRIAL = "TRIAL"
    DAMAGED = "DAMAGED"; OTHER = "OTHER"

class OrderStatus(str, enum.Enum):
    PENDING = "PENDING"; PAID = "PAID"; IN_PROGRESS = "IN_PROGRESS"
    READY = "READY"; COMPLETED = "COMPLETED"; VOID = "VOID"

class Channel(str, enum.Enum):
    DINE_IN = "DINE_IN"; TAKEAWAY = "TAKEAWAY"; DELIVERY = "DELIVERY"

class PaymentMethod(str, enum.Enum):
    CASH = "CASH"; CARD = "CARD"; QR_PROMPTPAY = "QR_PROMPTPAY"
    LINE_PAY = "LINE_PAY"; TRUEMONEY = "TRUEMONEY"; OTHER = "OTHER"
```

### Conceptual rule: `stock_on_hand` is derived but persisted

The source of truth for stock is the sum of `StockMovement.quantity` (signed by `type`). We persist `stock_on_hand` on `InventoryItem` for query speed. **Every mutation must keep them in sync within one transaction.** A nightly verification job (Phase 2) will reconcile.

---

## 5. Inventory module — full REST contract ⭐

**This is your first task.** The frontend prototype already implements this UI in-memory ([`prototype/screens/inventory.jsx`](prototype/screens/inventory.jsx)). Your job is to make the same UI work against the database.

### 5.1 Endpoints

All paths prefixed `/api/v1`. All require a valid JWT in `Authorization: Bearer <token>`. Tenant/store scope is read from the JWT — **never** trust a `store_id` in the request body or query string.

| Method | Path | Role | Purpose |
|---|---|---|---|
| `GET` | `/inventory` | any | List items in current store |
| `GET` | `/inventory/{item_id}` | any | Get one item with status |
| `PATCH` | `/inventory/{item_id}` | manager+ | Edit `par_level` and/or `cost_per_unit` |
| `POST` | `/inventory/receive` | barista+ | Add stock (RECEIVE movement) |
| `POST` | `/inventory/waste` | barista+ | Reduce stock (WASTE movement) |
| `POST` | `/inventory/adjust` | manager+ | Audit correction (ADJUST movement) |
| `GET` | `/inventory/movements` | any | Paginated movement log |
| `GET` | `/inventory/low-stock` | any | Items below par for dashboard |

### 5.2 Pydantic schemas

```python
# app/schemas/inventory.py
from decimal import Decimal
from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel, Field

class InventoryItemBase(BaseModel):
    id: str
    name: str
    unit: str
    cost_per_unit: Decimal
    stock_on_hand: Decimal
    par_level: Decimal
    is_active: bool

class InventoryItemRead(InventoryItemBase):
    status: Literal["ok", "low", "critical"]
    # status logic:
    #   stock_on_hand < par_level * Decimal("0.5") → "critical"
    #   stock_on_hand < par_level                  → "low"
    #   else                                       → "ok"

class InventoryItemUpdate(BaseModel):
    par_level:    Optional[Decimal] = Field(None, ge=0, le=Decimal("9_999_999.999"))
    cost_per_unit: Optional[Decimal] = Field(None, ge=0, le=Decimal("99_999.9999"))

class ReceiveStockRequest(BaseModel):
    item_id: str
    qty: Decimal = Field(gt=0, le=Decimal("999_999.999"))
    cost_per_unit: Decimal = Field(ge=0, le=Decimal("99_999.9999"))
    supplier: Optional[str] = Field(None, max_length=120)
    note: Optional[str] = Field(None, max_length=500)

class WasteRequest(BaseModel):
    item_id: str
    qty: Decimal = Field(gt=0, le=Decimal("999_999.999"))
    reason: WastageReason          # enum from §4
    note: Optional[str] = Field(None, max_length=500)

class AdjustRequest(BaseModel):
    item_id: str
    delta: Decimal                 # signed — positive adds, negative deducts
    reason: str = Field(min_length=3, max_length=500)   # required for audit

class StockMovementRead(BaseModel):
    id: str
    type: MovementType
    inventory_item_id: str
    quantity: Decimal
    reason: Optional[str]
    ref_order_id: Optional[str]
    created_by: dict       # {"id": str, "name": str}
    created_at: datetime

class MovementsPage(BaseModel):
    items: list[StockMovementRead]
    next_cursor: Optional[str]
```

### 5.3 Storing the wastage reason

`StockMovement.reason` is a single `TEXT` column. Encode the structured wastage reason as `"<CODE>|<note>"`, e.g. `"EXPIRED|opened jug overnight"`. Parse on read to populate `WastageReason` and `note` for the response.

> **Alternative considered:** add a separate `reason_code` enum column. **Decision:** keep flexibility for now (some movement types like `RECEIVE` and `ADJUST` use free-text reason); revisit when we add a wastage analytics dashboard.

### 5.4 Atomicity rules (non-negotiable)

Every mutation must run inside a single transaction. With async SQLAlchemy:

```python
async def receive_stock(db: AsyncSession, store_id: str, user_id: str, req: ReceiveStockRequest):
    async with db.begin():
        item = await _load_item_for_update(db, req.item_id, store_id)
        item.stock_on_hand += req.qty
        item.cost_per_unit = req.cost_per_unit  # latest-cost-wins (see §5.6)
        movement = StockMovement(
            store_id=store_id,
            inventory_item_id=item.id,
            type=MovementType.RECEIVE,
            quantity=req.qty,
            reason=_encode_receive_reason(req.supplier, req.note),
            created_by_id=user_id,
        )
        db.add(movement)
    return item, movement
```

`async with db.begin():` opens a transaction and commits on exit (rolls back on exception). Either both writes land or neither does.

### 5.5 Tenant isolation

A FastAPI dependency that returns the current user (parsed from JWT). Every query must filter by `store_id = current_user.store_id`:

```python
# app/deps.py
async def get_current_user(token: str = Depends(oauth2_scheme), db: AsyncSession = Depends(get_db)) -> User:
    payload = decode_jwt(token)            # raises 401 on invalid
    user = await db.get(User, payload["sub"])
    if not user or not user.is_active:
        raise HTTPException(401, "Invalid session")
    return user

def require_role(*roles: Role):
    async def _checker(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(403, "Insufficient role")
        return user
    return _checker

# usage in route:
@router.post("/inventory/receive", response_model=InventoryItemRead)
async def receive(
    req: ReceiveStockRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await inventory_service.receive_stock(db, user.store_id, user.id, req)
```

If a user from store A passes an item id from store B, the service-layer query (filtered by `user.store_id`) returns no row → return `404 NOT_FOUND`. Don't leak existence with `403`.

### 5.6 Business rules

1. **Negative stock allowed.** Real-world: receipts are sometimes recorded after sales. Don't block; log a warning.
2. **Latest-cost-wins on receive.** `cost_per_unit` is overwritten on every `RECEIVE`. (Phase 2 may switch to weighted-average — keep the rule simple now.)
3. **Append-only audit.** Never `UPDATE` or `DELETE` a `StockMovement`. Errors are corrected via a compensating `ADJUST`.
4. **`SALE` movements are created by the Order module** (step 4 in build order), not here. But `GET /inventory/movements` returns *all* types.
5. **Inactive items reject mutations.** A receive/waste/adjust against `is_active=False` returns `409 CONFLICT`.

### 5.7 Edge cases

| Case | Behavior |
|---|---|
| `qty <= 0` on receive/waste | `422 UNPROCESSABLE_ENTITY` (Pydantic catches it via `Field(gt=0)`) |
| Wastage on item with `stock_on_hand = 0` | Allow; stock goes negative; `logger.warning(...)` |
| Cross-store access (item belongs to store B, user from store A) | `404 NOT_FOUND` (do not reveal) |
| Two users edit `par_level` concurrently | Last-write-wins. No optimistic locking. |
| `cost_per_unit` more than 4 decimal places | Pydantic accepts; truncate at DB level via `Numeric(10, 4)` |
| Receive on inactive item | `409 CONFLICT` with message `"Item is not active"` |
| Idempotent retry of POST | Not required for inventory mutations; add `Idempotency-Key` header support if it bites in practice |

### 5.8 Acceptance criteria (write these as pytest tests)

```python
# tests/test_inventory_service.py
async def test_receive_increments_stock_and_creates_movement(db, store_a):
    item = await factory.inventory_item(db, store_a, stock=100, cost=Decimal("0.50"))
    result = await inventory_service.receive_stock(db, store_a.id, user.id,
        ReceiveStockRequest(item_id=item.id, qty=Decimal("50"), cost_per_unit=Decimal("0.55")))
    assert item.stock_on_hand == Decimal("150")
    assert item.cost_per_unit == Decimal("0.55")
    movements = await db.scalars(select(StockMovement).where(...))
    assert any(m.type == MovementType.RECEIVE and m.quantity == 50 for m in movements)

async def test_record_waste_allows_negative_stock(db, store_a, caplog):
    item = await factory.inventory_item(db, store_a, stock=10)
    await inventory_service.record_waste(db, store_a.id, user.id,
        WasteRequest(item_id=item.id, qty=Decimal("15"), reason=WastageReason.EXPIRED))
    assert item.stock_on_hand == Decimal("-5")
    assert any("negative" in r.message for r in caplog.records)

async def test_cross_store_isolation_returns_404(client, user_a_token, item_b):
    response = await client.get(f"/api/v1/inventory/{item_b.id}",
                                 headers={"Authorization": f"Bearer {user_a_token}"})
    assert response.status_code == 404

async def test_low_stock_query(db, store_a):
    a = await factory.inventory_item(db, store_a, stock=400,  par=1500)   # critical
    b = await factory.inventory_item(db, store_a, stock=2100, par=4000)   # low
    c = await factory.inventory_item(db, store_a, stock=8000, par=6000)   # ok
    result = await inventory_service.low_stock(db, store_a.id)
    assert {x.id for x in result} == {a.id, b.id}

async def test_atomicity_rollback_on_constraint_violation(db, store_a, monkeypatch):
    # patch StockMovement to raise on flush, ensure stock_on_hand unchanged
    ...
```

### 5.9 How the frontend consumes this

The prototype's in-memory state in [`prototype/data.js`](prototype/data.js) maps directly to your responses:

| Prototype field | Your API response field |
|---|---|
| `m.type` | `type` |
| `m.invId` | `inventory_item_id` |
| `m.qty` | `quantity` |
| `m.reason` (`'EXPIRED'`, etc.) | derived from `reason` (parse `<CODE>|<note>` prefix) |
| `m.user` (display name) | `created_by.name` |
| `m.at` (epoch ms) | `created_at` (ISO 8601 from FastAPI) |
| `m.supplier`, `m.note` | encoded inside `reason` for `RECEIVE` movements |

The FE engineer will replace prototype's `useState` with `useQuery` calls against your endpoints. You agree on field names through the OpenAPI schema FastAPI auto-generates at `/docs`.

---

## 6. Other modules — high-level signatures

Not full contracts — read [`POS_BUILD_PROMPT.md`](POS_BUILD_PROMPT.md) when you reach each step.

### Auth
```
POST /api/v1/auth/login        → {pin}        → {access_token, token_type: "bearer"}
POST /api/v1/auth/refresh      → {refresh_token} → {access_token}
GET  /api/v1/auth/me           → User
POST /api/v1/auth/logout       → revoke (insert into denylist if you implement one)
```
- Rate-limit `login` to **5 attempts per IP per minute**. Use [`slowapi`](https://github.com/laurentS/slowapi) or a small in-memory limiter (Redis on Railway is overkill for MVP).
- **Never log the PIN.** Hash it with `bcrypt` (cost factor 12).
- JWT payload: `{sub, store_id, role, exp, iat}`. Sign with `HS256`. Access tokens: 8 hours. Refresh tokens: 30 days.

### Products / Catalog
```
GET    /api/v1/categories
GET    /api/v1/products?category_id=&is_active=&search=
GET    /api/v1/products/{id}                 # includes modifiers + recipe
POST   /api/v1/products                      # manager+
PATCH  /api/v1/products/{id}
DELETE /api/v1/products/{id}                 # soft delete (is_active=False)
PUT    /api/v1/products/{id}/recipe          # bulk replace RecipeItem list
```

### Orders (most complex module)
```
POST   /api/v1/orders                        # creates Order + OrderItems + SALE movements atomically
PATCH  /api/v1/orders/{id}/pay
PATCH  /api/v1/orders/{id}/status            # PENDING → PAID → IN_PROGRESS → READY → COMPLETED
POST   /api/v1/orders/{id}/void              # manager+; reverses inventory
GET    /api/v1/orders?from=&to=&status=&channel=
```
- `POST /orders` body must include `Idempotency-Key` header (or `idempotency_key` field). Frontend generates a UUID per order; reject duplicates with `409`.
- BOM deduction = Σ (`RecipeItem.quantity` × `OrderItem.quantity`) + per-modifier adjustments (a `Modifier` may carry `inventory_item_id` + `inventory_qty`).
- After commit, publish a Pusher event on channel `kds-store-{store_id}` so the KDS screen sees the new ticket in real time.

### Customers / Dashboard / Reports

See [`POS_BUILD_PROMPT.md`](POS_BUILD_PROMPT.md). Build last; mostly read-side aggregations.

---

## 7. Locked decisions — don't re-litigate

| # | Decision | Rationale |
|---|---|---|
| D1 | **Vercel (FE) + Railway (BE + DB)** | [`DECISIONS.md`](DECISIONS.md). Drop Supabase; auth/realtime/storage all custom |
| D4–D5 | **Manual payment confirmation** in MVP | No EDC API, no PromptPay webhook in v1 |
| D7 | **Multi-tenant from row 1**, single store launch | `store_id` on every domain table |
| D8 | **Online-only** (no offline queue) | No IndexedDB, no conflict resolution |
| D9 | **VAT schema-ready, disabled by default** | `Store.vat_enabled = False` until registered |
| — | **PIN auth (4–6 digits, bcrypt)** | Not email/OAuth — cashier flow |
| — | **JWT bearer (stateless)**, not cookie sessions | Simpler horizontal scaling, FE stores in memory or httpOnly cookie at the edge |
| — | **Pusher Channels** for KDS | Not Socket.IO / SSE |
| — | **Decimal precision:** money 2dp · inventory 3dp · cost 4dp | Match these in `Numeric(p, s)` declarations |
| — | **`store_id` from JWT, never from request payload** | Tenant safety |
| — | **REST + OpenAPI**, not RPC/GraphQL | FastAPI's natural fit |

---

## 8. Local setup (≈10 minutes)

```bash
# 1. Install Python 3.12 and uv (fast package manager)
curl -LsSf https://astral.sh/uv/install.sh | sh

# 2. Set up local Postgres (Docker is easiest)
docker run -d --name cafe-pos-pg -e POSTGRES_PASSWORD=pos -p 5432:5432 postgres:16

# 3. Project bootstrap (do this once when scaffolding)
mkdir -p api && cd api
uv init
uv add fastapi "uvicorn[standard]" "sqlalchemy[asyncio]" asyncpg alembic \
       "pydantic[email]" pydantic-settings python-jose[cryptography] \
       "passlib[bcrypt]" python-multipart pusher python-cuid2 slowapi
uv add --dev pytest pytest-asyncio httpx factory-boy ruff mypy

# 4. Configure env
cp .env.example .env
# Edit:
#   DATABASE_URL=postgresql+asyncpg://postgres:pos@localhost:5432/cafe_pos
#   JWT_SECRET=$(openssl rand -hex 32)
#   PUSHER_APP_ID=...
#   PUSHER_KEY=...
#   PUSHER_SECRET=...
#   PUSHER_CLUSTER=ap1

# 5. Run migrations and seed
alembic upgrade head
python scripts/seed.py

# 6. Run dev server
uvicorn app.main:app --reload --port 8000
# OpenAPI docs: http://localhost:8000/docs
```

Default seed PINs: owner `1234`, manager `1234`, baristas `1111` / `2222` / `3333`.

To inspect data: connect pgAdmin to `localhost:5432`, db `cafe_pos`, user `postgres`, password `pos`.

To run the **frontend prototype** (reference UI): open `prototype/Cafe POS Prototype.html` directly, or `cd prototype && python -m http.server 8765`. Click sidebar → **Inventory** to see the UI you're powering.

### Railway deployment

- One service from this repo, root `api/`
- Add a Postgres plugin (separate service, same project)
- Set env vars (especially `DATABASE_URL` from the plugin, `JWT_SECRET`, Pusher creds)
- `Procfile` or `railway.toml`: `web: uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Run migrations on deploy via a release command: `alembic upgrade head`

---

## 9. Conventions

### 9.1 File layout

```
api/
├── pyproject.toml
├── alembic.ini
├── alembic/
│   ├── env.py                    # async-aware (use AsyncEngine)
│   └── versions/
├── scripts/
│   └── seed.py                   # idempotent: 1 store, 5 users, 16 products, 22 inventory items
├── app/
│   ├── main.py                   # FastAPI() + middleware + router include
│   ├── config.py                 # pydantic-settings BaseSettings
│   ├── deps.py                   # get_db, get_current_user, require_role
│   ├── core/
│   │   ├── security.py           # bcrypt, JWT encode/decode
│   │   └── errors.py             # custom HTTPException subclasses
│   ├── db/
│   │   ├── base.py               # DeclarativeBase
│   │   └── session.py            # async_engine, async_session_maker
│   ├── models/                   # SQLAlchemy 2.x Mapped[...] models
│   │   ├── __init__.py
│   │   ├── tenancy.py
│   │   ├── identity.py
│   │   ├── catalog.py
│   │   ├── inventory.py
│   │   ├── orders.py
│   │   └── customers.py
│   ├── schemas/                  # Pydantic v2 request/response models
│   │   ├── inventory.py
│   │   └── ...
│   ├── services/                 # business logic, no FastAPI imports
│   │   ├── inventory.py
│   │   ├── orders.py
│   │   └── ...
│   ├── api/
│   │   └── v1/
│   │       ├── router.py         # APIRouter() that includes all sub-routers
│   │       ├── auth.py
│   │       ├── inventory.py
│   │       ├── products.py
│   │       └── orders.py
│   └── realtime/
│       └── pusher.py             # publish events
└── tests/
    ├── conftest.py               # pytest-asyncio, db fixture, factory fixtures
    ├── factories.py              # factory_boy
    ├── test_auth.py
    └── test_inventory_service.py
```

> **Rule:** routers are thin. They handle Pydantic validation, auth, dependency injection, and call into a service. **Services contain the business logic and are pure (no FastAPI imports).** That makes them straightforward to unit-test without spinning up the HTTP layer.

### 9.2 Error handling

```python
from fastapi import HTTPException, status

raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Inventory item not found")
raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Invalid session")
raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Manager role required")
raise HTTPException(status.HTTP_409_CONFLICT, detail="Idempotency key already used")
raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Quantity must be positive")
```

For richer errors, define small subclasses in `app/core/errors.py`. Use a global exception handler in `main.py` to log + return a consistent error envelope:

```json
{ "error": { "code": "NOT_FOUND", "message": "Inventory item not found", "request_id": "..." } }
```

### 9.3 Logging

Use the stdlib `logging` module. Configure JSON output in `main.py` using `python-json-logger` (one-line dep) so Railway log search works.

```python
logger.warning("inventory.record_waste: stock will go negative",
               extra={"item_id": item.id, "current_stock": float(item.stock_on_hand), "qty": float(req.qty)})
```

### 9.4 Async database patterns

- **One session per request.** Wire it through a FastAPI dependency, not a global.
- **Always use `async with db.begin():` for mutations.** It commits on exit, rolls back on exception.
- For read-only queries, you don't need an explicit transaction.
- **Never mix sync and async drivers.** Always `postgresql+asyncpg://` in `DATABASE_URL`. Alembic env must use the async engine variant.

### 9.5 Testing

- **`pytest-asyncio`** in auto mode. Tests are `async def`.
- **Service tests** spin up a transactional fixture: open a transaction, run the test, roll back. No data leaks between tests.
- **Endpoint tests** use `httpx.AsyncClient(app=app, base_url="http://test")` against the FastAPI app directly (no real network).
- **Aim for 80%+ coverage on services**, plus one happy-path endpoint test per module.
- **Don't write 1:1 tests for routers** — they're thin glue. Cover behavior, not lines.

### 9.6 Migration discipline

- Every schema change → `alembic revision --autogenerate -m "add_par_level_to_inventory"`
- **Review the generated SQL** before committing. Autogenerate misses a lot (renames, enum changes, server defaults).
- Commit migrations to git in `alembic/versions/`.
- Never edit a committed migration. Create a new one.
- Production deploys run `alembic upgrade head` as a Railway release command.

### 9.7 OpenAPI hygiene

FastAPI auto-generates `/docs` and `/openapi.json`. Make them useful:

- Always pass `response_model=...` on routes.
- Use `tags=["inventory"]` to group routes in Swagger UI.
- Add docstrings on routes — they show up as the description.
- Use `summary="..."` for the short title.
- Set `operation_id` explicitly so the FE's generated client gets stable function names: `operation_id="inventory_receive"`.

---

## 10. Open questions — flag, don't decide alone

Bring these to the team rather than picking unilaterally:

1. **Multi-currency?** Currently THB only. Do we need a `Store.currency` column?
2. **Audit log retention.** `StockMovement` and `Order` will grow forever. Archive at 1 year, 2 years, never?
3. **Wastage reason — encoded string vs. dedicated column?** Current spec encodes as `"<CODE>|<note>"` in `reason`. Splitting into `reason_code` + `reason_note` is ~10 minutes and yields cleaner queries; do it now or later?
4. **Cost on receive — latest-wins vs. weighted-average?** Spec says latest-wins. Owners may want WAC for accurate margin reports.
5. **Refresh token strategy.** Stateless JWT refresh? Or persisted refresh tokens with revocation? Affects logout semantics.
6. **Per-endpoint rate limits beyond login.** Do we need `POST /orders` rate-limited per user (e.g. 60/min)?
7. **Soft delete vs. hard delete.** Spec leans soft (`is_active=False`). Are there tables where hard delete is OK?

---

## 11. First-week checklist

A concrete sequence to confirm you're set up right:

- [ ] **Day 1:** Project scaffold, Postgres running locally, `alembic upgrade head` succeeds on an empty schema, `/docs` reachable on `localhost:8000`.
- [ ] **Day 2:** Auth endpoints (`/auth/login`, `/auth/me`). Bcrypt PIN works. JWT round-trips. Tests for both green.
- [ ] **Day 3:** SQLAlchemy models for `Tenant`, `Store`, `User`, `InventoryItem`, `StockMovement`. First Alembic migration committed. `seed.py` works.
- [ ] **Day 4:** `GET /inventory` returns seeded items, filtered by store. Tenant isolation test green.
- [ ] **Day 5:** `POST /inventory/receive` and `POST /inventory/waste` with full atomic semantics. All acceptance tests in §5.8 green.
- [ ] **Day 6–7:** Move on to products / categories / recipe.

If Day 5 takes longer, that's fine — better solid than fast.

---

## Welcome aboard 🤝

The frontend prototype is at [`prototype/`](prototype/) — open it and play with the Inventory screen before writing a line of code. The decisions doc is at [`DECISIONS.md`](DECISIONS.md). Ping the team for anything unclear; the prototype encodes opinions, not all of them obvious from code alone.

Good luck — and may your transactions always commit.
