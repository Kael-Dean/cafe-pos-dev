'use client';

import { useState } from 'react';
import Icon from '../icons';
import { useToast, Tag } from '../app-common';
import { useCurrentUser, isAdmin } from '@/hooks/use-current-user';
import {
  useAllLeaves, useMyLeaves, useCreateLeave, useReviewLeave,
  type LeaveRequest,
} from '@/hooks/use-hr';

const LEAVE_TYPE_LABEL: Record<string, string> = {
  VACATION: 'ลาพักร้อน',
  SICK: 'ลาป่วย',
  PERSONAL: 'ลากิจ',
  OTHER: 'อื่นๆ',
};
const STATUS_TONE: Record<string, 'warning' | 'success' | 'danger' | 'neutral'> = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
};
const STATUS_LABEL: Record<string, string> = { PENDING: 'รอการอนุมัติ', APPROVED: 'อนุมัติแล้ว', REJECTED: 'ไม่อนุมัติ' };

function LeaveCard({ leave, admin, onReview }: { leave: LeaveRequest; admin: boolean; onReview?: (id: string, status: 'APPROVED' | 'REJECTED') => void }) {
  return (
    <div style={{ padding: '14px 16px', background: 'var(--color-surface-2)', borderRadius: 10, display: 'flex', alignItems: 'flex-start', gap: 14 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{leave.user_name || leave.user_id}</span>
          <Tag tone="info">{LEAVE_TYPE_LABEL[leave.leave_type] ?? leave.leave_type}</Tag>
          <Tag tone={STATUS_TONE[leave.status] ?? 'neutral'}>{STATUS_LABEL[leave.status] ?? leave.status}</Tag>
        </div>
        <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: leave.note ? 4 : 0 }}>
          {leave.start_date} → {leave.end_date}
        </div>
        {leave.note && <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{leave.note}</div>}
      </div>
      {admin && leave.status === 'PENDING' && onReview && (
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button onClick={() => onReview(leave.id, 'APPROVED')}
            style={{ padding: '5px 12px', borderRadius: 7, background: 'var(--color-success-50)', color: 'var(--color-success)', fontWeight: 600, fontSize: 12, cursor: 'pointer', border: 'none' }}>
            อนุมัติ
          </button>
          <button onClick={() => onReview(leave.id, 'REJECTED')}
            style={{ padding: '5px 12px', borderRadius: 7, background: 'var(--color-danger-50)', color: 'var(--color-danger)', fontWeight: 600, fontSize: 12, cursor: 'pointer', border: 'none' }}>
            ไม่อนุมัติ
          </button>
        </div>
      )}
    </div>
  );
}

