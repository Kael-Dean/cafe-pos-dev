# Receipt Lot qty_packs Breaking-Change Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate lot creation from `qty_received + cost_per_unit` inputs to a single `qty_packs` input, with computed values shown as read-only confirmation.

**Architecture:** Two files change — `use-inventory.ts` (data layer: types, mapper, payload) and `inventory.tsx` (UI layer: form + lot display). No new files needed.

**Tech Stack:** TypeScript, React (inline styles), @tanstack/react-query, existing `api` client

---

## File Map

| File | What changes |
|---|---|
| `app/src/hooks/use-inventory.ts` | Add `qty_packs` to `StockLotRead` + `StockLot`; update `mapLot`; replace `AddLotPayload` |
| `app/src/components/screens/inventory.tsx` | Replace form fields in `ReceiptFlowModal`; update lot list columns; update `LotsModal` columns |

---

## Task 1: Update data types and mapper (`use-inventory.ts`)

**Files:**
- Modify: `app/src/hooks/use-inventory.ts:53-62` (StockLotRead)
- Modify: `app/src/hooks/use-inventory.ts:116-125` (StockLot)
- Modify: `app/src/hooks/use-inventory.ts:186-197` (mapLot)
- Modify: `app/src/hooks/use-inventory.ts:353-358` (AddLotPayload)

- [ ] **Step 1: Add `qty_packs` to `StockLotRead` (backend shape)**

In `use-inventory.ts`, update the `StockLotRead` interface (line 53):

```typescript
interface StockLotRead {
  id: string;
  inventory_item_id: string;
  inventory_item_name: string;
  qty_packs: string;        // ← ADD
  qty_received: string;
  qty_remaining: string;
  cost_per_unit: string;
  expiry_date: string | null;
  created_at: string;
}
```

- [ ] **Step 2: Add `qtyPacks` to `StockLot` (frontend shape)**

Update the exported `StockLot` interface (line 116):

```typescript
export interface StockLot {
  id: string;
  inventoryItemId: string;
  inventoryItemName: string;
  qtyPacks: number;         // ← ADD
  qtyReceived: number;
  qtyRemaining: number;
  costPerUnit: number;
  expiryDate: string | null;
  createdAt: string;
}
```

- [ ] **Step 3: Update `mapLot` to include `qtyPacks`**

Update `mapLot` function (line 186):

```typescript
function mapLot(l: StockLotRead): StockLot {
  return {
    id: l.id,
    inventoryItemId: l.inventory_item_id,
    inventoryItemName: l.inventory_item_name,
    qtyPacks: Number(l.qty_packs),       // ← ADD
    qtyReceived: Number(l.qty_received),
    qtyRemaining: Number(l.qty_remaining),
    costPerUnit: Number(l.cost_per_unit),
    expiryDate: l.expiry_date,
    createdAt: l.created_at,
  };
}
```

- [ ] **Step 4: Replace `AddLotPayload` to use `qty_packs`**

Update interface at line 353:

```typescript
interface AddLotPayload {
  inventory_item_id: string;
  qty_packs: string;        // replaces qty_received + cost_per_unit
  expiry_date?: string;
}
```

- [ ] **Step 5: Commit**

```
git add app/src/hooks/use-inventory.ts
git commit -m "feat(inventory): update StockLot types for qty_packs API"
```

---

## Task 2: Update `ReceiptFlowModal` form (`inventory.tsx`)

**Files:**
- Modify: `app/src/components/screens/inventory.tsx:588-611` (state + handlers)
- Modify: `app/src/components/screens/inventory.tsx:629-647` (handleAddLot)
- Modify: `app/src/components/screens/inventory.tsx:671-734` (form UI)

- [ ] **Step 1: Replace lot form state — remove `lotQty`/`lotCost`, add `lotPacks`**

In `ReceiptFlowModal` (around line 588), change:

