---
title: Terms of Reference — Cafe POS System (English)
type: TOR
status: draft
tags: [POS, cafe, TOR, backend, FastAPI]
created: 2026-05-28
updated: 2026-05-28
---

# Terms of Reference
## Cafe Point-of-Sale (POS) System — Backend

| Item | Detail |
|---|---|
| Prepared for | Cafe owner, manager, and organisational review committee |
| Prepared by | Development team |
| Date | May 2026 |
| Status | Draft — pending stakeholder feedback |

---

## Purpose of This Document

This document specifies the **functional scope** of the Cafe POS backend system. It is written in plain language so that cafe owners, managers, and non-technical reviewers can evaluate completeness before the system goes to final assessment.

**How to use this document:** Read each section and ask yourself — does the described functionality cover day-to-day cafe operations? If anything is missing, unclear, or should work differently, note it and report it to the development team before final evaluation.

> Nothing here is final. This is your opportunity to request changes.

---

## What This System Is

The **Cafe POS** is a server-side application that manages all data and business logic for a cafe. It is designed to connect to a display application (screen, tablet, or phone) that cafe staff will use directly. The system handles everything that happens "behind the scenes": storing records, enforcing rules, calculating costs, and generating reports.

The system supports **multiple cafe branches**. Each branch's data is completely isolated from others, even when they share the same owner.

**Technology stack (for technical reviewers):**

| Layer | Technology |
|---|---|
| API framework | Python 3.12 + FastAPI (async) |
| Database ORM | SQLAlchemy 2.x async + asyncpg |
| Database | PostgreSQL on Railway |
| Migrations | Alembic |
| Auth | JWT bearer tokens (PIN-based login) |
| Real-time (KDS) | Pusher Channels |
| Hosting | Railway (cloud) |
| API docs | Auto-generated OpenAPI at `/docs` |

---

## Phase Overview

| Phase | Domain | Sections |
|---|---|---|
| **Phase 1** | Foundation — Auth, Multi-tenancy, Users | 1.1 – 1.3 |
| **Phase 2** | HR & Workforce Management | 2.1 – 2.4 |
| **Phase 3** | Menu & Product Catalogue | 3.1 – 3.4 |
| **Phase 4** | Inventory Management | 4.1 – 4.5 |
| **Phase 5** | Sales & Order Operations | 5.1 – 5.7 |
| **Phase 6** | Reporting & Analytics | 6.1 – 6.6 |
| **Phase 7** | Infrastructure & Non-Functional Requirements | 7.1 – 7.3 |

---

## Phase 1 — Foundation

### 1.1 Authentication & Access Control

Every person who uses the system must log in with a **personal PIN** (4–6 digits). The system supports four user roles, each with a different level of access:

| Role | Access Level |
|---|---|
| **OWNER** | Highest privilege. Can do everything in the system, including viewing all reports and making financial adjustments. |
| **MANAGER** | Can do almost everything an owner can: manage staff, approve leave, open and close cash sessions, void orders, manage inventory, and view all reports. |
| **BARISTA** | Can take orders, log wastage, add customers, and manage pre-orders. Cannot access financial reports or modify employee data. |
| **BAKER** | Same access as Barista. Intended for kitchen or production staff who take orders and log ingredient usage. |

When a staff member logs in, the system automatically knows which branch they belong to. They only see data from their own branch.

**Login sessions expire after 8 hours** (one shift) before requiring a new login.

**Technical contract:**

```
POST /api/v1/auth/login        body: {store_slug, pin}  → {access_token, token_type}
POST /api/v1/auth/refresh      body: {refresh_token}    → {access_token}
GET  /api/v1/auth/me                                    → User
POST /api/v1/auth/logout                                → revoke session
```

Business rules:
- PIN is hashed with bcrypt (cost factor 12). Never logged in plaintext.
- JWT payload contains: `{sub, store_id, role, exp, iat}`. Access tokens live 8 hours; refresh tokens live 30 days.
- Login endpoint is rate-limited to **5 attempts per IP per minute**.
- `store_id` is always read from the JWT — never trusted from a request body or query string.

> **Reviewer questions:**
> - Are the four roles sufficient? Do any staff need different access levels?
> - Should Baker be more restricted than Barista?

---

### 1.2 Multi-Branch (Tenant) Architecture

The system is multi-tenant from day one. The data model is:

```
Tenant → Store (branch) → all domain records
```

