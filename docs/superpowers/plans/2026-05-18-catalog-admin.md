# Catalog Admin Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an OWNER-only Catalog admin page (two tabs: Categories + Modifier Groups CRUD) and fix the sidebar scroll bug that hides the logout button.

**Architecture:** New screen component `catalog.tsx` + new hook file `use-catalog.ts` for raw CRUD. Two small edits to `app-common.tsx` (sidebar scroll fix + nav item) and `page.tsx` (register the screen). No changes to existing hooks or other screens.

**Tech Stack:** Next.js 15 app router (client components), React Query (`@tanstack/react-query`), inline CSS with design tokens, `api` client from `lib/api-client.ts`.

> **Note on testing:** This project has no test infrastructure. Verification steps use manual browser checks. Start the dev server with `pnpm --filter app dev` from `d:\POS` and open `http://localhost:3000` to verify each task.

---

## File Map

| Action  | Path |
|---------|------|
| **Edit**   | `app/src/components/app-common.tsx` |
| **Edit**   | `app/src/app/page.tsx` |
| **Create** | `app/src/hooks/use-catalog.ts` |
| **Create** | `app/src/components/screens/catalog.tsx` |

---

## Task 1: Fix sidebar overflow — logout button now reachable

**Files:**
- Modify: `app/src/components/app-common.tsx:108`

The `<aside>` has `overflow: 'hidden'` which clips the inner `<nav>`'s `overflowY: 'auto'`, preventing scroll. The fix: allow Y overflow while still clipping X (needed for the width-collapse transition).

- [ ] **Step 1: Apply the fix**

In `app/src/components/app-common.tsx`, find the `<aside>` opening tag (around line 108). Change:

```tsx
// BEFORE — line ~108
<aside style={{
  width: collapsed ? 64 : 240,
  background: 'var(--color-primary)',
  color: 'rgba(255,255,255,0.92)',
  display: 'flex', flexDirection: 'column',
  borderRight: '1px solid rgba(0,0,0,0.15)',
  transition: 'width 220ms cubic-bezier(0.4,0,0.2,1)',
  overflow: 'hidden',
}}>
```

```tsx
// AFTER
<aside style={{
  width: collapsed ? 64 : 240,
  background: 'var(--color-primary)',
  color: 'rgba(255,255,255,0.92)',
  display: 'flex', flexDirection: 'column',
  borderRight: '1px solid rgba(0,0,0,0.15)',
  transition: 'width 220ms cubic-bezier(0.4,0,0.2,1)',
  overflowX: 'hidden',
}}>
```

- [ ] **Step 2: Verify manually**

Start dev server (`pnpm --filter app dev` from `d:\POS`). Shrink the browser window height until the nav overflows. Confirm the nav scrolls and the logout button is reachable.

- [ ] **Step 3: Commit**

```powershell
$env:GIT_INDEX_FILE = ".git/index2"
Set-Location d:\POS
git read-tree HEAD
git add app/src/components/app-common.tsx
cp .git/index2 .git/index
Remove-Item .git/index2 -ErrorAction SilentlyContinue
$TREE = git write-tree
$PARENT = git rev-parse HEAD
$COMMIT = git commit-tree $TREE -p $PARENT -m "fix(sidebar): allow Y scroll so logout button is reachable

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
"$COMMIT" | Out-File .git/refs/heads/main -Encoding ascii -NoNewline
git push origin main
"$COMMIT" | Out-File .git/refs/remotes/origin/main -Encoding ascii -NoNewline
```

---

## Task 2: Add `ownerOnly` nav item for Catalog

**Files:**
- Modify: `app/src/components/app-common.tsx`

- [ ] **Step 1: Extend `NavItem` type with `ownerOnly`**

Find the `NavItem` type (around line 46) and add the optional flag:

```tsx
// BEFORE
export type NavItem = { id: string; label: string; icon?: string; soft?: boolean; adminOnly?: boolean; divider?: boolean; };

// AFTER
export type NavItem = { id: string; label: string; icon?: string; soft?: boolean; adminOnly?: boolean; ownerOnly?: boolean; divider?: boolean; };
```

- [ ] **Step 2: Add Catalog entry to the NAV array**

Find the NAV array (around line 48). Add the catalog entry **between reports and settings**:

```tsx
// BEFORE
  { id: 'reports',   label: 'Reports',   icon: 'reports',  soft: true },
  { id: 'settings',  label: 'Settings',  icon: 'settings', soft: true },

// AFTER
  { id: 'reports',   label: 'Reports',   icon: 'reports',  soft: true },
  { id: 'catalog',   label: 'Catalog',   icon: 'inv',      ownerOnly: true },
  { id: 'settings',  label: 'Settings',  icon: 'settings', soft: true },
```

- [ ] **Step 3: Update sidebar filter to respect `ownerOnly`**

