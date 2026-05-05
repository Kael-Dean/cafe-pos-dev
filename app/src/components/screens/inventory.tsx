'use client';

import { useState, useMemo } from 'react';
import Icon from '../icons';
import { useToast, Tag, baht } from '../app-common';
import {
  useInventory, useInventoryMovements, useReceiveStock, useWasteStock,
  useCreateInventoryItem, useDeleteInventoryItem, useSupplierHistory,
  type InventoryItem, type Movement, type WastageReason, type SupplierHistoryItem,
} from '@/hooks/use-inventory';

const WASTAGE_REASONS = [
  { id: 'EXPIRED', label: 'หมดอายุ' },
  { id: 'SPILLED', label: 'หก' },
  { id: 'TRIAL',   label: 'ทดลอง' },
  { id: 'DAMAGED', label: 'เสีย' },
  { id: 'OTHER',   label: 'อื่นๆ' },
] as const;

const stockStatusOf = (it: InventoryItem) => {
  if (it.stock < it.parLevel * 0.5) return { tone: 'danger' as const,  label: 'Critical' };
  if (it.stock < it.parLevel)        return { tone: 'warning' as const, label: 'Low' };
  return { tone: 'success' as const, label: 'OK' };
};

// Returns days until expiry (negative = already expired)
const daysUntilExpiry = (dateStr?: string): number | null => {
  if (!dateStr) return null;
  const exp = new Date(dateStr).setHours(23, 59, 59, 999);
  return Math.ceil((exp - Date.now()) / 86400000);
};

const expiryBadge = (dateStr?: string) => {
  const days = daysUntilExpiry(dateStr);
  if (days === null) return null;
  if (days < 0)   return { label: 'หมดอายุแล้ว',        color: 'var(--color-danger)',  bg: 'var(--color-danger-50)' };
  if (days <= 3)  return { label: `หมดใน ${days} วัน`,  color: 'var(--color-danger)',  bg: 'var(--color-danger-50)' };
  if (days <= 7)  return { label: `หมดใน ${days} วัน`,  color: '#9C6A1F',              bg: 'var(--color-warning-50)' };
  if (days <= 30) return { label: `หมดใน ${days} วัน`,  color: 'var(--color-text-secondary)', bg: 'var(--color-surface-2)' };
  return null;
};

const formatDate = (dateStr?: string) => {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
};

