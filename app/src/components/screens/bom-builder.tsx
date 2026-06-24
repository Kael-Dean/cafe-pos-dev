'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import Icon from '../icons';
import { useToast, Tag, baht, Select, NumberInput } from '../app-common';
import { useStagger } from '@/lib/motion';
import { Skeleton, SkeletonTable } from '@/components/ui/skeleton';
import { useAllProducts, useCategories, useCreateProduct, useDeleteProduct, useUpdateProduct, useUploadProductImage, useDeleteProductImage, type MenuItem, type Category } from '@/hooks/use-products';
import { useInventory, type InventoryItem } from '@/hooks/use-inventory';
import { useProductDetail, useUpdateRecipe, useLinkModifierGroups, type RecipeItem } from '@/hooks/use-bom';
import { useModifierGroups, useModifierGroupsAdmin, useAddModifier, useUpdateModifier, useDeleteModifier, useModifierRecipeItems, useReplaceModifierRecipeItems, type ModifierGroup, type ModifierGroupRead, type ModifierRead, type ModifierRecipeItemInput } from '@/hooks/use-modifier-groups';
import { useCookingSteps, useReplaceCookingSteps, type CookingStepRead } from '@/hooks/use-cooking-steps';
import { useCurrentUser, isAdmin } from '@/hooks/use-current-user';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api-client';
import { setNavGuard } from '@/lib/nav-guard';
import ImageCropModal from './image-crop-modal';

type ProductType = 'MENU' | 'COMPONENT';
type ApiProductType = 'MADE_TO_ORDER' | 'PRODUCED' | 'COMPONENT';

// VAT 7% (frontend-only). ราคาขายที่เก็บ/ส่ง BE เป็นราคารวม VAT แล้ว (เลขกลม เช่น 60, 100);
// exVat() ถอดฐานก่อน VAT ออกมา เพื่อแสดง breakdown ใต้ช่องราคา และคิด margin จากรายได้จริง (ไม่รวม VAT).
const VAT_RATE = 0.07;
const exVat = (gross: number) => gross / (1 + VAT_RATE);

