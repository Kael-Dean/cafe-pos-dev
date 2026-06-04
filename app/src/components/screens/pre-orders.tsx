'use client';

import { useState, useEffect } from 'react';
import Icon from '../icons';
import { useToast } from '../app-common';
import { useLookupMember, type AccountRead } from '@/hooks/use-membership';
import {
  usePreOrders, usePreOrder, usePreOrderIngredients,
  useCreatePreOrder, useUpdatePreOrder,
  useAddPreOrderItem, useRemovePreOrderItem,
  useStartPreOrder, useCompletePreOrder, useCancelPreOrder,
  useSetFulfillmentMode,
  type PreOrder, type PreOrderListItem, type PreOrderStatus,
  type CreatePreOrderPayload, type CreatePreOrderItemPayload,
  type UpdatePreOrderPayload, type IngredientsResult,
  type FulfillmentMode,
} from '@/hooks/use-pre-orders';
import { useAddToShoppingList } from '@/hooks/use-shopping-list';
import { useAllProducts, type MenuItem } from '@/hooks/use-products';
import { useInventory, type InventoryItem } from '@/hooks/use-inventory';

// ── Helpers ───────────────────────────────────────────────────────────────────
const STATUS_LABELS: Record<PreOrderStatus, string> = {
  PENDING:     'Pending',
  IN_PROGRESS: 'In Progress',
  COMPLETED:   'Completed',
  CANCELLED:   'Cancelled',
};

const STATUS_COLORS: Record<PreOrderStatus, { color: string; bg: string }> = {
  PENDING:     { color: '#9C6A1F',                    bg: 'var(--color-warning-50)' },
  IN_PROGRESS: { color: 'var(--color-info)',           bg: '#EFF6FF' },
  COMPLETED:   { color: 'var(--color-success)',        bg: '#F0FDF4' },
  CANCELLED:   { color: 'var(--color-text-secondary)', bg: 'var(--color-surface-2)' },
};

const todayIso = () => new Date().toISOString().split('T')[0];

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });

const fmtMoney = (v: string | null) => (v ? Number(v).toFixed(2) : '—');

const labelStyle: React.CSSProperties = {
  fontSize: 12, fontWeight: 500, color: 'var(--color-text-secondary)',
  display: 'block', marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', borderRadius: 7,
  border: '1px solid var(--color-border)', fontSize: 13,
  background: 'var(--color-bg)', boxSizing: 'border-box',
};

