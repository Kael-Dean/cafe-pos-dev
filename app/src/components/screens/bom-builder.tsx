'use client';

import { useState, useEffect } from 'react';
import Icon from '../icons';
import { useToast, Tag, baht } from '../app-common';
import { useAllProducts, useCategories, useCreateProduct, useDeleteProduct, type MenuItem } from '@/hooks/use-products';
import { useInventory, type InventoryItem } from '@/hooks/use-inventory';
import { useProductDetail, useUpdateRecipe, useLinkModifierGroups, type RecipeItem } from '@/hooks/use-bom';
import { useModifierGroups, useCreateModifierGroup, useAddModifier, useDeleteModifier, DEFAULT_DRINK_MODIFIER_GROUPS, type ModifierGroup } from '@/hooks/use-modifier-groups';

type ProductType = 'MENU' | 'INGREDIENT';

export default function BOMBuilder() {
  const toast = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [picker, setPicker] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const [editedRecipe, setEditedRecipe] = useState<RecipeItem[]>([]);
  const [editedPrice, setEditedPrice] = useState(0);
  const [productType, setProductType] = useState<ProductType>('MENU');
  const [modifierGroupPickerOpen, setModifierGroupPickerOpen] = useState(false);

  const { data: products, isLoading: productsLoading } = useAllProducts();
  const { data: categories } = useCategories();
  const { data: inventoryItems } = useInventory();
  const { data: productDetail, isLoading: detailLoading } = useProductDetail(selectedId);
  const updateRecipe = useUpdateRecipe();
  const createProduct = useCreateProduct();
  const deleteProduct = useDeleteProduct();
  const linkModifierGroups = useLinkModifierGroups();
  const createModifierGroup = useCreateModifierGroup();
  const addModifier = useAddModifier();
  const deleteModifier = useDeleteModifier();
  const { data: modifierGroups } = useModifierGroups();

  useEffect(() => {
    if (!selectedId && products?.[0]) {
      setSelectedId(products[0].id);
    }
  }, [products, selectedId]);

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

  const addItems = (invIds: string[]) => {
    setEditedRecipe(r => [...r, ...invIds.map(id => ({ invId: id, qty: 1 }))]);
    setPicker(false);
    toast({ kind: 'info', title: `เพิ่ม ${invIds.length} วัตถุดิบแล้ว`, msg: 'ปรับปริมาณตามสูตรจริง' });
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

  const submitAddMenu = async ({ name, categoryId, price, description, type, isDrink }: { name: string; categoryId: string; price: number; description: string; type: ProductType; isDrink: boolean }) => {
    try {
      const newProduct = await createProduct.mutateAsync({ name, category_id: categoryId || undefined, price, description: description || undefined });
      if (isDrink) {
        let groupIds = (modifierGroups ?? []).map(g => g.id);
        if (groupIds.length === 0) {
          // First drink ever — auto-bootstrap default modifier groups in backend
          const newGroups = await Promise.all(
            DEFAULT_DRINK_MODIFIER_GROUPS.map(g => createModifierGroup.mutateAsync(g))
          );
          groupIds = newGroups.map(g => g.id);
        }
        await linkModifierGroups.mutateAsync({ productId: newProduct.id, groupIds });
      }
      setAddMenuOpen(false);
      setSelectedId(newProduct.id);
      setProductType(type);
      toast({ kind: 'success', title: 'เพิ่มรายการแล้ว', msg: `${name}${isDrink ? ' · เปิดตัวเลือกแล้ว' : ''}` });
    } catch (err) {
      toast({ kind: 'warning', title: 'เกิดข้อผิดพลาด', msg: err instanceof Error ? err.message : 'กรุณาลองใหม่' });
    }
  };

  const handleDelete = async () => {
    if (!selectedId || !selectedProduct) return;
    try {
      await deleteProduct.mutateAsync(selectedId);
      setDeleteConfirmOpen(false);
      setSelectedId(null);
      toast({ kind: 'success', title: 'ลบแล้ว', msg: `${selectedProduct.name} ถูกลบออกจากระบบ` });
    } catch (err) {
      toast({ kind: 'warning', title: 'ลบไม่สำเร็จ', msg: err instanceof Error ? err.message : 'กรุณาลองใหม่' });
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
            <button onClick={() => setAddMenuOpen(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 10px', fontSize: 11, fontWeight: 600, background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', transition: 'background 150ms var(--ease-out)', flexShrink: 0 }} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-primary-700)'} onMouseLeave={e => e.currentTarget.style.background = 'var(--color-primary)'}><Icon name="plus" size={12} /> เพิ่มรายการ</button>
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
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--color-text-muted)' }}>เลือกรายการจากรายการด้านซ้าย</div>
        ) : detailLoading ? (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--color-text-muted)' }}>กำลังโหลดสูตร...</div>
        ) : (
          <RightPanel
            product={selectedProduct}
            productType={productType}
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
            onDeleteRequest={() => setDeleteConfirmOpen(true)}
            linkedGroupIds={productDetail?.modifierGroupIds ?? []}
            allModifierGroups={modifierGroups ?? []}
            onModifierGroupPickerOpen={() => setModifierGroupPickerOpen(true)}
            onAddModifier={async (groupId, name, priceDelta) => {
              try {
                await addModifier.mutateAsync({ groupId, name, price_delta: priceDelta });
                toast({ kind: 'success', title: 'เพิ่มตัวเลือกแล้ว', msg: name });
              } catch {
                toast({ kind: 'danger', title: 'เพิ่มไม่สำเร็จ', msg: 'กรุณาลองใหม่' });
              }
            }}
            onDeleteModifier={async (groupId, modifierId) => {
              try {
                await deleteModifier.mutateAsync({ groupId, modifierId });
                toast({ kind: 'success', title: 'ลบตัวเลือกแล้ว' });
              } catch {
                toast({ kind: 'danger', title: 'ลบไม่สำเร็จ', msg: 'กรุณาลองใหม่' });
              }
            }}
          />
        )}
      </div>

      {picker && (
        <IngredientPicker
          existingIds={editedRecipe.map(r => r.invId)}
          inventory={inventoryItems ?? []}
          onConfirm={addItems}
          onClose={() => setPicker(false)}
        />
      )}
      {addMenuOpen && (
        <AddMenuModal
          categories={categories ?? []}
          onClose={() => setAddMenuOpen(false)}
          onSubmit={submitAddMenu}
        />
      )}
      {deleteConfirmOpen && selectedProduct && (
        <DeleteConfirmModal
          name={selectedProduct.name}
          deleting={deleteProduct.isPending}
          onConfirm={handleDelete}
          onClose={() => setDeleteConfirmOpen(false)}
        />
      )}
      {modifierGroupPickerOpen && selectedId && (
        <ModifierGroupPicker
          currentGroupIds={productDetail?.modifierGroupIds ?? []}
          allGroups={modifierGroups ?? []}
          onClose={() => setModifierGroupPickerOpen(false)}
          onConfirm={async (groupIds) => {
            try {
              await linkModifierGroups.mutateAsync({ productId: selectedId, groupIds });
              setModifierGroupPickerOpen(false);
              toast({ kind: 'success', title: 'บันทึกตัวเลือกแล้ว', msg: `เชื่อมโยง ${groupIds.length} กลุ่ม` });
            } catch {
              toast({ kind: 'danger', title: 'บันทึกไม่สำเร็จ', msg: 'กรุณาลองใหม่' });
            }
          }}
          saving={linkModifierGroups.isPending}
        />
      )}
    </div>
  );
}

