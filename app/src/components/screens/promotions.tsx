'use client';

import { useState } from 'react';
import Icon from '../icons';
import { useToast, Tag, Select } from '../app-common';
import { useCurrentUser, isAdmin } from '@/hooks/use-current-user';
import {
  usePromotions, useCreatePromotion, useUpdatePromotion, useDeletePromotion,
  type PromotionRead, type PromotionType, type PromotionScope, type PromotionCreate,
} from '@/hooks/use-promotions';
import { useCategories, useAllProducts } from '@/hooks/use-products';
import LoyaltyConfig from './loyalty-config';
import PromotionCalculator from './promotion-calculator';

const TYPE_LABEL: Record<PromotionType, string> = {
  PERCENT_OFF: 'ส่วนลด %', COMBO_BUNDLE: 'จัดเซ็ต', COMBO_QUANTITY: 'ซื้อครบจำนวน', HAPPY_HOUR: 'Happy Hour',
};
const TYPE_TONE: Record<PromotionType, 'accent' | 'info' | 'warning'> = {
  PERCENT_OFF: 'accent', COMBO_BUNDLE: 'info', COMBO_QUANTITY: 'info', HAPPY_HOUR: 'warning',
};
const SCOPE_LABEL: Record<PromotionScope, string> = {
  ORDER: 'ทั้งบิล', CATEGORY: 'หมวดหมู่', PRODUCT: 'สินค้าที่เลือก',
};
const DOW = ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา']; // 0=Mon … 6=Sun (Python weekday)

const IS: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 8, border: '1px solid var(--color-border)',
  background: 'var(--color-surface-2)', color: 'var(--color-text)', fontSize: 14, width: '100%', boxSizing: 'border-box',
};
const LB: React.CSSProperties = { fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 };

interface FormState {
  name: string;
  type: PromotionType;
  is_exclusive: boolean;
  discount_pct: string;
  scope: PromotionScope;
  category_id: string;
  product_ids: string[];
  bundle_product_ids: string[];
  min_quantity: string;
  time_start: string;
  time_end: string;
  days_of_week: number[];
  valid_from: string;
  valid_until: string;
}

const EMPTY_FORM: FormState = {
  name: '', type: 'PERCENT_OFF', is_exclusive: false, discount_pct: '',
  scope: 'ORDER', category_id: '', product_ids: [], bundle_product_ids: [],
  min_quantity: '', time_start: '', time_end: '', days_of_week: [],
  valid_from: '', valid_until: '',
};

function fromPromotion(p: PromotionRead): FormState {
  return {
    name: p.name,
    type: p.type,
    is_exclusive: p.is_exclusive,
    discount_pct: p.discount_pct != null ? String(Number(p.discount_pct)) : '',
    scope: p.scope,
    category_id: p.category_id ?? '',
    product_ids: p.product_ids_json ?? [],
    bundle_product_ids: p.bundle_product_ids_json ?? [],
    min_quantity: p.min_quantity != null ? String(p.min_quantity) : '',
    time_start: (p.time_start ?? '').slice(0, 5),
    time_end: (p.time_end ?? '').slice(0, 5),
    days_of_week: p.days_of_week_json ?? [],
    valid_from: p.valid_from ?? '',
    valid_until: p.valid_until ?? '',
  };
}

