# API Handoff: Inventory Enhancements, Modifier CRUD, and HR Module (Cash Sessions + Tasks)

## Business Context

This document covers three groups of backend changes shipped together:

1. **Inventory enhancements** — ingredients now support unit-size/piece-price pricing (e.g., "a bag of 50 sachets"), an expiry date field, a soft-delete endpoint, and a supplier price history view per item.
2. **Modifier individual CRUD** — individual modifier options inside a group can now be added, patched, or deleted without replacing the whole group.
3. **HR: Cash Sessions + Staff Tasks** — the HR module now tracks daily cash drawer open/close (with opening/closing floats) and a lightweight kanban task board for staff assignments.
4. **HR: Shifts refactored** — `shift_type` enum (MORNING/AFTERNOON/etc.) has been **removed** and replaced with explicit `start_time` / `end_time` fields.

Audience: cafe managers and staff. All resources are scoped to the authenticated user's store via JWT claims.

---

## Inventory Enhancements

### New fields on every `InventoryItemRead`

Two new optional fields were added to every inventory item response:

| Field | Type | Meaning |
|---|---|---|
| `expiry_date` | `string (ISO date) \| null` | When the stock expires. `null` if not tracked. |
| `unit_size` | `string (decimal) \| null` | Number of pieces/units per purchase unit (e.g. 50 sachets per bag). |
| `piece_price` | `string (decimal) \| null` | Cost per individual piece (`cost_per_unit / unit_size`). Set on receive. |

`unit_size` and `piece_price` are always `null` together or set together — the backend enforces this.

---

### GET /inventory/expired
- **Purpose**: List active inventory items whose `expiry_date` is today or in the past.
- **Auth**: Any authenticated store user
- **Request**: none (uses JWT store context)
- **Response** (200):
  ```json
  [
    {
      "id": "cuid",
      "name": "Fresh Milk",
      "unit": "litre",
      "cost_per_unit": "85.0000",
      "stock_on_hand": "12.000",
      "par_level": "20.000",
      "is_active": true,
      "expiry_date": "2026-05-01",
      "unit_size": null,
      "piece_price": null,
      "status": "critical"
    }
  ]
  ```
- **Notes**: Only returns `is_active=true` items. Items with `expiry_date=null` never appear here.

---

### DELETE /inventory/{item_id}
- **Purpose**: Soft-delete an inventory item (sets `is_active=false`). Does not delete historical movements.
- **Auth**: Manager / Owner
- **Response**: 204 No Content
- **Errors**: 404 if item not found in store; 403 if insufficient role
- **Notes**: The default `GET /inventory` list filters `is_active=true` by default. Pass `?is_active=false` to see deleted items, or `?is_active=` (empty) to see all.

---

### GET /inventory/{item_id}/supplier-history
- **Purpose**: Chronological list of every `RECEIVE` stock movement for an item, showing supplier, unit cost, and quantity received.
- **Auth**: Manager / Owner
- **Response** (200):
  ```json
  [
    {
      "supplier": "Dairy Fresh Co.",
      "unit_cost": "82.0000",
      "quantity": "50.000",
      "received_at": "2026-04-28T08:00:00Z",
      "note": "April monthly order"
    }
  ]
  ```
- **Notes**: Entries where no supplier was recorded will have `"supplier": null`. Ordered most-recent-first. Manager-only.

---

### InventoryItemCreate — new fields

```json
{
  "name": "Sugar Sachets",
  "unit": "bag",
  "par_level": "10",
  "cost_per_unit": "150.0000",
  "is_active": true,
  "expiry_date": "2026-12-31",
  "unit_size": "50",
  "piece_price": "3.00"
}
```

- `expiry_date`: optional ISO date string
- `unit_size` + `piece_price`: **must be provided together or both omitted** — sending only one returns 422
- `unit_size` must be `> 0`; `piece_price` must be `>= 0`

---

### InventoryItemUpdate — expiry_date now patchable

```json
{
  "par_level": "15",
  "cost_per_unit": "155.0000",
  "expiry_date": "2027-01-01"
}
```

All fields optional. Omit any you don't want to change.

---

### POST /inventory/receive — now records unit_cost per movement

No request payload change. The backend now stores the `cost_per_unit` submitted at receive time on the movement record, enabling the supplier history view above. Frontend behavior unchanged.

---

## Modifier Groups — Individual Modifier CRUD

