'use client';

import { useState, useMemo } from 'react';
import Icon from '../icons';
import { useToast, Tag, baht, Select } from '../app-common';
import { useStagger } from '@/lib/motion';
import { Skeleton, SkeletonTable } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api-client';
import { useCurrentUser, isAdmin } from '@/hooks/use-current-user';
import {
  useInventory, useInventoryMovements, useWasteStock,
  useCreateInventoryItem, useDeleteInventoryItem, useSupplierHistory,
  useExpiredInventory, useExpiredWaste, useItemLots, useReceipts, useReceipt,
  useCreateReceipt, useAddLot, useDeleteLot, useConfirmReceipt,
  useItemPacks, useCreatePack, useUpdatePack, useDeactivatePack,
  EXPIRED_WASTE_MAX,
  type InventoryItem, type Movement, type WastageReason, type SupplierHistoryItem,
  type StockLot, type ReceiptListItem, type ExpiredLot, type ExpiredWasteResult,
  type Pack, type PackCreatePayload,
} from '@/hooks/use-inventory';

const WASTAGE_REASONS = [
  { id: 'EXPIRED', label: 'หมดอายุ' },
  { id: 'SPILLED', label: 'หก' },
  { id: 'TRIAL',   label: 'ทดลอง' },
  { id: 'DAMAGED', label: 'เสีย' },
  { id: 'OTHER',   label: 'อื่นๆ' },
] as const;

// Display-only labels for reason_codes shown in movement history. Superset of the
// selectable list above: CANCELED is set by the backend on order-cancel write-offs
// and must render properly, but is not offered in the manual wastage form.
const WASTAGE_REASON_LABELS: Record<string, string> = {
  ...Object.fromEntries(WASTAGE_REASONS.map(r => [r.id, r.label])),
  CANCELED: 'ยกเลิกออเดอร์',
};

// Why a lot was skipped by POST /inventory/expired/waste.
// not_found = the lot is gone or belongs to another store (deliberately the same reason)
// not_expired = expiry is null or still in the future (Bangkok date)
// empty = already at 0, i.e. someone else confirmed it first — safe, not an error
// inactive_item = the ingredient was soft-deleted between the list and the confirm
const EXPIRED_SKIP_LABELS: Record<string, string> = {
  not_found:     'ไม่พบล็อต',
  not_expired:   'ยังไม่หมดอายุ',
  empty:         'บันทึกแล้ว',
  inactive_item: 'รายการวัตถุดิบถูกลบแล้ว',
};

// ── API error codes → Thai copy ───────────────────────────────────────────────
// The envelope is {"error": {"code", "message"}} and api-client parses the code onto
// ApiError.code. Older call sites matched on the message because the backend passes
// the code *as* the message — errCode() reads the real code and keeps that fallback.
const API_ERROR_COPY: Record<string, string> = {
  CONFLICT:                       'มีแพ็คชื่อนี้อยู่แล้ว (อาจถูกปิดใช้ไว้) — เปิดใช้แพ็คเดิมแทนได้',
  PACK_HAS_LOTS:                  'แพ็คนี้เคยรับของเข้ามาแล้ว เปลี่ยนขนาดไม่ได้ — สร้างแพ็คใหม่แทน',
  PACK_IS_DEFAULT:                'ปิดใช้แพ็คหลักไม่ได้ — ตั้งแพ็คอื่นเป็นค่าเริ่มต้นก่อน',
  PACK_DEFAULT_MUST_BE_ACTIVE:    'แพ็คที่ปิดใช้อยู่ ตั้งเป็นค่าเริ่มต้นไม่ได้',
  PACK_DEFAULT_UNSET_NOT_ALLOWED: 'ยกเลิกค่าเริ่มต้นตรงๆ ไม่ได้ — ตั้งแพ็คอื่นเป็นค่าเริ่มต้นแทน',
  PACK_OR_ITEM_REQUIRED:          'ต้องเลือกแพ็คก่อน',
  PACK_ITEM_MISMATCH:             'แพ็คนี้ไม่ใช่ของวัตถุดิบที่เลือก',
  PACK_INACTIVE:                  'แพ็คนี้ถูกปิดใช้แล้ว — เลือกแพ็คอื่น',
  ITEM_HAS_NO_PACK:               'วัตถุดิบนี้ยังไม่มีแพ็ค — เพิ่มแพ็คก่อนจึงรับของได้',
  LOT_EMPTY:                      'ล็อตนี้ของหมดแล้ว เลือกเป็นล็อตที่ใช้อยู่ไม่ได้',
  RECEIPT_ALREADY_CONFIRMED:      'ใบรับนี้ถูกยืนยันแล้ว ไม่สามารถแก้ไขได้',
  NO_LOTS:                        'ต้องเพิ่มรายการสินค้าก่อนยืนยัน',
  FORBIDDEN:                      'ต้องเป็นผู้จัดการขึ้นไปจึงแก้ไขได้',
};

const errCode = (err: unknown): string => {
  if (err instanceof ApiError && err.code) return err.code;
  const msg = err instanceof Error ? err.message : '';
  return Object.keys(API_ERROR_COPY).find(c => msg.includes(c)) ?? '';
};

/** Thai copy for a known code, else the raw message, else `fallback`. */
const errCopy = (err: unknown, fallback: string) =>
  API_ERROR_COPY[errCode(err)] ?? (err instanceof Error && err.message ? err.message : fallback);

// The backend may add reasons (e.g. `inactive_item`) — show the raw value, never throw.
const skipLabel = (reason: string) => EXPIRED_SKIP_LABELS[reason] ?? `ข้ามไว้ (${reason})`;
const skipColor = (reason: string) =>
  reason === 'empty' ? 'var(--color-text-secondary)'
  : reason in EXPIRED_SKIP_LABELS ? 'var(--color-warning)'
  : 'var(--color-text-muted)';

// Ingredient names are clean again ("Whole Milk", not "Whole Milk 2L") — the pack
// lives in a subtitle under the name instead of inside the name.
const packSummary = (it: InventoryItem): { label: string; warn: boolean } => {
  if (it.packs.length === 0) return { label: 'ยังไม่มีแพ็ค', warn: true };
  const def = it.packs.find(p => p.isDefault) ?? it.packs[0];
  return {
    label: it.packs.length > 1 ? `${def.label} · ${it.packs.length} แพ็ค` : def.label,
    warn: false,
  };
};

const stockStatusOf = (it: InventoryItem) => {
  if (it.stock < it.parLevel * 0.5) return { tone: 'danger' as const,  label: 'Critical' };
  if (it.stock < it.parLevel)        return { tone: 'warning' as const, label: 'Low' };
  return { tone: 'success' as const, label: 'OK' };
};

// Returns days until expiry (negative = already expired)
const daysUntilExpiry = (dateStr?: string | null): number | null => {
  if (!dateStr) return null;
  const exp = new Date(dateStr).setHours(23, 59, 59, 999);
  return Math.ceil((exp - Date.now()) / 86400000);
};

const expiryBadge = (dateStr?: string | null) => {
  const days = daysUntilExpiry(dateStr);
  if (days === null) return null;
  if (days < 0)   return { label: 'หมดอายุแล้ว',        color: 'var(--color-danger)',  bg: 'var(--color-danger-50)' };
  if (days <= 3)  return { label: `หมดใน ${days} วัน`,  color: 'var(--color-danger)',  bg: 'var(--color-danger-50)' };
  if (days <= 7)  return { label: `หมดใน ${days} วัน`,  color: 'var(--color-warning)', bg: 'var(--color-warning-50)' };
  if (days <= 30) return { label: `หมดใน ${days} วัน`,  color: 'var(--color-text-secondary)', bg: 'var(--color-surface-2)' };
  return null;
};

