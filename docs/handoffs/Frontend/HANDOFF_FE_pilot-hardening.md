# API Handoff: Pilot Hardening (Train B)

> **Source:** backend PR #2 `feat/pilot-hardening` → `dev` (18 commits, no migrations), received 2026-08-28.
> **Archived from** `2026-08-28-pilot-hardening-handoff.md`. The original file reached us with a
> UTF-8/latin-1 encoding fault, so Thai example values in it were unreadable — they are written
> out properly here. No technical content was changed. Reply to the open questions:
> [HANDOFF_BE_pilot-hardening-questions.md](../Backend/HANDOFF_BE_pilot-hardening-questions.md).

## Business Context

Before the pilot cafe goes live the backend closed a set of platform-hardening and core-POS gaps.
Most of it is invisible to the UI (proxy-aware rate limiting, hashed emails in logs, tenant-isolation
fixes, a report timezone fix). Four things **do** change what the frontend sees or can build:

1. **One 429 shape everywhere** — the per-IP limiter and the new per-email admin login throttle both
   return the standard error envelope with code `TOO_MANY_REQUESTS`. The old `RATE_LIMITED` code is gone.
2. **Admin can edit a tenant's legal/billing details** — `PATCH /admin/tenants/{tenant_id}`.
3. **Package feature keys are validated against a registry** — typos now fail with a 422 that names
   the bad key; the frontend should offer a picker, not a free-text field.
4. **Expired-stock confirmation** — `POST /inventory/expired/waste` turns the existing "expired lots"
   list into a one-tap "confirm as wasted" flow with a per-lot skip report.

The branch was **not merged** when this arrived — build against staging once it lands.

All endpoints are under `/api/v1`. POS endpoints take the staff `Authorization: Bearer <token>`;
admin endpoints take the **platform-realm** admin token.

---

## Error envelope — what changed

Unchanged shape, one renamed code:

```json
{ "error": { "code": "TOO_MANY_REQUESTS", "message": "Rate limit exceeded: 5 per 1 minute" } }
```

| HTTP | `code` | Emitted by |
|---|---|---|
| 429 | `TOO_MANY_REQUESTS` | per-IP limiter (any rate-limited route, e.g. `POST /auth/login` 5/min) — message `Rate limit exceeded: …`, headers `Retry-After`, `X-RateLimit-*` |
| 429 | `TOO_MANY_REQUESTS` | admin per-email throttle (`POST /admin/auth/login`) — message `Too many attempts, try again later`, **no** `Retry-After` header (window is 15 min) |

- **Remove any match on `RATE_LIMITED`.** It was documented but never actually emitted; it no longer exists.
- Previously the per-IP 429 body was slowapi's raw `{"error": "Rate limit exceeded: …"}` (a string, no
  `code`). It is now the envelope above. Delete any special case for that shape.
- Validation errors (`422 UNPROCESSABLE_ENTITY`) are unchanged in shape; `details[].ctx` values that are
  decimals are still **strings** (e.g. `"0"`), not numbers — pinned deliberately.

---

## Endpoints

### POST /api/v1/admin/auth/login — behaviour change only
- **Purpose**: unchanged (platform admin login).
- **New**: a **per-email** throttle in addition to the per-IP limit. **5 failed attempts for the same
  email within 15 minutes → 429** on every further attempt for that email — *including attempts with
  the correct password* — until the window expires. A successful login resets the counter. Email
  matching is case-insensitive.
- **Errors**: `401 UNAUTHORIZED` invalid credentials (unchanged, deliberately identical for
  unknown/wrong/deactivated); `429 TOO_MANY_REQUESTS` from either layer — distinguish by `message`
  if you need different copy.
- **Notes**: show "too many attempts — wait 15 minutes" for the throttle message and "wait a minute"
  for the IP-limit message. The throttle is per email, not per device: another admin can still log in
  from the same browser.