function StatusBadge({ status }: { status: PreOrderStatus }) {
  const { color, bg } = STATUS_COLORS[status];
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 999,
      fontSize: 11, fontWeight: 600, color, background: bg, whiteSpace: 'nowrap',
    }}>
      {STATUS_LABELS[status]}
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function PreOrders() {
  const toast = useToast();

  // List/selection state
  const [statusFilter, setStatusFilter] = useState<PreOrderStatus | undefined>(undefined);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Detail state
  const [detailTab, setDetailTab] = useState<'details' | 'ingredients'>('details');
  const [threshold, setThreshold] = useState(50);

  // Add-item-to-existing-order inline row state
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

  // Confirm start dialog
  const [confirmStart, setConfirmStart] = useState(false);

  // Queries
  const { data: listData, isLoading: listLoading } = usePreOrders(statusFilter);
  const { data: detail, isLoading: detailLoading } = usePreOrder(selectedId);
  const { data: ingredients } = usePreOrderIngredients(
    detailTab === 'ingredients' ? selectedId : null,
    threshold,
  );
  const { data: allProducts = [] } = useAllProducts();
  const { data: inventoryItems = [] } = useInventory();

  // Mutations
  const createMut   = useCreatePreOrder();
  const updateMut   = useUpdatePreOrder();
  const addItemMut  = useAddPreOrderItem();
  const rmItemMut   = useRemovePreOrderItem();
  const startMut    = useStartPreOrder();
  const completeMut = useCompletePreOrder();
  const cancelMut   = useCancelPreOrder();
  const setFulfillmentMut = useSetFulfillmentMode();
  const addToList   = useAddToShoppingList();

  // Which item is currently mid-PATCH (to show row-level spinner)
  const [settingFulfillmentItemId, setSettingFulfillmentItemId] = useState<string | null>(null);

  const listItems = listData?.items ?? [];

  // ── Handlers ──────────────────────────────────────────────────────────────

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
      order_date:     cOrderDate,
      due_date:       cDueDate,
      customer_name:  cName.trim(),
      customer_phone: cPhone.trim(),
      deposit_amount: cDeposit || undefined,
      deposit_paid:   cDepositPaid,
      notes:          cNotes.trim() || undefined,
      items:          cItems,
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
    const data: UpdatePreOrderPayload = {
      order_date:     eOrderDate || undefined,
      due_date:       eDueDate   || undefined,
      customer_name:  eName.trim()  || null,
      customer_phone: ePhone.trim() || null,
      deposit_amount: eDeposit   || undefined,
      deposit_paid:   eDepositPaid,
      notes:          eNotes.trim() || undefined,
    };
    try {
      await updateMut.mutateAsync({ id: selectedId, data });
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
        item: { product_id: addItemProductId, quantity: addItemQty, unit_price: addItemPrice.trim() || undefined },
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
      const raw = err instanceof Error ? err.message : '';
      // Backend returns 422 INSUFFICIENT_INGREDIENTS when a FROM_INVENTORY item
      // has shortfall that raw ingredients can't cover.
      const isInsufficient = /INSUFFICIENT_INGREDIENTS/i.test(raw) || /ingredient/i.test(raw);
      toast({
        kind: 'danger',
        title: 'เริ่มผลิตไม่สำเร็จ',
        msg: isInsufficient
          ? 'วัตถุดิบไม่พอสำหรับรายการที่ตั้งเป็น "ใช้สต็อกสำเร็จรูป" — เช็คแท็บวัตถุดิบและพิจารณาเปลี่ยนเป็น "ผลิตใหม่"'
          : (raw || undefined),
      });
    }
  };

  const handleSetFulfillmentMode = async (itemId: string, mode: FulfillmentMode) => {
    if (!selectedId) return;
    setSettingFulfillmentItemId(itemId);
    try {
      await setFulfillmentMut.mutateAsync({ orderId: selectedId, itemId, mode });
      toast({
        kind: 'success',
        title: mode === 'FROM_INVENTORY' ? 'ตั้งเป็น: ใช้สต็อกสำเร็จรูป' : 'ตั้งเป็น: ผลิตใหม่',
      });
    } catch (err) {
      toast({ kind: 'danger', title: 'ตั้งโหมดไม่สำเร็จ', msg: err instanceof Error ? err.message : undefined });
    } finally {
      setSettingFulfillmentItemId(null);
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

  const addCreateItem = () => {
    if (!cItemProductId) return;
    setCItems(prev => [...prev, {
      product_id: cItemProductId,
      quantity:   cItemQty,
      unit_price: cItemPrice.trim() || undefined,
    }]);
    setCItemProductId(''); setCItemProductSearch(''); setCItemQty(1); setCItemPrice('');
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const filterPills: { label: string; value: PreOrderStatus | undefined }[] = [
    { label: 'ทั้งหมด',     value: undefined },
    { label: 'Pending',    value: 'PENDING' },
    { label: 'In Progress',value: 'IN_PROGRESS' },
    { label: 'Completed',  value: 'COMPLETED' },
    { label: 'Cancelled',  value: 'CANCELLED' },
  ];

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* ── Left column: filter + list ── */}
      <div style={{ width: 380, flexShrink: 0, borderRight: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--color-bg)' }}>
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
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {filterPills.map(pill => (
              <button
                key={String(pill.value)}
                onClick={() => { setStatusFilter(pill.value); setSelectedId(null); }}
                style={{
                  padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 500,
                  cursor: 'pointer', border: '1px solid',
                  borderColor: statusFilter === pill.value ? 'var(--color-primary)' : 'var(--color-border)',
                  background:  statusFilter === pill.value ? 'var(--color-accent-50)' : 'transparent',
                  color:       statusFilter === pill.value ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                }}
              >
                {pill.label}
              </button>
            ))}
          </div>
        </div>

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
                onClick={() => {
                  setSelectedId(item.id);
                  setDetailTab('details');
                  setAddItemOpen(false);
                  setAddItemProductId('');
                  setAddItemProductSearch('');
                  setAddItemQty(1);
                  setAddItemPrice('');
                }}
              />
            ))
          )}
        </div>
      </div>

      {/* ── Right column: detail ── */}
      <div style={{ flex: 1, overflow: 'auto', background: 'var(--color-bg)' }}>
        {!selectedId ? (
          <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: 'var(--color-text-secondary)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
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
            onTabChange={setDetailTab}
            threshold={threshold}
            onThresholdChange={setThreshold}
            ingredients={ingredients}
            addItemOpen={addItemOpen}
            onAddItemToggle={() => setAddItemOpen(v => !v)}
            addItemProductId={addItemProductId}
            addItemProductSearch={addItemProductSearch}
            onAddItemProductSearch={s => { setAddItemProductSearch(s); setAddItemProductId(''); }}
            onAddItemProductSelect={(id, name) => { setAddItemProductId(id); setAddItemProductSearch(name); }}
            addItemQty={addItemQty}
            onAddItemQtyChange={setAddItemQty}
            addItemPrice={addItemPrice}
            onAddItemPriceChange={setAddItemPrice}
            allProducts={allProducts}
            inventoryItems={inventoryItems}
            onAddItem={handleAddItem}
            onCancelAddItem={() => { setAddItemOpen(false); setAddItemProductId(''); setAddItemProductSearch(''); setAddItemQty(1); setAddItemPrice(''); }}
            onRemoveItem={handleRemoveItem}
            onSetFulfillmentMode={handleSetFulfillmentMode}
            settingFulfillmentItemId={settingFulfillmentItemId}
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

      {/* ── Modals ── */}
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
          onRemoveItem={idx => setCItems(prev => prev.filter((_, i) => i !== idx))}
          cItemProductId={cItemProductId}
          cItemProductSearch={cItemProductSearch}
          onItemProductSearch={s => { setCItemProductSearch(s); setCItemProductId(''); }}
          onItemProductSelect={(id, name) => { setCItemProductId(id); setCItemProductSearch(name); }}
          cItemQty={cItemQty} onItemQtyChange={setCItemQty}
          cItemPrice={cItemPrice} onItemPriceChange={setCItemPrice}
          onConfirm={handleCreate}
          onClose={resetCreateForm}
          isPending={createMut.isPending}
        />
      )}

      {editOpen && detail && (
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

// ── Sub-components ────────────────────────────────────────────────────────────

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
      <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
          ส่ง: <strong style={{ color: 'var(--color-text)' }}>{fmtDate(item.dueDate)}</strong>
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{item.itemCount} รายการ</div>
      </div>
    </div>
  );
}