interface RightPanelProps {
  product: MenuItem;
  productType: ProductType;
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
  onDeleteRequest: () => void;
  linkedGroupIds: string[];
  allModifierGroups: ModifierGroup[];
  onModifierGroupPickerOpen: () => void;
  onAddModifier: (groupId: string, name: string, priceDelta: string) => Promise<void>;
  onDeleteModifier: (groupId: string, modifierId: string) => Promise<void>;
}

const RightPanel = ({ product, productType, recipe, editedPrice, inventoryItems, totalCost, margin, marginPct, marginToneOf, marginColorOf, onPriceChange, onQtyChange, onRemove, onPickerOpen, onSave, saving, onDeleteRequest, linkedGroupIds, allModifierGroups, onModifierGroupPickerOpen, onAddModifier, onDeleteModifier }: RightPanelProps) => (
  <>
    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 24, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 20 }}>
      <div style={{ width: 80, height: 80, borderRadius: 12, background: product.color, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 26, fontWeight: 800, flexShrink: 0 }}>{product.tag}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', fontWeight: 500 }}>{product.nameEn}</div>
        <h1 style={{ margin: '2px 0 8px', fontSize: 24, fontWeight: 700, letterSpacing: '-0.01em' }}>{product.name}</h1>
        <div style={{ display: 'flex', gap: 6 }}>
          <Tag tone={productType === 'MENU' ? 'info' : 'accent'}>{productType === 'MENU' ? 'เมนูขาย' : 'ส่วนผสม'}</Tag>
          <Tag tone={recipe.length > 0 ? 'success' : 'warning'}>{recipe.length > 0 ? `${recipe.length} วัตถุดิบ` : 'ยังไม่มีสูตร'}</Tag>
        </div>
      </div>
      <div>
        <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 6 }}>
          {productType === 'MENU' ? 'ราคาขาย' : 'ต้นทุนผลิต'}
        </div>
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
      {productType === 'MENU'
        ? <SummaryCard label="Margin" value={`${marginPct.toFixed(1)}%`} highlight={marginToneOf(marginPct)} />
        : <SummaryCard label="ต้นทุน/หน่วย" value={`฿${totalCost.toFixed(2)}`} highlight="info" />
      }
    </div>

    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>ส่วนประกอบ (Bill of Materials)</div>
        <button onClick={onPickerOpen} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', fontSize: 13, fontWeight: 600, background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', transition: 'background 150ms var(--ease-out)' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-primary-700)'} onMouseLeave={e => e.currentTarget.style.background = 'var(--color-primary)'}><Icon name="plus" size={14} />เพิ่มวัตถุดิบ</button>
      </div>

      {recipe.length === 0 ? (
        <div style={{ padding: 48, textAlign: 'center' }}>
          <div style={{ width: 56, height: 56, borderRadius: 12, background: 'var(--color-surface-2)', margin: '0 auto 12px', display: 'grid', placeItems: 'center' }}><Icon name="inv" size={28} color="var(--color-text-muted)" /></div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>ยังไม่มีสูตรสำหรับรายการนี้</div>
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
              <BOMRow
                key={idx}
                inv={inv}
                qty={r.qty}
                lineCost={lineCost}
                stockOk={stockOk}
                isLast={idx === recipe.length - 1}
                onQtyChange={qty => onQtyChange(idx, qty)}
                onRemove={() => onRemove(idx)}
              />
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

    <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'space-between', alignItems: 'center' }}>
      <button onClick={onDeleteRequest} style={{ padding: '10px 16px', fontSize: 13, fontWeight: 600, background: 'transparent', color: 'var(--color-danger)', border: '1px solid var(--color-danger)', borderRadius: 8, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'inherit', transition: 'all 150ms var(--ease-out)' }} onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-danger-50)'; }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
        <Icon name="trash" size={14} /> ลบเมนูนี้
      </button>
      <button onClick={onSave} disabled={saving} style={{ padding: '10px 20px', fontSize: 14, fontWeight: 600, background: saving ? 'var(--color-surface-2)' : 'var(--color-primary)', color: saving ? 'var(--color-text-muted)' : '#fff', border: 'none', borderRadius: 8, cursor: saving ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'inherit', transition: 'background 150ms var(--ease-out)' }} onMouseEnter={e => { if (!saving) e.currentTarget.style.background = 'var(--color-primary-700)'; }} onMouseLeave={e => { if (!saving) e.currentTarget.style.background = 'var(--color-primary)'; }}>
        <Icon name="check" size={16} />{saving ? 'กำลังบันทึก...' : 'บันทึกสูตร'}
      </button>
    </div>

    <ModifierSection
      linkedGroupIds={linkedGroupIds}
      allModifierGroups={allModifierGroups}
      onPickerOpen={onModifierGroupPickerOpen}
      onAddModifier={onAddModifier}
      onDeleteModifier={onDeleteModifier}
    />

    {productType === 'MENU' && (
      <div style={{ marginTop: 24, padding: 16, background: 'var(--color-info-50)', borderRadius: 12, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <Icon name="info" size={20} color="var(--color-info)" />
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-info)', marginBottom: 6 }}>เรื่อง Margin ที่ควรรู้</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.7 }}>
            คาเฟ่ทั่วไปควรมี margin <strong style={{ color: 'var(--color-success)' }}>≥ 65%</strong> สำหรับเครื่องดื่ม และ <strong style={{ color: 'var(--color-success)' }}>≥ 60%</strong> สำหรับเบเกอรี่
          </div>
        </div>
      </div>
    )}
  </>
);