### PATCH /api/v1/admin/tenants/{tenant_id}
- **Purpose**: correct a tenant's legal/billing fields after creation.
- **Auth**: platform admin (admin realm). POS staff tokens → `401`.
- **Request** (all optional; send only what changed; **unknown keys are rejected**):
  ```json
  {
    "name": "string — 1..120, cannot be null",
    "legal_name": "string|null — max 255",
    "tax_id": "string|null — max 20",
    "billing_email": "email|null",
    "billing_address": "string|null — max 500"
  }
  ```
  Sending `null` **clears** a nullable field; omitting a key leaves it untouched (`exclude_unset`).
- **Response** (200): the updated `TenantRead` (now includes `billing_address`).
- **Errors**: `404 NOT_FOUND` unknown tenant; `422 UNPROCESSABLE_ENTITY` for `{}` (message
  `No fields to update`), for `slug` / `package_key` / any extra key, for invalid email or over-length
  values; `409 CONFLICT` if `name` is sent as `null` (backend will tighten this to 422 later — treat
  both as "name required").
- **Notes**: `slug` is immutable (URLs, uniqueness) and `package_key` changes only via
  `PUT /admin/tenants/{id}/package`. Every successful PATCH writes an audit row `tenant.update` whose
  `before`/`after` contain **only the changed keys**.

### POST /api/v1/admin/packages · PATCH /api/v1/admin/packages/{key} — behaviour change only
- **New validation**: `feature_keys` must be a subset of the registered feature keys. The registry is
  currently exactly:

  | key | meaning |
  |---|---|
  | `vertical.boardgame` | Board game cafe add-on (floor, sessions, time billing, library, reservations, guest ordering) |

- **Errors**: `422 UNPROCESSABLE_ENTITY`, message `Unknown feature keys: <comma-separated, sorted>`
  e.g. `Unknown feature keys: vertical.bordgame`. On PATCH, `"feature_keys": null` → `422` (omit the
  key to leave it unchanged; send `[]` to clear).
- **Notes**: render feature keys as a **multi-select from a fixed list**, not free text. There is no
  "list registered keys" endpoint yet — hard-code the table above and surface the 422 message verbatim
  if it ever disagrees (that means the backend added a key you don't know).

### GET /api/v1/inventory/expired — unchanged, documented here for the flow
- **Purpose**: lots whose `expiry_date` has passed and still have stock.
- **Auth**: any staff role.
- **Response** (200):
  ```json
  [
    { "lot_id": "cuid", "inventory_item_id": "cuid", "inventory_item_name": "นมสด", "unit": "L",
      "qty_remaining": "12.500", "expiry_date": "2026-08-25" }
  ]
  ```
  Sorted by `expiry_date` ascending. `qty_remaining` is a decimal string (3 dp).
- **Notes**: "expired" here is evaluated against the **server's calendar date** (UTC on Railway), while
  the confirm endpoint below uses **Bangkok** — between 00:00 and 07:00 Bangkok a lot that expired
  "yesterday" may be accepted by the confirm call before it shows in this list. Harmless (nothing
  listed is ever wrongly skipped); backend follow-up will align the list to Bangkok.

### POST /api/v1/inventory/expired/waste
- **Purpose**: confirm a batch of expired lots as wasted — for each accepted lot, writes a `WASTE`
  stock movement for the full remaining quantity, deducts stock on hand, and zeroes the lot.
- **Auth**: OWNER / MANAGER / BARISTA / BAKER (same gate as `POST /inventory/waste`).
- **Request**:
  ```json
  { "lot_ids": ["cuid", "cuid"] }
  ```
  `lot_ids`: 1..200 ids; duplicates are de-duplicated (first occurrence wins).
- **Response** (200):
  ```json
  {
    "wasted": ["lot_1", "lot_2"],
    "skipped": [
      { "lot_id": "lot_3", "reason": "not_expired" },
      { "lot_id": "lot_4", "reason": "empty" },
      { "lot_id": "lot_9", "reason": "not_found" }
    ]
  }
  ```
- **Errors**: `422 UNPROCESSABLE_ENTITY` for empty list / >200 ids / malformed body. There is **no**
  404 or 409 for individual lots — per-lot problems come back in `skipped`, the call itself is 200.
- **Notes**:
  - Skip reasons: `not_found` = lot doesn't exist **or belongs to another store** (deliberately
    indistinguishable); `not_expired` = `expiry_date` is null or ≥ today (Bangkok); `empty` =
    `qty_remaining` is already 0 (a second confirm of the same lot lands here — safe to re-post a
    stale list).
  - The movement's reason is recorded as `EXPIRED` with note `auto — confirmed expiry`; it appears in
    the wastage report under reason `EXPIRED`.
  - The whole batch is one transaction: if the request fails (5xx), nothing was wasted.
  - Lots on **inactive (soft-deleted) inventory items are wasted, not skipped** — pending a product
    decision; if that changes a fourth reason `inactive_item` will be added. Don't hard-fail on an
    unknown `reason` value.
  - Batch confirm can drive stock on hand **negative** if a manual adjustment already consumed the
    lot's quantity — the backend logs a warning and proceeds (same as `/inventory/waste`).