Previously, modifiers inside a group could only be created/replaced in bulk via `ModifierGroupCreate` or `ModifierGroupUpdate`. Three new endpoints allow granular per-modifier management.

---

### POST /modifier-groups/{group_id}/modifiers
- **Purpose**: Add a single modifier option to an existing group
- **Auth**: Manager / Owner
- **Request**:
  ```json
  {
    "name": "Extra Shot",
    "price_delta": "15.00",
    "inventory_item_id": null,
    "inventory_qty": null,
    "sort_order": 3
  }
  ```
- **Response** (201):
  ```json
  {
    "id": "cuid",
    "name": "Extra Shot",
    "price_delta": "15.00",
    "inventory_item_id": null,
    "inventory_qty": null,
    "sort_order": 3,
    "is_active": true
  }
  ```
- **Errors**: 404 if group not found in store; 403 if insufficient role

---

### PATCH /modifier-groups/{group_id}/modifiers/{modifier_id}
- **Purpose**: Update any field on a single modifier option (partial update — omit fields you don't want to change)
- **Auth**: Manager / Owner
- **Request**:
  ```json
  {
    "name": "Extra Shot",
    "price_delta": "20.00",
    "is_active": false,
    "sort_order": 1
  }
  ```
- **Response** (200): Same shape as `ModifierRead` above
- **Errors**: 404 if modifier or group not found in store; 403 if insufficient role
- **Notes**: `is_active: false` hides the modifier from the POS order screen without deleting it. All fields optional.

---

### DELETE /modifier-groups/{group_id}/modifiers/{modifier_id}
- **Purpose**: Hard-delete a single modifier option from a group
- **Auth**: Manager / Owner
- **Response**: 204 No Content
- **Errors**: 404 if modifier or group not found; 403 if insufficient role
- **Notes**: Unlike inventory items, this is a **hard delete** (row removed). Use `PATCH is_active: false` if you want to hide without deleting.

---

### Bulk-replace still works

`PATCH /modifier-groups/{group_id}` with a `modifiers` array still replaces all modifiers in the group atomically. Use individual CRUD for single-item edits; use bulk-replace when reordering or overhauling a group.

---

## HR: Cash Sessions

Cash sessions track the cash drawer for each business day. A manager opens the drawer with an opening float at the start of service and closes it with the closing float at the end. Only one session can be open per store at a time.

---

### GET /hr/cash-sessions/current
- **Purpose**: Returns the currently open cash session for the store, or `null` if none is open
- **Auth**: Any authenticated store user (intentionally open — POS UI needs this to check state)
- **Response** (200):
  ```json
  {
    "id": "cuid",
    "store_id": "cuid",
    "opened_by_id": "cuid",
    "closed_by_id": null,
    "cash_open": "500.00",
    "cash_close": null,
    "opened_at": "2026-05-05T02:00:00Z",
    "closed_at": null,
    "notes": "Opening shift",
    "created_at": "2026-05-05T02:00:00Z",
    "updated_at": "2026-05-05T02:00:00Z"
  }
  ```
  Returns `null` (HTTP 200, body `null`) if no session is open.

---

### GET /hr/cash-sessions
- **Purpose**: List recent cash sessions (last 50, newest first)
- **Auth**: Manager / Owner
- **Response** (200): Array of `CashSessionRead` (same shape as above, with `closed_at` and `cash_close` populated on closed sessions)

---

### POST /hr/cash-sessions
- **Purpose**: Open a new cash session with an opening float
- **Auth**: Manager / Owner
- **Request**:
  ```json
  {
    "cash_open": "500.00",
    "notes": "Morning shift opening"
  }
  ```
- **Response** (201): `CashSessionRead`
- **Errors**: 409 Conflict if a session is already open for this store; 403 if insufficient role
- **Notes**: `notes` is optional. `cash_open` must be `>= 0`.

---

### PATCH /hr/cash-sessions/{session_id}/close
- **Purpose**: Close an open cash session with the closing float amount
- **Auth**: Manager / Owner
- **Request**:
  ```json
  {
    "cash_close": "480.00",
    "notes": "End of day — 20 baht discrepancy noted"
  }
  ```
- **Response** (200): `CashSessionRead` (now with `closed_at` and `cash_close` populated)
- **Errors**: 409 if session is already closed; 404 if session not found; 403 if insufficient role

---

## HR: Staff Tasks (Kanban)

A simple task board for managers to assign work to staff. Staff can progress tasks through the workflow; only managers can mark them `DONE`.

### Task lifecycle

```
TODO → IN_PROGRESS → PENDING_REVIEW → DONE
```

- **Staff** can move tasks to `IN_PROGRESS` or `PENDING_REVIEW` only.
- **Managers** can move to any status including `DONE`, or use the dedicated `/confirm` endpoint.
- Staff see only tasks assigned to them. Managers see all store tasks.

---

### GET /hr/tasks
- **Purpose**: List tasks; non-managers see only their assigned tasks
- **Auth**: Any authenticated store user
- **Query params**: `?status=TODO|IN_PROGRESS|PENDING_REVIEW|DONE` (optional filter)
- **Response** (200):
  ```json
  [
    {
      "id": "cuid",
      "store_id": "cuid",
      "assignee_id": "cuid",
      "assignee_name": "Alice",
      "created_by_id": "cuid",
      "title": "Restock sugar station",
      "description": "Top up all sugar dispensers before 9am",
      "status": "TODO",
      "due_date": "2026-05-06",
      "created_at": "2026-05-05T10:00:00Z",
      "updated_at": "2026-05-05T10:00:00Z"
    }
  ]
  ```
- **Notes**: `assignee_id` and `assignee_name` are `null` for unassigned tasks.

---

### POST /hr/tasks
- **Purpose**: Create a new task, optionally assigning it to a staff member
- **Auth**: Manager / Owner
- **Request**:
  ```json
  {
    "title": "Restock sugar station",
    "description": "Top up all sugar dispensers before 9am",
    "assignee_id": "cuid_of_staff",
    "due_date": "2026-05-06"
  }
  ```
- **Response** (201): `TaskRead`
- **Notes**: `description`, `assignee_id`, `due_date` all optional. New tasks always start with `status: "TODO"`.

---

### PATCH /hr/tasks/{task_id}
- **Purpose**: Update a task's fields or move its status
- **Auth**: Any authenticated store user (with role-based restrictions on `status`)
- **Request** (all fields optional):
  ```json
  {
    "title": "Restock sugar station",
    "description": "Updated description",
    "assignee_id": "cuid",
    "status": "IN_PROGRESS",
    "due_date": "2026-05-07"
  }
  ```
- **Response** (200): `TaskRead`
- **Errors**:
  - 403 if a non-manager attempts to set `status: "DONE"` — use `PENDING_REVIEW` instead
  - 404 if task not found

---

### PATCH /hr/tasks/{task_id}/confirm
- **Purpose**: Manager confirms a `PENDING_REVIEW` task as `DONE`
- **Auth**: Manager / Owner
- **Request**: No body required
- **Response** (200): `TaskRead` with `status: "DONE"`
- **Errors**: 409 if task is not in `PENDING_REVIEW` state; 403 if insufficient role

---

### DELETE /hr/tasks/{task_id}
- **Purpose**: Hard-delete a task
- **Auth**: Manager / Owner
- **Response**: 204 No Content
- **Notes**: This is a **hard delete**. There is no soft-delete for tasks.

---

## HR: Shifts — Breaking Change

`shift_type` (enum: `MORNING`, `AFTERNOON`, `EVENING`, `FULL_DAY`, `OFF`) has been **removed**. Shifts now use explicit time fields.

### ShiftCreate — updated request

```json
{
  "user_id": "cuid",
  "assignment_date": "2026-05-06",
  "start_time": "08:00:00",
  "end_time": "16:00:00",
  "notes": "Covers morning rush"
}
```

### ShiftRead — updated response

```json
{
  "id": "cuid",
  "store_id": "cuid",
  "user_id": "cuid",
  "user_name": "Alice",
  "assignment_date": "2026-05-06",
  "start_time": "08:00:00",
  "end_time": "16:00:00",
  "notes": "Covers morning rush",
  "created_by_id": "cuid",
  "created_at": "2026-05-05T10:00:00Z",
  "updated_at": "2026-05-05T10:00:00Z"
}
```

Replace any shift-type dropdown UI with start/end time pickers. Times are store-local (no timezone).

---

## Data Models / DTOs

```typescript
interface InventoryItemRead {
  id: string;
  name: string;
  unit: string;
  cost_per_unit: string;        // Decimal string, 4dp
  stock_on_hand: string;        // Decimal string, 3dp
  par_level: string;            // Decimal string, 3dp
  is_active: boolean;
  expiry_date: string | null;   // ISO date "YYYY-MM-DD"
  unit_size: string | null;     // Decimal string — units per purchase pack
  piece_price: string | null;   // Decimal string — cost per individual piece
  status: "ok" | "low" | "critical";
}

interface SupplierHistoryItem {
  supplier: string | null;
  unit_cost: string | null;     // Decimal string
  quantity: string;             // Decimal string
  received_at: string;          // ISO 8601 datetime
  note: string | null;
}

interface ModifierRead {
  id: string;
  name: string;
  price_delta: string;          // Decimal string — positive = surcharge, negative = discount
  inventory_item_id: string | null;
  inventory_qty: string | null;
  sort_order: number;
  is_active: boolean;
}

interface CashSessionRead {
  id: string;
  store_id: string;
  opened_by_id: string;
  closed_by_id: string | null;
  cash_open: string;            // Decimal string, 2dp
  cash_close: string | null;    // null until session is closed
  opened_at: string;            // ISO 8601 datetime
  closed_at: string | null;     // null until session is closed
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface TaskRead {
  id: string;
  store_id: string;
  assignee_id: string | null;
  assignee_name: string | null;
  created_by_id: string;
  title: string;
  description: string | null;
  status: "TODO" | "IN_PROGRESS" | "PENDING_REVIEW" | "DONE";
  due_date: string | null;      // ISO date "YYYY-MM-DD"
  created_at: string;
  updated_at: string;
}

interface ShiftRead {
  id: string;
  store_id: string;
  user_id: string;
  user_name: string;
  assignment_date: string;      // ISO date "YYYY-MM-DD"
  start_time: string;           // "HH:MM:SS" — store-local, no timezone
  end_time: string;             // "HH:MM:SS" — store-local, no timezone
  notes: string | null;
  created_by_id: string;
  created_at: string;
  updated_at: string;
}
```

---

## Enums & Constants

### TaskStatus

| Value | Meaning | Who can set |
|---|---|---|
| `TODO` | Not started | Auto-set on create |
| `IN_PROGRESS` | Staff picked it up | Any staff, manager |
| `PENDING_REVIEW` | Staff done, awaiting sign-off | Any staff, manager |
| `DONE` | Confirmed complete | Manager / Owner only |

### ItemStatus (computed, not stored)

| Value | Condition |
|---|---|
| `ok` | `stock_on_hand >= par_level` |
| `low` | `stock_on_hand < par_level` but `>= 50% of par_level` |
| `critical` | `stock_on_hand < 50% of par_level` |

### WastageReason

| Value | Display Label |
|---|---|
| `EXPIRED` | Expired |
| `SPILLED` | Spilled |
| `TRIAL` | Trial / Testing |
| `DAMAGED` | Damaged |
| `OTHER` | Other |

### LeaveStatus / LeaveType — unchanged

`PENDING`, `APPROVED`, `REJECTED` / `VACATION`, `SICK`, `PERSONAL`, `OTHER`

---

## Validation Rules

### Inventory
- `name`: 1–120 chars; `unit`: 1–24 chars
- `par_level`: 0–9,999,999.999; `cost_per_unit`: 0–99,999.9999
- `unit_size` and `piece_price` must both be provided or both omitted — sending only one → 422
- `unit_size` must be `> 0`; `piece_price` >= 0
- `expiry_date`: any valid ISO date (past dates allowed — use `/expired` to surface them)

### Modifiers
- `name`: 1–80 chars; `price_delta`: -9,999.99 to 9,999.99
- `inventory_qty` must be `> 0` if provided

### Cash Sessions
- `cash_open` / `cash_close`: >= 0, max 2 decimal places
- Only one open session allowed per store at a time → 409 on second open

### Tasks
- `title`: 1–200 chars; `description`: max 2,000 chars
- Non-managers cannot set `status: "DONE"` → 403
- `confirm` endpoint requires task in `PENDING_REVIEW` → 409 otherwise

### Shifts
- `start_time` / `end_time`: `"HH:MM:SS"` format — store-local time assumed

---

## Business Logic & Edge Cases

- **`unit_size` / `piece_price` coupling** — always null together or set together. If `piece_price` is set, show it on the ingredient detail view (useful for per-unit COGS). Fall back to `cost_per_unit` when null.
- **`status` on InventoryItemRead is computed** at serialization time, not stored. Always derive from `stock_on_hand` vs `par_level`; don't cache or persist it.
- **Supplier history** is derived from `RECEIVE` movements only — orders, waste, and adjustments do not appear.
- **Cash session `null` response** — `GET /hr/cash-sessions/current` returns HTTP 200 with JSON body `null` when no session is open. Handle this explicitly; don't treat `null` as a network error.
- **Only one open cash session per store** — UI should check `/current` before offering an "Open" button, and hide it if a session is already open.
- **Task visibility split** — staff users see only tasks where `assignee_id == their user_id`. Unassigned tasks are invisible to staff; only managers see all tasks.
- **`DONE` is manager-only** — staff should submit via `PENDING_REVIEW` and wait for manager confirmation via `/confirm`.
- **Task delete is hard** — no recycle bin. Use status transitions for completed work; delete only for genuinely invalid tasks.
- **Modifier `is_active: false`** — hides from POS without removing history. Use for "temporarily unavailable" options. Hard-delete via `DELETE` if the option will never return.
- **`price_delta` can be negative** (discount modifier). Display as `+THB X` for positive and `−THB X` for negative in the order screen.
- **Shift model is a breaking change** — `shift_type` no longer exists in any request or response. Replace dropdown UI with time pickers.

---

## Integration Notes

### Recommended Flows

**Start-of-day (manager)**:
1. `GET /hr/cash-sessions/current` — confirm no session is open
2. `POST /hr/cash-sessions` — enter opening float

**End-of-day (manager)**:
1. `GET /hr/cash-sessions/current` — get session ID
2. `PATCH /hr/cash-sessions/{id}/close` — enter closing float

**POS startup**:
- Call `GET /hr/cash-sessions/current` at app load; show warning or block sale flow if `null`, per store policy.

**Expired stock alert**:
- Call `GET /inventory/expired` on inventory dashboard load; show badge if array is non-empty.

**Task board (kanban)**:
- Fetch by column: `GET /hr/tasks?status=TODO`, `?status=IN_PROGRESS`, etc.
- Staff progresses card: `PATCH /hr/tasks/{id}` → `IN_PROGRESS` or `PENDING_REVIEW`
- Manager confirms: `PATCH /hr/tasks/{id}/confirm`

### Optimistic UI
- Safe for task status transitions (low-risk, reversible).
- **Not recommended** for cash session open/close — always confirm server response before updating UI state.

### Caching
- Inventory list: short-lived cache acceptable (30–60s). Invalidate on receive, waste, adjust, or delete.
- Cash session current: do not cache — stale state causes UX issues.
- Tasks: no caching — staff expect real-time board state.

---

## Test Scenarios

1. **Inventory — unit size** — create item with both `unit_size` and `piece_price`; verify both appear in response.
2. **Inventory — unit size validation** — send only `unit_size` without `piece_price` → 422.
3. **Expired items** — create item with past `expiry_date`; appears in `GET /inventory/expired`; item with future date does not.
4. **Inventory soft-delete** — DELETE returns 204; default list excludes it; `?is_active=false` includes it.
5. **Supplier history** — receive twice with different suppliers; history returns both entries.
6. **Manager-only inventory** — DELETE, supplier-history, adjust, update all return 403 for BARISTA.
7. **Add modifier** — POST to group; item appears in subsequent `GET /modifier-groups`.
8. **Patch modifier** — PATCH `price_delta`; other fields unchanged.
9. **Deactivate modifier** — PATCH `is_active: false`; modifier still in group response but flagged inactive.
10. **Delete modifier** — 204; gone from group response.
11. **Modifier wrong group** — PATCH or DELETE with mismatched `group_id`/`modifier_id` → 404.
12. **Cash session open/close** — open, verify `closed_at: null`; close, verify `closed_at` and `cash_close` populated.
13. **Double-open** — open, attempt second open → 409.
14. **Close already closed** — → 409.
15. **Current when none open** — 200, body `null`.
16. **Staff cannot open/close** — BARISTA role → 403.
17. **Task happy path** — create → staff moves to IN_PROGRESS → PENDING_REVIEW → manager confirms → DONE.
18. **Staff tries DONE** — PATCH `status: DONE` as BARISTA → 403.
19. **Confirm wrong status** — confirm on TODO task → 409.
20. **Task visibility** — staff sees only own assigned tasks; unassigned tasks not returned.
21. **Filter by status** — `?status=PENDING_REVIEW` returns only those tasks.
22. **Task delete** — 204; gone from subsequent list.