const formatDate = (dateStr?: string | null) => {
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

const todayIso = () => new Date().toISOString().split('T')[0];

// Sentinel value for the "+ เพิ่มแพ็คใหม่" row in the pack dropdown. A cuid can never
// collide with it.
const NEW_PACK_OPTION = '__new_pack__';

export default function Inventory() {
  const toast = useToast();
  const [tab, setTab] = useState('items');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [draftReceiptId, setDraftReceiptId] = useState<string | null>(null);
  const [wastageOpen, setWastageOpen] = useState(false);
  const [wastagePresetId, setWastagePresetId] = useState<string | null>(null);
  const [addIngredientOpen, setAddIngredientOpen] = useState(false);
  const [deleteConfirmItem, setDeleteConfirmItem] = useState<InventoryItem | null>(null);
  const [supplierHistoryItem, setSupplierHistoryItem] = useState<InventoryItem | null>(null);
  const [lotsItem, setLotsItem] = useState<InventoryItem | null>(null);
  const [packsItem, setPacksItem] = useState<InventoryItem | null>(null);
  const [viewReceiptId, setViewReceiptId] = useState<string | null>(null);
  const [expiredWasteOpen, setExpiredWasteOpen] = useState(false);

  const { data: me } = useCurrentUser();
  const canManagePacks = isAdmin(me?.role);
  const { data: inventoryItems, isLoading: invLoading } = useInventory();
  const { data: movementsData } = useInventoryMovements();
  const { data: expiredLots } = useExpiredInventory();
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
    expiring: expiredLots?.length ?? 0,
  }), [items, expiredLots]);

  const filteredItems = useMemo(() => items.filter(it => {
    if (search && !it.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter === 'critical' && it.status.tone !== 'danger') return false;
    if (statusFilter === 'low' && it.status.tone !== 'warning') return false;
    if (statusFilter === 'ok' && it.status.tone !== 'success') return false;
    return true;
  }), [items, search, statusFilter]);

  const movements = movementsData ?? [];
  const recentWastage  = useMemo(() => movements.filter(m => m.type === 'WASTE').sort((a, b) => b.at - a.at), [movements]);
  const saleMovements  = useMemo(() => movements.filter(m => m.type === 'SALE'), [movements]);

  const wastageThisMonth = useMemo(() => {
    const cutoff = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
    return recentWastage.filter(m => m.at >= cutoff).reduce((s, m) => {
      const inv = inventoryItems?.find(i => i.id === m.invId);
      return s + (inv ? inv.costPerUnit * m.qty : 0);
    }, 0);
  }, [recentWastage, inventoryItems]);

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

  const submitWastage = async ({ invId, qty, reason, note }: { invId: string; qty: number; reason: string; note: string }) => {
    try {
      await wasteStock.mutateAsync({ item_id: invId, qty, reason: reason as WastageReason, note: note || undefined });
      setWastageOpen(false);
      const inv = inventoryItems?.find(i => i.id === invId);
      const reasonLabel = WASTAGE_REASONS.find(r => r.id === reason)?.label || reason;
      toast({ kind: 'warning', title: 'บันทึก Wastage แล้ว', msg: `${inv?.name} -${qty.toLocaleString()} ${inv?.unit} • ${reasonLabel}` });
    } catch (err) {
      // 409 = the ingredient was soft-deleted; the backend's own message is English.
      const msg = err instanceof Error ? err.message : 'กรุณาลองใหม่';
      const inactive = msg.toLowerCase().includes('not active');
      toast({
        kind: 'warning',
        title: inactive ? 'วัตถุดิบนี้ถูกลบไปแล้ว' : 'เกิดข้อผิดพลาด',
        msg: inactive ? 'กู้คืนวัตถุดิบจากถังขยะก่อน จึงจะบันทึก Wastage ได้' : msg,
      });
    }
  };

  const submitAddIngredient = async ({ name, unit, packs, parLevel }: { name: string; unit: string; packs: PackCreatePayload[]; parLevel: string }) => {
    try {
      await createItem.mutateAsync({ name, unit, packs, par_level: parLevel || undefined });
      setAddIngredientOpen(false);
      toast({ kind: 'success', title: 'เพิ่มวัตถุดิบแล้ว', msg: `${name} (${unit}) · ${packs.length} แพ็ค` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'กรุณาลองใหม่';
      const isDuplicate = errCode(err) === 'CONFLICT' || msg.toLowerCase().includes('already exists');
      toast({ kind: 'warning', title: isDuplicate ? 'ชื่อซ้ำ' : 'เกิดข้อผิดพลาด', msg: isDuplicate ? `"${name}" มีอยู่ในระบบแล้ว` : msg });
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

  const openNewReceipt = () => { setDraftReceiptId(null); setReceiptOpen(true); };
  const openDraftReceipt = (id: string) => { setDraftReceiptId(id); setReceiptOpen(true); };
  const openWastage = (itemId?: string) => { setWastagePresetId(itemId ?? null); setWastageOpen(true); };

  const TABS = [
    { id: 'items',   label: 'วัตถุดิบ' },
    { id: 'usage',   label: 'การใช้งาน' },
    { id: 'receive', label: 'รับเข้าสต็อก' },
    { id: 'waste',   label: 'บันทึก Wastage' },
  ];

  return (
    <div className="scroll" style={{ height: '100%', overflow: 'auto', padding: 'clamp(12px, 3vw, 24px)', background: 'var(--color-bg)' }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 4 }}>P1 — Inventory</div>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: '-0.01em' }}>Inventory</h1>
        <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>วัตถุดิบ · รับเข้า · บันทึก Wastage · การใช้งาน</div>
      </div>

      {invLoading ? (
        <div aria-busy="true">
          <span className="sr-only">กำลังโหลดข้อมูลคลัง</span>
          <div className="grid grid-cols-2 md:grid-cols-4" style={{ gap: 12, marginBottom: 16 }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 16 }}>
                <Skeleton width="70%" height="var(--space-3)" />
                <Skeleton width="45%" height="var(--space-6)" style={{ marginTop: 'var(--space-2)' }} />
              </div>
            ))}
          </div>
          <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 'var(--space-4)' }}>
            <SkeletonTable rows={8} cols={5} />
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4" style={{ gap: 12, marginBottom: 16 }}>
            <KPISmall label="วัตถุดิบทั้งหมด"          value={`${counts.total} รายการ`} />
            <KPISmall label="ใกล้หมด (Low)"            value={`${counts.low} รายการ`} />
            <KPISmall label="ต่ำกว่าครึ่ง par (Critical)" value={`${counts.critical} รายการ`} />
            <KPISmall
              label="ล็อตหมดอายุ (มีสต็อก)"
              value={`${counts.expiring} ล็อต`}
              highlight={counts.expiring > 0 ? 'warning' : undefined}
              onClick={counts.expiring > 0 ? () => setExpiredWasteOpen(true) : undefined}
              actionLabel={`ล็อตหมดอายุ ${counts.expiring} ล็อต — เปิดหน้าตัดจ่าย`}
            />
          </div>

          <div className="overflow-x-auto" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--color-surface-2)', borderRadius: 10, width: 'fit-content', minWidth: 'max-content' }}>
              {TABS.map(t => (
                <button key={t.id} onClick={() => setTab(t.id)} style={{
                  padding: '8px 16px', fontSize: 13, fontWeight: 600, border: 'none', borderRadius: 8, cursor: 'pointer',
                  background: tab === t.id ? 'var(--color-surface)' : 'transparent',
                  color: tab === t.id ? 'var(--color-text)' : 'var(--color-text-secondary)',
                  boxShadow: tab === t.id ? 'var(--shadow-xs)' : 'none',
                  fontFamily: 'inherit', transition: 'all 150ms var(--ease-out)',
                  whiteSpace: 'nowrap',
                }}>{t.label}</button>
              ))}
            </div>
          </div>

          {tab === 'items'   && <ItemsTab items={filteredItems} totalCount={items.length} search={search} setSearch={setSearch} statusFilter={statusFilter} setStatusFilter={setStatusFilter} onWaste={openWastage} onAddIngredient={() => setAddIngredientOpen(true)} onDelete={setDeleteConfirmItem} onSupplierHistory={setSupplierHistoryItem} onLots={setLotsItem} onPacks={setPacksItem} />}
          {tab === 'usage'   && <UsageTab stats={usageStats} movements={saleMovements} />}
          {tab === 'receive' && <ReceiveTab onNewReceipt={openNewReceipt} onContinueDraft={openDraftReceipt} onViewReceipt={setViewReceiptId} onAddIngredient={() => setAddIngredientOpen(true)} />}
          {tab === 'waste'   && <WastageTab items={inventoryItems ?? []} movements={recentWastage} totalCost={wastageThisMonth} onAdd={() => openWastage()} expiredCount={counts.expiring} onExpiredWaste={() => setExpiredWasteOpen(true)} />}
        </>
      )}

      {receiptOpen && (
        <ReceiptFlowModal
          items={inventoryItems ?? []}
          initialReceiptId={draftReceiptId}
          onClose={() => setReceiptOpen(false)}
          onAddIngredient={() => setAddIngredientOpen(true)}
          onConfirmed={() => {
            setReceiptOpen(false);
            toast({ kind: 'success', title: 'ยืนยันการรับสินค้าแล้ว', msg: 'สต็อกถูกอัปเดตแล้ว' });
          }}
        />
      )}
      {wastageOpen && <WastageModal items={inventoryItems ?? []} presetItemId={wastagePresetId} onClose={() => setWastageOpen(false)} onSubmit={submitWastage} />}
      {addIngredientOpen && <AddIngredientModal onClose={() => setAddIngredientOpen(false)} onSubmit={submitAddIngredient} isPending={createItem.isPending} />}
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
      {lotsItem && (
        <LotsModal item={lotsItem} onClose={() => setLotsItem(null)} />
      )}
      {packsItem && (
        <PacksModal item={packsItem} canEdit={canManagePacks} onClose={() => setPacksItem(null)} />
      )}
      {expiredWasteOpen && (
        <ExpiredWasteModal onClose={() => setExpiredWasteOpen(false)} />
      )}
      {viewReceiptId && (
        <ReceiptDetailModal id={viewReceiptId} onClose={() => setViewReceiptId(null)} />
      )}
    </div>
  );
}

// `onClick` turns the tile into a button; `actionLabel` is then its accessible name,
// since the visible label+value alone don't say what the tap does.
const KPISmall = ({ label, value, highlight, onClick, actionLabel }: {
  label: string; value: string; highlight?: 'warning' | 'danger';
  onClick?: () => void; actionLabel?: string;
}) => {
  const tones = {
    warning: { bg: 'var(--color-warning-50)', border: 'var(--color-warning)', fg: 'var(--color-warning)' },
    danger:  { bg: 'var(--color-danger-50)',  border: 'var(--color-danger)',  fg: 'var(--color-danger)' },
  };
  const t = highlight ? tones[highlight] : null;
  const style: React.CSSProperties = {
    background: t ? t.bg : 'var(--color-surface)',
    border: t ? `1px solid ${t.border}` : '1px solid var(--color-border)',
    borderRadius: 12, padding: 16,
  };
  const body = (
    <>
      <div style={{ fontSize: 13, color: t ? t.fg : 'var(--color-text-secondary)', fontWeight: 500, marginBottom: 8 }}>{label}</div>
      <div className="num" style={{ fontSize: 24, fontWeight: 700, color: t ? t.fg : 'var(--color-text)' }}>{value}</div>
    </>
  );

  if (!onClick) return <div style={style}>{body}</div>;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={actionLabel}
      style={{ ...style, width: '100%', textAlign: 'left', font: 'inherit', cursor: 'pointer' }}
    >
      {body}
    </button>
  );
};

const miniBtnStyle = (variant: 'primary' | 'ghost' | 'danger'): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '6px 10px', fontSize: 11, fontWeight: 600,
  border: variant === 'danger' ? '1px solid var(--color-danger)' : variant === 'ghost' ? '1px solid var(--color-border)' : 'none',
  borderRadius: 6, cursor: 'pointer',
  background: variant === 'primary' ? 'var(--color-primary)' : 'transparent',
  color: variant === 'danger' ? 'var(--color-danger)' : variant === 'ghost' ? 'var(--color-text-secondary)' : 'var(--color-text-inverse)',
  fontFamily: 'inherit', transition: 'all 150ms var(--ease-out)',
});

const primaryBtnStyle = (): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '10px 16px', fontSize: 13, fontWeight: 600,
  background: 'var(--color-primary)', color: 'var(--color-text-inverse)',
  border: 'none', borderRadius: 8, cursor: 'pointer',
  fontFamily: 'inherit', transition: 'background 150ms var(--ease-out)',
});

const ghostBtnStyle = (): React.CSSProperties => ({
  padding: '10px 16px', fontSize: 13, fontWeight: 600,
  background: 'transparent', color: 'var(--color-text-secondary)',
  border: '1px solid var(--color-border)', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
});

const inputStyle = (): React.CSSProperties => ({
  width: '100%', padding: '10px 12px',
  border: '1px solid var(--color-border)', borderRadius: 8,
  fontSize: 14, fontFamily: 'inherit', outline: 'none',
  boxSizing: 'border-box', background: 'var(--color-surface)',
});