export default function BOMBuilder() {
  const toast = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [picker, setPicker] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<MenuItem | null>(null);
  const [duplicating, setDuplicating] = useState(false);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);

  const [editedRecipe, setEditedRecipe] = useState<RecipeItem[]>([]);
  const [editedPrice, setEditedPrice] = useState(0);
  const [editedServingsPerBatch, setEditedServingsPerBatch] = useState(1);
  const [editedCategoryId, setEditedCategoryId] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [modifierGroupPickerOpen, setModifierGroupPickerOpen] = useState(false);

  const { data: products, isLoading: productsLoading } = useAllProducts();
  const { data: categories } = useCategories();
  const { data: inventoryItems } = useInventory();
  const { data: productDetail, isLoading: detailLoading } = useProductDetail(selectedId);
  const updateRecipe = useUpdateRecipe();
  const updateProduct = useUpdateProduct();
  const createProduct = useCreateProduct();
  const deleteProduct = useDeleteProduct();
  const linkModifierGroups = useLinkModifierGroups();
  const { data: modifierGroups } = useModifierGroups();          // mapped — for the group picker
  const { data: adminModifierGroups } = useModifierGroupsAdmin(); // raw — for inline editing
  const { data: currentUser } = useCurrentUser();
  const { data: stepsData } = useCookingSteps(selectedId);
  const replaceSteps = useReplaceCookingSteps();
  const [editedSteps, setEditedSteps] = useState<CookingStepRead[]>([]);
  const [newStepText, setNewStepText] = useState('');

  useEffect(() => {
    if (!selectedId && products?.[0]) {
      setSelectedId(products[0].id);
    }
  }, [products, selectedId]);

  // A freshly selected product starts clean; the load effects below only ever use
  // the raw setters, so loading server data never flips the unsaved-changes flag.
  useEffect(() => { setIsDirty(false); }, [selectedId]);

  // Keep the latest dirty state in a ref so the stable nav guard always sees it.
  const isDirtyRef = useRef(false);
  useEffect(() => { isDirtyRef.current = isDirty; }, [isDirty]);

  // Themed "discard unsaved changes?" dialog. confirmDiscard() shows it and resolves
  // true (discard) / false (stay) when the user picks — replacing native window.confirm.
  const [discardPrompt, setDiscardPrompt] = useState<{ resolve: (ok: boolean) => void } | null>(null);
  const confirmDiscard = useCallback(
    () => new Promise<boolean>(resolve => setDiscardPrompt({ resolve })),
    [],
  );
  const settleDiscard = (ok: boolean) => {
    discardPrompt?.resolve(ok);
    setDiscardPrompt(null);
  };

  // Warn before leaving the BOM screen for another page when there are unsaved edits.
  useEffect(() => {
    setNavGuard(() => !isDirtyRef.current || confirmDiscard());
    return () => setNavGuard(null);
  }, [confirmDiscard]);

  useEffect(() => {
    if (productDetail) {
      setEditedRecipe(productDetail.recipe.map(r => ({ ...r })));
      setEditedPrice(productDetail.price);
    }
  }, [productDetail]);

  useEffect(() => {
    setEditedSteps(stepsData ?? []);
    setNewStepText('');
  }, [stepsData, selectedId]);

  const saveSteps = async () => {
    if (!selectedId) return;
    try {
      await replaceSteps.mutateAsync({
        productId: selectedId,
        steps: editedSteps.map((s, i) => ({ instruction: s.instruction, sort_order: i })),
      });
      toast({ kind: 'success', title: 'บันทึกขั้นตอนแล้ว', msg: `${editedSteps.length} ขั้นตอน` });
    } catch (err) {
      toast({ kind: 'warning', title: 'บันทึกไม่สำเร็จ', msg: err instanceof Error ? err.message : 'กรุณาลองใหม่' });
    }
  };

  const computeCost = (items: RecipeItem[]) => items.reduce((s, r) => {
    const inv = inventoryItems?.find(i => i.id === r.invId);
    return s + (inv ? inv.costPerUnit * r.qty : 0);
  }, 0);

  const selectedProduct = products?.find(m => m.id === selectedId);

  useEffect(() => {
    setEditedCategoryId(selectedProduct?.cat ?? '');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(() => {
    setEditedServingsPerBatch(Math.max(1, selectedProduct?.servingsPerBatch ?? 1));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, selectedProduct?.servingsPerBatch]);

  const totalCost = computeCost(editedRecipe);
  // COMPONENT = ส่วนผสมทำเอง (ผลิตเอง ไม่ขาย). PRODUCED & COMPONENT ผลิตเป็นแบทช์ → ต้นทุนหารด้วย servings/แบทช์.
  const isComponent = selectedProduct?.productType === 'COMPONENT';
  const isBatchProduced = selectedProduct?.productType === 'PRODUCED' || isComponent;
  const batchSize = isBatchProduced ? Math.max(1, editedServingsPerBatch) : 1;
  const costPerUnit = totalCost / batchSize;
  // เมนูขาย: ราคาเป็นราคารวม VAT → คิด margin จากฐานก่อน VAT (รายได้จริง). component ไม่แสดง margin.
  const revenueBasis = exVat(editedPrice);
  const margin = revenueBasis - costPerUnit;
  const marginPct = revenueBasis > 0 ? (margin / revenueBasis) * 100 : 0;

  // Edit handlers passed to the panel — each flags unsaved changes so switching
  // menus warns before discarding (same guard as catalog.tsx).
  const changePrice = (v: number) => { setEditedPrice(v); setIsDirty(true); };
  const changeServingsPerBatch = (v: number) => { setEditedServingsPerBatch(v); setIsDirty(true); };
  const changeCategory = (v: string) => { setEditedCategoryId(v); setIsDirty(true); };

  const updateQty = (idx: number, qty: number) => {
    setEditedRecipe(r => {
      const next = [...r];
      next[idx] = { ...next[idx], qty: Math.max(0, qty) };
      return next;
    });
    setIsDirty(true);
  };

  const removeItem = (idx: number) => {
    setEditedRecipe(r => r.filter((_, i) => i !== idx));
    setIsDirty(true);
  };

  const addItems = (invIds: string[]) => {
    setEditedRecipe(r => [...r, ...invIds.map(id => ({ invId: id, qty: 1 }))]);
    setIsDirty(true);
    setPicker(false);
    toast({ kind: 'info', title: `เพิ่ม ${invIds.length} วัตถุดิบแล้ว`, msg: 'ปรับปริมาณตามสูตรจริง' });
  };

  // Guard menu switching: warn if there are unsaved edits before loading another product.
  const selectProduct = async (id: string) => {
    if (id === selectedId) return;
    if (isDirty && !(await confirmDiscard())) return;
    setSelectedId(id);
  };

  const saveRecipe = async () => {
    if (!selectedId) return;
    try {
      await Promise.all([
        updateRecipe.mutateAsync({ productId: selectedId, items: editedRecipe }),
        updateProduct.mutateAsync({
          productId: selectedId,
          // COMPONENT: ไม่มีราคาขาย/หมวดหมู่ (server บังคับ price=0); ส่งเฉพาะ servings/แบทช์
          ...(isComponent ? {} : { price: editedPrice, category_id: editedCategoryId || null }),
          ...(isBatchProduced ? { servings_per_batch: Math.max(1, editedServingsPerBatch) } : {}),
        }),
      ]);
      setIsDirty(false);
      toast({ kind: 'success', title: 'บันทึกสูตรแล้ว', msg: `${selectedProduct?.name ?? ''} • ${editedRecipe.length} วัตถุดิบ • ต้นทุน${isBatchProduced ? '/ชิ้น' : ''} ฿${costPerUnit.toFixed(2)}${isComponent ? '' : ` • Margin ${marginPct.toFixed(1)}%`}` });
    } catch (err) {
      toast({ kind: 'warning', title: 'บันทึกไม่สำเร็จ', msg: err instanceof Error ? err.message : 'กรุณาลองใหม่' });
    }
  };

  const submitAddMenu = async ({ name, categoryId, price, description, type, apiProductType, servingsPerBatch }: { name: string; categoryId: string; price: number; description: string; type: ProductType; apiProductType: ApiProductType; servingsPerBatch: number }) => {
    try {
      const isComp = type === 'COMPONENT';
      const newProduct = await createProduct.mutateAsync({
        name,
        category_id: isComp ? undefined : (categoryId || undefined),
        price: isComp ? undefined : price,         // omit for COMPONENT — server forces 0
        description: description || undefined,
        product_type: isComp ? 'COMPONENT' : apiProductType,
        servings_per_batch: (isComp || apiProductType === 'PRODUCED') ? servingsPerBatch : undefined,
      });
      setAddMenuOpen(false);
      setSelectedId(newProduct.id);
      toast({ kind: 'success', title: 'เพิ่มรายการแล้ว', msg: name });
    } catch (err) {
      toast({ kind: 'warning', title: 'เกิดข้อผิดพลาด', msg: err instanceof Error ? err.message : 'กรุณาลองใหม่' });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteProduct.mutateAsync(deleteTarget.id);
      if (selectedId === deleteTarget.id) setSelectedId(null);
      const deletedName = deleteTarget.name;
      setDeleteTarget(null);
      toast({ kind: 'success', title: 'ลบแล้ว', msg: `${deletedName} ถูกลบออกจากระบบ` });
    } catch (err) {
      toast({ kind: 'warning', title: 'ลบไม่สำเร็จ', msg: err instanceof Error ? err.message : 'กรุณาลองใหม่' });
    }
  };

  // Build a copy name that collides with neither an existing product NOR an
  // inventory item. PRODUCED products mirror their name into a finished-goods
  // inventory item (unique per store), so a fixed "(สำเนา)" suffix clashes on the
  // 2nd copy → backend 409 "Resource conflict". Bump a counter until it's free.
  const makeUniqueCopyName = (baseName: string) => {
    const taken = new Set<string>([
      ...(products ?? []).map(p => p.name),
      ...(inventoryItems ?? []).map(i => i.name),
    ]);
    const first = `${baseName} (สำเนา)`;
    if (!taken.has(first)) return first;
    let n = 2;
    while (taken.has(`${baseName} (สำเนา ${n})`)) n++;
    return `${baseName} (สำเนา ${n})`;
  };

  // Copy any product (by id, not just the selected one) into a new "(สำเนา)" entry,
  // carrying over recipe (BOM), linked modifier groups, and cooking steps. Detail and
  // steps are fetched on demand so the sidebar copy icon works on any row.
  const duplicateProductById = async (target: MenuItem) => {
    if (duplicating) return;
    setDuplicating(true);
    setDuplicatingId(target.id);
    try {
      const apiType = target.productType; // 'MADE_TO_ORDER' | 'PRODUCED' | 'COMPONENT'
      const isComp = apiType === 'COMPONENT';
      const [detail, steps] = await Promise.all([
        api.get<{ recipe: { inventory_item_id: string; quantity: string | number }[]; modifier_groups: { id: string }[] }>(`/api/v1/products/${target.id}`),
        api.get<CookingStepRead[]>(`/api/v1/products/${target.id}/steps`).catch(() => [] as CookingStepRead[]),
      ]);
      const newProduct = await createProduct.mutateAsync({
        name: makeUniqueCopyName(target.name),
        category_id: isComp ? undefined : (target.cat || undefined),
        price: isComp ? undefined : target.price,
        product_type: apiType,
        servings_per_batch: (isComp || apiType === 'PRODUCED') ? Math.max(1, target.servingsPerBatch) : undefined,
      });
      const recipeItems = (detail.recipe ?? []).map(r => ({ invId: r.inventory_item_id, qty: Number(r.quantity) }));
      const groupIds = (detail.modifier_groups ?? []).map(g => g.id);
      await Promise.all([
        recipeItems.length > 0 ? updateRecipe.mutateAsync({ productId: newProduct.id, items: recipeItems }) : Promise.resolve(),
        groupIds.length > 0 ? linkModifierGroups.mutateAsync({ productId: newProduct.id, groupIds }) : Promise.resolve(),
        steps.length > 0 ? replaceSteps.mutateAsync({ productId: newProduct.id, steps: steps.map((s, i) => ({ instruction: s.instruction, sort_order: i })) }) : Promise.resolve(),
      ]);
      setSelectedId(newProduct.id);
      toast({ kind: 'success', title: 'คัดลอกเมนูแล้ว', msg: newProduct.name });
    } catch (err) {
      toast({ kind: 'warning', title: 'คัดลอกไม่สำเร็จ', msg: err instanceof Error ? err.message : 'กรุณาลองใหม่' });
    } finally {
      setDuplicating(false);
      setDuplicatingId(null);
    }
  };

  const handleRename = async (newName: string) => {
    if (!selectedId) return;
    const trimmed = newName.trim();
    if (!trimmed || trimmed === selectedProduct?.name) return;
    try {
      await updateProduct.mutateAsync({ productId: selectedId, name: trimmed });
      toast({ kind: 'success', title: 'เปลี่ยนชื่อเมนูแล้ว', msg: trimmed });
    } catch (err) {
      toast({ kind: 'warning', title: 'เปลี่ยนชื่อไม่สำเร็จ', msg: err instanceof Error ? err.message : 'กรุณาลองใหม่' });
    }
  };

  // Sidebar list fades+rises in once data resolves; re-keyed on result count so
  // it replays after a search, not on every keystroke. Honors reduced-motion.
  const listRef = useStagger({ selector: ':scope > *', each: 0.02 });

  const filteredProducts = (products ?? []).filter(m =>
    !search || m.name.includes(search) || m.nameEn.toLowerCase().includes(search.toLowerCase())
  );
  const marginColorOf = (pct: number) => pct >= 65 ? 'var(--color-success)' : pct >= 50 ? 'var(--color-warning)' : 'var(--color-danger)';
  const marginToneOf = (pct: number): 'success' | 'warning' | 'danger' => pct >= 65 ? 'success' : pct >= 50 ? 'warning' : 'danger';

  return (
    <div style={{ display: 'flex', height: '100%', background: 'var(--color-bg)' }}>
      {/* LEFT sidebar */}
      <div style={{ width: 320, flexShrink: 0, background: 'var(--color-surface)', borderRight: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid var(--color-border)' }}>
          <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 4 }}>P1 — Inventory</div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: '-0.01em' }}>สร้างเมนู</h2>
            <button onClick={() => setAddMenuOpen(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 10px', fontSize: 11, fontWeight: 600, background: 'var(--color-primary)', color: 'var(--color-text-inverse)', border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', transition: 'background 150ms var(--ease-out)', flexShrink: 0 }} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-primary-700)'} onMouseLeave={e => e.currentTarget.style.background = 'var(--color-primary)'}><Icon name="plus" size={12} /> เพิ่มรายการ</button>
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
        <div key={productsLoading ? 'loading' : `n-${filteredProducts.length}`} ref={listRef} className="scroll" style={{ overflow: 'auto', flex: 1, padding: 8 }}>
          {productsLoading ? (
            <div aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              <span className="sr-only">กำลังโหลดรายการเมนู</span>
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 10 }}>
                  <Skeleton width={40} height={40} radius="var(--radius-md)" />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                    <Skeleton width="70%" height="var(--space-3)" />
                    <Skeleton width="35%" height="var(--space-3)" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredProducts.map(m => {
            const isActive = m.id === selectedId;
            return (
              <div key={m.id} className="bom-list-row" style={{
                display: 'flex', gap: 4, alignItems: 'center', marginBottom: 2, borderRadius: 8,
                background: isActive ? 'var(--color-accent-50)' : 'transparent',
                border: isActive ? '1px solid var(--color-accent)' : '1px solid transparent',
                transition: 'all 150ms var(--ease-out)',
              }}
                onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--color-surface-2)'; }}
                onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
              >
                <button onClick={() => { void selectProduct(m.id); }} style={{
                  display: 'flex', gap: 12, alignItems: 'center', flex: 1, minWidth: 0, padding: 10,
                  background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                }}>
                  {m.imageUrl ? (
                    // next/image serves a ~40px-optimized thumbnail (not the full R2 original)
                    // and lazy-loads, so a long product list doesn't fetch every photo upfront.
                    <Image src={m.imageUrl} alt={m.name} width={40} height={40} style={{ borderRadius: 8, objectFit: 'cover', flexShrink: 0, display: 'block' }} />
                  ) : (
                    <div style={{ width: 40, height: 40, borderRadius: 8, background: m.color, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{m.tag}</div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name}</div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 3 }}>
                      <span className="num" style={{ fontSize: 11, color: 'var(--color-text-secondary)', fontWeight: 600 }}>{baht(m.price)}</span>
                    </div>
                  </div>
                </button>
                <button
                  onClick={() => duplicateProductById(m)}
                  disabled={duplicating}
                  title="คัดลอกเมนู"
                  aria-label={`คัดลอก ${m.name}`}
                  className="hit-44"
                  style={{
                    flexShrink: 0, background: 'transparent', border: 'none', cursor: duplicating ? 'not-allowed' : 'pointer',
                    display: 'grid', placeItems: 'center', padding: 8, borderRadius: 6,
                    color: 'var(--color-text-muted)', transition: 'all 150ms var(--ease-out)',
                    opacity: duplicatingId === m.id ? 0.5 : 1,
                  }}
                  onMouseEnter={e => { if (!duplicating) { e.currentTarget.style.background = 'var(--color-accent-50)'; e.currentTarget.style.color = 'var(--color-accent)'; } }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-muted)'; }}
                >
                  <Icon name="copy" size={14} />
                </button>
                <button
                  onClick={() => setDeleteTarget(m)}
                  title="ลบเมนู"
                  aria-label={`ลบ ${m.name}`}
                  className="hit-44"
                  style={{
                    flexShrink: 0, marginRight: 8, background: 'transparent', border: 'none', cursor: 'pointer',
                    display: 'grid', placeItems: 'center', padding: 8, borderRadius: 6,
                    color: 'var(--color-text-muted)', transition: 'all 150ms var(--ease-out)',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-danger-50)'; e.currentTarget.style.color = 'var(--color-danger)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-muted)'; }}
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* RIGHT panel */}
      <div className="scroll" style={{ flex: 1, overflow: 'auto', padding: 24 }}>
        {!selectedProduct ? (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--color-text-muted)' }}>เลือกรายการจากรายการด้านซ้าย</div>
        ) : detailLoading ? (
          <div aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <span className="sr-only">กำลังโหลดสูตร</span>
            <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} style={{ flex: 1, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 'var(--space-4)' }}>
                  <Skeleton width="55%" height="var(--space-3)" />
                  <Skeleton width="40%" height="var(--space-6)" style={{ marginTop: 'var(--space-2)' }} />
                </div>
              ))}
            </div>
            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 'var(--space-5)' }}>
              <SkeletonTable rows={5} cols={5} />
            </div>
          </div>
        ) : (
          <>
          <RightPanel
            product={selectedProduct}
            isComponent={isComponent}
            recipe={editedRecipe}
            editedPrice={editedPrice}
            editedCategoryId={editedCategoryId}
            categories={categories ?? []}
            inventoryItems={inventoryItems ?? []}
            totalCost={totalCost}
            isProduced={isBatchProduced}
            batchSize={batchSize}
            editedServingsPerBatch={editedServingsPerBatch}
            onServingsPerBatchChange={changeServingsPerBatch}
            costPerUnit={costPerUnit}
            margin={margin}
            marginPct={marginPct}
            marginToneOf={marginToneOf}
            marginColorOf={marginColorOf}
            onPriceChange={changePrice}
            onCategoryChange={changeCategory}
            onQtyChange={updateQty}
            onRemove={removeItem}
            onPickerOpen={() => setPicker(true)}
            onSave={saveRecipe}
            saving={updateRecipe.isPending || updateProduct.isPending}
            onDeleteRequest={() => setDeleteTarget(selectedProduct)}
            onDuplicate={() => duplicateProductById(selectedProduct)}
            onRename={handleRename}
            duplicating={duplicating}
            linkedGroupIds={productDetail?.modifierGroupIds ?? []}
            allModifierGroups={adminModifierGroups ?? []}
            onModifierGroupPickerOpen={() => setModifierGroupPickerOpen(true)}
          />
          <CookingStepsSection
            steps={editedSteps}
            saving={replaceSteps.isPending}
            canEdit={isAdmin(currentUser?.role)}
            onStepsChange={setEditedSteps}
            onSave={saveSteps}
            newStepText={newStepText}
            onNewStepTextChange={setNewStepText}
          />
          </>
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
      {deleteTarget && (
        <DeleteConfirmModal
          name={deleteTarget.name}
          deleting={deleteProduct.isPending}
          onConfirm={handleDelete}
          onClose={() => setDeleteTarget(null)}
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
      {discardPrompt && (
        <DiscardConfirmModal
          onDiscard={() => settleDiscard(true)}
          onCancel={() => settleDiscard(false)}
        />
      )}
    </div>
  );
}

interface RightPanelProps {
  product: MenuItem;
  isComponent: boolean;
  recipe: RecipeItem[];
  editedPrice: number;
  editedCategoryId: string;
  categories: Category[];
  inventoryItems: InventoryItem[];
  totalCost: number;
  isProduced: boolean;
  batchSize: number;
  editedServingsPerBatch: number;
  onServingsPerBatchChange: (n: number) => void;
  costPerUnit: number;
  margin: number;
  marginPct: number;
  marginToneOf: (pct: number) => 'success' | 'warning' | 'danger';
  marginColorOf: (pct: number) => string;
  onPriceChange: (p: number) => void;
  onCategoryChange: (id: string) => void;
  onQtyChange: (idx: number, qty: number) => void;
  onRemove: (idx: number) => void;
  onPickerOpen: () => void;
  onSave: () => void;
  saving: boolean;
  onDeleteRequest: () => void;
  onDuplicate: () => void;
  onRename: (name: string) => void;
  duplicating: boolean;
  linkedGroupIds: string[];
  allModifierGroups: ModifierGroupRead[];
  onModifierGroupPickerOpen: () => void;
}

// Menu title with an explicit "เปลี่ยนชื่อ" button. Clicking the button (or the
// title) swaps in an input with clear save/cancel buttons. Enter saves, Esc cancels.
const EditableMenuName = ({ name, onRename }: { name: string; onRename: (n: string) => void }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  useEffect(() => { setDraft(name); setEditing(false); }, [name]);

  if (editing) {
    const commit = () => {
      const t = draft.trim();
      if (t && t !== name) onRename(t);
      setEditing(false);
    };
    const cancel = () => { setDraft(name); setEditing(false); };
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '2px 0 8px' }}>
        <input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            else if (e.key === 'Escape') cancel();
          }}
          style={{ flex: 1, minWidth: 0, fontSize: 24, fontWeight: 700, letterSpacing: '-0.01em', fontFamily: 'inherit', border: '1px solid var(--color-accent)', borderRadius: 8, padding: '4px 10px', outline: 'none' }}
        />
        <button onClick={commit} title="บันทึกชื่อ" aria-label="บันทึกชื่อ" className="pressable"
          style={{ flexShrink: 0, display: 'grid', placeItems: 'center', width: 44, height: 44, borderRadius: 8, border: 'none', background: 'var(--color-primary)', color: 'var(--color-text-inverse)', cursor: 'pointer' }}>
          <Icon name="check" size={18} />
        </button>
        <button onClick={cancel} title="ยกเลิก" aria-label="ยกเลิก" className="pressable"
          style={{ flexShrink: 0, display: 'grid', placeItems: 'center', width: 44, height: 44, borderRadius: 8, border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer' }}>
          <Icon name="x" size={18} />
        </button>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '2px 0 8px', minWidth: 0 }}>
      <h1
        onClick={() => setEditing(true)}
        title="คลิกเพื่อเปลี่ยนชื่อ"
        style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: '-0.01em', cursor: 'text', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}
      >
        {name}
      </h1>
      <button
        onClick={() => setEditing(true)}
        title="เปลี่ยนชื่อเมนู"
        aria-label="เปลี่ยนชื่อเมนู"
        style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, transition: 'all 150ms var(--ease-out)' }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-accent-50)'; e.currentTarget.style.color = 'var(--color-accent)'; e.currentTarget.style.borderColor = 'var(--color-accent)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'var(--color-surface-2)'; e.currentTarget.style.color = 'var(--color-text-secondary)'; e.currentTarget.style.borderColor = 'var(--color-border)'; }}
      >
        <Icon name="pencil" size={14} /> เปลี่ยนชื่อ
      </button>
    </div>
  );
};

