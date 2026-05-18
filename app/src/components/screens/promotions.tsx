'use client';

import { useState } from 'react';
import Icon from '../icons';
import { useToast, Tag, baht } from '../app-common';
import { useCurrentUser, isAdmin } from '@/hooks/use-current-user';
import { usePromotions, useCreatePromotion, useUpdatePromotion, useDeletePromotion } from '@/hooks/use-promotions';

type DiscountType = 'PERCENT' | 'FIXED' | 'GIFT';

const TYPE_LABEL: Record<DiscountType, string> = { PERCENT: 'ส่วนลด %', FIXED: 'ลดราคา ฿', GIFT: 'ของแถม' };
const TYPE_TONE: Record<DiscountType, 'accent' | 'info' | 'success'> = { PERCENT: 'accent', FIXED: 'info', GIFT: 'success' };

const IS = {
  padding: '9px 12px', borderRadius: 8, border: '1px solid var(--color-border)',
  background: 'var(--color-surface-2)', color: 'var(--color-text)', fontSize: 14,
} as React.CSSProperties;

function PromoCard({ p, onToggle, onDelete, admin }: {
  p: { id: string; name: string; description?: string | null; discount_type: string; discount_value: number | string; gift_item?: string | null; code?: string | null; min_order_amount?: number | string | null; start_date?: string | null; end_date?: string | null; is_active: boolean; use_count?: number | null };
  onToggle: (id: string, is_active: boolean) => void;
  onDelete: (id: string) => void;
  admin: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const copyCode = () => {
    if (!p.code) return;
    navigator.clipboard.writeText(p.code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const type = p.discount_type as DiscountType;
  const val = Number(p.discount_value);
  const minOrder = Number(p.min_order_amount ?? 0);
  const useCount = Number(p.use_count ?? 0);

  return (
    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 14, padding: 20, opacity: p.is_active ? 1 : 0.6, boxShadow: 'var(--shadow-xs)', transition: 'opacity 200ms' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{p.name}</div>
          <Tag tone={TYPE_TONE[type] ?? 'neutral'}>{TYPE_LABEL[type] ?? type}</Tag>
        </div>
        <Tag tone={p.is_active ? 'success' : 'neutral'}>{p.is_active ? 'เปิดใช้' : 'ปิด'}</Tag>
      </div>

      {/* Value display */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, margin: '12px 0', padding: '10px 14px', background: 'var(--color-accent-50)', borderRadius: 8 }}>
        {type === 'PERCENT' && <><span style={{ fontSize: 30, fontWeight: 800, color: 'var(--color-accent-600)', fontVariantNumeric: 'tabular-nums' }}>{val}%</span><span style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>ส่วนลด</span></>}
        {type === 'FIXED' && <><span style={{ fontSize: 30, fontWeight: 800, color: 'var(--color-accent-600)', fontVariantNumeric: 'tabular-nums' }}>{baht(val)}</span><span style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>ส่วนลด</span></>}
        {type === 'GIFT' && <><Icon name="gift" size={22} color="var(--color-accent-600)" /><span style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-accent-600)' }}>{p.gift_item || 'ของแถม'}</span></>}
      </div>

      {p.description && <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 8 }}>{p.description}</div>}
      {minOrder > 0 && <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 4 }}>ยอดขั้นต่ำ {baht(minOrder)}</div>}
      {(p.start_date || p.end_date) && <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 8 }}>{p.start_date ?? '∞'} → {p.end_date ?? '∞'}</div>}

      {p.code && (
        <button onClick={copyCode} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 6, background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', fontSize: 12, fontWeight: 700, color: copied ? 'var(--color-success)' : 'var(--color-primary)', letterSpacing: 0.5, cursor: 'pointer', marginBottom: 12, transition: 'all 150ms' }}>
          <Icon name={copied ? 'check' : 'tag'} size={12} color={copied ? 'var(--color-success)' : 'currentColor'} />
          {copied ? 'คัดลอกแล้ว' : p.code}
        </button>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>ใช้ไปแล้ว <span style={{ fontWeight: 600, color: 'var(--color-text-secondary)', fontVariantNumeric: 'tabular-nums' }}>{useCount}</span> ครั้ง</div>
        {admin && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => onToggle(p.id, p.is_active)} style={{ padding: '6px 12px', borderRadius: 7, border: '1px solid var(--color-border)', background: 'var(--color-surface-2)', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
              {p.is_active ? 'ปิด' : 'เปิด'}
            </button>
            <button onClick={() => onDelete(p.id)} style={{ padding: '6px 8px', borderRadius: 7, border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-danger)', cursor: 'pointer' }}>
              <Icon name="trash" size={13} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function PromotionsScreen() {
  const toast = useToast();
  const { data: me } = useCurrentUser();
  const admin = isAdmin(me?.role);

  const { data: promotions, isLoading } = usePromotions();
  const createPromo = useCreatePromotion();
  const updatePromo = useUpdatePromotion();
  const deletePromo = useDeletePromotion();

  const [showForm, setShowForm] = useState(false);
  const [filterActive, setFilterActive] = useState<'all' | 'active' | 'inactive'>('all');
  const [form, setForm] = useState({
    name: '', description: '', discount_type: 'PERCENT' as DiscountType,
    discount_value: '', gift_item: '', min_order_amount: '',
    start_date: '', end_date: '', code: '',
  });

  const promoList = promotions ?? [];
  const activeCount = promoList.filter(p => p.is_active).length;
  const totalUses = promoList.reduce((s, p) => s + Number((p as { use_count?: number | null }).use_count ?? 0), 0);

  const filtered = promoList.filter(p =>
    filterActive === 'all' ? true : filterActive === 'active' ? p.is_active : !p.is_active
  );

  const handleCreate = async () => {
    if (!form.name.trim()) { toast({ kind: 'warning', title: 'กรอกชื่อโปรโมชั่น' }); return; }
    if (form.discount_type !== 'GIFT') {
      const val = parseFloat(form.discount_value);
      if (isNaN(val) || val <= 0) { toast({ kind: 'warning', title: 'กรอกมูลค่าส่วนลด' }); return; }
    }
    try {
      await createPromo.mutateAsync({
        name: form.name,
        description: form.description || undefined,
        discount_type: form.discount_type as 'PERCENT' | 'FIXED',
        discount_value: form.discount_type === 'GIFT' ? 0 : parseFloat(form.discount_value),
        min_order_amount: parseFloat(form.min_order_amount) || 0,
        start_date: form.start_date || undefined,
        end_date: form.end_date || undefined,
      });
      toast({ kind: 'success', title: 'สร้างโปรโมชั่นแล้ว' });
      setShowForm(false);
      setForm({ name: '', description: '', discount_type: 'PERCENT', discount_value: '', gift_item: '', min_order_amount: '', start_date: '', end_date: '', code: '' });
    } catch (e: unknown) { toast({ kind: 'danger', title: String(e instanceof Error ? e.message : e) }); }
  };

  const handleToggle = async (id: string, is_active: boolean) => {
    try { await updatePromo.mutateAsync({ id, is_active: !is_active }); }
    catch (e: unknown) { toast({ kind: 'danger', title: String(e instanceof Error ? e.message : e) }); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('ลบโปรโมชั่นนี้?')) return;
    try { await deletePromo.mutateAsync(id); toast({ kind: 'success', title: 'ลบแล้ว' }); }
    catch (e: unknown) { toast({ kind: 'danger', title: String(e instanceof Error ? e.message : e) }); }
  };

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 32 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em', marginBottom: 4 }}>โปรโมชั่น / Promotions</h1>
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>จัดการส่วนลด ของแถม และคูปองโปรโมชั่น</div>
        </div>
        {admin && (
          <button onClick={() => setShowForm(v => !v)}
            style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '10px 20px', borderRadius: 8, background: 'var(--color-accent)', color: 'var(--color-primary-700)', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
            <Icon name="plus" size={15} /> สร้างโปรโมชั่น
          </button>
        )}
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'โปรโมชั่นที่ใช้งาน', val: activeCount,        suffix: 'รายการ', color: 'var(--color-success)',        bg: 'var(--color-success-50)' },
          { label: 'ใช้งานไปแล้ว',        val: totalUses,          suffix: 'ครั้ง',  color: 'var(--color-info)',           bg: 'var(--color-info-50)' },
          { label: 'โปรโมชั่นทั้งหมด',    val: promoList.length,   suffix: 'รายการ', color: 'var(--color-text-secondary)', bg: 'var(--color-surface-2)' },
        ].map(s => (
          <div key={s.label} style={{ background: s.bg, borderRadius: 10, padding: '14px 18px', flex: 1 }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: s.color, fontVariantNumeric: 'tabular-nums' }}>{s.val} <span style={{ fontSize: 13, fontWeight: 500 }}>{s.suffix}</span></div>
            <div style={{ fontSize: 12, color: s.color, fontWeight: 500, marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Create form */}
      {showForm && (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 22, marginBottom: 22, boxShadow: 'var(--shadow-md)' }}>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16 }}>โปรโมชั่นใหม่</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div style={{ gridColumn: '1/-1' }}>
              <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>ชื่อโปรโมชั่น *</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={{ ...IS, width: '100%' }} placeholder="เช่น Happy Hour วันจันทร์" />
            </div>
            <div style={{ gridColumn: '1/-1' }}>
              <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>รายละเอียด</label>
              <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} style={{ ...IS, width: '100%' }} placeholder="อธิบายเงื่อนไขโปรโมชั่น" />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>ประเภท</label>
              <select value={form.discount_type} onChange={e => setForm(f => ({ ...f, discount_type: e.target.value as DiscountType }))} style={{ ...IS, width: '100%' }}>
                <option value="PERCENT">ส่วนลด % (เปอร์เซ็นต์)</option>
                <option value="FIXED">ลดราคา ฿ (จำนวนเงิน)</option>
                <option value="GIFT">ของแถม (Free item)</option>
              </select>
            </div>
            {form.discount_type === 'GIFT' ? (
              <div>
                <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>ของแถม</label>
                <input value={form.gift_item} onChange={e => setForm(f => ({ ...f, gift_item: e.target.value }))} style={{ ...IS, width: '100%' }} placeholder="เช่น เค้ก 1 ชิ้น" />
              </div>
            ) : (
              <div>
                <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>มูลค่าส่วนลด *</label>
                <input value={form.discount_value} onChange={e => setForm(f => ({ ...f, discount_value: e.target.value }))} type="number" style={{ ...IS, width: '100%' }} placeholder={form.discount_type === 'PERCENT' ? '10 (%)' : '50 (บาท)'} />
              </div>
            )}
            <div>
              <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>ยอดซื้อขั้นต่ำ (฿)</label>
              <input value={form.min_order_amount} onChange={e => setForm(f => ({ ...f, min_order_amount: e.target.value }))} type="number" style={{ ...IS, width: '100%' }} placeholder="0" />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>รหัสคูปอง</label>
              <input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))} style={{ ...IS, width: '100%' }} placeholder="เช่น HAPPY10" />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>วันเริ่ม</label>
              <input value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} type="date" style={{ ...IS, width: '100%' }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>วันสิ้นสุด</label>
              <input value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} type="date" style={{ ...IS, width: '100%' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button onClick={handleCreate} disabled={createPromo.isPending}
              style={{ padding: '10px 22px', borderRadius: 8, background: 'var(--color-accent)', color: 'var(--color-primary-700)', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
              {createPromo.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
            <button onClick={() => setShowForm(false)} style={{ padding: '10px 22px', borderRadius: 8, background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', fontSize: 14, cursor: 'pointer' }}>ยกเลิก</button>
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--color-border)' }}>
        {([['all', 'ทั้งหมด'], ['active', 'ใช้งานอยู่'], ['inactive', 'ปิดใช้งาน']] as const).map(([v, l]) => (
          <button key={v} onClick={() => setFilterActive(v)}
            style={{ padding: '7px 16px', borderRadius: '7px 7px 0 0', fontSize: 13, fontWeight: filterActive === v ? 600 : 500, color: filterActive === v ? 'var(--color-accent)' : 'var(--color-text-secondary)', background: filterActive === v ? 'var(--color-surface)' : 'transparent', borderBottom: filterActive === v ? '2px solid var(--color-accent)' : '2px solid transparent', cursor: 'pointer' }}>
            {l} <span style={{ opacity: 0.6 }}>({v === 'all' ? promoList.length : v === 'active' ? activeCount : promoList.length - activeCount})</span>
          </button>
        ))}
      </div>

      {/* Promo cards */}
      {isLoading ? (
        <div style={{ color: 'var(--color-text-secondary)', padding: 20 }}>กำลังโหลด...</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--color-text-muted)' }}>
          <Icon name="tag" size={40} color="var(--color-border)" />
          <div style={{ marginTop: 12, fontSize: 15 }}>ไม่มีโปรโมชั่น</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
          {filtered.map(p => (
            <PromoCard key={p.id} p={p as Parameters<typeof PromoCard>[0]['p']} onToggle={handleToggle} onDelete={handleDelete} admin={admin} />
          ))}
        </div>
      )}
    </div>
  );
}