const smallInputStyle = (): React.CSSProperties => ({
  width: '100%', padding: '8px 10px',
  border: '1px solid var(--color-border)', borderRadius: 6,
  fontSize: 13, fontFamily: 'inherit', outline: 'none',
  boxSizing: 'border-box', background: 'var(--color-surface)',
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

const ModalShell = ({ title, subtitle, onClose, children, maxWidth = 520 }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode; maxWidth?: number }) => (
  <div className="modal-backdrop" style={{ alignItems: 'center', padding: 'var(--space-5)' }} onClick={onClose}>
    <div className="modal-card" role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: 'var(--space-5)', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{title}</div>
          {subtitle && <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>{subtitle}</div>}
        </div>
        <button onClick={onClose} aria-label="ปิด" className="icon-btn hit-44" style={{ background: 'transparent', border: 'none', cursor: 'pointer', width: 36, height: 36, borderRadius: 8, display: 'grid', placeItems: 'center', color: 'var(--color-text-secondary)' }}><Icon name="x" size={18} /></button>
      </div>
      <div className="scroll" style={{ overflow: 'auto', padding: 'var(--space-5)', flex: 1 }}>{children}</div>
    </div>
  </div>
);

const ItemSelect = ({ items, value, onChange, placeholder }: { items: InventoryItem[]; value: string; onChange: (v: string) => void; placeholder: string }) => (
  <Select
    value={value}
    onChange={onChange}
    placeholder={placeholder}
    ariaLabel={placeholder}
    options={items.map(it => ({ value: it.id, label: `${it.name} · คงเหลือ ${it.stock.toLocaleString()} ${it.unit}` }))}
  />
);

// ── Items Tab ─────────────────────────────────────────────────────────────────
const ItemsTab = ({ items, totalCount, search, setSearch, statusFilter, setStatusFilter, onWaste, onAddIngredient, onDelete, onSupplierHistory, onLots, onPacks }: {
  items: (InventoryItem & { status: ReturnType<typeof stockStatusOf> })[];
  totalCount: number; search: string; setSearch: (v: string) => void;
  statusFilter: string; setStatusFilter: (v: string) => void;
  onWaste: (id: string) => void;
  onAddIngredient: () => void; onDelete: (item: InventoryItem) => void;
  onSupplierHistory: (item: InventoryItem) => void;
  onLots: (item: InventoryItem) => void;
  onPacks: (item: InventoryItem) => void;
}) => {
  // Rows fade+rise in once, re-keyed on the filtered result so a search/filter
  // change replays the entrance. Skips the sticky header (first child).
  // Subtle, one-shot, honors reduced-motion.
  const rowsRef = useStagger({ selector: ':scope > div:not(:first-child)', each: 0.025 });
  return (
  <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, overflow: 'hidden' }}>
    {/* Filter bar — stacks on mobile, row on desktop */}
    <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--color-border)' }}>
      {/* Mobile: search full-width + icon-only filter row */}
      <div className="flex md:hidden" style={{ gap: 8, marginBottom: 8 }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <div style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', display: 'grid', placeItems: 'center' }}>
            <Icon name="search" size={16} color="var(--color-text-muted)" />
          </div>
          <input type="text" placeholder="ค้นหาวัตถุดิบ..." value={search} onChange={e => setSearch(e.target.value)}
            style={{ width: '100%', padding: '10px 12px 10px 36px', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
          />
        </div>
        <button onClick={onAddIngredient} style={{ ...primaryBtnStyle(), padding: '10px 12px' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-primary-700)'} onMouseLeave={e => e.currentTarget.style.background = 'var(--color-primary)'}><Icon name="plus" size={16} /></button>
      </div>
      <div className="flex md:hidden" style={{ gap: 4 }}>
        <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--color-surface-2)', borderRadius: 8, flex: 1 }}>
          {[{ id: 'all', label: 'ทั้งหมด' }, { id: 'critical', label: 'Crit' }, { id: 'low', label: 'Low' }, { id: 'ok', label: 'OK' }].map(s => (
            <button key={s.id} onClick={() => setStatusFilter(s.id)} style={{
              flex: 1, padding: '6px 4px', fontSize: 11, fontWeight: 600, border: 'none', borderRadius: 6, cursor: 'pointer',
              background: statusFilter === s.id ? 'var(--color-surface)' : 'transparent',
              color: statusFilter === s.id ? 'var(--color-text)' : 'var(--color-text-secondary)',
              fontFamily: 'inherit',
            }}>{s.label}</button>
          ))}
        </div>
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', alignSelf: 'center', paddingLeft: 4, whiteSpace: 'nowrap' }}>{items.length}/{totalCount}</div>
      </div>

      {/* Desktop: single row */}
      <div className="hidden md:flex" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 240 }}>
          <div style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', display: 'grid', placeItems: 'center' }}>
            <Icon name="search" size={16} color="var(--color-text-muted)" />
          </div>
          <input type="text" placeholder="ค้นหาวัตถุดิบ..." value={search} onChange={e => setSearch(e.target.value)}
            style={{ width: '100%', padding: '10px 12px 10px 36px', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
          />
        </div>
        <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--color-surface-2)', borderRadius: 8 }}>
          {[{ id: 'all', label: 'ทั้งหมด' }, { id: 'critical', label: 'Critical' }, { id: 'low', label: 'Low' }, { id: 'ok', label: 'OK' }].map(s => (
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
    </div>

    {/* Desktop table — hidden on mobile */}
    <div key={`d-${items.length}-${search}-${statusFilter}`} ref={rowsRef} className="hidden md:block">
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 60px 100px 100px 80px 100px 240px', gap: 12, padding: '10px 20px', fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', background: 'var(--color-surface-2)', borderBottom: '1px solid var(--color-border)' }}>
        <div>วัตถุดิบ</div>
        <div className="hidden lg:block">หน่วย</div>
        <div style={{ textAlign: 'right' }}>คงเหลือ</div>
        <div className="hidden lg:block" style={{ textAlign: 'right' }}>Par level</div>
        <div>สถานะ</div>
        <div className="hidden lg:block" style={{ textAlign: 'right' }}>ต้นทุน/หน่วย</div>
        <div></div>
      </div>

      {items.length === 0 ? (
        <div style={{ padding: 48, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>ไม่พบวัตถุดิบที่ตรงเงื่อนไข</div>
      ) : items.map((it, idx) => {
        const ratio = it.parLevel > 0 ? Math.min(100, (it.stock / it.parLevel) * 100) : 100;
        const pack = packSummary(it);
        return (
          <div key={it.id} style={{ display: 'grid', gridTemplateColumns: '1.5fr 60px 100px 100px 80px 100px 240px', gap: 12, padding: '12px 20px', alignItems: 'center', borderBottom: idx === items.length - 1 ? 'none' : '1px solid var(--color-border)' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{it.name}</div>
              <div style={{ fontSize: 11, marginTop: 2, color: pack.warn ? 'var(--color-warning)' : 'var(--color-text-muted)', fontWeight: pack.warn ? 600 : 400 }}>{pack.label}</div>
              <div style={{ marginTop: 4, height: 4, background: 'var(--color-surface-2)', borderRadius: 999, overflow: 'hidden', maxWidth: 200 }}>
                <div style={{ height: '100%', width: `${ratio}%`, background: it.status.tone === 'danger' ? 'var(--color-danger)' : it.status.tone === 'warning' ? 'var(--color-warning)' : 'var(--color-success)', transition: 'width 200ms var(--ease-out)' }} />
              </div>
            </div>
            <div className="hidden lg:block" style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{it.unit}</div>
            <div className="num" style={{ fontSize: 14, fontWeight: 700, textAlign: 'right' }}>{it.stock.toLocaleString()}</div>
            <div className="num hidden lg:block" style={{ fontSize: 13, color: 'var(--color-text-secondary)', textAlign: 'right' }}>{it.parLevel.toLocaleString()}</div>
            <div><Tag tone={it.status.tone}>{it.status.label}</Tag></div>
            <div className="num hidden lg:block" style={{ fontSize: 13, color: it.costPerUnit === 0 ? 'var(--color-text-muted)' : 'var(--color-text-secondary)', textAlign: 'right' }}>
              {it.costPerUnit === 0 ? '—' : `฿${it.costPerUnit.toFixed(2)}`}
              {it.costSource === 'manual' && <span title="ปักหมุดล็อตที่ใช้อยู่ (ไม่ใช่ FIFO)" style={{ marginLeft: 4, color: 'var(--color-accent)' }}>📌</span>}
            </div>
            <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button onClick={() => onPacks(it)} style={miniBtnStyle('ghost')} title="จัดการแพ็ค (ขนาด/ยี่ห้อที่ซื้อ)" onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-accent-50)'; e.currentTarget.style.color = 'var(--color-primary)'; }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}>แพ็ค</button>
              <button onClick={() => onLots(it)} style={miniBtnStyle('primary')} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-primary-700)'} onMouseLeave={e => e.currentTarget.style.background = 'var(--color-primary)'}><Icon name="list" size={12} /> Lots</button>
              <button onClick={() => onWaste(it.id)} style={miniBtnStyle('ghost')} onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-warning-50)'; e.currentTarget.style.color = 'var(--color-warning)'; }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}><Icon name="trash" size={12} /> Waste</button>
              <button onClick={() => onSupplierHistory(it)} style={miniBtnStyle('ghost')} title="ประวัติ Supplier" onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-accent-50)'; e.currentTarget.style.color = 'var(--color-primary)'; }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}>ประวัติ</button>
              <button onClick={() => onDelete(it)} style={miniBtnStyle('danger')} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-danger-50)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'} title="ลบวัตถุดิบ"><Icon name="trash" size={12} /></button>
            </div>
          </div>
        );
      })}
    </div>

    {/* Mobile card list — hidden on md+ */}
    <div className="md:hidden">
      {items.length === 0 ? (
        <div style={{ padding: 48, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>ไม่พบวัตถุดิบที่ตรงเงื่อนไข</div>
      ) : (
        <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((it) => {
            const ratio = it.parLevel > 0 ? Math.min(100, (it.stock / it.parLevel) * 100) : 100;
            const pack = packSummary(it);
            return (
              <div key={it.id} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 10, padding: '12px 14px' }}>
                {/* Row 1: name + status badge */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.3 }}>{it.name}</div>
                    <div style={{ fontSize: 11, marginTop: 2, color: pack.warn ? 'var(--color-warning)' : 'var(--color-text-muted)', fontWeight: pack.warn ? 600 : 400 }}>{it.unit} · {pack.label}</div>
                  </div>
                  <Tag tone={it.status.tone}>{it.status.label}</Tag>
                </div>
                {/* Stock bar */}
                <div style={{ height: 4, background: 'var(--color-surface-2)', borderRadius: 999, overflow: 'hidden', marginBottom: 8 }}>
                  <div style={{ height: '100%', width: `${ratio}%`, background: it.status.tone === 'danger' ? 'var(--color-danger)' : it.status.tone === 'warning' ? 'var(--color-warning)' : 'var(--color-success)', transition: 'width 200ms var(--ease-out)' }} />
                </div>
                {/* Row 2: stock + cost */}
                <div style={{ display: 'flex', gap: 16, marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>คงเหลือ</div>
                    <div className="num" style={{ fontSize: 15, fontWeight: 700 }}>{it.stock.toLocaleString()} <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--color-text-secondary)' }}>{it.unit}</span></div>
                  </div>
                  <div style={{ width: 1, background: 'var(--color-border)' }} />
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Par</div>
                    <div className="num" style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{it.parLevel.toLocaleString()}</div>
                  </div>
                  <div style={{ width: 1, background: 'var(--color-border)' }} />
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>ต้นทุน/หน่วย</div>
                    <div className="num" style={{ fontSize: 13, color: it.costPerUnit === 0 ? 'var(--color-text-muted)' : 'var(--color-text-secondary)' }}>
                      {it.costPerUnit === 0 ? '—' : `฿${it.costPerUnit.toFixed(2)}`}
                      {it.costSource === 'manual' && <span title="ปักหมุดล็อตที่ใช้อยู่" style={{ marginLeft: 3, color: 'var(--color-accent)' }}>📌</span>}
                    </div>
                  </div>
                </div>
                {/* Row 3: action buttons */}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button onClick={() => onPacks(it)} style={miniBtnStyle('ghost')} title="จัดการแพ็ค" onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-accent-50)'; e.currentTarget.style.color = 'var(--color-primary)'; }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}>แพ็ค</button>
                  <button onClick={() => onLots(it)} style={miniBtnStyle('primary')} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-primary-700)'} onMouseLeave={e => e.currentTarget.style.background = 'var(--color-primary)'}><Icon name="list" size={12} /> Lots</button>
                  <button onClick={() => onWaste(it.id)} style={miniBtnStyle('ghost')} onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-warning-50)'; e.currentTarget.style.color = 'var(--color-warning)'; }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}><Icon name="trash" size={12} /> Waste</button>
                  <button onClick={() => onSupplierHistory(it)} style={miniBtnStyle('ghost')} title="ประวัติ Supplier" onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-accent-50)'; e.currentTarget.style.color = 'var(--color-primary)'; }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}>ประวัติ</button>
                  <button onClick={() => onDelete(it)} style={miniBtnStyle('danger')} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-danger-50)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'} title="ลบวัตถุดิบ"><Icon name="trash" size={12} /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  </div>
  );
};

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