// ── BOM Row with inline unit converter ───────────────────────────────────────
const BOMRow = ({ inv, qty, lineCost, stockOk, isLast, onQtyChange, onRemove }: {
  inv: InventoryItem; qty: number; lineCost: number; stockOk: boolean; isLast: boolean;
  onQtyChange: (qty: number) => void; onRemove: () => void;
}) => {
  const [showCalc, setShowCalc] = useState(false);
  const [pkgQty, setPkgQty] = useState('');
  const [pkgUnit, setPkgUnit] = useState('kg');
  const [pkgPrice, setPkgPrice] = useState('');

  const PKG_UNITS = ['kg', 'L', 'โหล', 'แพ็ค', 'ลัง', 'กล่อง'];
  const PKG_TO_USE: Record<string, number> = { kg: 1000, L: 1000 };

  const calcCostPerUse = () => {
    const pq = parseFloat(pkgQty);
    const pp = parseFloat(pkgPrice);
    if (!pq || !pp) return null;
    const conv = PKG_TO_USE[pkgUnit] ?? 1;
    return pp / (pq * conv);
  };

  const derived = calcCostPerUse();

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px 70px 100px 90px 36px', gap: 12, padding: '12px 20px', alignItems: 'center', borderBottom: (!isLast || showCalc) ? '1px solid var(--color-border)' : 'none' }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
            {inv.name}
            <button
              onClick={() => setShowCalc(v => !v)}
              title="คำนวณต้นทุนจากหน่วยซื้อ"
              style={{ background: showCalc ? 'var(--color-accent-50)' : 'transparent', border: 'none', cursor: 'pointer', padding: '2px 5px', borderRadius: 4, fontSize: 11, color: showCalc ? 'var(--color-accent)' : 'var(--color-text-muted)', fontFamily: 'inherit' }}
            >
              ÷ คำนวณ
            </button>
          </div>
          <div style={{ fontSize: 11, color: stockOk ? 'var(--color-text-muted)' : 'var(--color-warning)', marginTop: 2 }}>คงเหลือ {inv.stock.toLocaleString()} {inv.unit}{!stockOk && ' · ใกล้หมด'}</div>
        </div>
        <input type="number" step={1} min={0} value={qty} onChange={e => onQtyChange(Number(e.target.value))} className="num" style={{ textAlign: 'right', fontSize: 14, fontWeight: 600, border: '1px solid var(--color-border)', borderRadius: 6, padding: '6px 10px', outline: 'none', fontFamily: 'inherit', background: 'var(--color-surface)' }} onFocus={e => e.target.style.borderColor = 'var(--color-accent)'} onBlur={e => e.target.style.borderColor = 'var(--color-border)'} />
        <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{inv.unit}</div>
        <div className="num" style={{ fontSize: 13, color: 'var(--color-text-secondary)', textAlign: 'right' }}>฿{inv.costPerUnit.toFixed(2)}</div>
        <div className="num" style={{ fontSize: 14, fontWeight: 700, textAlign: 'right' }}>฿{lineCost.toFixed(2)}</div>
        <button onClick={onRemove} title="ลบวัตถุดิบ" style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'grid', placeItems: 'center', padding: 6, borderRadius: 6, color: 'var(--color-text-muted)', transition: 'all 150ms var(--ease-out)' }} onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-danger-50)'; e.currentTarget.style.color = 'var(--color-danger)'; }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-muted)'; }}><Icon name="trash" size={14} /></button>
      </div>

      {showCalc && (
        <div style={{ padding: '10px 20px 14px', background: 'var(--color-accent-50)', borderBottom: isLast ? 'none' : '1px solid var(--color-border)', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>ซื้อ:</span>
          <input type="number" min={0} step={0.1} value={pkgQty} onChange={e => setPkgQty(e.target.value)} placeholder="ปริมาณ" style={{ width: 70, padding: '5px 8px', border: '1px solid var(--color-border)', borderRadius: 6, fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
          <select value={pkgUnit} onChange={e => setPkgUnit(e.target.value)} style={{ padding: '5px 8px', border: '1px solid var(--color-border)', borderRadius: 6, fontSize: 13, fontFamily: 'inherit', outline: 'none', background: 'var(--color-surface)' }}>
            {PKG_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
          <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>ราคา</span>
          <input type="number" min={0} step={1} value={pkgPrice} onChange={e => setPkgPrice(e.target.value)} placeholder="฿" style={{ width: 80, padding: '5px 8px', border: '1px solid var(--color-border)', borderRadius: 6, fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
          {derived !== null ? (
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-accent)', whiteSpace: 'nowrap' }}>
              → ฿{derived.toFixed(4)}/{inv.unit} <span style={{ fontWeight: 400, color: 'var(--color-text-secondary)', fontSize: 11 }}>(ต้นทุน/หน่วยใช้)</span>
            </span>
          ) : (
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>กรอกปริมาณและราคาเพื่อคำนวณ</span>
          )}
        </div>
      )}
    </>
  );
};

const SummaryCard = ({ label, value, color, highlight }: { label: string; value: string; color?: string; highlight?: 'success' | 'warning' | 'danger' | 'info' }) => {
  const tones = {
    success: { bg: 'var(--color-success-50)', border: 'var(--color-success)', fg: 'var(--color-success)' },
    warning: { bg: 'var(--color-warning-50)', border: 'var(--color-warning)', fg: '#9C6A1F' },
    danger:  { bg: 'var(--color-danger-50)',  border: 'var(--color-danger)',  fg: 'var(--color-danger)' },
    info:    { bg: 'var(--color-info-50)',    border: 'var(--color-info)',    fg: 'var(--color-info)' },
  };
  const t = highlight ? tones[highlight] : null;
  return (
    <div style={{ background: t ? t.bg : 'var(--color-surface)', border: t ? `1px solid ${t.border}` : '1px solid var(--color-border)', borderRadius: 12, padding: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: t ? t.fg : 'var(--color-text-secondary)' }}>{label}</div>
      <div className="num" style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', color: t ? t.fg : (color || 'var(--color-text)') }}>{value}</div>
    </div>
  );
};

// ── Modifier Group Management ─────────────────────────────────────────────────

const ModifierSection = ({
  linkedGroupIds, allModifierGroups, onPickerOpen, onAddModifier, onDeleteModifier,
}: {
  linkedGroupIds: string[];
  allModifierGroups: ModifierGroup[];
  onPickerOpen: () => void;
  onAddModifier: (groupId: string, name: string, priceDelta: string) => Promise<void>;
  onDeleteModifier: (groupId: string, modifierId: string) => Promise<void>;
}) => {
  const linkedGroups = linkedGroupIds
    .map(id => allModifierGroups.find(g => g.id === id))
    .filter((g): g is ModifierGroup => g !== undefined);

  return (
    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, overflow: 'hidden', marginTop: 16 }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>ตัวเลือก (Modifier Groups)</div>
        <button onClick={onPickerOpen} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', fontSize: 13, fontWeight: 600, background: 'var(--color-surface-2)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', transition: 'background 150ms var(--ease-out)' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-accent-50)'} onMouseLeave={e => e.currentTarget.style.background = 'var(--color-surface-2)'}>
          <Icon name="plus" size={14} /> เปลี่ยนตัวเลือก
        </button>
      </div>
      {linkedGroups.length === 0 ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--color-text-muted)' }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>ยังไม่มีตัวเลือก</div>
          <div style={{ fontSize: 12 }}>กดปุ่ม "เปลี่ยนตัวเลือก" เพื่อเชื่อมโยง modifier groups</div>
        </div>
      ) : (
        linkedGroups.map(group => (
          <ModifierGroupRow
            key={group.id}
            group={group}
            onAddModifier={(name, priceDelta) => onAddModifier(group.id, name, priceDelta)}
            onDeleteModifier={(modifierId) => onDeleteModifier(group.id, modifierId)}
          />
        ))
      )}
    </div>
  );
};

