# Frontend Handoff — Catalog Admin Page (Categories + Modifier Groups)

**Date:** 2026-05-18
**Owner:** Backend → Frontend
**Status:** Ready to build (API live)

---

## Why this page exists

The BOM Builder and the "New Menu" dialog already consume two pieces of catalog
metadata, but the UI has no way to create or edit them today. The screenshots
below illustrate the gap:

- **BOM Builder → ตัวเลือก (Modifier Groups):** the panel says *"ยังไม่มีตัวเลือก —
  กดปุ่ม 'เปลี่ยนตัวเลือก' เพื่อเชื่อมโยง modifier groups"*, but there are no groups in
  the system to choose from yet.
- **New Menu dialog → หมวดหมู่:** the dropdown only contains *"— ไม่ระบุหมวดหมู่ —"*
  because no categories have been created.

We need a dedicated admin page where store owners can manage both, so that:

1. The BOM Builder's "+ เปลี่ยนตัวเลือก" picker has real modifier groups to attach
   to products.
2. The New Menu dialog's "หมวดหมู่" dropdown has real categories to assign.

The backend routes already exist and are wired up under `/api/v1`. This handoff
is purely a frontend task.

---

## Scope

Build one new page (suggested route: `/admin/catalog` or two tabs under
`Settings`) with **two independent sections**:

| Section          | Manages                | Used by                                          |
| ---------------- | ---------------------- | ------------------------------------------------ |
| Categories       | `Category` records     | "หมวดหมู่" dropdown in New/Edit Menu dialog       |
| Modifier Groups  | `ModifierGroup` +      | "เปลี่ยนตัวเลือก" picker in BOM Builder, and the |
|                  | child `Modifier` items | POS order options modal                          |

Each section needs full CRUD: list, create, edit, delete.

**Out of scope:** attaching modifier groups *to a product*. That already works
via `PUT /api/v1/products/{product_id}/modifier-groups` in BOM Builder.

---

## Role gating

**Decision:** OWNER-only in the UI, MANAGER-permitted in the API.

- Show the page in the nav and route guard it **only for OWNER**. MANAGER and
  below must not see the entry point.
- The backend route guard remains `require_role(OWNER, MANAGER)` — this is
  intentional, so backoffice tools and a future MANAGER-facing surface can
  still hit these endpoints without a backend change.
- This means a MANAGER could in theory call the API directly. That's an
  accepted trade-off — no extra defensive checks needed in FE.

---

## Endpoints (all live, all under `/api/v1`)

All endpoints are **store-scoped** — they read `store_id` from the bearer
token. Do not send a store id in the body or path.

### Categories

| Method | Path                          | Auth         | Notes                                                                 |
| ------ | ----------------------------- | ------------ | --------------------------------------------------------------------- |
| GET    | `/categories`                 | any role     | List all active categories for the current store                      |
| POST   | `/categories`                 | OWNER/MANAGER| Create                                                                |
| PATCH  | `/categories/{category_id}`   | OWNER/MANAGER| Rename or re-sort                                                     |
| DELETE | `/categories/{category_id}`   | OWNER/MANAGER| Soft delete. **Refused with 409** if any active products are attached |

### Modifier groups

| Method | Path                                                  | Auth          | Notes                                                                  |
| ------ | ----------------------------------------------------- | ------------- | ---------------------------------------------------------------------- |
| GET    | `/modifier-groups?is_active=true`                     | any role      | List groups (with embedded `modifiers[]`). `is_active` default `true`  |
| POST   | `/modifier-groups`                                    | OWNER/MANAGER | Create group + optional child modifiers in one call                    |
| PATCH  | `/modifier-groups/{group_id}`                         | OWNER/MANAGER | Update flags; sending `modifiers[]` **bulk-replaces** all child items  |
| DELETE | `/modifier-groups/{group_id}`                         | OWNER/MANAGER | Soft delete group + cascade soft-delete children                       |
| POST   | `/modifier-groups/{group_id}/modifiers`               | OWNER/MANAGER | Add a single modifier option (alternative to bulk replace via PATCH)   |
| PATCH  | `/modifier-groups/{group_id}/modifiers/{modifier_id}` | OWNER/MANAGER | Update one modifier                                                    |
| DELETE | `/modifier-groups/{group_id}/modifiers/{modifier_id}` | OWNER/MANAGER | Remove one modifier                                                    |

**Tip:** for the edit-modifier-group screen you can either (a) use the granular
per-modifier POST/PATCH/DELETE endpoints, or (b) treat the whole group as a
single form and PATCH the group with the full `modifiers[]` array to bulk
replace. Option (b) is simpler for FE state and is the recommended default.

---

## Request / response shapes

### Category

```ts
// CategoryRead — returned by GET/POST/PATCH
{
  id: string;            // server-assigned
  store_id: string;
  name: string;
  sort_order: number;    // integer ≥ 0, controls UI ordering
  is_active: boolean;
  created_at: string;    // ISO datetime
  updated_at: string;
}

// CategoryCreate — POST body
{
  name: string;          // 1..80 chars
  sort_order?: number;   // default 0
}

// CategoryUpdate — PATCH body (all fields optional)
{
  name?: string;
  sort_order?: number;
}
```

### Modifier group + child modifier