// ── Receive Tab (receipts list) ───────────────────────────────────────────────
const ReceiveTab = ({ onNewReceipt, onContinueDraft, onViewReceipt, onAddIngredient }: { onNewReceipt: () => void; onContinueDraft: (id: string) => void; onViewReceipt: (id: string) => void; onAddIngredient: () => void }) => {
  const { data: receipts, isLoading } = useReceipts();

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>ใบรับสินค้า</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>สร้างใบรับ → เพิ่มรายการ → ยืนยัน เพื่ออัปเดตสต็อก</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onAddIngredient} style={{ ...primaryBtnStyle(), background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }} onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-surface-2)'; }} onMouseLeave={e => { e.currentTarget.style.background = 'var(--color-surface)'; }}><Icon name="plus" size={14} /> เพิ่มวัตถุดิบ</button>
          <button onClick={onNewReceipt} style={primaryBtnStyle()} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-primary-700)'} onMouseLeave={e => e.currentTarget.style.background = 'var(--color-primary)'}><Icon name="plus" size={14} /> รับเข้าสต็อกใหม่</button>
        </div>
      </div>
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '130px 160px 1.5fr 110px 80px 120px', gap: 12, padding: '10px 20px', fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', background: 'var(--color-surface-2)', borderBottom: '1px solid var(--color-border)' }}>
          <div>วันที่รับ</div><div>Ref</div><div>Supplier</div><div>สถานะ</div><div style={{ textAlign: 'right' }}>รายการ</div><div></div>
        </div>
        {isLoading ? (
          <div style={{ padding: 'var(--space-4) var(--space-5)' }}>
            <SkeletonTable rows={5} cols={6} header={false} label="กำลังโหลดใบรับสินค้า" />
          </div>
        ) : !receipts || receipts.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>ยังไม่มีใบรับสินค้า — กด "รับเข้าสต็อกใหม่" เพื่อเริ่ม</div>
        ) : receipts.map((r: ReceiptListItem, idx: number) => (
          <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '130px 160px 1.5fr 110px 80px 120px', gap: 12, padding: '12px 20px', alignItems: 'center', borderBottom: idx === receipts.length - 1 ? 'none' : '1px solid var(--color-border)' }}>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{formatDate(r.receivedAt)}</div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{r.receiptRef || <span style={{ color: 'var(--color-text-muted)' }}>—</span>}</div>
            <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{r.supplierName || <span style={{ color: 'var(--color-text-muted)' }}>—</span>}</div>
            <div><Tag tone={r.status === 'CONFIRMED' ? 'success' : 'warning'}>{r.status === 'CONFIRMED' ? 'ยืนยันแล้ว' : 'แบบร่าง'}</Tag></div>
            <div className="num" style={{ fontSize: 13, textAlign: 'right', color: 'var(--color-text-secondary)' }}>{r.lotCount} รายการ</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              {r.status === 'DRAFT' ? (
                <button onClick={() => onContinueDraft(r.id)} style={miniBtnStyle('primary')} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-primary-700)'} onMouseLeave={e => e.currentTarget.style.background = 'var(--color-primary)'}>ต่อ →</button>
              ) : (
                <button onClick={() => onViewReceipt(r.id)} style={miniBtnStyle('ghost')} onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-accent-50)'; e.currentTarget.style.color = 'var(--color-primary)'; }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}>ดูรายการ</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
};

// ── Wastage Tab ───────────────────────────────────────────────────────────────
const WastageTab = ({ items, movements, totalCost, onAdd, expiredCount, onExpiredWaste }: {
  items: InventoryItem[]; movements: Movement[]; totalCost: number; onAdd: () => void;
  expiredCount: number; onExpiredWaste: () => void;
}) => (
  <>
    <div style={{ background: 'var(--color-warning-50)', border: '1px solid var(--color-warning)', borderRadius: 12, padding: 20, marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <div style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--color-surface)', color: 'var(--color-warning)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
          <Icon name="warning" size={24} />
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-warning)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>มูลค่าสูญเสียเดือนนี้</div>
          <div className="num" style={{ fontSize: 28, fontWeight: 800, color: 'var(--color-text)', letterSpacing: '-0.02em', marginTop: 2 }}>{baht(totalCost)}</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {expiredCount > 0 && (
          <button onClick={onExpiredWaste} style={{ ...ghostBtnStyle(), background: 'var(--color-surface)' }}>ตัดจ่ายล็อตหมดอายุ ({expiredCount})</button>
        )}
        <button onClick={onAdd} style={primaryBtnStyle()} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-primary-700)'} onMouseLeave={e => e.currentTarget.style.background = 'var(--color-primary)'}><Icon name="plus" size={14} /> บันทึก Wastage</button>
      </div>
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
        const reasonLabel = m.reason ? (WASTAGE_REASON_LABELS[m.reason] ?? m.reason) : null;
        return (
          <div key={m.id} style={{ display: 'grid', gridTemplateColumns: '140px 1.5fr 110px 130px 110px 1fr', gap: 12, padding: '12px 20px', alignItems: 'center', borderBottom: idx === movements.length - 1 ? 'none' : '1px solid var(--color-border)' }}>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{formatRelative(m.at)}</div>
            <div style={{ fontSize: 14, fontWeight: 500 }}>{inv?.name || m.invId}</div>
            <div className="num" style={{ fontSize: 13, fontWeight: 600, textAlign: 'right', color: 'var(--color-danger)' }}>-{m.qty.toLocaleString()} {inv?.unit}</div>
            <div><Tag tone={m.reason === 'EXPIRED' ? 'danger' : m.reason === 'TRIAL' || m.reason === 'CANCELED' ? 'info' : 'warning'}>{reasonLabel}</Tag></div>
            <div className="num" style={{ fontSize: 13, fontWeight: 600, textAlign: 'right' }}>{baht(lossValue)}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}><div>{m.user}</div>{m.note && <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>{m.note}</div>}</div>
          </div>
        );
      })}
    </div>
  </>
);

