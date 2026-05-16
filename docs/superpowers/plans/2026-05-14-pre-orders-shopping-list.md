# Pre-Orders & Shopping List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Pre-Orders and Shopping List modules to the café POS — two new sidebar screens with full CRUD, status lifecycle, ingredient review, and print support.

**Architecture:** Option A — single file per screen, matching the existing `inventory.tsx` pattern. Two new hook files (`use-pre-orders.ts`, `use-shopping-list.ts`) and two new screen files (`pre-orders.tsx`, `shopping-list.tsx`). Navigation wired in `app-common.tsx` + `page.tsx`.

**Tech Stack:** Next.js 16, React 19, TypeScript, TanStack Query v5, inline CSS with CSS variables (no Tailwind in screen files — follow existing pattern).

---

## File Map

| Action | File |
|--------|------|
| Modify | `app/src/components/app-common.tsx` |
| Modify | `app/src/app/page.tsx` |
| Create | `app/src/hooks/use-shopping-list.ts` |
| Create | `app/src/hooks/use-pre-orders.ts` |
| Create | `app/src/components/screens/shopping-list.tsx` |
| Create | `app/src/components/screens/pre-orders.tsx` |

---

## Task 1: Wire Navigation

**Files:**
- Modify: `app/src/components/app-common.tsx` (NAV array, ~line 48)
- Modify: `app/src/app/page.tsx` (Screen type + screens record)

- [ ] **Step 1: Add NAV entries to `app-common.tsx`**

In `app/src/components/app-common.tsx`, find the line `{ id: 'inventory', label: 'Inventory', icon: 'inv', soft: true },` and add two entries immediately after it:

```typescript
  { id: 'inventory',     label: 'Inventory',     icon: 'inv',      soft: true },
  { id: 'pre-orders',    label: 'Pre-Orders',    icon: 'calendar' },
  { id: 'shopping-list', label: 'Shopping List',  icon: 'cart' },
  { id: 'cash',          label: 'Cash',           icon: 'cash',     adminOnly: true },
```

- [ ] **Step 2: Extend Screen type and register screens in `page.tsx`**

Replace the Screen type and add imports + screen entries:

```typescript
// top of file — add these imports after existing imports
import PreOrders from '@/components/screens/pre-orders';
import ShoppingListScreen from '@/components/screens/shopping-list';

// Screen type
type Screen =
  | 'pos' | 'kds' | 'dashboard' | 'bom' | 'inventory'
  | 'pre-orders' | 'shopping-list'
  | 'cash' | 'promotions' | 'protocols' | 'hr' | 'shifts'
  | 'hardware' | 'customers' | 'reports' | 'settings';

// inside screens record, add after inventory entry:
'pre-orders':    <PreOrders />,
'shopping-list': <ShoppingListScreen />,
```

- [ ] **Step 3: Verify types**

Run from `app/`:
```
pnpm typecheck
```
Expected: exits cleanly (or only pre-existing errors — no new errors).

- [ ] **Step 4: Commit**

```bash
git add app/src/components/app-common.tsx app/src/app/page.tsx
git commit -m "feat: add Pre-Orders and Shopping List to sidebar navigation"
```

---

## Task 2: Shopping List Hook (`use-shopping-list.ts`)

**Files:**
- Create: `app/src/hooks/use-shopping-list.ts`

- [ ] **Step 1: Create the file**

Create `app/src/hooks/use-shopping-list.ts` with the following content:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

// ── Backend shapes ────────────────────────────────────────────────────────────
interface ShoppingListItemRead {
  id: string;
  inventory_item_id: string;
  inventory_item_name: string;
  unit: string;
  note: string | null;
  added_by_id: string;
  created_at: string;
}

// ── Frontend shapes ───────────────────────────────────────────────────────────
export interface ShoppingListItem {
  id: string;
  inventoryItemId: string;
  inventoryItemName: string;
  unit: string;
  note: string | null;
  addedById: string;
  createdAt: string;
}

// ── Mapper ────────────────────────────────────────────────────────────────────
function mapItem(i: ShoppingListItemRead): ShoppingListItem {
  return {
    id: i.id,
    inventoryItemId: i.inventory_item_id,
    inventoryItemName: i.inventory_item_name,
    unit: i.unit,
    note: i.note,
    addedById: i.added_by_id,
    createdAt: i.created_at,
  };
}

// ── Hooks ─────────────────────────────────────────────────────────────────────
export function useShoppingList() {
  return useQuery<ShoppingListItem[]>({
    queryKey: ['shopping-list'],
    queryFn: async () => {
      const data = await api.get<ShoppingListItemRead[]>('/api/v1/shopping-list');
      return data.map(mapItem);
    },
  });
}

interface AddPayload {
  inventory_item_id: string;
  note?: string;
}

export function useAddToShoppingList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: AddPayload) =>
      api.post<ShoppingListItemRead>('/api/v1/shopping-list', p),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shopping-list'] });
      qc.invalidateQueries({ queryKey: ['pre-order-ingredients'] });
    },
  });
}