const ModifierGroupRow = ({ group, onAddModifier, onDeleteModifier }: {
  group: ModifierGroup;
  onAddModifier: (name: string, priceDelta: string) => Promise<void>;
  onDeleteModifier: (modifierId: string) => Promise<void>;
}) => {
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDelta, setNewDelta] = useState('0');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleAdd = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      await onAddModifier(newName.trim(), newDelta || '0');
      setNewName('');
      setNewDelta('0');
      setAddOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (modifierId: string) => {
    setDeletingId(modifierId);
    try {
      await onDeleteModifier(modifierId);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div style={{ borderBottom: '1px solid var(--color-border)' }}>
      <div style={{ padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--color-surface-2)' }}>
        <div style={{ flex: 1, fontSize: 13, fontWeight: 700 }}>{group.label}</div>
        <Tag tone={group.required ? 'danger' : 'warning'}>{group.required ? 'จำเป็น' : 'ตัวเลือก'}</Tag>
        <Tag tone="info">{group.type === 'radio' ? 'เลือกได้ 1' : 'เลือกได้หลาย'}</Tag>
        <button onClick={() => setAddOpen(v => !v)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', fontSize: 12, fontWeight: 600, background: addOpen ? 'var(--color-accent-50)' : 'transparent', color: addOpen ? 'var(--color-primary-700)' : 'var(--color-text-secondary)', border: `1px solid ${addOpen ? 'var(--color-accent)' : 'var(--color-border)'}`, borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', transition: 'all 150ms var(--ease-out)' }}>
          <Icon name="plus" size={12} /> เพิ่มตัวเลือก
        </button>
      </div>
      {group.options.map(option => (
        <div key={option.id} style={{ padding: '8px 20px', display: 'flex', alignItems: 'center', gap: 12, borderTop: '1px solid var(--color-border)' }}>
          <div style={{ flex: 1, fontSize: 13 }}>{option.label}</div>
          <div className="num" style={{ fontSize: 12, fontWeight: 600, minWidth: 50, textAlign: 'right', color: option.diff === 0 ? 'var(--color-text-muted)' : 'var(--color-text)' }}>
            {option.diff === 0 ? '—' : option.diff > 0 ? `+฿${option.diff}` : `-฿${Math.abs(option.diff)}`}
          </div>
          <button onClick={() => handleDelete(option.id)} disabled={deletingId === option.id} title="ลบตัวเลือก" style={{ display: 'grid', placeItems: 'center', width: 28, height: 28, borderRadius: 6, background: 'transparent', border: 'none', cursor: deletingId === option.id ? 'not-allowed' : 'pointer', color: 'var(--color-text-muted)', transition: 'all 150ms var(--ease-out)' }} onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-danger-50)'; e.currentTarget.style.color = 'var(--color-danger)'; }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-muted)'; }}>
            {deletingId === option.id ? '…' : <Icon name="trash" size={13} />}
          </button>
        </div>
      ))}
      {addOpen && (
        <div style={{ padding: '10px 20px', display: 'flex', gap: 8, alignItems: 'center', borderTop: '1px solid var(--color-border)', background: 'var(--color-accent-50)' }}>
          <input type="text" placeholder="ชื่อตัวเลือก..." value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAdd()} style={{ flex: 1, padding: '7px 10px', fontSize: 13, border: '1px solid var(--color-border)', borderRadius: 6, fontFamily: 'inherit', outline: 'none', background: 'var(--color-surface)' }} autoFocus />
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>฿</span>
            <input type="number" step="1" placeholder="0" value={newDelta} onChange={e => setNewDelta(e.target.value)} style={{ width: 72, padding: '7px 10px', fontSize: 13, textAlign: 'right', border: '1px solid var(--color-border)', borderRadius: 6, fontFamily: 'inherit', outline: 'none', background: 'var(--color-surface)' }} />
          </div>
          <button onClick={handleAdd} disabled={saving || !newName.trim()} style={{ padding: '7px 14px', fontSize: 13, fontWeight: 600, background: (saving || !newName.trim()) ? 'var(--color-surface-2)' : 'var(--color-primary)', color: (saving || !newName.trim()) ? 'var(--color-text-muted)' : '#fff', border: 'none', borderRadius: 6, cursor: (saving || !newName.trim()) ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
            {saving ? '…' : 'เพิ่ม'}
          </button>
          <button onClick={() => setAddOpen(false)} style={{ padding: '7px 10px', fontSize: 12, fontWeight: 500, background: 'transparent', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' }}>ยกเลิก</button>
        </div>
      )}
    </div>
  );
};

const ModifierGroupPicker = ({ currentGroupIds, allGroups, onClose, onConfirm, saving }: {
  currentGroupIds: string[];
  allGroups: ModifierGroup[];
  onClose: () => void;
  onConfirm: (groupIds: string[]) => Promise<void>;
  saving: boolean;
}) => {
  const [selected, setSelected] = useState<Set<string>>(new Set(currentGroupIds));

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(26, 16, 8, 0.55)', display: 'grid', placeItems: 'center', zIndex: 100, padding: 20, animation: 'backdrop-in 200ms var(--ease-out)' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--color-surface)', borderRadius: 16, width: '100%', maxWidth: 520, maxHeight: '75vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 50px rgba(0,0,0,0.25)', animation: 'modal-in 220ms var(--ease-out)' }}>
        <div style={{ padding: 20, borderBottom: '1px solid var(--color-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>เลือก Modifier Groups</div>
            <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 6, borderRadius: 8, display: 'grid', placeItems: 'center' }}><Icon name="x" size={18} /></button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
            {allGroups.length} กลุ่มทั้งหมด
            {selected.size > 0 && <span style={{ color: 'var(--color-accent)', fontWeight: 600 }}> · เลือก {selected.size} กลุ่ม</span>}
          </div>
        </div>
        <div className="scroll" style={{ overflow: 'auto', flex: 1, padding: 8 }}>
          {allGroups.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>ยังไม่มี modifier groups ในระบบ</div>
          ) : allGroups.map(group => {
            const checked = selected.has(group.id);
            return (
              <button key={group.id} onClick={() => toggle(group.id)} style={{ display: 'flex', gap: 12, alignItems: 'center', width: '100%', padding: 12, marginBottom: 2, borderRadius: 8, background: checked ? 'var(--color-accent-50)' : 'transparent', border: checked ? '1px solid var(--color-accent)' : '1px solid transparent', cursor: 'pointer', textAlign: 'left', transition: 'all 150ms var(--ease-out)', fontFamily: 'inherit' }} onMouseEnter={e => { if (!checked) e.currentTarget.style.background = 'var(--color-surface-2)'; }} onMouseLeave={e => { if (!checked) e.currentTarget.style.background = 'transparent'; }}>
                <div style={{ width: 20, height: 20, borderRadius: 4, border: `2px solid ${checked ? 'var(--color-accent)' : 'var(--color-border)'}`, background: checked ? 'var(--color-accent)' : 'transparent', display: 'grid', placeItems: 'center', flexShrink: 0, transition: 'all 150ms var(--ease-out)' }}>
                  {checked && <Icon name="check" size={12} color="#fff" />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{group.label}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>
                    {group.options.length} ตัวเลือก · {group.type === 'radio' ? 'เลือกได้ 1' : 'เลือกได้หลาย'}{group.required ? ' · จำเป็น' : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  {group.options.slice(0, 3).map(o => <Tag key={o.id} tone="neutral">{o.label}</Tag>)}
                  {group.options.length > 3 && <Tag tone="neutral">+{group.options.length - 3}</Tag>}
                </div>
              </button>
            );
          })}
        </div>
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--color-border)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '9px 16px', fontSize: 13, fontWeight: 600, background: 'transparent', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' }}>ยกเลิก</button>
          <button onClick={() => onConfirm([...selected])} disabled={saving} style={{ padding: '9px 16px', fontSize: 13, fontWeight: 600, background: saving ? 'var(--color-surface-2)' : 'var(--color-primary)', color: saving ? 'var(--color-text-muted)' : '#fff', border: 'none', borderRadius: 8, cursor: saving ? 'not-allowed' : 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6, transition: 'background 150ms var(--ease-out)' }}>
            <Icon name="check" size={14} />{saving ? 'กำลังบันทึก...' : `บันทึก ${selected.size} กลุ่ม`}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Multi-select Ingredient Picker ────────────────────────────────────────────