Find the `visibleNav` filter (around line 83):

```tsx
// BEFORE
  const visibleNav = NAV.filter((n) => n.divider || !n.adminOnly || isAdmin);

// AFTER
  const visibleNav = NAV.filter((n) => {
    if (n.divider) return true;
    if (n.adminOnly && !isAdmin) return false;
    if (n.ownerOnly && role !== 'OWNER') return false;
    return true;
  });
```

- [ ] **Step 4: Verify manually**

In the browser, log in as OWNER — "Catalog" should appear in the sidebar. Log in as MANAGER — "Catalog" should be absent. Log in as BARISTA — absent.

- [ ] **Step 5: Commit**

```powershell
$env:GIT_INDEX_FILE = ".git/index2"
Set-Location d:\POS
git read-tree HEAD
git add app/src/components/app-common.tsx
cp .git/index2 .git/index
Remove-Item .git/index2 -ErrorAction SilentlyContinue
$TREE = git write-tree
$PARENT = git rev-parse HEAD
$COMMIT = git commit-tree $TREE -p $PARENT -m "feat(nav): add ownerOnly Catalog nav item

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
"$COMMIT" | Out-File .git/refs/heads/main -Encoding ascii -NoNewline
git push origin main
"$COMMIT" | Out-File .git/refs/remotes/origin/main -Encoding ascii -NoNewline
```

---

## Task 3: Category CRUD hooks (`use-catalog.ts`)

**Files:**
- Create: `app/src/hooks/use-catalog.ts`

- [ ] **Step 1: Create the file with category types and hooks**

Create `app/src/hooks/use-catalog.ts` with the following content:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

// ── Category types ────────────────────────────────────────────────────────────

export interface CategoryRead {
  id: string;
  store_id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ── Modifier types ────────────────────────────────────────────────────────────

export interface ModifierReadAdmin {
  id: string;
  name: string;
  price_delta: string;
  inventory_item_id: string | null;
  inventory_qty: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface ModifierGroupReadAdmin {
  id: string;
  store_id: string;
  name: string;
  required: boolean;
  min_select: number;
  max_select: number | null;
  is_active: boolean;
  modifiers: ModifierReadAdmin[];
}

// ── ModifierCreate payload (used in create + bulk-replace) ────────────────────

export interface ModifierCreatePayload {
  name: string;
  price_delta?: string;
  inventory_item_id?: string | null;
  inventory_qty?: string | null;
  sort_order?: number;
}

// ── Category hooks ─────────────────────────────────────────────────────────────

export function useCategoriesAdmin() {
  return useQuery<CategoryRead[]>({
    queryKey: ['categories'],
    queryFn: async () => {
      const data = await api.get<CategoryRead[]>('/api/v1/categories');
      return data.slice().sort((a, b) => a.sort_order - b.sort_order);
    },
  });
}

export function useCreateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { name: string; sort_order?: number }) =>
      api.post<CategoryRead>('/api/v1/categories', payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }),
  });
}

export function useUpdateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: { id: string; name?: string; sort_order?: number }) =>
      api.patch<CategoryRead>(`/api/v1/categories/${id}`, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }),
  });
}

export function useDeleteCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/v1/categories/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }),
  });
}

// ── Modifier Group hooks ───────────────────────────────────────────────────────

export function useModifierGroupsAdmin() {
  return useQuery<ModifierGroupReadAdmin[]>({
    queryKey: ['modifier-groups'],
    queryFn: () =>
      api.get<ModifierGroupReadAdmin[]>('/api/v1/modifier-groups?is_active=true'),
  });
}

interface ModifierGroupCreatePayload {
  name: string;
  required?: boolean;
  min_select?: number;
  max_select?: number | null;
  modifiers?: ModifierCreatePayload[];
}

interface ModifierGroupUpdatePayload {
  name?: string;
  required?: boolean;
  min_select?: number;
  max_select?: number | null;
  modifiers?: ModifierCreatePayload[];
}

export function useCreateModifierGroupAdmin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: ModifierGroupCreatePayload) =>
      api.post<ModifierGroupReadAdmin>('/api/v1/modifier-groups', payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['modifier-groups'] }),
  });
}

export function useUpdateModifierGroupAdmin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: { id: string } & ModifierGroupUpdatePayload) =>
      api.patch<ModifierGroupReadAdmin>(`/api/v1/modifier-groups/${id}`, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['modifier-groups'] }),
  });
}

export function useDeleteModifierGroupAdmin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/v1/modifier-groups/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['modifier-groups'] }),
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```powershell
Set-Location d:\POS\app
pnpm tsc --noEmit
```

Expected: no errors relating to `use-catalog.ts`.

- [ ] **Step 3: Commit**