function DetailPanel({
  detail, tab, onTabChange, threshold, onThresholdChange, ingredients,
  addItemOpen, onAddItemToggle,
  addItemProductId, addItemProductSearch, onAddItemProductSearch, onAddItemProductSelect,
  addItemQty, onAddItemQtyChange, addItemPrice, onAddItemPriceChange,
  allProducts, inventoryItems, onAddItem, onCancelAddItem, onRemoveItem,
  onSetFulfillmentMode, settingFulfillmentItemId,
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
  allProducts: MenuItem[];
  inventoryItems: InventoryItem[];
  onAddItem: () => void;
  onCancelAddItem: () => void;
  onRemoveItem: (itemId: string) => void;
  onSetFulfillmentMode: (itemId: string, mode: FulfillmentMode) => void;
  settingFulfillmentItemId: string | null;
  onEdit: () => void;
  onStart: () => void;
  onComplete: () => void;
  onCancel: () => void;
  onAddToShoppingList: (inventoryItemId: string, name: string) => void;
  startPending: boolean;
  completePending: boolean;
  cancelPending: boolean;
}) {
  const [addSearchFocused, setAddSearchFocused] = useState(false);
  const isPending = detail.status === 'PENDING';
  const totalStr = detail.items.reduce((s, it) => s + Number(it.lineTotal), 0).toFixed(2);
  const filteredProducts = addItemProductSearch
    ? allProducts.filter(p => p.name.toLowerCase().includes(addItemProductSearch.toLowerCase()))
    : allProducts;
  const showAddDropdown = addSearchFocused && filteredProducts.length > 0;

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
      <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)', marginBottom: 20 }}>
        {(['details', 'ingredients'] as const).map(t => (
          <button key={t} onClick={() => onTabChange(t)} style={{
            padding: '8px 16px', fontSize: 13, fontWeight: 500, cursor: 'pointer',
            border: 'none', background: 'transparent', marginBottom: -1,
            borderBottom: tab === t ? '2px solid var(--color-primary)' : '2px solid transparent',
            color: tab === t ? 'var(--color-primary)' : 'var(--color-text-secondary)',
          }}>
            {t === 'details' ? 'รายละเอียด' : 'วัตถุดิบ'}
          </button>
        ))}
      </div>

      {/* Details tab */}
      {tab === 'details' && (
        <>
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
              <div>
                ฿{fmtMoney(detail.depositAmount)}{' '}
                {detail.depositPaid
                  ? <span style={{ color: 'var(--color-success)', fontSize: 11, fontWeight: 600 }}>✓ รับแล้ว</span>
                  : <span style={{ color: 'var(--color-text-secondary)', fontSize: 11 }}>ยังไม่รับ</span>
                }
              </div>
            </div>
            {detail.notes && (
              <div style={{ gridColumn: '1/-1' }}>
                <div style={{ color: 'var(--color-text-secondary)', fontSize: 11, fontWeight: 500, marginBottom: 2 }}>หมายเหตุ</div>
                <div>{detail.notes}</div>
              </div>
            )}
          </div>

          {/* Items table */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>รายการสินค้า</div>
              {isPending && (
                <button onClick={onAddItemToggle} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}>
                  <Icon name="plus" size={13} />เพิ่มสินค้า
                </button>
              )}
            </div>
            <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px 90px 90px 32px', padding: '8px 12px', background: 'var(--color-surface-2)', fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', gap: 8 }}>
                <div>สินค้า</div><div style={{ textAlign: 'right' }}>จำนวน</div><div style={{ textAlign: 'right' }}>ราคา/ชิ้น</div><div style={{ textAlign: 'right' }}>รวม</div><div/>
              </div>
              {detail.items.map(it => {
                const product = it.productId ? allProducts.find(p => p.id === it.productId) : undefined;
                const isProduced = product?.productType === 'PRODUCED';
                const fgInv = isProduced && product?.finishedGoodsItemId
                  ? inventoryItems.find(i => i.id === product.finishedGoodsItemId)
                  : undefined;
                return (
                  <div key={it.id}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px 90px 90px 32px', padding: '10px 12px', borderTop: '1px solid var(--color-border)', fontSize: 13, gap: 8, alignItems: 'center' }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.productName}</div>
                      <div style={{ textAlign: 'right' }}>{it.quantity}</div>
                      <div style={{ textAlign: 'right' }}>฿{Number(it.unitPrice).toFixed(2)}</div>
                      <div style={{ textAlign: 'right', fontWeight: 500 }}>฿{Number(it.lineTotal).toFixed(2)}</div>
                      <div style={{ display: 'grid', placeItems: 'center' }}>
                        {isPending && (
                          <button onClick={() => onRemoveItem(it.id)} style={{ width: 22, height: 22, borderRadius: 4, border: '1px solid var(--color-border)', background: 'transparent', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
                            <Icon name="x" size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                    {isProduced && (
                      <FulfillmentRow
                        mode={it.fulfillmentMode}
                        quantity={it.quantity}
                        fgStock={fgInv ? fgInv.stock : null}
                        fgUnit={fgInv ? fgInv.unit : 'ชิ้น'}
                        canEdit={isPending}
                        saving={settingFulfillmentItemId === it.id}
                        onChange={(mode) => onSetFulfillmentMode(it.id, mode)}
                      />
                    )}
                  </div>
                );
              })}
              {/* Add item inline row */}
              {isPending && addItemOpen && (
                <div style={{ padding: '10px 12px', borderTop: '1px solid var(--color-border)', background: 'var(--color-surface)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ position: 'relative', flex: 2, minWidth: 160 }}>
                    <input placeholder="ค้นหาสินค้า..." value={addItemProductSearch} onChange={e => onAddItemProductSearch(e.target.value)}
                      onFocus={() => setAddSearchFocused(true)}
                      onBlur={() => setTimeout(() => setAddSearchFocused(false), 150)}
                      style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid var(--color-border)', fontSize: 12, background: 'var(--color-bg)', boxSizing: 'border-box' }}
                    />
                    {showAddDropdown && (
                      <div onMouseDown={e => e.preventDefault()} style={{ position: 'absolute', top: '100%', left: 0, right: 0, border: '1px solid var(--color-border)', borderRadius: 6, background: 'var(--color-surface)', zIndex: 20, maxHeight: 150, overflowY: 'auto', marginTop: 2, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
                        {filteredProducts.slice(0, 6).map(p => (
                          <div key={p.id} onMouseDown={() => { onAddItemProductSelect(p.id, p.name); setAddSearchFocused(false); }} style={{ padding: '6px 10px', cursor: 'pointer', fontSize: 12, borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between' }}>
                            <span>{p.name}</span><span style={{ color: 'var(--color-text-secondary)' }}>฿{p.price.toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <input type="number" min={1} placeholder="จำนวน" value={addItemQty} onChange={e => onAddItemQtyChange(Math.max(1, Number(e.target.value) || 1))}
                    style={{ width: 60, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--color-border)', fontSize: 12 }}
                  />
                  <input type="number" min={0} placeholder="ราคา (ว่าง=ตามสินค้า)" value={addItemPrice} onChange={e => onAddItemPriceChange(e.target.value)}
                    style={{ width: 130, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--color-border)', fontSize: 12 }}
                  />
                  <button onClick={onAddItem} disabled={!addItemProductId}
                    style={{ padding: '6px 12px', borderRadius: 6, border: 'none', background: 'var(--color-primary)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: addItemProductId ? 'pointer' : 'not-allowed', opacity: addItemProductId ? 1 : 0.5 }}>
                    เพิ่ม
                  </button>
                  <button onClick={onCancelAddItem} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--color-border)', background: 'transparent', fontSize: 12, cursor: 'pointer' }}>ยกเลิก</button>
                </div>
              )}
              {/* Total */}
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
                <button onClick={onEdit} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>แก้ไข</button>
                <button onClick={onStart} disabled={startPending}
                  style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: 'var(--color-primary)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: startPending ? 0.7 : 1 }}>
                  {startPending ? 'กำลังเริ่ม...' : 'เริ่มผลิต'}
                </button>
                <button onClick={onCancel} disabled={cancelPending}
                  style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--color-danger)', color: 'var(--color-danger)', background: 'transparent', fontSize: 13, fontWeight: 500, cursor: 'pointer', opacity: cancelPending ? 0.7 : 1 }}>
                  ยกเลิก
                </button>
              </>
            )}
            {detail.status === 'IN_PROGRESS' && (
              <button onClick={onComplete} disabled={completePending}
                style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: 'var(--color-success)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: completePending ? 0.7 : 1 }}>
                {completePending ? 'กำลังบันทึก...' : '✓ ส่งมอบแล้ว'}
              </button>
            )}
            {(detail.status === 'COMPLETED' || detail.status === 'CANCELLED') && (
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', padding: '8px 0' }}>
                {detail.status === 'COMPLETED'
                  ? `ส่งมอบแล้ว${detail.completedAt ? ' — ' + fmtDate(detail.completedAt.split('T')[0]) : ''}`
                  : 'ถูกยกเลิก'}
              </div>
            )}
          </div>
        </>
      )}

      {/* Ingredients tab */}
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

function FulfillmentRow({ mode, quantity, fgStock, fgUnit, canEdit, saving, onChange }: {
  mode: FulfillmentMode | null;
  quantity: number;
  fgStock: number | null;
  fgUnit: string;
  canEdit: boolean;
  saving: boolean;
  onChange: (mode: FulfillmentMode) => void;
}) {
  // null treated as PRODUCE_FRESH per backend semantics
  const effectiveMode: FulfillmentMode = mode ?? 'PRODUCE_FRESH';
  const stockCovers = fgStock !== null && fgStock >= quantity;
  const shortfall = fgStock !== null ? Math.max(0, quantity - fgStock) : null;

  const Pill = ({ value, label }: { value: FulfillmentMode; label: string }) => {
    const active = effectiveMode === value;
    return (
      <button
        type="button"
        onClick={() => !active && !saving && canEdit && onChange(value)}
        disabled={!canEdit || saving}
        style={{
          padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600,
          border: '1px solid', cursor: !canEdit || saving ? 'default' : 'pointer',
          borderColor: active ? 'var(--color-primary)' : 'var(--color-border)',
          background: active ? 'var(--color-primary)' : 'transparent',
          color: active ? '#fff' : 'var(--color-text-secondary)',
          transition: 'all 120ms',
          opacity: !canEdit ? 0.7 : 1,
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <div style={{
      padding: '6px 12px 10px 24px', borderTop: '1px dashed var(--color-border)',
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      background: 'var(--color-surface-2)', fontSize: 12,
    }}>
      <span style={{ color: 'var(--color-text-secondary)', fontWeight: 500 }}>วิธีจัดเตรียม:</span>
      <div style={{ display: 'flex', gap: 6 }}>
        <Pill value="FROM_INVENTORY" label="ใช้สต็อกสำเร็จรูป" />
        <Pill value="PRODUCE_FRESH" label="ผลิตใหม่" />
      </div>
      {saving && <span style={{ color: 'var(--color-text-secondary)', fontSize: 11 }}>กำลังบันทึก...</span>}
      {fgStock !== null && (
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--color-text-secondary)' }}>
          สต็อกพร้อมขาย:
          <strong style={{ color: stockCovers ? 'var(--color-success)' : 'var(--color-warning)', fontWeight: 700 }}>
            {fgStock.toLocaleString()} {fgUnit}
          </strong>
          {effectiveMode === 'FROM_INVENTORY' && shortfall !== null && shortfall > 0 && (
            <span style={{ color: '#9C6A1F' }}>· ขาด {shortfall} → จะหักวัตถุดิบ</span>
          )}
        </span>
      )}
      {fgStock === null && effectiveMode === 'FROM_INVENTORY' && (
        <span style={{ color: 'var(--color-danger)', fontSize: 11 }}>* ไม่พบสต็อกสำเร็จรูป</span>
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, padding: '10px 14px', background: 'var(--color-surface)', borderRadius: 8, border: '1px solid var(--color-border)' }}>
        <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>Threshold: {threshold}%</label>
        <input type="range" min={0} max={100} value={threshold} onChange={e => onThresholdChange(Number(e.target.value))} style={{ flex: 1 }} />
      </div>
      {ingredients.items.length === 0 ? (
        <div style={{ color: 'var(--color-text-secondary)', fontSize: 13, textAlign: 'center', padding: 32 }}>ไม่มีวัตถุดิบ (สินค้าในออเดอร์อาจไม่มี recipe)</div>
      ) : (
        <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 90px 70px 100px', padding: '8px 12px', background: 'var(--color-surface-2)', fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', gap: 8 }}>
            <div>วัตถุดิบ</div><div style={{ textAlign: 'right' }}>ต้องการ</div><div style={{ textAlign: 'right' }}>สต็อก</div><div style={{ textAlign: 'right' }}>ใช้%</div><div/>
          </div>
          {ingredients.items.map(line => (
            <div key={line.inventoryItemId} style={{
              display: 'grid', gridTemplateColumns: '1fr 90px 90px 70px 100px',
              padding: '10px 12px', borderTop: '1px solid var(--color-border)', gap: 8, alignItems: 'center',
              background: line.exceedsThreshold ? '#FFF5F5' : 'transparent',
            }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{line.name}</div>
                <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{line.unit}</div>
              </div>
              <div style={{ textAlign: 'right', fontSize: 13 }}>{Number(line.qtyNeeded).toFixed(3)}</div>
              <div style={{ textAlign: 'right', fontSize: 13 }}>{Number(line.stockOnHand).toFixed(3)}</div>
              <div style={{ textAlign: 'right', fontSize: 13 }}>
                {line.usagePct !== null
                  ? <span style={{ color: line.exceedsThreshold ? 'var(--color-danger)' : 'inherit', fontWeight: line.exceedsThreshold ? 600 : 400 }}>{line.usagePct.toFixed(1)}%</span>
                  : <span style={{ color: 'var(--color-text-secondary)' }}>—</span>
                }
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                {line.onShoppingList ? (
                  <span style={{ fontSize: 11, color: 'var(--color-text-secondary)', padding: '3px 8px', borderRadius: 999, background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>มีแล้ว</span>
                ) : (
                  <button onClick={() => onAddToShoppingList(line.inventoryItemId, line.name)}
                    style={{ fontSize: 11, color: 'var(--color-primary)', padding: '3px 8px', borderRadius: 999, background: 'var(--color-accent-50)', border: '1px solid var(--color-primary)', cursor: 'pointer', fontWeight: 500 }}>
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
  onConfirm: () => void; onClose: () => void; isPending: boolean;
}) {
  const [searchFocused, setSearchFocused] = useState(false);
  const filtered = cItemProductSearch
    ? allProducts.filter(p => p.name.toLowerCase().includes(cItemProductSearch.toLowerCase()))
    : allProducts;
  const showDropdown = searchFocused && filtered.length > 0;
  const nameById = (id: string) => allProducts.find(p => p.id === id)?.name ?? id;

  // ── Member lookup: type a full phone → find & auto-fill the member's name ──
  const lookup = useLookupMember();
  const [foundMember, setFoundMember] = useState<AccountRead | null>(null);
  const [lookupTried, setLookupTried] = useState(false);
  useEffect(() => {
    const digits = cPhone.replace(/\D/g, '');
    let cancelled = false;
    const t = setTimeout(() => {
      if (cancelled) return;
      if (digits.length < 9) { setFoundMember(null); setLookupTried(false); return; }
      lookup.mutateAsync(cPhone.trim())
        .then(res => {
          if (cancelled) return;
          const acc = res.found ? res.account : null;
          setFoundMember(acc);
          setLookupTried(true);
          if (acc && !cName.trim()) onNameChange(acc.customer_name); // auto-fill when name is blank
        })
        .catch(() => { if (!cancelled) { setFoundMember(null); setLookupTried(true); } });
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [cPhone]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: 'var(--color-bg)', borderRadius: 16, width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ padding: '20px 24px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>สร้าง Pre-Order ใหม่</div>
          <button onClick={onClose} disabled={isPending} style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid var(--color-border)', background: 'transparent', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
            <Icon name="x" size={16} />
          </button>
        </div>
        <div style={{ padding: '0 24px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Customer */}
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
                {lookup.isPending ? (
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>กำลังค้นหาสมาชิก...</div>
                ) : foundMember ? (
                  <button
                    type="button"
                    onClick={() => onNameChange(foundMember.customer_name)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, width: '100%',
                      padding: '6px 10px', borderRadius: 7, cursor: 'pointer', textAlign: 'left',
                      border: '1px solid var(--color-success)', background: 'var(--color-success-50, #F0FDF4)',
                      color: 'var(--color-success)', fontSize: 12, fontWeight: 600,
                    }}
                  >
                    <Icon name="user" size={13} />
                    <span style={{ flex: 1 }}>
                      พบสมาชิก: {foundMember.customer_name} • {foundMember.points_balance.toLocaleString()} แต้ม
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 500, opacity: 0.85 }}>กดเพื่อกรอกชื่อ</span>
                  </button>
                ) : lookupTried ? (
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>ไม่พบสมาชิก — กรอกชื่อเอง</div>
                ) : null}
              </div>
            </div>
          </section>
          {/* Order info */}
          <section>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>ข้อมูลออเดอร์</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div><label style={labelStyle}>วันที่สั่ง</label><input type="date" value={cOrderDate} onChange={e => onOrderDateChange(e.target.value)} style={inputStyle} /></div>
              <div><label style={labelStyle}>กำหนดส่ง *</label><input type="date" value={cDueDate} onChange={e => onDueDateChange(e.target.value)} style={inputStyle} /></div>
              <div><label style={labelStyle}>มัดจำ (บาท)</label><input type="number" min={0} value={cDeposit} onChange={e => onDepositChange(e.target.value)} placeholder="0.00" style={inputStyle} /></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 18 }}>
                <input type="checkbox" id="cDepositPaid" checked={cDepositPaid} onChange={e => onDepositPaidChange(e.target.checked)} style={{ width: 15, height: 15 }} />
                <label htmlFor="cDepositPaid" style={{ fontSize: 13, cursor: 'pointer' }}>รับมัดจำแล้ว</label>
              </div>
            </div>
            <div style={{ marginTop: 10 }}>
              <label style={labelStyle}>หมายเหตุ</label>
              <textarea value={cNotes} onChange={e => onNotesChange(e.target.value)} rows={2} placeholder="เพิ่มเติม..." style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
            </div>
          </section>
          {/* Items */}
          <section>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>รายการสินค้า</div>
            {cItems.length > 0 && (
              <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, overflow: 'hidden', marginBottom: 10 }}>
                {cItems.map((ci, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: idx < cItems.length - 1 ? '1px solid var(--color-border)' : 'none', fontSize: 13 }}>
                    <div style={{ flex: 1 }}>{nameById(ci.product_id)}</div>
                    <div style={{ color: 'var(--color-text-secondary)' }}>×{ci.quantity}</div>
                    <div style={{ fontWeight: 500 }}>
                      ฿{((ci.unit_price ? Number(ci.unit_price) : (allProducts.find(p => p.id === ci.product_id)?.price ?? 0)) * ci.quantity).toFixed(2)}
                    </div>
                    <button onClick={() => onRemoveItem(idx)} style={{ width: 22, height: 22, borderRadius: 4, border: '1px solid var(--color-border)', background: 'transparent', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
                      <Icon name="x" size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ flex: 2, minWidth: 160, position: 'relative' }}>
                <label style={labelStyle}>สินค้า</label>
                <input placeholder="ค้นหาสินค้า..." value={cItemProductSearch} onChange={e => onItemProductSearch(e.target.value)}
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
                  style={inputStyle} />
                {showDropdown && (
                  <div onMouseDown={e => e.preventDefault()} style={{ position: 'absolute', top: '100%', left: 0, right: 0, border: '1px solid var(--color-border)', borderRadius: 6, background: 'var(--color-surface)', zIndex: 20, maxHeight: 150, overflowY: 'auto', marginTop: 2, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
                    {filtered.slice(0, 6).map(p => (
                      <div key={p.id} onMouseDown={() => { onItemProductSelect(p.id, p.name); setSearchFocused(false); }} style={{ padding: '7px 10px', cursor: 'pointer', fontSize: 12, borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between' }}>
                        <span>{p.name}</span><span style={{ color: 'var(--color-text-secondary)' }}>฿{p.price.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ width: 70 }}><label style={labelStyle}>จำนวน</label><input type="number" min={1} value={cItemQty} onChange={e => onItemQtyChange(Math.max(1, Number(e.target.value) || 1))} style={inputStyle} /></div>
              <div style={{ width: 110 }}><label style={labelStyle}>ราคา (ว่าง=catalog)</label><input type="number" min={0} value={cItemPrice} onChange={e => onItemPriceChange(e.target.value)} placeholder="ปกติ" style={inputStyle} /></div>
              <button onClick={onAddItem} disabled={!cItemProductId}
                style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: 'var(--color-primary)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: cItemProductId ? 'pointer' : 'not-allowed', opacity: cItemProductId ? 1 : 0.5, marginBottom: 1 }}>
                + เพิ่ม
              </button>
            </div>
          </section>
          {/* Footer */}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 8, borderTop: '1px solid var(--color-border)' }}>
            <button onClick={onClose} disabled={isPending} style={{ padding: '9px 18px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface)', fontSize: 13, cursor: 'pointer' }}>ยกเลิก</button>
            <button onClick={onConfirm} disabled={isPending} style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: 'var(--color-primary)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: isPending ? 'not-allowed' : 'pointer', opacity: isPending ? 0.7 : 1 }}>
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
      <div style={{ background: 'var(--color-bg)', borderRadius: 16, width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto' as const, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ padding: '20px 24px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>แก้ไข Pre-Order</div>
          <button onClick={onClose} disabled={isPending} style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid var(--color-border)', background: 'transparent', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
            <Icon name="x" size={16} />
          </button>
        </div>
        <div style={{ padding: '0 24px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div><label style={labelStyle}>ชื่อลูกค้า</label><input value={eName} onChange={e => onNameChange(e.target.value)} maxLength={120} style={inputStyle} /></div>
            <div><label style={labelStyle}>เบอร์โทร</label><input value={ePhone} onChange={e => onPhoneChange(e.target.value)} maxLength={30} style={inputStyle} /></div>
            <div><label style={labelStyle}>วันที่สั่ง</label><input type="date" value={eOrderDate} onChange={e => onOrderDateChange(e.target.value)} style={inputStyle} /></div>
            <div><label style={labelStyle}>กำหนดส่ง</label><input type="date" value={eDueDate} onChange={e => onDueDateChange(e.target.value)} style={inputStyle} /></div>
            <div><label style={labelStyle}>มัดจำ (บาท)</label><input type="number" min={0} value={eDeposit} onChange={e => onDepositChange(e.target.value)} style={inputStyle} /></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 18 }}>
              <input type="checkbox" id="eDepositPaid" checked={eDepositPaid} onChange={e => onDepositPaidChange(e.target.checked)} style={{ width: 15, height: 15 }} />
              <label htmlFor="eDepositPaid" style={{ fontSize: 13, cursor: 'pointer' }}>รับมัดจำแล้ว</label>
            </div>
          </div>
          <div><label style={labelStyle}>หมายเหตุ</label><textarea value={eNotes} onChange={e => onNotesChange(e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} /></div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 8, borderTop: '1px solid var(--color-border)' }}>
            <button onClick={onClose} disabled={isPending} style={{ padding: '9px 18px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface)', fontSize: 13, cursor: 'pointer' }}>ยกเลิก</button>
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
          <button onClick={onConfirm} style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: dangerous ? 'var(--color-danger)' : 'var(--color-primary)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
