# 05-06-2026 — Updates and Functions of Routes

> **Frontend: read this differently than a normal handoff.**
> Most handoffs describe one feature, you wire it up once, and you forget it. **This one is a toolbox.** Every route below is a *tool*. You don't use a tool once and discard it — you keep the toolbox, and whenever a new task lands ("show low stock", "let a manager void an order", "redeem a member reward"), you come back here, find the tool that does it, and use it.

## ⚠️ Action required: build your own tool library file

Create a **permanent reference file in the frontend repo** — e.g. `src/api/TOOLS.md` (or `docs/api-tools.md`) — seeded from this document. Treat it as living infrastructure:

- **One entry per route**, in the format: *tool name → method + path → when to use → inputs → output → gotchas.*
- When you build a screen, **link the screen to the tools it uses** (e.g. `POS Terminal → orders_create, orders_pay, promotions_evaluate, membership_lookup`).
- When the backend ships new routes, **append them here** — don't let it drift.
- Before writing any new fetch call, **search this file first**. The route almost certainly already exists; you just need to find the right tool. Do not invent endpoints or re-derive paths from memory.

The goal: future-you (or any teammate, or any AI agent) can open one file, pick the right tool, and complete a task without re-reading the backend.

---

## What changed on 2026-06-05 (the "updates")

**Shopping List now carries a buy-amount.** Previously the shopping list only said *which* ingredient to buy, never *how much*. Now:

- `GET /api/v1/shopping-list` returns two new fields per item:
  - **`suggested_qty`** — computed amount still to buy = `max(0, demand_from_PENDING_pre_orders − stock_on_hand)`. Always present, recomputed live as pre-orders/stock change.
  - **`quantity`** — the user's override, or `null` when unset.
- **Render rule:** show **`quantity ?? suggested_qty`** next to the unit, as an editable number. Distinguish a bare suggestion (`quantity === null`) from an explicit override visually if you can.
- **New tool:** `PATCH /api/v1/shopping-list/{item_id}` with `{ "quantity": "12" }` to set an override, or `{ "quantity": null }` to revert to the suggestion.
- `POST /api/v1/shopping-list` now also accepts an optional `quantity` at add time.
- `GET /api/v1/shopping-list/print` now includes the amount per line.

(Full detail in the dedicated note `HANDOFF_SHOPPING_LIST_QTY.md`.)

---

## Global conventions (read once, applies to every tool)