const formatRelative = (ts: number) => {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'เมื่อสักครู่';
  if (min < 60) return `${min} นาทีที่แล้ว`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} ชม. ที่แล้ว`;
  return `${Math.floor(hr / 24)} วันที่แล้ว`;
};

export default function Inventory() {
  const toast = useToast();
  const [tab, setTab] = useState('items');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [wastageOpen, setWastageOpen] = useState(false);
  const [addIngredientOpen, setAddIngredientOpen] = useState(false);
  const [presetItemId, setPresetItemId] = useState<string | null>(null);
  const [deleteConfirmItem, setDeleteConfirmItem] = useState<InventoryItem | null>(null);
  const [supplierHistoryItem, setSupplierHistoryItem] = useState<InventoryItem | null>(null);

  const { data: inventoryItems, isLoading: invLoading } = useInventory();
  const { data: movementsData } = useInventoryMovements();
  const receiveStock = useReceiveStock();
  const wasteStock = useWasteStock();
  const createItem = useCreateInventoryItem();
  const deleteItem = useDeleteInventoryItem();

  const items = useMemo(() =>
    (inventoryItems ?? []).map(it => ({ ...it, status: stockStatusOf(it) })),
    [inventoryItems]
  );

  const counts = useMemo(() => ({
    total: items.length,
    low: items.filter(i => i.status.tone === 'warning').length,
    critical: items.filter(i => i.status.tone === 'danger').length,
    expiring: items.filter(i => { const d = daysUntilExpiry(i.expiryDate); return d !== null && d <= 7; }).length,
  }), [items]);

  const filteredItems = useMemo(() => items.filter(it => {
    if (search && !it.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter === 'critical' && it.status.tone !== 'danger') return false;
    if (statusFilter === 'low' && it.status.tone !== 'warning') return false;
    if (statusFilter === 'ok' && it.status.tone !== 'success') return false;
    if (statusFilter === 'expiring') {
      const d = daysUntilExpiry(it.expiryDate);
      if (d === null || d > 7) return false;
    }
    return true;
  }), [items, search, statusFilter]);

  const movements = movementsData ?? [];
  const recentReceives = useMemo(() => movements.filter(m => m.type === 'RECEIVE').sort((a, b) => b.at - a.at), [movements]);
  const recentWastage  = useMemo(() => movements.filter(m => m.type === 'WASTE').sort((a, b) => b.at - a.at), [movements]);
  const saleMovements  = useMemo(() => movements.filter(m => m.type === 'SALE'), [movements]);

  const wastageThisMonth = useMemo(() => {
    const cutoff = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
    return recentWastage.filter(m => m.at >= cutoff).reduce((s, m) => {
      const inv = inventoryItems?.find(i => i.id === m.invId);
      return s + (inv ? inv.costPerUnit * m.qty : 0);
    }, 0);
  }, [recentWastage, inventoryItems]);

  // Usage stats — aggregate SALE movements by item
  const usageStats = useMemo(() => {
    const now = Date.now();
    const weekMs = 7 * 86400000;
    const weekStart  = now - weekMs;
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
    const byItem: Record<string, { name: string; unit: string; weekQty: number; monthQty: number }> = {};
    saleMovements.forEach(m => {
      const inv = inventoryItems?.find(i => i.id === m.invId);
      if (!inv) return;
      if (!byItem[m.invId]) byItem[m.invId] = { name: inv.name, unit: inv.unit, weekQty: 0, monthQty: 0 };
      if (m.at >= weekStart)  byItem[m.invId].weekQty  += m.qty;
      if (m.at >= monthStart) byItem[m.invId].monthQty += m.qty;
    });
    return Object.values(byItem).sort((a, b) => b.monthQty - a.monthQty);
  }, [saleMovements, inventoryItems]);

  const submitReceive = async ({ invId, qty, costPerUnit, supplier, note }: { invId: string; qty: number; costPerUnit: number; supplier: string; note: string }) => {
    try {
      await receiveStock.mutateAsync({ item_id: invId, qty, cost_per_unit: costPerUnit, supplier: supplier || undefined, note: note || undefined });
      setReceiveOpen(false); setPresetItemId(null);
      const inv = inventoryItems?.find(i => i.id === invId);
      toast({ kind: 'success', title: 'รับเข้าสต็อกแล้ว', msg: `${inv?.name} +${qty.toLocaleString()} ${inv?.unit}` });
    } catch (err) {
      toast({ kind: 'warning', title: 'เกิดข้อผิดพลาด', msg: err instanceof Error ? err.message : 'กรุณาลองใหม่' });
    }
  };

  const submitWastage = async ({ invId, qty, reason, note }: { invId: string; qty: number; reason: string; note: string }) => {
    try {
      await wasteStock.mutateAsync({ item_id: invId, qty, reason: reason as WastageReason, note: note || undefined });
      setWastageOpen(false); setPresetItemId(null);
      const inv = inventoryItems?.find(i => i.id === invId);
      const reasonLabel = WASTAGE_REASONS.find(r => r.id === reason)?.label || reason;
      toast({ kind: 'warning', title: 'บันทึก Wastage แล้ว', msg: `${inv?.name} -${qty.toLocaleString()} ${inv?.unit} • ${reasonLabel}` });
    } catch (err) {
      toast({ kind: 'warning', title: 'เกิดข้อผิดพลาด', msg: err instanceof Error ? err.message : 'กรุณาลองใหม่' });
    }
  };

  const submitAddIngredient = async ({ name, unit, parLevel, costPerUnit, expiryDate, unitSize, piecePrice }: { name: string; unit: string; parLevel: number; costPerUnit: number; expiryDate: string; unitSize: string; piecePrice: string }) => {
    try {
      await createItem.mutateAsync({
        name, unit, par_level: parLevel, cost_per_unit: costPerUnit,
        expiry_date: expiryDate || undefined,
        unit_size: unitSize || undefined,
        piece_price: piecePrice || undefined,
      });
      setAddIngredientOpen(false);
      toast({ kind: 'success', title: 'เพิ่มวัตถุดิบแล้ว', msg: `${name} (${unit}) ถูกเพิ่มในคลังแล้ว` });
    } catch (err) {
      toast({ kind: 'warning', title: 'เกิดข้อผิดพลาด', msg: err instanceof Error ? err.message : 'กรุณาลองใหม่' });
    }
  };

  const handleDelete = async (item: InventoryItem) => {
    try {
      await deleteItem.mutateAsync(item.id);
      setDeleteConfirmItem(null);
      toast({ kind: 'success', title: 'ลบแล้ว', msg: `${item.name} ถูกลบออกจากคลัง` });
    } catch (err) {
      toast({ kind: 'warning', title: 'ลบไม่สำเร็จ', msg: err instanceof Error ? err.message : 'กรุณาลองใหม่' });
    }
  };

  const openReceive = (itemId?: string) => { setPresetItemId(itemId || null); setReceiveOpen(true); };
  const openWastage = (itemId?: string) => { setPresetItemId(itemId || null); setWastageOpen(true); };

  const TABS = [
    { id: 'items',   label: 'วัตถุดิบ' },
    { id: 'usage',   label: 'การใช้งาน' },
    { id: 'receive', label: 'รับเข้าสต็อก' },
    { id: 'waste',   label: 'บันทึก Wastage' },
  ];

  return (
    <div className="scroll" style={{ height: '100%', overflow: 'auto', padding: 24, background: 'var(--color-bg)' }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 4 }}>P1 — Inventory</div>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: '-0.01em' }}>Inventory</h1>
        <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>วัตถุดิบ · รับเข้า · บันทึก Wastage · การใช้งาน</div>
      </div>

      {invLoading ? (
        <div style={{ padding: 60, textAlign: 'center', color: 'var(--color-text-muted)' }}>กำลังโหลดข้อมูลคลัง...</div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
            <KPISmall label="วัตถุดิบทั้งหมด"          value={`${counts.total} รายการ`} />
            <KPISmall label="ใกล้หมด (Low)"            value={`${counts.low} รายการ`} />
            <KPISmall label="ต่ำกว่าครึ่ง par (Critical)" value={`${counts.critical} รายการ`} />
            <KPISmall label="ใกล้หมดอายุ (≤ 7 วัน)"   value={`${counts.expiring} รายการ`} highlight={counts.expiring > 0 ? 'warning' : undefined} />
          </div>

          <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--color-surface-2)', borderRadius: 10, marginBottom: 16, width: 'fit-content' }}>
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                padding: '8px 16px', fontSize: 13, fontWeight: 600, border: 'none', borderRadius: 8, cursor: 'pointer',
                background: tab === t.id ? 'var(--color-surface)' : 'transparent',
                color: tab === t.id ? 'var(--color-text)' : 'var(--color-text-secondary)',
                boxShadow: tab === t.id ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                fontFamily: 'inherit', transition: 'all 150ms var(--ease-out)',
              }}>{t.label}</button>
            ))}
          </div>

          {tab === 'items'   && <ItemsTab items={filteredItems} totalCount={items.length} search={search} setSearch={setSearch} statusFilter={statusFilter} setStatusFilter={setStatusFilter} onReceive={openReceive} onWaste={openWastage} onAddIngredient={() => setAddIngredientOpen(true)} onDelete={setDeleteConfirmItem} onSupplierHistory={setSupplierHistoryItem} />}
          {tab === 'usage'   && <UsageTab stats={usageStats} movements={saleMovements} />}
          {tab === 'receive' && <ReceiveTab items={inventoryItems ?? []} movements={recentReceives} onAdd={() => openReceive()} />}
          {tab === 'waste'   && <WastageTab items={inventoryItems ?? []} movements={recentWastage} totalCost={wastageThisMonth} onAdd={() => openWastage()} />}
        </>
      )}

      {receiveOpen && <ReceiveStockModal items={inventoryItems ?? []} presetItemId={presetItemId} onClose={() => { setReceiveOpen(false); setPresetItemId(null); }} onSubmit={submitReceive} />}
      {wastageOpen && <WastageModal items={inventoryItems ?? []} presetItemId={presetItemId} onClose={() => { setWastageOpen(false); setPresetItemId(null); }} onSubmit={submitWastage} />}
      {addIngredientOpen && <AddIngredientModal onClose={() => setAddIngredientOpen(false)} onSubmit={submitAddIngredient} />}
      {deleteConfirmItem && (
        <DeleteInventoryConfirmModal
          item={deleteConfirmItem}
          deleting={deleteItem.isPending}
          onConfirm={() => handleDelete(deleteConfirmItem)}
          onClose={() => setDeleteConfirmItem(null)}
        />
      )}
      {supplierHistoryItem && (
        <SupplierHistoryModal
          item={supplierHistoryItem}
          onClose={() => setSupplierHistoryItem(null)}
        />
      )}
    </div>
  );
}

const KPISmall = ({ label, value, highlight }: { label: string; value: string; highlight?: 'warning' | 'danger' }) => {
  const tones = {
    warning: { bg: 'var(--color-warning-50)', border: 'var(--color-warning)', fg: '#9C6A1F' },
    danger:  { bg: 'var(--color-danger-50)',  border: 'var(--color-danger)',  fg: 'var(--color-danger)' },
  };
  const t = highlight ? tones[highlight] : null;
  return (
    <div style={{ background: t ? t.bg : 'var(--color-surface)', border: t ? `1px solid ${t.border}` : '1px solid var(--color-border)', borderRadius: 12, padding: 16 }}>
      <div style={{ fontSize: 13, color: t ? t.fg : 'var(--color-text-secondary)', fontWeight: 500, marginBottom: 8 }}>{label}</div>
      <div className="num" style={{ fontSize: 24, fontWeight: 700, color: t ? t.fg : 'var(--color-text)' }}>{value}</div>
    </div>
  );
};

const miniBtnStyle = (variant: 'primary' | 'ghost' | 'danger'): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '6px 10px', fontSize: 11, fontWeight: 600,
  border: variant === 'danger' ? '1px solid var(--color-danger)' : variant === 'ghost' ? '1px solid var(--color-border)' : 'none',
  borderRadius: 6, cursor: 'pointer',
  background: variant === 'primary' ? 'var(--color-primary)' : 'transparent',
  color: variant === 'danger' ? 'var(--color-danger)' : variant === 'ghost' ? 'var(--color-text-secondary)' : '#fff',
  fontFamily: 'inherit', transition: 'all 150ms var(--ease-out)',
});

const primaryBtnStyle = (): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '10px 16px', fontSize: 13, fontWeight: 600,
  background: 'var(--color-primary)', color: '#fff',
  border: 'none', borderRadius: 8, cursor: 'pointer',
  fontFamily: 'inherit', transition: 'background 150ms var(--ease-out)',
});

// ── Items Tab ─────────────────────────────────────────────────────────────────
const ItemsTab = ({ items, totalCount, search, setSearch, statusFilter, setStatusFilter, onReceive, onWaste, onAddIngredient, onDelete, onSupplierHistory }: {
  items: (InventoryItem & { status: ReturnType<typeof stockStatusOf> })[];
  totalCount: number; search: string; setSearch: (v: string) => void;
  statusFilter: string; setStatusFilter: (v: string) => void;
  onReceive: (id: string) => void; onWaste: (id: string) => void;
  onAddIngredient: () => void; onDelete: (item: InventoryItem) => void;
  onSupplierHistory: (item: InventoryItem) => void;
}) => (
  <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, overflow: 'hidden' }}>
    <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--color-border)', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ position: 'relative', flex: 1, minWidth: 240 }}>
        <div style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', display: 'grid', placeItems: 'center' }}>
          <Icon name="search" size={16} color="var(--color-text-muted)" />
        </div>
        <input type="text" placeholder="ค้นหาวัตถุดิบ..." value={search} onChange={e => setSearch(e.target.value)}
          style={{ width: '100%', padding: '10px 12px 10px 36px', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
        />
      </div>
      <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--color-surface-2)', borderRadius: 8 }}>
        {[{ id: 'all', label: 'ทั้งหมด' }, { id: 'critical', label: 'Critical' }, { id: 'low', label: 'Low' }, { id: 'ok', label: 'OK' }, { id: 'expiring', label: '⚠ หมดอายุ' }].map(s => (
          <button key={s.id} onClick={() => setStatusFilter(s.id)} style={{
            padding: '6px 12px', fontSize: 12, fontWeight: 600, border: 'none', borderRadius: 6, cursor: 'pointer',
            background: statusFilter === s.id ? 'var(--color-surface)' : 'transparent',
            color: statusFilter === s.id ? 'var(--color-text)' : 'var(--color-text-secondary)',
            fontFamily: 'inherit',
          }}>{s.label}</button>
        ))}
      </div>
      <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{items.length}/{totalCount} รายการ</div>
      <button onClick={onAddIngredient} style={primaryBtnStyle()} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-primary-700)'} onMouseLeave={e => e.currentTarget.style.background = 'var(--color-primary)'}><Icon name="plus" size={14} /> เพิ่มวัตถุดิบ</button>
    </div>

    <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 60px 100px 100px 80px 100px 120px 130px 200px', gap: 12, padding: '10px 20px', fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', background: 'var(--color-surface-2)', borderBottom: '1px solid var(--color-border)' }}>
      <div>วัตถุดิบ</div><div>หน่วย</div><div style={{ textAlign: 'right' }}>คงเหลือ</div><div style={{ textAlign: 'right' }}>Par level</div><div>สถานะ</div><div style={{ textAlign: 'right' }}>ต้นทุน/หน่วย</div><div style={{ textAlign: 'right' }}>ราคา/ชิ้น</div><div>วันหมดอายุ</div><div></div>
    </div>

    {items.length === 0 ? (
      <div style={{ padding: 48, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>ไม่พบวัตถุดิบที่ตรงเงื่อนไข</div>
    ) : items.map((it, idx) => {
      const ratio = it.parLevel > 0 ? Math.min(100, (it.stock / it.parLevel) * 100) : 100;
      const badge = expiryBadge(it.expiryDate);
      return (
        <div key={it.id} style={{ display: 'grid', gridTemplateColumns: '1.5fr 60px 100px 100px 80px 100px 120px 130px 200px', gap: 12, padding: '12px 20px', alignItems: 'center', borderBottom: idx === items.length - 1 ? 'none' : '1px solid var(--color-border)' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{it.name}</div>
            <div style={{ marginTop: 4, height: 4, background: 'var(--color-surface-2)', borderRadius: 999, overflow: 'hidden', maxWidth: 200 }}>
              <div style={{ height: '100%', width: `${ratio}%`, background: it.status.tone === 'danger' ? 'var(--color-danger)' : it.status.tone === 'warning' ? 'var(--color-warning)' : 'var(--color-success)', transition: 'width 200ms var(--ease-out)' }} />
            </div>
          </div>
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{it.unit}</div>
          <div className="num" style={{ fontSize: 14, fontWeight: 700, textAlign: 'right' }}>{it.stock.toLocaleString()}</div>
          <div className="num" style={{ fontSize: 13, color: 'var(--color-text-secondary)', textAlign: 'right' }}>{it.parLevel.toLocaleString()}</div>
          <div><Tag tone={it.status.tone}>{it.status.label}</Tag></div>
          <div className="num" style={{ fontSize: 13, color: 'var(--color-text-secondary)', textAlign: 'right' }}>฿{it.costPerUnit.toFixed(2)}</div>
          <div className="num" style={{ fontSize: 13, textAlign: 'right' }}>
            {it.piecePrice ? (
              <div>
                <div style={{ fontWeight: 600 }}>฿{Number(it.piecePrice).toFixed(2)}</div>
                {it.unitSize && <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 1 }}>{it.unitSize}/pack</div>}
              </div>
            ) : <span style={{ color: 'var(--color-text-muted)' }}>—</span>}
          </div>
          <div>
            {it.expiryDate ? (
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: badge ? badge.color : 'var(--color-text-secondary)' }}>
                  {formatDate(it.expiryDate)}
                </div>
                {badge && (
                  <div style={{ fontSize: 11, marginTop: 2, padding: '2px 6px', borderRadius: 4, display: 'inline-block', background: badge.bg, color: badge.color, fontWeight: 600 }}>
                    ⚠ {badge.label}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>—</div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button onClick={() => onReceive(it.id)} style={miniBtnStyle('primary')} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-primary-700)'} onMouseLeave={e => e.currentTarget.style.background = 'var(--color-primary)'}><Icon name="plus" size={12} /> รับเข้า</button>
            <button onClick={() => onWaste(it.id)} style={miniBtnStyle('ghost')} onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-warning-50)'; e.currentTarget.style.color = '#9C6A1F'; }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}><Icon name="trash" size={12} /> Waste</button>
            <button onClick={() => onSupplierHistory(it)} style={miniBtnStyle('ghost')} title="ประวัติ Supplier" onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-accent-50)'; e.currentTarget.style.color = 'var(--color-primary)'; }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}>ประวัติ</button>
            <button onClick={() => onDelete(it)} style={miniBtnStyle('danger')} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-danger-50)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'} title="ลบวัตถุดิบ"><Icon name="trash" size={12} /></button>
          </div>
        </div>
      );
    })}
  </div>
);

// ── Usage Tab ─────────────────────────────────────────────────────────────────
const UsageTab = ({ stats, movements }: {
  stats: { name: string; unit: string; weekQty: number; monthQty: number }[];
  movements: Movement[];
}) => {
  const [view, setView] = useState<'week' | 'month'>('month');
  const maxQty = Math.max(...stats.map(s => view === 'week' ? s.weekQty : s.monthQty), 1);
  const periodLabel = view === 'week' ? '7 วันล่าสุด' : 'เดือนนี้';
  const totalUsed = stats.reduce((s, r) => s + (view === 'week' ? r.weekQty : r.monthQty), 0);

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>อัตราการใช้วัตถุดิบ</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>
            คำนวณจาก SALE movements • {movements.length} รายการล่าสุด
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--color-surface-2)', borderRadius: 8 }}>
          {(['week', 'month'] as const).map(v => (
            <button key={v} onClick={() => setView(v)} style={{
              padding: '6px 14px', fontSize: 12, fontWeight: 600, border: 'none', borderRadius: 6, cursor: 'pointer',
              background: view === v ? 'var(--color-surface)' : 'transparent',
              color: view === v ? 'var(--color-text)' : 'var(--color-text-secondary)',
              fontFamily: 'inherit', transition: 'all 150ms var(--ease-out)',
            }}>{v === 'week' ? '7 วัน' : 'เดือนนี้'}</button>
          ))}
        </div>
      </div>

      {stats.length === 0 ? (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 60, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
          ยังไม่มีข้อมูลการใช้งาน — ข้อมูลจะปรากฏเมื่อมีการบันทึกออเดอร์
        </div>
      ) : (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--color-border)', display: 'flex', gap: 24, alignItems: 'center', background: 'var(--color-surface-2)' }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>รายการที่ใช้</div>
              <div className="num" style={{ fontSize: 22, fontWeight: 700 }}>{stats.filter(s => (view === 'week' ? s.weekQty : s.monthQty) > 0).length}</div>
            </div>
            <div style={{ width: 1, height: 36, background: 'var(--color-border)' }} />
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>รวมทุกรายการ{' '}({periodLabel})</div>
              <div className="num" style={{ fontSize: 22, fontWeight: 700 }}>{totalUsed.toLocaleString(undefined, { maximumFractionDigits: 1 })}</div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '40px 1.5fr 1fr 120px', gap: 12, padding: '10px 20px', fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid var(--color-border)' }}>
            <div>#</div><div>วัตถุดิบ</div><div>ปริมาณที่ใช้ ({periodLabel})</div><div style={{ textAlign: 'right' }}>จำนวน</div>
          </div>

          {stats.map((s, idx) => {
            const qty = view === 'week' ? s.weekQty : s.monthQty;
            const barPct = (qty / maxQty) * 100;
            return (
              <div key={s.name} style={{ display: 'grid', gridTemplateColumns: '40px 1.5fr 1fr 120px', gap: 12, padding: '12px 20px', alignItems: 'center', borderBottom: idx === stats.length - 1 ? 'none' : '1px solid var(--color-border)' }}>
                <div className="num" style={{ fontSize: 13, color: 'var(--color-text-muted)', fontWeight: 700 }}>{idx + 1}</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{s.name}</div>
                <div>
                  <div style={{ height: 10, background: 'var(--color-surface-2)', borderRadius: 999, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', width: `${barPct}%`,
                      background: idx === 0 ? 'var(--color-primary)' : idx < 3 ? 'var(--color-accent)' : 'var(--color-border)',
                      borderRadius: 999, transition: 'width 300ms var(--ease-out)',
                    }} />
                  </div>
                </div>
                <div className="num" style={{ fontSize: 13, fontWeight: 700, textAlign: 'right', color: qty === 0 ? 'var(--color-text-muted)' : 'var(--color-text)' }}>
                  {qty > 0 ? `${qty.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${s.unit}` : '—'}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
};

// ── Receive / Wastage Tabs ────────────────────────────────────────────────────
const ReceiveTab = ({ items, movements, onAdd }: { items: InventoryItem[]; movements: Movement[]; onAdd: () => void }) => (
  <>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
      <div>
        <div style={{ fontSize: 16, fontWeight: 700 }}>ประวัติรับเข้าสต็อก</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>{movements.length} รายการล่าสุด</div>
      </div>
      <button onClick={onAdd} style={primaryBtnStyle()} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-primary-700)'} onMouseLeave={e => e.currentTarget.style.background = 'var(--color-primary)'}><Icon name="plus" size={14} /> รับเข้าสต็อกใหม่</button>
    </div>
    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '140px 1.5fr 110px 110px 1fr 1fr', gap: 12, padding: '10px 20px', fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', background: 'var(--color-surface-2)', borderBottom: '1px solid var(--color-border)' }}>
        <div>เวลา</div><div>วัตถุดิบ</div><div style={{ textAlign: 'right' }}>จำนวน</div><div style={{ textAlign: 'right' }}>ต้นทุนรวม</div><div>Supplier</div><div>ผู้บันทึก / หมายเหตุ</div>
      </div>
      {movements.length === 0 ? (
        <div style={{ padding: 48, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>ยังไม่มีรายการรับเข้า</div>
      ) : movements.map((m, idx) => {
        const inv = items.find(i => i.id === m.invId);
        const totalCost = m.qty * (m.costPerUnit ?? 0);
        return (
          <div key={m.id} style={{ display: 'grid', gridTemplateColumns: '140px 1.5fr 110px 110px 1fr 1fr', gap: 12, padding: '12px 20px', alignItems: 'center', borderBottom: idx === movements.length - 1 ? 'none' : '1px solid var(--color-border)' }}>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{formatRelative(m.at)}</div>
            <div style={{ fontSize: 14, fontWeight: 500 }}>{inv?.name || m.invId}</div>
            <div className="num" style={{ fontSize: 13, fontWeight: 600, textAlign: 'right' }}>+{m.qty.toLocaleString()} {inv?.unit}</div>
            <div className="num" style={{ fontSize: 13, color: 'var(--color-text-secondary)', textAlign: 'right' }}>{baht(totalCost)}</div>
            <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{m.supplier || '—'}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}><div>{m.user}</div>{m.note && <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>{m.note}</div>}</div>
          </div>
        );
      })}
    </div>
  </>
);

const WastageTab = ({ items, movements, totalCost, onAdd }: { items: InventoryItem[]; movements: Movement[]; totalCost: number; onAdd: () => void }) => (
  <>
    <div style={{ background: 'var(--color-warning-50)', border: '1px solid var(--color-warning)', borderRadius: 12, padding: 20, marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <div style={{ width: 48, height: 48, borderRadius: 12, background: 'rgba(232,169,81,0.18)', color: '#9C6A1F', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
          <Icon name="warning" size={24} />
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#9C6A1F', textTransform: 'uppercase', letterSpacing: '0.04em' }}>มูลค่าสูญเสียเดือนนี้</div>
          <div className="num" style={{ fontSize: 28, fontWeight: 800, color: '#9C6A1F', letterSpacing: '-0.02em', marginTop: 2 }}>{baht(totalCost)}</div>
        </div>
      </div>
      <button onClick={onAdd} style={primaryBtnStyle()} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-primary-700)'} onMouseLeave={e => e.currentTarget.style.background = 'var(--color-primary)'}><Icon name="plus" size={14} /> บันทึก Wastage</button>
    </div>
    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '140px 1.5fr 110px 130px 110px 1fr', gap: 12, padding: '10px 20px', fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', background: 'var(--color-surface-2)', borderBottom: '1px solid var(--color-border)' }}>
        <div>เวลา</div><div>วัตถุดิบ</div><div style={{ textAlign: 'right' }}>จำนวน</div><div>สาเหตุ</div><div style={{ textAlign: 'right' }}>มูลค่า</div><div>ผู้บันทึก / หมายเหตุ</div>
      </div>
      {movements.length === 0 ? (
        <div style={{ padding: 48, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>ยังไม่มีบันทึก Wastage</div>
      ) : movements.map((m, idx) => {
        const inv = items.find(i => i.id === m.invId);
        const lossValue = inv ? inv.costPerUnit * m.qty : 0;
        const reason = WASTAGE_REASONS.find(r => r.id === m.reason);
        return (
          <div key={m.id} style={{ display: 'grid', gridTemplateColumns: '140px 1.5fr 110px 130px 110px 1fr', gap: 12, padding: '12px 20px', alignItems: 'center', borderBottom: idx === movements.length - 1 ? 'none' : '1px solid var(--color-border)' }}>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{formatRelative(m.at)}</div>
            <div style={{ fontSize: 14, fontWeight: 500 }}>{inv?.name || m.invId}</div>
            <div className="num" style={{ fontSize: 13, fontWeight: 600, textAlign: 'right', color: 'var(--color-danger)' }}>-{m.qty.toLocaleString()} {inv?.unit}</div>
            <div><Tag tone={m.reason === 'EXPIRED' ? 'danger' : m.reason === 'TRIAL' ? 'info' : 'warning'}>{reason?.label || m.reason}</Tag></div>
            <div className="num" style={{ fontSize: 13, fontWeight: 600, textAlign: 'right' }}>{baht(lossValue)}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}><div>{m.user}</div>{m.note && <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>{m.note}</div>}</div>
          </div>
        );
      })}
    </div>
  </>
);

// ── Shared helpers ────────────────────────────────────────────────────────────
const inputStyle = (): React.CSSProperties => ({
  width: '100%', padding: '10px 12px',
  border: '1px solid var(--color-border)', borderRadius: 8,
  fontSize: 14, fontFamily: 'inherit', outline: 'none',
  boxSizing: 'border-box', background: 'var(--color-surface)',
});

const ghostBtnStyle = (): React.CSSProperties => ({
  padding: '10px 16px', fontSize: 13, fontWeight: 600,
  background: 'transparent', color: 'var(--color-text-secondary)',
  border: '1px solid var(--color-border)', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
});

const FormField = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div style={{ marginBottom: 14 }}>
    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 6 }}>{label}</div>
    {children}
  </div>
);

const ModalActions = ({ children }: { children: React.ReactNode }) => (
  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 8, borderTop: '1px solid var(--color-border)', marginTop: 8 }}>{children}</div>
);

const ModalShell = ({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) => (
  <div style={{ position: 'fixed', inset: 0, background: 'rgba(26, 16, 8, 0.55)', display: 'grid', placeItems: 'center', zIndex: 100, padding: 20, animation: 'backdrop-in 200ms var(--ease-out)' }} onClick={onClose}>
    <div onClick={e => e.stopPropagation()} style={{ background: 'var(--color-surface)', borderRadius: 16, width: '100%', maxWidth: 520, maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 50px rgba(0,0,0,0.25)', animation: 'modal-in 220ms var(--ease-out)' }}>
      <div style={{ padding: 20, borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{title}</div>
          {subtitle && <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>{subtitle}</div>}
        </div>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 6, borderRadius: 8, display: 'grid', placeItems: 'center' }}><Icon name="x" size={18} /></button>
      </div>
      <div className="scroll" style={{ overflow: 'auto', padding: 20, flex: 1 }}>{children}</div>
    </div>
  </div>
);

const ItemSelect = ({ items, value, onChange, placeholder }: { items: InventoryItem[]; value: string; onChange: (v: string) => void; placeholder: string }) => (
  <select value={value} onChange={e => onChange(e.target.value)} style={{ ...inputStyle(), appearance: 'auto' }}>
    <option value="" disabled>{placeholder}</option>
    {items.map(it => <option key={it.id} value={it.id}>{it.name} · คงเหลือ {it.stock.toLocaleString()} {it.unit}</option>)}
  </select>
);

// ── Modals ────────────────────────────────────────────────────────────────────
const ReceiveStockModal = ({ items, presetItemId, onClose, onSubmit }: { items: InventoryItem[]; presetItemId: string | null; onClose: () => void; onSubmit: (v: { invId: string; qty: number; costPerUnit: number; supplier: string; note: string }) => void }) => {
  const [invId, setInvId] = useState(presetItemId || '');
  const [qty, setQty] = useState('');
  const [supplier, setSupplier] = useState('');
  const [note, setNote] = useState('');
  const [costPerUnit, setCostPerUnit] = useState(() => {
    const it = items.find(i => i.id === presetItemId);
    return it ? String(it.costPerUnit) : '';
  });
  const selectedItem = items.find(i => i.id === invId);
  const handleSelectItem = (id: string) => { setInvId(id); const it = items.find(i => i.id === id); if (it) setCostPerUnit(String(it.costPerUnit)); };
  const canSubmit = invId && Number(qty) > 0 && Number(costPerUnit) >= 0;
  const totalCost = Number(qty) * Number(costPerUnit);
  const submit = () => { if (!canSubmit) return; onSubmit({ invId, qty: Number(qty), costPerUnit: Number(costPerUnit), supplier: supplier.trim(), note: note.trim() }); };
  return (
    <ModalShell title="รับเข้าสต็อก" subtitle="เพิ่มจำนวนวัตถุดิบเข้าคลัง" onClose={onClose}>
      <FormField label="วัตถุดิบ"><ItemSelect items={items} value={invId} onChange={handleSelectItem} placeholder="เลือกวัตถุดิบ..." /></FormField>
      {selectedItem && <div style={{ padding: 12, background: 'var(--color-surface-2)', borderRadius: 8, marginBottom: 16, fontSize: 12, color: 'var(--color-text-secondary)' }}>คงเหลือ: <strong className="num">{selectedItem.stock.toLocaleString()} {selectedItem.unit}</strong> · Par: <strong>{selectedItem.parLevel.toLocaleString()}</strong></div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <FormField label={`จำนวนที่รับ${selectedItem ? ` (${selectedItem.unit})` : ''}`}><input type="number" min={0} value={qty} onChange={e => setQty(e.target.value)} placeholder="0" style={inputStyle()} /></FormField>
        <FormField label="ต้นทุน/หน่วย (฿)"><input type="number" min={0} step={0.01} value={costPerUnit} onChange={e => setCostPerUnit(e.target.value)} placeholder="0.00" style={inputStyle()} /></FormField>
      </div>
      <FormField label="Supplier"><input type="text" value={supplier} onChange={e => setSupplier(e.target.value)} placeholder="เช่น กาแฟดอยช้าง" style={inputStyle()} /></FormField>
      <FormField label="หมายเหตุ"><textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="ไม่บังคับ" style={{ ...inputStyle(), resize: 'vertical', fontFamily: 'inherit' }} /></FormField>
      {canSubmit && <div style={{ padding: 12, marginTop: 8, marginBottom: 16, background: 'var(--color-success-50)', borderRadius: 8, fontSize: 13, color: 'var(--color-success)', fontWeight: 600 }}>ต้นทุนรวม: <span className="num">{baht(totalCost)}</span></div>}
      <ModalActions>
        <button onClick={onClose} style={ghostBtnStyle()}>ยกเลิก</button>
        <button onClick={submit} disabled={!canSubmit} style={{ ...primaryBtnStyle(), opacity: canSubmit ? 1 : 0.45, cursor: canSubmit ? 'pointer' : 'not-allowed' }}><Icon name="check" size={14} /> บันทึก</button>
      </ModalActions>
    </ModalShell>
  );
};

const AddIngredientModal = ({ onClose, onSubmit }: { onClose: () => void; onSubmit: (v: { name: string; unit: string; parLevel: number; costPerUnit: number; expiryDate: string; unitSize: string; piecePrice: string }) => void }) => {
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');
  const [parLevel, setParLevel] = useState('0');
  const [costPerUnit, setCostPerUnit] = useState('0');
  const [expiryDate, setExpiryDate] = useState('');
  const [unitSize, setUnitSize] = useState('');
  const [piecePrice, setPiecePrice] = useState('');
  const pairValid = (!!unitSize && !!piecePrice) || (!unitSize && !piecePrice);
  const canSubmit = name.trim().length > 0 && unit.trim().length > 0 && pairValid;
  const submit = () => { if (!canSubmit) return; onSubmit({ name: name.trim(), unit: unit.trim(), parLevel: Number(parLevel), costPerUnit: Number(costPerUnit), expiryDate, unitSize, piecePrice }); };
  return (
    <ModalShell title="เพิ่มวัตถุดิบใหม่" subtitle="สร้างรายการวัตถุดิบในคลัง" onClose={onClose}>
      <FormField label="ชื่อวัตถุดิบ *"><input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="เช่น นมสด, กาแฟอาราบิก้า" style={inputStyle()} autoFocus /></FormField>
      <FormField label="หน่วย *"><input type="text" value={unit} onChange={e => setUnit(e.target.value)} placeholder="เช่น ml, g, ea, kg" style={inputStyle()} /></FormField>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <FormField label="Par Level (จุดสั่งซื้อ)"><input type="number" min={0} value={parLevel} onChange={e => setParLevel(e.target.value)} placeholder="0" style={inputStyle()} /></FormField>
        <FormField label="ต้นทุน/หน่วย (฿)"><input type="number" min={0} step={0.01} value={costPerUnit} onChange={e => setCostPerUnit(e.target.value)} placeholder="0.00" style={inputStyle()} /></FormField>
      </div>
      <FormField label="วันหมดอายุ (ไม่บังคับ)">
        <input type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} style={inputStyle()} />
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>ระบบจะแจ้งเตือนเมื่อใกล้หมดอายุ ≤ 7 วัน</div>
      </FormField>
      <div style={{ background: 'var(--color-surface-2)', borderRadius: 8, padding: 12, marginBottom: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 8 }}>ราคาต่อชิ้น (ไม่บังคับ — ต้องระบุทั้งคู่)</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <FormField label="จำนวนชิ้น/แพ็ค (unit_size)">
            <input type="number" min={0.001} step="any" value={unitSize} onChange={e => setUnitSize(e.target.value)} placeholder="เช่น 50 (50 ซอง/ถุง)" style={inputStyle()} />
          </FormField>
          <FormField label="ราคา/ชิ้น (฿)">
            <input type="number" min={0} step={0.01} value={piecePrice} onChange={e => setPiecePrice(e.target.value)} placeholder="0.00" style={inputStyle()} />
          </FormField>
        </div>
        {!pairValid && <div style={{ fontSize: 11, color: 'var(--color-danger)', fontWeight: 600 }}>ต้องระบุทั้ง unit_size และ piece_price พร้อมกัน</div>}
      </div>
      <ModalActions>
        <button onClick={onClose} style={ghostBtnStyle()}>ยกเลิก</button>
        <button onClick={submit} disabled={!canSubmit} style={{ ...primaryBtnStyle(), opacity: canSubmit ? 1 : 0.45, cursor: canSubmit ? 'pointer' : 'not-allowed' }}><Icon name="plus" size={14} /> เพิ่มวัตถุดิบ</button>
      </ModalActions>
    </ModalShell>
  );
};

const SupplierHistoryModal = ({ item, onClose }: { item: InventoryItem; onClose: () => void }) => {
  const { data, isLoading } = useSupplierHistory(item.id);
  const formatDt = (dt: string) => new Date(dt).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  return (
    <ModalShell title={`ประวัติ Supplier — ${item.name}`} subtitle="รายการรับเข้าทั้งหมด (RECEIVE movements)" onClose={onClose}>
      {isLoading ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--color-text-muted)' }}>กำลังโหลด...</div>
      ) : !data || data.length === 0 ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>ยังไม่มีประวัติการรับเข้า</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data.map((h: SupplierHistoryItem, idx: number) => (
            <div key={idx} style={{ padding: '12px 14px', background: 'var(--color-surface-2)', borderRadius: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{h.supplier || <span style={{ color: 'var(--color-text-muted)' }}>ไม่ระบุ Supplier</span>}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>{formatDt(h.received_at)}</div>
                  {h.note && <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>{h.note}</div>}
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div className="num" style={{ fontSize: 14, fontWeight: 700 }}>+{Number(h.quantity).toLocaleString()} {item.unit}</div>
                  {h.unit_cost && <div className="num" style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>฿{Number(h.unit_cost).toFixed(4)}/{item.unit}</div>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <ModalActions>
        <button onClick={onClose} style={ghostBtnStyle()}>ปิด</button>
      </ModalActions>
    </ModalShell>
  );
};

const WastageModal = ({ items, presetItemId, onClose, onSubmit }: { items: InventoryItem[]; presetItemId: string | null; onClose: () => void; onSubmit: (v: { invId: string; qty: number; reason: string; note: string }) => void }) => {
  const [invId, setInvId] = useState(presetItemId || '');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('EXPIRED');
  const [note, setNote] = useState('');
  const selectedItem = items.find(i => i.id === invId);
  const canSubmit = invId && Number(qty) > 0;
  const lossValue = selectedItem ? selectedItem.costPerUnit * Number(qty) : 0;
  const willGoNegative = selectedItem && Number(qty) > selectedItem.stock;
  const submit = () => { if (!canSubmit) return; onSubmit({ invId, qty: Number(qty), reason, note: note.trim() }); };
  return (
    <ModalShell title="บันทึก Wastage" subtitle="ลดสต็อกพร้อมระบุสาเหตุ" onClose={onClose}>
      <FormField label="วัตถุดิบ"><ItemSelect items={items} value={invId} onChange={setInvId} placeholder="เลือกวัตถุดิบ..." /></FormField>
      {selectedItem && <div style={{ padding: 12, background: 'var(--color-surface-2)', borderRadius: 8, marginBottom: 16, fontSize: 12, color: 'var(--color-text-secondary)' }}>คงเหลือ: <strong className="num">{selectedItem.stock.toLocaleString()} {selectedItem.unit}</strong> · ต้นทุน: ฿{selectedItem.costPerUnit.toFixed(2)}/{selectedItem.unit}</div>}
      <FormField label={`จำนวนที่สูญเสีย${selectedItem ? ` (${selectedItem.unit})` : ''}`}>
        <input type="number" min={0} step={1} value={qty} onChange={e => setQty(e.target.value)} placeholder="0" style={inputStyle()} />
        {willGoNegative && <div style={{ fontSize: 11, color: 'var(--color-warning)', marginTop: 6, fontWeight: 600 }}>⚠ จำนวนเกินสต็อกที่มี</div>}
      </FormField>
      <FormField label="สาเหตุ">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8 }}>
          {WASTAGE_REASONS.map(r => (
            <button key={r.id} onClick={() => setReason(r.id)} style={{ padding: '10px 12px', fontSize: 13, fontWeight: 600, border: reason === r.id ? '1.5px solid var(--color-primary)' : '1px solid var(--color-border)', borderRadius: 8, cursor: 'pointer', background: reason === r.id ? 'var(--color-accent-50)' : 'var(--color-surface)', color: reason === r.id ? 'var(--color-primary)' : 'var(--color-text)', fontFamily: 'inherit', transition: 'all 150ms var(--ease-out)' }}>{r.label}</button>
          ))}
        </div>
      </FormField>
      <FormField label="หมายเหตุ"><textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="ไม่บังคับ" style={{ ...inputStyle(), resize: 'vertical', fontFamily: 'inherit' }} /></FormField>
      {canSubmit && <div style={{ padding: 12, marginTop: 8, marginBottom: 16, background: 'var(--color-danger-50)', borderRadius: 8, fontSize: 13, color: 'var(--color-danger)', fontWeight: 600 }}>มูลค่าที่สูญเสีย: <span className="num">{baht(lossValue)}</span></div>}
      <ModalActions>
        <button onClick={onClose} style={ghostBtnStyle()}>ยกเลิก</button>
        <button onClick={submit} disabled={!canSubmit} style={{ ...primaryBtnStyle(), opacity: canSubmit ? 1 : 0.45, cursor: canSubmit ? 'pointer' : 'not-allowed' }}><Icon name="check" size={14} /> บันทึก</button>
      </ModalActions>
    </ModalShell>
  );
};

const DeleteInventoryConfirmModal = ({ item, deleting, onConfirm, onClose }: {
  item: InventoryItem; deleting: boolean;
  onConfirm: () => void; onClose: () => void;
}) => (
  <ModalShell title="ยืนยันการลบ" subtitle={`"${item.name}" จะถูกปิดใช้งาน`} onClose={onClose}>
    <div style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 20, lineHeight: 1.7 }}>
      วัตถุดิบนี้จะถูกซ่อนจากระบบ BOM และ Inventory สูตรที่ใช้วัตถุดิบนี้อยู่จะไม่ถูกลบ
    </div>
    <ModalActions>
      <button onClick={onClose} style={ghostBtnStyle()}>ยกเลิก</button>
      <button onClick={onConfirm} disabled={deleting} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 16px', fontSize: 13, fontWeight: 600, background: deleting ? 'var(--color-surface-2)' : 'var(--color-danger)', color: deleting ? 'var(--color-text-muted)' : '#fff', border: 'none', borderRadius: 8, cursor: deleting ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
        <Icon name="trash" size={14} />{deleting ? 'กำลังลบ...' : 'ยืนยันลบ'}
      </button>
    </ModalActions>
  </ModalShell>
);
