'use client';

import { useState } from 'react';
import Icon from '../icons';
import { useToast, Tag, baht } from '../app-common';
import { useCurrentUser, isAdmin } from '@/hooks/use-current-user';
import { usePromotions, useCreatePromotion, useUpdatePromotion, useDeletePromotion } from '@/hooks/use-promotions';

const today = () => new Date().toISOString().split('T')[0];

export default function PromotionsScreen() {
  const toast = useToast();
  const { data: me } = useCurrentUser();
  const admin = isAdmin(me?.role);

  const { data: promotions, isLoading } = usePromotions();
  const createPromo = useCreatePromotion();
  const updatePromo = useUpdatePromotion();
  const deletePromo = useDeletePromotion();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: '', description: '', discount_type: 'PERCENT' as 'PERCENT' | 'FIXED',
    discount_value: '', min_order_amount: '', start_date: '', end_date: '',
  });
  const [tab, setTab] = useState<'promotions' | 'printer'>('promotions');

  const handleCreate = async () => {
    if (!form.name.trim()) { toast({ kind: 'warning', title: 'กรอกชื่อโปรโมชั่น' }); return; }
    const val = parseFloat(form.discount_value);
    if (isNaN(val) || val <= 0) { toast({ kind: 'warning', title: 'กรอกมูลค่าส่วนลด' }); return; }
    try {
      await createPromo.mutateAsync({
        name: form.name,
        description: form.description || undefined,
        discount_type: form.discount_type,
        discount_value: val,
        min_order_amount: parseFloat(form.min_order_amount) || 0,
        start_date: form.start_date || undefined,
        end_date: form.end_date || undefined,
      });
      toast({ kind: 'success', title: 'สร้างโปรโมชั่นแล้ว' });
      setShowForm(false);
      setForm({ name: '', description: '', discount_type: 'PERCENT', discount_value: '', min_order_amount: '', start_date: '', end_date: '' });
    } catch (e: unknown) { toast({ kind: 'danger', title: String(e instanceof Error ? e.message : e) }); }
  };

  const handleToggle = async (id: string, is_active: boolean) => {
    try {
      await updatePromo.mutateAsync({ id, is_active: !is_active });
    } catch (e: unknown) { toast({ kind: 'danger', title: String(e instanceof Error ? e.message : e) }); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('ลบโปรโมชั่นนี้?')) return;
    try {
      await deletePromo.mutateAsync(id);
      toast({ kind: 'success', title: 'ลบแล้ว' });
    } catch (e: unknown) { toast({ kind: 'danger', title: String(e instanceof Error ? e.message : e) }); }
  };

  const inputStyle = { padding: '9px 12px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface-2)', color: 'var(--color-text)', fontSize: 14 } as React.CSSProperties;

  return (
    <div style={{ padding: 32, maxWidth: 920, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8, color: 'var(--color-text)' }}>Promotions & Hardware</h1>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '1px solid var(--color-border)', paddingBottom: 0 }}>
        {(['promotions', 'printer'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding: '8px 18px', borderRadius: '8px 8px 0 0', fontSize: 14, fontWeight: tab === t ? 600 : 500, color: tab === t ? 'var(--color-accent)' : 'var(--color-text-secondary)', background: tab === t ? 'var(--color-surface)' : 'transparent', borderBottom: tab === t ? '2px solid var(--color-accent)' : '2px solid transparent', cursor: 'pointer' }}>
            {t === 'promotions' ? 'โปรโมชั่น' : 'เครื่องพิมพ์'}
          </button>
        ))}
      </div>

      {tab === 'promotions' && (
        <>
          {admin && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
              <button onClick={() => setShowForm(v => !v)}
                style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 18px', borderRadius: 8, background: 'var(--color-accent)', color: 'var(--color-primary-700)', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                <Icon name="plus" size={16} /> สร้างโปรโมชั่น
              </button>
            </div>
          )}

          {showForm && (
            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 20, marginBottom: 20 }}>
              <div style={{ fontWeight: 600, marginBottom: 14 }}>โปรโมชั่นใหม่</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>ชื่อ *</label>
                  <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="เช่น ลด 10% วันจันทร์" style={{ ...inputStyle, width: '100%' }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>ประเภทส่วนลด</label>
                  <select value={form.discount_type} onChange={e => setForm(f => ({ ...f, discount_type: e.target.value as 'PERCENT' | 'FIXED' }))} style={{ ...inputStyle, width: '100%' }}>
                    <option value="PERCENT">เปอร์เซ็นต์ (%)</option>
                    <option value="FIXED">จำนวนเงิน (฿)</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>มูลค่าส่วนลด *</label>
                  <input value={form.discount_value} onChange={e => setForm(f => ({ ...f, discount_value: e.target.value }))} type="number" min="0.01" placeholder={form.discount_type === 'PERCENT' ? '10' : '50'} style={{ ...inputStyle, width: '100%' }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>ยอดขั้นต่ำ (฿)</label>
                  <input value={form.min_order_amount} onChange={e => setForm(f => ({ ...f, min_order_amount: e.target.value }))} type="number" min="0" placeholder="0" style={{ ...inputStyle, width: '100%' }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>วันเริ่ม</label>
                  <input value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} type="date" style={{ ...inputStyle, width: '100%' }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>วันสิ้นสุด</label>
                  <input value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} type="date" style={{ ...inputStyle, width: '100%' }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                <button onClick={handleCreate} disabled={createPromo.isPending}
                  style={{ padding: '9px 18px', borderRadius: 8, background: 'var(--color-accent)', color: 'var(--color-primary-700)', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                  {createPromo.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
                <button onClick={() => setShowForm(false)} style={{ padding: '9px 18px', borderRadius: 8, background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)', fontSize: 14, cursor: 'pointer' }}>
                  ยกเลิก
                </button>
              </div>
            </div>
          )}

          {isLoading ? (
            <div style={{ color: 'var(--color-text-secondary)', padding: 20 }}>กำลังโหลด...</div>
          ) : (promotions ?? []).length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--color-text-muted)', padding: 40 }}>ยังไม่มีโปรโมชั่น</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
              {(promotions ?? []).map(p => (
                <div key={p.id} style={{ background: 'var(--color-surface)', border: `1px solid ${p.is_active ? 'var(--color-border)' : 'var(--color-border)'}`, borderRadius: 12, padding: 18, opacity: p.is_active ? 1 : 0.55 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                    <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--color-text)' }}>{p.name}</div>
                    <Tag tone={p.is_active ? 'success' : 'neutral'}>{p.is_active ? 'เปิดใช้' : 'ปิด'}</Tag>
                  </div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--color-accent)', marginBottom: 8 }}>
                    {p.discount_type === 'PERCENT' ? `${Number(p.discount_value)}%` : baht(Number(p.discount_value))} OFF
                  </div>
                  {Number(p.min_order_amount) > 0 && (
                    <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 6 }}>ขั้นต่ำ {baht(Number(p.min_order_amount))}</div>
                  )}
                  {(p.start_date || p.end_date) && (
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 10 }}>
                      {p.start_date ?? '∞'} → {p.end_date ?? '∞'}
                    </div>
                  )}
                  {admin && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                      <button onClick={() => handleToggle(p.id, p.is_active)}
                        style={{ flex: 1, padding: '7px 0', borderRadius: 7, border: '1px solid var(--color-border)', background: 'var(--color-surface-2)', color: 'var(--color-text)', fontSize: 12, cursor: 'pointer' }}>
                        {p.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                      </button>
                      <button onClick={() => handleDelete(p.id)}
                        style={{ padding: '7px 12px', borderRadius: 7, border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-danger)', fontSize: 12, cursor: 'pointer' }}>
                        <Icon name="trash" size={14} />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'printer' && (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 28, maxWidth: 500 }}>
          <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 6 }}>การตั้งค่าเครื่องพิมพ์</div>
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 20 }}>ระบบจะใช้ระบบพิมพ์ของเบราว์เซอร์ กำหนดค่าเครื่องพิมพ์ได้จาก System Print Dialog</div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>ขนาดใบเสร็จ</label>
            <select defaultValue={typeof window !== 'undefined' ? localStorage.getItem('receipt_size') ?? '80mm' : '80mm'}
              onChange={e => localStorage.setItem('receipt_size', e.target.value)}
              style={{ ...inputStyle, width: '100%' }}>
              <option value="80mm">80mm (มาตรฐาน)</option>
              <option value="58mm">58mm (เล็ก)</option>
              <option value="a4">A4</option>
            </select>
          </div>
          <button onClick={() => window.print()}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 18px', borderRadius: 8, background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)', fontSize: 14, cursor: 'pointer' }}>
            <Icon name="print" size={16} /> ทดสอบพิมพ์
          </button>
        </div>
      )}
    </div>
  );
}