```typescript
// Remove these two:
const [lotQty, setLotQty] = useState('');
const [lotCost, setLotCost] = useState('');

// Add:
const [lotPacks, setLotPacks] = useState('');
```

- [ ] **Step 2: Simplify `handleSelectLotItem` — drop auto-fill cost**

Change (line 605):

```typescript
const handleSelectLotItem = (id: string) => {
  setLotItemId(id);
  // cost auto-fills from ingredient now — no setLotCost needed
};
```

- [ ] **Step 3: Update `resetLotForm`**

Change (line 611):

```typescript
const resetLotForm = () => {
  setLotItemId('');
  setLotPacks('');
  setLotExpiry('');
  setLotError('');
};
```

- [ ] **Step 4: Update `handleAddLot` to send `qty_packs`**

Replace the handler body (line 629):

```typescript
const handleAddLot = async () => {
  if (!receiptId || !lotItemId || Number(lotPacks) <= 0) return;
  setLotError('');
  try {
    await addLot.mutateAsync({
      receiptId,
      lot: {
        inventory_item_id: lotItemId,
        qty_packs: lotPacks,
        expiry_date: lotExpiry || undefined,
      },
    });
    resetLotForm();
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'เพิ่มรายการไม่สำเร็จ';
    if (msg.includes('CONFIRMED'))           setLotError('ใบรับนี้ถูกยืนยันแล้ว ไม่สามารถแก้ไขได้');
    else if (msg.includes('ITEM_MISSING_UNIT_SIZE')) setLotError('วัตถุดิบนี้ยังไม่ได้ตั้งค่าขนาดแพ็ค กรุณาแก้ไขในหน้าวัตถุดิบก่อน');
    else                                     setLotError(msg);
  }
};
```

- [ ] **Step 5: Update `canAddLot` — drop cost check**

Change (line 671):

```typescript
const canAddLot = !!lotItemId && Number(lotPacks) > 0 && !isConfirmed;
```

- [ ] **Step 6: Replace add-lot form UI with single `qty_packs` field + computed preview**

Replace the 4-column form grid (lines 709–733) with:

```tsx
{/* Add-lot form */}
{!isConfirmed && (
  <div style={{ background: 'var(--color-surface-2)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}>เพิ่มรายการสินค้า</div>
    <div style={{ marginBottom: 10 }}>
      <select value={lotItemId} onChange={e => handleSelectLotItem(e.target.value)} style={{ ...smallInputStyle(), appearance: 'auto' }}>
        <option value="" disabled>เลือกวัตถุดิบ...</option>
        {items.map(it => <option key={it.id} value={it.id}>{it.name} · {it.unit}</option>)}
      </select>
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, alignItems: 'flex-end' }}>
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>จำนวนแพ็ค</div>
        <input type="number" min={0.001} step="any" value={lotPacks} onChange={e => setLotPacks(e.target.value)} placeholder="0" style={smallInputStyle()} />
      </div>
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>วันหมดอายุ</div>
        <input type="date" value={lotExpiry} onChange={e => setLotExpiry(e.target.value)} style={smallInputStyle()} />
      </div>
      <button onClick={handleAddLot} disabled={!canAddLot || addLot.isPending} style={{ ...primaryBtnStyle(), padding: '8px 14px', fontSize: 12, opacity: canAddLot ? 1 : 0.4, cursor: canAddLot ? 'pointer' : 'not-allowed', whiteSpace: 'nowrap' }}>
        {addLot.isPending ? '...' : '+ เพิ่ม'}
      </button>
    </div>
    {/* Computed confirmation preview */}
    {selectedLotItem && Number(lotPacks) > 0 && selectedLotItem.unitSize && (
      <div style={{ marginTop: 10, padding: '8px 12px', background: 'var(--color-accent-50)', borderRadius: 8, fontSize: 12, color: 'var(--color-primary)', fontWeight: 600 }}>
        {Number(lotPacks).toLocaleString()} แพ็ค × {Number(selectedLotItem.unitSize).toLocaleString()} {selectedLotItem.unit}{' '}
        = <strong>{(Number(lotPacks) * Number(selectedLotItem.unitSize)).toLocaleString()} {selectedLotItem.unit}</strong>
        {selectedLotItem.costPerUnit > 0 && (
          <span style={{ fontWeight: 400, color: 'var(--color-text-secondary)', marginLeft: 8 }}>
            ที่ ฿{selectedLotItem.costPerUnit.toFixed(2)}/{selectedLotItem.unit}
          </span>
        )}
      </div>
    )}
    {selectedLotItem && !selectedLotItem.unitSize && lotItemId && (
      <div style={{ marginTop: 8, fontSize: 12, color: 'var(--color-warning)', fontWeight: 600 }}>
        ⚠ วัตถุดิบนี้ยังไม่ได้ตั้งค่าขนาดแพ็ค — ไม่สามารถรับเข้าได้จนกว่าจะแก้ไข
      </div>
    )}
    {lotError && <div style={{ fontSize: 12, color: 'var(--color-danger)', marginTop: 8, fontWeight: 600 }}>{lotError}</div>}
  </div>
)}
```