```powershell
$env:GIT_INDEX_FILE = ".git/index2"
Set-Location d:\POS
git read-tree HEAD
git add app/src/hooks/use-catalog.ts
cp .git/index2 .git/index
Remove-Item .git/index2 -ErrorAction SilentlyContinue
$TREE = git write-tree
$PARENT = git rev-parse HEAD
$COMMIT = git commit-tree $TREE -p $PARENT -m "feat(hooks): add use-catalog CRUD hooks for categories and modifier groups

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
"$COMMIT" | Out-File .git/refs/heads/main -Encoding ascii -NoNewline
git push origin main
"$COMMIT" | Out-File .git/refs/remotes/origin/main -Encoding ascii -NoNewline
```

---

## Task 4: Catalog screen — page shell + Categories tab

**Files:**
- Create: `app/src/components/screens/catalog.tsx`

- [ ] **Step 1: Create catalog.tsx with shell, shared style helpers, and CategoriesTab**

Create `app/src/components/screens/catalog.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useToast } from '../app-common';
import { useCurrentUser } from '@/hooks/use-current-user';
import {
  useCategoriesAdmin,
  useCreateCategory,
  useUpdateCategory,
  useDeleteCategory,
  useModifierGroupsAdmin,
  useCreateModifierGroupAdmin,
  useUpdateModifierGroupAdmin,
  useDeleteModifierGroupAdmin,
  type CategoryRead,
  type ModifierGroupReadAdmin,
} from '@/hooks/use-catalog';
import { ApiError } from '@/lib/api-client';

// ── Shared style helpers ──────────────────────────────────────────────────────

const btnSm = (variant: 'primary' | 'ghost' | 'danger'): React.CSSProperties => ({
  padding: '7px 14px', borderRadius: 7, fontSize: 13, fontWeight: 600,
  cursor: 'pointer', fontFamily: 'inherit', transition: 'opacity 150ms',
  border: variant === 'ghost' ? '1px solid var(--color-border-strong)' : 'none',
  background:
    variant === 'primary' ? 'var(--color-primary)' :
    variant === 'danger'  ? 'var(--color-danger)'  : 'transparent',
  color: variant === 'ghost' ? 'var(--color-text)' : '#fff',
});

const btnIcon = (): React.CSSProperties => ({
  padding: '2px 7px', borderRadius: 4, marginRight: 2,
  border: '1px solid var(--color-border)', background: 'transparent',
  color: 'var(--color-text-secondary)', fontSize: 14, cursor: 'pointer',
  fontFamily: 'inherit',
});

const inputCss: React.CSSProperties = {
  width: '100%', padding: '8px 12px', borderRadius: 8, boxSizing: 'border-box',
  border: '1px solid var(--color-border)', fontSize: 14,
  fontFamily: 'inherit', background: 'var(--color-surface)',
};

const labelCss: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 600,
  color: 'var(--color-text-secondary)', marginBottom: 6,
};

// ── Root page ─────────────────────────────────────────────────────────────────

type Tab = 'categories' | 'modifiers';

export default function CatalogAdmin() {
  const [tab, setTab] = useState<Tab>('categories');
  const { data: me } = useCurrentUser();

  if (me && me.role !== 'OWNER') {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100%', background: 'var(--color-bg)' }}>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 14 }}>ไม่มีสิทธิ์เข้าถึงหน้านี้</p>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, height: '100%', overflowY: 'auto', background: 'var(--color-bg)', boxSizing: 'border-box' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text)', margin: 0 }}>Catalog</h1>
        <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4, marginBottom: 0 }}>
          จัดการหมวดหมู่และกลุ่มตัวเลือก
        </p>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, background: 'var(--color-surface-2)', padding: 4, borderRadius: 10, width: 'fit-content' }}>
        {([['categories', 'หมวดหมู่'], ['modifiers', 'กลุ่มตัวเลือก']] as [Tab, string][]).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            style={{
              padding: '7px 18px', borderRadius: 8, border: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
              background: tab === id ? 'var(--color-surface)' : 'transparent',
              color: tab === id ? 'var(--color-text)' : 'var(--color-text-secondary)',
              boxShadow: tab === id ? 'var(--shadow-sm)' : 'none',
              transition: 'all 150ms',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'categories' ? <CategoriesTab /> : <ModifierGroupsTab />}
    </div>
  );
}

// ── Categories Tab ────────────────────────────────────────────────────────────

function CategoriesTab() {
  const toast = useToast();
  const { data: categories, isLoading } = useCategoriesAdmin();
  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();
  const deleteCategory = useDeleteCategory();

  const [isAdding, setIsAdding]       = useState(false);
  const [addingName, setAddingName]   = useState('');
  const [editingId, setEditingId]     = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<CategoryRead | null>(null);

  const maxOrder = categories ? Math.max(0, ...categories.map(c => c.sort_order)) : 0;

  const handleCreate = async () => {
    if (!addingName.trim()) return;
    try {
      await createCategory.mutateAsync({ name: addingName.trim(), sort_order: maxOrder + 10 });
      setIsAdding(false);
      setAddingName('');
      toast({ kind: 'success', title: 'เพิ่มหมวดหมู่แล้ว' });
    } catch (err) {
      toast({ kind: 'danger', title: 'เพิ่มไม่สำเร็จ', msg: err instanceof Error ? err.message : 'กรุณาลองใหม่' });
    }
  };

  const handleRename = async (id: string) => {
    if (!editingName.trim()) return;
    try {
      await updateCategory.mutateAsync({ id, name: editingName.trim() });
      setEditingId(null);
      toast({ kind: 'success', title: 'แก้ไขแล้ว' });
    } catch (err) {
      toast({ kind: 'danger', title: 'แก้ไขไม่สำเร็จ', msg: err instanceof Error ? err.message : 'กรุณาลองใหม่' });
    }
  };

  const handleMoveUp = async (idx: number) => {
    if (!categories || idx === 0) return;
    const a = categories[idx], b = categories[idx - 1];
    try {
      await updateCategory.mutateAsync({ id: a.id, sort_order: b.sort_order });
      await updateCategory.mutateAsync({ id: b.id, sort_order: a.sort_order });
    } catch {
      toast({ kind: 'danger', title: 'เรียงลำดับไม่สำเร็จ' });
    }
  };

  const handleMoveDown = async (idx: number) => {
    if (!categories || idx === categories.length - 1) return;
    const a = categories[idx], b = categories[idx + 1];
    try {
      await updateCategory.mutateAsync({ id: a.id, sort_order: b.sort_order });
      await updateCategory.mutateAsync({ id: b.id, sort_order: a.sort_order });
    } catch {
      toast({ kind: 'danger', title: 'เรียงลำดับไม่สำเร็จ' });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteCategory.mutateAsync(deleteTarget.id);
      setDeleteTarget(null);
      toast({ kind: 'success', title: 'ลบแล้ว' });
    } catch (err) {
      setDeleteTarget(null);
      if (err instanceof ApiError && err.status === 409) {
        toast({
          kind: 'danger', title: 'ลบไม่ได้',
          msg: 'ไม่สามารถลบหมวดหมู่ที่ยังมีเมนูใช้งานอยู่ — โปรดย้ายเมนูไปยังหมวดหมู่อื่นก่อน',
        });
      } else {
        toast({ kind: 'danger', title: 'ลบไม่สำเร็จ', msg: err instanceof Error ? err.message : 'กรุณาลองใหม่' });
      }
    }
  };

  if (isLoading) return (
    <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)' }}>กำลังโหลด…</div>
  );

  return (
    <>
      <div style={{ background: 'var(--color-surface)', borderRadius: 12, border: '1px solid var(--color-border)', overflow: 'hidden' }}>
        {/* Card header */}
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>หมวดหมู่ ({categories?.length ?? 0})</span>
          <button onClick={() => { setIsAdding(true); setAddingName(''); }} style={btnSm('primary')}>
            + เพิ่มหมวดหมู่
          </button>
        </div>

        {/* Table */}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: 'var(--color-surface-2)' }}>
              {['#', 'ชื่อหมวดหมู่', 'จัดเรียง', ''].map((h, i) => (
                <th key={i} style={{ padding: '10px 16px', textAlign: i === 0 ? 'center' : 'left', fontWeight: 600, fontSize: 12, color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)', whiteSpace: 'nowrap' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(categories ?? []).map((cat, idx) => (
              <tr key={cat.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                <td style={{ padding: '10px 16px', textAlign: 'center', width: 48, color: 'var(--color-text-muted)', fontFamily: 'var(--font-num)' }}>
                  {cat.sort_order}
                </td>
                <td style={{ padding: '10px 16px' }}>
                  {editingId === cat.id ? (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input
                        autoFocus
                        value={editingName}
                        onChange={e => setEditingName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleRename(cat.id); if (e.key === 'Escape') setEditingId(null); }}
                        style={{ ...inputCss, padding: '5px 10px' }}
                      />
                      <button onClick={() => handleRename(cat.id)} disabled={updateCategory.isPending} style={btnSm('primary')}>บันทึก</button>
                      <button onClick={() => setEditingId(null)} style={btnSm('ghost')}>ยกเลิก</button>
                    </div>
                  ) : (
                    <span style={{ fontWeight: 500 }}>{cat.name}</span>
                  )}
                </td>
                <td style={{ padding: '10px 12px', width: 80, whiteSpace: 'nowrap' }}>
                  <button onClick={() => handleMoveUp(idx)} disabled={idx === 0 || updateCategory.isPending} style={btnIcon()} title="ขึ้น">↑</button>
                  <button onClick={() => handleMoveDown(idx)} disabled={idx === (categories?.length ?? 0) - 1 || updateCategory.isPending} style={btnIcon()} title="ลง">↓</button>
                </td>
                <td style={{ padding: '10px 12px', width: 120, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button onClick={() => { setEditingId(cat.id); setEditingName(cat.name); }} style={btnSm('ghost')}>แก้ไข</button>
                  <button onClick={() => setDeleteTarget(cat)} style={{ ...btnSm('ghost'), marginLeft: 6, color: 'var(--color-danger)' }}>ลบ</button>
                </td>
              </tr>
            ))}

            {isAdding && (
              <tr style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-accent-50)' }}>
                <td style={{ padding: '10px 16px', textAlign: 'center', width: 48, color: 'var(--color-text-muted)' }}>—</td>
                <td style={{ padding: '10px 16px' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      autoFocus
                      placeholder="ชื่อหมวดหมู่ใหม่"
                      value={addingName}
                      onChange={e => setAddingName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setIsAdding(false); }}
                      style={{ ...inputCss, padding: '5px 10px' }}
                    />
                    <button onClick={handleCreate} disabled={!addingName.trim() || createCategory.isPending} style={btnSm('primary')}>เพิ่ม</button>
                    <button onClick={() => setIsAdding(false)} style={btnSm('ghost')}>ยกเลิก</button>
                  </div>
                </td>
                <td colSpan={2} />
              </tr>
            )}

            {!categories?.length && !isAdding && (
              <tr>
                <td colSpan={4} style={{ padding: 32, textAlign: 'center', color: 'var(--color-text-muted)' }}>
                  ยังไม่มีหมวดหมู่ — กด "+ เพิ่มหมวดหมู่" เพื่อเริ่มต้น
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Delete confirm */}
      {deleteTarget && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'grid', placeItems: 'center', zIndex: 50 }}>
          <div style={{ background: 'var(--color-surface)', borderRadius: 12, padding: 24, width: 360, boxShadow: 'var(--shadow-lg)' }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 700 }}>ลบหมวดหมู่</h3>
            <p style={{ margin: '0 0 20px', fontSize: 14, color: 'var(--color-text-secondary)' }}>
              ลบ <strong>{deleteTarget.name}</strong>? ไม่สามารถเลิกทำได้
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setDeleteTarget(null)} style={btnSm('ghost')}>ยกเลิก</button>
              <button onClick={handleDelete} disabled={deleteCategory.isPending} style={btnSm('danger')}>ลบ</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Modifier Groups Tab ───────────────────────────────────────────────────────

interface LocalModifier {
  id?: string;
  name: string;
  price_delta: string;
  sort_order: number;
}

function ModifierGroupsTab() {
  const toast = useToast();
  const { data: groups, isLoading } = useModifierGroupsAdmin();
  const createGroup = useCreateModifierGroupAdmin();
  const updateGroup = useUpdateModifierGroupAdmin();
  const deleteGroup = useDeleteModifierGroupAdmin();

  const [selectedId, setSelectedId]   = useState<string | null>(null);
  const [isCreating, setIsCreating]   = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ModifierGroupReadAdmin | null>(null);

  // Form state
  const [formName, setFormName]           = useState('');
  const [formRequired, setFormRequired]   = useState(false);
  const [formMinSelect, setFormMinSelect] = useState(0);
  const [formMaxSelect, setFormMaxSelect] = useState('1'); // '' = null (unlimited)
  const [formModifiers, setFormModifiers] = useState<LocalModifier[]>([]);

  const maxSelectParsed = formMaxSelect === '' ? null : Number(formMaxSelect);
  const selectionHint =
    maxSelectParsed === 1
      ? 'เลือกได้ 1 ตัวเลือก (radio buttons)'
      : 'เลือกได้หลายตัวเลือก (checkboxes)';

  const loadGroup = (g: ModifierGroupReadAdmin) => {
    setSelectedId(g.id);
    setIsCreating(false);
    setFormName(g.name);
    setFormRequired(g.required);
    setFormMinSelect(g.min_select);
    setFormMaxSelect(g.max_select === null ? '' : String(g.max_select));
    setFormModifiers(
      g.modifiers.map(m => ({ id: m.id, name: m.name, price_delta: String(m.price_delta), sort_order: m.sort_order }))
    );
  };

  const startCreating = () => {
    setIsCreating(true);
    setSelectedId(null);
    setFormName('');
    setFormRequired(false);
    setFormMinSelect(0);
    setFormMaxSelect('1');
    setFormModifiers([]);
  };

  const buildModifiersPayload = (): ModifierCreatePayload[] =>
    formModifiers.map((m, i) => ({
      name: m.name,
      price_delta: m.price_delta || '0',
      sort_order: i,
    }));

  const handleSave = async () => {
    if (!selectedId || !formName.trim()) return;
    try {
      await updateGroup.mutateAsync({
        id: selectedId,
        name: formName.trim(),
        required: formRequired,
        min_select: formMinSelect,
        max_select: maxSelectParsed,
        modifiers: buildModifiersPayload(),
      });
      toast({ kind: 'success', title: 'บันทึกแล้ว' });
    } catch (err) {
      toast({ kind: 'danger', title: 'บันทึกไม่สำเร็จ', msg: err instanceof Error ? err.message : 'กรุณาลองใหม่' });
    }
  };

  const handleCreate = async () => {
    if (!formName.trim()) return;
    try {
      const created = await createGroup.mutateAsync({
        name: formName.trim(),
        required: formRequired,
        min_select: formMinSelect,
        max_select: maxSelectParsed,
        modifiers: buildModifiersPayload(),
      });
      setIsCreating(false);
      loadGroup(created);
      toast({ kind: 'success', title: 'สร้างกลุ่มตัวเลือกแล้ว' });
    } catch (err) {
      toast({ kind: 'danger', title: 'สร้างไม่สำเร็จ', msg: err instanceof Error ? err.message : 'กรุณาลองใหม่' });
    }
  };

  const handleDeleteGroup = async () => {
    if (!deleteTarget) return;
    try {
      await deleteGroup.mutateAsync(deleteTarget.id);
      if (selectedId === deleteTarget.id) { setSelectedId(null); setIsCreating(false); }
      setDeleteTarget(null);
      toast({ kind: 'success', title: 'ลบกลุ่มตัวเลือกแล้ว' });
    } catch (err) {
      setDeleteTarget(null);
      toast({ kind: 'danger', title: 'ลบไม่สำเร็จ', msg: err instanceof Error ? err.message : 'กรุณาลองใหม่' });
    }
  };

  const addModifierRow = () =>
    setFormModifiers(prev => [...prev, { name: '', price_delta: '0', sort_order: prev.length }]);

  const updateModRow = (i: number, field: keyof LocalModifier, value: string | number) =>
    setFormModifiers(prev => prev.map((m, idx) => idx === i ? { ...m, [field]: value } : m));

  const removeModRow = (i: number) =>
    setFormModifiers(prev => prev.filter((_, idx) => idx !== i));

  const showForm = isCreating || selectedId !== null;

  if (isLoading) return (
    <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)' }}>กำลังโหลด…</div>
  );

  return (
    <>
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        {/* Left pane — group list */}
        <div style={{ width: 280, flexShrink: 0, background: 'var(--color-surface)', borderRadius: 12, border: '1px solid var(--color-border)', overflow: 'hidden' }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>กลุ่มตัวเลือก</span>
            <button onClick={startCreating} style={{ ...btnSm('primary'), padding: '5px 10px', fontSize: 12 }}>+ สร้าง</button>
          </div>
          <div style={{ maxHeight: 520, overflowY: 'auto' }}>
            {(groups ?? []).map(g => (
              <div
                key={g.id}
                onClick={() => loadGroup(g)}
                style={{
                  padding: '12px 16px', cursor: 'pointer', display: 'flex',
                  alignItems: 'center', justifyContent: 'space-between',
                  background: selectedId === g.id ? 'var(--color-accent-50)' : 'transparent',
                  borderBottom: '1px solid var(--color-border)',
                  transition: 'background 120ms',
                }}
              >
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{g.name}</div>
                  {g.required && <span style={{ fontSize: 11, color: 'var(--color-accent-600)', fontWeight: 600 }}>จำเป็น</span>}
                </div>
                <button
                  onClick={e => { e.stopPropagation(); setDeleteTarget(g); }}
                  style={{ background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 18, padding: '2px 6px', borderRadius: 4 }}
                  title="ลบกลุ่มนี้"
                >×</button>
              </div>
            ))}
            {!groups?.length && (
              <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
                ยังไม่มีกลุ่มตัวเลือก
              </div>
            )}
          </div>
        </div>

        {/* Right pane — detail / form */}
        {showForm ? (
          <div style={{ flex: 1, background: 'var(--color-surface)', borderRadius: 12, border: '1px solid var(--color-border)', overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--color-border)' }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>
                {isCreating ? 'สร้างกลุ่มตัวเลือกใหม่' : 'แก้ไขกลุ่มตัวเลือก'}
              </span>
            </div>
            <div style={{ padding: 20 }}>
              {/* Group fields */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
                <div style={{ gridColumn: '1/-1' }}>
                  <label style={labelCss}>ชื่อกลุ่ม</label>
                  <input
                    value={formName}
                    onChange={e => setFormName(e.target.value)}
                    placeholder="เช่น ขนาด, ความหวาน"
                    style={inputCss}
                  />
                </div>
                <div>
                  <label style={labelCss}>เลือกขั้นต่ำ</label>
                  <input
                    type="number" min={0}
                    value={formMinSelect}
                    onChange={e => setFormMinSelect(Number(e.target.value))}
                    style={inputCss}
                  />
                </div>
                <div>
                  <label style={labelCss}>เลือกสูงสุด (ว่าง = ไม่จำกัด)</label>
                  <input
                    type="number" min={1}
                    value={formMaxSelect}
                    onChange={e => setFormMaxSelect(e.target.value)}
                    placeholder="ว่าง = ไม่จำกัด"
                    style={inputCss}
                  />
                  <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 4 }}>{selectionHint}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox" id="req-chk"
                    checked={formRequired}
                    onChange={e => setFormRequired(e.target.checked)}
                    style={{ width: 16, height: 16, accentColor: 'var(--color-primary)', cursor: 'pointer' }}
                  />
                  <label htmlFor="req-chk" style={{ fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>บังคับเลือก (จำเป็น)</label>
                </div>
              </div>

              {/* Modifiers table */}
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>ตัวเลือก</div>
              {formModifiers.length > 0 && (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginBottom: 8 }}>
                  <thead>
                    <tr style={{ background: 'var(--color-surface-2)' }}>
                      {['ชื่อ', 'ราคาต่างจากปกติ (฿)', 'ลำดับ', ''].map((h, i) => (
                        <th key={i} style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, fontSize: 12, color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {formModifiers.map((m, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <td style={{ padding: '6px 8px' }}>
                          <input value={m.name} onChange={e => updateModRow(i, 'name', e.target.value)} placeholder="ชื่อตัวเลือก" style={{ ...inputCss, padding: '4px 8px', fontSize: 13 }} />
                        </td>
                        <td style={{ padding: '6px 8px', width: 170 }}>
                          <input value={m.price_delta} onChange={e => updateModRow(i, 'price_delta', e.target.value)} placeholder="0" style={{ ...inputCss, padding: '4px 8px', fontSize: 13, fontFamily: 'var(--font-num)' }} />
                        </td>
                        <td style={{ padding: '6px 8px', width: 80 }}>
                          <input type="number" value={m.sort_order} onChange={e => updateModRow(i, 'sort_order', Number(e.target.value))} style={{ ...inputCss, padding: '4px 8px', fontSize: 13, fontFamily: 'var(--font-num)', width: 60 }} />
                        </td>
                        <td style={{ padding: '6px 8px', width: 36, textAlign: 'center' }}>
                          <button onClick={() => removeModRow(i)} style={{ background: 'transparent', border: 'none', color: 'var(--color-danger)', cursor: 'pointer', fontSize: 18 }}>×</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <button onClick={addModifierRow} style={{ ...btnSm('ghost'), fontSize: 13, marginBottom: 24 }}>
                + เพิ่มตัวเลือก
              </button>

              {/* Action buttons */}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 16, borderTop: '1px solid var(--color-border)' }}>
                {isCreating ? (
                  <>
                    <button onClick={() => setIsCreating(false)} style={btnSm('ghost')}>ยกเลิก</button>
                    <button onClick={handleCreate} disabled={!formName.trim() || createGroup.isPending} style={btnSm('primary')}>
                      {createGroup.isPending ? 'กำลังสร้าง…' : 'สร้าง'}
                    </button>
                  </>
                ) : (
                  <button onClick={handleSave} disabled={!formName.trim() || updateGroup.isPending} style={btnSm('primary')}>
                    {updateGroup.isPending ? 'กำลังบันทึก…' : 'บันทึก'}
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, display: 'grid', placeItems: 'center', minHeight: 260, color: 'var(--color-text-muted)', fontSize: 14 }}>
            เลือกกลุ่มตัวเลือกจากรายการ หรือกด "+ สร้าง"
          </div>
        )}
      </div>

      {/* Delete confirm */}
      {deleteTarget && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'grid', placeItems: 'center', zIndex: 50 }}>
          <div style={{ background: 'var(--color-surface)', borderRadius: 12, padding: 24, width: 360, boxShadow: 'var(--shadow-lg)' }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 700 }}>ลบกลุ่มตัวเลือก</h3>
            <p style={{ margin: '0 0 20px', fontSize: 14, color: 'var(--color-text-secondary)' }}>
              ลบ <strong>{deleteTarget.name}</strong>? ตัวเลือกทั้งหมดในกลุ่มนี้จะถูกลบด้วย
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setDeleteTarget(null)} style={btnSm('ghost')}>ยกเลิก</button>
              <button onClick={handleDeleteGroup} disabled={deleteGroup.isPending} style={btnSm('danger')}>ลบ</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```powershell