export default function HRDashboard() {
  const toast = useToast();
  const { data: me } = useCurrentUser();
  const admin = isAdmin(me?.role);

  const { data: allLeaves } = useAllLeaves();
  const { data: myLeaves } = useMyLeaves();
  const createLeave = useCreateLeave();
  const reviewLeave = useReviewLeave();

  const [tab, setTab] = useState(admin ? 'overview' : 'my-leaves');
  const [showLeaveForm, setShowLeaveForm] = useState(false);
  const [leaveForm, setLeaveForm] = useState({ start_date: '', end_date: '', leave_type: 'VACATION', note: '' });

  const handleReview = async (id: string, status: 'APPROVED' | 'REJECTED') => {
    try {
      await reviewLeave.mutateAsync({ id, status });
      toast({ kind: 'success', title: status === 'APPROVED' ? 'อนุมัติแล้ว' : 'ไม่อนุมัติ' });
    } catch (e: unknown) { toast({ kind: 'danger', title: String(e instanceof Error ? e.message : e) }); }
  };

  const handleCreateLeave = async () => {
    if (!leaveForm.start_date || !leaveForm.end_date) { toast({ kind: 'warning', title: 'กรอกวันที่' }); return; }
    try {
      await createLeave.mutateAsync({
        start_date: leaveForm.start_date,
        end_date: leaveForm.end_date,
        leave_type: leaveForm.leave_type,
        note: leaveForm.note || undefined,
      });
      toast({ kind: 'success', title: 'ส่งคำขอลาแล้ว' });
      setShowLeaveForm(false);
      setLeaveForm({ start_date: '', end_date: '', leave_type: 'VACATION', note: '' });
    } catch (e: unknown) { toast({ kind: 'danger', title: String(e instanceof Error ? e.message : e) }); }
  };

  const adminTabs = [
    { id: 'overview', label: 'ภาพรวม' },
    { id: 'leaves', label: 'จัดการวันลา' },
    { id: 'calendar', label: 'ปฏิทินทีม' },
  ];
  const staffTabs = [
    { id: 'my-leaves', label: 'วันลาของฉัน' },
    { id: 'calendar', label: 'ปฏิทินทีม' },
  ];
  const tabs = admin ? adminTabs : staffTabs;

  const inputStyle = { padding: '9px 12px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface-2)', color: 'var(--color-text)', fontSize: 14 } as React.CSSProperties;

  // Build a simple month calendar from approved leaves
  const leaves = (admin ? (allLeaves ?? []) : (myLeaves ?? []));
  const approvedLeaves = leaves.filter(l => l.status === 'APPROVED');

  const buildCalendar = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // map date string → names on leave
    const leaveByDate: Record<string, string[]> = {};
    approvedLeaves.forEach(l => {
      const start = new Date(l.start_date);
      const end = new Date(l.end_date);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const key = d.toISOString().split('T')[0];
        if (!leaveByDate[key]) leaveByDate[key] = [];
        leaveByDate[key].push(l.user_name || 'พนักงาน');
      }
    });

    return { firstDay: (firstDay + 6) % 7, daysInMonth, leaveByDate, year, month };
  };

  const { firstDay, daysInMonth, leaveByDate, year, month } = buildCalendar();

  return (
    <div style={{ padding: 32, maxWidth: 960, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8, color: 'var(--color-text)' }}>
        HR & Admin
      </h1>

      <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '1px solid var(--color-border)' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding: '8px 18px', borderRadius: '8px 8px 0 0', fontSize: 14, fontWeight: tab === t.id ? 600 : 500, color: tab === t.id ? 'var(--color-accent)' : 'var(--color-text-secondary)', background: tab === t.id ? 'var(--color-surface)' : 'transparent', borderBottom: tab === t.id ? '2px solid var(--color-accent)' : '2px solid transparent', cursor: 'pointer' }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Admin overview */}
      {tab === 'overview' && admin && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14, marginBottom: 24 }}>
            {[
              { label: 'คำขอลารออนุมัติ', val: (allLeaves ?? []).filter(l => l.status === 'PENDING').length },
              { label: 'อนุมัติแล้วเดือนนี้', val: (allLeaves ?? []).filter(l => l.status === 'APPROVED').length },
            ].map(k => (
              <div key={k.label} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 18 }}>
                <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 6 }}>{k.label}</div>
                <div style={{ fontSize: 28, fontWeight: 700 }}>{k.val}</div>
              </div>
            ))}
          </div>
          <div style={{ color: 'var(--color-text-secondary)', fontSize: 13 }}>ดู KPI รายพนักงานได้ที่ Dashboard → รายงาน</div>
        </div>
      )}

      {/* Admin leave management */}
      {tab === 'leaves' && admin && (
        <div>
          <div style={{ fontWeight: 600, marginBottom: 14, fontSize: 15 }}>คำขอลาทั้งหมด ({(allLeaves ?? []).length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(allLeaves ?? []).length === 0 ? (
              <div style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: 32 }}>ยังไม่มีคำขอ</div>
            ) : (
              (allLeaves ?? []).map(l => <LeaveCard key={l.id} leave={l} admin={admin} onReview={handleReview} />)
            )}
          </div>
        </div>
      )}

      {/* Staff my leaves */}
      {tab === 'my-leaves' && !admin && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>วันลาของฉัน</div>
            <button onClick={() => setShowLeaveForm(v => !v)}
              style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 16px', borderRadius: 8, background: 'var(--color-accent)', color: 'var(--color-primary-700)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
              <Icon name="plus" size={15} /> ขอลา
            </button>
          </div>

          {showLeaveForm && (
            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 18, marginBottom: 16 }}>
              <div style={{ fontWeight: 600, marginBottom: 12 }}>ขอลา</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>วันเริ่ม *</label>
                  <input type="date" value={leaveForm.start_date} onChange={e => setLeaveForm(f => ({ ...f, start_date: e.target.value }))} style={{ ...inputStyle, width: '100%' }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>วันสิ้นสุด *</label>
                  <input type="date" value={leaveForm.end_date} onChange={e => setLeaveForm(f => ({ ...f, end_date: e.target.value }))} style={{ ...inputStyle, width: '100%' }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>ประเภท</label>
                  <select value={leaveForm.leave_type} onChange={e => setLeaveForm(f => ({ ...f, leave_type: e.target.value }))} style={{ ...inputStyle, width: '100%' }}>
                    {Object.entries(LEAVE_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>หมายเหตุ</label>
                  <input value={leaveForm.note} onChange={e => setLeaveForm(f => ({ ...f, note: e.target.value }))} placeholder="ไม่บังคับ" style={{ ...inputStyle, width: '100%' }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={handleCreateLeave} disabled={createLeave.isPending}
                  style={{ padding: '9px 18px', borderRadius: 8, background: 'var(--color-accent)', color: 'var(--color-primary-700)', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                  {createLeave.isPending ? '...' : 'ส่งคำขอ'}
                </button>
                <button onClick={() => setShowLeaveForm(false)} style={{ padding: '9px 18px', borderRadius: 8, background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)', fontSize: 14, cursor: 'pointer' }}>ยกเลิก</button>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(myLeaves ?? []).length === 0 ? (
              <div style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: 32 }}>ยังไม่มีคำขอ</div>
            ) : (
              (myLeaves ?? []).map(l => <LeaveCard key={l.id} leave={l} admin={false} />)
            )}
          </div>
        </div>
      )}

      {/* Team calendar */}
      {tab === 'calendar' && (
        <div>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 16 }}>
            {new Date(year, month).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' })}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
            {['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'].map(d => (
              <div key={d} style={{ textAlign: 'center', fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', padding: '4px 0' }}>{d}</div>
            ))}
            {Array.from({ length: firstDay }).map((_, i) => <div key={`e-${i}`} />)}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const d = i + 1;
              const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
              const names = leaveByDate[dateStr] ?? [];
              const isToday = dateStr === new Date().toISOString().split('T')[0];
              return (
                <div key={d} style={{ minHeight: 56, borderRadius: 8, border: `1px solid ${isToday ? 'var(--color-accent)' : 'var(--color-border)'}`, padding: '4px 6px', background: isToday ? 'rgba(212,165,116,0.08)' : 'var(--color-surface)' }}>
                  <div style={{ fontSize: 11, fontWeight: isToday ? 700 : 500, color: isToday ? 'var(--color-accent)' : 'var(--color-text)', marginBottom: 2 }}>{d}</div>
                  {names.map((n, ni) => (
                    <div key={ni} style={{ fontSize: 9, background: 'var(--color-danger-50)', color: 'var(--color-danger)', borderRadius: 3, padding: '1px 4px', marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n}</div>
                  ))}
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 12 }}>แสดงเฉพาะวันลาที่อนุมัติแล้ว</div>
        </div>
      )}
    </div>
  );
}