const IngredientPicker = ({ existingIds, inventory, onConfirm, onClose }: {
  existingIds: string[];
  inventory: InventoryItem[];
  onConfirm: (ids: string[]) => void;
  onClose: () => void;
}) => {
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const list = inventory.filter(inv => !q || inv.name.toLowerCase().includes(q.toLowerCase()));
  const canAdd = selected.size > 0;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(26, 16, 8, 0.55)', display: 'grid', placeItems: 'center', zIndex: 100, padding: 20, animation: 'backdrop-in 200ms var(--ease-out)' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--color-surface)', borderRadius: 16, width: '100%', maxWidth: 520, maxHeight: '75vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 50px rgba(0,0,0,0.25)', animation: 'modal-in 220ms var(--ease-out)' }}>
        <div style={{ padding: 20, borderBottom: '1px solid var(--color-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>เลือกวัตถุดิบ</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>
                {inventory.length} รายการในคลัง
                {selected.size > 0 && <span style={{ color: 'var(--color-accent)', fontWeight: 600 }}> · เลือก {selected.size} รายการ</span>}
              </div>
            </div>
            <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 6, borderRadius: 8, display: 'grid', placeItems: 'center' }}><Icon name="x" size={18} /></button>
          </div>
          <div style={{ position: 'relative' }}>
            <div style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', display: 'grid', placeItems: 'center' }}><Icon name="search" size={16} color="var(--color-text-muted)" /></div>
            <input type="text" placeholder="ค้นหาวัตถุดิบ..." autoFocus value={q} onChange={e => setQ(e.target.value)} style={{ width: '100%', padding: '10px 12px 10px 36px', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
          </div>
        </div>

        <div className="scroll" style={{ overflow: 'auto', flex: 1, padding: 8 }}>
          {list.map(inv => {
            const already = existingIds.includes(inv.id);
            const checked = selected.has(inv.id);
            return (
              <button key={inv.id} onClick={() => !already && toggle(inv.id)} disabled={already} style={{ display: 'flex', gap: 12, alignItems: 'center', width: '100%', padding: 12, marginBottom: 2, borderRadius: 8, background: checked ? 'var(--color-accent-50)' : 'transparent', border: checked ? '1px solid var(--color-accent)' : '1px solid transparent', cursor: already ? 'not-allowed' : 'pointer', textAlign: 'left', opacity: already ? 0.5 : 1, transition: 'all 150ms var(--ease-out)', fontFamily: 'inherit' }} onMouseEnter={e => { if (!already && !checked) e.currentTarget.style.background = 'var(--color-surface-2)'; }} onMouseLeave={e => { if (!checked) e.currentTarget.style.background = 'transparent'; }}>
                <div style={{ width: 20, height: 20, borderRadius: 4, border: `2px solid ${checked ? 'var(--color-accent)' : 'var(--color-border)'}`, background: checked ? 'var(--color-accent)' : 'transparent', display: 'grid', placeItems: 'center', flexShrink: 0, transition: 'all 150ms var(--ease-out)' }}>
                  {checked && <Icon name="check" size={12} color="#fff" />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{inv.name}</div>
                  <div className="num" style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>฿{inv.costPerUnit.toFixed(2)}/{inv.unit} · คงเหลือ {inv.stock.toLocaleString()} {inv.unit}</div>
                </div>
                {already && <Tag tone="success">เพิ่มแล้ว</Tag>}
              </button>
            );
          })}
        </div>

        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--color-border)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '9px 16px', fontSize: 13, fontWeight: 600, background: 'transparent', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' }}>ยกเลิก</button>
          <button onClick={() => canAdd && onConfirm([...selected])} disabled={!canAdd} style={{ padding: '9px 16px', fontSize: 13, fontWeight: 600, background: canAdd ? 'var(--color-primary)' : 'var(--color-surface-2)', color: canAdd ? '#fff' : 'var(--color-text-muted)', border: 'none', borderRadius: 8, cursor: canAdd ? 'pointer' : 'not-allowed', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6, transition: 'background 150ms var(--ease-out)' }} onMouseEnter={e => { if (canAdd) e.currentTarget.style.background = 'var(--color-primary-700)'; }} onMouseLeave={e => { if (canAdd) e.currentTarget.style.background = 'var(--color-primary)'; }}>
            <Icon name="plus" size={14} /> เพิ่ม {selected.size > 0 ? `${selected.size} รายการ` : 'วัตถุดิบ'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Shared modal helpers ───────────────────────────────────────────────────────
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

const DeleteConfirmModal = ({ name, deleting, onConfirm, onClose }: {
  name: string; deleting: boolean;
  onConfirm: () => void; onClose: () => void;
}) => (
  <BomModalShell title="ยืนยันการลบ" subtitle={`"${name}" จะถูกปิดใช้งาน`} onClose={onClose}>
    <div style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 20, lineHeight: 1.7 }}>
      รายการนี้จะถูกซ่อนจากหน้า POS และ BOM Builder ข้อมูลยังอยู่ในระบบ สามารถกู้คืนได้ผ่าน backend
    </div>
    <BomModalActions>
      <button onClick={onClose} style={{ padding: '10px 16px', fontSize: 13, fontWeight: 600, background: 'transparent', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' }}>ยกเลิก</button>
      <button onClick={onConfirm} disabled={deleting} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 16px', fontSize: 13, fontWeight: 600, background: deleting ? 'var(--color-surface-2)' : 'var(--color-danger)', color: deleting ? 'var(--color-text-muted)' : '#fff', border: 'none', borderRadius: 8, cursor: deleting ? 'not-allowed' : 'pointer', fontFamily: 'inherit', transition: 'background 150ms var(--ease-out)' }}>
        <Icon name="trash" size={14} />{deleting ? 'กำลังลบ...' : 'ยืนยันลบ'}
      </button>
    </BomModalActions>
  </BomModalShell>
);

const AddMenuModal = ({ categories, onClose, onSubmit }: {
  categories: import('@/hooks/use-products').Category[];
  onClose: () => void;
  onSubmit: (v: { name: string; categoryId: string; price: number; description: string; type: ProductType; isDrink: boolean }) => void;
}) => {
  const [type, setType] = useState<ProductType>('MENU');
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const [isDrink, setIsDrink] = useState(false);
  const canSubmit = name.trim().length > 0 && price !== '' && Number(price) >= 0;
  const submit = () => { if (!canSubmit) return; onSubmit({ name: name.trim(), categoryId, price: Number(price), description: description.trim(), type, isDrink: type === 'MENU' && isDrink }); };

  return (
    <BomModalShell title="เพิ่มรายการใหม่" subtitle="สร้างรายการในระบบ BOM" onClose={onClose}>
      {/* Type toggle */}
      <BomFormField label="ประเภท *">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {(['MENU', 'INGREDIENT'] as ProductType[]).map(t => (
            <button key={t} onClick={() => setType(t)} style={{ padding: '10px 12px', borderRadius: 8, border: `2px solid ${type === t ? 'var(--color-accent)' : 'var(--color-border)'}`, background: type === t ? 'var(--color-accent-50)' : 'transparent', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', color: type === t ? 'var(--color-primary-700)' : 'var(--color-text-secondary)', transition: 'all 150ms var(--ease-out)' }}>
              {t === 'MENU' ? '🍵 เมนูขาย' : '🧪 ส่วนผสม'}
              <div style={{ fontSize: 11, fontWeight: 400, marginTop: 2, color: type === t ? 'var(--color-text-secondary)' : 'var(--color-text-muted)' }}>
                {t === 'MENU' ? 'จำหน่ายให้ลูกค้า' : 'ใช้ในสูตรอื่น'}
              </div>
            </button>
          ))}
        </div>
      </BomFormField>

      <BomFormField label="ชื่อ *">
        <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder={type === 'MENU' ? 'เช่น Flat White, ครัวซองต์เนย' : 'เช่น น้ำเชื่อมชาไทย, เบสเยลลี่'} style={bomInputStyle()} autoFocus />
      </BomFormField>

      {type === 'MENU' && (
        <BomFormField label="หมวดหมู่">
          <select value={categoryId} onChange={e => setCategoryId(e.target.value)} style={{ ...bomInputStyle(), appearance: 'auto' }}>
            <option value="">— ไม่ระบุหมวดหมู่ —</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </BomFormField>
      )}

      <BomFormField label={type === 'MENU' ? 'ราคาขาย (฿) *' : 'ต้นทุนผลิต/หน่วย (฿) *'}>
        <input type="number" min={0} step={5} value={price} onChange={e => setPrice(e.target.value)} placeholder="0" style={bomInputStyle()} />
      </BomFormField>

      <BomFormField label="รายละเอียด">
        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} placeholder="ไม่บังคับ" style={{ ...bomInputStyle(), resize: 'vertical', fontFamily: 'inherit' }} />
      </BomFormField>

      {type === 'MENU' && (
        <BomFormField label="ตัวเลือกเพิ่มเติม">
          <label onClick={() => setIsDrink(v => !v)} style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', padding: '10px 12px', border: `2px solid ${isDrink ? 'var(--color-accent)' : 'var(--color-border)'}`, borderRadius: 8, background: isDrink ? 'var(--color-accent-50)' : 'transparent', transition: 'all 150ms var(--ease-out)', userSelect: 'none' }}>
            <div style={{ width: 20, height: 20, borderRadius: 4, border: `2px solid ${isDrink ? 'var(--color-accent)' : 'var(--color-border)'}`, background: isDrink ? 'var(--color-accent)' : 'transparent', display: 'grid', placeItems: 'center', flexShrink: 0, transition: 'all 150ms var(--ease-out)' }}>
              {isDrink && <Icon name="check" size={12} color="#fff" />}
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: isDrink ? 'var(--color-primary-700)' : 'var(--color-text)' }}>เครื่องดื่ม — มีตัวเลือก</div>
              <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2 }}>แสดงหน้าเลือกความหวาน, ขนาด ฯลฯ เมื่อสั่งจาก POS</div>
            </div>
          </label>
        </BomFormField>
      )}

      <BomModalActions>
        <button onClick={onClose} style={{ padding: '10px 16px', fontSize: 13, fontWeight: 600, background: 'transparent', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' }}>ยกเลิก</button>
        <button onClick={submit} disabled={!canSubmit} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 16px', fontSize: 13, fontWeight: 600, background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 8, cursor: canSubmit ? 'pointer' : 'not-allowed', fontFamily: 'inherit', opacity: canSubmit ? 1 : 0.45, transition: 'background 150ms var(--ease-out)' }} onMouseEnter={e => { if (canSubmit) e.currentTarget.style.background = 'var(--color-primary-700)'; }} onMouseLeave={e => { e.currentTarget.style.background = 'var(--color-primary)'; }}><Icon name="plus" size={14} /> เพิ่มรายการ</button>
      </BomModalActions>
    </BomModalShell>
  );
};
