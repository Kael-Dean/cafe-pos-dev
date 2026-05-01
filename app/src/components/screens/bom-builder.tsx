'use client';

import { useState, useEffect } from 'react';
import Icon from '../icons';
import { useToast, Tag, baht } from '../app-common';
import { useAllProducts, useCategories, useCreateProduct, type MenuItem } from '@/hooks/use-products';
import { useInventory, type InventoryItem } from '@/hooks/use-inventory';
import { useProductDetail, useUpdateRecipe, type RecipeItem } from '@/hooks/use-bom';

export default function BOMBuilder() {
  const toast = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [picker, setPicker] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);

  const [editedRecipe, setEditedRecipe] = useState<RecipeItem[]>([]);
  const [editedPrice, setEditedPrice] = useState(0);

  const { data: products, isLoading: productsLoading } = useAllProducts();
  const { data: categories } = useCategories();
  const { data: inventoryItems } = useInventory();
  const { data: productDetail, isLoading: detailLoading } = useProductDetail(selectedId);
  const updateRecipe = useUpdateRecipe();
  const createProduct = useCreateProduct();

  // Auto-select first product
  useEffect(() => {
    if (!selectedId && products?.[0]) {
      setSelectedId(products[0].id);
    }
  }, [products, selectedId]);

  // Sync recipe + price from API when product changes
  useEffect(() => {
    if (productDetail) {
      setEditedRecipe(productDetail.recipe.map(r => ({ ...r })));
      setEditedPrice(productDetail.price);
    }
  }, [productDetail]);

  const computeCost = (items: RecipeItem[]) => items.reduce((s, r) => {
    const inv = inventoryItems?.find(i => i.id === r.invId);
    return s + (inv ? inv.costPerUnit * r.qty : 0);
  }, 0);

  const selectedProduct = products?.find(m => m.id === selectedId);
  const totalCost = computeCost(editedRecipe);
  const margin = editedPrice - totalCost;
  const marginPct = editedPrice > 0 ? (margin / editedPrice) * 100 : 0;

  const updateQty = (idx: number, qty: number) => setEditedRecipe(r => {
    const next = [...r];
    next[idx] = { ...next[idx], qty: Math.max(0, qty) };
    return next;
  });

  const removeItem = (idx: number) => setEditedRecipe(r => r.filter((_, i) => i !== idx));

  const addItem = (invId: string) => {
    setEditedRecipe(r => [...r, { invId, qty: 1 }]);
    setPicker(false);
    toast({ kind: 'info', title: 'เพิ่มวัตถุดิบแล้ว', msg: 'ปรับปริมาณตามสูตรจริง' });
  };

  const saveRecipe = async () => {
    if (!selectedId) return;
    try {
      await updateRecipe.mutateAsync({ productId: selectedId, items: editedRecipe });
      toast({ kind: 'success', title: 'บันทึกสูตรแล้ว', msg: `${selectedProduct?.name ?? ''} • ${editedRecipe.length} วัตถุดิบ • ต้นทุน ฿${totalCost.toFixed(2)} • Margin ${marginPct.toFixed(1)}%` });
    } catch (err) {
      toast({ kind: 'warning', title: 'บันทึกไม่สำเร็จ', msg: err instanceof Error ? err.message : 'กรุณาลองใหม่' });
    }
  };

  const submitAddMenu = async ({ name, categoryId, price, description }: { name: string; categoryId: string; price: number; description: string }) => {
    try {
      const created = await createProduct.mutateAsync({ name, category_id: categoryId || undefined, price, description: description || undefined });
      setAddMenuOpen(false);
      setSelectedId(created.id);
      toast({ kind: 'success', title: 'เพิ่มเมนูแล้ว', msg: `${name} ถูกเพิ่มแล้ว` });
    } catch (err) {
      toast({ kind: 'warning', title: 'เกิดข้อผิดพลาด', msg: err instanceof Error ? err.message : 'กรุณาลองใหม่' });
    }
  };

  const filteredProducts = (products ?? []).filter(m =>
    !search || m.name.includes(search) || m.nameEn.toLowerCase().includes(search.toLowerCase())
  );
  const marginColorOf = (pct: number) => pct >= 65 ? 'var(--color-success)' : pct >= 50 ? '#9C6A1F' : 'var(--color-danger)';
  const marginToneOf = (pct: number): 'success' | 'warning' | 'danger' => pct >= 65 ? 'success' : pct >= 50 ? 'warning' : 'danger';

  return (
    <div style={{ display: 'flex', height: '100%', background: 'var(--color-bg)' }}>
      {/* LEFT sidebar */}
      <div style={{ width: 320, flexShrink: 0, background: 'var(--color-surface)', borderRight: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid var(--color-border)' }}>
          <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 4 }}>P1 — Inventory</div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: '-0.01em' }}>BOM Builder</h2>
            <button onClick={() => setAddMenuOpen(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 10px', fontSize: 11, fontWeight: 600, background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', transition: 'background 150ms var(--ease-out)', flexShrink: 0 }} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-primary-700)'} onMouseLeave={e => e.currentTarget.style.background = 'var(--color-primary)'}><Icon name="plus" size={12} /> เพิ่มเมนู</button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 4 }}>สูตรอาหาร · ต้นทุน · margin</div>
        </div>
        <div style={{ padding: 12, borderBottom: '1px solid var(--color-border)', position: 'relative' }}>
          <div style={{ position: 'absolute', left: 24, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', display: 'grid', placeItems: 'center' }}>
            <Icon name="search" size={16} color="var(--color-text-muted)" />
          </div>
          <input type="text" placeholder="ค้นหาเมนู..." value={search} onChange={e => setSearch(e.target.value)}
            style={{ width: '100%', padding: '10px 12px 10px 36px', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
          />
        </div>
        <div className="scroll" style={{ overflow: 'auto', flex: 1, padding: 8 }}>
          {productsLoading ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>กำลังโหลด...</div>
          ) : filteredProducts.map(m => {
            const isActive = m.id === selectedId;
            return (
              <button key={m.id} onClick={() => setSelectedId(m.id)} style={{
                display: 'flex', gap: 12, alignItems: 'center', width: '100%', padding: 10, marginBottom: 2, borderRadius: 8,
                background: isActive ? 'var(--color-accent-50)' : 'transparent',
                border: isActive ? '1px solid var(--color-accent)' : '1px solid transparent',
                cursor: 'pointer', textAlign: 'left', transition: 'all 150ms var(--ease-out)',
              }}
                onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--color-surface-2)'; }}
                onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
              >
                <div style={{ width: 40, height: 40, borderRadius: 8, background: m.color, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{m.tag}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name}</div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 3 }}>
                    <span className="num" style={{ fontSize: 11, color: 'var(--color-text-secondary)', fontWeight: 600 }}>{baht(m.price)}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* RIGHT panel */}
      <div className="scroll" style={{ flex: 1, overflow: 'auto', padding: 24 }}>
        {!selectedProduct ? (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--color-text-muted)' }}>เลือกเมนูจากรายการด้านซ้าย</div>
        ) : detailLoading ? (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--color-text-muted)' }}>กำลังโหลดสูตร...</div>
        ) : (
          <RightPanel
            product={selectedProduct}
            recipe={editedRecipe}
            editedPrice={editedPrice}
            inventoryItems={inventoryItems ?? []}
            totalCost={totalCost}
            margin={margin}
            marginPct={marginPct}
            marginToneOf={marginToneOf}
            marginColorOf={marginColorOf}
            onPriceChange={setEditedPrice}
            onQtyChange={updateQty}
            onRemove={removeItem}
            onPickerOpen={() => setPicker(true)}
            onSave={saveRecipe}
            saving={updateRecipe.isPending}
          />
        )}
      </div>

      {picker && <IngredientPicker existingIds={editedRecipe.map(r => r.invId)} inventory={inventoryItems ?? []} onSelect={addItem} onClose={() => setPicker(false)} />}
      {addMenuOpen && <AddMenuModal categories={categories ?? []} onClose={() => setAddMenuOpen(false)} onSubmit={submitAddMenu} />}
    </div>
  );
}