- [ ] **Step 7: Commit**

```
git add app/src/components/screens/inventory.tsx
git commit -m "feat(inventory): replace qty_received/cost_per_unit form with qty_packs input"
```

---

## Task 3: Update lot list display in `ReceiptFlowModal` and `LotsModal`

**Files:**
- Modify: `app/src/components/screens/inventory.tsx:742-771` (receipt lot rows)
- Modify: `app/src/components/screens/inventory.tsx:812-844` (LotsModal rows)

- [ ] **Step 1: Update lot list header columns in `ReceiptFlowModal`**

Change the header row (line 742) from 5 columns to:
`วัตถุดิบ | แพ็ค | รับเข้า | หมดอายุ | (delete)`

```tsx
<div style={{ display: 'grid', gridTemplateColumns: '1.5fr 80px 90px 100px 36px', gap: 10, padding: '8px 14px', fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', background: 'var(--color-surface-2)', borderBottom: '1px solid var(--color-border)' }}>
  <div>วัตถุดิบ</div><div style={{ textAlign: 'right' }}>แพ็ค</div><div style={{ textAlign: 'right' }}>รับเข้า</div><div>หมดอายุ</div><div></div>
</div>
```

- [ ] **Step 2: Update lot row cells in `ReceiptFlowModal`**

Change the lot row (line 750) to match new columns:

```tsx
<div key={lot.id} style={{ display: 'grid', gridTemplateColumns: '1.5fr 80px 90px 100px 36px', gap: 10, padding: '10px 14px', alignItems: 'center', borderBottom: idx === receipt.lots.length - 1 ? 'none' : '1px solid var(--color-border)' }}>
  <div style={{ fontSize: 13, fontWeight: 600 }}>{lot.inventoryItemName}</div>
  <div className="num" style={{ fontSize: 13, textAlign: 'right', color: 'var(--color-text-secondary)' }}>{lot.qtyPacks.toLocaleString()}</div>
  <div className="num" style={{ fontSize: 13, textAlign: 'right' }}>{lot.qtyReceived.toLocaleString()}</div>
  <div style={{ fontSize: 12 }}>
    {lot.expiryDate ? (
      <div>
        <div style={{ color: badge ? badge.color : 'var(--color-text-secondary)', fontWeight: 600 }}>{formatDate(lot.expiryDate)}</div>
        {badge && <div style={{ fontSize: 10, marginTop: 2 }}>⚠ {badge.label}</div>}
      </div>
    ) : <span style={{ color: 'var(--color-text-muted)' }}>—</span>}
  </div>
  <div>
    {!isConfirmed && (
      <button onClick={() => handleDeleteLot(lot.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--color-text-muted)', display: 'grid', placeItems: 'center', borderRadius: 4 }} title="ลบรายการ">
        <Icon name="x" size={14} />
      </button>
    )}
  </div>
</div>
```