// ── Receipt Flow Modal (multi-step: header → lines → confirm) ─────────────────
const ReceiptFlowModal = ({ items, initialReceiptId, onClose, onConfirmed, onAddIngredient }: {
  items: InventoryItem[];
  initialReceiptId: string | null;
  onClose: () => void;
  onConfirmed: () => void;
  onAddIngredient: () => void;
}) => {
  const [step, setStep] = useState<'header' | 'lines'>(initialReceiptId ? 'lines' : 'header');
  const [receiptId, setReceiptId] = useState<string | null>(initialReceiptId);

  // Header form state
  const [supplierName, setSupplierName] = useState('');
  const [receiptRef, setReceiptRef] = useState('');
  const [note, setNote] = useState('');
  const [receivedAt, setReceivedAt] = useState(todayIso());

  // Add-lot form state
  const [lotItemId, setLotItemId] = useState('');
  const [lotPackId, setLotPackId] = useState('');
  const [lotPacks, setLotPacks] = useState('');
  const [lotTotalPrice, setLotTotalPrice] = useState('');
  const [lotExpiry, setLotExpiry] = useState('');
  const [ingredientSearch, setIngredientSearch] = useState('');
  const [ingredientOpen, setIngredientOpen] = useState(false);

  // Inline "new pack" form, opened from the pack dropdown's last option
  const [newPackOpen, setNewPackOpen] = useState(false);
  const [npLabel, setNpLabel] = useState('');
  const [npSize, setNpSize] = useState('');
  const [npPrice, setNpPrice] = useState('');

  const [headerError, setHeaderError] = useState('');
  const [lotError, setLotError] = useState('');
  const [confirmError, setConfirmError] = useState('');

  const { data: receipt, isLoading: receiptLoading } = useReceipt(receiptId);
  const createReceipt = useCreateReceipt();
  const addLot = useAddLot();
  const deleteLot = useDeleteLot();
  const confirmReceipt = useConfirmReceipt();
  const createPack = useCreatePack();

  const selectedLotItem = items.find(i => i.id === lotItemId);
  // Active packs already ship with the inventory list — no extra request here.
  const itemPacks = selectedLotItem?.packs ?? [];
  const selectedPack = itemPacks.find(p => p.id === lotPackId);

  const closeNewPack = () => { setNewPackOpen(false); setNpLabel(''); setNpSize(''); setNpPrice(''); };

  const handleSelectLotItem = (id: string) => {
    setLotItemId(id);
    // Preselect the default pack so the common case is still one click.
    const it = items.find(i => i.id === id);
    const def = it?.packs.find(p => p.id === it.defaultPackId) ?? it?.packs[0];
    setLotPackId(def?.id ?? '');
    closeNewPack();
    setLotError('');
  };

  const handleCreatePack = async () => {
    const size = Number(npSize);
    if (!lotItemId || size <= 0) return;
    setLotError('');
    try {
      const pack = await createPack.mutateAsync({
        itemId: lotItemId,
        pack: {
          // Blank label falls back to "2000 ml" so a one-off pack stays quick to add.
          label: npLabel.trim() || `${npSize} ${selectedLotItem?.unit ?? ''}`.trim(),
          pack_size: npSize,
          last_price: npPrice.trim() || undefined,
        },
      });
      setLotPackId(pack.id);
      closeNewPack();
    } catch (err) {
      setLotError(errCopy(err, 'เพิ่มแพ็คไม่สำเร็จ'));
    }
  };

  const resetLotForm = () => { setLotItemId(''); setLotPackId(''); setLotPacks(''); setLotTotalPrice(''); setLotExpiry(''); setLotError(''); setIngredientSearch(''); setIngredientOpen(false); closeNewPack(); };

  const handleCreateReceipt = async () => {
    setHeaderError('');
    try {
      const res = await createReceipt.mutateAsync({
        supplier_name: supplierName.trim() || undefined,
        receipt_ref: receiptRef.trim() || undefined,
        note: note.trim() || undefined,
        received_at: receivedAt || undefined,
      });
      setReceiptId(res.id);
      setStep('lines');
    } catch (err) {
      setHeaderError(err instanceof Error ? err.message : 'สร้างใบรับไม่สำเร็จ');
    }
  };

  const handleAddLot = async () => {
    const packs = Number(lotPacks);
    const total = Number(lotTotalPrice);
    if (!receiptId || !lotPackId || packs <= 0 || total <= 0) return;
    // The field collects the TOTAL paid; the API wants the price of one pack.
    const computedPackPrice = (total / packs).toFixed(2);
    if (Number(computedPackPrice) > 99999.99) { setLotError('ราคา/แพ็ค ที่คำนวณได้เกินขีดจำกัด (99,999.99)'); return; }
    setLotError('');
    try {
      await addLot.mutateAsync({
        receiptId,
        lot: {
          pack_id: lotPackId,
          qty_packs: lotPacks,
          pack_price: computedPackPrice,
          expiry_date: lotExpiry || undefined,
        },
      });
      resetLotForm();
    } catch (err) {
      setLotError(errCopy(err, 'เพิ่มรายการไม่สำเร็จ'));
    }
  };

  const handleDeleteLot = async (lotId: string) => {
    if (!receiptId) return;
    try {
      await deleteLot.mutateAsync({ receiptId, lotId });
    } catch {
      // silent — UI will reflect server state on refetch
    }
  };

  const handleConfirm = async () => {
    if (!receiptId) return;
    setConfirmError('');
    try {
      await confirmReceipt.mutateAsync(receiptId);
      onConfirmed();
    } catch (err) {
      setConfirmError(errCopy(err, 'ยืนยันไม่สำเร็จ'));
    }
  };

  const isConfirmed = receipt?.status === 'CONFIRMED';
  const canAddLot = !!lotPackId && Number(lotPacks) > 0 && Number(lotTotalPrice) > 0 && !isConfirmed;
  const canConfirm = (receipt?.lots?.length ?? 0) > 0 && !isConfirmed && !confirmReceipt.isPending;

  return (
    <ModalShell
      title={step === 'header' ? 'สร้างใบรับสินค้า' : `เพิ่มรายการสินค้า${receipt?.receiptRef ? ` — ${receipt.receiptRef}` : ''}`}
      subtitle={step === 'header' ? 'กรอกข้อมูลใบรับ (header) ก่อนเพิ่มรายการ' : receipt ? `${receipt.supplierName || 'ไม่ระบุ Supplier'} · ${formatDate(receipt.receivedAt)}` : undefined}
      onClose={onClose}
      maxWidth={640}
    >
      {step === 'header' ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormField label="Supplier"><input type="text" value={supplierName} onChange={e => setSupplierName(e.target.value)} placeholder="เช่น Thai Beverage Co." style={inputStyle()} autoFocus /></FormField>
            <FormField label="เลขที่ใบรับ (Ref)"><input type="text" value={receiptRef} onChange={e => setReceiptRef(e.target.value)} placeholder="เช่น INV-2026-0042" style={inputStyle()} /></FormField>
          </div>
          <FormField label="วันที่รับสินค้า"><input type="date" value={receivedAt} onChange={e => setReceivedAt(e.target.value)} style={inputStyle()} /></FormField>
          <FormField label="หมายเหตุ"><textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="ไม่บังคับ" style={{ ...inputStyle(), resize: 'vertical', fontFamily: 'inherit' }} /></FormField>
          {headerError && <div style={{ padding: '10px 14px', background: 'var(--color-danger-50)', color: 'var(--color-danger)', borderRadius: 8, fontSize: 13, marginBottom: 8 }}>{headerError}</div>}
          <ModalActions>
            <button onClick={onClose} style={ghostBtnStyle()}>ยกเลิก</button>
            <button onClick={handleCreateReceipt} disabled={createReceipt.isPending} style={{ ...primaryBtnStyle(), opacity: createReceipt.isPending ? 0.6 : 1 }}>
              {createReceipt.isPending ? 'กำลังสร้าง...' : 'ถัดไป →'}
            </button>
          </ModalActions>
        </>
      ) : (
        <>
          {/* Add-lot form */}
          {!isConfirmed && (
            <div style={{ background: 'var(--color-surface-2)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}>เพิ่มรายการสินค้า</div>
              <div style={{ position: 'relative', marginBottom: 10 }}>
                <input
                  type="text"
                  placeholder="เลือกวัตถุดิบ..."
                  value={ingredientSearch}
                  onChange={e => { setIngredientSearch(e.target.value); setIngredientOpen(true); }}
                  onFocus={() => setIngredientOpen(true)}
                  onBlur={() => setTimeout(() => setIngredientOpen(false), 150)}
                  style={smallInputStyle()}
                />
                {ingredientOpen && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, boxShadow: 'var(--shadow-md)', zIndex: 50, maxHeight: 200, overflow: 'auto', marginTop: 4 }}>
                    {items.filter(it => !ingredientSearch || it.name.toLowerCase().includes(ingredientSearch.toLowerCase())).length === 0 ? (
                      <div style={{ padding: '10px 12px', fontSize: 13, color: 'var(--color-text-muted)' }}>ไม่พบวัตถุดิบ</div>
                    ) : items.filter(it => !ingredientSearch || it.name.toLowerCase().includes(ingredientSearch.toLowerCase())).map(it => (
                      <div
                        key={it.id}
                        onMouseDown={() => { handleSelectLotItem(it.id); setIngredientSearch(it.name); setIngredientOpen(false); }}
                        style={{ padding: '8px 12px', fontSize: 13, cursor: 'pointer', background: it.id === lotItemId ? 'var(--color-accent-50)' : undefined, color: it.id === lotItemId ? 'var(--color-primary)' : undefined, fontWeight: it.id === lotItemId ? 600 : undefined }}
                      >
                        <div>{it.name} · {it.unit}</div>
                        <div style={{ fontSize: 11, color: it.packs.length === 0 ? 'var(--color-warning)' : 'var(--color-text-muted)', marginTop: 1 }}>{packSummary(it).label}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Step 2 — which pack was bought. Options come from the item we already have. */}
              {selectedLotItem && !newPackOpen && itemPacks.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>แพ็คที่ซื้อ *</div>
                  <Select
                    value={lotPackId}
                    onChange={v => { if (v === NEW_PACK_OPTION) { setNewPackOpen(true); } else { setLotPackId(v); } }}
                    ariaLabel="แพ็คที่ซื้อ"
                    placeholder="— เลือกแพ็ค —"
                    triggerStyle={{ padding: '8px 10px', fontSize: 13, borderRadius: 8 }}
                    options={[
                      ...itemPacks.map(p => ({
                        value: p.id,
                        label: `${p.label} · ${p.packSize.toLocaleString()} ${selectedLotItem.unit}${p.lastPrice !== null ? ` · ล่าสุด ฿${p.lastPrice.toFixed(2)}` : ''}`,
                      })),
                      { value: NEW_PACK_OPTION, label: '+ เพิ่มแพ็คใหม่' },
                    ]}
                  />
                </div>
              )}

              {/* Inline new-pack form — also the recovery path when an item has no pack yet */}
              {selectedLotItem && newPackOpen && (
                <div style={{ marginBottom: 10, padding: 10, background: 'var(--color-accent-50)', borderRadius: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-primary-700)', marginBottom: 8 }}>แพ็คใหม่ของ {selectedLotItem.name}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr auto', gap: 8, alignItems: 'flex-end' }}>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>ชื่อแพ็ค</div>
                      <input type="text" value={npLabel} onChange={e => setNpLabel(e.target.value)} placeholder="เช่น Meiji 2L" style={smallInputStyle()} />
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>ขนาด ({selectedLotItem.unit}/แพ็ค) *</div>
                      <input type="number" min={0.001} step="any" value={npSize} onChange={e => setNpSize(e.target.value)} placeholder="2000" style={smallInputStyle()} />
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>ราคา/แพ็ค</div>
                      <input type="number" min={0} step={0.01} value={npPrice} onChange={e => setNpPrice(e.target.value)} placeholder="ไม่บังคับ" style={smallInputStyle()} />
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={handleCreatePack} disabled={Number(npSize) <= 0 || createPack.isPending} style={{ ...primaryBtnStyle(), padding: '8px 12px', fontSize: 12, opacity: Number(npSize) > 0 ? 1 : 0.4, whiteSpace: 'nowrap' }}>
                        {createPack.isPending ? '...' : 'บันทึก'}
                      </button>
                      {itemPacks.length > 0 && (
                        <button onClick={closeNewPack} style={{ ...ghostBtnStyle(), padding: '8px 12px', fontSize: 12 }}>ยกเลิก</button>
                      )}
                    </div>
                  </div>
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 8, alignItems: 'flex-end' }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>จำนวนแพ็ค *</div>
                  <input type="number" min={0.001} step="any" value={lotPacks} onChange={e => setLotPacks(e.target.value)} placeholder="0" style={smallInputStyle()} />
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>ราคารวม (฿) *</div>
                  <input type="number" min={0.01} step={0.01} value={lotTotalPrice} onChange={e => setLotTotalPrice(e.target.value)} placeholder="0.00" style={smallInputStyle()} />
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>วันหมดอายุ</div>
                  <input type="date" value={lotExpiry} onChange={e => setLotExpiry(e.target.value)} style={smallInputStyle()} />
                </div>
                <button onClick={handleAddLot} disabled={!canAddLot || addLot.isPending} style={{ ...primaryBtnStyle(), padding: '8px 14px', fontSize: 12, opacity: canAddLot ? 1 : 0.4, cursor: canAddLot ? 'pointer' : 'not-allowed', whiteSpace: 'nowrap' }}>
                  {addLot.isPending ? '...' : '+ เพิ่ม'}
                </button>
              </div>
              {selectedPack && Number(lotPacks) > 0 && Number(lotTotalPrice) > 0 && (
                <div style={{ marginTop: 10, padding: '8px 12px', background: 'var(--color-accent-50)', borderRadius: 8, fontSize: 12, color: 'var(--color-primary)', fontWeight: 600 }}>
                  {selectedPack.label} · {Number(lotPacks).toLocaleString()} แพ็ค × ฿{(Number(lotTotalPrice) / Number(lotPacks)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/แพ็ค{' '}
                  = <strong>฿{Number(lotTotalPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} รวม</strong>
                </div>
              )}
              {selectedLotItem && itemPacks.length === 0 && !newPackOpen && (
                <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, color: 'var(--color-warning)', fontWeight: 600 }}>⚠ วัตถุดิบนี้ยังไม่มีแพ็ค — เพิ่มแพ็คก่อนจึงรับเข้าได้</span>
                  <button onClick={() => setNewPackOpen(true)} style={{ ...ghostBtnStyle(), padding: '6px 12px', fontSize: 12 }}>
                    <Icon name="plus" size={12} /> เพิ่มแพ็ค
                  </button>
                </div>
              )}
              {lotError && <div style={{ fontSize: 12, color: 'var(--color-danger)', marginTop: 8, fontWeight: 600 }}>{lotError}</div>}
            </div>
          )}

          {/* Lot lines list */}
          {receiptLoading ? (
            <div style={{ padding: 'var(--space-3) 0' }}>
              <SkeletonTable rows={4} cols={6} header={false} label="กำลังโหลดรายการ" />
            </div>
          ) : (
            <div style={{ border: '1px solid var(--color-border)', borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 70px 80px 90px 100px 36px', gap: 10, padding: '8px 14px', fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', background: 'var(--color-surface-2)', borderBottom: '1px solid var(--color-border)' }}>
                <div>วัตถุดิบ</div><div style={{ textAlign: 'right' }}>แพ็ค</div><div style={{ textAlign: 'right' }}>รับเข้า</div><div style={{ textAlign: 'right' }}>ราคา/แพ็ค</div><div>หมดอายุ</div><div></div>
              </div>
              {!receipt?.lots || receipt.lots.length === 0 ? (
                <div style={{ padding: 28, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>ยังไม่มีรายการ — เพิ่มสินค้าด้านบน</div>
              ) : receipt.lots.map((lot: StockLot, idx: number) => {
                const badge = expiryBadge(lot.expiryDate);
                return (
                  <div key={lot.id} style={{ display: 'grid', gridTemplateColumns: '1.5fr 70px 80px 90px 100px 36px', gap: 10, padding: '10px 14px', alignItems: 'center', borderBottom: idx === receipt.lots.length - 1 ? 'none' : '1px solid var(--color-border)' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{lot.inventoryItemName}</div>
                      {lot.packLabel && <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 1 }}>{lot.packLabel}</div>}
                    </div>
                    <div className="num" style={{ fontSize: 13, textAlign: 'right', color: 'var(--color-text-secondary)' }}>{lot.qtyPacks.toLocaleString()}</div>
                    <div className="num" style={{ fontSize: 13, textAlign: 'right' }}>{lot.qtyReceived.toLocaleString()}</div>
                    <div className="num" style={{ fontSize: 13, textAlign: 'right', fontWeight: 600 }}>฿{lot.packPrice.toFixed(2)}</div>
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
                );
              })}
            </div>
          )}

          {isConfirmed && (
            <div style={{ padding: '10px 14px', background: 'var(--color-success-50)', color: 'var(--color-success)', borderRadius: 8, fontSize: 13, fontWeight: 600, marginBottom: 12 }}>✓ ใบรับนี้ยืนยันแล้ว สต็อกถูกอัปเดตเรียบร้อย</div>
          )}
          {confirmError && <div style={{ padding: '10px 14px', background: 'var(--color-danger-50)', color: 'var(--color-danger)', borderRadius: 8, fontSize: 13, marginBottom: 8 }}>{confirmError}</div>}

          <ModalActions>
            <button onClick={onClose} style={ghostBtnStyle()}>ปิด</button>
            {!isConfirmed && (
              <button onClick={onAddIngredient} style={{ ...ghostBtnStyle(), marginLeft: 'auto', marginRight: 8 }}>
                <Icon name="plus" size={13} /> เพิ่มวัตถุดิบ
              </button>
            )}
            {!isConfirmed && (
              <button onClick={handleConfirm} disabled={!canConfirm} style={{ ...primaryBtnStyle(), opacity: canConfirm ? 1 : 0.45, cursor: canConfirm ? 'pointer' : 'not-allowed' }}>
                <Icon name="check" size={14} /> {confirmReceipt.isPending ? 'กำลังยืนยัน...' : 'ยืนยันรับสินค้า'}
              </button>
            )}
          </ModalActions>
        </>
      )}
    </ModalShell>
  );
};

// ── Lots Modal (per-ingredient lot drill-down) ────────────────────────────────
const LotsModal = ({ item, onClose }: { item: InventoryItem; onClose: () => void }) => {
  const [lotStatus, setLotStatus] = useState<'active' | 'all'>('active');
  const { data: lots, isLoading } = useItemLots(item.id, lotStatus);

  return (
    <ModalShell title={`ล็อตสต็อก — ${item.name}`} subtitle={item.costSource === 'manual' ? '📌 ปักหมุดล็อตที่ใช้อยู่ไว้ (ไม่ใช่ FIFO)' : 'FIFO — ล็อตที่เก่าที่สุดคือล็อตที่กำลังใช้'} onClose={onClose} maxWidth={680}>
      <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--color-surface-2)', borderRadius: 8, width: 'fit-content', marginBottom: 16 }}>
        {([{ id: 'active', label: 'Active' }, { id: 'all', label: 'ทั้งหมด' }] as const).map(s => (
          <button key={s.id} onClick={() => setLotStatus(s.id)} style={{
            padding: '6px 14px', fontSize: 12, fontWeight: 600, border: 'none', borderRadius: 6, cursor: 'pointer',
            background: lotStatus === s.id ? 'var(--color-surface)' : 'transparent',
            color: lotStatus === s.id ? 'var(--color-text)' : 'var(--color-text-secondary)',
            fontFamily: 'inherit', transition: 'all 150ms var(--ease-out)',
          }}>{s.label}</button>
        ))}
      </div>

      <div style={{ border: '1px solid var(--color-border)', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '28px 150px 90px 70px 90px 90px 110px', gap: 10, padding: '8px 14px', fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', background: 'var(--color-surface-2)', borderBottom: '1px solid var(--color-border)' }}>
          <div>#</div><div>แพ็ค / วันที่รับ</div><div style={{ textAlign: 'right' }}>คงเหลือ</div><div style={{ textAlign: 'right' }}>แพ็ค</div><div style={{ textAlign: 'right' }}>ราคา/แพ็ค</div><div style={{ textAlign: 'right' }}>ต้นทุน/หน่วย</div><div>หมดอายุ</div>
        </div>
        {isLoading ? (
          <div style={{ padding: 'var(--space-3) var(--space-4)' }}>
            <SkeletonTable rows={4} cols={7} header={false} label="กำลังโหลดล็อตสต็อก" />
          </div>
        ) : !lots || lots.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>ไม่มีล็อตสต็อก</div>
        ) : lots.map((lot: StockLot, idx: number) => {
          const badge = expiryBadge(lot.expiryDate);
          // With a pin the consumed lot is no longer necessarily the first row — the
          // backend tells us which one is the head.
          const isHead = lot.isHead;
          return (
            <div key={lot.id} style={{ display: 'grid', gridTemplateColumns: '28px 150px 90px 70px 90px 90px 110px', gap: 10, padding: '10px 14px', alignItems: 'center', borderBottom: idx === lots.length - 1 ? 'none' : '1px solid var(--color-border)', background: isHead ? 'var(--color-accent-50)' : undefined }}>
              <div className="num" style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 700 }}>{idx + 1}</div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{lot.packLabel ?? '—'}</div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 1 }}>
                  {formatDate(lot.receivedAt)}{lot.supplierName ? ` · ${lot.supplierName}` : ''}
                </div>
                {isHead && <div style={{ fontSize: 10, color: 'var(--color-primary)', fontWeight: 700, marginTop: 2 }}>● {lot.isInUse ? 'กำลังใช้ (ปักหมุด)' : 'กำลังใช้ (FIFO)'}</div>}
              </div>
              <div className="num" style={{ fontSize: 13, fontWeight: 700, textAlign: 'right' }}>{lot.qtyRemaining.toLocaleString()} {item.unit}</div>
              <div className="num" style={{ fontSize: 12, color: 'var(--color-text-secondary)', textAlign: 'right' }}>{lot.qtyPacks.toLocaleString()} แพ็ค</div>
              <div className="num" style={{ fontSize: 12, fontWeight: 600, textAlign: 'right' }}>฿{lot.packPrice.toFixed(2)}</div>
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
          );
        })}
      </div>

      <ModalActions>
        <button onClick={onClose} style={ghostBtnStyle()}>ปิด</button>
      </ModalActions>
    </ModalShell>
  );
};

