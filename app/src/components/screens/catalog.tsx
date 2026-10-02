'use client';

import { useState } from 'react';
import { useToast, Select, NumberInput, MasterDetail, ModalShell } from '../app-common';
import { useFadeRise } from '@/lib/motion';
import { Skeleton, SkeletonTable } from '@/components/ui/skeleton';
import { useCurrentUser, isAdmin } from '@/hooks/use-current-user';
import { TABLE_TIME_PRODUCT_NAME } from '@/hooks/use-features';
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
import {
  useProductsAdmin,
  useUpdateProductAdmin,
  type ProductReadAdmin,
  type ProductUpdateAdminPayload,
} from '@/hooks/use-products';
import { ApiError } from '@/lib/api-client';
import { useIsPhone } from '@/hooks/use-media-query';

// Dialogs use the shared <ModalShell> (portaled to <body>, capped to the visible
// screen, scrollable body + pinned footer, focus trap / Esc / focus restore).

// Phone-only rules (< 768px) the shared toolkit cannot express. The three tables
// become stacked cards (`.row-cards` gives the card chrome; the grids below lay the
// cells out), inline font sizes / min-heights are lifted to the touch minimums, and
// the modifier-group form gets a sticky action row. `.cat-form` marks form content
// inside a portaled ModalShell. Nothing here applies at >= 768px.
const CAT_PHONE_CSS = `
@media (max-width: 767px) {
  .cat-screen input:not([type='checkbox']), .cat-screen textarea,
  .cat-form input:not([type='checkbox']), .cat-form textarea { font-size: 16px !important; min-height: 44px; }
  .cat-screen button, .cat-form button { min-height: 44px !important; }
  .cat-check { min-height: 44px; }
  .cat-check input { width: 20px !important; height: 20px !important; }

  .cat-tabs { width: 100% !important; }
  .cat-tabs > button { flex: 1 1 0; padding: 7px 4px !important; }

  .cat-table-wrap { background: transparent !important; border: 0 !important; border-radius: 0 !important; overflow: visible !important; }
  .cat-table-head { padding: 0 0 10px !important; border: 0 !important; }
  .cat-table-wrap .row-card > td { padding: 0 !important; border: 0 !important; width: auto !important; min-width: 0; }
  .cat-table-wrap .row-card > td.hide-phone { display: none !important; }

  .cat-prod .row-card { display: grid !important; grid-template-columns: auto minmax(0, 1fr) auto; grid-template-areas: 'name name price' 'status cat act'; align-items: center; gap: 4px 10px; padding: 10px 12px 8px 14px !important; }
  .cat-prod .c-name { grid-area: name; font-size: 15px; font-weight: 600 !important; overflow-wrap: anywhere; }
  .cat-prod .c-price { grid-area: price; font-size: 15px; font-weight: 600; text-align: right; white-space: nowrap; }
  .cat-prod .c-status { grid-area: status; }
  .cat-prod .c-status > span { font-size: 12px !important; }
  .cat-prod .c-cat { grid-area: cat; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cat-prod .c-act { grid-area: act; text-align: right; }
  .cat-prod .c-act > button { min-width: 72px; }

  .cat-cats .row-card { display: grid !important; grid-template-columns: auto minmax(0, 1fr) auto; grid-template-areas: 'num name move' 'act act act'; align-items: center; gap: 8px 10px; padding: 10px 12px !important; }
  .cat-cats .c-num { grid-area: num; min-width: 28px; text-align: left !important; font-size: 13px; }
  .cat-cats .c-name { grid-area: name; font-size: 15px; overflow-wrap: anywhere; }
  .cat-cats .c-move { grid-area: move; white-space: nowrap; }
  .cat-cats .c-move > button { min-width: 44px !important; margin: 0 0 0 6px !important; font-size: 16px !important; }
  .cat-cats .c-act { grid-area: act; display: flex; gap: 8px; padding-top: 8px !important; border-top: 1px solid var(--color-border) !important; }
  .cat-cats .c-act > button { flex: 1 1 0; margin: 0 !important; }
  .cat-cats .row-card[data-editing] { grid-template-areas: 'num name name'; }
  .cat-cats .row-card[data-editing] .c-move, .cat-cats .row-card[data-editing] .c-act { display: none !important; }
  .cat-inline-edit { flex-wrap: wrap; }
  .cat-inline-edit > input { flex: 1 1 100%; padding: 8px 12px !important; }
  .cat-inline-edit > button { flex: 1 1 0; }

  .cat-md .md-back-bar { position: sticky; top: calc(-1 * var(--screen-pad)); z-index: 2; margin-bottom: 8px; border: 1px solid var(--color-border); border-radius: var(--radius-lg); }
  .cat-group-list { max-height: none !important; }
  .cat-group-row { min-height: 52px; }
  .cat-x { min-width: 44px; }
  .cat-detail-card { overflow: visible !important; }
  .cat-detail-empty { display: none !important; }

  .cat-mods .row-card { display: grid !important; grid-template-columns: minmax(0, 1fr) 84px 44px; grid-template-areas: 'name name name' 'price sort del'; align-items: end; gap: 8px; padding: 10px 12px !important; }
  .cat-mods .row-card { background: var(--color-surface-2) !important; border: 0 !important; }
  .cat-mods .row-card > td { display: flex !important; flex-direction: column; align-items: stretch !important; gap: 3px; text-align: left !important; }
  .cat-mods .row-card > td[data-label]::before { content: attr(data-label); font-size: 12px; font-weight: 600; color: var(--color-text-secondary); }
  .cat-mods .c-name { grid-area: name; }
  .cat-mods .c-price { grid-area: price; }
  .cat-mods .c-sort { grid-area: sort; }
  .cat-mods .c-sort input { width: 100% !important; }
  .cat-mods .c-del { grid-area: del; }
  .cat-mods input { padding: 8px 10px !important; }

  .cat-detail-card > .pad-phone { padding-bottom: 0 !important; }
  /* Sticky insets are measured from inside the scroller's padding, so pull both pinned
     bars out by the page gutter to sit flush with the top edge / the tab bar. */
  .cat-form-actions { position: sticky; bottom: calc(-1 * var(--screen-pad)); z-index: 1; margin: 0 -16px; padding: 12px 16px !important; background: var(--color-surface); border-radius: 0 0 12px 12px; }
  .cat-form-actions > button { flex: 1 1 0; }
}
`;