export function useRemoveFromShoppingList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) =>
      api.delete<void>(`/api/v1/shopping-list/${itemId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shopping-list'] });
      qc.invalidateQueries({ queryKey: ['pre-order-ingredients'] });
    },
  });
}
```

- [ ] **Step 2: Typecheck**

```
pnpm typecheck
```
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/hooks/use-shopping-list.ts
git commit -m "feat: add useShoppingList, useAddToShoppingList, useRemoveFromShoppingList hooks"
```

---

## Task 3: Shopping List Screen (`shopping-list.tsx`)

**Files:**
- Create: `app/src/components/screens/shopping-list.tsx`

- [ ] **Step 1: Create the screen file**

Create `app/src/components/screens/shopping-list.tsx`:

```typescript
'use client';

import { useState } from 'react';
import Icon from '../icons';
import { useToast } from '../app-common';
import {
  useShoppingList, useAddToShoppingList, useRemoveFromShoppingList,
  type ShoppingListItem,
} from '@/hooks/use-shopping-list';
import { useInventory } from '@/hooks/use-inventory';

export default function ShoppingListScreen() {
  const toast = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [addItemId, setAddItemId] = useState('');
  const [addNote, setAddNote] = useState('');
  const [invSearch, setInvSearch] = useState('');

  const { data: items = [], isLoading } = useShoppingList();
  const { data: invItems = [] } = useInventory(invSearch || undefined);
  const addMut = useAddToShoppingList();
  const removeMut = useRemoveFromShoppingList();

  const resetAddForm = () => {
    setAddOpen(false);
    setAddItemId('');
    setAddNote('');
    setInvSearch('');
  };

  const handleAdd = async () => {
    if (!addItemId) return;
    try {
      await addMut.mutateAsync({ inventory_item_id: addItemId, note: addNote.trim() || undefined });
      resetAddForm();
      toast({ kind: 'success', title: 'เพิ่มเข้า Shopping List แล้ว' });
    } catch (err) {
      toast({ kind: 'danger', title: 'เกิดข้อผิดพลาด', msg: err instanceof Error ? err.message : undefined });
    }
  };

  const handleRemove = async (item: ShoppingListItem) => {
    try {
      await removeMut.mutateAsync(item.id);
      toast({ kind: 'success', title: `ลบ ${item.inventoryItemName} แล้ว` });
    } catch (err) {
      toast({ kind: 'danger', title: 'ลบไม่สำเร็จ', msg: err instanceof Error ? err.message : undefined });
    }
  };

  const filteredInv = invSearch
    ? invItems.filter(it => it.name.toLowerCase().includes(invSearch.toLowerCase()))
    : [];

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 24, background: 'var(--color-bg)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: '-0.01em' }}>Shopping List</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => window.open('/api/v1/shopping-list/print', '_blank')}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface)', cursor: 'pointer', fontSize: 13, fontWeight: 500 }}
          >
            <Icon name="print" size={16} />
            พิมพ์รายการ
          </button>
          <button
            onClick={() => setAddOpen(v => !v)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: 'none', background: 'var(--color-primary)', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
          >
            <Icon name="plus" size={16} color="#fff" />
            เพิ่มวัตถุดิบ
          </button>
        </div>
      </div>

      {/* Inline add form */}
      {addOpen && (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            {/* Ingredient search */}
            <div style={{ flex: 2, minWidth: 200, position: 'relative' }}>
              <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>วัตถุดิบ</label>
              <input
                placeholder="พิมพ์เพื่อค้นหา..."
                value={invSearch}
                onChange={e => { setInvSearch(e.target.value); setAddItemId(''); }}
                style={{ width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid var(--color-border)', fontSize: 13, background: 'var(--color-bg)', boxSizing: 'border-box' }}
              />
              {filteredInv.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, border: '1px solid var(--color-border)', borderRadius: 7, background: 'var(--color-surface)', zIndex: 20, maxHeight: 180, overflowY: 'auto', marginTop: 2, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
                  {filteredInv.slice(0, 8).map(it => (
                    <div
                      key={it.id}
                      onClick={() => { setAddItemId(it.id); setInvSearch(it.name); }}
                      style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between' }}
                    >
                      <span>{it.name}</span>
                      <span style={{ color: 'var(--color-text-secondary)' }}>{it.unit}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {/* Note */}
            <div style={{ flex: 3, minWidth: 180 }}>
              <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>หมายเหตุ (ไม่บังคับ)</label>
              <input
                placeholder="เช่น ซื้อ 5 kg"
                value={addNote}
                onChange={e => setAddNote(e.target.value)}
                maxLength={255}
                style={{ width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid var(--color-border)', fontSize: 13, background: 'var(--color-bg)', boxSizing: 'border-box' }}
              />
            </div>
            {/* Buttons */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleAdd}
                disabled={!addItemId || addMut.isPending}
                style={{ padding: '8px 16px', borderRadius: 7, border: 'none', background: 'var(--color-primary)', color: '#fff', fontWeight: 600, fontSize: 13, cursor: addItemId ? 'pointer' : 'not-allowed', opacity: addItemId ? 1 : 0.5 }}
              >
                {addMut.isPending ? 'กำลังเพิ่ม...' : 'เพิ่ม'}
              </button>
              <button
                onClick={resetAddForm}
                style={{ padding: '8px 12px', borderRadius: 7, border: '1px solid var(--color-border)', background: 'var(--color-surface)', fontSize: 13, cursor: 'pointer' }}
              >
                ยกเลิก
              </button>
            </div>
          </div>
        </div>
      )}

      {/* List */}
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--color-text-secondary)', fontSize: 14 }}>กำลังโหลด...</div>
      ) : items.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--color-text-secondary)' }}>
          <Icon name="cart" size={40} color="var(--color-border-strong)" />
          <div style={{ marginTop: 12, fontSize: 14 }}>รายการว่างเปล่า</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>เพิ่มวัตถุดิบที่ต้องซื้อเข้ามาได้เลย</div>
        </div>
      ) : (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, overflow: 'hidden' }}>
          {items.map((item, idx) => (
            <div
              key={item.id}
              style={{
                display: 'flex', alignItems: 'center', padding: '12px 16px', gap: 12,
                borderBottom: idx < items.length - 1 ? '1px solid var(--color-border)' : 'none',
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 500 }}>
                  {item.inventoryItemName}
                  <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--color-text-secondary)', fontWeight: 400 }}>
                    [{item.unit}]
                  </span>
                </div>
                {item.note && (
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>{item.note}</div>
                )}
              </div>
              <button
                onClick={() => handleRemove(item)}
                disabled={removeMut.isPending}
                style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid var(--color-border)', background: 'transparent', display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--color-text-secondary)', flexShrink: 0 }}
              >
                <Icon name="x" size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```
pnpm typecheck
```

- [ ] **Step 3: Smoke test — start dev server and open Shopping List**

```
pnpm dev
```
Navigate to Shopping List in sidebar. Verify:
- Empty state renders without console errors
- "เพิ่มวัตถุดิบ" button opens the add form
- "พิมพ์รายการ" button opens a new tab to `/api/v1/shopping-list/print`

- [ ] **Step 4: Commit**

```bash
git add app/src/components/screens/shopping-list.tsx
git commit -m "feat: add Shopping List screen with add/remove/print"
```

---

## Task 4: Pre-Orders Hook (`use-pre-orders.ts`)

**Files:**
- Create: `app/src/hooks/use-pre-orders.ts`

- [ ] **Step 1: Create the file**

Create `app/src/hooks/use-pre-orders.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

// ── Enums & backend shapes ────────────────────────────────────────────────────
export type PreOrderStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

interface PreOrderItemRead {
  id: string;
  product_id: string | null;
  product_name: string;
  quantity: number;
  unit_price: string;
  line_total: string;
}

interface PreOrderRead {
  id: string;
  store_id: string;
  order_date: string;
  due_date: string;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  deposit_amount: string | null;
  deposit_paid: boolean;
  notes: string | null;
  status: PreOrderStatus;
  created_by_id: string;
  started_by_id: string | null;
  completed_by_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  items: PreOrderItemRead[];
  created_at: string;
  updated_at: string;
}

interface PreOrderSummaryRead {
  id: string;
  order_date: string;
  due_date: string;
  customer_name: string | null;
  customer_phone: string | null;
  status: PreOrderStatus;
  item_count: number;
  created_at: string;
}

interface PreOrdersPageRead {
  items: PreOrderSummaryRead[];
  total: number;
}

interface IngredientLineRead {
  inventory_item_id: string;
  name: string;
  unit: string;
  qty_needed: string;
  stock_on_hand: string;
  usage_pct: number | null;
  exceeds_threshold: boolean;
  on_shopping_list: boolean;
}

interface IngredientSummaryRead {
  threshold: number;
  items: IngredientLineRead[];
}

// ── Frontend shapes ───────────────────────────────────────────────────────────
export interface PreOrderItem {
  id: string;
  productId: string | null;
  productName: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
}

export interface PreOrder {
  id: string;
  storeId: string;
  orderDate: string;
  dueDate: string;
  customerId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  depositAmount: string | null;
  depositPaid: boolean;
  notes: string | null;
  status: PreOrderStatus;
  createdById: string;
  startedById: string | null;
  completedById: string | null;
  startedAt: string | null;
  completedAt: string | null;
  items: PreOrderItem[];
  createdAt: string;
  updatedAt: string;
}

export interface PreOrderListItem {
  id: string;
  orderDate: string;
  dueDate: string;
  customerName: string | null;
  customerPhone: string | null;
  status: PreOrderStatus;
  itemCount: number;
  createdAt: string;
}

export interface IngredientLine {
  inventoryItemId: string;
  name: string;
  unit: string;
  qtyNeeded: string;
  stockOnHand: string;
  usagePct: number | null;
  exceedsThreshold: boolean;
  onShoppingList: boolean;
}

export interface IngredientsResult {
  threshold: number;
  items: IngredientLine[];
}

// ── Mappers ───────────────────────────────────────────────────────────────────
function mapOrderItem(i: PreOrderItemRead): PreOrderItem {
  return {
    id: i.id,
    productId: i.product_id,
    productName: i.product_name,
    quantity: i.quantity,
    unitPrice: i.unit_price,
    lineTotal: i.line_total,
  };
}

function mapPreOrder(p: PreOrderRead): PreOrder {
  return {
    id: p.id,
    storeId: p.store_id,
    orderDate: p.order_date,
    dueDate: p.due_date,
    customerId: p.customer_id,
    customerName: p.customer_name,
    customerPhone: p.customer_phone,
    depositAmount: p.deposit_amount,
    depositPaid: p.deposit_paid,
    notes: p.notes,
    status: p.status,
    createdById: p.created_by_id,
    startedById: p.started_by_id,
    completedById: p.completed_by_id,
    startedAt: p.started_at,
    completedAt: p.completed_at,
    items: p.items.map(mapOrderItem),
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}

function mapListItem(s: PreOrderSummaryRead): PreOrderListItem {
  return {
    id: s.id,
    orderDate: s.order_date,
    dueDate: s.due_date,
    customerName: s.customer_name,
    customerPhone: s.customer_phone,
    status: s.status,
    itemCount: s.item_count,
    createdAt: s.created_at,
  };
}

function mapIngredientLine(i: IngredientLineRead): IngredientLine {
  return {
    inventoryItemId: i.inventory_item_id,
    name: i.name,
    unit: i.unit,
    qtyNeeded: i.qty_needed,
    stockOnHand: i.stock_on_hand,
    usagePct: i.usage_pct,
    exceedsThreshold: i.exceeds_threshold,
    onShoppingList: i.on_shopping_list,
  };
}

// ── Read hooks ────────────────────────────────────────────────────────────────
export function usePreOrders(status?: PreOrderStatus, page = 1, limit = 50) {
  return useQuery<{ items: PreOrderListItem[]; total: number }>({
    queryKey: ['pre-orders', status, page, limit],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      params.set('page', String(page));
      params.set('limit', String(limit));
      const data = await api.get<PreOrdersPageRead>(`/api/v1/pre-orders?${params}`);
      return { items: data.items.map(mapListItem), total: data.total };
    },
  });
}

export function usePreOrder(id: string | null) {
  return useQuery<PreOrder>({
    queryKey: ['pre-order', id],
    queryFn: async () => {
      const data = await api.get<PreOrderRead>(`/api/v1/pre-orders/${id}`);
      return mapPreOrder(data);
    },
    enabled: !!id,
  });
}

export function usePreOrderIngredients(id: string | null, threshold = 50) {
  return useQuery<IngredientsResult>({
    queryKey: ['pre-order-ingredients', id, threshold],
    queryFn: async () => {
      const data = await api.get<IngredientSummaryRead>(
        `/api/v1/pre-orders/${id}/ingredients?threshold=${threshold}`
      );
      return { threshold: data.threshold, items: data.items.map(mapIngredientLine) };
    },
    enabled: !!id,
  });
}

// ── Mutation payloads ─────────────────────────────────────────────────────────
export interface CreatePreOrderItemPayload {
  product_id: string;
  quantity: number;
  unit_price?: string;
}

export interface CreatePreOrderPayload {
  order_date: string;
  due_date: string;
  customer_name?: string;
  customer_phone?: string;
  customer_id?: string;
  deposit_amount?: string;
  deposit_paid?: boolean;
  notes?: string;
  items: CreatePreOrderItemPayload[];
}

export interface UpdatePreOrderPayload {
  order_date?: string;
  due_date?: string;
  customer_name?: string;
  customer_phone?: string;
  customer_id?: string | null;
  deposit_amount?: string;
  deposit_paid?: boolean;
  notes?: string;
}

// ── Mutation hooks ────────────────────────────────────────────────────────────
export function useCreatePreOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: CreatePreOrderPayload) =>
      api.post<PreOrderRead>('/api/v1/pre-orders', p),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pre-orders'] });
    },
  });
}

export function useUpdatePreOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdatePreOrderPayload }) =>
      api.patch<PreOrderRead>(`/api/v1/pre-orders/${id}`, data),
    onSuccess: (_res, { id }) => {
      qc.invalidateQueries({ queryKey: ['pre-orders'] });
      qc.invalidateQueries({ queryKey: ['pre-order', id] });
    },
  });
}

export function useAddPreOrderItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, item }: { id: string; item: CreatePreOrderItemPayload }) =>
      api.post<PreOrderRead>(`/api/v1/pre-orders/${id}/items`, item),
    onSuccess: (_res, { id }) => {
      qc.invalidateQueries({ queryKey: ['pre-order', id] });
    },
  });
}

export function useRemovePreOrderItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, itemId }: { orderId: string; itemId: string }) =>
      api.delete<PreOrderRead>(`/api/v1/pre-orders/${orderId}/items/${itemId}`),
    onSuccess: (_res, { orderId }) => {
      qc.invalidateQueries({ queryKey: ['pre-order', orderId] });
    },
  });
}

export function useStartPreOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<PreOrderRead>(`/api/v1/pre-orders/${id}/start`, {}),
    onSuccess: (_res, id) => {
      qc.invalidateQueries({ queryKey: ['pre-orders'] });
      qc.invalidateQueries({ queryKey: ['pre-order', id] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
      qc.invalidateQueries({ queryKey: ['inventory-movements'] });
    },
  });
}

export function useCompletePreOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<PreOrderRead>(`/api/v1/pre-orders/${id}/complete`, {}),
    onSuccess: (_res, id) => {
      qc.invalidateQueries({ queryKey: ['pre-orders'] });
      qc.invalidateQueries({ queryKey: ['pre-order', id] });
    },
  });
}

export function useCancelPreOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<PreOrderRead>(`/api/v1/pre-orders/${id}/cancel`, {}),
    onSuccess: (_res, id) => {
      qc.invalidateQueries({ queryKey: ['pre-orders'] });
      qc.invalidateQueries({ queryKey: ['pre-order', id] });
    },
  });
}
```

- [ ] **Step 2: Typecheck**

```
pnpm typecheck
```
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/hooks/use-pre-orders.ts
git commit -m "feat: add pre-orders hooks (CRUD, lifecycle, ingredients)"
```

---

## Task 5: Pre-Orders Screen — Skeleton, List & Status Filter

**Files:**
- Create: `app/src/components/screens/pre-orders.tsx` (initial version — list column only, empty right panel)

- [ ] **Step 1: Create the file with list + status filter**

Create `app/src/components/screens/pre-orders.tsx`:

```typescript
'use client';

import { useState } from 'react';
import Icon from '../icons';
import { useToast, Tag } from '../app-common';
import {
  usePreOrders, usePreOrder, usePreOrderIngredients,
  useCreatePreOrder, useUpdatePreOrder,
  useAddPreOrderItem, useRemovePreOrderItem,
  useStartPreOrder, useCompletePreOrder, useCancelPreOrder,
  type PreOrder, type PreOrderListItem, type PreOrderStatus,
  type CreatePreOrderPayload, type CreatePreOrderItemPayload,
} from '@/hooks/use-pre-orders';
import { useAddToShoppingList } from '@/hooks/use-shopping-list';
import { useAllProducts } from '@/hooks/use-products';

// ── Helpers ───────────────────────────────────────────────────────────────────
const STATUS_LABELS: Record<PreOrderStatus, string> = {
  PENDING:     'Pending',
  IN_PROGRESS: 'In Progress',
  COMPLETED:   'Completed',
  CANCELLED:   'Cancelled',
};

const STATUS_COLORS: Record<PreOrderStatus, { color: string; bg: string }> = {
  PENDING:     { color: '#9C6A1F',               bg: 'var(--color-warning-50)' },
  IN_PROGRESS: { color: 'var(--color-info)',      bg: '#EFF6FF' },
  COMPLETED:   { color: 'var(--color-success)',   bg: 'var(--color-success-50, #F0FDF4)' },
  CANCELLED:   { color: 'var(--color-text-secondary)', bg: 'var(--color-surface-2)' },
};

const todayIso = () => new Date().toISOString().split('T')[0];

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });

const fmtMoney = (v: string | null) =>
  v ? Number(v).toFixed(2) : '—';

function StatusBadge({ status }: { status: PreOrderStatus }) {
  const { color, bg } = STATUS_COLORS[status];
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 999,
      fontSize: 11, fontWeight: 600, color, background: bg,
    }}>
      {STATUS_LABELS[status]}
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function PreOrders() {
  const toast = useToast();

  // List state
  const [statusFilter, setStatusFilter] = useState<PreOrderStatus | undefined>(undefined);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Detail state
  const [detailTab, setDetailTab] = useState<'details' | 'ingredients'>('details');
  const [threshold, setThreshold] = useState(50);

  // Add-item-to-existing-order state (inline row in detail panel)
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [addItemProductId, setAddItemProductId] = useState('');
  const [addItemProductSearch, setAddItemProductSearch] = useState('');
  const [addItemQty, setAddItemQty] = useState(1);
  const [addItemPrice, setAddItemPrice] = useState('');

  // Create modal state
  const [createOpen, setCreateOpen] = useState(false);
  const [cName, setCName] = useState('');
  const [cPhone, setCPhone] = useState('');
  const [cOrderDate, setCOrderDate] = useState(todayIso());
  const [cDueDate, setCDueDate] = useState('');
  const [cDeposit, setCDeposit] = useState('');
  const [cDepositPaid, setCDepositPaid] = useState(false);
  const [cNotes, setCNotes] = useState('');
  const [cItems, setCItems] = useState<CreatePreOrderItemPayload[]>([]);
  const [cItemProductId, setCItemProductId] = useState('');
  const [cItemProductSearch, setCItemProductSearch] = useState('');
  const [cItemQty, setCItemQty] = useState(1);
  const [cItemPrice, setCItemPrice] = useState('');

  // Edit modal state
  const [editOpen, setEditOpen] = useState(false);
  const [eOrderDate, setEOrderDate] = useState('');
  const [eDueDate, setEDueDate] = useState('');
  const [eName, setEName] = useState('');
  const [ePhone, setEPhone] = useState('');
  const [eDeposit, setEDeposit] = useState('');
  const [eDepositPaid, setEDepositPaid] = useState(false);
  const [eNotes, setENotes] = useState('');

  // Confirm dialog state
  const [confirmStart, setConfirmStart] = useState(false);

  // Queries
  const { data: listData, isLoading: listLoading } = usePreOrders(statusFilter);
  const { data: detail, isLoading: detailLoading } = usePreOrder(selectedId);
  const { data: ingredients } = usePreOrderIngredients(
    detailTab === 'ingredients' ? selectedId : null,
    threshold,
  );
  const { data: allProducts = [] } = useAllProducts();

  // Mutations
  const createMut   = useCreatePreOrder();
  const updateMut   = useUpdatePreOrder();
  const addItemMut  = useAddPreOrderItem();
  const rmItemMut   = useRemovePreOrderItem();
  const startMut    = useStartPreOrder();
  const completeMut = useCompletePreOrder();
  const cancelMut   = useCancelPreOrder();
  const addToList   = useAddToShoppingList();

  const listItems = listData?.items ?? [];

  // ── Handlers ────────────────────────────────────────────────────────────────

  const resetCreateForm = () => {
    setCName(''); setCPhone('');
    setCOrderDate(todayIso()); setCDueDate('');
    setCDeposit(''); setCDepositPaid(false); setCNotes('');
    setCItems([]);
    setCItemProductId(''); setCItemProductSearch(''); setCItemQty(1); setCItemPrice('');
    setCreateOpen(false);
  };

  const handleCreate = async () => {
    if (!cName.trim() || !cPhone.trim()) {
      toast({ kind: 'warning', title: 'กรุณากรอกชื่อและเบอร์โทรลูกค้า' }); return;
    }
    if (!cDueDate) {
      toast({ kind: 'warning', title: 'กรุณาระบุกำหนดส่ง' }); return;
    }
    if (cItems.length === 0) {
      toast({ kind: 'warning', title: 'กรุณาเพิ่มสินค้าอย่างน้อย 1 รายการ' }); return;
    }
    const payload: CreatePreOrderPayload = {
      order_date: cOrderDate,
      due_date: cDueDate,
      customer_name: cName.trim(),
      customer_phone: cPhone.trim(),
      deposit_amount: cDeposit || undefined,
      deposit_paid: cDepositPaid,
      notes: cNotes.trim() || undefined,
      items: cItems,
    };
    try {
      const created = await createMut.mutateAsync(payload);
      resetCreateForm();
      setSelectedId(created.id);
      toast({ kind: 'success', title: 'สร้าง Pre-Order แล้ว' });
    } catch (err) {
      toast({ kind: 'danger', title: 'สร้างไม่สำเร็จ', msg: err instanceof Error ? err.message : undefined });
    }
  };

  const openEdit = (po: PreOrder) => {
    setEOrderDate(po.orderDate);
    setEDueDate(po.dueDate);
    setEName(po.customerName ?? '');
    setEPhone(po.customerPhone ?? '');
    setEDeposit(po.depositAmount ?? '');
    setEDepositPaid(po.depositPaid);
    setENotes(po.notes ?? '');
    setEditOpen(true);
  };

  const handleUpdate = async () => {
    if (!selectedId) return;
    try {
      await updateMut.mutateAsync({
        id: selectedId,
        data: {
          order_date: eOrderDate,
          due_date: eDueDate,
          customer_name: eName.trim() || undefined,
          customer_phone: ePhone.trim() || undefined,
          deposit_amount: eDeposit || undefined,
          deposit_paid: eDepositPaid,
          notes: eNotes.trim() || undefined,
        },
      });
      setEditOpen(false);
      toast({ kind: 'success', title: 'อัปเดต Pre-Order แล้ว' });
    } catch (err) {
      toast({ kind: 'danger', title: 'อัปเดตไม่สำเร็จ', msg: err instanceof Error ? err.message : undefined });
    }
  };

  const handleAddItem = async () => {
    if (!selectedId || !addItemProductId) return;
    try {
      await addItemMut.mutateAsync({
        id: selectedId,
        item: {
          product_id: addItemProductId,
          quantity: addItemQty,
          unit_price: addItemPrice.trim() || undefined,
        },
      });
      setAddItemOpen(false);
      setAddItemProductId(''); setAddItemProductSearch(''); setAddItemQty(1); setAddItemPrice('');
      toast({ kind: 'success', title: 'เพิ่มสินค้าแล้ว' });
    } catch (err) {
      toast({ kind: 'danger', title: 'เพิ่มไม่สำเร็จ', msg: err instanceof Error ? err.message : undefined });
    }
  };

  const handleRemoveItem = async (itemId: string) => {
    if (!selectedId) return;
    try {
      await rmItemMut.mutateAsync({ orderId: selectedId, itemId });
      toast({ kind: 'success', title: 'ลบรายการแล้ว' });
    } catch (err) {
      toast({ kind: 'danger', title: 'ลบไม่สำเร็จ', msg: err instanceof Error ? err.message : undefined });
    }
  };

  const handleStart = async () => {
    if (!selectedId) return;
    setConfirmStart(false);
    try {
      await startMut.mutateAsync(selectedId);
      toast({ kind: 'success', title: 'เริ่มผลิตแล้ว — ตัดสต็อกเรียบร้อย' });
    } catch (err) {
      toast({ kind: 'danger', title: 'เริ่มผลิตไม่สำเร็จ', msg: err instanceof Error ? err.message : undefined });
    }
  };

  const handleComplete = async () => {
    if (!selectedId) return;
    try {
      await completeMut.mutateAsync(selectedId);
      toast({ kind: 'success', title: 'ส่งมอบแล้ว — Pre-Order เสร็จสิ้น' });
    } catch (err) {
      toast({ kind: 'danger', title: 'เกิดข้อผิดพลาด', msg: err instanceof Error ? err.message : undefined });
    }
  };

  const handleCancel = async () => {
    if (!selectedId) return;
    try {
      await cancelMut.mutateAsync(selectedId);
      toast({ kind: 'warning', title: 'ยกเลิก Pre-Order แล้ว' });
    } catch (err) {
      toast({ kind: 'danger', title: 'ยกเลิกไม่สำเร็จ', msg: err instanceof Error ? err.message : undefined });
    }
  };

  const handleAddToShoppingList = async (inventoryItemId: string, name: string) => {
    try {
      await addToList.mutateAsync({ inventory_item_id: inventoryItemId });
      toast({ kind: 'success', title: `เพิ่ม ${name} เข้า Shopping List แล้ว` });
    } catch (err) {
      toast({ kind: 'danger', title: 'เพิ่มไม่สำเร็จ', msg: err instanceof Error ? err.message : undefined });
    }
  };

  // Helper: add item row to create form
  const addCreateItem = () => {
    if (!cItemProductId) return;
    const product = allProducts.find(p => p.id === cItemProductId);
    setCItems(prev => [...prev, {
      product_id: cItemProductId,
      quantity: cItemQty,
      unit_price: cItemPrice.trim() || undefined,
    }]);
    setCItemProductId(''); setCItemProductSearch(''); setCItemQty(1); setCItemPrice('');
    return product;
  };

  const removeCreateItem = (idx: number) => {
    setCItems(prev => prev.filter((_, i) => i !== idx));
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  const filterPills: { label: string; value: PreOrderStatus | undefined }[] = [
    { label: 'ทั้งหมด', value: undefined },
    { label: 'Pending', value: 'PENDING' },
    { label: 'In Progress', value: 'IN_PROGRESS' },
    { label: 'Completed', value: 'COMPLETED' },
    { label: 'Cancelled', value: 'CANCELLED' },
  ];

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* ── Left column: filter + list ── */}
      <div style={{ width: 380, flexShrink: 0, borderRight: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--color-bg)' }}>
        {/* Header */}
        <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid var(--color-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Pre-Orders</h2>
            <button
              onClick={() => setCreateOpen(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 12px', borderRadius: 8, border: 'none', background: 'var(--color-primary)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >
              <Icon name="plus" size={15} color="#fff" />
              สร้างใหม่
            </button>
          </div>
          {/* Status filter pills */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {filterPills.map(pill => (
              <button
                key={String(pill.value)}
                onClick={() => { setStatusFilter(pill.value); setSelectedId(null); }}
                style={{
                  padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 500,
                  cursor: 'pointer', border: '1px solid',
                  borderColor: statusFilter === pill.value ? 'var(--color-primary)' : 'var(--color-border)',
                  background: statusFilter === pill.value ? 'var(--color-accent-50)' : 'transparent',
                  color: statusFilter === pill.value ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                }}
              >
                {pill.label}
              </button>
            ))}
          </div>
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {listLoading ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: 13 }}>กำลังโหลด...</div>
          ) : listItems.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: 13 }}>ไม่มี Pre-Order</div>
          ) : (
            listItems.map(item => (
              <PreOrderListRow
                key={item.id}
                item={item}
                selected={item.id === selectedId}
                onClick={() => { setSelectedId(item.id); setDetailTab('details'); setAddItemOpen(false); }}
              />
            ))
          )}
        </div>
      </div>

      {/* ── Right column: detail panel ── */}
      <div style={{ flex: 1, overflow: 'auto', background: 'var(--color-bg)' }}>
        {!selectedId ? (
          <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: 'var(--color-text-secondary)' }}>
            <div style={{ textAlign: 'center' }}>
              <Icon name="calendar" size={40} color="var(--color-border-strong)" />
              <div style={{ marginTop: 12, fontSize: 14 }}>เลือก Pre-Order จากรายการ</div>
            </div>
          </div>
        ) : detailLoading ? (
          <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: 'var(--color-text-secondary)', fontSize: 13 }}>กำลังโหลด...</div>
        ) : detail ? (
          <DetailPanel
            detail={detail}
            tab={detailTab}
            onTabChange={t => setDetailTab(t)}
            threshold={threshold}
            onThresholdChange={setThreshold}
            ingredients={ingredients}
            addItemOpen={addItemOpen}
            onAddItemToggle={() => setAddItemOpen(v => !v)}
            addItemProductId={addItemProductId}
            addItemProductSearch={addItemProductSearch}
            onAddItemProductSearch={(s) => { setAddItemProductSearch(s); setAddItemProductId(''); }}
            onAddItemProductSelect={(id, name) => { setAddItemProductId(id); setAddItemProductSearch(name); }}
            addItemQty={addItemQty}
            onAddItemQtyChange={setAddItemQty}
            addItemPrice={addItemPrice}
            onAddItemPriceChange={setAddItemPrice}
            allProducts={allProducts}
            onAddItem={handleAddItem}
            onCancelAddItem={() => { setAddItemOpen(false); setAddItemProductId(''); setAddItemProductSearch(''); setAddItemQty(1); setAddItemPrice(''); }}
            onRemoveItem={handleRemoveItem}
            onEdit={() => openEdit(detail)}
            onStart={() => setConfirmStart(true)}
            onComplete={handleComplete}
            onCancel={handleCancel}
            onAddToShoppingList={handleAddToShoppingList}
            startPending={startMut.isPending}
            completePending={completeMut.isPending}
            cancelPending={cancelMut.isPending}
          />
        ) : null}
      </div>

      {/* ── Create modal ── */}
      {createOpen && (
        <CreateModal
          allProducts={allProducts}
          cName={cName} onNameChange={setCName}
          cPhone={cPhone} onPhoneChange={setCPhone}
          cOrderDate={cOrderDate} onOrderDateChange={setCOrderDate}
          cDueDate={cDueDate} onDueDateChange={setCDueDate}
          cDeposit={cDeposit} onDepositChange={setCDeposit}
          cDepositPaid={cDepositPaid} onDepositPaidChange={setCDepositPaid}
          cNotes={cNotes} onNotesChange={setCNotes}
          cItems={cItems}
          onAddItem={addCreateItem}
          onRemoveItem={removeCreateItem}
          cItemProductId={cItemProductId}
          cItemProductSearch={cItemProductSearch}
          onItemProductSearch={(s) => { setCItemProductSearch(s); setCItemProductId(''); }}
          onItemProductSelect={(id, name) => { setCItemProductId(id); setCItemProductSearch(name); }}
          cItemQty={cItemQty} onItemQtyChange={setCItemQty}
          cItemPrice={cItemPrice} onItemPriceChange={setCItemPrice}
          onConfirm={handleCreate}
          onClose={resetCreateForm}
          isPending={createMut.isPending}
        />
      )}

      {/* ── Edit modal ── */}
      {editOpen && (
        <EditModal
          eOrderDate={eOrderDate} onOrderDateChange={setEOrderDate}
          eDueDate={eDueDate} onDueDateChange={setEDueDate}
          eName={eName} onNameChange={setEName}
          ePhone={ePhone} onPhoneChange={setEPhone}
          eDeposit={eDeposit} onDepositChange={setEDeposit}
          eDepositPaid={eDepositPaid} onDepositPaidChange={setEDepositPaid}
          eNotes={eNotes} onNotesChange={setENotes}
          onConfirm={handleUpdate}
          onClose={() => setEditOpen(false)}
          isPending={updateMut.isPending}
        />
      )}

      {/* ── Confirm start dialog ── */}
      {confirmStart && (
        <ConfirmDialog
          title="เริ่มผลิต?"
          message="การเริ่มผลิตจะตัดสต็อกวัตถุดิบทันทีและไม่สามารถย้อนกลับได้ ต้องการดำเนินการต่อหรือไม่?"
          confirmLabel="ยืนยัน เริ่มผลิต"
          onConfirm={handleStart}
          onCancel={() => setConfirmStart(false)}
          dangerous
        />
      )}
    </div>
  );
}