Set-Location d:\POS\app
pnpm tsc --noEmit
```

Expected: no errors in `catalog.tsx`.

- [ ] **Step 3: Commit**

```powershell
$env:GIT_INDEX_FILE = ".git/index2"
Set-Location d:\POS
git read-tree HEAD
git add app/src/components/screens/catalog.tsx
cp .git/index2 .git/index
Remove-Item .git/index2 -ErrorAction SilentlyContinue
$TREE = git write-tree
$PARENT = git rev-parse HEAD
$COMMIT = git commit-tree $TREE -p $PARENT -m "feat(catalog): add CatalogAdmin screen with Categories and Modifier Groups tabs

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
"$COMMIT" | Out-File .git/refs/heads/main -Encoding ascii -NoNewline
git push origin main
"$COMMIT" | Out-File .git/refs/remotes/origin/main -Encoding ascii -NoNewline
```

---

## Task 5: Wire catalog screen into page.tsx

**Files:**
- Modify: `app/src/app/page.tsx`

- [ ] **Step 1: Add import, Screen type, and screens entry**

In `app/src/app/page.tsx`, make three changes:

**1. Add import** (after the last existing screen import):
```tsx
// After: import HardwareScreen from '@/components/screens/hardware';
import CatalogAdmin from '@/components/screens/catalog';
```

**2. Add `'catalog'` to the Screen union type:**
```tsx
// BEFORE
type Screen =
  | 'pos' | 'kds' | 'dashboard' | 'bom' | 'inventory'
  | 'pre-orders' | 'shopping-list'
  | 'cash' | 'promotions' | 'protocols' | 'hr' | 'shifts'
  | 'hardware' | 'customers' | 'reports' | 'settings';