// ── Shared style helpers ──────────────────────────────────────────────────────

const btnSm = (variant: 'primary' | 'ghost' | 'danger'): React.CSSProperties => ({
  padding: '7px 14px', borderRadius: 7, fontSize: 13, fontWeight: 600,
  cursor: 'pointer', fontFamily: 'inherit', transition: 'opacity 150ms',
  border: variant === 'ghost' ? '1px solid var(--color-border-strong)' : 'none',
  background:
    variant === 'primary' ? 'var(--color-primary)' :
    variant === 'danger'  ? 'var(--color-danger-strong)' : 'transparent',
  // danger-strong stays deep red in both themes, so it needs literal white —
  // text-inverse flips to dark ink in dark mode and would fail AA on red.
  color:
    variant === 'ghost'  ? 'var(--color-text)' :
    variant === 'danger' ? '#fff' : 'var(--color-text-inverse)',
});

const btnIcon = (): React.CSSProperties => ({
  // WCAG 2.2 SC 2.5.8: meet the 24x24px minimum target and keep adjacent
  // reorder arrows from overlapping (gap via marginRight + inline-flex centering).
  minWidth: 24, minHeight: 24,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  padding: '2px 7px', borderRadius: 4, marginRight: 4,
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

type Tab = 'categories' | 'modifiers' | 'products';

export default function CatalogAdmin() {
  const [tab, setTab] = useState<Tab>('categories');
  const { data: me } = useCurrentUser();
  const screenRef = useFadeRise();

  if (me && !isAdmin(me.role)) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100%', background: 'var(--color-bg)' }}>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 14 }}>ไม่มีสิทธิ์เข้าถึงหน้านี้</p>
      </div>
    );
  }

  return (
    <div ref={screenRef} className="screen-pad cat-screen" style={{ padding: 24, height: '100%', overflowY: 'auto', background: 'var(--color-bg)', boxSizing: 'border-box' }}>
      <style>{CAT_PHONE_CSS}</style>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text)', margin: 0 }}>หมวดหมู่สินค้า</h1>
        <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4, marginBottom: 0 }}>
          จัดการสินค้า หมวดหมู่ และกลุ่มตัวเลือก
        </p>
      </div>

      {/* Tab bar */}
      <div className="cat-tabs" style={{ display: 'flex', gap: 4, marginBottom: 24, background: 'var(--color-surface-2)', padding: 4, borderRadius: 10, width: 'fit-content' }}>
        {([['products', 'สินค้า'], ['categories', 'หมวดหมู่'], ['modifiers', 'กลุ่มตัวเลือก']] as [Tab, string][]).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            aria-pressed={tab === id}
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

      {tab === 'products'   && <ProductsTab />}
      {tab === 'categories' && <CategoriesTab />}
      {tab === 'modifiers'  && <ModifierGroupsTab />}
    </div>
  );
}

