# Route Priorities — Cafe POS Backend

> **Source:** [resources/BACKEND_HANDOFF.md](../resources/BACKEND_HANDOFF.md)
> **Purpose:** Single reference list of every route the backend must ship to fully complete the handoff. Ordered by build tier so future sessions can pick up where the last one stopped.
> **Last updated:** 2026-04-30 (Tier 7 complete — Customers CRM, 5 routes)

## How to read this doc

Each route entry has:
- **Method + path** (all under `/api/v1`)
- **Role** — minimum role required (anyone authenticated unless noted)
- **Purpose** — one line of intent
- **Depends on** — what must exist before this route is buildable
- **Status** — `[ ]` not started · `[~]` in progress · `[x]` done

Tiers map directly to the handoff §3 build order. Don't skip tiers — each unblocks the next. The orders module (Tier 4) cannot be built until Tier 3 ships because order creation deducts inventory via the recipe (BOM) graph.

---

## Tier 0 — Cross-cutting (foundation, no routes)

Required before any tier ships:

- [x] FastAPI app skeleton (`app/main.py`, lifespan, CORS, JSON logging, exception envelope)
- [x] `pydantic-settings` config in `app/config.py`
- [x] Async SQLAlchemy session in `app/db/session.py`
- [x] Alembic async-aware `env.py` and initial migration
- [x] `GET /health` (liveness, no auth)
- [x] JWT helpers + `oauth2_scheme` in `app/core/security.py`
- [x] `get_current_user` and `require_role(...)` deps in `app/deps.py`
- [x] `slowapi` rate limiter wired
- [x] Pusher wrapper in `app/realtime/pusher.py` (no-op when creds missing)
- [x] `scripts/seed.py` idempotent
- [x] `Procfile` + `railway.toml` + Dockerfile (optional)

**Until this is in place, no route below is buildable.**

---

## Tier 1 — Auth ⭐ (build first)

Every other route depends on `current_user` + `store_id`. Rate-limit `login` to **5/min/IP**. Never log the PIN. JWT payload `{sub, store_id, role, exp, iat, type}`. HS256, access 8h, refresh 30d.

