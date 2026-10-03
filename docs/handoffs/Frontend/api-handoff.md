# API Handoff: Multi-Branch Personnel Access

## Business Context

Staff at สกต.สุรินทร์ are normally scoped to a single branch (`branch_location` on their account). This feature allows a Super Admin to grant a user access to additional branches. The user can then **switch their active branch** — all existing branch-filtered API endpoints will automatically return data for the switched branch, using the same token they already have.

The active branch is encoded in the JWT, so **the frontend must replace the stored token** after a successful switch. No changes are needed to other API calls — they already read `branch` from the token.

---

## Implementation Status

All endpoints are **live on `master`** as of commit `532a157`. The `personnel_branch_assignments` table is applied to production.

---

## Auth

- All endpoints require a valid Bearer token.
- Admin CRUD endpoints (`/admin/personnel/...`) require `role_id = 1` (Super Admin). All others are available to any authenticated user.

---

## New JWT Claims

| Claim | Type | Description |
|---|---|---|
| `branch` | `int` | **Active** branch — the one the user is currently viewing. Changes after a switch. |
| `home_branch` | `int` | The user's permanent home branch. Never changes. |

The existing `branch` claim is unchanged in meaning. `home_branch` is new. If the frontend decodes the token (e.g. for UI display), both claims are now available.

---

## Endpoint Reference

### 1. List My Accessible Branches

```
GET /auth/my-branches
Authorization: Bearer <token>
```

Returns all branches the calling user can switch to. Super Admins see every active branch.

**Response `200`:**
```json
[
  { "id": 1, "branch_name": "สาขาสุรินทร์", "is_home": true },
  { "id": 3, "branch_name": "สาขาท่าตูม", "is_home": false }
]
```

- `is_home: true` marks the user's permanent home branch.
- Only active branches (`is_active = true`) are returned.
- If only one branch is returned, the branch switcher UI can be hidden.

---

### 2. Switch Active Branch

```
POST /auth/switch-branch
Authorization: Bearer <token>
Content-Type: application/json

{ "branch_id": 3 }
```

Validates that the user has access to the requested branch, then returns a **new token** with `branch` set to the requested branch.

**Response `200`:**
```json
{
  "access_token": "<new JWT>",
  "token_type": "bearer"
}
```

**⚠️ The frontend must replace the stored token with this new one.** All subsequent requests should use the new token. The old token remains valid until its own expiry — but it still carries the old branch.

**Error responses:**
| Status | Reason |
|---|---|
| `403` | Branch not in user's allowed list, branch is inactive, or account is `new` (password not yet changed) |
| `404` | Branch does not exist |

---

### 3. View My Branch Assignments (Self-Service)

```
GET /personnel/me/branches
Authorization: Bearer <token>
```

Returns the calling user's home branch and any extra branches assigned by an admin. Useful for a "My Profile" or settings screen.

**Response `200`:**
```json
{
  "home_branch": { "id": 1, "branch_name": "สาขาสุรินทร์" },
  "extra_branches": [
    { "id": 3, "branch_name": "สาขาท่าตูม", "assigned_at": "2026-06-20 02:31:45.123456+00:00" }
  ]
}
```

- `home_branch` is `null` if the user has no branch assigned (edge case).
- `extra_branches` is `[]` if the user has no additional assignments.

---

### 4. Admin: View Branch Assignments for a User

```
GET /admin/personnel/{personnel_id}/branch-assignments
Authorization: Bearer <admin-token>
```

Super Admin only. Same shape as endpoint 3 but for any user by ID.

**Response `200`:** same shape as `/personnel/me/branches`.

**Error responses:**
| Status | Reason |
|---|---|
| `403` | Caller is not Super Admin |
| `404` | Personnel ID not found |

---

### 5. Admin: Assign an Extra Branch to a User

```
POST /admin/personnel/{personnel_id}/branch-assignments
Authorization: Bearer <admin-token>
Content-Type: application/json

{ "branch_id": 3 }
```

Grants the user access to an additional branch.

**Response `201`:**
```json
{ "personnel_id": 42, "branch_id": 3, "assigned_at": "2026-06-20T02:31:45.123456+00:00" }
```

**Error responses:**
| Status | Reason |
|---|---|
| `400` | `branch_id` is the user's home branch (already has access) |
| `403` | Caller is not Super Admin |
| `404` | Personnel or branch not found |
| `409` | Assignment already exists |

---

### 6. Admin: Remove an Extra Branch from a User

```
DELETE /admin/personnel/{personnel_id}/branch-assignments/{branch_id}
Authorization: Bearer <admin-token>
```

Removes an extra branch assignment. Does not affect the user's home branch.

**⚠️ Revocation caveat:** If the user currently has a switched token with `branch = branch_id`, that token remains valid until expiry. The revocation takes effect on the user's next login or next switch attempt.

**Response `200`:**
```json
{ "detail": "Branch assignment removed." }
```

**Error responses:**
| Status | Reason |
|---|---|
| `403` | Caller is not Super Admin |
| `404` | Assignment not found |

---

## Recommended Frontend Flow

### Branch Switcher UI

```
On login:
  1. Store token.
  2. Call GET /auth/my-branches.
  3. If result has >1 branch → show branch switcher (dropdown/modal).
  4. If result has 1 branch → hide switcher.

On user selects a branch:
  1. POST /auth/switch-branch { branch_id }
  2. On 200 → replace stored token with response.access_token.
  3. Reload/refresh current view (data is now filtered to new branch).
  4. Update UI to show active branch name (decode `branch` from JWT or keep state).

On 403 from switch:
  → Show "ไม่มีสิทธิ์เข้าถึงสาขานี้" and re-fetch /auth/my-branches to refresh the list.
```

### Admin Branch Assignment UI (Super Admin only)

```
On open personnel detail:
  1. GET /admin/personnel/{id}/branch-assignments → show home branch + extra branch chips.

Add branch:
  1. Show branch selector (fetch from existing /lists/ or /admin/branches endpoint).
  2. POST /admin/personnel/{id}/branch-assignments { branch_id }.
  3. On 201 → refresh assignment list.
  4. On 409 → show "สาขานี้ถูกกำหนดไว้แล้ว".

Remove branch:
  1. Confirm dialog.
  2. DELETE /admin/personnel/{id}/branch-assignments/{branch_id}.
  3. On 200 → refresh assignment list.
```

---

## Error Summary

| Status | Meaning |
|---|---|
| `400` | Cannot assign home branch as an extra |
| `401` | Missing or invalid token |
| `403` | Insufficient role, or branch not in allowed list, or account not yet activated |
| `404` | Resource not found |
| `409` | Duplicate branch assignment |