// ── Products Tab ──────────────────────────────────────────────────────────────

function ProductsTab() {
  const toast = useToast();
  const { data: products, isLoading } = useProductsAdmin();
  const { data: categories } = useCategoriesAdmin();
  const updateProduct = useUpdateProductAdmin();

  const [editTarget, setEditTarget] = useState<ProductReadAdmin | null>(null);
  const [formName, setFormName]     = useState('');
  const [formPrice, setFormPrice]   = useState('');
  const [formCatId, setFormCatId]   = useState('');
  const [formDesc, setFormDesc]     = useState('');
  const [formActive, setFormActive] = useState(true);

  const openEdit = (p: ProductReadAdmin) => {
    setEditTarget(p);
    setFormName(p.name);
    setFormPrice(p.price);
    setFormCatId(p.category_id ?? '');
    setFormDesc(p.description ?? '');
    setFormActive(p.is_active);
  };

  const handleSave = async () => {
    if (!editTarget) return;
    const patch: ProductUpdateAdminPayload = {};
    const trimName = formName.trim();
    if (trimName && trimName !== editTarget.name) patch.name = trimName;
    if (formPrice !== editTarget.price) patch.price = formPrice;
    const catId = formCatId || null;
    if (catId !== editTarget.category_id) patch.category_id = catId;
    const desc = formDesc.trim() || null;
    if (desc !== editTarget.description) patch.description = desc;
    if (formActive !== editTarget.is_active) patch.is_active = formActive;

    try {
      await updateProduct.mutateAsync({ productId: editTarget.id, ...patch });
      setEditTarget(null);
      toast({ kind: 'success', title: 'อัพเดทสินค้าแล้ว' });
    } catch (err) {
      toast({ kind: 'danger', title: 'อัพเดทไม่สำเร็จ', msg: err instanceof Error ? err.message : 'กรุณาลองใหม่' });
    }
  };

  if (isLoading) return (
    <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
      <div style={{ padding: 'var(--space-4) var(--space-5)' }}>
        <SkeletonTable rows={6} cols={5} label="กำลังโหลดสินค้า" />
      </div>
    </div>
  );

  return (
    <>
      <div className="cat-table-wrap" style={{ background: 'var(--color-surface)', borderRadius: 12, border: '1px solid var(--color-border)', overflow: 'hidden' }}>
        <div className="cat-table-head" style={{ padding: '14px 20px', borderBottom: '1px solid var(--color-border)' }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>สินค้าทั้งหมด ({products?.length ?? 0})</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
        <table className="row-cards cat-prod" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr className="row-cards-head" style={{ background: 'var(--color-surface-2)' }}>
              {['ชื่อสินค้า', 'หมวดหมู่', 'ราคา', 'สถานะ', ''].map((h, i) => (
                <th key={i} style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, fontSize: 12, color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)', whiteSpace: 'nowrap' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(products ?? []).map(p => {
              const cat = categories?.find(c => c.id === p.category_id);
              // The table-time charge is looked up by this exact name every time a
              // board-game session closes: renaming or retiring it silently breaks
              // time billing (a fresh product gets created instead), so it is shown
              // but never editable here.
              const systemManaged = p.name === TABLE_TIME_PRODUCT_NAME;
              return (
                <tr key={p.id} className="row-card" style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td className="c-name" style={{ padding: '10px 16px', fontWeight: 500 }}>
                    {p.name}
                    {systemManaged && (
                      <span style={{
                        marginLeft: 8, padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                        background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)',
                      }}>
                        สินค้าระบบ
                      </span>
                    )}
                  </td>
                  <td className="c-cat" style={{ padding: '10px 16px', color: 'var(--color-text-secondary)', fontSize: 13 }}>
                    {cat?.name ?? <em style={{ color: 'var(--color-text-muted)' }}>ไม่มีหมวดหมู่</em>}
                  </td>
                  <td className="c-price" style={{ padding: '10px 16px', fontFamily: 'var(--font-num)' }}>
                    ฿{Number(p.price).toFixed(2)}
                  </td>
                  <td className="c-status" style={{ padding: '10px 16px' }}>
                    <span style={{
                      padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                      background: p.is_active ? 'var(--color-success-50)' : 'var(--color-surface-2)',
                      color: p.is_active ? 'var(--color-success)' : 'var(--color-text-muted)',
                    }}>
                      {p.is_active ? 'ใช้งาน' : 'ปิดใช้งาน'}
                    </span>
                  </td>
                  <td className="c-act" style={{ padding: '10px 12px', textAlign: 'right' }}>
                    {systemManaged ? (
                      <span
                        title="ระบบใช้ชื่อนี้ตอนคิดค่าเวลาโต๊ะ — เปลี่ยนชื่อหรือปิดใช้งานจะทำให้การคิดเงินพัง"
                        style={{ fontSize: 12, color: 'var(--color-text-muted)' }}
                      >
                        แก้ไขไม่ได้
                      </span>
                    ) : (
                      <button onClick={() => openEdit(p)} aria-label={`แก้ไข ${p.name}`} style={btnSm('ghost')}>แก้ไข</button>
                    )}
                  </td>
                </tr>
              );
            })}
            {!products?.length && (
              <tr>
                <td colSpan={5} style={{ padding: 32, textAlign: 'center', color: 'var(--color-text-muted)' }}>
                  ยังไม่มีสินค้า
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>

      {/* Edit modal */}
      {editTarget && (
        <ModalShell
          title="แก้ไขสินค้า"
          subtitle={editTarget.name}
          onClose={() => setEditTarget(null)}
          width={460}
          busy={updateProduct.isPending}
          footer={<>
            <button onClick={() => setEditTarget(null)} style={{ ...btnSm('ghost'), minHeight: 44 }}>ยกเลิก</button>
            <button
              onClick={handleSave}
              disabled={!formName.trim() || updateProduct.isPending}
              style={{ ...btnSm('primary'), minHeight: 44, opacity: !formName.trim() || updateProduct.isPending ? 0.55 : 1 }}
            >
              {updateProduct.isPending ? 'กำลังบันทึก…' : 'บันทึก'}
            </button>
          </>}
        >
            <div className="cat-form" style={{ display: 'grid', gap: 14 }}>
              <div>
                <label htmlFor="prod-name" style={labelCss}>ชื่อสินค้า</label>
                <input id="prod-name" value={formName} onChange={e => setFormName(e.target.value)} style={inputCss} />
              </div>
              <div className="form-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div>
                  <label htmlFor="prod-price" style={labelCss}>ราคา (฿)</label>
                  <input
                    id="prod-price"
                    inputMode="decimal"
                    value={formPrice}
                    onChange={e => setFormPrice(e.target.value)}
                    placeholder="0.00"
                    style={{ ...inputCss, fontFamily: 'var(--font-num)' }}
                  />
                </div>
                <div>
                  <label style={labelCss}>หมวดหมู่</label>
                  <Select
                    value={formCatId}
                    onChange={setFormCatId}
                    ariaLabel="หมวดหมู่"
                    options={[
                      { value: '', label: 'ไม่มีหมวดหมู่' },
                      ...(categories ?? []).map(c => ({ value: c.id, label: c.name })),
                    ]}
                  />
                </div>
              </div>
              <div>
                <label htmlFor="prod-desc" style={labelCss}>คำอธิบาย</label>
                <textarea
                  id="prod-desc"
                  value={formDesc}
                  onChange={e => setFormDesc(e.target.value)}
                  rows={3}
                  placeholder="ไม่บังคับ"
                  style={{ ...inputCss, resize: 'vertical' }}
                />
              </div>
              <div className="cat-check" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox" id="prod-active-chk"
                  checked={formActive}
                  onChange={e => setFormActive(e.target.checked)}
                  style={{ width: 16, height: 16, accentColor: 'var(--color-primary)', cursor: 'pointer' }}
                />
                <label htmlFor="prod-active-chk" style={{ fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
                  เปิดใช้งาน (แสดงในเมนู POS)
                </label>
              </div>
            </div>
        </ModalShell>
      )}
    </>
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

  const rawMax = categories?.length ? Math.max(...categories.map(c => c.sort_order ?? 0)) : 0;
  const maxOrder = Number.isFinite(rawMax) ? rawMax : 0;

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
    <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
      <div style={{ padding: 'var(--space-4) var(--space-5)' }}>
        <SkeletonTable rows={5} cols={4} label="กำลังโหลดหมวดหมู่" />
      </div>
    </div>
  );

  return (
    <>
      <div className="cat-table-wrap" style={{ background: 'var(--color-surface)', borderRadius: 12, border: '1px solid var(--color-border)', overflow: 'hidden' }}>
        {/* Card header */}
        <div className="cat-table-head" style={{ padding: '14px 20px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>หมวดหมู่ ({categories?.length ?? 0})</span>
          <button onClick={() => { setIsAdding(true); setAddingName(''); }} style={btnSm('primary')}>
            + เพิ่มหมวดหมู่
          </button>
        </div>

        {/* Table */}
        <div style={{ overflowX: 'auto' }}>
        <table className="row-cards cat-cats" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr className="row-cards-head" style={{ background: 'var(--color-surface-2)' }}>
              {['#', 'ชื่อหมวดหมู่', 'จัดเรียง', ''].map((h, i) => (
                <th key={i} style={{ padding: '10px 16px', textAlign: i === 0 ? 'center' : 'left', fontWeight: 600, fontSize: 12, color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)', whiteSpace: 'nowrap' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(categories ?? []).map((cat, idx) => (
              <tr key={cat.id} className="row-card" data-editing={editingId === cat.id ? '' : undefined} style={{ borderBottom: '1px solid var(--color-border)' }}>
                <td className="c-num" style={{ padding: '10px 16px', textAlign: 'center', width: 48, color: 'var(--color-text-muted)', fontFamily: 'var(--font-num)' }}>
                  {cat.sort_order}
                </td>
                <td className="c-name" style={{ padding: '10px 16px' }}>
                  {editingId === cat.id ? (
                    <div className="cat-inline-edit" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input
                        autoFocus
                        aria-label="ชื่อหมวดหมู่"
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
                <td className="c-move" style={{ padding: '10px 12px', width: 80, whiteSpace: 'nowrap' }}>
                  <button onClick={() => handleMoveUp(idx)} disabled={idx === 0 || updateCategory.isPending} style={btnIcon()} title="ขึ้น" aria-label={`เลื่อน ${cat.name} ขึ้น`}>↑</button>
                  <button onClick={() => handleMoveDown(idx)} disabled={idx === (categories?.length ?? 0) - 1 || updateCategory.isPending} style={btnIcon()} title="ลง" aria-label={`เลื่อน ${cat.name} ลง`}>↓</button>
                </td>
                <td className="c-act" style={{ padding: '10px 12px', width: 120, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button onClick={() => { setEditingId(cat.id); setEditingName(cat.name); }} aria-label={`แก้ไข ${cat.name}`} style={btnSm('ghost')}>แก้ไข</button>
                  <button onClick={() => setDeleteTarget(cat)} aria-label={`ลบ ${cat.name}`} style={{ ...btnSm('ghost'), marginLeft: 6, color: 'var(--color-danger)' }}>ลบ</button>
                </td>
              </tr>
            ))}

            {isAdding && (
              <tr className="row-card" data-editing="" style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-accent-50)' }}>
                <td className="c-num hide-phone" style={{ padding: '10px 16px', textAlign: 'center', width: 48, color: 'var(--color-text-muted)' }}>—</td>
                <td className="c-name" style={{ padding: '10px 16px' }}>
                  <div className="cat-inline-edit" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      autoFocus
                      aria-label="ชื่อหมวดหมู่ใหม่"
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
                <td colSpan={2} className="hide-phone" />
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
      </div>

      {/* Delete confirm */}
      {deleteTarget && (
        <ModalShell
          title="ลบหมวดหมู่"
          onClose={() => setDeleteTarget(null)}
          width={380}
          busy={deleteCategory.isPending}
          footer={<>
            <button onClick={() => setDeleteTarget(null)} style={{ ...btnSm('ghost'), minHeight: 44 }}>ยกเลิก</button>
            <button onClick={handleDelete} disabled={deleteCategory.isPending} style={{ ...btnSm('danger'), minHeight: 44 }}>ลบ</button>
          </>}
        >
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: 'var(--color-text-secondary)' }}>
              ลบ <strong>{deleteTarget.name}</strong>? ไม่สามารถเลิกทำได้
            </p>
        </ModalShell>
      )}
    </>
  );
}

// ── Modifier Groups Tab ───────────────────────────────────────────────────────

interface LocalModifier {
  id?: string;
  clientId: string;
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
  const [isDirty, setIsDirty] = useState(false);
  // Phones: the form replaces the list in the same scrolling page, so start it at the top.
  const isPhone = useIsPhone();
  const showFormFromTop = () => {
    if (isPhone) requestAnimationFrame(() => document.querySelector('.cat-screen')?.scrollTo({ top: 0 }));
  };

  const maxSelectParsed = formMaxSelect === '' ? null : Number(formMaxSelect);
  const selectionHint =
    maxSelectParsed === 1
      ? 'เลือกได้ 1 ตัวเลือก (radio buttons)'
      : 'เลือกได้หลายตัวเลือก (checkboxes)';

  const loadGroup = (g: ModifierGroupReadAdmin) => {
    if (isDirty && !window.confirm('มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก — ทิ้งการเปลี่ยนแปลงหรือไม่?')) return;
    setIsDirty(false);
    setSelectedId(g.id);
    setIsCreating(false);
    setFormName(g.name);
    setFormRequired(g.required);
    setFormMinSelect(g.min_select);
    setFormMaxSelect(g.max_select === null ? '' : String(g.max_select));
    setFormModifiers(
      g.modifiers.map(m => ({ id: m.id, clientId: m.id, name: m.name, price_delta: String(m.price_delta), sort_order: m.sort_order }))
    );
    showFormFromTop();
  };

  const startCreating = () => {
    setIsDirty(false);
    setIsCreating(true);
    setSelectedId(null);
    setFormName('');
    setFormRequired(false);
    setFormMinSelect(0);
    setFormMaxSelect('1');
    setFormModifiers([]);
    showFormFromTop();
  };

  const buildModifiersPayload = () =>
    formModifiers.map((m) => ({
      name: m.name,
      price_delta: m.price_delta || '0',
      sort_order: m.sort_order,
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
      setIsDirty(false);
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

  const addModifierRow = () => {
    setFormModifiers(prev => [...prev, { clientId: crypto.randomUUID(), name: '', price_delta: '0', sort_order: prev.length }]);
    setIsDirty(true);
  };

  const updateModRow = (i: number, field: keyof LocalModifier, value: string | number) => {
    setFormModifiers(prev => prev.map((m, idx) => idx === i ? { ...m, [field]: value } : m));
    setIsDirty(true);
  };

  const removeModRow = (i: number) => {
    setFormModifiers(prev => prev.filter((_, idx) => idx !== i));
    setIsDirty(true);
  };

  const showForm = isCreating || selectedId !== null;

  // Phones (MasterDetail back button): leave the form and return to the group list.
  const closeDetail = () => {
    if (isDirty && !window.confirm('มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก — ทิ้งการเปลี่ยนแปลงหรือไม่?')) return;
    setIsDirty(false);
    setSelectedId(null);
    setIsCreating(false);
  };

  if (isLoading) return (
    <div className="stack-phone" style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }} aria-busy="true">
      <span className="sr-only">กำลังโหลดกลุ่มตัวเลือก</span>
      <div className="full-phone" style={{ width: 280, flexShrink: 0, background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} height="var(--space-5)" width={['80%', '65%', '72%', '55%', '68%'][i]} />
        ))}
      </div>
      <div style={{ flex: 1, background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', padding: 'var(--space-5)' }}>
        <SkeletonTable rows={4} cols={4} />
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop: list + form side by side (same flex row as before). Phones: the list
          fills the page; picking a group swaps in the form under a back bar. */}
      <MasterDetail
        className="cat-md"
        style={{ gap: 16, alignItems: 'flex-start', height: 'auto' }}
        listWidth={280}
        hasSelection={showForm}
        onBack={closeDetail}
        backLabel="กลุ่มตัวเลือก"
        detailTitle={isCreating ? 'สร้างกลุ่มใหม่' : formName}
        list={
        <div style={{ width: 280, flexShrink: 0, background: 'var(--color-surface)', borderRadius: 12, border: '1px solid var(--color-border)', overflow: 'hidden' }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>กลุ่มตัวเลือก</span>
            <button onClick={startCreating} style={{ ...btnSm('primary'), padding: '5px 10px', fontSize: 12 }}>+ สร้าง</button>
          </div>
          <div className="cat-group-list" style={{ maxHeight: 520, overflowY: 'auto' }}>
            {(groups ?? []).map(g => (
              <div
                key={g.id}
                className="cat-group-row"
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
                  className="cat-x"
                  style={{ background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 18, padding: '2px 6px', borderRadius: 4 }}
                  title="ลบกลุ่มนี้"
                  aria-label={`ลบกลุ่ม ${g.name}`}
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
        }
        detail={showForm ? (
          <div className="cat-detail-card" style={{ flex: 1, background: 'var(--color-surface)', borderRadius: 12, border: '1px solid var(--color-border)', overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--color-border)' }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>
                {isCreating ? 'สร้างกลุ่มตัวเลือกใหม่' : 'แก้ไขกลุ่มตัวเลือก'}
              </span>
            </div>
            <div className="pad-phone" style={{ padding: 20 }}>
              {/* Group fields */}
              <div className="form-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
                <div style={{ gridColumn: '1/-1' }}>
                  <label style={labelCss}>ชื่อกลุ่ม</label>
                  <input
                    value={formName}
                    onChange={e => { setFormName(e.target.value); setIsDirty(true); }}
                    placeholder="เช่น ขนาด, ความหวาน"
                    style={inputCss}
                  />
                </div>
                <div>
                  <label style={labelCss}>เลือกขั้นต่ำ</label>
                  <NumberInput
                    min={0} integer
                    value={formMinSelect}
                    onChange={n => { setFormMinSelect(n); setIsDirty(true); }}
                    style={inputCss}
                  />
                </div>
                <div>
                  <label style={labelCss}>เลือกสูงสุด (ว่าง = ไม่จำกัด)</label>
                  <input
                    type="number" min={1} inputMode="numeric"
                    value={formMaxSelect}
                    onChange={e => { setFormMaxSelect(e.target.value); setIsDirty(true); }}
                    placeholder="ว่าง = ไม่จำกัด"
                    style={inputCss}
                  />
                  <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 4 }}>{selectionHint}</div>
                </div>
                <div className="cat-check" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox" id="req-chk"
                    checked={formRequired}
                    onChange={e => { setFormRequired(e.target.checked); setIsDirty(true); }}
                    style={{ width: 16, height: 16, accentColor: 'var(--color-primary)', cursor: 'pointer' }}
                  />
                  <label htmlFor="req-chk" style={{ fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>บังคับเลือก (จำเป็น)</label>
                </div>
              </div>

              {/* Modifiers table */}
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>ตัวเลือก</div>
              {formModifiers.length > 0 && (
                <div className="cat-table-wrap" style={{ overflowX: 'auto' }}>
                <table className="row-cards cat-mods" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginBottom: 8 }}>
                  <thead>
                    <tr className="row-cards-head" style={{ background: 'var(--color-surface-2)' }}>
                      {['ชื่อ', 'ราคาต่างจากปกติ (฿)', 'ลำดับ', ''].map((h, i) => (
                        <th key={i} style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, fontSize: 12, color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {formModifiers.map((m, i) => (
                      <tr key={m.clientId} className="row-card" style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <td className="c-name" style={{ padding: '6px 8px' }}>
                          <input value={m.name} onChange={e => updateModRow(i, 'name', e.target.value)} placeholder="ชื่อตัวเลือก" aria-label={`ชื่อตัวเลือกที่ ${i + 1}`} style={{ ...inputCss, padding: '4px 8px', fontSize: 13 }} />
                        </td>
                        <td className="c-price" data-label="ราคาต่าง (฿)" style={{ padding: '6px 8px', width: 170 }}>
                          <input value={m.price_delta} onChange={e => updateModRow(i, 'price_delta', e.target.value)} placeholder="0" inputMode="decimal" aria-label={`ราคาต่างจากปกติของตัวเลือกที่ ${i + 1} (บาท)`} style={{ ...inputCss, padding: '4px 8px', fontSize: 13, fontFamily: 'var(--font-num)' }} />
                        </td>
                        <td className="c-sort" data-label="ลำดับ" style={{ padding: '6px 8px', width: 80 }}>
                          <NumberInput integer min={0} value={m.sort_order} onChange={n => updateModRow(i, 'sort_order', n)} aria-label={`ลำดับของตัวเลือกที่ ${i + 1}`} style={{ ...inputCss, padding: '4px 8px', fontSize: 13, fontFamily: 'var(--font-num)', width: 60 }} />
                        </td>
                        <td className="c-del" style={{ padding: '6px 8px', width: 36, textAlign: 'center' }}>
                          <button onClick={() => removeModRow(i)} aria-label={`ลบตัวเลือกที่ ${i + 1}`} style={{ background: 'transparent', border: 'none', color: 'var(--color-danger)', cursor: 'pointer', fontSize: 18 }}>×</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              )}
              <button onClick={addModifierRow} style={{ ...btnSm('ghost'), fontSize: 13, marginBottom: 24 }}>
                + เพิ่มตัวเลือก
              </button>

              {/* Action buttons */}
              <div className="cat-form-actions" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 16, borderTop: '1px solid var(--color-border)' }}>
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
      />

      {/* Delete confirm */}
      {deleteTarget && (
        <ModalShell
          title="ลบกลุ่มตัวเลือก"
          onClose={() => setDeleteTarget(null)}
          width={380}
          busy={deleteGroup.isPending}
          footer={<>
            <button onClick={() => setDeleteTarget(null)} style={{ ...btnSm('ghost'), minHeight: 44 }}>ยกเลิก</button>
            <button onClick={handleDeleteGroup} disabled={deleteGroup.isPending} style={{ ...btnSm('danger'), minHeight: 44 }}>ลบ</button>
          </>}
        >
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: 'var(--color-text-secondary)' }}>
              ลบ <strong>{deleteTarget.name}</strong>? ตัวเลือกทั้งหมดในกลุ่มนี้จะถูกลบด้วย
            </p>
        </ModalShell>
      )}
    </>
  );
}