interface RightPanelProps {
  product: MenuItem;
  recipe: RecipeItem[];
  editedPrice: number;
  inventoryItems: InventoryItem[];
  totalCost: number;
  margin: number;
  marginPct: number;
  marginToneOf: (pct: number) => 'success' | 'warning' | 'danger';
  marginColorOf: (pct: number) => string;
  onPriceChange: (p: number) => void;
  onQtyChange: (idx: number, qty: number) => void;
  onRemove: (idx: number) => void;
  onPickerOpen: () => void;
  onSave: () => void;
  saving: boolean;
}

const RightPanel = ({ product, recipe, editedPrice, inventoryItems, totalCost, margin, marginPct, marginToneOf, marginColorOf, onPriceChange, onQtyChange, onRemove, onPickerOpen, onSave, saving }: RightPanelProps) => (
  <>
    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 24, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 20 }}>
      <div style={{ width: 80, height: 80, borderRadius: 12, background: product.color, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 26, fontWeight: 800, flexShrink: 0 }}>{product.tag}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', fontWeight: 500 }}>{product.nameEn}</div>
        <h1 style={{ margin: '2px 0 8px', fontSize: 24, fontWeight: 700, letterSpacing: '-0.01em' }}>{product.name}</h1>
        <div style={{ display: 'flex', gap: 6 }}>
          <Tag tone={recipe.length > 0 ? 'success' : 'warning'}>{recipe.length > 0 ? `${recipe.length} วัตถุดิบ` : 'ยังไม่มีสูตร'}</Tag>
        </div>
      </div>
      <div>
        <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 6 }}>ราคาขาย</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
          <span style={{ fontSize: 18, color: 'var(--color-text-secondary)' }}>฿</span>
          <input type="number" min={0} step={5} value={editedPrice}
            onChange={e => onPriceChange(Number(e.target.value))}
            className="num"
            style={{ width: 96, fontSize: 30, fontWeight: 700, textAlign: 'right', border: 'none', borderBottom: '2px solid var(--color-border)', outline: 'none', padding: '4px 0', background: 'transparent', fontFamily: 'inherit', letterSpacing: '-0.02em' }}
            onFocus={e => e.target.style.borderBottomColor = 'var(--color-accent)'}
            onBlur={e => e.target.style.borderBottomColor = 'var(--color-border)'}
          />
        </div>
      </div>
    </div>

    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
      <SummaryCard label="ต้นทุนวัตถุดิบ" value={`฿${totalCost.toFixed(2)}`} />
      <SummaryCard label="ส่วนต่าง (Contribution)" value={`฿${margin.toFixed(2)}`} color={margin >= 0 ? 'var(--color-text)' : 'var(--color-danger)'} />
      <SummaryCard label="Margin" value={`${marginPct.toFixed(1)}%`} highlight={marginToneOf(marginPct)} />
    </div>

    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>ส่วนประกอบ (Bill of Materials)</div>
        <button onClick={onPickerOpen} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', fontSize: 13, fontWeight: 600, background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', transition: 'background 150ms var(--ease-out)' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-primary-700)'} onMouseLeave={e => e.currentTarget.style.background = 'var(--color-primary)'}><Icon name="plus" size={14} />เพิ่มวัตถุดิบ</button>
      </div>

      {recipe.length === 0 ? (
        <div style={{ padding: 48, textAlign: 'center' }}>
          <div style={{ width: 56, height: 56, borderRadius: 12, background: 'var(--color-surface-2)', margin: '0 auto 12px', display: 'grid', placeItems: 'center' }}><Icon name="inv" size={28} color="var(--color-text-muted)" /></div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>ยังไม่มีสูตรสำหรับเมนูนี้</div>
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px 70px 100px 90px 36px', gap: 12, padding: '10px 20px', fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', background: 'var(--color-surface-2)', borderBottom: '1px solid var(--color-border)' }}>
            <div>วัตถุดิบ</div><div style={{ textAlign: 'right' }}>ปริมาณ</div><div>หน่วย</div><div style={{ textAlign: 'right' }}>ราคา/หน่วย</div><div style={{ textAlign: 'right' }}>รวม</div><div></div>
          </div>
          {recipe.map((r, idx) => {
            const inv = inventoryItems.find(i => i.id === r.invId);
            if (!inv) return null;
            const lineCost = inv.costPerUnit * r.qty;
            const stockOk = inv.stock >= r.qty * 10;
            return (
              <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 110px 70px 100px 90px 36px', gap: 12, padding: '12px 20px', alignItems: 'center', borderBottom: idx === recipe.length - 1 ? 'none' : '1px solid var(--color-border)' }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{inv.name}</div>
                  <div style={{ fontSize: 11, color: stockOk ? 'var(--color-text-muted)' : 'var(--color-warning)', marginTop: 2 }}>คงเหลือ {inv.stock.toLocaleString()} {inv.unit}{!stockOk && ' · ใกล้หมด'}</div>
                </div>
                <input type="number" step={1} min={0} value={r.qty} onChange={e => onQtyChange(idx, Number(e.target.value))} className="num" style={{ textAlign: 'right', fontSize: 14, fontWeight: 600, border: '1px solid var(--color-border)', borderRadius: 6, padding: '6px 10px', outline: 'none', fontFamily: 'inherit', background: 'var(--color-surface)' }} onFocus={e => e.target.style.borderColor = 'var(--color-accent)'} onBlur={e => e.target.style.borderColor = 'var(--color-border)'} />
                <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{inv.unit}</div>
                <div className="num" style={{ fontSize: 13, color: 'var(--color-text-secondary)', textAlign: 'right' }}>฿{inv.costPerUnit.toFixed(2)}</div>
                <div className="num" style={{ fontSize: 14, fontWeight: 700, textAlign: 'right' }}>฿{lineCost.toFixed(2)}</div>
                <button onClick={() => onRemove(idx)} title="ลบวัตถุดิบ" style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'grid', placeItems: 'center', padding: 6, borderRadius: 6, color: 'var(--color-text-muted)', transition: 'all 150ms var(--ease-out)' }} onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-danger-50)'; e.currentTarget.style.color = 'var(--color-danger)'; }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-muted)'; }}><Icon name="trash" size={14} /></button>
              </div>
            );
          })}
          <div style={{ padding: '14px 20px', display: 'grid', gridTemplateColumns: '1fr 90px 36px', gap: 12, alignItems: 'center', background: 'var(--color-surface-2)', borderTop: '2px solid var(--color-border)' }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>ต้นทุนรวมต่อหน่วยขาย</div>
            <div className="num" style={{ fontSize: 16, fontWeight: 800, textAlign: 'right' }}>฿{totalCost.toFixed(2)}</div>
            <div></div>
          </div>
        </>
      )}
    </div>

    <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
      <button onClick={onSave} disabled={saving} style={{ padding: '10px 20px', fontSize: 14, fontWeight: 600, background: saving ? 'var(--color-surface-2)' : 'var(--color-primary)', color: saving ? 'var(--color-text-muted)' : '#fff', border: 'none', borderRadius: 8, cursor: saving ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'inherit', transition: 'background 150ms var(--ease-out)' }} onMouseEnter={e => { if (!saving) e.currentTarget.style.background = 'var(--color-primary-700)'; }} onMouseLeave={e => { if (!saving) e.currentTarget.style.background = 'var(--color-primary)'; }}>
        <Icon name="check" size={16} />{saving ? 'กำลังบันทึก...' : 'บันทึกสูตร'}
      </button>
    </div>

    <div style={{ marginTop: 24, padding: 16, background: 'var(--color-info-50)', borderRadius: 12, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <Icon name="info" size={20} color="var(--color-info)" />
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-info)', marginBottom: 6 }}>เรื่อง Margin ที่ควรรู้</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.7 }}>
          คาเฟ่ทั่วไปควรมี margin <strong style={{ color: 'var(--color-success)' }}>≥ 65%</strong> สำหรับเครื่องดื่ม และ <strong style={{ color: 'var(--color-success)' }}>≥ 60%</strong> สำหรับเบเกอรี่
        </div>
      </div>
    </div>
  </>
);