```ts
// ModifierRead — child of a group
{
  id: string;
  name: string;
  price_delta: string;          // decimal as string, e.g. "10.00", "-5.00"
  inventory_item_id: string | null;
  inventory_qty: string | null; // decimal as string
  sort_order: number;
  is_active: boolean;
}

// ModifierGroupRead — returned by GET/POST/PATCH
{
  id: string;
  store_id: string;
  name: string;
  required: boolean;
  min_select: number;           // ≥ 0
  max_select: number | null;    // null = no upper bound; 1 = single-select (radio); >1 = multi (checkbox)
  is_active: boolean;
  modifiers: ModifierRead[];
}

// ModifierGroupCreate — POST body
{
  name: string;                 // 1..80 chars
  required?: boolean;           // default false
  min_select?: number;          // default 0
  max_select?: number | null;   // default null
  modifiers?: ModifierCreate[]; // optional initial children
}

// ModifierCreate
{
  name: string;                 // 1..80 chars
  price_delta?: string;         // decimal -9999.99..9999.99, default "0"
  inventory_item_id?: string | null;
  inventory_qty?: string | null; // must be > 0 if present
  sort_order?: number;          // default 0
}

// ModifierGroupUpdate — PATCH body (all fields optional)
{
  name?: string;
  required?: boolean;
  min_select?: number;
  max_select?: number | null;
  modifiers?: ModifierCreate[]; // ⚠ if present, bulk-replaces ALL children
}

// ModifierUpdate — PATCH body for a single modifier
{
  name?: string;
  price_delta?: string;
  inventory_item_id?: string | null;
  inventory_qty?: string | null;
  sort_order?: number;
  is_active?: boolean;
}
```

> **Decimals are strings on the wire.** When the user types `10` in a price-delta
> input, send `"10"` or `"10.00"` — JSON numbers are accepted by pydantic but
> sending strings avoids JS float drift for amounts like `0.1`.

---

## UX guidance

### Categories panel

- Table/list of categories sorted by `sort_order` then `name`.
- Inline "+ เพิ่มหมวดหมู่" creates with `name` only; default `sort_order` to
  `(max existing sort_order) + 10` so the new row lands at the bottom and there
  is room to insert later.
- Edit: rename or re-sort. A simple up/down arrow pair is fine — translate
  arrow clicks into PATCH calls that swap `sort_order` with the neighbour.
- Delete: confirm dialog. **Handle the 409 case** — the backend refuses
  deletion if active products still point at this category. Show the user:
  *"ไม่สามารถลบหมวดหมู่ที่ยังมีเมนูใช้งานอยู่ — โปรดย้ายเมนูไปยังหมวดหมู่อื่นก่อน"*.

### Modifier groups panel

- Two-pane layout works well: left column lists groups, right column shows the
  selected group's detail (flags + modifiers table).
- Group-level fields: `name`, `required`, `min_select`, `max_select`. Show a
  helper line under the selection rules:
  - `max_select === 1` → "เลือกได้ 1 ตัวเลือก (radio buttons)"
  - `max_select === null` or `> 1` → "เลือกได้หลายตัวเลือก (checkboxes)"
- Modifiers table inside the group: name, price delta, sort order, active
  toggle. Use the bulk-replace pattern (PATCH the group with the full
  `modifiers[]`) so the user can edit the whole table and click "Save" once.
- Delete group: soft delete. There is no 409 here — children are cascaded.
- After save/delete, refresh the BOM Builder's modifier-group picker on next
  open so newly-created groups appear.

### Errors to handle explicitly

| Status | Meaning                                                 | Suggested UI                                                      |
| ------ | ------------------------------------------------------- | ----------------------------------------------------------------- |
| 400    | Validation (e.g. name too long, price_delta out of range)| Inline field error                                                |
| 401    | Token missing/expired                                   | Bounce to login                                                   |
| 403    | Role insufficient (e.g. CASHIER trying to write)        | Hide the page from non-owners; show toast if the request slips    |
| 404    | Category/group id not found in this store               | Refresh the list — likely deleted in another tab                  |
| 409    | Category delete blocked by attached products            | Toast: ย้ายเมนูก่อนค่อยลบ (see copy above)                          |

---

## Integration points (what changes elsewhere)

After this page ships, two existing surfaces start working:

1. **New/Edit Menu dialog (`เพิ่มรายการใหม่`)**
   The `หมวดหมู่` `<select>` currently only renders `— ไม่ระบุหมวดหมู่ —`.
   Wire it to `GET /api/v1/categories` and populate options sorted by
   `sort_order`. Selected value goes into `ProductCreate.category_id` /
   `ProductUpdate.category_id`. `null` keeps "ไม่ระบุหมวดหมู่".

2. **BOM Builder → "+ เปลี่ยนตัวเลือก" picker**
   Source list = `GET /api/v1/modifier-groups`. Selection submits to
   `PUT /api/v1/products/{product_id}/modifier-groups` with:
   ```json
   { "modifier_group_ids": ["<id1>", "<id2>", ...] }
   ```
   Order in the array becomes display order in the POS options modal.

Neither change requires backend work.

---

## Acceptance checklist

- [ ] OWNER can navigate to the new page; MANAGER and lower roles cannot see
      it in the nav or reach it via direct URL
- [ ] Categories: create, rename, re-sort, soft-delete all working end-to-end
- [ ] Deleting a category that still has active products surfaces the 409
      message instead of throwing
- [ ] Modifier groups: create with initial modifiers, edit flags, bulk-replace
      modifiers via PATCH, soft-delete all working
- [ ] After creating a category, it appears in the New Menu dialog dropdown
- [ ] After creating a modifier group, it appears in the BOM Builder
      "เปลี่ยนตัวเลือก" picker
- [ ] All write actions show optimistic UI or a spinner; failures roll back
- [ ] All decimal inputs (`price_delta`, `inventory_qty`) send strings, not
      JS numbers

---

## References

- Backend route file (categories): `api/app/api/v1/categories.py`
- Backend route file (modifier groups): `api/app/api/v1/modifier_groups.py`
- Schemas: `api/app/schemas/catalog.py`
- Prior related handoff: `resources/Completed/HANDOFF_MODIFIER_GROUPS.md`
  (covers the *consumption* side — how POS reads modifier groups during a sale)