// ── Packs Modal (ways of buying one ingredient) ───────────────────────────────
// A pack is brand + size — "Meiji 2L", "Dutch Mill 1L". Lots freeze the pack they
// were bought in, so renaming or resizing here never rewrites past receipts.
const PacksModal = ({ item, canEdit, onClose }: { item: InventoryItem; canEdit: boolean; onClose: () => void }) => {
  const [includeInactive, setIncludeInactive] = useState(false);
  const { data: packs, isLoading } = useItemPacks(item.id, includeInactive);
  const createPack = useCreatePack();
  const updatePack = useUpdatePack();
  const deactivatePack = useDeactivatePack();

  const [error, setError] = useState('');
  // null = no form open, 'new' = the add form, otherwise the pack id being edited.
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ label: '', size: '', price: '' });

  const busy = createPack.isPending || updatePack.isPending || deactivatePack.isPending;

  const openNew = () => { setEditing('new'); setForm({ label: '', size: '', price: '' }); setError(''); };
  const openEdit = (p: Pack) => {
    setEditing(p.id);
    setForm({ label: p.label, size: String(p.packSize), price: p.lastPrice === null ? '' : String(p.lastPrice) });
    setError('');
  };
  const closeForm = () => { setEditing(null); setError(''); };

  const saveForm = async () => {
    if (Number(form.size) <= 0) return;
    setError('');
    try {
      if (editing === 'new') {
        await createPack.mutateAsync({
          itemId: item.id,
          pack: {
            label: form.label.trim() || `${form.size} ${item.unit}`,
            pack_size: form.size,
            last_price: form.price.trim() || undefined,
          },
        });
      } else if (editing) {
        // is_default is never sent here — flipping the default is its own action, and
        // is_default:false on the current default is a hard 422.
        await updatePack.mutateAsync({
          itemId: item.id,
          packId: editing,
          patch: {
            label: form.label.trim() || undefined,
            pack_size: form.size,
            last_price: form.price.trim() || undefined,
          },
        });
      }
      closeForm();
    } catch (err) {
      setError(errCopy(err, 'บันทึกแพ็คไม่สำเร็จ'));
    }
  };

  const runAction = async (fn: () => Promise<unknown>, fallback: string) => {
    setError('');
    try { await fn(); } catch (err) { setError(errCopy(err, fallback)); }
  };

  const packForm = (
    <div style={{ padding: '10px 14px', background: 'var(--color-accent-50)', borderTop: '1px solid var(--color-border)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr auto', gap: 8, alignItems: 'flex-end' }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>ชื่อแพ็ค</div>
          <input type="text" value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} placeholder={form.size ? `${form.size} ${item.unit}` : 'เช่น Meiji 2L'} style={smallInputStyle()} autoFocus />
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>ขนาด ({item.unit}/แพ็ค) *</div>
          <input type="number" min={0.001} step="any" value={form.size} onChange={e => setForm(f => ({ ...f, size: e.target.value }))} placeholder="2000" style={smallInputStyle()} />
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>ราคา/แพ็ค</div>
          <input type="number" min={0} step={0.01} value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} placeholder="ไม่บังคับ" style={smallInputStyle()} />
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={saveForm} disabled={Number(form.size) <= 0 || busy} style={{ ...primaryBtnStyle(), padding: '8px 14px', fontSize: 12, opacity: Number(form.size) > 0 && !busy ? 1 : 0.45, whiteSpace: 'nowrap' }}>บันทึก</button>
          <button onClick={closeForm} style={{ ...ghostBtnStyle(), padding: '8px 12px', fontSize: 12 }}>ยกเลิก</button>
        </div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 6 }}>ราคา/แพ็ค ใช้เติมให้อัตโนมัติตอนรับของเท่านั้น — ต้นทุนจริงมาจากล็อตที่รับเข้า</div>
    </div>
  );

  return (
    <ModalShell
      title={`แพ็ค — ${item.name}`}
      subtitle="ยี่ห้อ/ขนาดที่ซื้อวัตถุดิบนี้ · สต็อกยังนับรวมเป็นยอดเดียว"
      onClose={onClose}
      maxWidth={640}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--color-surface-2)', borderRadius: 8, width: 'fit-content' }}>
          {([{ id: false, label: 'ใช้งานอยู่' }, { id: true, label: 'ทั้งหมด' }] as const).map(s => (
            <button key={String(s.id)} onClick={() => setIncludeInactive(s.id)} style={{
              padding: '6px 14px', fontSize: 12, fontWeight: 600, border: 'none', borderRadius: 6, cursor: 'pointer',
              background: includeInactive === s.id ? 'var(--color-surface)' : 'transparent',
              color: includeInactive === s.id ? 'var(--color-text)' : 'var(--color-text-secondary)',
              fontFamily: 'inherit', transition: 'all 150ms var(--ease-out)',
            }}>{s.label}</button>
          ))}
        </div>
        {canEdit && editing === null && (
          <button onClick={openNew} style={{ ...primaryBtnStyle(), padding: '8px 14px', fontSize: 12, marginLeft: 'auto' }}>
            <Icon name="plus" size={13} /> เพิ่มแพ็ค
          </button>
        )}
      </div>

      {error && <div style={{ padding: '10px 14px', background: 'var(--color-danger-50)', color: 'var(--color-danger)', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>{error}</div>}

      <div style={{ border: '1px solid var(--color-border)', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 110px 90px 1fr', gap: 10, padding: '8px 14px', fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', background: 'var(--color-surface-2)', borderBottom: '1px solid var(--color-border)' }}>
          <div>ชื่อแพ็ค</div><div style={{ textAlign: 'right' }}>ขนาด</div><div style={{ textAlign: 'right' }}>ราคาล่าสุด</div><div></div>
        </div>

        {isLoading ? (
          <div style={{ padding: 'var(--space-3) var(--space-4)' }}>
            <SkeletonTable rows={3} cols={4} header={false} label="กำลังโหลดแพ็ค" />
          </div>
        ) : !packs || packs.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
            ยังไม่มีแพ็ค — เพิ่มแพ็คก่อนจึงรับของเข้าได้
          </div>
        ) : packs.map((p, idx) => (
          editing === p.id ? <div key={p.id}>{packForm}</div> : (
            <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '1.4fr 110px 90px 1fr', gap: 10, padding: '10px 14px', alignItems: 'center', borderBottom: idx === packs.length - 1 ? 'none' : '1px solid var(--color-border)', opacity: p.isActive ? 1 : 0.55 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{p.label}</div>
                <div style={{ display: 'flex', gap: 6, marginTop: 3 }}>
                  {p.isDefault && <Tag tone="accent">ค่าเริ่มต้น</Tag>}
                  {!p.isActive && <Tag tone="neutral">ปิดใช้</Tag>}
                </div>
              </div>
              <div className="num" style={{ fontSize: 13, textAlign: 'right' }}>{p.packSize.toLocaleString()} {item.unit}</div>
              <div className="num" style={{ fontSize: 13, textAlign: 'right', color: p.lastPrice === null ? 'var(--color-text-muted)' : 'var(--color-text-secondary)' }}>
                {p.lastPrice === null ? '—' : `฿${p.lastPrice.toFixed(2)}`}
              </div>
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                {canEdit && p.isActive && (
                  <button onClick={() => openEdit(p)} disabled={busy} style={miniBtnStyle('ghost')}>แก้ไข</button>
                )}
                {canEdit && p.isActive && !p.isDefault && (
                  <button onClick={() => runAction(() => updatePack.mutateAsync({ itemId: item.id, packId: p.id, patch: { is_default: true } }), 'ตั้งค่าเริ่มต้นไม่สำเร็จ')} disabled={busy} style={miniBtnStyle('ghost')} title="ให้แพ็คนี้เป็นค่าเริ่มต้นตอนรับของ">ตั้งเป็นหลัก</button>
                )}
                {canEdit && p.isActive && (
                  <button onClick={() => runAction(() => deactivatePack.mutateAsync({ itemId: item.id, packId: p.id }), 'ปิดใช้ไม่สำเร็จ')} disabled={busy} style={miniBtnStyle('danger')} title="ปิดใช้แพ็คนี้">ปิดใช้</button>
                )}
                {canEdit && !p.isActive && (
                  <button onClick={() => runAction(() => updatePack.mutateAsync({ itemId: item.id, packId: p.id, patch: { is_active: true } }), 'เปิดใช้ไม่สำเร็จ')} disabled={busy} style={miniBtnStyle('primary')}>เปิดใช้</button>
                )}
              </div>
            </div>
          )
        ))}

        {editing === 'new' && packForm}
      </div>

      {!canEdit && (
        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--color-text-muted)' }}>ดูอย่างเดียว — ต้องเป็นผู้จัดการขึ้นไปจึงแก้ไขแพ็คได้</div>
      )}

      <ModalActions>
        <button onClick={onClose} style={ghostBtnStyle()}>ปิด</button>
      </ModalActions>
    </ModalShell>
  );
};

