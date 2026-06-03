'use client';

import { useState } from 'react';
import Icon from '../icons';
import { useToast } from '../app-common';
import { useCurrentUser, isAdmin } from '@/hooks/use-current-user';
import { useStaffList, useWeeklySchedule, useAssignShift, type ShiftAssignment } from '@/hooks/use-hr';
import { usePreOrders, usePreOrder, type PreOrderStatus, type PreOrderListItem } from '@/hooks/use-pre-orders';

const DAY_SHORT = ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'];
const DAY_FULL = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์'];

const PREORDER_STATUS_LABELS: Record<PreOrderStatus, string> = {
  PENDING: 'รอเริ่ม',
  IN_PROGRESS: 'กำลังทำ',
  COMPLETED: 'เสร็จแล้ว',
  CANCELLED: 'ยกเลิก',
};

const PREORDER_STATUS_COLORS: Record<PreOrderStatus, { fg: string; bg: string }> = {
  PENDING:     { fg: '#9C6A1F',                    bg: 'var(--color-warning-50)' },
  IN_PROGRESS: { fg: 'var(--color-info)',          bg: '#EFF6FF' },
  COMPLETED:   { fg: 'var(--color-success)',       bg: '#F0FDF4' },
  CANCELLED:   { fg: 'var(--color-text-secondary)', bg: 'var(--color-surface-2)' },
};

const thStyle: React.CSSProperties = {
  padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)',
};

function fmtDateTh(s: string): string {
  return new Date(s).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
}

function preOrderLabel(po: { customerName: string | null; customerPhone: string | null }): string {
  return po.customerName || po.customerPhone || 'ลูกค้า';
}

function getMondayOfWeek(d: Date): Date {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.getFullYear(), d.getMonth(), diff);
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400000);
}

function dateStr(d: Date): string {
  return d.toISOString().split('T')[0];
}

// Format "HH:MM:SS" → "HH:MM"
function fmtTime(t: string): string {
  return t.slice(0, 5);
}

// Derive a background colour from start hour so cells remain visually distinct
function shiftCellStyle(shift: ShiftAssignment | undefined): { bg: string; fg: string } {
  if (!shift) return { bg: 'transparent', fg: 'var(--color-text-muted)' };
  const h = parseInt(shift.start_time.slice(0, 2), 10);
  if (h < 10) return { bg: '#fef9c3', fg: '#854d0e' };  // early morning
  if (h < 14) return { bg: '#dbeafe', fg: '#1e40af' };  // midday
  return { bg: '#ede9fe', fg: '#5b21b6' };              // afternoon/evening
}