Every domain table carries a `store_id`. Queries are always filtered by the logged-in user's `store_id` (from JWT). A user from Branch A who passes an ID belonging to Branch B receives a `404 Not Found` — not a `403 Forbidden` (so Branch B's existence is not leaked).

Data isolation rules:
- Employees, inventory, orders, customers, and reports are all scoped to a single store.
- A tenant (owner entity) can have multiple stores, but staff at each store only see their own store.
- No cross-store data transfer exists in Phase 1 (planned for Phase 2 future scope).

---

### 1.3 Employee Management

**Managers and Owners** can:

- View all active employees in the branch.
- View a full profile for any individual employee.
- Create a new employee account with:
  - Full name
  - PIN (used for login)
  - Role (OWNER, MANAGER, BARISTA, or BAKER)
  - Job title (e.g. Head Barista, Cashier)
  - Phone number
  - Email address
  - Home address
- Edit any of the above fields at any time.
- Deactivate an employee account when they leave (records are retained for history; they can no longer log in).

The system prevents two employees in the same branch from sharing the same phone number or email address.

> **Reviewer questions:**
> - Is there additional employee data the system should store? (e.g. start date, contract type, emergency contact, national ID number)
> - Should deactivated employees be hard-deleted, or is soft retention (current approach) correct?

---

## Phase 2 — HR & Workforce Management

### 2.1 Leave Management

Any employee can submit a leave request by specifying:
- Leave type (multiple types supported — exact list to be confirmed)
- Requested date(s)

Employees only see their own leave requests. Managers and Owners can see all leave requests in the branch.

**Managers and Owners** can approve or reject any leave request. The system records who approved or rejected and when.

Business rules:
- No annual leave limit is enforced at this time. Requests are recorded but quotas are not blocked.
- Rejected requests are archived, not deleted.

> **Reviewer questions:**
> - What leave types do you need? (e.g. annual leave, sick leave, personal leave, unpaid leave)
> - Should the system enforce per-person annual day limits?
> - Should rejected requests be deletable?

---

### 2.2 Shift Scheduling

**Managers and Owners** can assign shifts to employees. Each shift records:
- Employee assigned
- Start date and time
- End date and time

Shifts can be filtered by week, so managers can view the schedule for any desired week. All employees can view the shift list to see their own schedule.

Business rules:
- No conflict detection (double-booking the same employee) in Phase 1.
- Actual clock-in / clock-out time is not tracked separately from the assigned shift in Phase 1.

> **Reviewer questions:**
> - Is simple shift assignment sufficient, or do you need a full weekly calendar view?
> - Should the system send shift reminder notifications to employees?
> - Should actual arrival and departure times be tracked separately?

---

### 2.3 Staff Task Management

**Managers** can create tasks and assign them to employees. Tasks pass through the following workflow:

```
Pending → In Progress → Awaiting Review → Completed
```

- Employees can move a task from Pending → In Progress → Awaiting Review when they believe it is done.
- **Managers** must confirm a task as Completed.
- Employees only see tasks assigned to themselves.
- Managers see all tasks and can filter by status.

> **Reviewer questions:**
> - Is this task system useful for your cafe? (e.g. cleaning jobs, opening checklists, daily duties)
> - Should tasks have a deadline or due date?
> - Should tasks have priority levels (urgent, normal, low)?

---

### 2.4 Cash Session Management

The system supports opening and closing **cash sessions** at the start and end of each day or shift:

- **Opening:** Manager records the amount of cash in the drawer when the session starts (the **opening balance**).
- **Closing:** Manager records the amount of cash in the drawer when the session ends (the **closing balance**).

The system stores the full history of all past cash sessions. Only **Managers and Owners** can open, close, or view cash sessions.

Business rules:
- The system records balances as entered. It does not automatically calculate whether the closing balance matches expected sales.
- Intra-session withdrawals or deposits (e.g. taking cash to a safe) are not tracked in Phase 1.

> **Reviewer questions:**
> - Should the system auto-calculate expected vs. actual closing balance and flag discrepancies?
> - Do you need to record mid-session cash drops or deposits?

---

## Phase 3 — Menu & Product Catalogue

### 3.1 Menu Categories

Categories are labels used to group products (e.g. Hot Drinks, Cold Drinks, Bakery, Food).

Managers can:
- Create a new category
- Rename a category
- Delete a category

