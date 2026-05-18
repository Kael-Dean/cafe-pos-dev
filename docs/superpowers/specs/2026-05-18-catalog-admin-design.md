# Catalog Admin Page — Design Spec

**Date:** 2026-05-18
**Source:** `HANDOFF_CATALOG_ADMIN.md` (backend handoff, API live)
**Scope:** Frontend only — no backend changes required

---

## Goals

Provide a dedicated admin page where OWNER users can manage:
1. **Categories** — used by the New Menu dialog's หมวดหมู่ dropdown
2. **Modifier Groups + child Modifiers** — used by the BOM Builder's "เปลี่ยนตัวเลือก" picker and POS options modal

Both downstream surfaces (`useCategories()` / `useModifierGroups()`) are already wired to the API — they just needed real data. No changes required to BOM Builder or POS screens.

---

## Files Changed

| Action | Path |
|--------|------|
| Create | `app/src/components/screens/catalog.tsx` |
| Create | `app/src/hooks/use-catalog.ts` |
| Edit   | `app/src/app/page.tsx` |
| Edit   | `app/src/components/app-common.tsx` |

---

## 1. Sidebar Changes (`app-common.tsx`)

### Scroll fix
The `<aside>` has `overflow: hidden` which traps content on small screens and hides the logout button. Change to `overflow-y: auto` with a thin scrollbar, keeping the header (logo/branch/avatar) pinned via `flex-shrink: 0` and letting only the nav list scroll.

### New nav item
Add to the `NAV` array near the bottom section (after the second divider, before Settings):

```ts
{ id: 'catalog', label: 'Catalog', icon: 'tag', ownerOnly: true }
```

Add `ownerOnly?: boolean` to the `NavItem` type. Update the Sidebar filter:

```ts
const visibleNav = NAV.filter((n) =>
  n.divider ||
  (!n.adminOnly || isAdmin) &&
  (!n.ownerOnly || role === 'OWNER')
);
```

---

## 2. Page Router (`page.tsx`)

Add `'catalog'` to the `Screen` union type and the `screens` record:

```ts
type Screen = ... | 'catalog';

screens = {
  ...
  catalog: <CatalogAdmin />,
};
```

---

## 3. Hooks (`use-catalog.ts`)

Exports raw-shape hooks for the admin page. Existing read-only hooks in `use-products.ts` and `use-modifier-groups.ts` are untouched.

### Types (raw backend shapes)

```ts
interface CategoryRead {
  id: string; store_id: string; name: string;
  sort_order: number; is_active: boolean;
  created_at: string; updated_at: string;
}

interface ModifierRead {
  id: string; name: string; price_delta: string;
  inventory_item_id: string | null; inventory_qty: string | null;
  sort_order: number; is_active: boolean;
}

interface ModifierGroupRead {
  id: string; store_id: string; name: string;
  required: boolean; min_select: number; max_select: number | null;
  is_active: boolean; modifiers: ModifierRead[];
}
```

### Category hooks

| Hook | Method | Path | Invalidates |
|------|--------|------|-------------|
| `useCategoriesAdmin()` | GET | `/api/v1/categories` | — |
| `useCreateCategory()` | POST | `/api/v1/categories` | `['categories']` |
| `useUpdateCategory()` | PATCH | `/api/v1/categories/{id}` | `['categories']` |
| `useDeleteCategory()` | DELETE | `/api/v1/categories/{id}` | `['categories']` — caller catches `ApiError(409)` |

`useCategoriesAdmin` returns `CategoryRead[]` sorted by `sort_order`.

### Modifier Group hooks

| Hook | Method | Path | Invalidates |
|------|--------|------|-------------|
| `useModifierGroupsAdmin()` | GET | `/api/v1/modifier-groups` | — |
| `useCreateModifierGroup_()` | POST | `/api/v1/modifier-groups` | `['modifier-groups']` |
| `useUpdateModifierGroup()` | PATCH | `/api/v1/modifier-groups/{id}` | `['modifier-groups']` |
| `useDeleteModifierGroup_()` | DELETE | `/api/v1/modifier-groups/{id}` | `['modifier-groups']` |

> Note: Admin versions named with trailing `_` only if they would collide with existing hooks from `use-modifier-groups.ts`. Confirm at implementation time; rename if needed.

---

## 4. Catalog Screen (`catalog.tsx`)

### Page structure