// ── Expired Lot Waste Modal (batch confirm expired stock as wasted) ───────────
// Deliberately NOT optimistic: skips are normal on a list another till may have acted
// on already, so the result panel — not a guess — is what the user is shown.
const EXPIRED_GRID = '28px 1.4fr 110px 130px';

const ExpiredWasteModal = ({ onClose }: { onClose: () => void }) => {
  const toast = useToast();
  const { data: lots, isLoading } = useExpiredInventory();
  const expiredWaste = useExpiredWaste();

  // Selection is stored as explicit overrides, not as the selection itself: everything is
  // checked by default (the handoff's recommended flow) and only what the user actually
  // touched is remembered. That way a background refetch can neither un-check a lot the
  // user kept nor silently re-check one they dropped, with no effect to synchronise.
  const [override, setOverride] = useState<ReadonlyMap<string, boolean>>(new Map());
  // `byId` is snapshotted at submit time: a successful call invalidates the list, so by
  // the time this renders the wasted rows are gone and skip lines would show bare ids.
  const [result, setResult] = useState<{ res: ExpiredWasteResult; byId: Map<string, ExpiredLot> } | null>(null);

  const rows = lots ?? [];
  // Rows are expiry-ascending, so defaulting to the first EXPIRED_WASTE_MAX picks the
  // batch that most needs clearing; the rest is a second pass.
  const isChecked = (lotId: string, idx: number) => override.get(lotId) ?? idx < EXPIRED_WASTE_MAX;

  // Derived from the live list, so a selection made against a stale list is harmless.
  const selectedIds = useMemo(
    () => rows.filter((l, idx) => isChecked(l.lotId, idx)).map(l => l.lotId),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isChecked is derived from `override`
    [rows, override],
  );

  const allChecked = rows.length > 0 && selectedIds.length === rows.length;
  const someChecked = selectedIds.length > 0 && !allChecked;
  const overCap = selectedIds.length > EXPIRED_WASTE_MAX;

  const toggle = (lotId: string, idx: number) =>
    setOverride(prev => new Map(prev).set(lotId, !isChecked(lotId, idx)));

  const toggleAll = () => setOverride(
    new Map(rows.map((l, idx) => [l.lotId, allChecked ? false : idx < EXPIRED_WASTE_MAX])),
  );

  const submit = async () => {
    if (!selectedIds.length || overCap || expiredWaste.isPending) return;
    const byId = new Map(rows.map(l => [l.lotId, l]));
    try {
      const res = await expiredWaste.mutateAsync(selectedIds);
      setResult({ res, byId });
      if (res.skipped.length === 0) {
        toast({ kind: 'success', title: 'ตัดจ่ายล็อตหมดอายุแล้ว', msg: `${res.wasted.length} ล็อต` });
      } else {
        toast({ kind: 'warning', title: `ตัดจ่าย ${res.wasted.length} ล็อต`, msg: `ข้าม ${res.skipped.length} ล็อต — ดูรายละเอียดในหน้าต่าง` });
      }
    } catch (err) {
      toast({ kind: 'warning', title: 'เกิดข้อผิดพลาด', msg: err instanceof Error ? err.message : 'กรุณาลองใหม่' });
    }
  };

  if (result) {
    const groups = result.res.skipped.reduce<Record<string, string[]>>((acc, s) => {
      (acc[s.reason] ??= []).push(result.byId.get(s.lotId)?.itemName ?? s.lotId);
      return acc;
    }, {});
    return (
      <ModalShell title="ผลการตัดจ่าย" subtitle="สต็อกถูกหักออกแล้ว และบันทึกเป็น Wastage สาเหตุ หมดอายุ" onClose={onClose} maxWidth={640}>
        <div style={{ background: 'var(--color-surface-2)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>ตัดจ่ายสำเร็จ</div>
          <div className="num" style={{ fontSize: 28, fontWeight: 800, marginTop: 2 }}>{result.res.wasted.length} ล็อต</div>
        </div>

        {Object.entries(groups).map(([reason, names]) => (
          <div key={reason} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: skipColor(reason), marginBottom: 6 }}>
              {skipLabel(reason)} · {names.length} ล็อต
            </div>
            <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, overflow: 'hidden' }}>
              {names.map((name, idx) => (
                <div key={`${reason}-${idx}`} style={{ padding: '8px 12px', fontSize: 13, borderBottom: idx === names.length - 1 ? 'none' : '1px solid var(--color-border)' }}>{name}</div>
              ))}
            </div>
          </div>
        ))}

        <ModalActions>
          <button onClick={() => { setResult(null); setOverride(new Map()); }} style={ghostBtnStyle()}>ดูรายการที่เหลือ</button>
          <button onClick={onClose} style={primaryBtnStyle()}>ปิด</button>
        </ModalActions>
      </ModalShell>
    );
  }

  return (
    <ModalShell
      title="ตัดจ่ายล็อตหมดอายุ"
      subtitle="ยืนยันแล้วระบบจะหักสต็อกที่เหลือทั้งล็อต และบันทึกเป็น Wastage สาเหตุ หมดอายุ"
      onClose={onClose}
      maxWidth={640}
    >
      <div style={{ border: '1px solid var(--color-border)', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: EXPIRED_GRID, gap: 10, padding: '8px 14px', fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', background: 'var(--color-surface-2)', borderBottom: '1px solid var(--color-border)', alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={allChecked}
            ref={el => { if (el) el.indeterminate = someChecked; }}
            onChange={toggleAll}
            disabled={rows.length === 0}
            aria-label="เลือกทั้งหมด"
            style={{ width: 16, height: 16, cursor: rows.length === 0 ? 'default' : 'pointer' }}
          />
          <div>วัตถุดิบ</div>
          <div style={{ textAlign: 'right' }}>คงเหลือ</div>
          <div>หมดอายุ</div>
        </div>

        {isLoading ? (
          <div style={{ padding: 'var(--space-3) var(--space-4)' }}>
            <SkeletonTable rows={4} cols={4} header={false} label="กำลังโหลดล็อตหมดอายุ" />
          </div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>ไม่มีล็อตหมดอายุที่มีสต็อกเหลือ</div>
        ) : rows.map((lot, idx) => {
          const badge = expiryBadge(lot.expiryDate);
          return (
            <label key={lot.lotId} style={{ display: 'grid', gridTemplateColumns: EXPIRED_GRID, gap: 10, padding: '10px 14px', alignItems: 'center', borderBottom: idx === rows.length - 1 ? 'none' : '1px solid var(--color-border)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={isChecked(lot.lotId, idx)}
                onChange={() => toggle(lot.lotId, idx)}
                style={{ width: 16, height: 16, cursor: 'pointer' }}
              />
              <div style={{ fontSize: 14, fontWeight: 500 }}>{lot.itemName}</div>
              <div className="num" style={{ fontSize: 13, fontWeight: 700, textAlign: 'right' }}>{lot.qtyRemaining.toLocaleString()} {lot.unit}</div>
              <div style={{ fontSize: 12 }}>
                <div style={{ color: badge ? badge.color : 'var(--color-text-secondary)', fontWeight: badge ? 600 : 400 }}>{formatDate(lot.expiryDate)}</div>
                {badge && <div style={{ fontSize: 10, marginTop: 2, color: badge.color, fontWeight: 600 }}>⚠ {badge.label}</div>}
              </div>
            </label>
          );
        })}
      </div>

      {rows.length > EXPIRED_WASTE_MAX && (
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 10 }}>
          ตัดจ่ายได้ครั้งละ {EXPIRED_WASTE_MAX} ล็อต — เลือกไว้ให้แล้ว {EXPIRED_WASTE_MAX} ล็อตที่หมดอายุก่อน ที่เหลือทำรอบถัดไปได้
        </div>
      )}
      {overCap && (
        <div role="alert" style={{ fontSize: 12, color: 'var(--color-danger)', fontWeight: 600, marginTop: 10 }}>
          เลือกได้สูงสุด {EXPIRED_WASTE_MAX} ล็อตต่อครั้ง
        </div>
      )}

      <ModalActions>
        <button onClick={onClose} style={ghostBtnStyle()}>ยกเลิก</button>
        <button
          onClick={submit}
          disabled={!selectedIds.length || overCap || expiredWaste.isPending}
          style={{ ...primaryBtnStyle(), opacity: !selectedIds.length || overCap || expiredWaste.isPending ? 0.5 : 1, cursor: !selectedIds.length || overCap || expiredWaste.isPending ? 'not-allowed' : 'pointer' }}
        >
          {expiredWaste.isPending ? 'กำลังบันทึก…' : `ตัดจ่าย ${selectedIds.length} ล็อต`}
        </button>
      </ModalActions>
    </ModalShell>
  );
};

// ── Add Ingredient Modal ───────────────────────────────────────────────────────
const AddIngredientModal = ({ onClose, onSubmit, isPending }: {
  onClose: () => void;
  onSubmit: (v: { name: string; unit: string; packs: PackCreatePayload[]; parLevel: string }) => void;
  isPending?: boolean;
}) => {
  const [name, setName]         = useState('');
  const [unit, setUnit]         = useState('');
  const [parLevel, setParLevel] = useState('');
  // One row per way of buying this ingredient. Most items only ever need the first.
  const [packRows, setPackRows] = useState([{ label: '', size: '', price: '' }]);
  const [defaultIdx, setDefaultIdx] = useState(0);

  const setRow = (i: number, patch: Partial<{ label: string; size: string; price: string }>) =>
    setPackRows(rows => rows.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  const addRow = () => setPackRows(rows => [...rows, { label: '', size: '', price: '' }]);
  const removeRow = (i: number) => {
    setPackRows(rows => rows.filter((_, idx) => idx !== i));
    setDefaultIdx(d => (d === i ? 0 : d > i ? d - 1 : d));
  };

  const canSubmit = name.trim().length > 0 && unit.trim().length > 0
    && packRows.length > 0 && packRows.every(r => Number(r.size) > 0);

  const submit = () => {
    if (!canSubmit || isPending) return;
    const u = unit.trim();
    onSubmit({
      name: name.trim(),
      unit: u,
      packs: packRows.map((r, i) => ({
        // Blank label falls back to "2000 ml" — the tenant renames it later.
        label: r.label.trim() || `${r.size} ${u}`,
        pack_size: r.size,
        last_price: r.price.trim() || undefined,
        is_default: i === defaultIdx,
      })),
      parLevel,
    });
  };

  return (
    <ModalShell title="เพิ่มวัตถุดิบใหม่" subtitle="ต้นทุนจะอัปเดตอัตโนมัติเมื่อรับสินค้าครั้งแรก" onClose={onClose}>
      <FormField label="ชื่อวัตถุดิบ *">
        <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="เช่น Whole Milk, กาแฟอาราบิก้า" style={inputStyle()} autoFocus />
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>ไม่ต้องใส่ขนาดในชื่อ — ขนาด/ยี่ห้ออยู่ที่แพ็คด้านล่าง</div>
      </FormField>
      <FormField label="หน่วยสต็อก (unit) *">
        <input type="text" value={unit} onChange={e => setUnit(e.target.value)} placeholder="เช่น ml, g, kg, pcs" style={inputStyle()} />
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>หน่วยที่ครัวใช้นับสต็อก</div>
      </FormField>

      <div style={{ background: 'var(--color-surface-2)', borderRadius: 10, padding: 14, marginBottom: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-secondary)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}>แพ็คที่ซื้อ *</div>
        <div style={{ display: 'grid', gridTemplateColumns: '28px 1.4fr 1fr 1fr 28px', gap: 8, fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 6 }}>
          <div title="แพ็คหลัก">หลัก</div><div>ชื่อแพ็ค</div><div>ขนาด ({unit || 'unit'}) *</div><div>ราคา/แพ็ค</div><div></div>
        </div>
        {packRows.map((r, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '28px 1.4fr 1fr 1fr 28px', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <input type="radio" name="default-pack" checked={defaultIdx === i} onChange={() => setDefaultIdx(i)} aria-label={`ตั้งแพ็คแถวที่ ${i + 1} เป็นแพ็คหลัก`} style={{ justifySelf: 'center' }} />
            <input type="text" value={r.label} onChange={e => setRow(i, { label: e.target.value })} placeholder={r.size ? `${r.size} ${unit || 'unit'}` : 'เช่น Meiji 2L'} style={smallInputStyle()} />
            <input type="number" min={0.001} step="any" value={r.size} onChange={e => setRow(i, { size: e.target.value })} placeholder="2000" style={smallInputStyle()} />
            <input type="number" min={0} step={0.01} value={r.price} onChange={e => setRow(i, { price: e.target.value })} placeholder="ไม่บังคับ" style={smallInputStyle()} />
            {packRows.length > 1 ? (
              <button onClick={() => removeRow(i)} title="ลบแพ็คนี้" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'grid', placeItems: 'center', padding: 2 }}><Icon name="x" size={13} /></button>
            ) : <div />}
          </div>
        ))}
        <button onClick={addRow} style={{ ...ghostBtnStyle(), padding: '6px 12px', fontSize: 12 }}>
          <Icon name="plus" size={12} /> เพิ่มแพ็ค
        </button>
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 8 }}>ซื้อยี่ห้อ/ขนาดไหนก็เพิ่มเป็นแพ็คได้ — ราคาจริงระบุตอนรับสินค้า ต้นทุน/หน่วยคำนวณให้อัตโนมัติ</div>
      </div>

      <FormField label="Par Level — จุดสั่งซื้อ (ไม่บังคับ)">
        <input type="number" min={0} step="any" value={parLevel} onChange={e => setParLevel(e.target.value)} placeholder={`0 ${unit || 'หน่วย'}`} style={inputStyle()} />
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>แจ้งเตือนเมื่อสต็อกต่ำกว่าค่านี้</div>
      </FormField>

      <ModalActions>
        <button onClick={onClose} style={ghostBtnStyle()}>ยกเลิก</button>
        <button onClick={submit} disabled={!canSubmit || isPending} style={{ ...primaryBtnStyle(), opacity: (canSubmit && !isPending) ? 1 : 0.45, cursor: (canSubmit && !isPending) ? 'pointer' : 'not-allowed' }}>
          <Icon name="plus" size={14} /> {isPending ? 'กำลังเพิ่ม...' : 'เพิ่มวัตถุดิบ'}
        </button>
      </ModalActions>
    </ModalShell>
  );
};