### POST /api/v1/orders · POST/PATCH /api/v1/pre-orders — behaviour change only
- **New**: `customer_id` must belong to the caller's store. A customer id from another store (or a
  non-existent one) → `404 NOT_FOUND`, message `Customer not found` — identical to a missing customer,
  by design.
- **Notes**: only reachable if the UI passes an id it didn't get from this store's customer endpoints;
  treat it as "customer no longer exists → clear the selection and retry".

---

## Data Models / DTOs

```typescript
// Admin
interface TenantUpdate {            // PATCH body — all optional, extra keys rejected
  name?: string;                    // 1..120, never null
  legal_name?: string | null;       // ≤255
  tax_id?: string | null;           // ≤20
  billing_email?: string | null;    // valid email
  billing_address?: string | null;  // ≤500
}
interface TenantRead {              // unchanged + billing_address
  id: string; name: string; slug: string;
  legal_name: string | null; tax_id: string | null;
  billing_email: string | null; billing_address: string | null;
  package_key: string | null; is_active: boolean; suspended_at: string | null; // ISO 8601
}

// Inventory
interface ExpiredLotRead {
  lot_id: string; inventory_item_id: string; inventory_item_name: string;
  unit: string; qty_remaining: string; /* decimal, 3 dp */ expiry_date: string; /* YYYY-MM-DD */
}
interface ExpiredWasteRequest { lot_ids: string[]; } // 1..200
type ExpiredWasteSkipReason = 'not_found' | 'not_expired' | 'empty';
interface ExpiredWasteResult {
  wasted: string[];                                      // lot ids
  skipped: { lot_id: string; reason: ExpiredWasteSkipReason }[];
}

// Errors
interface ErrorEnvelope { error: { code: string; message: string; details?: unknown[] } }
```

## Enums & Constants

| Value | Meaning | Display label (TH / EN) |
|---|---|---|
| `TOO_MANY_REQUESTS` | rate limited (IP) or throttled (email) | ขอบ่อยเกินไป / Too many attempts |
| `not_found` | lot missing or not this store's | ไม่พบล็อต / Lot not found |
| `not_expired` | lot not yet expired (Bangkok date) | ยังไม่หมดอายุ / Not expired |
| `empty` | lot already at 0 | บันทึกแล้ว / Already wasted |
| `vertical.boardgame` | the only registered feature key today | บอร์ดเกมคาเฟ่ / Board game cafe |

## Validation Rules (mirror client-side)

- Tenant PATCH: at least one field; `name` 1–120 and not null; `legal_name` ≤255; `tax_id` ≤20 (Thai
  tax id is 13 digits — backend does **not** enforce the format, UI may); `billing_email` RFC email;
  `billing_address` ≤500. Never send `slug` or `package_key`.