// ── Sub-components (defined in same file) ────────────────────────────────────

function PreOrderListRow({ item, selected, onClick }: {
  item: PreOrderListItem; selected: boolean; onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: '12px 16px', cursor: 'pointer', borderBottom: '1px solid var(--color-border)',
        background: selected ? 'var(--color-accent-50)' : 'transparent',
        borderLeft: selected ? '3px solid var(--color-primary)' : '3px solid transparent',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.customerName ?? '—'}
          </div>
          {item.customerPhone && (
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 1 }}>{item.customerPhone}</div>
          )}
        </div>
        <StatusBadge status={item.status} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
          ส่ง: <strong style={{ color: 'var(--color-text)' }}>{fmtDate(item.dueDate)}</strong>
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
          {item.itemCount} รายการ
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```
pnpm typecheck
```
Expected: errors about missing sub-components (`DetailPanel`, `CreateModal`, `EditModal`, `ConfirmDialog`) — these are added in the following tasks.

- [ ] **Step 3: Commit (partial — skeleton only)**

```bash
git add app/src/components/screens/pre-orders.tsx
git commit -m "feat: pre-orders screen skeleton — list column + state wiring"
```

---

## Task 6: Pre-Orders Screen — Detail Panel (Details Tab + Ingredients Tab)

**Files:**
- Modify: `app/src/components/screens/pre-orders.tsx` (append sub-components)