// AFTER
type Screen =
  | 'pos' | 'kds' | 'dashboard' | 'bom' | 'inventory'
  | 'pre-orders' | 'shopping-list'
  | 'cash' | 'promotions' | 'protocols' | 'hr' | 'shifts'
  | 'hardware' | 'customers' | 'reports' | 'catalog' | 'settings';
```

**3. Add entry to the screens record** (after `reports`):
```tsx
// BEFORE
    reports:    <Reports />,
    settings:   <Settings />,

// AFTER
    reports:    <Reports />,
    catalog:    <CatalogAdmin />,
    settings:   <Settings />,
```

- [ ] **Step 2: Verify TypeScript compiles**

```powershell
Set-Location d:\POS\app
pnpm tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Smoke-test in browser**

With dev server running:
1. Log in as OWNER → "Catalog" appears in sidebar
2. Click "Catalog" → page renders with "หมวดหมู่" and "กลุ่มตัวเลือก" tabs
3. Switch tabs — no errors in console
4. Log in as MANAGER → "Catalog" absent from sidebar; navigating to it directly is impossible (no URL)

- [ ] **Step 4: Commit and push**

```powershell
$env:GIT_INDEX_FILE = ".git/index2"
Set-Location d:\POS
git read-tree HEAD
git add app/src/app/page.tsx
cp .git/index2 .git/index
Remove-Item .git/index2 -ErrorAction SilentlyContinue
$TREE = git write-tree
$PARENT = git rev-parse HEAD
$COMMIT = git commit-tree $TREE -p $PARENT -m "feat(routing): register CatalogAdmin screen in page.tsx

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
"$COMMIT" | Out-File .git/refs/heads/main -Encoding ascii -NoNewline
git push origin main
"$COMMIT" | Out-File .git/refs/remotes/origin/main -Encoding ascii -NoNewline
```