// Spaced +/- step buttons placed beside a NumberInput. The native number spinner
// is hidden (via the `no-spin` class on the input) because its arrows sit right
// against the digits and are a tiny tap target; these sit apart and are easy to press.
const StepButtons = ({ value, step, min, max, onChange }: { value: number; step: number; min?: number; max?: number; onChange: (n: number) => void }) => {
  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
  const btn: React.CSSProperties = {
    width: 34, height: 28, display: 'grid', placeItems: 'center',
    background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', borderRadius: 8,
    color: 'var(--color-text)', cursor: 'pointer', transition: 'all 120ms var(--ease-out)',
  };
  const hover = (e: React.MouseEvent<HTMLButtonElement>, on: boolean) => {
    e.currentTarget.style.background = on ? 'var(--color-surface)' : 'var(--color-surface-2)';
    e.currentTarget.style.borderColor = on ? 'var(--color-accent)' : 'var(--color-border)';
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <button type="button" aria-label="เพิ่ม" style={btn} onClick={() => onChange(clamp(value + step))} onMouseEnter={e => hover(e, true)} onMouseLeave={e => hover(e, false)}><Icon name="plus" size={15} /></button>
      <button type="button" aria-label="ลด" style={btn} onClick={() => onChange(clamp(value - step))} onMouseEnter={e => hover(e, true)} onMouseLeave={e => hover(e, false)}><Icon name="minus" size={15} /></button>
    </div>
  );
};

