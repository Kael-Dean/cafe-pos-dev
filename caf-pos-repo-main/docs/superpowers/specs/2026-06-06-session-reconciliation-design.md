# Session Reconciliation — Design Spec
_Date: 2026-06-06_

## Overview

Extend the cash session close flow so managers can record the actual amount received per payment method group, compare against system totals, and add notes on variances. All reconciliation data is persisted for use in monthly and periodic sales reports.

---

## Data Model

### `Store.payment_groups` (new column)

Nullable JSON column on the existing `stores` table. Stores an ordered list of payment group definitions. If null, the two-bucket default is used everywhere.

**Default value:**
```json
[
  {"name": "Cash", "methods": ["CASH"]},
  {"name": "Online", "methods": ["CARD", "QR_PROMPTPAY", "LINE_PAY", "TRUEMONEY", "OTHER"]}
]
```

**Invariant:** every `PaymentMethod` enum value must appear in exactly one group. Enforced at write time by the PATCH endpoint.

### `session_payment_entries` (new table)

One row per payment group per closed session.

| Column | Type | Constraints |
|---|---|---|
| `id` | String(24) | PK, CUID |
| `session_id` | String(24) | FK → cash_sessions CASCADE |
| `store_id` | String(24) | FK → stores CASCADE (for report queries) |
| `group_name` | String(100) | snapshot at close time |
| `methods` | JSON | snapshot of method list at close time |
| `system_total` | Numeric(12,2) | sum of PAID orders in session window |
| `actual_amount` | Numeric(12,2) | entered by tenant |
| `variance` | Numeric(12,2) | actual − system, stored |
| `notes` | Text | nullable, tenant comment |

Indexes: `(session_id)`, `(store_id)`.

**Why snapshot `group_name` and `methods`:** reconfiguring groups after the fact must not alter historical entries.

### `CashSession` changes

`cash_close` remains nullable and is no longer populated by the new close flow. No migration needed — existing closed sessions keep their `cash_close` value.

---

## Migration

1. `ALTER TABLE stores ADD COLUMN payment_groups JSONB` (nullable, no default — application supplies default at runtime).
2. `CREATE TABLE session_payment_entries` with columns above.
3. No data backfill needed.

---

## API

All endpoints are added to the existing `/hr` router (`api/app/api/v1/hr.py`). Role guard reuses existing `_MANAGER_PLUS` and `_BARISTA_PLUS` constants.

### `GET /hr/payment-groups`
_Any authenticated store user._

Returns the store's current payment group config (or the 2-bucket default if unset).

**Response:**
```json
[
  {"name": "Cash", "methods": ["CASH"]},
  {"name": "Online", "methods": ["CARD", "QR_PROMPTPAY", "LINE_PAY", "TRUEMONEY", "OTHER"]}
]
```

### `PATCH /hr/payment-groups`
_MANAGER+._

Replaces the store's payment group config. Validates that every `PaymentMethod` value appears in exactly one group. Returns the updated config.

**Request body:**
```json
[
  {"name": "Cash", "methods": ["CASH"]},
  {"name": "Card", "methods": ["CARD"]},
  {"name": "QR / Wallet", "methods": ["QR_PROMPTPAY", "LINE_PAY", "TRUEMONEY"]},
  {"name": "Other", "methods": ["OTHER"]}
]
```

**Errors:** `422 Unprocessable` if any method is missing or appears in more than one group.

### `GET /hr/cash-sessions/{session_id}/summary`
_MANAGER+._

Available on open and closed sessions. Queries `PAID` orders with `created_at BETWEEN session.opened_at AND (session.closed_at OR now())`, groups by `payment_method`, buckets into the store's configured groups.

**Response:**
```json
{
  "session_id": "abc123",
  "period": {"from": "2026-06-06T08:00:00+07:00", "to": "2026-06-06T20:14:00+07:00"},
  "groups": [
    {"name": "Cash", "methods": ["CASH"], "system_total": "4250.00"},
    {"name": "Online", "methods": ["CARD", "QR_PROMPTPAY", "LINE_PAY", "TRUEMONEY", "OTHER"], "system_total": "12800.50"}
  ]
}
```

### `PATCH /hr/cash-sessions/{session_id}/close`
_MANAGER+. Replaces current close endpoint._

**Request body:**
```json
{
  "entries": [
    {"group_name": "Cash", "actual_amount": "4100.00", "notes": "Missing 150 baht — recount tomorrow"},
    {"group_name": "Online", "actual_amount": "12800.50", "notes": null}
  ]
}
```

**Service logic (single transaction):**
1. Load and lock the session — raise `409` if already closed.
2. Query PAID orders in the session window, sum by payment_method.
3. Apply payment group config to compute `system_total` per group.
4. For each entry: compute `variance = actual_amount − system_total`, insert `SessionPaymentEntry` row.
5. Set `session.closed_by_id`, `session.closed_at = now()`.
6. Commit.

**Validation:** `entries` must contain exactly one entry per configured group (matched by `group_name`). Returns `422` if any group is missing or an unknown group name is submitted.

**Response:** full `CashSessionRead` (unchanged shape) plus embedded `entries` list.

---

## Schemas (Pydantic)

```
PaymentGroupDefinition   — name: str, methods: list[PaymentMethod]
PaymentGroupSummaryItem  — name, methods, system_total
SessionSummaryRead       — session_id, period, groups: list[PaymentGroupSummaryItem]
ReconciliationEntry      — group_name, actual_amount, notes?
CashSessionCloseV2       — entries: list[ReconciliationEntry]
SessionPaymentEntryRead  — id, session_id, group_name, methods, system_total, actual_amount, variance, notes
CashSessionRead          — extended with entries: list[SessionPaymentEntryRead]
```

---

## File Changes

| File | Change |
|---|---|
| `models/hr.py` | Add `SessionPaymentEntry` model |
| `models/tenancy.py` | Add `payment_groups` JSON column to `Store` |
| `models/__init__.py` | Import `SessionPaymentEntry` |
| `schemas/hr.py` | Add new schemas above |
| `services/hr.py` | Add `get_payment_groups`, `set_payment_groups`, `get_session_summary`, replace `close_cash_session` |
| `api/v1/hr.py` | Add 2 new routes, replace close route |
| `alembic/versions/` | New migration |
| `tests/test_session_reconciliation.py` | New test file |

---

## Testing

| Test | Type |
|---|---|
| `get_payment_groups` returns default when store has none set | service |
| `set_payment_groups` rejects config missing a PaymentMethod | service |
| `set_payment_groups` rejects config with duplicate method | service |
| `get_session_summary` correctly buckets orders by group | service |
| `get_session_summary` on closed session uses closed_at bound | service |
| `close_cash_session` persists correct system_total and variance | service |
| `close_cash_session` raises 409 if already closed | service |
| `close_cash_session` raises 422 if entry group_name unknown | service |
| `GET /hr/payment-groups` returns 200 | HTTP |
| `PATCH /hr/payment-groups` requires MANAGER role | HTTP |
| `GET /hr/cash-sessions/{id}/summary` returns correct totals | HTTP |
| `PATCH /hr/cash-sessions/{id}/close` with entries closes session | HTTP |