- [ ] **Step 1: Append `DetailPanel` sub-component at end of file**

Append the following after the `PreOrderListRow` function in `pre-orders.tsx`:

```typescript
function DetailPanel({
  detail, tab, onTabChange, threshold, onThresholdChange, ingredients,
  addItemOpen, onAddItemToggle,
  addItemProductId, addItemProductSearch, onAddItemProductSearch, onAddItemProductSelect,
  addItemQty, onAddItemQtyChange, addItemPrice, onAddItemPriceChange,
  allProducts, onAddItem, onCancelAddItem, onRemoveItem,
  onEdit, onStart, onComplete, onCancel, onAddToShoppingList,
  startPending, completePending, cancelPending,
}: {
  detail: PreOrder;
  tab: 'details' | 'ingredients';
  onTabChange: (t: 'details' | 'ingredients') => void;
  threshold: number;
  onThresholdChange: (n: number) => void;
  ingredients: IngredientsResult | undefined;
  addItemOpen: boolean;
  onAddItemToggle: () => void;
  addItemProductId: string;
  addItemProductSearch: string;
  onAddItemProductSearch: (s: string) => void;
  onAddItemProductSelect: (id: string, name: string) => void;
  addItemQty: number;
  onAddItemQtyChange: (n: number) => void;
  addItemPrice: string;
  onAddItemPriceChange: (s: string) => void;
  allProducts: { id: string; name: string; price: number }[];
  onAddItem: () => void;
  onCancelAddItem: () => void;
  onRemoveItem: (itemId: string) => void;
  onEdit: () => void;
  onStart: () => void;
  onComplete: () => void;
  onCancel: () => void;
  onAddToShoppingList: (inventoryItemId: string, name: string) => void;
  startPending: boolean;
  completePending: boolean;
  cancelPending: boolean;
}) {
  const isPending = detail.status === 'PENDING';

  const totalStr = detail.items
    .reduce((sum, it) => sum + Number(it.lineTotal), 0)
    .toFixed(2);

  const filteredProducts = addItemProductSearch
    ? allProducts.filter(p => p.name.toLowerCase().includes(addItemProductSearch.toLowerCase()))
    : [];

  return (
    <div style={{ padding: 24, maxWidth: 720 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{detail.customerName ?? '—'}</div>
          {detail.customerPhone && (
            <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 2 }}>{detail.customerPhone}</div>
          )}
        </div>
        <StatusBadge status={detail.status} />
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--color-border)', marginBottom: 20 }}>
        {(['details', 'ingredients'] as const).map(t => (
          <button
            key={t}
            onClick={() => onTabChange(t)}
            style={{
              padding: '8px 16px', fontSize: 13, fontWeight: 500, cursor: 'pointer',
              border: 'none', background: 'transparent',
              borderBottom: tab === t ? '2px solid var(--color-primary)' : '2px solid transparent',
              color: tab === t ? 'var(--color-primary)' : 'var(--color-text-secondary)',
              marginBottom: -1,
            }}
          >
            {t === 'details' ? 'รายละเอียด' : 'วัตถุดิบ'}
          </button>
        ))}
      </div>

      {/* ── Details tab ── */}
      {tab === 'details' && (
        <>
          {/* Info grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px', marginBottom: 20, fontSize: 13 }}>
            <div>
              <div style={{ color: 'var(--color-text-secondary)', fontSize: 11, fontWeight: 500, marginBottom: 2 }}>วันที่สั่ง</div>
              <div>{fmtDate(detail.orderDate)}</div>
            </div>
            <div>
              <div style={{ color: 'var(--color-text-secondary)', fontSize: 11, fontWeight: 500, marginBottom: 2 }}>กำหนดส่ง</div>
              <div style={{ fontWeight: 600 }}>{fmtDate(detail.dueDate)}</div>
            </div>
            <div>
              <div style={{ color: 'var(--color-text-secondary)', fontSize: 11, fontWeight: 500, marginBottom: 2 }}>มัดจำ</div>
              <div>฿{fmtMoney(detail.depositAmount)} {detail.depositPaid ? <span style={{ color: 'var(--color-success)', fontSize: 11, fontWeight: 600 }}>✓ รับแล้ว</span> : <span style={{ color: 'var(--color-text-secondary)', fontSize: 11 }}>ยังไม่รับ</span>}</div>
            </div>
            {detail.notes && (
              <div style={{ gridColumn: '1/-1' }}>
                <div style={{ color: 'var(--color-text-secondary)', fontSize: 11, fontWeight: 500, marginBottom: 2 }}>หมายเหตุ</div>
                <div style={{ fontSize: 13 }}>{detail.notes}</div>
              </div>
            )}
          </div>

          {/* Items table */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>รายการสินค้า</div>
              {isPending && (
                <button
                  onClick={onAddItemToggle}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}
                >
                  <Icon name="plus" size={13} />
                  เพิ่มสินค้า
                </button>
              )}
            </div>

            <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, overflow: 'hidden' }}>
              {/* Table header */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px 90px 90px 32px', padding: '8px 12px', background: 'var(--color-surface-2)', fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', gap: 8 }}>
                <div>สินค้า</div><div style={{ textAlign: 'right' }}>จำนวน</div><div style={{ textAlign: 'right' }}>ราคา/ชิ้น</div><div style={{ textAlign: 'right' }}>รวม</div><div/>
              </div>
              {detail.items.map((it, idx) => (
                <div key={it.id} style={{ display: 'grid', gridTemplateColumns: '1fr 60px 90px 90px 32px', padding: '10px 12px', borderTop: '1px solid var(--color-border)', fontSize: 13, gap: 8, alignItems: 'center' }}>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.productName}</div>
                  <div style={{ textAlign: 'right' }}>{it.quantity}</div>
                  <div style={{ textAlign: 'right' }}>฿{Number(it.unitPrice).toFixed(2)}</div>
                  <div style={{ textAlign: 'right', fontWeight: 500 }}>฿{Number(it.lineTotal).toFixed(2)}</div>
                  <div style={{ display: 'grid', placeItems: 'center' }}>
                    {isPending && (
                      <button
                        onClick={() => onRemoveItem(it.id)}
                        style={{ width: 22, height: 22, borderRadius: 4, border: '1px solid var(--color-border)', background: 'transparent', display: 'grid', placeItems: 'center', cursor: 'pointer' }}
                      >
                        <Icon name="x" size={12} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {/* Add item row */}
              {isPending && addItemOpen && (
                <div style={{ padding: '10px 12px', borderTop: '1px solid var(--color-border)', background: 'var(--color-surface)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ position: 'relative', flex: 2, minWidth: 160 }}>
                    <input
                      placeholder="ค้นหาสินค้า..."
                      value={addItemProductSearch}
                      onChange={e => onAddItemProductSearch(e.target.value)}
                      style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid var(--color-border)', fontSize: 12, background: 'var(--color-bg)', boxSizing: 'border-box' }}
                    />
                    {filteredProducts.length > 0 && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, border: '1px solid var(--color-border)', borderRadius: 6, background: 'var(--color-surface)', zIndex: 20, maxHeight: 150, overflowY: 'auto', marginTop: 2, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
                        {filteredProducts.slice(0, 6).map(p => (
                          <div key={p.id} onClick={() => onAddItemProductSelect(p.id, p.name)} style={{ padding: '6px 10px', cursor: 'pointer', fontSize: 12, borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between' }}>
                            <span>{p.name}</span>
                            <span style={{ color: 'var(--color-text-secondary)' }}>฿{p.price.toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <input
                    type="number" min={1} placeholder="จำนวน"
                    value={addItemQty}
                    onChange={e => onAddItemQtyChange(Number(e.target.value))}
                    style={{ width: 60, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--color-border)', fontSize: 12 }}
                  />
                  <input
                    type="number" min={0} placeholder="ราคา (ว่าง=ตามสินค้า)"
                    value={addItemPrice}
                    onChange={e => onAddItemPriceChange(e.target.value)}
                    style={{ width: 130, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--color-border)', fontSize: 12 }}
                  />
                  <button
                    onClick={onAddItem}
                    disabled={!addItemProductId}
                    style={{ padding: '6px 12px', borderRadius: 6, border: 'none', background: 'var(--color-primary)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: addItemProductId ? 'pointer' : 'not-allowed', opacity: addItemProductId ? 1 : 0.5 }}
                  >
                    เพิ่ม
                  </button>
                  <button onClick={onCancelAddItem} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--color-border)', background: 'transparent', fontSize: 12, cursor: 'pointer' }}>ยกเลิก</button>
                </div>
              )}
              {/* Total row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px 90px 90px 32px', padding: '10px 12px', borderTop: '1px solid var(--color-border)', background: 'var(--color-surface-2)', gap: 8 }}>
                <div style={{ gridColumn: '1/4', fontSize: 13, fontWeight: 600, textAlign: 'right', color: 'var(--color-text-secondary)' }}>ยอดรวม</div>
                <div style={{ textAlign: 'right', fontWeight: 700, fontSize: 14 }}>฿{totalStr}</div>
                <div/>
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {detail.status === 'PENDING' && (
              <>
                <button
                  onClick={onEdit}
                  style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
                >
                  แก้ไข
                </button>
                <button
                  onClick={onStart}
                  disabled={startPending}
                  style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: 'var(--color-primary)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                >
                  {startPending ? 'กำลังเริ่ม...' : 'เริ่มผลิต'}
                </button>
                <button
                  onClick={onCancel}
                  disabled={cancelPending}
                  style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--color-danger)', color: 'var(--color-danger)', background: 'transparent', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
                >
                  ยกเลิก
                </button>
              </>
            )}
            {detail.status === 'IN_PROGRESS' && (
              <button
                onClick={onComplete}
                disabled={completePending}
                style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: 'var(--color-success)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
              >
                {completePending ? 'กำลังบันทึก...' : '✓ ส่งมอบแล้ว'}
              </button>
            )}
            {(detail.status === 'COMPLETED' || detail.status === 'CANCELLED') && (
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                {detail.status === 'COMPLETED' ? `ส่งมอบแล้ว${detail.completedAt ? ' — ' + fmtDate(detail.completedAt.split('T')[0]) : ''}` : 'ถูกยกเลิก'}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Ingredients tab ── */}
      {tab === 'ingredients' && (
        <IngredientsTab
          ingredients={ingredients}
          threshold={threshold}
          onThresholdChange={onThresholdChange}
          onAddToShoppingList={onAddToShoppingList}
        />
      )}
    </div>
  );
}

function IngredientsTab({ ingredients, threshold, onThresholdChange, onAddToShoppingList }: {
  ingredients: IngredientsResult | undefined;
  threshold: number;
  onThresholdChange: (n: number) => void;
  onAddToShoppingList: (inventoryItemId: string, name: string) => void;
}) {
  if (!ingredients) {
    return <div style={{ color: 'var(--color-text-secondary)', fontSize: 13 }}>กำลังโหลดข้อมูลวัตถุดิบ...</div>;
  }

  return (
    <div>
      {/* Threshold slider */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, padding: '10px 14px', background: 'var(--color-surface)', borderRadius: 8, border: '1px solid var(--color-border)' }}>
        <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
          Threshold: {threshold}%
        </label>
        <input
          type="range" min={0} max={100} value={threshold}
          onChange={e => onThresholdChange(Number(e.target.value))}
          style={{ flex: 1 }}
        />
      </div>

      {ingredients.items.length === 0 ? (
        <div style={{ color: 'var(--color-text-secondary)', fontSize: 13, textAlign: 'center', padding: 32 }}>
          ไม่มีวัตถุดิบ (สินค้าในออเดอร์อาจไม่มี recipe)
        </div>
      ) : (
        <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, overflow: 'hidden' }}>
          {/* Header */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 90px 70px 100px', padding: '8px 12px', background: 'var(--color-surface-2)', fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', gap: 8 }}>
            <div>วัตถุดิบ</div>
            <div style={{ textAlign: 'right' }}>ต้องการ</div>
            <div style={{ textAlign: 'right' }}>สต็อก</div>
            <div style={{ textAlign: 'right' }}>ใช้%</div>
            <div/>
          </div>
          {ingredients.items.map((line, idx) => (
            <div key={line.inventoryItemId} style={{
              display: 'grid', gridTemplateColumns: '1fr 90px 90px 70px 100px',
              padding: '10px 12px', borderTop: '1px solid var(--color-border)', gap: 8, alignItems: 'center',
              background: line.exceedsThreshold ? 'var(--color-danger-50, #FFF5F5)' : 'transparent',
            }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{line.name}</div>
                <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{line.unit}</div>
              </div>
              <div style={{ textAlign: 'right', fontSize: 13 }}>{Number(line.qtyNeeded).toFixed(3)}</div>
              <div style={{ textAlign: 'right', fontSize: 13 }}>{Number(line.stockOnHand).toFixed(3)}</div>
              <div style={{ textAlign: 'right', fontSize: 13 }}>
                {line.usagePct !== null ? (
                  <span style={{ color: line.exceedsThreshold ? 'var(--color-danger)' : 'inherit', fontWeight: line.exceedsThreshold ? 600 : 400 }}>
                    {line.usagePct.toFixed(1)}%
                  </span>
                ) : (
                  <span style={{ color: 'var(--color-danger)', fontWeight: 600 }}>—</span>
                )}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                {line.onShoppingList ? (
                  <span style={{ fontSize: 11, color: 'var(--color-text-secondary)', padding: '3px 8px', borderRadius: 999, background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                    มีแล้ว
                  </span>
                ) : (
                  <button
                    onClick={() => onAddToShoppingList(line.inventoryItemId, line.name)}
                    style={{ fontSize: 11, color: 'var(--color-primary)', padding: '3px 8px', borderRadius: 999, background: 'var(--color-accent-50)', border: '1px solid var(--color-primary)', cursor: 'pointer', fontWeight: 500 }}
                  >
                    + เพิ่ม
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

You also need to add the `IngredientsResult` import to the top of the file. The type is already exported from `use-pre-orders.ts` — add it to the existing import:

```typescript
import {
  usePreOrders, usePreOrder, usePreOrderIngredients,
  useCreatePreOrder, useUpdatePreOrder,
  useAddPreOrderItem, useRemovePreOrderItem,
  useStartPreOrder, useCompletePreOrder, useCancelPreOrder,
  type PreOrder, type PreOrderListItem, type PreOrderStatus,
  type CreatePreOrderPayload, type CreatePreOrderItemPayload,
  type IngredientsResult,
} from '@/hooks/use-pre-orders';
```

- [ ] **Step 2: Typecheck**

```
pnpm typecheck
```
Expected: errors only about missing `CreateModal`, `EditModal`, `ConfirmDialog` sub-components — added in the next task.

- [ ] **Step 3: Commit**

```bash
git add app/src/components/screens/pre-orders.tsx
git commit -m "feat: pre-orders detail panel — details tab, items table, ingredients tab"
```

---

## Task 7: Pre-Orders Screen — Create Modal, Edit Modal & Confirm Dialog

**Files:**
- Modify: `app/src/components/screens/pre-orders.tsx` (append remaining sub-components)

- [ ] **Step 1: Append `CreateModal`, `EditModal`, and `ConfirmDialog` to the file**

Append the following after `IngredientsTab` in `pre-orders.tsx`:

```typescript
function CreateModal({
  allProducts, cName, onNameChange, cPhone, onPhoneChange,
  cOrderDate, onOrderDateChange, cDueDate, onDueDateChange,
  cDeposit, onDepositChange, cDepositPaid, onDepositPaidChange,
  cNotes, onNotesChange, cItems, onAddItem, onRemoveItem,
  cItemProductId, cItemProductSearch, onItemProductSearch, onItemProductSelect,
  cItemQty, onItemQtyChange, cItemPrice, onItemPriceChange,
  onConfirm, onClose, isPending,
}: {
  allProducts: { id: string; name: string; price: number }[];
  cName: string; onNameChange: (s: string) => void;
  cPhone: string; onPhoneChange: (s: string) => void;
  cOrderDate: string; onOrderDateChange: (s: string) => void;
  cDueDate: string; onDueDateChange: (s: string) => void;
  cDeposit: string; onDepositChange: (s: string) => void;
  cDepositPaid: boolean; onDepositPaidChange: (b: boolean) => void;
  cNotes: string; onNotesChange: (s: string) => void;
  cItems: CreatePreOrderItemPayload[];
  onAddItem: () => void;
  onRemoveItem: (idx: number) => void;
  cItemProductId: string;
  cItemProductSearch: string;
  onItemProductSearch: (s: string) => void;
  onItemProductSelect: (id: string, name: string) => void;
  cItemQty: number; onItemQtyChange: (n: number) => void;
  cItemPrice: string; onItemPriceChange: (s: string) => void;
  onConfirm: () => void;
  onClose: () => void;
  isPending: boolean;
}) {
  const filteredProducts = cItemProductSearch
    ? allProducts.filter(p => p.name.toLowerCase().includes(cItemProductSearch.toLowerCase()))
    : [];

  const productNameById = (id: string) => allProducts.find(p => p.id === id)?.name ?? id;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: 'var(--color-bg)', borderRadius: 16, width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        {/* Modal header */}
        <div style={{ padding: '20px 24px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>สร้าง Pre-Order ใหม่</div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid var(--color-border)', background: 'transparent', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
            <Icon name="x" size={16} />
          </button>
        </div>

        <div style={{ padding: '0 24px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Section: Customer */}
          <section>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>ข้อมูลลูกค้า</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={labelStyle}>ชื่อลูกค้า *</label>
                <input value={cName} onChange={e => onNameChange(e.target.value)} maxLength={120} placeholder="Alice" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>เบอร์โทร *</label>
                <input value={cPhone} onChange={e => onPhoneChange(e.target.value)} maxLength={30} placeholder="0812345678" style={inputStyle} />
              </div>
            </div>
          </section>

          {/* Section: Order info */}
          <section>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>ข้อมูลออเดอร์</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={labelStyle}>วันที่สั่ง</label>
                <input type="date" value={cOrderDate} onChange={e => onOrderDateChange(e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>กำหนดส่ง *</label>
                <input type="date" value={cDueDate} onChange={e => onDueDateChange(e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>มัดจำ (บาท)</label>
                <input type="number" min={0} value={cDeposit} onChange={e => onDepositChange(e.target.value)} placeholder="0.00" style={inputStyle} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 18 }}>
                <input type="checkbox" id="depositPaid" checked={cDepositPaid} onChange={e => onDepositPaidChange(e.target.checked)} style={{ width: 15, height: 15 }} />
                <label htmlFor="depositPaid" style={{ fontSize: 13, cursor: 'pointer' }}>รับมัดจำแล้ว</label>
              </div>
            </div>
            <div style={{ marginTop: 10 }}>
              <label style={labelStyle}>หมายเหตุ</label>
              <textarea value={cNotes} onChange={e => onNotesChange(e.target.value)} rows={2} placeholder="เพิ่มเติม..." style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
            </div>
          </section>

          {/* Section: Items */}
          <section>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>รายการสินค้า</div>

            {/* Existing items */}
            {cItems.length > 0 && (
              <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, overflow: 'hidden', marginBottom: 10 }}>
                {cItems.map((ci, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: idx < cItems.length - 1 ? '1px solid var(--color-border)' : 'none', fontSize: 13 }}>
                    <div style={{ flex: 1 }}>{productNameById(ci.product_id)}</div>
                    <div style={{ color: 'var(--color-text-secondary)' }}>×{ci.quantity}</div>
                    {ci.unit_price && <div style={{ color: 'var(--color-text-secondary)' }}>฿{ci.unit_price}</div>}
                    <button onClick={() => onRemoveItem(idx)} style={{ width: 22, height: 22, borderRadius: 4, border: '1px solid var(--color-border)', background: 'transparent', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
                      <Icon name="x" size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add item row */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ flex: 2, minWidth: 160, position: 'relative' }}>
                <label style={labelStyle}>สินค้า</label>
                <input
                  placeholder="ค้นหาสินค้า..."
                  value={cItemProductSearch}
                  onChange={e => onItemProductSearch(e.target.value)}
                  style={inputStyle}
                />
                {filteredProducts.length > 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, border: '1px solid var(--color-border)', borderRadius: 6, background: 'var(--color-surface)', zIndex: 20, maxHeight: 150, overflowY: 'auto', marginTop: 2, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
                    {filteredProducts.slice(0, 6).map(p => (
                      <div key={p.id} onClick={() => onItemProductSelect(p.id, p.name)} style={{ padding: '7px 10px', cursor: 'pointer', fontSize: 12, borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between' }}>
                        <span>{p.name}</span>
                        <span style={{ color: 'var(--color-text-secondary)' }}>฿{p.price.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ width: 70 }}>
                <label style={labelStyle}>จำนวน</label>
                <input type="number" min={1} value={cItemQty} onChange={e => onItemQtyChange(Number(e.target.value))} style={inputStyle} />
              </div>
              <div style={{ width: 110 }}>
                <label style={labelStyle}>ราคา (ว่าง=ตาม catalog)</label>
                <input type="number" min={0} value={cItemPrice} onChange={e => onItemPriceChange(e.target.value)} placeholder="ปกติ" style={inputStyle} />
              </div>
              <button
                onClick={onAddItem}
                disabled={!cItemProductId}
                style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: 'var(--color-primary)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: cItemProductId ? 'pointer' : 'not-allowed', opacity: cItemProductId ? 1 : 0.5, marginBottom: 1 }}
              >
                + เพิ่ม
              </button>
            </div>
          </section>

          {/* Footer */}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 8, borderTop: '1px solid var(--color-border)' }}>
            <button onClick={onClose} style={{ padding: '9px 18px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface)', fontSize: 13, cursor: 'pointer' }}>
              ยกเลิก
            </button>
            <button
              onClick={onConfirm}
              disabled={isPending}
              style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: 'var(--color-primary)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: isPending ? 'not-allowed' : 'pointer', opacity: isPending ? 0.7 : 1 }}
            >
              {isPending ? 'กำลังสร้าง...' : 'สร้าง Pre-Order'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EditModal({
  eOrderDate, onOrderDateChange, eDueDate, onDueDateChange,
  eName, onNameChange, ePhone, onPhoneChange,
  eDeposit, onDepositChange, eDepositPaid, onDepositPaidChange,
  eNotes, onNotesChange, onConfirm, onClose, isPending,
}: {
  eOrderDate: string; onOrderDateChange: (s: string) => void;
  eDueDate: string; onDueDateChange: (s: string) => void;
  eName: string; onNameChange: (s: string) => void;
  ePhone: string; onPhoneChange: (s: string) => void;
  eDeposit: string; onDepositChange: (s: string) => void;
  eDepositPaid: boolean; onDepositPaidChange: (b: boolean) => void;
  eNotes: string; onNotesChange: (s: string) => void;
  onConfirm: () => void; onClose: () => void; isPending: boolean;
}) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: 'var(--color-bg)', borderRadius: 16, width: '100%', maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ padding: '20px 24px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>แก้ไข Pre-Order</div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid var(--color-border)', background: 'transparent', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
            <Icon name="x" size={16} />
          </button>
        </div>
        <div style={{ padding: '0 24px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelStyle}>ชื่อลูกค้า</label>
              <input value={eName} onChange={e => onNameChange(e.target.value)} maxLength={120} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>เบอร์โทร</label>
              <input value={ePhone} onChange={e => onPhoneChange(e.target.value)} maxLength={30} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>วันที่สั่ง</label>
              <input type="date" value={eOrderDate} onChange={e => onOrderDateChange(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>กำหนดส่ง</label>
              <input type="date" value={eDueDate} onChange={e => onDueDateChange(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>มัดจำ (บาท)</label>
              <input type="number" min={0} value={eDeposit} onChange={e => onDepositChange(e.target.value)} style={inputStyle} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 18 }}>
              <input type="checkbox" id="eDepositPaid" checked={eDepositPaid} onChange={e => onDepositPaidChange(e.target.checked)} style={{ width: 15, height: 15 }} />
              <label htmlFor="eDepositPaid" style={{ fontSize: 13, cursor: 'pointer' }}>รับมัดจำแล้ว</label>
            </div>
          </div>
          <div>
            <label style={labelStyle}>หมายเหตุ</label>
            <textarea value={eNotes} onChange={e => onNotesChange(e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 8, borderTop: '1px solid var(--color-border)' }}>
            <button onClick={onClose} style={{ padding: '9px 18px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface)', fontSize: 13, cursor: 'pointer' }}>ยกเลิก</button>
            <button onClick={onConfirm} disabled={isPending} style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: 'var(--color-primary)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: isPending ? 'not-allowed' : 'pointer', opacity: isPending ? 0.7 : 1 }}>
              {isPending ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConfirmDialog({ title, message, confirmLabel, onConfirm, onCancel, dangerous }: {
  title: string; message: string; confirmLabel: string;
  onConfirm: () => void; onCancel: () => void; dangerous?: boolean;
}) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 110, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: 'var(--color-bg)', borderRadius: 16, width: '100%', maxWidth: 400, padding: 28, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 10 }}>{title}</div>
        <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.6, marginBottom: 24 }}>{message}</div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{ padding: '9px 18px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface)', fontSize: 13, cursor: 'pointer' }}>ยกเลิก</button>
          <button
            onClick={onConfirm}
            style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: dangerous ? 'var(--color-danger)' : 'var(--color-primary)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Style constants ───────────────────────────────────────────────────────────
const labelStyle: React.CSSProperties = {
  fontSize: 12, fontWeight: 500, color: 'var(--color-text-secondary)',
  display: 'block', marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', borderRadius: 7,
  border: '1px solid var(--color-border)', fontSize: 13,
  background: 'var(--color-bg)', boxSizing: 'border-box',
};
```

- [ ] **Step 2: Typecheck**

```
pnpm typecheck
```
Expected: no new errors.

- [ ] **Step 3: Full smoke test**

```
pnpm dev
```

Verify all flows work:
1. Navigate to Pre-Orders → empty state shows
2. Click "สร้างใหม่" → Create modal opens
3. Fill in customer name + phone + due date + add 1 product → "สร้าง Pre-Order" → order appears in list and detail panel shows
4. With PENDING order selected → click "วัตถุดิบ" tab → ingredient table shows (or "ไม่มีวัตถุดิบ" if no recipe)
5. Back on details tab → click "เริ่มผลิต" → confirm dialog → confirm → status changes to IN_PROGRESS
6. Click "ส่งมอบแล้ว" → status changes to COMPLETED
7. Shopping List screen → empty state → add ingredient → appears in list → delete → disappears → print opens new tab

- [ ] **Step 4: Commit**

```bash
git add app/src/components/screens/pre-orders.tsx
git commit -m "feat: pre-orders screen complete — create/edit modal, detail panel, status actions, ingredient tab"
```

---

## Self-Review Checklist

| Spec requirement | Task |
|-----------------|------|
| POST /pre-orders (create) | Task 4 + 7 |
| GET /pre-orders (list with status filter, pagination) | Task 4 + 5 |
| GET /pre-orders/{id} (full detail) | Task 4 + 6 |
| PATCH /pre-orders/{id} (edit header, PENDING only) | Task 4 + 7 |
| POST /pre-orders/{id}/items (add item, PENDING only) | Task 4 + 6 |
| DELETE /pre-orders/{id}/items/{item_id} (remove item, PENDING only) | Task 4 + 6 |
| GET /pre-orders/{id}/ingredients (with threshold slider) | Task 4 + 6 |
| POST /pre-orders/{id}/start (irreversible, confirm dialog) | Task 4 + 6 |
| POST /pre-orders/{id}/complete | Task 4 + 6 |
| POST /pre-orders/{id}/cancel | Task 4 + 6 |
| GET /shopping-list | Task 2 + 3 |
| POST /shopping-list (idempotent add) | Task 2 + 3 |
| DELETE /shopping-list/{id} | Task 2 + 3 |
| GET /shopping-list/print (opens in new tab) | Task 3 |
| Status badge colours (PENDING=yellow, IN_PROGRESS=blue, COMPLETED=green, CANCELLED=grey) | Task 5 |
| Decimal strings — no parseFloat | Tasks 4, 5, 6 |
| `on_shopping_list` badge in ingredient tab | Task 6 |
| Editing blocked when not PENDING | Task 6 |
| `useAllProducts()` for product dropdown | Tasks 5, 7 |
| Navigation wired in sidebar | Task 1 |
| `useInventory()` for ingredient search in Shopping List | Task 3 |
| Invalidate `['pre-order-ingredients']` when shopping list changes | Task 2 |
| `useStartPreOrder` also invalidates `['inventory']` | Task 4 |