const RightPanel = ({ product, isComponent, recipe, editedPrice, editedCategoryId, categories, inventoryItems, totalCost, isProduced, batchSize, editedServingsPerBatch, onServingsPerBatchChange, costPerUnit, margin, marginPct, marginToneOf, marginColorOf, onPriceChange, onCategoryChange, onQtyChange, onRemove, onPickerOpen, onSave, saving, onDeleteRequest, onDuplicate, onRename, duplicating, linkedGroupIds, allModifierGroups, onModifierGroupPickerOpen }: RightPanelProps) => (
  <>
    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 24, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 20 }}>
      <ProductImageControl product={product} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', fontWeight: 500 }}>{product.nameEn}</div>
        <EditableMenuName name={product.name} onRename={onRename} />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <Tag tone={isComponent ? 'accent' : 'info'}>{isComponent ? 'ส่วนผสมทำเอง' : 'เมนูขาย'}</Tag>
          {product.productType === 'PRODUCED' && <Tag tone="accent">ผลิตล่วงหน้า</Tag>}
          <Tag tone={recipe.length > 0 ? 'success' : 'warning'}>{recipe.length > 0 ? `${recipe.length} วัตถุดิบ` : 'ยังไม่มีสูตร'}</Tag>
          {!isComponent && (
            <CategorySelector value={editedCategoryId} categories={categories} onChange={onCategoryChange} />
          )}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20 }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 6 }}>
            {isComponent ? 'ต้นทุน/หน่วย (ประมาณ)' : 'ราคาขาย'}
          </div>
          {isComponent ? (
            // COMPONENT ไม่มีราคาขาย — แสดงต้นทุน/หน่วยที่คำนวณสดจากสูตร (อ่านอย่างเดียว)
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, padding: '4px 0' }}>
              <span style={{ fontSize: 18, color: 'var(--color-text-secondary)' }}>฿</span>
              <span className="num" style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.02em' }}>{costPerUnit.toFixed(2)}</span>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                  <span style={{ fontSize: 18, color: 'var(--color-text-secondary)' }}>฿</span>
                  <NumberInput min={0} step={5} value={editedPrice}
                    onChange={onPriceChange}
                    className="num no-spin"
                    style={{ width: 78, fontSize: 30, fontWeight: 700, textAlign: 'right', border: 'none', borderBottom: '2px solid var(--color-border)', outline: 'none', padding: '4px 0', background: 'transparent', fontFamily: 'inherit', letterSpacing: '-0.02em' }}
                    onFocus={e => e.target.style.borderBottomColor = 'var(--color-accent)'}
                    onBlur={e => e.target.style.borderBottomColor = 'var(--color-border)'}
                  />
                </div>
                <StepButtons value={editedPrice} step={5} min={0} onChange={onPriceChange} />
              </div>
              <div style={{ marginTop: 6, fontSize: 11, color: 'var(--color-text-muted)' }}>รวม VAT 7%</div>
            </>
          )}
        </div>
        {isProduced && (
          <div>
            <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 6 }}>จำนวน/แบทช์</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                <NumberInput
                  min={1}
                  step={1}
                  integer
                  value={editedServingsPerBatch}
                  onChange={onServingsPerBatchChange}
                  className="num no-spin"
                  style={{ width: 56, fontSize: 30, fontWeight: 700, textAlign: 'right', border: 'none', borderBottom: '2px solid var(--color-accent)', outline: 'none', padding: '4px 0', background: 'transparent', fontFamily: 'inherit', letterSpacing: '-0.02em', color: 'var(--color-primary-700)' }}
                  onFocus={e => e.target.style.borderBottomColor = 'var(--color-accent)'}
                  onBlur={e => e.target.style.borderBottomColor = 'var(--color-accent)'}
                />
                <span style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>ชิ้น</span>
              </div>
              <StepButtons value={editedServingsPerBatch} step={1} min={1} onChange={onServingsPerBatchChange} />
            </div>
          </div>
        )}
      </div>
    </div>

    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${isComponent ? 2 : 4}, minmax(0, 1fr))`, gap: 12, marginBottom: 16 }}>
      <SummaryCard
        label={isProduced ? 'ต้นทุนวัตถุดิบ/ชิ้น' : 'ต้นทุนวัตถุดิบ'}
        value={`฿${costPerUnit.toFixed(2)}`}
        hint={isProduced ? `฿${totalCost.toFixed(2)} / ${batchSize} ชิ้น` : undefined}
      />
      {!isComponent && (
        <SummaryCard
          label="ก่อน VAT (ฐาน)"
          value={`฿${exVat(editedPrice).toFixed(2)}`}
          highlight="info"
          hint={`VAT 7% · ฿${(editedPrice - exVat(editedPrice)).toFixed(2)}`}
        />
      )}
      {!isComponent && (
        <SummaryCard label="ส่วนต่าง (Contribution)" value={`฿${margin.toFixed(2)}`} color={margin >= 0 ? 'var(--color-text)' : 'var(--color-danger)'} hint="คิดจากฐานก่อน VAT" />
      )}
      {isComponent
        ? <SummaryCard label="ต้นทุน/หน่วย" value={`฿${costPerUnit.toFixed(2)}`} highlight="info" />
        : <SummaryCard label="Margin" value={`${marginPct.toFixed(1)}%`} highlight={marginToneOf(marginPct)} />
      }
    </div>

    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>ส่วนประกอบ (Bill of Materials)</div>
        <button onClick={onPickerOpen} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', fontSize: 13, fontWeight: 600, background: 'var(--color-primary)', color: 'var(--color-text-inverse)', border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', transition: 'background 150ms var(--ease-out)' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-primary-700)'} onMouseLeave={e => e.currentTarget.style.background = 'var(--color-primary)'}><Icon name="plus" size={14} />เพิ่มวัตถุดิบ</button>
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
            <div style={{ fontSize: 13, fontWeight: 700 }}>{isProduced ? `ต้นทุนรวม/แบทช์ (${batchSize} ชิ้น)` : 'ต้นทุนรวมต่อหน่วยขาย'}</div>
            <div className="num" style={{ fontSize: 16, fontWeight: 800, textAlign: 'right' }}>฿{totalCost.toFixed(2)}</div>
            <div></div>
          </div>
          {isProduced && (
            <div style={{ padding: '10px 20px', display: 'grid', gridTemplateColumns: '1fr 90px 36px', gap: 12, alignItems: 'center', background: 'var(--color-accent-50)', borderTop: '1px solid var(--color-border)' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-primary-700)' }}>÷ {batchSize} ชิ้น = ต้นทุน/ชิ้น</div>
              <div className="num" style={{ fontSize: 15, fontWeight: 800, textAlign: 'right', color: 'var(--color-primary-700)' }}>฿{costPerUnit.toFixed(2)}</div>
              <div></div>
            </div>
          )}
        </>
      )}
    </div>

    <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'space-between', alignItems: 'center' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button onClick={onDuplicate} disabled={duplicating} title="คัดลอกเมนูนี้ พร้อมสูตร ตัวเลือก และขั้นตอนทำ" style={{ padding: '10px 16px', fontSize: 13, fontWeight: 600, background: 'transparent', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 8, cursor: duplicating ? 'not-allowed' : 'pointer', opacity: duplicating ? 0.6 : 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, minWidth: 132, whiteSpace: 'nowrap', fontFamily: 'inherit', transition: 'background-color 150ms var(--ease-out)' }} onMouseEnter={e => { if (!duplicating) e.currentTarget.style.background = 'var(--color-surface-2)'; }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
          <Icon name="copy" size={14} /> {duplicating ? 'กำลังคัดลอก...' : 'คัดลอก'}
        </button>
        <button onClick={onDeleteRequest} style={{ padding: '10px 16px', fontSize: 13, fontWeight: 600, background: 'transparent', color: 'var(--color-danger)', border: '1px solid var(--color-danger)', borderRadius: 8, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'inherit', transition: 'all 150ms var(--ease-out)' }} onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-danger-50)'; }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
          <Icon name="trash" size={14} /> ลบเมนูนี้
        </button>
      </div>
      <button onClick={onSave} disabled={saving} style={{ padding: '10px 20px', fontSize: 14, fontWeight: 600, background: saving ? 'var(--color-surface-2)' : 'var(--color-primary)', color: saving ? 'var(--color-text-muted)' : 'var(--color-text-inverse)', border: 'none', borderRadius: 8, cursor: saving ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'inherit', transition: 'background 150ms var(--ease-out)' }} onMouseEnter={e => { if (!saving) e.currentTarget.style.background = 'var(--color-primary-700)'; }} onMouseLeave={e => { if (!saving) e.currentTarget.style.background = 'var(--color-primary)'; }}>
        <Icon name="check" size={16} />{saving ? 'กำลังบันทึก...' : 'บันทึกสูตร'}
      </button>
    </div>

    <ModifierSection
      productId={product.id}
      linkedGroupIds={linkedGroupIds}
      allModifierGroups={allModifierGroups}
      inventoryItems={inventoryItems}
      onPickerOpen={onModifierGroupPickerOpen}
    />

    {!isComponent && (
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

// ── Category inline selector ─────────────────────────────────────────────────
const CategorySelector = ({ value, categories, onChange }: {
  value: string;
  categories: Category[];
  onChange: (id: string) => void;
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = categories.find(c => c.id === value);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: '3px 8px', fontSize: 11, fontWeight: 600, borderRadius: 20,
          background: current ? 'var(--color-accent-50)' : 'var(--color-surface-2)',
          color: current ? 'var(--color-primary-700)' : 'var(--color-text-muted)',
          border: `1px solid ${current ? 'var(--color-accent)' : 'var(--color-border)'}`,
          cursor: 'pointer', fontFamily: 'inherit', transition: 'all 150ms var(--ease-out)',
          lineHeight: 1.6,
        }}
      >
        {current ? current.label : '+ หมวดหมู่'}
        <Icon name="chevronDown" size={10} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms', flexShrink: 0 }} />
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0,
          background: 'var(--color-surface)', border: '1px solid var(--color-border)',
          borderRadius: 8, boxShadow: 'var(--shadow-md)', zIndex: 200,
          overflow: 'hidden', minWidth: 160,
        }}>
          {[{ id: '', label: '— ไม่มีหมวดหมู่ —' }, ...categories].map(opt => (
            <button
              key={opt.id}
              type="button"
              onClick={() => { onChange(opt.id); setOpen(false); }}
              style={{
                width: '100%', textAlign: 'left', padding: '9px 12px',
                fontSize: 13, fontFamily: 'inherit', cursor: 'pointer', border: 'none',
                background: opt.id === value ? 'var(--color-accent-50)' : 'transparent',
                color: opt.id === value ? 'var(--color-primary-700)' : opt.id === '' ? 'var(--color-text-secondary)' : 'var(--color-text)',
                fontWeight: opt.id === value ? 600 : 400,
                transition: 'background 100ms', display: 'block',
              }}
              onMouseEnter={e => { if (opt.id !== value) e.currentTarget.style.background = 'var(--color-surface-2)'; }}
              onMouseLeave={e => { if (opt.id !== value) e.currentTarget.style.background = 'transparent'; }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

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
        <NumberInput step={1} min={0} value={qty} onChange={onQtyChange} className="num" style={{ textAlign: 'right', fontSize: 14, fontWeight: 600, border: '1px solid var(--color-border)', borderRadius: 6, padding: '6px 10px', outline: 'none', fontFamily: 'inherit', background: 'var(--color-surface)' }} onFocus={e => e.target.style.borderColor = 'var(--color-accent)'} onBlur={e => e.target.style.borderColor = 'var(--color-border)'} />
        <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{inv.unit}</div>
        <div className="num" style={{ fontSize: 13, color: 'var(--color-text-secondary)', textAlign: 'right' }}>฿{inv.costPerUnit.toFixed(2)}</div>
        <div className="num" style={{ fontSize: 14, fontWeight: 700, textAlign: 'right' }}>฿{lineCost.toFixed(2)}</div>
        <button onClick={onRemove} title="ลบวัตถุดิบ" style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'grid', placeItems: 'center', padding: 6, borderRadius: 6, color: 'var(--color-text-muted)', transition: 'all 150ms var(--ease-out)' }} onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-danger-50)'; e.currentTarget.style.color = 'var(--color-danger)'; }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-muted)'; }}><Icon name="trash" size={14} /></button>
      </div>

      {showCalc && (
        <div style={{ padding: '10px 20px 14px', background: 'var(--color-accent-50)', borderBottom: isLast ? 'none' : '1px solid var(--color-border)', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>ซื้อ:</span>
          <input type="number" min={0} step={0.1} value={pkgQty} onChange={e => setPkgQty(e.target.value)} placeholder="ปริมาณ" style={{ width: 70, padding: '5px 8px', border: '1px solid var(--color-border)', borderRadius: 6, fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
          <Select value={pkgUnit} onChange={setPkgUnit} ariaLabel="หน่วยซื้อ" style={{ width: 'auto' }} triggerStyle={{ padding: '5px 8px', fontSize: 13, borderRadius: 6, minWidth: 72 }} menuMaxHeight={220} options={PKG_UNITS.map(u => ({ value: u, label: u }))} />
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

const SummaryCard = ({ label, value, color, highlight, hint }: { label: string; value: string; color?: string; highlight?: 'success' | 'warning' | 'danger' | 'info'; hint?: string }) => {
  const tones = {
    success: { bg: 'var(--color-success-50)', border: 'var(--color-success)', fg: 'var(--color-success)' },
    warning: { bg: 'var(--color-warning-50)', border: 'var(--color-warning)', fg: 'var(--color-warning)' },
    danger:  { bg: 'var(--color-danger-50)',  border: 'var(--color-danger)',  fg: 'var(--color-danger)' },
    info:    { bg: 'var(--color-info-50)',    border: 'var(--color-info)',    fg: 'var(--color-info)' },
  };
  const t = highlight ? tones[highlight] : null;
  return (
    <div style={{ background: t ? t.bg : 'var(--color-surface)', border: t ? `1px solid ${t.border}` : '1px solid var(--color-border)', borderRadius: 12, padding: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: t ? t.fg : 'var(--color-text-secondary)' }}>{label}</div>
      <div className="num" style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', color: t ? t.fg : (color || 'var(--color-text)') }}>{value}</div>
      {hint && <div className="num" style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>{hint}</div>}
    </div>
  );
};

// ── Modifier Group Management ─────────────────────────────────────────────────

const ModifierSection = ({
  productId, linkedGroupIds, allModifierGroups, inventoryItems, onPickerOpen,
}: {
  productId: string;
  linkedGroupIds: string[];
  allModifierGroups: ModifierGroupRead[];
  inventoryItems: InventoryItem[];
  onPickerOpen: () => void;
}) => {
  const linkedGroups = linkedGroupIds
    .map(id => allModifierGroups.find(g => g.id === id))
    .filter((g): g is ModifierGroupRead => g !== undefined);

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
            productId={productId}
            group={group}
            inventoryItems={inventoryItems}
          />
        ))
      )}
    </div>
  );
};

const fmtDelta = (n: number) => n === 0 ? '—' : n > 0 ? `+฿${n}` : `-฿${Math.abs(n)}`;

const ModifierGroupRow = ({ productId, group, inventoryItems }: {
  productId: string;
  group: ModifierGroupRead;
  inventoryItems: InventoryItem[];
}) => {
  const toast = useToast();
  const addModifier = useAddModifier();
  const [addOpen, setAddOpen] = useState(false);
  const [addHover, setAddHover] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDelta, setNewDelta] = useState('0');
  const isRadio = group.max_select === 1;

  const handleAdd = async () => {
    if (!newName.trim()) return;
    try {
      await addModifier.mutateAsync({
        groupId: group.id,
        name: newName.trim(),
        price_delta: newDelta || '0',
      });
      setNewName(''); setNewDelta('0'); setAddOpen(false);
      toast({ kind: 'success', title: 'เพิ่มตัวเลือกแล้ว', msg: newName.trim() });
    } catch (err) {
      toast({ kind: 'danger', title: 'เพิ่มไม่สำเร็จ', msg: err instanceof Error ? err.message : 'กรุณาลองใหม่' });
    }
  };

  return (
    <div style={{ borderBottom: '1px solid var(--color-border)' }}>
      <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 10, background: 'var(--color-surface-2)' }}>
        <div style={{ flex: 1, fontSize: 16, fontWeight: 700 }}>{group.name}</div>
        <Tag tone={group.required ? 'danger' : 'warning'}>{group.required ? 'จำเป็น' : 'ตัวเลือก'}</Tag>
        <Tag tone="info">{isRadio ? 'เลือกได้ 1' : 'เลือกได้หลาย'}</Tag>
        <button
          onClick={() => setAddOpen(v => !v)}
          onMouseEnter={() => setAddHover(true)}
          onMouseLeave={() => setAddHover(false)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '8px 16px', fontSize: 14, fontWeight: 700,
            background: addOpen ? 'var(--color-accent-50)' : 'var(--color-primary)',
            color: addOpen ? 'var(--color-primary-700)' : 'var(--color-text-inverse)',
            border: `1px solid ${addOpen ? 'var(--color-accent)' : 'var(--color-primary)'}`,
            borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
            boxShadow: addOpen ? 'none' : (addHover ? '0 4px 10px rgba(0,0,0,0.16)' : '0 1px 3px rgba(0,0,0,0.12)'),
            transform: !addOpen && addHover ? 'translateY(-1px)' : 'translateY(0)',
            transition: 'all 150ms var(--ease-out)',
          }}
        >
          <Icon name="plus" size={15} /> เพิ่มตัวเลือก
        </button>
      </div>
      {group.modifiers.map(modifier => (
        <ModifierOptionRow key={modifier.id} productId={productId} groupId={group.id} modifier={modifier} inventoryItems={inventoryItems} />
      ))}
      {addOpen && (
        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12, borderTop: '1px solid var(--color-border)', background: 'var(--color-accent-50)' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <input type="text" placeholder="ชื่อตัวเลือก..." value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAdd()} style={{ flex: 1, padding: '10px 14px', fontSize: 15, border: '1px solid var(--color-border)', borderRadius: 8, fontFamily: 'inherit', outline: 'none', background: 'var(--color-surface)' }} autoFocus />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-secondary)' }}>฿</span>
              <input type="number" step="1" placeholder="0" value={newDelta} onChange={e => setNewDelta(e.target.value)} title="ส่วนต่างราคา (ติดลบได้)" style={{ width: 90, padding: '10px 14px', fontSize: 15, textAlign: 'right', border: '1px solid var(--color-border)', borderRadius: 8, fontFamily: 'inherit', outline: 'none', background: 'var(--color-surface)' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => setAddOpen(false)} style={{ padding: '10px 16px', fontSize: 14, fontWeight: 500, background: 'transparent', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' }}>ยกเลิก</button>
            <button onClick={handleAdd} disabled={addModifier.isPending || !newName.trim()} style={{ padding: '10px 20px', fontSize: 15, fontWeight: 600, background: (addModifier.isPending || !newName.trim()) ? 'var(--color-surface-2)' : 'var(--color-primary)', color: (addModifier.isPending || !newName.trim()) ? 'var(--color-text-muted)' : 'var(--color-text-inverse)', border: 'none', borderRadius: 8, cursor: (addModifier.isPending || !newName.trim()) ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
              {addModifier.isPending ? 'กำลังเพิ่ม…' : 'เพิ่มตัวเลือก'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// One option inside a group: shows price delta + inventory link, expands to an
// inline editor (name / price_delta / single-item deduction) and an optional
// multi-ingredient recipe-override editor.
const ModifierOptionRow = ({ productId, groupId, modifier, inventoryItems }: {
  productId: string;
  groupId: string;
  modifier: ModifierRead;
  inventoryItems: InventoryItem[];
}) => {
  const toast = useToast();
  const { t } = useI18n();
  const updateModifier = useUpdateModifier();
  const deleteModifier = useDeleteModifier();
  const [editing, setEditing] = useState(false);
  const [recipeOpen, setRecipeOpen] = useState(false);
  const [name, setName] = useState(modifier.name);
  const [delta, setDelta] = useState(String(modifier.price_delta));

  // Re-sync local edit fields whenever the saved modifier changes (after refetch).
  useEffect(() => {
    setName(modifier.name);
    setDelta(String(modifier.price_delta));
  }, [modifier.name, modifier.price_delta]);

  const deltaNum = Number(modifier.price_delta) || 0;

  const handleSave = async () => {
    try {
      await updateModifier.mutateAsync({
        groupId,
        modifierId: modifier.id,
        name: name.trim() || modifier.name,
        price_delta: delta || '0',
      });
      setEditing(false);
      toast({ kind: 'success', title: 'บันทึกตัวเลือกแล้ว', msg: name.trim() || modifier.name });
    } catch (err) {
      toast({ kind: 'danger', title: 'บันทึกไม่สำเร็จ', msg: err instanceof Error ? err.message : 'กรุณาลองใหม่' });
    }
  };

  const handleDelete = async () => {
    try {
      await deleteModifier.mutateAsync({ groupId, modifierId: modifier.id });
      toast({ kind: 'success', title: 'ลบตัวเลือกแล้ว', msg: modifier.name });
    } catch (err) {
      toast({ kind: 'danger', title: 'ลบไม่สำเร็จ', msg: err instanceof Error ? err.message : 'กรุณาลองใหม่' });
    }
  };

  return (
    <div style={{ borderTop: '1px solid var(--color-border)' }}>
      <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{modifier.name}</div>
        </div>
        <div className="num" style={{ fontSize: 15, fontWeight: 600, minWidth: 56, textAlign: 'right', color: deltaNum === 0 ? 'var(--color-text-muted)' : 'var(--color-text)' }}>{fmtDelta(deltaNum)}</div>
        <button onClick={() => setEditing(v => !v)} title="แก้ไขตัวเลือก" aria-label={`แก้ไข ${modifier.name}`} style={{ display: 'grid', placeItems: 'center', width: 38, height: 38, borderRadius: 8, background: editing ? 'var(--color-accent-50)' : 'transparent', border: 'none', cursor: 'pointer', color: editing ? 'var(--color-accent)' : 'var(--color-text-muted)', transition: 'all 150ms var(--ease-out)' }} onMouseEnter={e => { if (!editing) { e.currentTarget.style.background = 'var(--color-accent-50)'; e.currentTarget.style.color = 'var(--color-accent)'; } }} onMouseLeave={e => { if (!editing) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-muted)'; } }}>
          <Icon name="pencil" size={17} />
        </button>
        <button onClick={handleDelete} disabled={deleteModifier.isPending} title="ลบตัวเลือก" aria-label={`ลบ ${modifier.name}`} style={{ display: 'grid', placeItems: 'center', width: 38, height: 38, borderRadius: 8, background: 'transparent', border: 'none', cursor: deleteModifier.isPending ? 'not-allowed' : 'pointer', color: 'var(--color-text-muted)', transition: 'all 150ms var(--ease-out)' }} onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-danger-50)'; e.currentTarget.style.color = 'var(--color-danger)'; }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-muted)'; }}>
          {deleteModifier.isPending ? '…' : <Icon name="trash" size={17} />}
        </button>
      </div>

      {editing && (
        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12, background: 'var(--color-surface-2)', borderTop: '1px solid var(--color-border)' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="ชื่อตัวเลือก" style={{ flex: 1, padding: '10px 14px', fontSize: 15, border: '1px solid var(--color-border)', borderRadius: 8, fontFamily: 'inherit', outline: 'none', background: 'var(--color-surface)' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-secondary)' }}>฿</span>
              <input type="number" step="1" value={delta} onChange={e => setDelta(e.target.value)} title="ส่วนต่างราคา (ติดลบได้)" style={{ width: 90, padding: '10px 14px', fontSize: 15, textAlign: 'right', border: '1px solid var(--color-border)', borderRadius: 8, fontFamily: 'inherit', outline: 'none', background: 'var(--color-surface)' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <button onClick={() => setRecipeOpen(v => !v)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 14px', fontSize: 14, fontWeight: 600, background: recipeOpen ? 'var(--color-accent-50)' : 'transparent', color: recipeOpen ? 'var(--color-primary-700)' : 'var(--color-text-secondary)', border: `1px solid ${recipeOpen ? 'var(--color-accent)' : 'var(--color-border)'}`, borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' }}>
              <Icon name="chevronDown" size={14} style={{ transform: recipeOpen ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }} /> {t.modifierRecipe.trigger}
            </button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setEditing(false)} style={{ padding: '10px 16px', fontSize: 14, fontWeight: 500, background: 'transparent', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' }}>ปิด</button>
              <button onClick={handleSave} disabled={updateModifier.isPending} style={{ padding: '10px 20px', fontSize: 15, fontWeight: 600, background: updateModifier.isPending ? 'var(--color-surface-2)' : 'var(--color-primary)', color: updateModifier.isPending ? 'var(--color-text-muted)' : 'var(--color-text-inverse)', border: 'none', borderRadius: 8, cursor: updateModifier.isPending ? 'not-allowed' : 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Icon name="check" size={16} />{updateModifier.isPending ? 'กำลังบันทึก…' : 'บันทึก'}
              </button>
            </div>
          </div>
          {recipeOpen && (
            <ModifierRecipeEditor productId={productId} modifierId={modifier.id} inventoryItems={inventoryItems} />
          )}
        </div>
      )}
    </div>
  );
};

// Per-menu modifier deduction editor: a full set of {inventory_item_id, quantity,
// mode} rows that rewrite THIS product's base recipe when the modifier is chosen.
// Keyed on (product_id, modifier_id) — configuring it here has no effect on the
// same modifier attached to other products. Saving does a bulk replace (the
// complete desired set each call; empty rows are dropped).
const ModifierRecipeEditor = ({ productId, modifierId, inventoryItems }: {
  productId: string;
  modifierId: string;
  inventoryItems: InventoryItem[];
}) => {
  const toast = useToast();
  const { t } = useI18n();
  const { data: items, isLoading } = useModifierRecipeItems(productId, modifierId, true);
  const replace = useReplaceModifierRecipeItems();
  const [rows, setRows] = useState<ModifierRecipeItemInput[]>([]);

  useEffect(() => {
    setRows((items ?? []).map(it => ({
      inventory_item_id: it.inventory_item_id,
      quantity: String(it.quantity),
      mode: it.mode,
    })));
  }, [items]);

  const updateRow = (idx: number, patch: Partial<ModifierRecipeItemInput>) =>
    setRows(r => r.map((x, i) => i === idx ? { ...x, ...patch } : x));
  const removeRow = (idx: number) => setRows(r => r.filter((_, i) => i !== idx));
  const addRow = () => setRows(r => [...r, { inventory_item_id: '', quantity: '0', mode: 'override' }]);

  const handleSave = async () => {
    const clean = rows
      .filter(r => r.inventory_item_id)
      .map(r => ({ inventory_item_id: r.inventory_item_id, quantity: r.quantity || '0', mode: r.mode }));
    try {
      await replace.mutateAsync({ productId, modifierId, items: clean });
      toast({ kind: 'success', title: t.modifierRecipe.saved, msg: t.modifierRecipe.savedCount(clean.length) });
    } catch (err) {
      toast({ kind: 'danger', title: t.modifierRecipe.saveFailed, msg: err instanceof Error ? err.message : t.modifierRecipe.tryAgain });
    }
  };

  return (
    <div style={{ padding: 12, border: '1px dashed var(--color-border)', borderRadius: 8, background: 'var(--color-surface)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
        <strong>{t.modifierRecipe.helpOverrideLabel}</strong>{t.modifierRecipe.helpOverrideDesc}
        <strong>{t.modifierRecipe.helpDeltaLabel}</strong>{t.modifierRecipe.helpDeltaDesc}
      </div>
      {isLoading ? (
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: 8 }}>{t.modifierRecipe.loading}</div>
      ) : rows.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: 8 }}>{t.modifierRecipe.empty}</div>
      ) : rows.map((row, idx) => (
        <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Select
            value={row.inventory_item_id}
            onChange={v => updateRow(idx, { inventory_item_id: v })}
            ariaLabel={t.modifierRecipe.ingredientAria}
            style={{ minWidth: 170 }}
            triggerStyle={{ padding: '6px 10px', fontSize: 13, borderRadius: 6 }}
            menuMaxHeight={240}
            options={[{ value: '', label: t.modifierRecipe.selectIngredient }, ...inventoryItems.map(i => ({ value: i.id, label: i.name }))]}
          />
          <input type="number" step={0.1} value={row.quantity} onChange={e => updateRow(idx, { quantity: e.target.value })} title={t.modifierRecipe.qtyTitle} style={{ width: 84, padding: '6px 10px', fontSize: 13, textAlign: 'right', border: '1px solid var(--color-border)', borderRadius: 6, fontFamily: 'inherit', outline: 'none', background: 'var(--color-surface)' }} />
          <div style={{ display: 'flex', border: '1px solid var(--color-border)', borderRadius: 6, overflow: 'hidden' }}>
            {(['override', 'delta'] as const).map(m => (
              <button key={m} onClick={() => updateRow(idx, { mode: m })} style={{ padding: '6px 10px', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: 'inherit', background: row.mode === m ? 'var(--color-primary)' : 'var(--color-surface)', color: row.mode === m ? 'var(--color-text-inverse)' : 'var(--color-text-secondary)' }}>
                {m === 'override' ? t.modifierRecipe.modeOverride : t.modifierRecipe.modeDelta}
              </button>
            ))}
          </div>
          <button onClick={() => removeRow(idx)} title={t.modifierRecipe.removeRow} style={{ display: 'grid', placeItems: 'center', width: 28, height: 28, borderRadius: 6, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }} onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-danger-50)'; e.currentTarget.style.color = 'var(--color-danger)'; }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-muted)'; }}>
            <Icon name="trash" size={13} />
          </button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
        <button onClick={addRow} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 12px', fontSize: 12, fontWeight: 600, background: 'transparent', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' }}>
          <Icon name="plus" size={12} /> {t.modifierRecipe.addIngredient}
        </button>
        <button onClick={handleSave} disabled={replace.isPending} style={{ padding: '7px 16px', fontSize: 13, fontWeight: 600, background: replace.isPending ? 'var(--color-surface-2)' : 'var(--color-primary)', color: replace.isPending ? 'var(--color-text-muted)' : 'var(--color-text-inverse)', border: 'none', borderRadius: 6, cursor: replace.isPending ? 'not-allowed' : 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Icon name="check" size={14} />{replace.isPending ? t.modifierRecipe.saving : t.modifierRecipe.saveBtn}
        </button>
      </div>
    </div>
  );
};

// ── Product image control (upload / replace / remove a menu photo) ────────────
const ProductImageControl = ({ product }: { product: MenuItem }) => {
  const toast = useToast();
  const uploadImage = useUploadProductImage();
  const deleteImage = useDeleteProductImage();
  const fileRef = useRef<HTMLInputElement>(null);
  // The picked file waits in the crop modal; only the framed square uploads.
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  // True while fetching the *existing* photo so it can be re-framed in the modal.
  const [loadingExisting, setLoadingExisting] = useState(false);
  // Tapping the thumbnail opens a full-size preview.
  const [preview, setPreview] = useState(false);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';  // allow re-picking the same file
    if (!file) return;
    setPendingFile(file);  // open the crop step (or swap the source if already open)
  };

  // Load the current R2 photo through our same-origin proxy so the crop canvas
  // can read it (a cross-origin image would taint the canvas). On failure, fall
  // back to picking a fresh file so the user is never stuck.
  const editExisting = async () => {
    if (!product.imageUrl) { fileRef.current?.click(); return; }
    setLoadingExisting(true);
    try {
      const res = await fetch(`/api/image-proxy?url=${encodeURIComponent(product.imageUrl)}`);
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const type = blob.type || 'image/webp';
      setPendingFile(new File([blob], `current.${type.split('/')[1] || 'webp'}`, { type }));
    } catch {
      toast({ kind: 'warning', title: 'แก้ไขรูปเดิมไม่ได้', msg: 'เลือกรูปใหม่แทน' });
      fileRef.current?.click();
    } finally {
      setLoadingExisting(false);
    }
  };

  const onCropConfirm = (file: File) => {
    setPendingFile(null);
    uploadImage.mutate({ productId: product.id, file }, {
      onSuccess: () => toast({ kind: 'success', title: 'อัปโหลดรูปแล้ว', msg: product.name }),
      onError: (err) => toast({ kind: 'danger', title: 'อัปโหลดไม่สำเร็จ', msg: err instanceof Error ? err.message : 'กรุณาลองใหม่' }),
    });
  };

  const onRemove = () => {
    setPendingFile(null);  // close the crop modal if the delete came from inside it
    deleteImage.mutate(product.id, {
      onSuccess: () => toast({ kind: 'success', title: 'ลบรูปแล้ว', msg: product.name }),
      onError: (err) => toast({ kind: 'danger', title: 'ลบรูปไม่สำเร็จ', msg: err instanceof Error ? err.message : 'กรุณาลองใหม่' }),
    });
  };

  const busy = uploadImage.isPending || deleteImage.isPending || loadingExisting;

  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPreview(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [preview]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flexShrink: 0 }}>
      <div
        onClick={() => product.imageUrl && setPreview(true)}
        title={product.imageUrl ? 'ดูรูปเต็ม' : undefined}
        style={{ position: 'relative', width: 80, height: 80, borderRadius: 12, overflow: 'hidden', flexShrink: 0, cursor: product.imageUrl ? 'zoom-in' : 'default' }}
      >
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={product.imageUrl} alt={product.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', background: product.color, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 26, fontWeight: 800 }}>{product.tag}</div>
        )}
        {busy && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'grid', placeItems: 'center', color: '#fff', fontSize: 11, fontWeight: 600 }}>…</div>
        )}
      </div>
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={onPick} style={{ display: 'none' }} />
      <div style={{ display: 'flex', gap: 4 }}>
        <button onClick={() => (product.imageUrl ? editExisting() : fileRef.current?.click())} disabled={busy} style={{ padding: '4px 8px', fontSize: 11, fontWeight: 600, background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)', borderRadius: 6, cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
          {product.imageUrl ? 'เปลี่ยนรูป' : '＋ รูป'}
        </button>
        {product.imageUrl && (
          <button onClick={onRemove} disabled={busy} title="ลบรูป" aria-label="ลบรูป" style={{ padding: '4px 8px', fontSize: 11, fontWeight: 600, background: 'transparent', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)', borderRadius: 6, cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
            ลบ
          </button>
        )}
      </div>
      {pendingFile && (
        <ImageCropModal
          file={pendingFile}
          onCancel={() => setPendingFile(null)}
          onConfirm={onCropConfirm}
          onPickNew={() => fileRef.current?.click()}
          {...(product.imageUrl ? { onDelete: onRemove } : {})}
        />
      )}
      {preview && product.imageUrl && createPortal(
        <div
          onClick={() => setPreview(false)}
          role="dialog"
          aria-modal="true"
          aria-label={`รูป ${product.name}`}
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.8)', display: 'grid', placeItems: 'center', padding: 24, cursor: 'zoom-out' }}
        >
          {/* Full-res zoom view, rendered only when opened — keep a plain <img> so the
              original is shown unscaled; decode off the main thread. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={product.imageUrl}
            alt={product.name}
            decoding="async"
            onClick={e => e.stopPropagation()}
            style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain', borderRadius: 12, boxShadow: '0 12px 48px rgba(0,0,0,0.5)' }}
          />
          <button
            type="button"
            onClick={() => setPreview(false)}
            aria-label="ปิด"
            style={{ position: 'absolute', top: 16, right: 16, width: 40, height: 40, borderRadius: 20, border: 'none', background: 'rgba(255,255,255,0.15)', color: '#fff', fontSize: 20, lineHeight: 1, cursor: 'pointer', display: 'grid', placeItems: 'center' }}
          >
            ✕
          </button>
        </div>,
        document.body
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
    <div className="modal-backdrop" style={{ alignItems: 'center', padding: 'var(--space-5)' }} onClick={onClose}>
      <div className="modal-card" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 520, maxHeight: '75vh', display: 'flex', flexDirection: 'column' }}>
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
                  {checked && <Icon name="check" size={12} color="var(--color-text-inverse)" />}
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
          <button onClick={() => onConfirm([...selected])} disabled={saving} style={{ padding: '9px 16px', fontSize: 13, fontWeight: 600, background: saving ? 'var(--color-surface-2)' : 'var(--color-primary)', color: saving ? 'var(--color-text-muted)' : 'var(--color-text-inverse)', border: 'none', borderRadius: 8, cursor: saving ? 'not-allowed' : 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6, transition: 'background 150ms var(--ease-out)' }}>
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
    <div className="modal-backdrop" style={{ alignItems: 'center', padding: 'var(--space-5)' }} onClick={onClose}>
      <div className="modal-card" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 520, maxHeight: '75vh', display: 'flex', flexDirection: 'column' }}>
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

        {selected.size > 0 && (
          <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--color-border)', background: 'var(--color-accent-50)', display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', maxHeight: 140, overflowY: 'auto', flexShrink: 0 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>เลือกแล้ว:</span>
            {[...selected].map(id => {
              const inv = inventory.find(i => i.id === id);
              if (!inv) return null;
              return (
                <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px 3px 10px', background: 'var(--color-surface)', border: '1px solid var(--color-accent)', borderRadius: 20, fontSize: 12, fontWeight: 600, color: 'var(--color-primary-700)' }}>
                  {inv.name}
                  <button onClick={() => toggle(id)} aria-label={`เอา ${inv.name} ออก`} title="เอาออก" style={{ minWidth: 24, minHeight: 24, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, display: 'grid', placeItems: 'center', color: 'var(--color-text-muted)', lineHeight: 1 }}>
                    <Icon name="x" size={11} />
                  </button>
                </span>
              );
            })}
          </div>
        )}

        <div className="scroll" style={{ overflow: 'auto', flex: 1, padding: 8 }}>
          {list.map(inv => {
            const already = existingIds.includes(inv.id);
            const checked = selected.has(inv.id);
            return (
              <button key={inv.id} onClick={() => !already && toggle(inv.id)} disabled={already} style={{ display: 'flex', gap: 12, alignItems: 'center', width: '100%', padding: 12, marginBottom: 2, borderRadius: 8, background: checked ? 'var(--color-accent-50)' : 'transparent', border: checked ? '1px solid var(--color-accent)' : '1px solid transparent', cursor: already ? 'not-allowed' : 'pointer', textAlign: 'left', opacity: already ? 0.5 : 1, transition: 'all 150ms var(--ease-out)', fontFamily: 'inherit' }} onMouseEnter={e => { if (!already && !checked) e.currentTarget.style.background = 'var(--color-surface-2)'; }} onMouseLeave={e => { if (!checked) e.currentTarget.style.background = 'transparent'; }}>
                <div style={{ width: 20, height: 20, borderRadius: 4, border: `2px solid ${checked ? 'var(--color-accent)' : 'var(--color-border)'}`, background: checked ? 'var(--color-accent)' : 'transparent', display: 'grid', placeItems: 'center', flexShrink: 0, transition: 'all 150ms var(--ease-out)' }}>
                  {checked && <Icon name="check" size={12} color="var(--color-text-inverse)" />}
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
          <button onClick={() => canAdd && onConfirm([...selected])} disabled={!canAdd} style={{ padding: '9px 16px', fontSize: 13, fontWeight: 600, background: canAdd ? 'var(--color-primary)' : 'var(--color-surface-2)', color: canAdd ? 'var(--color-text-inverse)' : 'var(--color-text-muted)', border: 'none', borderRadius: 8, cursor: canAdd ? 'pointer' : 'not-allowed', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6, transition: 'background 150ms var(--ease-out)' }} onMouseEnter={e => { if (canAdd) e.currentTarget.style.background = 'var(--color-primary-700)'; }} onMouseLeave={e => { if (canAdd) e.currentTarget.style.background = 'var(--color-primary)'; }}>
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
  <div className="modal-backdrop" style={{ alignItems: 'center', padding: 'var(--space-5)' }} onClick={onClose}>
    <div className="modal-card" role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 520, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
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

const DiscardConfirmModal = ({ onDiscard, onCancel }: {
  onDiscard: () => void; onCancel: () => void;
}) => (
  <BomModalShell title="ยังไม่ได้บันทึก" subtitle="มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก" onClose={onCancel}>
    <div style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 20, lineHeight: 1.7 }}>
      หากออกตอนนี้ การเปลี่ยนแปลงที่แก้ไว้จะหายไป ต้องการทิ้งการเปลี่ยนแปลงหรือไม่?
    </div>
    <BomModalActions>
      <button onClick={onCancel} style={{ padding: '10px 16px', fontSize: 13, fontWeight: 600, background: 'transparent', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' }}>อยู่ต่อ</button>
      <button onClick={onDiscard} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 16px', fontSize: 13, fontWeight: 600, background: 'var(--color-danger)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', transition: 'background 150ms var(--ease-out)' }}>
        <Icon name="trash" size={14} />ทิ้งการเปลี่ยนแปลง
      </button>
    </BomModalActions>
  </BomModalShell>
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
      <button onClick={onConfirm} disabled={deleting} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 16px', fontSize: 13, fontWeight: 600, background: deleting ? 'var(--color-surface-2)' : 'var(--color-danger)', color: deleting ? 'var(--color-text-muted)' : 'var(--color-text-inverse)', border: 'none', borderRadius: 8, cursor: deleting ? 'not-allowed' : 'pointer', fontFamily: 'inherit', transition: 'background 150ms var(--ease-out)' }}>
        <Icon name="trash" size={14} />{deleting ? 'กำลังลบ...' : 'ยืนยันลบ'}
      </button>
    </BomModalActions>
  </BomModalShell>
);

const AddMenuModal = ({ categories, onClose, onSubmit }: {
  categories: import('@/hooks/use-products').Category[];
  onClose: () => void;
  onSubmit: (v: { name: string; categoryId: string; price: number; description: string; type: ProductType; apiProductType: ApiProductType; servingsPerBatch: number }) => void;
}) => {
  const [type, setType] = useState<ProductType>('MENU');
  const [apiProductType, setApiProductType] = useState<ApiProductType>('MADE_TO_ORDER');
  const [servingsPerBatch, setServingsPerBatch] = useState('24');
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const isComp = type === 'COMPONENT';
  const needsServings = isComp || (type === 'MENU' && apiProductType === 'PRODUCED');
  const canSubmit = name.trim().length > 0
    && (isComp || (price !== '' && Number(price) >= 0))
    && (!needsServings || (servingsPerBatch !== '' && Number(servingsPerBatch) >= 1));
  const submit = () => { if (!canSubmit) return; onSubmit({ name: name.trim(), categoryId, price: Number(price), description: description.trim(), type, apiProductType, servingsPerBatch: Math.max(1, Math.floor(Number(servingsPerBatch) || 1)) }); };

  return (
    <BomModalShell title="เพิ่มรายการใหม่" subtitle="สร้างรายการในระบบ BOM" onClose={onClose}>
      {/* Type toggle */}
      <BomFormField label="ประเภท *">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {(['MENU', 'COMPONENT'] as ProductType[]).map(t => (
            <button key={t} onClick={() => setType(t)} style={{ padding: '10px 12px', borderRadius: 8, border: `2px solid ${type === t ? 'var(--color-accent)' : 'var(--color-border)'}`, background: type === t ? 'var(--color-accent-50)' : 'transparent', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', color: type === t ? 'var(--color-primary-700)' : 'var(--color-text-secondary)', transition: 'all 150ms var(--ease-out)' }}>
              {t === 'MENU' ? '🍵 เมนูขาย' : '🧪 ส่วนผสมทำเอง'}
              <div style={{ fontSize: 11, fontWeight: 400, marginTop: 2, color: type === t ? 'var(--color-text-secondary)' : 'var(--color-text-muted)' }}>
                {t === 'MENU' ? 'จำหน่ายให้ลูกค้า' : 'ผลิตเอง · ไม่ขาย · ใช้ในสูตรอื่น'}
              </div>
            </button>
          ))}
        </div>
      </BomFormField>

      {type === 'MENU' && (
        <BomFormField label="วิธีผลิต *">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {(['MADE_TO_ORDER', 'PRODUCED'] as ApiProductType[]).map(t => (
              <button key={t} onClick={() => setApiProductType(t)} style={{ padding: '10px 12px', borderRadius: 8, border: `2px solid ${apiProductType === t ? 'var(--color-accent)' : 'var(--color-border)'}`, background: apiProductType === t ? 'var(--color-accent-50)' : 'transparent', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', color: apiProductType === t ? 'var(--color-primary-700)' : 'var(--color-text-secondary)', transition: 'all 150ms var(--ease-out)' }}>
                {t === 'MADE_TO_ORDER' ? '🛎️ ทำตามออเดอร์' : '🏭 ผลิตล่วงหน้า'}
                <div style={{ fontSize: 11, fontWeight: 400, marginTop: 2, color: apiProductType === t ? 'var(--color-text-secondary)' : 'var(--color-text-muted)' }}>
                  {t === 'MADE_TO_ORDER' ? 'หักวัตถุดิบตามออเดอร์' : 'หักจากสต็อกสำเร็จรูป'}
                </div>
              </button>
            ))}
          </div>
        </BomFormField>
      )}

      {needsServings && (
        <BomFormField label="จำนวนหน่วย/แบทช์ *">
          <input type="number" min={1} step={1} inputMode="numeric" value={servingsPerBatch} onChange={e => setServingsPerBatch(e.target.value)} placeholder="เช่น 24" style={bomInputStyle()} />
        </BomFormField>
      )}

      <BomFormField label="ชื่อ *">
        <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder={type === 'MENU' ? 'เช่น Flat White, ครัวซองต์เนย' : 'เช่น น้ำเชื่อมชาไทย, เบสเยลลี่'} style={bomInputStyle()} autoFocus />
      </BomFormField>

      {type === 'MENU' && (
        <BomFormField label="หมวดหมู่">
          <Select
            value={categoryId}
            onChange={setCategoryId}
            ariaLabel="หมวดหมู่"
            options={[
              { value: '', label: '— ไม่ระบุหมวดหมู่ —' },
              ...categories.map(c => ({ value: c.id, label: c.label })),
            ]}
          />
        </BomFormField>
      )}

      {!isComp && (
        <BomFormField label="ราคาขาย (฿) *">
          <input type="number" min={0} step={5} value={price} onChange={e => setPrice(e.target.value)} placeholder="0" style={bomInputStyle()} />
        </BomFormField>
      )}

      <BomFormField label="รายละเอียด">
        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} placeholder="ไม่บังคับ" style={{ ...bomInputStyle(), resize: 'vertical', fontFamily: 'inherit' }} />
      </BomFormField>


      <BomModalActions>
        <button onClick={onClose} style={{ padding: '10px 16px', fontSize: 13, fontWeight: 600, background: 'transparent', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' }}>ยกเลิก</button>
        <button onClick={submit} disabled={!canSubmit} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 16px', fontSize: 13, fontWeight: 600, background: 'var(--color-primary)', color: 'var(--color-text-inverse)', border: 'none', borderRadius: 8, cursor: canSubmit ? 'pointer' : 'not-allowed', fontFamily: 'inherit', opacity: canSubmit ? 1 : 0.45, transition: 'background 150ms var(--ease-out)' }} onMouseEnter={e => { if (canSubmit) e.currentTarget.style.background = 'var(--color-primary-700)'; }} onMouseLeave={e => { e.currentTarget.style.background = 'var(--color-primary)'; }}><Icon name="plus" size={14} /> เพิ่มรายการ</button>
      </BomModalActions>
    </BomModalShell>
  );
};

// ── Cooking Steps Section ─────────────────────────────────────────────────────
const CookingStepsSection = ({
  steps, saving, canEdit, onStepsChange, onSave, newStepText, onNewStepTextChange,
}: {
  steps: CookingStepRead[];
  saving: boolean;
  canEdit: boolean;
  onStepsChange: (steps: CookingStepRead[]) => void;
  onSave: () => void;
  newStepText: string;
  onNewStepTextChange: (v: string) => void;
}) => {
  const moveUp = (idx: number) => {
    if (idx === 0) return;
    const next = [...steps];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    onStepsChange(next);
  };

  const moveDown = (idx: number) => {
    if (idx === steps.length - 1) return;
    const next = [...steps];
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    onStepsChange(next);
  };

  const removeStep = (idx: number) => {
    onStepsChange(steps.filter((_, i) => i !== idx));
  };

  const addStep = () => {
    const text = newStepText.trim();
    if (!text) return;
    onStepsChange([...steps, { id: `local-${Date.now()}`, sort_order: steps.length, instruction: text }]);
    onNewStepTextChange('');
  };

  return (
    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, overflow: 'hidden', marginTop: 16 }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>วิธีการทำ (Cooking Steps)</div>
        {canEdit && (
          <button
            onClick={onSave}
            disabled={saving}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', fontSize: 13, fontWeight: 600, background: saving ? 'var(--color-surface-2)' : 'var(--color-primary)', color: saving ? 'var(--color-text-muted)' : 'var(--color-text-inverse)', border: 'none', borderRadius: 8, cursor: saving ? 'not-allowed' : 'pointer', fontFamily: 'inherit', transition: 'background 150ms var(--ease-out)' }}
            onMouseEnter={e => { if (!saving) e.currentTarget.style.background = 'var(--color-primary-700)'; }}
            onMouseLeave={e => { if (!saving) e.currentTarget.style.background = saving ? 'var(--color-surface-2)' : 'var(--color-primary)'; }}
          >
            <Icon name="check" size={14} />{saving ? 'กำลังบันทึก...' : 'บันทึกขั้นตอน'}
          </button>
        )}
      </div>

      {steps.length === 0 ? (
        <div style={{ padding: '28px 20px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
          {canEdit ? 'ยังไม่มีขั้นตอน กด + เพิ่มขั้นตอนแรก' : 'ยังไม่มีขั้นตอนการทำ'}
        </div>
      ) : (
        steps.map((step, idx) => (
          <div key={step.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 20px', borderBottom: '1px solid var(--color-border)' }}>
            <div className="num" style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', width: 20, textAlign: 'right', flexShrink: 0 }}>{idx + 1}</div>
            {canEdit && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
                <button onClick={() => moveUp(idx)} disabled={idx === 0} title="เลื่อนขึ้น" style={{ background: 'transparent', border: 'none', cursor: idx === 0 ? 'not-allowed' : 'pointer', padding: '2px 4px', borderRadius: 4, color: idx === 0 ? 'var(--color-text-muted)' : 'var(--color-text-secondary)', fontSize: 10, lineHeight: 1 }}>▲</button>
                <button onClick={() => moveDown(idx)} disabled={idx === steps.length - 1} title="เลื่อนลง" style={{ background: 'transparent', border: 'none', cursor: idx === steps.length - 1 ? 'not-allowed' : 'pointer', padding: '2px 4px', borderRadius: 4, color: idx === steps.length - 1 ? 'var(--color-text-muted)' : 'var(--color-text-secondary)', fontSize: 10, lineHeight: 1 }}>▼</button>
              </div>
            )}
            <div style={{ flex: 1, fontSize: 14, lineHeight: 1.5 }}>{step.instruction}</div>
            {canEdit && (
              <button onClick={() => removeStep(idx)} title="ลบขั้นตอน" style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'grid', placeItems: 'center', padding: 6, borderRadius: 6, color: 'var(--color-text-muted)', flexShrink: 0, transition: 'all 150ms var(--ease-out)' }} onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-danger-50)'; e.currentTarget.style.color = 'var(--color-danger)'; }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-muted)'; }}>
                <Icon name="x" size={14} />
              </button>
            )}
          </div>
        ))
      )}

      {canEdit && (
        <div style={{ padding: '10px 20px', display: 'flex', gap: 8, alignItems: 'center', background: steps.length > 0 ? 'var(--color-surface-2)' : 'transparent' }}>
          <input
            type="text"
            placeholder="เพิ่มขั้นตอน... เช่น ต้มน้ำ 500ml"
            value={newStepText}
            onChange={e => onNewStepTextChange(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addStep()}
            style={{ flex: 1, padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', outline: 'none', background: 'var(--color-surface)' }}
          />
          <button
            onClick={addStep}
            disabled={!newStepText.trim()}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '8px 14px', fontSize: 13, fontWeight: 600, background: newStepText.trim() ? 'var(--color-surface)' : 'var(--color-surface-2)', color: newStepText.trim() ? 'var(--color-text)' : 'var(--color-text-muted)', border: '1px solid var(--color-border)', borderRadius: 8, cursor: newStepText.trim() ? 'pointer' : 'not-allowed', fontFamily: 'inherit', transition: 'all 150ms var(--ease-out)' }}
            onMouseEnter={e => { if (newStepText.trim()) e.currentTarget.style.background = 'var(--color-accent-50)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = newStepText.trim() ? 'var(--color-surface)' : 'var(--color-surface-2)'; }}
          >
            <Icon name="plus" size={13} /> เพิ่ม
          </button>
        </div>
      )}
    </div>
  );
};