> **Reviewer questions:**
> - Should categories have a display order (for how they appear on screen)?
> - Should any categories be visible only at certain times of day?

---

### 3.2 Products & Pricing

Each menu item has:
- Name and description
- Price
- Category
- Active/hidden status (hidden products don't appear on the ordering screen)
- Ingredient recipe (see Section 3.4)

Managers can create, edit, and soft-delete (hide) products at any time.

Business rules:
- Prices are stored as `Numeric(12, 2)` — two decimal places, no floating-point rounding errors.
- Deleting a product is a soft delete (hidden, not removed). Historical orders that reference the product retain a name snapshot.
- A product can have a separate cost price (for margin reporting) distinct from the selling price.

> **Reviewer questions:**
> - Should products have a cost price separate from the selling price for profit calculation?
> - Do you need product images?
> - Should products be available only during certain time windows (e.g. breakfast items before noon)?

---

### 3.3 Modifier Groups & Options

Products can have customisation options called **Modifier Groups**. Each group has sub-options.

| Example group | Options |
|---|---|
| "Size" | Small, Medium, Large |
| "Sweetness" | None, Less, Normal |
| "Add-ons" | Extra shot, Oat milk, Vanilla syrup |

Each option can carry an additional charge (e.g. Extra shot +20 THB). Modifier groups can be set as **required** (must choose) or **optional**.

**How modifiers are stored on orders:** When an order is placed, the selected modifiers are stored as a JSON snapshot on the order line item. This preserves historical accuracy — if a modifier name or price is later changed, old orders remain correct.

Business rules:
- Modifiers do not currently affect the ingredient recipe deduction. A "Oat milk" selection does not automatically swap the recipe to deduct oat milk instead of regular milk (Phase 2 enhancement).

> **Reviewer questions:**
> - Should modifier selections affect the ingredient recipe deduction?
> - Is there a limit to how many modifier groups a product can have?

---

### 3.4 Ingredient Recipes (Bill of Materials)

Each product can have a list of ingredients with exact quantities. When the product is ordered, the system automatically deducts the ingredient quantities from inventory.

**Example:** The "Latte" recipe uses 18g coffee beans, 200ml milk, and 1 cup.

Business rules:
- Recipe quantities use `Numeric(10, 3)` precision (three decimal places).
- Recipes are set per product by Managers.
- A single inventory item (e.g. milk) can appear in multiple product recipes.
- Recipe is stored as `RecipeItem` rows (`product_id`, `inventory_item_id`, `quantity`).
- Bulk-replacing a product's entire recipe is supported via `PUT /api/v1/products/{id}/recipe`.

---

## Phase 4 — Inventory Management

### 4.1 Ingredient (Inventory Item) Master Data

The inventory tracks all raw ingredients used in the cafe.

Each inventory item stores:
- Name and unit of measure (e.g. grams, millilitres, pieces)
- Current stock on hand (calculated from all movements)
- **Par level** — the minimum quantity that should always be in stock
- Cost per unit (latest-cost-wins on each receive)
- Active/inactive status

Business rules:
- `(store_id, name)` is unique — no duplicate ingredient names within a branch.
- `stock_on_hand` and `cost_per_unit` use `Numeric(12, 3)` and `Numeric(10, 4)` precision respectively.
- Inactive items reject stock mutations with `409 Conflict`.

---

### 4.2 Stock Movement Tracking & Audit Trail

The system tracks every change to stock automatically via an **append-only** `StockMovement` log. No movement record is ever updated or deleted.

| Movement type | When it occurs |
|---|---|
| `RECEIVE` | When a purchase receipt is confirmed |
| `SALE` | When an order is placed (deducted by recipe) |
| `WASTE` | When a staff member logs wastage |
| `ADJUST` | When a manager makes a manual correction |
| `TRANSFER_IN` | Stock transferred in from another branch (Phase 2) |
| `TRANSFER_OUT` | Stock transferred out to another branch (Phase 2) |

Each movement records: item, quantity (always positive — direction inferred from type), reason or note, linked order ID (for `SALE`), creating user, and timestamp.

Business rules:
- Negative stock is allowed (real-world: receipts are often recorded after sales). The system logs a warning but does not block.
- Errors are corrected via a compensating `ADJUST` movement — not by editing past records.
- `stock_on_hand` on the inventory item is kept in sync with the movement log within the same transaction.

**REST endpoints:**

| Method | Path | Role | Purpose |
|---|---|---|---|
| `GET` | `/api/v1/inventory` | any | List all items in current store |
| `GET` | `/api/v1/inventory/{id}` | any | Single item with stock status |
| `PATCH` | `/api/v1/inventory/{id}` | manager+ | Edit par level or cost per unit |
| `POST` | `/api/v1/inventory/receive` | barista+ | Add stock (RECEIVE movement) |
| `POST` | `/api/v1/inventory/waste` | barista+ | Reduce stock (WASTE movement) |
| `POST` | `/api/v1/inventory/adjust` | manager+ | Audit correction (ADJUST movement) |
| `GET` | `/api/v1/inventory/movements` | any | Paginated movement log |
| `GET` | `/api/v1/inventory/low-stock` | any | Items below par level |

---

### 4.3 Low Stock Alerts

The system can instantly display all ingredients that are below their par level. Each item carries a computed `status` field:

| Status | Condition |
|---|---|
| `ok` | `stock_on_hand >= par_level` |
| `low` | `stock_on_hand < par_level` |
| `critical` | `stock_on_hand < par_level × 0.5` |

This feeds the low-stock report (Section 6.5) and the `GET /inventory/low-stock` endpoint for dashboard widgets.

> **Reviewer questions:**
> - Should the system block an order when stock is zero rather than allowing negative stock with a warning?

---

### 4.4 Expiry Tracking

When stock is received, an expiry date can be recorded per lot. The system can display all lots that have passed their expiry date and still have remaining stock.

Business rules:
- Expiry date is stored on the `StockMovement` row at receive time.
- Querying expired lots is a read-only report — no automatic deduction occurs.

> **Reviewer questions:**
> - Should the system alert ahead of expiry (e.g. items expiring within 3 days)?

---

### 4.5 Purchase Receipts (Stock Receiving)

When new stock arrives, Managers record it using a **purchase receipt**. This is the formal record of a delivery.

**Workflow:**

1. Manager creates a new receipt in **"Draft"** status.
2. Manager adds stock lots to the receipt. Each lot records:
   - Ingredient received
   - Quantity received
   - Price per unit
   - Expiry date (optional)
   - Supplier name (optional)
3. Lots can be freely added or removed while the receipt is in Draft.
4. Manager **confirms** the receipt — the system adds all stock to inventory atomically in one transaction.
5. Once confirmed, the receipt is locked and cannot be changed.

The receipt history shows the total value and all lot details for reference.

Business rules:
- Confirmation is a one-way operation. There is no un-confirm.
- Multiple suppliers can appear on the same receipt (each lot records its own supplier name).
- The system records which user confirmed the receipt via the JWT.
- Supplier history (which supplier, what price, how much) is queryable per ingredient.

> **Reviewer questions:**
> - Should there be a separate purchase-order step (create PO → receive against it → confirm) or is the current Draft → Confirm flow sufficient?
> - Should a full Supplier master database be maintained separately?

---

## Phase 5 — Sales & Order Operations

### 5.1 Order Lifecycle

Any Barista or Baker can create an order. Each order records:
- Channel: **Dine-in**, **Takeaway**, or **Delivery**
- Line items (from the menu)
- Selected modifiers for each item (e.g. size, sweetness) — stored as a JSON snapshot
- Linked customer (optional)
- Payment method and amount paid

**Order status flow:**

```
PENDING → PAID → IN_PROGRESS → READY → COMPLETED
```

- On creation, the order starts as `PENDING` and ingredient stock is deducted immediately from inventory.
- When payment is received, the staff member marks it `PAID`.
- Kitchen staff advance the order through `IN_PROGRESS` and `READY` until `COMPLETED`.

Business rules:
- Each order carries an `idempotency_key` (UUID generated by the frontend). Duplicate submissions return `409 Conflict` — the order is not created twice.
- Order totals include subtotal, discount, tax (`vat_rate` from Store — disabled by default), and total. All monetary values use `Numeric(12, 2)`.
- A name snapshot of the product name is stored on each order line item. Renaming or deleting a product later does not affect historical order records.
- `order_number` is a sequential human-readable identifier per store.

**REST endpoints:**

| Method | Path | Role | Purpose |
|---|---|---|---|
| `POST` | `/api/v1/orders` | barista+ | Create order + deduct stock atomically |
| `PATCH` | `/api/v1/orders/{id}/pay` | barista+ | Mark paid, record payment method |
| `PATCH` | `/api/v1/orders/{id}/status` | barista+ | Advance status |
| `POST` | `/api/v1/orders/{id}/void` | manager+ | Void order, reverse stock |
| `GET` | `/api/v1/orders` | manager+ | List orders with date/status/channel filters |

> **Reviewer questions:**
> - Do you need table numbers on orders?
> - Should split payment be supported (e.g. half cash, half card)?
> - Do you need a receipt number or queue ticket printed for customers?
> - Should partial refunds (returning individual items) be distinct from voiding the whole order?

---

### 5.2 Payment Methods

| Method | Details |
|---|---|
| Cash | — |
| Credit / Debit Card | — |
| PromptPay QR | System generates a QR code from the order total |
| LINE Pay | Supported in schema; manual confirmation in Phase 1 |
| TrueMoney | Supported in schema; manual confirmation in Phase 1 |
| Other | Free-text label |

Business rules:
- Payment confirmation is **manual** in Phase 1 (no EDC API integration, no PromptPay webhook). Staff mark the order as paid after visual confirmation.
- QR code generation uses the order total with `Numeric(12, 2)` precision.

---

### 5.3 Kitchen Display System (KDS)

The system is designed for use with a **kitchen display screen**. When an order's status changes, the update is pushed to the KDS screen in real time without page refresh.

**Technology:** Pusher Channels (server SDK). The backend publishes an event on channel `kds-store-{store_id}` after every order status change commits. The KDS frontend subscribes to this channel.

Events published:
- New order created
- Order status advanced
- Order voided

---

### 5.4 Order Cancellation & Void

Only **Managers** can void (cancel) an order. On void:
1. Manager provides a reason (required).
2. All inventory deductions from the order are reversed automatically.
3. The void is recorded permanently in an `OrderVoidLog` for audit.

Business rules:
- Void is only available to users with MANAGER or OWNER role.
- Voided orders remain in history — they are not deleted.

---

### 5.5 Pre-Orders (Advance & Catering Orders)

Pre-orders are for customers who order in advance, such as catering orders or custom cake orders. They are separate from counter orders.

**Workflow:**

1. Staff create a pre-order with customer name and due date.
2. Staff add the requested line items.
3. System checks whether sufficient stock exists for the order by comparing against current inventory.
4. When production begins, the pre-order is **started** — stock is deducted at this point.
5. When the order is ready, it is marked **completed**.
6. Pre-orders can be **cancelled** while still in Pending status.

Business rules:
- Stock is deducted at the **start** of production, not at creation time.
- Payment tracking is not included in Phase 1 pre-orders (status and items only).
- Linking a pre-order to a customer profile is optional.

> **Reviewer questions:**
> - Should pre-orders track payment (deposit, partial, full)?
> - Should pre-orders be linked to the CRM customer record?
> - Are there deposit or partial-payment scenarios to handle?

---

### 5.6 Customer CRM

The system maintains a simple **customer database**. Each customer record holds:
- Full name
- Phone number
- Email address

Customers can be searched by name, phone, or email. Viewing a customer profile shows their recent order history.

- Any Barista can create or update a customer record.
- Only **Managers** can soft-delete a customer (record retained for history, not fully erased).
- Orders can be linked to a customer (optional) for purchase history tracking.

> **Reviewer questions:**
> - Do you need a loyalty / points system? (e.g. earn 1 point per 10 THB, redeem for discounts)
> - Should customers have a running credit balance or outstanding balance?
> - Do you want to track birthdays for marketing purposes?
> - Should the system send automated messages to customers?

---

### 5.7 Shopping List

Staff can maintain a simple **shopping list** of ingredients to buy. Items can be added and removed when purchased.

The list can be exported as plain text so it can be easily sent to whoever is doing the shopping or shared via a messaging app.

> **Reviewer questions:**
> - Should low-stock ingredients be added to the shopping list automatically?
> - Should the printed list include current stock levels and par levels for reference?

---

## Phase 6 — Reporting & Analytics

All reports are restricted to **Managers and Owners**.

### 6.1 Daily Dashboard

A quick summary of today's performance:
- Number of orders
- Total revenue
- Other key daily figures

> **Reviewer questions:**
> - Should the dashboard also show yesterday's or last week's figures for comparison?

---

### 6.2 Sales Reports

Managers can generate sales reports for any date range. Reports can be broken down by:

| Dimension | Description |
|---|---|
| Day | Total sales per day within a time period |
| Hour | Identifies the busiest hours of the day |
| Product | Identifies the best-selling items |
| Category | Shows which menu category generates the most revenue |
| Payment method | Shows customer payment preferences |

---

### 6.3 COGS Report (Cost of Goods Sold)

Shows the volume of ingredient stock consumed within a given date range. Results can be ranked by units used or by total ingredient cost. Helps identify the highest-cost ingredients.

Business rules:
- Calculated from `SALE` type movements within the date range.
- Cost is based on `cost_per_unit` at the time of the movement (latest-cost-wins model in Phase 1).

---

### 6.4 Waste Report

Shows all wastage records within a given date range:
- Which ingredient was wasted
- How much was wasted
- Why (wastage reason code + note)
- Who recorded it

Wastage reasons: `EXPIRED`, `SPILLED`, `TRIAL`, `DAMAGED`, `OTHER`.

---

### 6.5 Low Stock Report

A snapshot of all ingredients currently below their par level, with their `ok` / `low` / `critical` status.

---

### 6.6 Cashier Session Report

Shows cash session records within a given date range:
- Who opened and closed each session
- Opening and closing balances
- Session duration

---

> **Reviewer questions (all reports):**
> - Are there additional reports needed? (e.g. per-product margin, staff performance by order count, monthly or annual summaries)
> - Should reports be exportable to Excel or PDF?

---

## Phase 7 — Infrastructure & Non-Functional Requirements

### 7.1 System Reliability Guarantees

| Topic | Detail |
|---|---|
| **Decimal precision** | All money values use `Numeric(12, 2)`. Inventory quantities use `Numeric(12, 3)`. Costs use `Numeric(10, 4)`. No floating-point arithmetic. |
| **Atomic transactions** | Every mutation that touches multiple rows (e.g. create order + deduct stock) runs inside a single database transaction. Either everything succeeds or everything rolls back. |
| **Append-only audit trail** | Stock movements and order void logs are never updated or deleted. Corrections add a new compensating record. |
| **Access control** | Every API action checks the caller's identity and role before permitting the operation. Role violations return `403 Forbidden`. Cross-store access returns `404 Not Found`. |
| **Branch data isolation** | `store_id` is read from the JWT on every request. A user from Branch A cannot access Branch B's data. |
| **Real-time KDS updates** | Kitchen display screens receive order status updates via Pusher Channels without polling. |
| **Cloud deployment** | The system is deployed on Railway (cloud platform). Accessible from any device with an internet connection. |
| **Migration safety** | Database schema changes are managed via Alembic. Migrations run automatically on deploy before the web server accepts traffic. |

---

### 7.2 Real-Time Architecture

Pusher Channels (free tier, 200,000 messages/day) is used for real-time events. The backend publishes to `kds-store-{store_id}` after every order state change. The KDS frontend subscribes via Pusher's JavaScript client SDK.

Constraints:
- No WebSocket server management required.
- If the free-tier message limit is exceeded, Pusher upgrades may be needed.
- The only real-time consumer in Phase 1 is the KDS. Future phases may add customer-facing displays.

---

### 7.3 Cloud Deployment (Railway)

- Single service from the `api/` directory, deployed via Nixpacks or Dockerfile.
- PostgreSQL provided by a Railway Postgres plugin (separate service, same project).
- Release command: `alembic upgrade head` runs before the web container takes traffic.
- Structured JSON logs (via `python-json-logger`) for Railway log search.
- Rate limiting on `POST /auth/login`: 5 attempts per IP per minute (in-memory via `slowapi`; Redis if scaled).

**Required environment variables:**

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (`postgresql+asyncpg://...`) |
| `JWT_SECRET` | 32+ byte hex secret for signing JWTs |
| `CORS_ORIGINS` | Frontend origin(s) allowed by CORS policy |
| `ENVIRONMENT` | `development` or `production` |
| `PUSHER_APP_ID`, `PUSHER_KEY`, `PUSHER_SECRET`, `PUSHER_CLUSTER` | Pusher credentials for KDS |

---

## What Is NOT Included (Out of Scope — Phase 1)

The following features are **not** part of the current system. They may or may not be needed depending on your feedback:

| Feature | Notes |
|---|---|
| Frontend / display application | The system is server-side only. A display app (tablet, phone, screen) must be developed separately. |
| Loyalty / rewards programme | No points earning, redemption, or discount codes. |
| Promotions & discount management | No coupon codes, percentage discounts, or promotional pricing rules. |
| Table management | No floor plan, table numbers, or table assignment for dine-in orders. |
| Receipt printing | The system produces order data but does not directly control a printer. |
| Supplier master database | Supplier name is recorded on each receipt lot, but there is no standalone supplier management module. |
| Payroll calculation | The system tracks shifts and employee records but does not calculate wages. |
| Reservation / booking system | No table reservation module. |
| Online ordering integration | No connection to food-delivery platforms (GrabFood, Foodpanda, etc.). |
| Accounting software integration | No direct connection to accounting tools. |
| Multi-currency | Thai Baht (THB) only. No `Store.currency` field in Phase 1. |
| Weighted-average costing | Cost per unit uses latest-cost-wins. Weighted-average cost is planned for Phase 2. |
| Cross-store stock transfers | `TRANSFER_IN` and `TRANSFER_OUT` movement types are defined in the schema but the transfer workflow is deferred to Phase 2. |
| Offline mode | The system is online-only. No offline queue, no IndexedDB conflict resolution. |

> **Reviewer questions:**
> - Which of the above missing features are essential for your cafe?
> - If yes, please rank them by importance so the development team can prioritise.

---

## Project Pricing Estimate

### Scope Summary

The system described in this document is a **backend (server-side) application only**. The frontend display application that staff will use directly is not included and must be developed separately.

The backend comprises 13 functional modules, multi-branch data isolation, real-time order updates, a complete reporting suite, and Railway cloud deployment.

### Development Hour Estimate

| Module | Estimated Hours |
|---|---|
| Auth system + multi-branch architecture | ~25 hrs |
| HR: Employee management, leave, shifts, tasks, cash sessions | ~70 hrs |
| Menu: Categories, products, modifiers, ingredient recipes | ~45 hrs |
| Inventory: Stock tracking, wastage, expiry, supplier history | ~55 hrs |
| Purchase receipts & lot management | ~35 hrs |
| Orders: Full lifecycle, void, KDS real-time | ~55 hrs |
| Pre-orders (advance & catering) | ~25 hrs |
| Shopping list | ~10 hrs |
| Customer CRM | ~20 hrs |
| Reports & dashboard (6 report types) | ~55 hrs |
| Infrastructure: Testing, migrations, deployment, documentation | ~40 hrs |
| **Total** | **~435 hrs** |

### Cost Estimate by Developer Level

| Developer level | Rate (THB/hr) | Estimated total |
|---|---|---|
| Junior freelancer | 300 – 500 | 130,000 – 218,000 THB |
| Mid-level developer | 700 – 1,000 | 305,000 – 435,000 THB |
| Senior / agency | 1,500 – 2,500 | 653,000 – 1,088,000 THB |

**Recommended benchmark for organisational assessment:**
Mid-level developer (solo) — approximately **300,000 THB (three hundred thousand baht)**

### Full Project Budget (Backend + Hosting)

| Item | Estimate (THB) |
|---|---|
| Development labour (mid-level, solo) | 250,000 – 350,000 |
| Railway cloud infrastructure (12 months) | ~12,000 |
| Documentation & delivery | 20,000 – 30,000 |
| **Total project value** | **~280,000 – 400,000** |

**Figure for committee presentation:** **300,000 THB (three hundred thousand baht)** for the backend system as delivered.

### SaaS Rental Model (optional)

If the organisation chooses to rent this system to cafe operators rather than sell outright:

| Model | Price |
|---|---|
| Monthly subscription | 1,500 – 3,000 THB/month |
| One-time setup & onboarding fee | 10,000 – 25,000 THB |
| Annual cost | 18,000 – 36,000 THB/year |

> **Note:** The frontend application is not included. Cafes using this system must develop or procure a frontend separately, which typically adds 50–80% to the total cost.

---

## Next Steps

1. Cafe owner and manager read this document and note any gaps, questions, or requested changes in a separate feedback document.
2. Development team receives feedback and assesses which changes can be accommodated within project scope and timeline.
3. If all parties agree the system is complete, the project is submitted to the organisational committee for final assessment.
4. If changes are requested, they will be scoped, prioritised, and implemented before resubmission.

---

*End of document — Terms of Reference, Cafe POS System, 28 May 2026*