| # | Method | Path | Role | Purpose | Depends on | Status |
|---|---|---|---|---|---|---|
| 1.1 | `POST` | `/auth/login` | public | Exchange `{store_slug, pin}` for `{access_token, refresh_token, token_type}` | Tier 0 | [x] |
| 1.2 | `POST` | `/auth/refresh` | public | Exchange refresh token for a new access token | 1.1 | [x] |
| 1.3 | `GET`  | `/auth/me` | any | Returns current user `{id, name, role, store_id, store_name}` | 1.1 | [x] |
| 1.4 | `POST` | `/auth/logout` | any | Stateless 204 (denylist deferred — see open question #5) | 1.1 | [x] |

---

## Tier 2 — Inventory ⭐⭐ (first vertical slice — UI is ready)

Self-contained module. Frontend prototype already implements the screen ([`prototype/screens/inventory.jsx`](../resources/prototype/screens/inventory.jsx) — referenced in handoff, not yet present locally). Atomicity is non-negotiable: every mutation must run inside `async with db.begin():`. Cross-store access returns `404` (do not leak with `403`).

| # | Method | Path | Role | Purpose | Depends on | Status |
|---|---|---|---|---|---|---|
| 2.1 | `GET`   | `/inventory` | any | List items in current store (filter by `search`, `is_active`) | Tier 1 | [x] |
| 2.2 | `GET`   | `/inventory/{item_id}` | any | Get one item (with computed `status` field) | 2.1 | [x] |
| 2.3 | `PATCH` | `/inventory/{item_id}` | manager+ | Edit `par_level` and/or `cost_per_unit` (no movement created) | 2.1 | [x] |
| 2.4 | `POST`  | `/inventory/receive` | barista+ | Add stock — atomic: `+stock`, `cost_per_unit=req.cost`, append `RECEIVE` movement | 2.1 | [x] |
| 2.5 | `POST`  | `/inventory/waste` | barista+ | Reduce stock (allows negative; warn) — append `WASTE` movement with `<CODE>\|<note>` reason | 2.1 | [x] |
| 2.6 | `POST`  | `/inventory/adjust` | manager+ | Audit correction — signed `delta`, required reason text, append `ADJUST` movement | 2.1 | [x] |
| 2.7 | `GET`   | `/inventory/movements` | any | Paginated movement log (cursor-based; filter by `item_id`) | 2.4–2.6 | [x] |
| 2.8 | `GET`   | `/inventory/low-stock` | any | Items where `stock_on_hand < par_level` (for dashboard tile) | 2.1 | [x] |

**Acceptance tests** (pytest, all in `tests/test_inventory_service.py`):
1. Receive increments stock + creates movement
2. Waste allows negative stock + emits warning log
3. Cross-store access → 404
4. Low-stock query filters correctly by par
5. Atomicity rollback on constraint violation

---

## Tier 3 — Catalog (Categories + Products + Recipe)

Needed to display the POS menu and to compute order BOM deductions in Tier 4. Soft-delete pattern (`is_active=False`).

### 3a — Categories

| # | Method | Path | Role | Purpose | Depends on | Status |
|---|---|---|---|---|---|---|
| 3.1 | `GET`    | `/categories` | any | List categories for current store | Tier 1 | [x] |
| 3.2 | `POST`   | `/categories` | manager+ | Create category | 3.1 | [x] |
| 3.3 | `PATCH`  | `/categories/{id}` | manager+ | Rename / re-sort | 3.1 | [x] |
| 3.4 | `DELETE` | `/categories/{id}` | manager+ | Soft-delete (refuse if products still attached) | 3.1 | [x] |

> **Note:** §6 of the handoff lists only `GET /categories` explicitly. The CRUD set above is inferred from the prototype's category management UI; confirm with team if the FE engineer disagrees.

### 3b — Products

| # | Method | Path | Role | Purpose | Depends on | Status |
|---|---|---|---|---|---|---|
| 3.5 | `GET`    | `/products` | any | List products (filters: `category_id`, `is_active`, `search`) | 3.1 | [x] |
| 3.6 | `GET`    | `/products/{id}` | any | Single product with modifiers + recipe | 3.5 | [x] |
| 3.7 | `POST`   | `/products` | manager+ | Create product (with optional initial modifier groups) | 3.5 | [x] |
| 3.8 | `PATCH`  | `/products/{id}` | manager+ | Update product fields | 3.5 | [x] |
| 3.9 | `DELETE` | `/products/{id}` | manager+ | Soft delete (`is_active=False`) | 3.5 | [x] |

### 3c — Recipe (BOM)

`RecipeItem(product_id, inventory_item_id, quantity)` — drives stock deduction in Tier 4.

| # | Method | Path | Role | Purpose | Depends on | Status |
|---|---|---|---|---|---|---|
| 3.10 | `PUT` | `/products/{id}/recipe` | manager+ | Bulk replace `RecipeItem` list for a product | 3.6, Tier 2 | [x] |

### 3d — Modifiers (likely inferred)

The prototype's product detail screen (per handoff `prototype/data.js` reference) supports modifier groups. Likely route shape, to be confirmed when prototype data is reviewed:

| # | Method | Path | Role | Purpose | Depends on | Status |
|---|---|---|---|---|---|---|
| 3.11 | `GET`    | `/modifier-groups` | any | List modifier groups for current store | Tier 1 | [x] |
| 3.12 | `POST`   | `/modifier-groups` | manager+ | Create group + child modifiers | 3.11 | [x] |
| 3.13 | `PATCH`  | `/modifier-groups/{id}` | manager+ | Update group/modifier (incl. `inventory_item_id`, `inventory_qty` for stock-tracking modifiers) | 3.11 | [x] |
| 3.14 | `DELETE` | `/modifier-groups/{id}` | manager+ | Soft delete | 3.11 | [x] |
| 3.15 | `PUT`    | `/products/{id}/modifier-groups` | manager+ | Bulk attach/reorder groups on a product | 3.6, 3.11 | [x] |

> **Status:** "likely needed" — will be confirmed when [resources/prototype/data.js](../resources/prototype/) lands. Track as an open question for the FE engineer.

---

## Tier 4 — Orders (most complex — critical path)

Order creation is the linchpin: it creates `Order` + `OrderItem` rows, computes BOM totals, deducts inventory via `SALE` movements, all in one transaction. Must support `Idempotency-Key` (header or body field). After commit, publish a Pusher event on `kds-store-{store_id}`.

| # | Method | Path | Role | Purpose | Depends on | Status |
|---|---|---|---|---|---|---|
| 4.1 | `POST`  | `/orders` | barista+ | Create order — atomic: insert Order + OrderItems, deduct stock via `SALE` movements, snapshot product names + modifier JSON, validate idempotency key | Tiers 2 + 3 | [x] |
| 4.2 | `GET`   | `/orders` | any | List orders (filters: `from`, `to`, `status`, `channel`, `payment_method`, paginated) | 4.1 | [x] |
| 4.3 | `GET`   | `/orders/{id}` | any | Order detail incl. items + modifier snapshots | 4.1 | [x] |
| 4.4 | `PATCH` | `/orders/{id}/pay` | barista+ | Mark paid: set `payment_method`, `payment_ref`, transition `PENDING → PAID` | 4.1 | [x] |
| 4.5 | `PATCH` | `/orders/{id}/status` | barista+/baker+ | Transition `PAID → IN_PROGRESS → READY → COMPLETED` (KDS pipeline) | 4.1 | [x] |
| 4.6 | `POST`  | `/orders/{id}/void` | manager+ | Reverses inventory deductions, sets `status=VOID`, writes `OrderVoidLog` entry | 4.1 | [x] |

**Hard requirements:**
- `idempotency_key` unique per `(store_id, key)` — duplicate POST returns `409` with the original order
- BOM math: per-line stock deduction = `RecipeItem.quantity × OrderItem.quantity` + Σ (modifier `inventory_qty` × line qty) for any modifier with `inventory_item_id`
- All deduction movements must be `MovementType.SALE` and reference `ref_order_id`
- Status transitions guarded — invalid transitions return `409` (e.g. `COMPLETED → PENDING` not allowed)
- Void emits `TRANSFER_IN`-style reverse movements (or symmetrical `SALE` reversals — decide based on accounting preference; flag as open question)

---

## Tier 5 — KDS Realtime (Pusher)

Not new HTTP routes — but new server-emitted events. Documented here for completeness so the FE knows what channels to subscribe.

| # | Channel | Event | Trigger | Payload | Status |
|---|---|---|---|---|---|
| 5.1 | `kds-store-{store_id}` | `order.created` | After 4.1 commits | `{order_id, order_number, status, channel, items: [...]}` | [x] |
| 5.2 | `kds-store-{store_id}` | `order.status_changed` | After 4.5 commits | `{order_id, previous_status, status}` | [x] |
| 5.3 | `kds-store-{store_id}` | `order.voided` | After 4.6 commits | `{order_id, voided_by, reason}` | [x] |

Auth for Pusher private channels: a single endpoint to sign auth tokens.

| # | Method | Path | Role | Purpose | Depends on | Status |
|---|---|---|---|---|---|---|
| 5.4 | `POST` | `/realtime/auth` | any | Pusher private-channel auth signature endpoint | Tier 1, 4.1 | [x] |

---

## Tier 6 — Dashboard / Reports (read-side)

Aggregations only — no mutations. Heavy use of SQL `GROUP BY`. Should be cacheable. Exact shapes TBD against [resources/POS_BUILD_PROMPT.md](../resources/POS_BUILD_PROMPT.md) (not yet present locally).

| # | Method | Path | Role | Purpose | Depends on | Status |
|---|---|---|---|---|---|---|
| 6.1 | `GET` | `/dashboard/today` | any | Today's totals: revenue, order count, avg ticket, top items | Tier 4 | [x] |
| 6.2 | `GET` | `/reports/sales` | manager+ | Sales by date range, group by `day`/`hour`/`product`/`category`/`payment_method` | Tier 4 | [x] |
| 6.3 | `GET` | `/reports/inventory-cogs` | manager+ | COGS via `SALE` movements × cost snapshot | Tier 2 + 4 | [x] |
| 6.4 | `GET` | `/reports/wastage` | manager+ | Wastage breakdown by `WastageReason` over time | Tier 2 | [x] |
| 6.5 | `GET` | `/reports/low-stock` | manager+ | Items below par across selectable horizon | Tier 2 | [x] |
| 6.6 | `GET` | `/reports/cashier-shifts` | manager+ | Per-cashier order count / revenue / void count | Tier 4 | [x] |

> Each report should accept `from`, `to`, `granularity`. Inferred from typical POS dashboards; confirm against POS_BUILD_PROMPT when available.

---

## Tier 7 — Customers (CRM)

| # | Method | Path | Role | Purpose | Depends on | Status |
|---|---|---|---|---|---|---|
| 7.1 | `GET`    | `/customers` | any | List/search customers (filters: `phone`, `name`, `email`) | Tier 1 | [x] |
| 7.2 | `GET`    | `/customers/{id}` | any | Customer detail incl. recent orders | 7.1, 4.1 | [x] |
| 7.3 | `POST`   | `/customers` | barista+ | Create customer (used at order time) | 7.1 | [x] |
| 7.4 | `PATCH`  | `/customers/{id}` | barista+ | Update name/phone/email | 7.1 | [x] |
| 7.5 | `DELETE` | `/customers/{id}` | manager+ | Soft delete | 7.1 | [x] |

---

## Tier 8 — Phase 2 (deferred)

Per handoff §3 step 8 — explicitly deferred until v1 ships.

- [ ] **Multi-store transfers**: `POST /inventory/transfer` (creates paired `TRANSFER_OUT` + `TRANSFER_IN` movements across stores)
- [ ] **LINE OA integration**: webhook receiver for ordering via LINE
- [ ] **EDC / PromptPay payment integration**: webhook to auto-confirm payments (replaces D4-D5 manual flow)
- [ ] **Audit log archival job**: prune/move `StockMovement` and `Order` rows past retention window (handoff open question #2)
- [ ] **Wastage analytics dashboard**: motivates a `reason_code` column refactor (handoff open question #3)
- [ ] **Refresh token rotation + denylist**: replaces stateless logout (handoff open question #5)

---

## Gaps vs Handoff Spec

Cross-reference of `resources/BACKEND_HANDOFF.md` against everything shipped through Tier 7. Items below are unfulfilled requirements from the handoff.

### G1 — Domain model fields (handoff §4)

| # | Gap | Location | Handoff says |
|---|---|---|---|
| G1.1 | `Order` missing `discount Numeric(12,2)` | `models/orders.py` | "subtotal/discount/tax/total" |
| G1.2 | `Order` missing `tax Numeric(12,2)` | `models/orders.py` | "subtotal/discount/tax/total" — VAT schema-ready from day 1 (D9) |
| G1.3 | `OrderItem` missing `line_total Numeric(12,2)` | `models/orders.py` | "quantity INT, unit_price, modifiers JSONB, line_total" |
| G1.4 | `OrderRead` schema missing `customer_id`, `discount`, `tax` | `schemas/orders.py` | follows from G1.1–G1.3 |
| G1.5 | `OrderItemRead` schema missing `line_total` | `schemas/orders.py` | follows from G1.3 |

> Migration `0005_order_fields` needed: `ALTER TABLE orders ADD COLUMN discount NUMERIC(12,2) DEFAULT 0, ADD COLUMN tax NUMERIC(12,2) DEFAULT 0; ALTER TABLE order_items ADD COLUMN line_total NUMERIC(12,2);`

### G2 — CRM ↔ Orders integration

| # | Gap | Location |
|---|---|---|
| G2.1 | `POST /orders` body doesn't accept optional `customer_id` | `schemas/orders.py` `CreateOrderRequest` |
| G2.2 | `GET /orders` has no `customer_id` filter | `api/v1/orders.py` + `services/orders.py` |
| G2.3 | `OrderRead` doesn't expose `customer_id` | `schemas/orders.py` `OrderRead` |

### G3 — OpenAPI hygiene (handoff §9.7)

All routers except `customers.py` have `operation_id` and `summary` on every route.

| # | Gap | Location |
|---|---|---|
| G3.1 | 5 customer routes missing `operation_id` + `summary` | `api/v1/customers.py` |

### G4 — Test coverage (handoff §9.5)

| # | Gap | Target |
|---|---|---|
| G4.1 | `tests/factories.py` missing — handoff §9.1 layout requires it; §5.8 acceptance tests reference `factory.inventory_item(...)` | new file |
| G4.2 | No `test_customers_service.py` — Tier 7 has zero test coverage | new file |
| G4.3 | No `test_reports_service.py` — Tier 6 has zero test coverage | new file |

### G5 — Missing reference documents (read-only — not code gaps)

These are docs the handoff references that are absent from `resources/`. The backend build is complete without them, but the FE engineer and future backend devs will expect them.

| # | File | Referenced in |
|---|---|---|
| G5.1 | `resources/POS_BUILD_PROMPT.md` | Handoff §1, §6, throughout |
| G5.2 | `resources/DECISIONS.md` | Handoff §1 "read in this order", §7 locked decisions |
| G5.3 | `resources/prototype/` | Handoff §2, §5.9 FE contract |

---

## Open questions to resolve before Tier 4

These are flagged in handoff §10 — bring to the team, don't decide alone:

1. **Multi-currency?** Affects `Store.currency` schema before Tier 4 ships
2. **Wastage reason — encoded string vs dedicated column?** Refactor cost is small; if the answer is "dedicated column", do it before Tier 6's wastage report
3. **Cost on receive — latest-wins vs weighted-average?** Affects COGS report (Tier 6.3) accuracy
4. **Refresh token strategy** — affects logout (1.4) semantics
5. **Per-endpoint rate limits beyond login** — `POST /orders` rate limit?
6. **Soft delete vs hard delete** — affects `DELETE` semantics across all tiers

---

## Total scope

| Tier | Routes | Cumulative |
|---|---|---|
| 0 | foundation, 1 health route | 1 |
| 1 — Auth | 4 | 5 |
| 2 — Inventory | 8 | 13 |
| 3 — Catalog | ~15 (incl. inferred modifier routes) | ~28 |
| 4 — Orders | 6 | ~34 |
| 5 — KDS Realtime | 1 (+3 server events) | ~35 |
| 6 — Reports | 6 | ~41 |
| 7 — Customers | 5 | ~46 |
| 8 — Phase 2 | deferred | — |

**Approved current scope:** Tier 0 + Tier 1 + Tier 2 = **13 routes** (matches first-week Day 1–5 checklist).