| Topic | Rule |
|---|---|
| **Base URL** | All routes are under `/api/v1`. Paths below are absolute and ready to use. |
| **Auth** | Bearer JWT in `Authorization: Bearer <access_token>`. Get it from `auth_login`. |
| **store_id** | **Never sent by the client.** The backend reads it from the JWT. You cannot act across stores. |
| **Roles** | The token carries a role. Some tools are gated (see each tool's `auth:` line). Roles: `OWNER > MANAGER > BARISTA/BAKER`. |
| **Error shape** | Non-2xx returns `{"error": {"code": "SNAKE_CASE_CODE", "message": "..."}}`. Switch on `error.code`, show `message`. |
| **Decimals** | Money/quantities are serialized as **JSON strings** (e.g. `"12.50"`). Parse before doing math; never use JS float arithmetic on them directly. |
| **Dates/times** | ISO 8601. Report/production filters use query params literally named `from` and `to`. |
| **Realtime** | Pusher. Authorize private channels via `realtime_auth` (form-encoded). Init Pusher client, point its authorizer at that route. |
| **Idempotency** | `orders_create` requires a client-generated `idempotency_key` — generate a UUID per checkout attempt and reuse it on retries so a double-tap doesn't double-charge. |

### Auth requirement legend (used on every tool)
- **public** — no token needed (login/refresh only).
- **CurrentUser** — any logged-in user (no store needed).
- **StoreUser** — logged-in user with a store (the default for nearly everything).
- **+MANAGER** — additionally requires `OWNER` or `MANAGER`.
- **+BARISTA** — additionally requires `OWNER`, `MANAGER`, `BARISTA`, or `BAKER` (the POS floor).
- **+OWNER** — `OWNER` only.

### Pagination patterns (two flavors — know which a tool uses)
- **Cursor**: `inventory_movements`, `receipts_list` → pass `cursor` + `limit`; response carries the next cursor.
- **Page/limit**: `orders_list`, `customers_list`, `pre_orders_list`, `membership_list_members` → pass `page` (1-based) + `limit`.

---

# The Tool Catalog (all 88 routes)

Format per tool: **`operation_id`** — `METHOD path` · auth · when to use · body → response · gotchas.

## 🔑 Auth — session lifecycle
Use these to log in, keep the session alive, and identify the user.

- **`auth_login`** — `POST /auth/login` · public · **When:** the login screen. Exchange `store_slug` + `pin` for tokens. · body `LoginRequest` → `TokenPair` (access 8h, refresh 30d). · *Rate-limited 5/min — debounce the button.*
- **`auth_refresh`** — `POST /auth/refresh` · public · **When:** access token expired (catch a 401, refresh, retry once). · body `RefreshRequest` → `AccessTokenResponse`.
- **`auth_me`** — `GET /auth/me` · CurrentUser · **When:** on app boot, to hydrate the current user (name, role, store) and gate UI by role. → `MeResponse`.
- **`auth_logout`** — `POST /auth/logout` · CurrentUser · **When:** user logs out. Stateless — also drop tokens client-side. · 204.

## 📦 Inventory — ingredients & stock movements
The raw-materials ledger. Reads are open to all staff; mutations are gated.

- **`inventory_list`** — `GET /inventory` · StoreUser · **When:** ingredient pickers, inventory screen. · query `search?`, `is_active?`(default true) → `list[InventoryItemRead]`.
- **`inventory_get`** — `GET /inventory/{item_id}` · StoreUser · **When:** ingredient detail. → `InventoryItemRead`.
- **`inventory_low_stock`** — `GET /inventory/low-stock` · StoreUser · **When:** dashboards/alerts — items below par. → `list[InventoryItemRead]`.
- **`inventory_movements`** — `GET /inventory/movements` · StoreUser · **When:** the audit log / "stock history" view. · query `item_id?`, `cursor?`, `limit?`(≤200) → `MovementsPage`.
- **`inventory_expired`** — `GET /inventory/expired` · StoreUser · **When:** expiry/waste management — lots past expiry with stock left. → `list[ExpiredLotRead]`.
- **`inventory_lots`** — `GET /inventory/{item_id}/lots` · StoreUser · **When:** FIFO lot drill-down for one ingredient. · query `status?`(`active`|`all`) → `list[StockLotRead]`.
- **`inventory_supplier_history`** — `GET /inventory/{item_id}/supplier-history` · +MANAGER · **When:** "where/at what price did we buy this." → `list[SupplierHistoryItem]`.
- **`inventory_create`** — `POST /inventory` · +MANAGER · **When:** add a new ingredient. · body `InventoryItemCreate` → `InventoryItemRead` (201).
- **`inventory_update`** — `PATCH /inventory/{item_id}` · +MANAGER · **When:** edit ingredient fields. *Does not create a stock movement.* · body `InventoryItemUpdate` → `InventoryItemRead`.
- **`inventory_delete`** — `DELETE /inventory/{item_id}` · +MANAGER · **When:** retire an ingredient (soft delete). · 204.
- **`inventory_waste`** — `POST /inventory/waste` · +BARISTA · **When:** record spoilage/breakage. Allows negative stock (warns, never blocks). · body `WasteRequest` → `InventoryItemRead` (200).
- **`inventory_adjust`** — `POST /inventory/adjust` · +MANAGER · **When:** audit correction with a required reason. · body `AdjustRequest` → `InventoryItemRead` (200).

## 🚚 Receipts — purchasing / stock-in (all +MANAGER)
Draft a delivery, add lots, then confirm to apply stock atomically.

- **`receipts_create`** — `POST /receipts` · **When:** start logging a delivery (DRAFT). · body `StockReceiptCreate` → `StockReceiptRead` (201).
- **`receipts_list`** — `GET /receipts` · **When:** purchasing history. · query `status?`, `cursor?`, `limit?` → `StockReceiptsPage`.
- **`receipts_get`** — `GET /receipts/{receipt_id}` · **When:** receipt detail with lots. → `StockReceiptRead`.
- **`receipts_add_lot`** — `POST /receipts/{receipt_id}/lots` · **When:** add a line (packs, price, expiry) to a DRAFT. · body `StockLotCreate` → `StockReceiptRead` (201).
- **`receipts_remove_lot`** — `DELETE /receipts/{receipt_id}/lots/{lot_id}` · **When:** fix a mistaken line on a DRAFT. · 204.
- **`receipts_confirm`** — `POST /receipts/{receipt_id}/confirm` · **When:** finalize — applies stock, locks the receipt. *Irreversible; confirm with the user.* → `StockReceiptRead`.

## 🗂️ Categories — menu grouping
- **`categories_list`** — `GET /categories` · StoreUser · **When:** menu nav, product filters. → `list[CategoryRead]`.
- **`categories_create`** — `POST /categories` · +MANAGER · body `CategoryCreate` → `CategoryRead` (201).
- **`categories_update`** — `PATCH /categories/{category_id}` · +MANAGER · **When:** rename/re-sort. · body `CategoryUpdate` → `CategoryRead`.
- **`categories_delete`** — `DELETE /categories/{category_id}` · +MANAGER · **When:** remove (refused if active products attached). · 204.

## ☕ Products — menu items, recipes (BOM), modifiers, cooking steps
- **`products_list`** — `GET /products` · StoreUser · **When:** menu grid, POS product picker. · query `category_id?`, `is_active?`, `search?` → `list[ProductRead]`.
- **`products_get`** — `GET /products/{product_id}` · StoreUser · **When:** product detail incl. recipe + modifier groups. → `ProductDetail`.
- **`products_create`** — `POST /products` · +MANAGER · body `ProductCreate` → `ProductRead` (201).
- **`products_update`** — `PATCH /products/{product_id}` · +MANAGER · body `ProductUpdate` → `ProductRead`.
- **`products_delete`** — `DELETE /products/{product_id}` · +MANAGER · 204.
- **`products_replace_recipe`** — `PUT /products/{product_id}/recipe` · +MANAGER · **When:** the BOM Builder — bulk-replace the whole recipe. · body `RecipeBulkReplace` → `list[RecipeItemRead]`.
- **`products_replace_modifier_groups`** — `PUT /products/{product_id}/modifier-groups` · +MANAGER · **When:** attach/reorder modifier groups on a product. · body `ProductModifierGroupsReplace` · 204.
- **`products_list_steps`** — `GET /products/{product_id}/steps` · StoreUser · **When:** show cooking instructions (KDS/recipe card). → `list[CookingStepRead]`.
- **`products_add_step`** — `POST /products/{product_id}/steps` · +MANAGER · body `CookingStepCreate` → `CookingStepRead` (201).
- **`products_update_step`** — `PATCH /products/{product_id}/steps/{step_id}` · +MANAGER · body `CookingStepUpdate` → `CookingStepRead`.
- **`products_delete_step`** — `DELETE /products/{product_id}/steps/{step_id}` · +MANAGER · 204.
- **`products_replace_steps`** — `PUT /products/{product_id}/steps` · +MANAGER · **When:** drag-to-reorder all steps at once. · body `CookingStepsBulkReplace` → `list[CookingStepRead]`.

## 🧩 Modifier Groups — options (extra shot, oat milk…)
- **`modifier_groups_list`** — `GET /modifier-groups` · StoreUser · query `is_active?` → `list[ModifierGroupRead]`.
- **`modifier_groups_create`** — `POST /modifier-groups` · +MANAGER · **When:** create a group with its child options in one call. · body `ModifierGroupCreate` → `ModifierGroupRead` (201).
- **`modifier_groups_update`** — `PATCH /modifier-groups/{group_id}` · +MANAGER · **When:** edit group; optionally bulk-replace its modifiers. · body `ModifierGroupUpdate` → `ModifierGroupRead`.
- **`modifier_groups_delete`** — `DELETE /modifier-groups/{group_id}` · +MANAGER · 204.
- **`modifier_groups_add_modifier`** — `POST /modifier-groups/{group_id}/modifiers` · +MANAGER · body `ModifierCreate` → `ModifierRead` (201).
- **`modifier_groups_update_modifier`** — `PATCH /modifier-groups/{group_id}/modifiers/{modifier_id}` · +MANAGER · body `ModifierUpdate` → `ModifierRead`.
- **`modifier_groups_delete_modifier`** — `DELETE /modifier-groups/{group_id}/modifiers/{modifier_id}` · +MANAGER · 204.

## 🧾 Orders — the POS checkout + KDS
The heart of the POS floor.

- **`orders_create`** — `POST /orders` · +BARISTA · **When:** checkout. Atomic BOM deduction + idempotency guard. · body `CreateOrderRequest` (incl. `idempotency_key`, items, optional `member_id`/`promotion_ids`/reward) → `OrderRead` (201). *Generate one UUID per checkout, reuse on retry.*
- **`orders_list`** — `GET /orders` · StoreUser · **When:** order history, sales views. · query `status?`(repeatable), `customer_id?`, `from?`, `to?`, `page?`, `limit?` → `OrdersPage`.
- **`orders_get`** — `GET /orders/{order_id}` · StoreUser · **When:** order detail (items + modifier snapshots). → `OrderRead`.
- **`orders_pay`** — `PATCH /orders/{order_id}/pay` · +BARISTA · **When:** take payment (PENDING → PAID). · body `PayOrderRequest` → `OrderRead`.
- **`orders_update_status`** — `PATCH /orders/{order_id}/status` · +BARISTA · **When:** KDS advances a ticket. · body `UpdateStatusRequest` → `OrderRead`.
- **`orders_void`** — `POST /orders/{order_id}/void` · +MANAGER · **When:** cancel a placed order — reverses stock, writes a void log. · body `VoidOrderRequest` → `OrderRead`.
- **`orders_promptpay_qr`** — `GET /orders/{order_id}/promptpay-qr` · +BARISTA · **When:** show a PromptPay QR pre-filled with the order total. → `PromptPayQRResponse`.

## 📡 Realtime
- **`realtime_auth`** — `POST /realtime/auth` · StoreUser · **When:** Pusher private-channel handshake. **Form-encoded** (`socket_id`, `channel_name`), not JSON. Wire this as your Pusher `authorizer` endpoint, then subscribe to KDS/order channels for live updates. → auth signature dict.

## 📊 Reports & Dashboard — ⚠️ no `/reports` prefix on the dashboard one
Note the odd paths: the dashboard mounts at `/dashboard/today`, the rest under `/reports`.

- **`reports_dashboard_today`** — `GET /dashboard/today` · StoreUser · **When:** the home dashboard (today's counts/top items). → `DashboardTodayRead`.
- **`reports_sales`** — `GET /reports/sales` · +MANAGER · **When:** sales analytics. · query **`from`/`to` required**, `granularity?`(day|hour|product|category|payment_method, default day) → `SalesReportRead`.
- **`reports_inventory_cogs`** — `GET /reports/inventory-cogs` · +MANAGER · **When:** cost-of-goods view. · query `from`/`to` required, `sort_by?`(pieces|cost) → `CogsReportRead`.
- **`reports_wastage`** — `GET /reports/wastage` · +MANAGER · query `from`/`to` required → `WastageReportRead`.
- **`reports_low_stock`** — `GET /reports/low-stock` · +MANAGER · → `LowStockReportRead`.
- **`reports_cashier_shifts`** — `GET /reports/cashier-shifts` · +MANAGER · query `from`/`to` required → `CashierShiftsReportRead`.

## 👤 Customers (CRM)
- **`customers_list`** — `GET /customers` · StoreUser · **When:** customer search/list. · query `name?`, `phone?`, `email?`, `page?`, `limit?` → `CustomersPage`.
- **`customers_get`** — `GET /customers/{customer_id}` · StoreUser · **When:** profile + recent orders. → `CustomerRead`.
- **`customers_create`** — `POST /customers` · +BARISTA · body `CreateCustomerRequest` → `CustomerRead` (201).
- **`customers_update`** — `PATCH /customers/{customer_id}` · +BARISTA · body `UpdateCustomerRequest` → `CustomerRead`.
- **`customers_delete`** — `DELETE /customers/{customer_id}` · +MANAGER · 204.

## 🧑‍🍳 HR & Admin — staff, leaves, shifts, cash sessions, tasks
### Staff
- **`hr_staff_list`** — `GET /hr/staff` · StoreUser · → `list[StaffRead]`.
- **`hr_staff_get`** — `GET /hr/staff/{user_id}` · StoreUser · → `StaffRead`.
- **`hr_staff_create`** — `POST /hr/staff` · +MANAGER · body `StaffCreate` → `StaffRead` (201; 409 on dup phone/email).
- **`hr_staff_update`** — `PATCH /hr/staff/{user_id}` · +MANAGER · body `StaffUpdate` → `StaffRead` (409 on dup).
- **`hr_staff_delete`** — `DELETE /hr/staff/{user_id}` · +MANAGER · 204.
### Leaves
- **`hr_leaves_list`** — `GET /hr/leaves` · StoreUser · **When:** managers see all; others see own. → `list[LeaveRead]`.
- **`hr_leaves_mine`** — `GET /hr/leaves/mine` · StoreUser · **When:** the current user's own requests. → `list[LeaveRead]`.
- **`hr_leaves_create`** — `POST /hr/leaves` · +BARISTA · body `LeaveCreate` → `LeaveRead` (201).
- **`hr_leaves_review`** — `PATCH /hr/leaves/{leave_id}/review` · +MANAGER · **When:** approve/reject. · body `LeaveReview` → `LeaveRead`.
### Shifts (roster)
- **`hr_shifts_list`** — `GET /hr/shifts` · StoreUser · query `week_start?`(ISO date, 7-day window) → `list[ShiftRead]`.
- **`hr_shifts_create`** — `POST /hr/shifts` · +MANAGER · body `ShiftCreate` → `ShiftRead` (201).
### Cash sessions (drawer)
- **`hr_cash_sessions_list`** — `GET /hr/cash-sessions` · +MANAGER · → `list[CashSessionRead]`.
- **`hr_cash_sessions_current`** — `GET /hr/cash-sessions/current` · StoreUser · **When:** is the drawer open? → `CashSessionRead | null`.
- **`hr_cash_sessions_open`** — `POST /hr/cash-sessions` · +MANAGER · body `CashSessionCreate` → `CashSessionRead` (201).
- **`hr_cash_sessions_close`** — `PATCH /hr/cash-sessions/{session_id}/close` · +MANAGER · body `CashSessionClose` → `CashSessionRead`.
### Tasks (kanban)
- **`hr_tasks_list`** — `GET /hr/tasks` · StoreUser · **When:** task board; non-managers see only their own. · query `status?` → `list[TaskRead]`.
- **`hr_tasks_create`** — `POST /hr/tasks` · +MANAGER · body `TaskCreate` → `TaskRead` (201).
- **`hr_tasks_update`** — `PATCH /hr/tasks/{task_id}` · StoreUser · **When:** staff move their card (limited to IN_PROGRESS/PENDING_REVIEW). · body `TaskUpdate` → `TaskRead`.
- **`hr_tasks_confirm`** — `PATCH /hr/tasks/{task_id}/confirm` · +MANAGER · **When:** manager marks a PENDING_REVIEW task DONE. → `TaskRead`.
- **`hr_tasks_delete`** — `DELETE /hr/tasks/{task_id}` · +MANAGER · 204.

## 📅 Pre-Orders — custom/advance orders (all StoreUser, no role gate)
Lifecycle: PENDING → (start) IN_PROGRESS → (complete) COMPLETED; or CANCELLED. Header/items editable only while PENDING.

- **`pre_orders_create`** — `POST /pre-orders` · body `PreOrderCreate` → `PreOrderRead` (201).
- **`pre_orders_list`** — `GET /pre-orders` · query `status?`, `page?`, `limit?` → `PreOrdersPage` (ordered by due date).
- **`pre_orders_get`** — `GET /pre-orders/{pre_order_id}` → `PreOrderRead`.
- **`pre_orders_update`** — `PATCH /pre-orders/{pre_order_id}` · **When:** edit header (PENDING only). · body `PreOrderUpdate` → `PreOrderRead`.
- **`pre_orders_add_item`** — `POST /pre-orders/{pre_order_id}/items` · (PENDING only) · body `PreOrderItemIn` → `PreOrderRead` (201).
- **`pre_orders_remove_item`** — `DELETE /pre-orders/{pre_order_id}/items/{item_id}` · (PENDING only) → `PreOrderRead` (200).
- **`pre_orders_set_fulfillment`** — `PATCH /pre-orders/{pre_order_id}/items/{item_id}/fulfillment` · **When:** choose make-fresh vs from-inventory for a PRODUCED item (PENDING only). · body `FulfillmentModeUpdate` → `PreOrderRead`.
- **`pre_orders_ingredients`** — `GET /pre-orders/{pre_order_id}/ingredients` · **When:** "can we make this?" ingredient summary vs stock. · query `threshold?`(0–100, default 50) → `IngredientSummary`.
- **`pre_orders_start`** — `POST /pre-orders/{pre_order_id}/start` · **When:** begin production — deducts stock (PENDING → IN_PROGRESS). → `PreOrderRead`.
- **`pre_orders_complete`** — `POST /pre-orders/{pre_order_id}/complete` · (IN_PROGRESS → COMPLETED). → `PreOrderRead`.
- **`pre_orders_cancel`** — `POST /pre-orders/{pre_order_id}/cancel` · (PENDING → CANCELLED). → `PreOrderRead`.

## 🛒 Shopping List — what to buy (all StoreUser) — *updated 2026-06-05*
- **`shopping_list_list`** — `GET /shopping-list` · **When:** the shopping list screen. Now includes `suggested_qty` + `quantity`. Render `quantity ?? suggested_qty`. → `list[ShoppingListItemRead]`.
- **`shopping_list_print`** — `GET /shopping-list/print` · **When:** print view. Returns **text/plain**, not JSON. Now includes amounts.
- **`shopping_list_add`** — `POST /shopping-list` · **When:** add an ingredient (idempotent). Optional `quantity` override. · body `ShoppingListItemCreate` → `ShoppingListItemRead`. **Returns 201 if newly added, 200 if it already existed** — handle both as success.
- **`shopping_list_update`** — `PATCH /shopping-list/{item_id}` · **When:** user edits the amount. `{quantity: "12"}` to override, `{quantity: null}` to revert to suggestion. · body `ShoppingListItemUpdate` → `ShoppingListItemRead`.
- **`shopping_list_remove`** — `DELETE /shopping-list/{item_id}` · 204.

## 🏭 Production Orders — batch production (all StoreUser)
- **`production_orders_create`** — `POST /production-orders` · **When:** record a production run — deducts ingredients, adds finished goods. · body `ProductionOrderCreate` → `ProductionOrderRead` (201).
- **`production_orders_list`** — `GET /production-orders` · query `product_id?`, `from?`, `to?`(dates) → `list[ProductionOrderRead]`.
- **`production_orders_get`** — `GET /production-orders/{order_id}` → `ProductionOrderRead`.

## 🏷️ Promotions / Discounts
- **`promotions_evaluate`** — `POST /promotions/evaluate` · StoreUser (no role gate) · **When:** at checkout, before paying — find eligible promos for the cart and get the discounted totals. Feed the chosen `promotion_ids` into `orders_create`. · body `EvaluateRequest` → `EvaluateResponse`.
- **`promotions_calculator_baseline`** — `GET /promotions/calculator/baseline` · +MANAGER · **When:** break-even calculator UI. · query `product_id` required, `days?`(default 30) → `PromotionBaselineResponse`.
- **`promotions_create`** — `POST /promotions` · +MANAGER · body `PromotionCreate` → `PromotionRead` (201).
- **`promotions_list`** — `GET /promotions` · +MANAGER · query `active?` → `PromotionListResponse`.
- **`promotions_get`** — `GET /promotions/{promotion_id}` · +MANAGER · → `PromotionRead`.
- **`promotions_update`** — `PATCH /promotions/{promotion_id}` · +MANAGER · body `PromotionUpdate` → `PromotionRead`.
- **`promotions_delete`** — `DELETE /promotions/{promotion_id}` · +MANAGER · 204.

## ✅ Stock Takes — physical count reconciliation (all StoreUser)
- **`stock_take_preview`** — `GET /stock-takes/preview` · **When:** open a stock take — shows expected counts for the period. → `StockTakePreview`.
- **`stock_take_submit`** — `POST /stock-takes` · **When:** submit actual counts; backend writes ADJUST movements for variances. · body `StockTakeSubmit` → `list[StockTakeAdjustResult]`.
- **`stock_take_history`** — `GET /stock-takes/history` · **When:** past stock-take events. → `list[StockTakeEvent]`.

## 🎟️ Membership / Loyalty
Program *config* is OWNER-only; member-facing lookup/register is open to floor staff; member admin is MANAGER+.

- **`membership_get_program`** — `GET /membership/program` · StoreUser · **When:** show program rules / whether loyalty is on. → `ProgramRead | null`.
- **`membership_upsert_program`** — `PUT /membership/program` · +OWNER · **When:** configure the loyalty program. · body `UpsertProgramRequest` → `ProgramRead`.
- **`membership_get_reward_products`** — `GET /membership/program/reward-products` · +OWNER · → `list[RewardProductRead]`.
- **`membership_set_reward_products`** — `PUT /membership/program/reward-products` · +OWNER · body `SetRewardProductsRequest` → `list[RewardProductRead]`.
- **`membership_lookup`** — `POST /membership/lookup` · StoreUser · **When:** at checkout, find a member by phone. · body `LookupRequest` → `LookupResponse`.
- **`membership_register`** — `POST /membership/register` · StoreUser · **When:** enroll a new member at the till. · body `RegisterMemberRequest` → `AccountRead`.
- **`membership_list_members`** — `GET /membership/members` · +MANAGER · query `name?`, `phone?`, `page?`, `limit?` → `MembersPage`.
- **`membership_get_member`** — `GET /membership/members/{account_id}` · +MANAGER · → `MemberRead`.
- **`membership_adjust_points`** — `POST /membership/members/{account_id}/adjust` · +MANAGER · **When:** manual points correction. · body `AdjustPointsRequest` → `MemberRead`.

---

# Cookbook — pick the right tool for a task

Use this as the pattern for *how to think*: task → the tool(s) that do it. Add your own rows as you build.

| Task | Tools, in order |
|---|---|
| Log a user in and boot the app | `auth_login` → `auth_me` |
| Build the POS checkout | `products_list` → (optional) `membership_lookup` → `promotions_evaluate` → `orders_create` → `orders_pay` → (optional) `orders_promptpay_qr` |
| Kitchen display (KDS) | `orders_list?status=...` + subscribe via `realtime_auth`; advance with `orders_update_status` |
| Cancel a sale | `orders_void` (manager) |
| Home dashboard | `reports_dashboard_today` |
| Receive a delivery | `receipts_create` → `receipts_add_lot`× → `receipts_confirm` |
| "What do we need to buy?" | `shopping_list_list` (render `quantity ?? suggested_qty`); edit with `shopping_list_update` |
| Take a custom cake order | `pre_orders_create` → `pre_orders_ingredients` → `pre_orders_start` → `pre_orders_complete` |
| Monthly stock count | `stock_take_preview` → `stock_take_submit` |
| Build/edit a recipe | `products_get` → `products_replace_recipe` |
| Enroll & reward a regular | `membership_register` / `membership_lookup`; redeem inside `orders_create` (`member_id`, `redeem_reward`, `reward_product_id`) |
| Staff scheduling | `hr_shifts_list?week_start=...` + `hr_shifts_create` |
| Open/close the till | `hr_cash_sessions_current` → `hr_cash_sessions_open` … `hr_cash_sessions_close` |

---

# Appendix — request body fields (what to send)

`?` = optional/nullable. Decimals are strings. Enums are the backend's enum values.

**Auth**
- `LoginRequest`: `store_slug` (1–60), `pin` (4–6 digits)
- `RefreshRequest`: `refresh_token`

**Inventory**
- `InventoryItemCreate`: `name`(1–120), `unit`(1–24), `unit_size`(>0), `par_level`(≥0, default 0), `is_active`(default true)
- `InventoryItemUpdate`: `name?`, `unit?`, `unit_size?`, `unit_price?`, `par_level?`, `cost_per_unit?`
- `WasteRequest`: `item_id`, `qty`(>0), `reason`(WastageReason enum), `note?`
- `AdjustRequest`: `item_id`, `delta`(±, may be negative), `reason`(3–500)

**Receipts**
- `StockReceiptCreate`: `supplier_name?`, `receipt_ref?`, `note?`, `received_at`(date, default today)
- `StockLotCreate`: `inventory_item_id`, `qty_packs`(>0), `unit_price`(>0), `expiry_date?`

**Catalog**
- `CategoryCreate`: `name`(1–80), `sort_order`(≥0, default 0); `CategoryUpdate`: `name?`, `sort_order?`
- `ProductCreate`: `category_id?`, `name`(1–120), `description?`, `price`(0–999999.99), `is_active`(default true), `product_type`(default MADE_TO_ORDER), `servings_per_batch`(≥1, default 1); `ProductUpdate`: all optional
- `RecipeBulkReplace`: `items`: [{`inventory_item_id`, `quantity`(>0)}]
- `ProductModifierGroupsReplace`: `modifier_group_ids`: [str] (order = sort order)
- `CookingStepCreate`: `instruction`(1–500), `sort_order?`; `CookingStepUpdate`: `instruction?`, `sort_order?`; `CookingStepsBulkReplace`: `steps`: [`CookingStepCreate`]
- `ModifierGroupCreate`: `name`(1–80), `required`(default false), `min_select`(default 0), `max_select?`, `modifiers`: [`ModifierCreate`]; `ModifierGroupUpdate`: same all-optional (+ `modifiers?` bulk-replaces)
- `ModifierCreate`: `name`(1–80), `price_delta`(default 0), `inventory_item_id?`, `inventory_qty?`(>0), `sort_order`(default 0); `ModifierUpdate`: all optional + `is_active?`

**Orders**
- `CreateOrderRequest`: `idempotency_key`(≤120), `channel`(enum), `customer_id?`, `customer_note?`, `items`: [{`product_id`, `quantity`(≥1), `modifier_ids`:[str]}], `member_id?`, `redeem_reward`(default false), `reward_product_id?`, `promotion_ids`:[str]
- `PayOrderRequest`: `payment_method`(enum), `payment_ref?`
- `UpdateStatusRequest`: `status`(OrderStatus enum)
- `VoidOrderRequest`: `reason?`

**Realtime** (form-encoded): `socket_id`, `channel_name`

**Customers**
- `CreateCustomerRequest`: `name`(1–120), `phone?`, `email?`, `notes?`; `UpdateCustomerRequest`: all optional

**HR**
- `StaffCreate`: `name`(1–120), `role`(enum), `position`(enum), `pin`(4–8), `phone`(7–20), `email?`, `address?`; `StaffUpdate`: all optional (null clears email/address)
- `LeaveCreate`: `start_date`, `end_date`, `leave_type`(enum), `note?`; `LeaveReview`: `status`(enum), `note?`
- `ShiftCreate`: `user_id`, `assignment_date`, `start_time`, `end_time`, `notes?`
- `CashSessionCreate`: `cash_open`(≥0), `notes?`; `CashSessionClose`: `cash_close`(≥0), `notes?`
- `TaskCreate`: `title`(1–200), `description?`, `assignee_id?`, `due_date?`; `TaskUpdate`: all optional + `status?`

**Pre-Orders**
- `PreOrderCreate`: `order_date`, `due_date`, `customer_id?`, `customer_name?`, `customer_phone?`, `deposit_amount?`, `deposit_paid`(default false), `notes?`, `items`: [`PreOrderItemIn`]
- `PreOrderItemIn`: `product_id?`, `product_name?`, `quantity`(≥1), `unit_price?`
- `PreOrderUpdate`: all optional; `FulfillmentModeUpdate`: `fulfillment_mode`(enum)
- `ShoppingListItemCreate`: `inventory_item_id`, `quantity?`(≥0), `note?`; `ShoppingListItemUpdate`: `quantity?`(≥0)

**Production**: `ProductionOrderCreate`: `product_id`, `batches_count`(≥1), `notes?`

**Promotions**
- `PromotionCreate`: `name`(≤120), `type`(enum), `is_exclusive`(default false), `discount_pct`(>0 ≤100), `scope`(default ORDER), `product_ids_json?`, `category_id?`, `min_quantity?`(≥1), `bundle_product_ids_json?`, `time_start?`, `time_end?`, `days_of_week_json?`, `valid_from?`, `valid_until?`; `PromotionUpdate`: all optional + `is_active?`
- `EvaluateRequest`: `items`: [{`product_id`, `quantity`(≥1)}]

**Stock Takes**: `StockTakeSubmit`: `items`: [{`inventory_item_id`, `actual_quantity`(≥0)}], `notes?`

**Membership**
- `UpsertProgramRequest`: `is_active`(default true), `earn_mode`(default PER_RECEIPT), `baht_per_point?`(req if PER_BAHT), `points_to_redeem`(>0), `reward_type`(default DISCOUNT_FIXED), `reward_value?`(req for discount types), `reward_scope`(default ALL), `reward_category_id?`(req if CATEGORY), `min_order_baht?`, `points_expire_after_days?`, tier thresholds (ascending) + earn multipliers
- `SetRewardProductsRequest`: `product_ids`:[str]
- `LookupRequest`: `phone`(1–30); `RegisterMemberRequest`: `name`(1–120), `phone`(1–30), `date_of_birth?`
- `AdjustPointsRequest`: `delta`(int, may be negative), `note`(required)

---

*Generated 2026-06-05. 88 endpoints, 17 routers. Keep this file in sync with the backend — when routes are added, add the tool here, and keep linking each screen to the tools it uses.*