```
<CatalogAdmin>
  Header: "Catalog" + tab bar [หมวดหมู่ | กลุ่มตัวเลือก]
  <CategoriesTab />   (shown when activeTab === 'categories')
  <ModifierGroupsTab /> (shown when activeTab === 'modifiers')
</CatalogAdmin>
```

### 4a. Categories Tab

**Layout:** Full-width card with table.

**Table columns:** # (sort_order) | ชื่อหมวดหมู่ | จัดเรียง (↑↓) | แก้ไข | ลบ

**Create:**
- "+ เพิ่มหมวดหมู่" button in card header
- Appends an editable row at the bottom; `sort_order` defaults to `(max existing) + 10`
- Confirm → `POST /api/v1/categories`; Cancel → removes row

**Edit:**
- Edit icon turns name cell into `<input>` + save/cancel icons
- Save → `PATCH /api/v1/categories/{id}` with `{ name }`

**Re-sort:**
- ↑ swaps `sort_order` with row above; ↓ swaps with row below
- Two sequential `PATCH` calls; buttons disabled during mutation

**Delete:**
- Confirm dialog: "ลบหมวดหมู่ '[name]'?"
- On success → invalidate + toast success
- On `ApiError(409)` → dismiss dialog + toast danger: *"ไม่สามารถลบหมวดหมู่ที่ยังมีเมนูใช้งานอยู่ — โปรดย้ายเมนูไปยังหมวดหมู่อื่นก่อน"*

### 4b. Modifier Groups Tab

**Layout:** Two-pane horizontal split.

```
[ Left: 280px fixed ]  [ Right: flex-1 ]
  Group list             Group detail form
  + สร้างกลุ่ม btn
```

**Left pane:**
- Rows: group name + "จำเป็น" badge if `required`
- Selected row highlighted
- Delete icon per row → confirm dialog → `DELETE /api/v1/modifier-groups/{id}`
- "+ สร้างกลุ่มตัวเลือก" button → right pane shows blank creation form

**Right pane — Group form:**

Fields:
- `name` — text input (required, 1–80 chars)
- `required` — checkbox
- `min_select` — number input (≥ 0)
- `max_select` — number input; empty/blank value treated as `null` (unlimited); helper text:
  - `=== 1` → *"เลือกได้ 1 ตัวเลือก (radio buttons)"*
  - `=== null` or `> 1` → *"เลือกได้หลายตัวเลือก (checkboxes)"*

**Modifiers table:**

Columns: ชื่อ | ราคาต่างจากปกติ (฿) | ลำดับ | ลบ

- All rows editable inline
- "+ เพิ่มตัวเลือก" appends blank row
- Delete icon removes row from local state
- `price_delta` stored/sent as string (e.g. `"10.00"`, `"-5.00"`)

**Save / Create buttons:**
- Existing group → "บันทึก" → `PATCH /api/v1/modifier-groups/{id}` with `{ name, required, min_select, max_select, modifiers[] }` (bulk-replace)
- New group → "สร้าง" → `POST /api/v1/modifier-groups` with same shape → on success, auto-select new group in left pane

---

## 5. Error Handling

| Status | Handling |
|--------|----------|
| 400 | Inline field error below the relevant input |
| 401 | `clearToken()` + redirect to login (existing `ApiError` pattern) |
| 403 | Toast danger: "ไม่มีสิทธิ์ดำเนินการนี้" |
| 404 | Toast warning: "รายการไม่พบ — รีเฟรชรายการแล้ว" + invalidate query |
| 409 | Category delete only — toast danger with move-menu message |

---

## 6. Role Guard

- Nav item hidden for non-OWNER via `ownerOnly` flag in Sidebar filter
- Screen itself does not need a secondary guard (nav is the only entry point)

---

## 7. Acceptance Checklist

- [ ] OWNER sees "Catalog" in sidebar; MANAGER/BARISTA/BAKER do not
- [ ] Sidebar scrolls on small screens; logout button reachable
- [ ] Categories: create, rename, re-sort, delete all work end-to-end
- [ ] Deleting a category with active products shows 409 toast instead of throwing
- [ ] Modifier groups: create with modifiers, edit flags + bulk-replace modifiers, delete
- [ ] After creating a category → appears in New Menu dialog dropdown immediately
- [ ] After creating a modifier group → appears in BOM Builder picker immediately
- [ ] `price_delta` and `inventory_qty` sent as strings, not JS numbers
- [ ] All write actions show loading state; failures show toast and do not corrupt local state