Note: declare `const badge = expiryBadge(lot.expiryDate);` before the row JSX (it's already there in the original).

- [ ] **Step 3: Update `LotsModal` header to show แพ็ค instead of รับเข้า**

Change the header row (line 813):
`# | วันที่รับ | คงเหลือ | แพ็ค | ต้นทุน/หน่วย | หมดอายุ`

```tsx
<div style={{ display: 'grid', gridTemplateColumns: '28px 110px 90px 90px 90px 110px', gap: 10, padding: '8px 14px', fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', background: 'var(--color-surface-2)', borderBottom: '1px solid var(--color-border)' }}>
  <div>#</div><div>วันที่รับ</div><div style={{ textAlign: 'right' }}>คงเหลือ</div><div style={{ textAlign: 'right' }}>แพ็ค</div><div style={{ textAlign: 'right' }}>ต้นทุน/หน่วย</div><div>หมดอายุ</div>
</div>
```

- [ ] **Step 4: Update `LotsModal` row to use `qtyPacks` and `qtyRemaining`**

Change the row (line 824) — the 4th column shows `qtyPacks` instead of `qtyReceived`:

```tsx
<div key={lot.id} style={{ display: 'grid', gridTemplateColumns: '28px 110px 90px 90px 90px 110px', gap: 10, padding: '10px 14px', alignItems: 'center', borderBottom: idx === lots.length - 1 ? 'none' : '1px solid var(--color-border)', background: isFirst ? 'var(--color-accent-50)' : undefined }}>
  <div className="num" style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 700 }}>{idx + 1}</div>
  <div>
    <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{formatDate(lot.createdAt)}</div>
    {isFirst && <div style={{ fontSize: 10, color: 'var(--color-primary)', fontWeight: 700, marginTop: 2 }}>● กำลังใช้</div>}
  </div>
  <div className="num" style={{ fontSize: 13, fontWeight: 700, textAlign: 'right' }}>{lot.qtyRemaining.toLocaleString()} {item.unit}</div>
  <div className="num" style={{ fontSize: 12, color: 'var(--color-text-secondary)', textAlign: 'right' }}>{lot.qtyPacks.toLocaleString()} แพ็ค</div>
  <div className="num" style={{ fontSize: 12, color: 'var(--color-text-secondary)', textAlign: 'right' }}>฿{lot.costPerUnit.toFixed(2)}</div>
  <div style={{ fontSize: 12 }}>
    {lot.expiryDate ? (
      <div>
        <div style={{ color: badge ? badge.color : 'var(--color-text-secondary)', fontWeight: badge ? 600 : 400 }}>{formatDate(lot.expiryDate)}</div>
        {badge && <div style={{ fontSize: 10, marginTop: 2, color: badge.color, fontWeight: 600 }}>⚠ {badge.label}</div>}
      </div>
    ) : <span style={{ color: 'var(--color-text-muted)' }}>—</span>}
  </div>
</div>
```

- [ ] **Step 5: Commit**

```
git add app/src/components/screens/inventory.tsx
git commit -m "feat(inventory): update lot display to show qty_packs"
```

---

## Self-Review Checklist

- [x] `StockLotRead.qty_packs` added — matches handoff response shape
- [x] `AddLotPayload` sends only `qty_packs` (no `qty_received`, no `cost_per_unit`) — matches handoff request shape
- [x] Form: single "จำนวนแพ็ค" field, computed preview shown before submit
- [x] Error `ITEM_MISSING_UNIT_SIZE` handled with user-friendly Thai message
- [x] Lot list in receipt modal: shows pack count + unit qty
- [x] `LotsModal`: primary display uses `qtyRemaining` for tracking, `qtyPacks` for pack count
- [x] `canAddLot` no longer requires `lotCost`
- [x] `handleSelectLotItem` no longer auto-fills cost