// ── Supplier History Modal ─────────────────────────────────────────────────────
const SupplierHistoryModal = ({ item, onClose }: { item: InventoryItem; onClose: () => void }) => {
  const { data, isLoading } = useSupplierHistory(item.id);
  const formatDt = (dt: string) => new Date(dt).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  return (
    <ModalShell title={`ประวัติ Supplier — ${item.name}`} subtitle="รายการรับเข้าทั้งหมด (RECEIVE movements)" onClose={onClose}>
      {isLoading ? (
        <SkeletonTable rows={5} cols={4} label="กำลังโหลดประวัติ Supplier" />
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

// ── Wastage Modal ─────────────────────────────────────────────────────────────
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

// ── Receipt Detail Modal (confirmed receipt read-only view) ───────────────────
const ReceiptDetailModal = ({ id, onClose }: { id: string; onClose: () => void }) => {
  const { data: receipt, isLoading } = useReceipt(id);
  const total = receipt?.lots.reduce((s, lot) => s + lot.qtyPacks * lot.packPrice, 0) ?? 0;

  return (
    <ModalShell
      title={`ใบรับสินค้า${receipt?.receiptRef ? ` — ${receipt.receiptRef}` : ''}`}
      subtitle={receipt ? `${receipt.supplierName || 'ไม่ระบุ Supplier'} · ${formatDate(receipt.receivedAt)}` : undefined}
      onClose={onClose}
      maxWidth={680}
    >
      {isLoading ? (
        <SkeletonTable rows={5} cols={5} label="กำลังโหลดใบรับสินค้า" />
      ) : (
        <>
          <div style={{ border: '1px solid var(--color-border)', borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 80px 90px 90px 110px', gap: 10, padding: '8px 14px', fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', background: 'var(--color-surface-2)', borderBottom: '1px solid var(--color-border)' }}>
              <div>วัตถุดิบ</div><div style={{ textAlign: 'right' }}>จำนวนแพ็ค</div><div style={{ textAlign: 'right' }}>ราคา/แพ็ค</div><div style={{ textAlign: 'right' }}>ราคารวม</div><div>วันหมดอายุ</div>
            </div>
            {!receipt?.lots || receipt.lots.length === 0 ? (
              <div style={{ padding: 28, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>ไม่มีรายการ</div>
            ) : receipt.lots.map((lot: StockLot, idx: number) => {
              const rowTotal = lot.qtyPacks * lot.packPrice;
              const badge = expiryBadge(lot.expiryDate);
              return (
                <div key={lot.id} style={{ display: 'grid', gridTemplateColumns: '1.5fr 80px 90px 90px 110px', gap: 10, padding: '10px 14px', alignItems: 'center', borderBottom: idx === receipt.lots.length - 1 ? 'none' : '1px solid var(--color-border)' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{lot.inventoryItemName}</div>
                    {lot.packLabel && <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 1 }}>{lot.packLabel}</div>}
                  </div>
                  <div className="num" style={{ fontSize: 13, textAlign: 'right', color: 'var(--color-text-secondary)' }}>{lot.qtyPacks.toLocaleString()}</div>
                  <div className="num" style={{ fontSize: 13, textAlign: 'right' }}>฿{lot.packPrice.toFixed(2)}</div>
                  <div className="num" style={{ fontSize: 13, fontWeight: 600, textAlign: 'right' }}>฿{rowTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                  <div style={{ fontSize: 12 }}>
                    {lot.expiryDate ? (
                      <div>
                        <div style={{ color: badge ? badge.color : 'var(--color-text-secondary)', fontWeight: badge ? 600 : 400 }}>{formatDate(lot.expiryDate)}</div>
                        {badge && <div style={{ fontSize: 10, marginTop: 2, color: badge.color, fontWeight: 600 }}>⚠ {badge.label}</div>}
                      </div>
                    ) : <span style={{ color: 'var(--color-text-muted)' }}>—</span>}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ padding: '12px 16px', background: 'var(--color-surface-2)', borderRadius: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary)' }}>รวมทั้งหมด</div>
            <div className="num" style={{ fontSize: 18, fontWeight: 800 }}>฿{total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          </div>
        </>
      )}
      <ModalActions>
        <button onClick={onClose} style={ghostBtnStyle()}>ปิด</button>
      </ModalActions>
    </ModalShell>
  );
};

// ── Delete Confirm Modal ───────────────────────────────────────────────────────
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
      <button onClick={onConfirm} disabled={deleting} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 16px', fontSize: 13, fontWeight: 600, background: deleting ? 'var(--color-surface-2)' : 'var(--color-danger-strong)', color: deleting ? 'var(--color-text-muted)' : '#fff', border: 'none', borderRadius: 8, cursor: deleting ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
        <Icon name="trash" size={14} />{deleting ? 'กำลังลบ...' : 'ยืนยันลบ'}
      </button>
    </ModalActions>
  </ModalShell>
);