export default function ShiftSchedule() {
  const toast = useToast();
  const { data: me } = useCurrentUser();
  const admin = isAdmin(me?.role);

  const [weekStart, setWeekStart] = useState(() => dateStr(getMondayOfWeek(new Date())));
  const [editingCell, setEditingCell] = useState<{ userId: string; date: string } | null>(null);
  const [editStart, setEditStart] = useState('08:00');
  const [editEnd, setEditEnd] = useState('16:00');
  const [selectedPreOrderId, setSelectedPreOrderId] = useState<string | null>(null);
  const [showCancelled, setShowCancelled] = useState(false);

  const { data: staff } = useStaffList();
  const { data: shifts } = useWeeklySchedule(weekStart);
  const assignShift = useAssignShift();
  // Pre-orders: fetch all statuses (first 200, due_date asc) and filter to the
  // visible week client-side — no backend date-range param needed.
  const { data: preOrdersPage } = usePreOrders(undefined, 1, 200);

  const prevWeek = () => setWeekStart(dateStr(addDays(new Date(weekStart), -7)));
  const nextWeek = () => setWeekStart(dateStr(addDays(new Date(weekStart), 7)));
  const goToday  = () => setWeekStart(dateStr(getMondayOfWeek(new Date())));

  const shiftMap: Record<string, ShiftAssignment> = {};
  (shifts ?? []).forEach(s => { shiftMap[`${s.user_id}:${s.assignment_date}`] = s; });

  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(new Date(weekStart), i));
  const today = dateStr(new Date());
  const staffList = staff ?? [];

  const shiftsToday = staffList.filter(s => !!shiftMap[`${s.id}:${today}`]).length;
  const noShiftToday = staffList.length - shiftsToday;

  // Group pre-orders by their due date (YYYY-MM-DD string matches dateStr(weekDate)).
  const preOrdersByDate: Record<string, PreOrderListItem[]> = {};
  (preOrdersPage?.items ?? []).forEach(po => {
    if (po.status === 'CANCELLED' && !showCancelled) return;
    if (!preOrdersByDate[po.dueDate]) preOrdersByDate[po.dueDate] = [];
    preOrdersByDate[po.dueDate].push(po);
  });
  const weekPreOrderCount = weekDates.reduce((sum, d) => {
    const list = preOrdersByDate[dateStr(d)] ?? [];
    return sum + list.filter(p => p.status !== 'CANCELLED').length;
  }, 0);

  const openEditor = (userId: string, date: string) => {
    const existing = shiftMap[`${userId}:${date}`];
    setEditStart(existing ? fmtTime(existing.start_time) : '08:00');
    setEditEnd(existing ? fmtTime(existing.end_time) : '16:00');
    setEditingCell({ userId, date });
  };

  const handleAssign = async (userId: string, date: string) => {
    try {
      await assignShift.mutateAsync({
        user_id: userId,
        assignment_date: date,
        start_time: `${editStart}:00`,
        end_time: `${editEnd}:00`,
      });
      setEditingCell(null);
      toast({ kind: 'success', title: 'บันทึกกะแล้ว' });
    } catch (e: unknown) { toast({ kind: 'danger', title: String(e instanceof Error ? e.message : e) }); }
  };

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 32 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em', marginBottom: 4 }}>ตารางกะ / Shift Schedule</h1>
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>จัดการกะพนักงานรายสัปดาห์ — ระบุเวลาเริ่ม/สิ้นสุด</div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {[
            { label: 'มีกะวันนี้',    val: shiftsToday,  color: '#065f46', bg: '#d1fae5' },
            { label: 'ไม่มีกะวันนี้', val: noShiftToday, color: 'var(--color-text-muted)', bg: 'var(--color-surface-2)' },
            { label: 'พรีออเดอร์',    val: weekPreOrderCount, color: '#9C6A1F', bg: 'var(--color-warning-50)' },
          ].map(st => (
            <div key={st.label} style={{ background: st.bg, borderRadius: 10, padding: '10px 16px', textAlign: 'center', minWidth: 80 }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: st.color, fontVariantNumeric: 'tabular-nums' }}>{st.val}</div>
              <div style={{ fontSize: 11, color: st.color, fontWeight: 500 }}>{st.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Week navigation */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 10, padding: '10px 14px', boxShadow: 'var(--shadow-xs)' }}>
        <button onClick={prevWeek} style={{ padding: '6px 10px', borderRadius: 7, border: '1px solid var(--color-border)', background: 'var(--color-surface-2)', display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
          <Icon name="chevronRight" size={15} style={{ transform: 'rotate(180deg)' }} />
        </button>
        <div style={{ flex: 1, textAlign: 'center', fontWeight: 600, fontSize: 15 }}>
          {new Date(weekStart).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })} – {addDays(new Date(weekStart), 6).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })}
        </div>
        <button onClick={nextWeek} style={{ padding: '6px 10px', borderRadius: 7, border: '1px solid var(--color-border)', background: 'var(--color-surface-2)', display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
          <Icon name="chevronRight" size={15} />
        </button>
        <button onClick={goToday} style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid var(--color-border)', background: 'var(--color-surface-2)', fontSize: 13, color: 'var(--color-text-secondary)', fontWeight: 500, cursor: 'pointer' }}>สัปดาห์นี้</button>
        <button onClick={() => setShowCancelled(v => !v)} title="แสดง/ซ่อนพรีออเดอร์ที่ยกเลิก" style={{ padding: '6px 12px', borderRadius: 7, border: '1px solid var(--color-border)', background: showCancelled ? 'var(--color-surface-2)' : 'transparent', fontSize: 12, color: 'var(--color-text-secondary)', fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, border: '1px solid var(--color-border-strong)', background: showCancelled ? 'var(--color-accent)' : 'transparent', display: 'inline-block', flexShrink: 0 }} />
          แสดงที่ยกเลิก
        </button>
      </div>

      {/* Grid */}
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--color-surface-2)' }}>
              <th style={{ textAlign: 'left', padding: '12px 16px', fontSize: 12, color: 'var(--color-text-secondary)', fontWeight: 600, width: 160, borderBottom: '1px solid var(--color-border)' }}>พนักงาน</th>
              {weekDates.map((d, i) => {
                const ds = dateStr(d);
                const isToday = ds === today;
                return (
                  <th key={ds} style={{ padding: '10px 8px', fontSize: 12, fontWeight: isToday ? 700 : 500, textAlign: 'center', borderBottom: '1px solid var(--color-border)', borderLeft: '1px solid var(--color-border)', background: isToday ? 'var(--color-accent-50)' : 'transparent', color: isToday ? 'var(--color-accent-600)' : 'var(--color-text-secondary)', minWidth: 80 }}>
                    <div style={{ fontSize: 11 }}>{DAY_SHORT[i]}</div>
                    <div style={{ fontSize: 16, fontWeight: 700, marginTop: 1 }}>{d.getDate()}</div>
                    {isToday && <div style={{ width: 4, height: 4, borderRadius: 99, background: 'var(--color-accent)', margin: '4px auto 0' }} />}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {staffList.map((member, mi) => (
              <tr key={member.id} style={{ borderBottom: mi < staffList.length - 1 ? '1px solid var(--color-border)' : 'none' }}>
                <td style={{ padding: '10px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <div style={{ width: 30, height: 30, borderRadius: 99, background: 'var(--color-accent-50)', color: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
                      {member.name.charAt(0)}
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>{member.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{member.role}</div>
                    </div>
                  </div>
                </td>
                {weekDates.map(d => {
                  const ds = dateStr(d);
                  const key = `${member.id}:${ds}`;
                  const shift = shiftMap[key];
                  const style = shiftCellStyle(shift);
                  const isToday = ds === today;
                  const isEditing = editingCell?.userId === member.id && editingCell?.date === ds;

                  return (
                    <td key={ds} style={{ padding: 5, textAlign: 'center', position: 'relative', borderLeft: '1px solid var(--color-border)', background: isToday ? 'rgba(212,165,116,0.04)' : 'transparent' }}>
                      <div
                        onClick={() => admin && openEditor(member.id, ds)}
                        title={shift ? `${fmtTime(shift.start_time)}–${fmtTime(shift.end_time)}` : 'คลิกเพื่อตั้งกะ'}
                        style={{ padding: '6px 4px', borderRadius: 7, background: style.bg, color: style.fg, fontSize: 11, fontWeight: shift ? 700 : 400, cursor: admin ? 'pointer' : 'default', minHeight: 38, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, border: isEditing ? '2px solid var(--color-primary)' : (shift ? 'none' : '1px dashed var(--color-border)'), transition: 'all 150ms' }}>
                        {shift ? (
                          <>
                            <span>{fmtTime(shift.start_time)}</span>
                            <span style={{ fontSize: 9, opacity: 0.75, fontWeight: 500 }}>{fmtTime(shift.end_time)}</span>
                          </>
                        ) : <Icon name="plus" size={12} color="var(--color-border)" />}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>

          {/* Pre-orders due — one badge list per day column, aligned to the shift grid */}
          <tbody>
            <tr style={{ borderTop: '2px solid var(--color-border)' }}>
              <td style={{ padding: '12px 16px', verticalAlign: 'top', background: 'var(--color-surface-2)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <Icon name="cake" size={16} color="var(--color-accent)" />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>พรีออเดอร์</div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>ส่งของวันนี้</div>
                  </div>
                </div>
              </td>
              {weekDates.map(d => {
                const ds = dateStr(d);
                const list = preOrdersByDate[ds] ?? [];
                const isToday = ds === today;
                const visible = list.slice(0, 3);
                const extra = list.length - visible.length;
                return (
                  <td key={ds} style={{ padding: 5, verticalAlign: 'top', borderLeft: '1px solid var(--color-border)', background: isToday ? 'rgba(212,165,116,0.04)' : 'transparent' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minHeight: 38 }}>
                      {visible.map(po => {
                        const c = PREORDER_STATUS_COLORS[po.status];
                        const cancelled = po.status === 'CANCELLED';
                        return (
                          <button
                            key={po.id}
                            onClick={() => setSelectedPreOrderId(po.id)}
                            title={`${preOrderLabel(po)} · ${PREORDER_STATUS_LABELS[po.status]}${po.itemCount > 0 ? ` · ${po.itemCount} รายการ` : ''}`}
                            style={{ textAlign: 'left', border: 'none', cursor: 'pointer', borderRadius: 6, padding: '4px 6px', background: c.bg, color: c.fg, fontSize: 10, fontWeight: 600, lineHeight: 1.25, textDecoration: cancelled ? 'line-through' : 'none', opacity: cancelled ? 0.7 : 1, overflow: 'hidden', fontFamily: 'inherit' }}
                          >
                            <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{preOrderLabel(po)}</div>
                            {po.itemCount > 0 && <div style={{ fontSize: 9, fontWeight: 500, opacity: 0.8 }}>{po.itemCount} รายการ</div>}
                          </button>
                        );
                      })}
                      {extra > 0 && (
                        <button onClick={() => setSelectedPreOrderId(list[3].id)} style={{ border: 'none', background: 'transparent', color: 'var(--color-text-muted)', fontSize: 10, fontWeight: 600, cursor: 'pointer', textAlign: 'left', padding: '0 6px', fontFamily: 'inherit' }}>
                          +{extra} เพิ่มเติม
                        </button>
                      )}
                    </div>
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Shift notes by day */}
      <div style={{ marginTop: 20, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 16, boxShadow: 'var(--shadow-xs)' }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: 'var(--color-text-secondary)' }}>พนักงานที่ยังไม่มีกะสัปดาห์นี้</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {staffList.map(s => {
            const unassigned = weekDates.filter(d => !shiftMap[`${s.id}:${dateStr(d)}`]);
            if (unassigned.length === 0) return null;
            return (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 12px', background: '#F1F5F9', borderRadius: 99 }}>
                <div style={{ width: 22, height: 22, borderRadius: 99, background: 'var(--color-accent-50)', color: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 10 }}>{s.name.charAt(0)}</div>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text)' }}>{s.name.split(' ')[0]}</span>
                <span style={{ fontSize: 11, color: '#94A3B8' }}>ไม่มีกะ {unassigned.map(d => { const day = d.getDay(); return DAY_SHORT[day === 0 ? 6 : day - 1]; }).join(', ')}</span>
              </div>
            );
          })}
          {staffList.length > 0 && staffList.every(s => weekDates.every(d => !!shiftMap[`${s.id}:${dateStr(d)}`])) && (
            <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>พนักงานทุกคนมีกะครบสัปดาห์นี้</div>
          )}
        </div>
      </div>

      {admin && <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 8 }}>คลิกที่ช่องเพื่อกำหนดเวลาเข้า-ออกงาน</div>}

      {editingCell && admin && (() => {
        const member = staffList.find(s => s.id === editingCell.userId);
        const d = new Date(editingCell.date);
        const dayIdx = (d.getDay() + 6) % 7;          // Monday = 0
        return (
          <div onClick={() => setEditingCell(null)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: 'var(--color-surface)', borderRadius: 16, width: 460, maxWidth: '92vw', boxShadow: 'var(--shadow-lg)', overflow: 'hidden' }}>
              {/* Header — who & which day */}
              <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface-2)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 99, background: 'var(--color-accent-50)', color: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 18, flexShrink: 0 }}>
                    {member?.name.charAt(0) ?? '?'}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 18, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{member?.name ?? 'พนักงาน'}</div>
                    <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>วัน{DAY_FULL[dayIdx]}ที่ {fmtDateTh(editingCell.date)}</div>
                  </div>
                </div>
                <button onClick={() => setEditingCell(null)} title="ปิด" style={{ padding: 4, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', flexShrink: 0 }}>
                  <Icon name="x" size={20} />
                </button>
              </div>

              {/* Body — time pickers */}
              <div style={{ padding: 24 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 14 }}>กำหนดเวลาเข้า–ออกงาน</div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 6 }}>เวลาเริ่ม</label>
                    <input type="time" value={editStart} onChange={e => setEditStart(e.target.value)} style={{ width: '100%', padding: '11px 12px', borderRadius: 8, border: '1px solid var(--color-border)', fontSize: 17, fontFamily: 'inherit', boxSizing: 'border-box' }} />
                  </div>
                  <div style={{ paddingBottom: 12, fontSize: 13, color: 'var(--color-text-muted)' }}>ถึง</div>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 6 }}>เวลาสิ้นสุด</label>
                    <input type="time" value={editEnd} onChange={e => setEditEnd(e.target.value)} style={{ width: '100%', padding: '11px 12px', borderRadius: 8, border: '1px solid var(--color-border)', fontSize: 17, fontFamily: 'inherit', boxSizing: 'border-box' }} />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
                  <button onClick={() => handleAssign(editingCell.userId, editingCell.date)} disabled={assignShift.isPending} style={{ flex: 1, padding: '12px 0', borderRadius: 8, background: 'var(--color-primary)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', border: 'none' }}>
                    บันทึก
                  </button>
                  <button onClick={() => setEditingCell(null)} style={{ padding: '12px 22px', borderRadius: 8, background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', fontSize: 14, cursor: 'pointer' }}>ยกเลิก</button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {selectedPreOrderId && (
        <PreOrderDetailModal id={selectedPreOrderId} onClose={() => setSelectedPreOrderId(null)} />
      )}
    </div>
  );
}

// Read-only pre-order detail shown when a calendar badge is clicked.
function PreOrderDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: po, isLoading } = usePreOrder(id);
  const fmtMoney = (v: string | null) =>
    v == null ? '—' : `฿${Number(v).toLocaleString('th-TH', { minimumFractionDigits: 2 })}`;

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--color-surface)', borderRadius: 12, width: 560, maxWidth: '90vw', maxHeight: '90vh', overflowY: 'auto', boxShadow: 'var(--shadow-lg)' }}>
        {isLoading || !po ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)' }}>กำลังโหลด…</div>
        ) : (
          <div style={{ padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 18 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{preOrderLabel(po)}</div>
                {po.customerPhone && <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', fontFamily: 'var(--font-num)' }}>{po.customerPhone}</div>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                <span style={{ padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', color: PREORDER_STATUS_COLORS[po.status].fg, background: PREORDER_STATUS_COLORS[po.status].bg }}>
                  {PREORDER_STATUS_LABELS[po.status]}
                </span>
                <button onClick={onClose} title="ปิด" style={{ padding: 4, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}>
                  <Icon name="x" size={18} />
                </button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 18 }}>
              {[
                { label: 'วันที่สั่ง', value: fmtDateTh(po.orderDate) },
                { label: 'วันส่งของ', value: fmtDateTh(po.dueDate) },
                { label: 'มัดจำ', value: po.depositAmount ? `${fmtMoney(po.depositAmount)}${po.depositPaid ? ' (ชำระแล้ว)' : ' (ยังไม่ชำระ)'}` : '—' },
                { label: 'หมายเหตุ', value: po.notes || '—' },
              ].map(m => (
                <div key={m.label}>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 2 }}>{m.label}</div>
                  <div style={{ fontSize: 13, fontWeight: 500, wordBreak: 'break-word' }}>{m.value}</div>
                </div>
              ))}
            </div>

            <div style={{ border: '1px solid var(--color-border)', borderRadius: 10, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'var(--color-surface-2)' }}>
                    <th style={thStyle}>รายการ</th>
                    <th style={{ ...thStyle, textAlign: 'center', width: 50 }}>จำนวน</th>
                    <th style={{ ...thStyle, textAlign: 'right', width: 90 }}>ราคา</th>
                    <th style={{ ...thStyle, textAlign: 'right', width: 100 }}>รวม</th>
                  </tr>
                </thead>
                <tbody>
                  {po.items.map(it => (
                    <tr key={it.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                      <td style={{ padding: '8px 12px' }}>{it.productName}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'center', fontFamily: 'var(--font-num)' }}>{it.quantity}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-num)' }}>{fmtMoney(it.unitPrice)}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-num)', fontWeight: 600 }}>{fmtMoney(it.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: '2px solid var(--color-border)', background: 'var(--color-surface-2)' }}>
                    <td colSpan={3} style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>รวมทั้งหมด</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, fontFamily: 'var(--font-num)' }}>
                      {fmtMoney(String(po.items.reduce((s, it) => s + Number(it.lineTotal), 0)))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