- Package `feature_keys`: subset of the registry; `[]` allowed; `null` not allowed on PATCH.
- Expired waste: 1–200 lot ids; UI should only submit ids taken from the current
  `GET /inventory/expired` response.

## Business Logic & Edge Cases

- **Admin throttle is per email, counts failures only, and blocks the correct password too** until
  15 min pass. There is no unlock endpoint — copy should say "wait 15 minutes", not "reset your password".
- Two 429 sources share one code; distinguish by `message` / presence of `Retry-After` for different copy.
- Tenant PATCH audit rows contain only changed keys — an audit viewer should not expect the full object.
- `feature_keys` typos used to save silently (and sold nothing); they now fail loudly — expect 422s on
  old drafts that used ad-hoc keys like `inventory`, `reports`.
- Expired-waste is idempotent per lot via `empty`; a stale list re-posted after another cashier
  confirmed it is safe.
- Wastage report by-day buckets are now **Bangkok calendar days**; if you were compensating for a UTC
  shift in the chart, remove it.

## Integration Notes

- **Recommended flow (expired stock)**: `GET /inventory/expired` → confirm screen with checkboxes
  (default all) → `POST /inventory/expired/waste` → show `wasted.length` + per-lot skip reasons →
  re-fetch the list.
- **Optimistic UI**: not for expired-waste (skips are common on stale lists); fine for tenant PATCH
  (response echoes the full tenant).
- **Caching**: none; re-fetch after mutations.
- **Real-time**: none of these endpoints emit Pusher events.

## Test Scenarios

1. **Admin throttle**: 5 wrong passwords for `a@b.c` → 6th with the *right* password → 429
   `TOO_MANY_REQUESTS`; a different email still gets 401.
2. **IP limit envelope**: 6 rapid `POST /auth/login` → 429 with `error.code === "TOO_MANY_REQUESTS"`
   and a `Retry-After` header.
3. **Tenant PATCH happy path**: change `name` + `tax_id` → 200, both fields updated,
   `billing_address` present in the body.
4. **Tenant PATCH rejects**: `{}` → 422; `{"slug": "x"}` → 422; unknown id → 404; POS token → 401.
5. **Package typo**: `feature_keys: ["vertical.bordgame"]` → 422 whose message names `vertical.bordgame`.
6. **Expired waste mixed batch**: 2 expired + 1 future-dated + 1 already-empty + 1 foreign id →
   `wasted` has 2, `skipped` has 3 with the right reasons; stock on hand dropped by the two lots'
   quantities.
7. **Expired waste re-post**: same ids again → all `empty`, nothing double-deducted.
8. **Foreign customer**: create an order with another store's `customer_id` → 404 `Customer not found`.

## Open Questions / TODOs (from the backend)

- **Inactive items** in expired-waste: wasted today; may become a 4th skip reason `inactive_item`.
- `GET /inventory/expired` uses the server date, the confirm uses Bangkok — backend follow-up to align.
- `TenantUpdate.name = null` → 409 today, will become 422.
- No "list registered feature keys" endpoint — say if the admin portal wants one.

Answers: [HANDOFF_BE_pilot-hardening-questions.md](../Backend/HANDOFF_BE_pilot-hardening-questions.md).

---

## Frontend status (2026-08-28)

| Item | Status |
|---|---|
| `POST /inventory/expired/waste` confirm flow | **Built** — `ExpiredWasteModal` in `app/src/components/screens/inventory.tsx`, `useExpiredWaste()` in `app/src/hooks/use-inventory.ts` |
| Wastage report Bangkok buckets | **No change needed** — the frontend never compensated; a comment now pins that |
| 429 envelope / `RATE_LIMITED` removal | Not started. Nothing in either app matched on `RATE_LIMITED`, so there is no regression — `ApiError` currently discards `error.code` entirely |
| Admin `PATCH /admin/tenants/{id}` | Not started |
| Admin `feature_keys` picker | Not started — still a free-text textarea |
| `customer_id` 404 handling in POS | Not started — a dead id is currently re-injected on retry |