---

## Task 6: End-to-end acceptance verification

No code changes — this task validates all acceptance criteria from the spec.

- [ ] **Categories tab**
  - Create a category named "เครื่องดื่ม" → appears in list
  - Create a second category "อาหาร"
  - Use ↑↓ arrows to swap their order → sort_order swaps
  - Rename "อาหาร" to "เบเกอรี่" → name updates
  - Delete "เบเกอรี่" (no products attached) → removed from list
  - Open BOM Builder → click "+ เพิ่มรายการ" → หมวดหมู่ dropdown now shows "เครื่องดื่ม" ✓

- [ ] **Modifier Groups tab**
  - Click "+ สร้าง" → form appears in right pane
  - Fill name "ขนาด", required ✓, max_select = 1 → hint shows "radio buttons"
  - Add modifiers: S (price_delta "−5"), M ("0"), L ("10") → click "สร้าง"
  - New group appears in left list; right pane loads it
  - Edit: rename to "SIZE", uncheck required, click "บันทึก" → saved
  - Open BOM Builder → "เปลี่ยนตัวเลือก" picker shows "SIZE" ✓

- [ ] **409 on category delete**
  - Create a category, create a product with that category in BOM Builder
  - Try to delete the category → toast: "ไม่สามารถลบหมวดหมู่ที่ยังมีเมนูใช้งานอยู่…" ✓

- [ ] **Sidebar scroll**
  - Shrink browser window to 600px height → nav scrolls, logout button reachable ✓
