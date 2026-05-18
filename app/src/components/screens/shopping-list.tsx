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
  const [removingId, setRemovingId] = useState<string | null>(null);

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
    setRemovingId(item.id);
    try {
      await removeMut.mutateAsync(item.id);
      toast({ kind: 'success', title: `ลบ ${item.inventoryItemName} แล้ว` });
    } catch (err) {
      toast({ kind: 'danger', title: 'ลบไม่สำเร็จ', msg: err instanceof Error ? err.message : undefined });
    } finally {
      setRemovingId(null);
    }
  };

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
            <div
              style={{ flex: 2, minWidth: 200, position: 'relative' }}
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setTimeout(() => { if (!addItemId) setInvSearch(''); }, 150);
                }
              }}
            >
              <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>วัตถุดิบ</label>
              <input
                placeholder="พิมพ์เพื่อค้นหา..."
                value={invSearch}
                onChange={e => { setInvSearch(e.target.value); setAddItemId(''); }}
                style={{ width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid var(--color-border)', fontSize: 13, background: 'var(--color-bg)', boxSizing: 'border-box' }}
              />
              {invSearch.length > 0 && invItems.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, border: '1px solid var(--color-border)', borderRadius: 7, background: 'var(--color-surface)', zIndex: 20, maxHeight: 180, overflowY: 'auto', marginTop: 2, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
                  {invItems.slice(0, 8).map(it => (
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
                style={{ padding: '8px 16px', borderRadius: 7, border: 'none', background: 'var(--color-primary)', color: '#fff', fontWeight: 600, fontSize: 13, cursor: (!addItemId || addMut.isPending) ? 'not-allowed' : 'pointer', opacity: (!addItemId || addMut.isPending) ? 0.5 : 1 }}
              >
                {addMut.isPending ? 'กำลังเพิ่ม...' : 'เพิ่ม'}
              </button>
              <button
                onClick={resetAddForm}
                disabled={addMut.isPending}
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
                disabled={removingId === item.id}
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