const SummaryCard = ({ label, value, color, highlight }: { label: string; value: string; color?: string; highlight?: 'success' | 'warning' | 'danger' }) => {
  const tones = {
    success: { bg: 'var(--color-success-50)', border: 'var(--color-success)', fg: 'var(--color-success)' },
    warning: { bg: 'var(--color-warning-50)', border: 'var(--color-warning)', fg: '#9C6A1F' },
    danger:  { bg: 'var(--color-danger-50)',  border: 'var(--color-danger)',  fg: 'var(--color-danger)' },
  };
  const t = highlight ? tones[highlight] : null;
  return (
    <div style={{ background: t ? t.bg : 'var(--color-surface)', border: t ? `1px solid ${t.border}` : '1px solid var(--color-border)', borderRadius: 12, padding: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: t ? t.fg : 'var(--color-text-secondary)' }}>{label}</div>
      <div className="num" style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', color: t ? t.fg : (color || 'var(--color-text)') }}>{value}</div>
    </div>
  );
};

const IngredientPicker = ({ existingIds, inventory, onSelect, onClose }: { existingIds: string[]; inventory: InventoryItem[]; onSelect: (id: string) => void; onClose: () => void }) => {
  const [q, setQ] = useState('');
  const list = inventory.filter(inv => !q || inv.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(26, 16, 8, 0.55)', display: 'grid', placeItems: 'center', zIndex: 100, padding: 20, animation: 'backdrop-in 200ms var(--ease-out)' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--color-surface)', borderRadius: 16, width: '100%', maxWidth: 520, maxHeight: '75vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 50px rgba(0,0,0,0.25)', animation: 'modal-in 220ms var(--ease-out)' }}>
        <div style={{ padding: 20, borderBottom: '1px solid var(--color-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div><div style={{ fontSize: 16, fontWeight: 700 }}>เลือกวัตถุดิบ</div><div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>{inventory.length} รายการในคลัง</div></div>
            <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 6, borderRadius: 8, display: 'grid', placeItems: 'center' }}><Icon name="x" size={18} /></button>
          </div>
          <div style={{ position: 'relative' }}>
            <div style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', display: 'grid', placeItems: 'center' }}><Icon name="search" size={16} color="var(--color-text-muted)" /></div>
            <input type="text" placeholder="ค้นหาวัตถุดิบ..." autoFocus value={q} onChange={e => setQ(e.target.value)} style={{ width: '100%', padding: '10px 12px 10px 36px', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
          </div>
        </div>
        <div className="scroll" style={{ overflow: 'auto', flex: 1, padding: 8 }}>
          {list.map(inv => {
            const exists = existingIds.includes(inv.id);
            return (
              <button key={inv.id} onClick={() => !exists && onSelect(inv.id)} disabled={exists} style={{ display: 'flex', gap: 12, alignItems: 'center', width: '100%', padding: 12, marginBottom: 2, borderRadius: 8, background: 'transparent', border: '1px solid transparent', cursor: exists ? 'not-allowed' : 'pointer', textAlign: 'left', opacity: exists ? 0.55 : 1, transition: 'background 150ms var(--ease-out)', fontFamily: 'inherit' }} onMouseEnter={e => { if (!exists) e.currentTarget.style.background = 'var(--color-surface-2)'; }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{inv.name}</div>
                  <div className="num" style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>฿{inv.costPerUnit.toFixed(2)}/{inv.unit} · คงเหลือ {inv.stock.toLocaleString()} {inv.unit}</div>
                </div>
                {exists ? <Tag tone="success">เพิ่มแล้ว</Tag> : <Icon name="plus" size={16} color="var(--color-primary)" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// ── Shared modal helpers (mirrors the pattern in inventory.tsx) ───────────────

const bomInputStyle = (): React.CSSProperties => ({
  width: '100%', padding: '10px 12px',
  border: '1px solid var(--color-border)', borderRadius: 8,
  fontSize: 14, fontFamily: 'inherit', outline: 'none',
  boxSizing: 'border-box', background: 'var(--color-surface)',
});

const BomFormField = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div style={{ marginBottom: 14 }}>
    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 6 }}>{label}</div>
    {children}
  </div>
);

const BomModalActions = ({ children }: { children: React.ReactNode }) => (
  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 8, borderTop: '1px solid var(--color-border)', marginTop: 8 }}>{children}</div>
);

const BomModalShell = ({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) => (
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

const AddMenuModal = ({ categories, onClose, onSubmit }: { categories: import('@/hooks/use-products').Category[]; onClose: () => void; onSubmit: (v: { name: string; categoryId: string; price: number; description: string }) => void }) => {
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const canSubmit = name.trim().length > 0 && price !== '' && Number(price) >= 0;
  const submit = () => { if (!canSubmit) return; onSubmit({ name: name.trim(), categoryId, price: Number(price), description: description.trim() }); };
  return (
    <BomModalShell title="เพิ่มเมนูใหม่" subtitle="สร้างรายการเมนูในระบบ" onClose={onClose}>
      <BomFormField label="ชื่อเมนู *"><input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="เช่น Flat White, ครัวซองต์เนย" style={bomInputStyle()} autoFocus /></BomFormField>
      <BomFormField label="หมวดหมู่">
        <select value={categoryId} onChange={e => setCategoryId(e.target.value)} style={{ ...bomInputStyle(), appearance: 'auto' }}>
          <option value="">— ไม่ระบุหมวดหมู่ —</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </BomFormField>
      <BomFormField label="ราคาขาย (฿) *"><input type="number" min={0} step={5} value={price} onChange={e => setPrice(e.target.value)} placeholder="0" style={bomInputStyle()} /></BomFormField>
      <BomFormField label="รายละเอียด"><textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} placeholder="ไม่บังคับ" style={{ ...bomInputStyle(), resize: 'vertical', fontFamily: 'inherit' }} /></BomFormField>
      <BomModalActions>
        <button onClick={onClose} style={{ padding: '10px 16px', fontSize: 13, fontWeight: 600, background: 'transparent', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' }}>ยกเลิก</button>
        <button onClick={submit} disabled={!canSubmit} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 16px', fontSize: 13, fontWeight: 600, background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 8, cursor: canSubmit ? 'pointer' : 'not-allowed', fontFamily: 'inherit', opacity: canSubmit ? 1 : 0.45, transition: 'background 150ms var(--ease-out)' }} onMouseEnter={e => { if (canSubmit) e.currentTarget.style.background = 'var(--color-primary-700)'; }} onMouseLeave={e => { e.currentTarget.style.background = 'var(--color-primary)'; }}><Icon name="plus" size={14} /> เพิ่มเมนู</button>
      </BomModalActions>
    </BomModalShell>
  );
};