// ── Searchable multi-select for products ───────────────────────────────────────
function ProductMultiSelect({ products, selected, onChange }: {
  products: { id: string; name: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [q, setQ] = useState('');
  const filtered = q ? products.filter(p => p.name.toLowerCase().includes(q.toLowerCase())) : products;
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);
  return (
    <div>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="ค้นหาสินค้า..." style={{ ...IS, marginBottom: 6 }} />
      {selected.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
          {selected.map(id => {
            const p = products.find(x => x.id === id);
            return (
              <span key={id} onClick={() => toggle(id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 999, background: 'var(--color-accent-50)', color: 'var(--color-primary-700)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                {p?.name ?? id} <Icon name="x" size={11} />
              </span>
            );
          })}
        </div>
      )}
      <div style={{ maxHeight: 150, overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 8 }}>
        {filtered.slice(0, 50).map(p => (
          <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', fontSize: 13, cursor: 'pointer', borderBottom: '1px solid var(--color-border)' }}>
            <input type="checkbox" checked={selected.includes(p.id)} onChange={() => toggle(p.id)} />
            {p.name}
          </label>
        ))}
        {filtered.length === 0 && <div style={{ padding: 10, fontSize: 12, color: 'var(--color-text-muted)' }}>ไม่พบสินค้า</div>}
      </div>
    </div>
  );
}

function PromoCard({ p, products, categories, onToggle, onEdit, onDelete, admin }: {
  p: PromotionRead;
  products: { id: string; name: string }[];
  categories: { id: string; label: string }[];
  onToggle: (p: PromotionRead) => void;
  onEdit: (p: PromotionRead) => void;
  onDelete: (id: string) => void;
  admin: boolean;
}) {
  const nameOf = (id: string) => products.find(x => x.id === id)?.name ?? id;
  const catName = p.category_id ? (categories.find(c => c.id === p.category_id)?.label ?? p.category_id) : null;

  return (
    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 14, padding: 20, opacity: p.is_active ? 1 : 0.6, boxShadow: 'var(--shadow-xs)', transition: 'opacity 200ms' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{p.name}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Tag tone={TYPE_TONE[p.type]}>{TYPE_LABEL[p.type]}</Tag>
            <Tag tone="neutral">{SCOPE_LABEL[p.scope]}</Tag>
            {p.is_exclusive && <Tag tone="danger">ใช้เดี่ยว</Tag>}
          </div>
        </div>
        <Tag tone={p.is_active ? 'success' : 'neutral'}>{p.is_active ? 'เปิดใช้' : 'ปิด'}</Tag>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, margin: '12px 0', padding: '10px 14px', background: 'var(--color-accent-50)', borderRadius: 8 }}>
        <span style={{ fontSize: 30, fontWeight: 800, color: 'var(--color-accent-600)', fontVariantNumeric: 'tabular-nums' }}>{p.discount_pct != null ? `${Number(p.discount_pct)}%` : '—'}</span>
        <span style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>ส่วนลด</span>
      </div>

      {/* Scope / target details */}
      <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
        {catName && <div>หมวดหมู่: {catName}</div>}
        {p.scope === 'PRODUCT' && p.product_ids_json && p.product_ids_json.length > 0 && (
          <div>สินค้า: {p.product_ids_json.map(nameOf).join(', ')}</div>
        )}
        {p.type === 'COMBO_BUNDLE' && p.bundle_product_ids_json && p.bundle_product_ids_json.length > 0 && (
          <div>เซ็ต: {p.bundle_product_ids_json.map(nameOf).join(' + ')}</div>
        )}
        {p.type === 'COMBO_QUANTITY' && p.min_quantity != null && <div>ซื้อครบ {p.min_quantity} ชิ้น</div>}
        {p.type === 'HAPPY_HOUR' && (
          <div>
            {(p.time_start ?? '').slice(0, 5)}–{(p.time_end ?? '').slice(0, 5)}
            {p.days_of_week_json && p.days_of_week_json.length > 0 ? ` • ${p.days_of_week_json.map(d => DOW[d]).join(' ')}` : ' • ทุกวัน'}
          </div>
        )}
        {(p.valid_from || p.valid_until) && <div>{p.valid_from ?? '∞'} → {p.valid_until ?? '∞'}</div>}
      </div>

      {admin && (
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <button onClick={() => onEdit(p)} style={{ padding: '6px 12px', borderRadius: 7, border: '1px solid var(--color-border)', background: 'var(--color-surface-2)', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>แก้ไข</button>
          <button onClick={() => onToggle(p)} style={{ padding: '6px 12px', borderRadius: 7, border: '1px solid var(--color-border)', background: 'var(--color-surface-2)', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
            {p.is_active ? 'ปิด' : 'เปิด'}
          </button>
          <button onClick={() => onDelete(p.id)} style={{ padding: '6px 8px', borderRadius: 7, border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-danger)', cursor: 'pointer' }}>
            <Icon name="trash" size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

export default function PromotionsScreen() {
  const toast = useToast();
  const { data: me } = useCurrentUser();
  const admin = isAdmin(me?.role);

  const [mainTab, setMainTab] = useState<'promos' | 'loyalty'>('promos');
  const [subTab, setSubTab] = useState<'list' | 'calculator'>('list');
  const [filterActive, setFilterActive] = useState<'all' | 'active' | 'inactive'>('all');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const activeParam = filterActive === 'all' ? undefined : filterActive === 'active';
  const { data: list = [], isLoading } = usePromotions(activeParam);
  const { data: all = [] } = usePromotions(); // for stats + tab counts
  const { data: categories = [] } = useCategories();
  const { data: products = [] } = useAllProducts();

  const createPromo = useCreatePromotion();
  const updatePromo = useUpdatePromotion();
  const deletePromo = useDeletePromotion();

  const activeCount = all.filter(p => p.is_active).length;

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm(f => ({ ...f, [k]: v }));

  const openCreate = () => { setEditingId(null); setForm(EMPTY_FORM); setShowForm(true); };
  const openEdit = (p: PromotionRead) => { setEditingId(p.id); setForm(fromPromotion(p)); setShowForm(true); };
  const closeForm = () => { setShowForm(false); setEditingId(null); setForm(EMPTY_FORM); };

  const buildPayload = (): PromotionCreate | null => {
    if (!form.name.trim()) { toast({ kind: 'warning', title: 'กรอกชื่อโปรโมชั่น' }); return null; }
    const pct = parseFloat(form.discount_pct);
    if (isNaN(pct) || pct <= 0 || pct > 100) { toast({ kind: 'warning', title: 'ส่วนลดต้องอยู่ระหว่าง 0–100%' }); return null; }

    const scopeful = form.type !== 'COMBO_BUNDLE';
    if (scopeful && form.scope === 'CATEGORY' && !form.category_id) { toast({ kind: 'warning', title: 'เลือกหมวดหมู่' }); return null; }
    if (scopeful && form.scope === 'PRODUCT' && form.product_ids.length === 0) { toast({ kind: 'warning', title: 'เลือกสินค้าอย่างน้อย 1 รายการ' }); return null; }
    if (form.type === 'COMBO_BUNDLE' && form.bundle_product_ids.length === 0) { toast({ kind: 'warning', title: 'เลือกสินค้าในเซ็ต' }); return null; }
    if (form.type === 'COMBO_QUANTITY' && (!form.min_quantity || Number(form.min_quantity) < 1)) { toast({ kind: 'warning', title: 'กรอกจำนวนขั้นต่ำ (≥ 1)' }); return null; }
    if (form.type === 'HAPPY_HOUR' && (!form.time_start || !form.time_end)) { toast({ kind: 'warning', title: 'กรอกช่วงเวลา Happy Hour' }); return null; }

    const toTime = (t: string) => (t.length === 5 ? `${t}:00` : t);
    return {
      name: form.name.trim(),
      type: form.type,
      is_exclusive: form.is_exclusive,
      discount_pct: pct,
      scope: scopeful ? form.scope : 'ORDER',
      category_id: scopeful && form.scope === 'CATEGORY' ? form.category_id : null,
      product_ids_json: scopeful && form.scope === 'PRODUCT' ? form.product_ids : null,
      bundle_product_ids_json: form.type === 'COMBO_BUNDLE' ? form.bundle_product_ids : null,
      min_quantity: form.type === 'COMBO_QUANTITY' ? Number(form.min_quantity) : null,
      time_start: form.type === 'HAPPY_HOUR' ? toTime(form.time_start) : null,
      time_end: form.type === 'HAPPY_HOUR' ? toTime(form.time_end) : null,
      days_of_week_json: form.type === 'HAPPY_HOUR' && form.days_of_week.length > 0 ? form.days_of_week : null,
      valid_from: form.valid_from || null,
      valid_until: form.valid_until || null,
    };
  };

  const handleSubmit = async () => {
    const payload = buildPayload();
    if (!payload) return;
    try {
      if (editingId) {
        await updatePromo.mutateAsync({ id: editingId, ...payload });
        toast({ kind: 'success', title: 'บันทึกการแก้ไขแล้ว' });
      } else {
        await createPromo.mutateAsync(payload);
        toast({ kind: 'success', title: 'สร้างโปรโมชั่นแล้ว' });
      }
      closeForm();
    } catch (e: unknown) { toast({ kind: 'danger', title: String(e instanceof Error ? e.message : e) }); }
  };

  const handleToggle = async (p: PromotionRead) => {
    try { await updatePromo.mutateAsync({ id: p.id, is_active: !p.is_active }); }
    catch (e: unknown) { toast({ kind: 'danger', title: String(e instanceof Error ? e.message : e) }); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('ลบโปรโมชั่นนี้?')) return;
    try { await deletePromo.mutateAsync(id); toast({ kind: 'success', title: 'ลบแล้ว' }); }
    catch (e: unknown) { toast({ kind: 'danger', title: String(e instanceof Error ? e.message : e) }); }
  };

  const saving = createPromo.isPending || updatePromo.isPending;
  const scopeful = form.type !== 'COMBO_BUNDLE';

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 32 }}>
      {/* Top-level section tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        {([['promos', 'โปรโมชั่น / คูปอง'], ['loyalty', 'สมาชิก / สะสมแต้ม']] as const).map(([v, l]) => (
          <button key={v} onClick={() => setMainTab(v)}
            style={{
              padding: '9px 18px', borderRadius: 999, fontSize: 14, fontWeight: 600, cursor: 'pointer',
              border: `1px solid ${mainTab === v ? 'var(--color-primary)' : 'var(--color-border)'}`,
              background: mainTab === v ? 'var(--color-primary)' : 'var(--color-surface)',
              color: mainTab === v ? 'white' : 'var(--color-text-secondary)',
            }}>{l}</button>
        ))}
      </div>

      {mainTab === 'loyalty' ? <LoyaltyConfig /> : (
      <>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em', marginBottom: 4 }}>โปรโมชั่น / Promotions</h1>
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>สร้างกฎส่วนลด จัดเซ็ต และ Happy Hour ที่ POS จะนำไปใช้ตอนชำระเงิน</div>
        </div>
        {admin && subTab === 'list' && (
          <button onClick={openCreate}
            style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '10px 20px', borderRadius: 8, background: 'var(--color-accent)', color: 'var(--color-primary-700)', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
            <Icon name="plus" size={15} /> สร้างโปรโมชั่น
          </button>
        )}
      </div>

      {/* Sub-tabs: list vs calculator */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {([['list', 'รายการโปรโมชั่น'], ['calculator', 'เครื่องคำนวณ']] as const).map(([v, l]) => (
          <button key={v} onClick={() => setSubTab(v)}
            style={{
              padding: '7px 16px', borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: 'pointer',
              border: `1px solid ${subTab === v ? 'var(--color-accent)' : 'var(--color-border)'}`,
              background: subTab === v ? 'var(--color-accent-50)' : 'var(--color-surface)',
              color: subTab === v ? 'var(--color-primary-700)' : 'var(--color-text-secondary)',
            }}>{l}</button>
        ))}
      </div>

      {subTab === 'calculator' ? <PromotionCalculator /> : (
      <>
      {/* Stats row */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'โปรโมชั่นที่ใช้งาน', val: activeCount,    suffix: 'รายการ', color: 'var(--color-success)',        bg: 'var(--color-success-50)' },
          { label: 'ปิดใช้งาน',          val: all.length - activeCount, suffix: 'รายการ', color: 'var(--color-text-secondary)', bg: 'var(--color-surface-2)' },
          { label: 'โปรโมชั่นทั้งหมด',    val: all.length,    suffix: 'รายการ', color: 'var(--color-info)',           bg: 'var(--color-info-50)' },
        ].map(s => (
          <div key={s.label} style={{ background: s.bg, borderRadius: 10, padding: '14px 18px', flex: 1 }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: s.color, fontVariantNumeric: 'tabular-nums' }}>{s.val} <span style={{ fontSize: 13, fontWeight: 500 }}>{s.suffix}</span></div>
            <div style={{ fontSize: 12, color: s.color, fontWeight: 500, marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Create / edit form */}
      {showForm && (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 22, marginBottom: 22, boxShadow: 'var(--shadow-md)' }}>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16 }}>{editingId ? 'แก้ไขโปรโมชั่น' : 'โปรโมชั่นใหม่'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div style={{ gridColumn: '1/-1' }}>
              <label style={LB}>ชื่อโปรโมชั่น *</label>
              <input value={form.name} onChange={e => set('name', e.target.value)} maxLength={120} style={IS} placeholder="เช่น Happy Hour เครื่องดื่ม" />
            </div>
            <div>
              <label style={LB}>ประเภท</label>
              <Select value={form.type} onChange={v => set('type', v as PromotionType)} ariaLabel="ประเภท" options={[
                { value: 'PERCENT_OFF', label: 'ส่วนลด % (Percent off)' },
                { value: 'HAPPY_HOUR', label: 'Happy Hour (ตามเวลา)' },
                { value: 'COMBO_QUANTITY', label: 'ซื้อครบจำนวน' },
                { value: 'COMBO_BUNDLE', label: 'จัดเซ็ต (Bundle)' },
              ]} />
            </div>
            <div>
              <label style={LB}>ส่วนลด (%) *</label>
              <input type="number" min={0} max={100} value={form.discount_pct} onChange={e => set('discount_pct', e.target.value)} style={IS} placeholder="15" />
            </div>

            {/* Scope (not for bundle) */}
            {scopeful && (
              <div>
                <label style={LB}>ขอบเขต</label>
                <Select value={form.scope} onChange={v => set('scope', v as PromotionScope)} ariaLabel="ขอบเขต" options={[
                  { value: 'ORDER', label: 'ทั้งบิล' },
                  { value: 'CATEGORY', label: 'หมวดหมู่' },
                  { value: 'PRODUCT', label: 'สินค้าที่เลือก' },
                ]} />
              </div>
            )}
            {form.type === 'COMBO_QUANTITY' && (
              <div>
                <label style={LB}>จำนวนขั้นต่ำ *</label>
                <input type="number" min={1} value={form.min_quantity} onChange={e => set('min_quantity', e.target.value)} style={IS} placeholder="2" />
              </div>
            )}

            {/* Category target */}
            {scopeful && form.scope === 'CATEGORY' && (
              <div style={{ gridColumn: '1/-1' }}>
                <label style={LB}>หมวดหมู่ *</label>
                <Select value={form.category_id} onChange={v => set('category_id', v)} ariaLabel="หมวดหมู่" placeholder="— เลือกหมวดหมู่ —" options={categories.map(c => ({ value: c.id, label: c.label }))} />
              </div>
            )}

            {/* Product target */}
            {scopeful && form.scope === 'PRODUCT' && (
              <div style={{ gridColumn: '1/-1' }}>
                <label style={LB}>สินค้า *</label>
                <ProductMultiSelect products={products} selected={form.product_ids} onChange={ids => set('product_ids', ids)} />
              </div>
            )}

            {/* Bundle products */}
            {form.type === 'COMBO_BUNDLE' && (
              <div style={{ gridColumn: '1/-1' }}>
                <label style={LB}>สินค้าในเซ็ต (ต้องมีครบทุกชิ้นในตะกร้า) *</label>
                <ProductMultiSelect products={products} selected={form.bundle_product_ids} onChange={ids => set('bundle_product_ids', ids)} />
              </div>
            )}

            {/* Happy hour window */}
            {form.type === 'HAPPY_HOUR' && (
              <>
                <div>
                  <label style={LB}>เริ่ม *</label>
                  <input type="time" value={form.time_start} onChange={e => set('time_start', e.target.value)} style={IS} />
                </div>
                <div>
                  <label style={LB}>สิ้นสุด *</label>
                  <input type="time" value={form.time_end} onChange={e => set('time_end', e.target.value)} style={IS} />
                </div>
                <div style={{ gridColumn: '1/-1' }}>
                  <label style={LB}>วันในสัปดาห์ (เว้นว่าง = ทุกวัน)</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {DOW.map((d, i) => {
                      const on = form.days_of_week.includes(i);
                      return (
                        <button key={i} type="button"
                          onClick={() => set('days_of_week', on ? form.days_of_week.filter(x => x !== i) : [...form.days_of_week, i])}
                          style={{ width: 42, padding: '7px 0', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                            border: `1px solid ${on ? 'var(--color-accent)' : 'var(--color-border)'}`,
                            background: on ? 'var(--color-accent-50)' : 'var(--color-surface-2)',
                            color: on ? 'var(--color-primary-700)' : 'var(--color-text-secondary)' }}>{d}</button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}

            <div>
              <label style={LB}>วันเริ่ม</label>
              <input type="date" value={form.valid_from} onChange={e => set('valid_from', e.target.value)} style={IS} />
            </div>
            <div>
              <label style={LB}>วันสิ้นสุด</label>
              <input type="date" value={form.valid_until} onChange={e => set('valid_until', e.target.value)} style={IS} />
            </div>

            <div style={{ gridColumn: '1/-1', display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" id="excl" checked={form.is_exclusive} onChange={e => set('is_exclusive', e.target.checked)} style={{ width: 15, height: 15 }} />
              <label htmlFor="excl" style={{ fontSize: 13, cursor: 'pointer' }}>ใช้เดี่ยว (ห้ามใช้ร่วมกับโปรอื่น)</label>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button onClick={handleSubmit} disabled={saving}
              style={{ padding: '10px 22px', borderRadius: 8, background: 'var(--color-accent)', color: 'var(--color-primary-700)', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
              {saving ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
            <button onClick={closeForm} style={{ padding: '10px 22px', borderRadius: 8, background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', fontSize: 14, cursor: 'pointer' }}>ยกเลิก</button>
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--color-border)' }}>
        {([['all', 'ทั้งหมด', all.length], ['active', 'ใช้งานอยู่', activeCount], ['inactive', 'ปิดใช้งาน', all.length - activeCount]] as const).map(([v, l, n]) => (
          <button key={v} onClick={() => setFilterActive(v)}
            style={{ padding: '7px 16px', borderRadius: '7px 7px 0 0', fontSize: 13, fontWeight: filterActive === v ? 600 : 500, color: filterActive === v ? 'var(--color-accent)' : 'var(--color-text-secondary)', background: filterActive === v ? 'var(--color-surface)' : 'transparent', borderBottom: filterActive === v ? '2px solid var(--color-accent)' : '2px solid transparent', cursor: 'pointer' }}>
            {l} <span style={{ opacity: 0.6 }}>({n})</span>
          </button>
        ))}
      </div>

      {/* Promo cards */}
      {isLoading ? (
        <div style={{ color: 'var(--color-text-secondary)', padding: 20 }}>กำลังโหลด...</div>
      ) : list.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--color-text-muted)' }}>
          <Icon name="tag" size={40} color="var(--color-border)" />
          <div style={{ marginTop: 12, fontSize: 15 }}>ไม่มีโปรโมชั่น</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
          {list.map(p => (
            <PromoCard key={p.id} p={p} products={products} categories={categories} onToggle={handleToggle} onEdit={openEdit} onDelete={handleDelete} admin={admin} />
          ))}
        </div>
      )}
      </>
      )}
      </>
      )}
    </div>
  );
}
