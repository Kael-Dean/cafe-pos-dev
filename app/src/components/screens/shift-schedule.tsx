'use client';

import { useState } from 'react';
import Icon from '../icons';
import { useToast } from '../app-common';
import { useCurrentUser, isAdmin } from '@/hooks/use-current-user';
import { useStaffList, useWeeklySchedule, useAssignShift, type ShiftAssignment } from '@/hooks/use-hr';

const DAY_SHORT = ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'];

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

  const { data: staff } = useStaffList();
  const { data: shifts } = useWeeklySchedule(weekStart);
  const assignShift = useAssignShift();

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
      {editingCell && <div style={{ position: 'fixed', inset: 0, zIndex: 50 }} onClick={() => setEditingCell(null)} />}

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
                      {isEditing && admin ? (
                        <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', zIndex: 60, top: '50%', left: '50%', transform: 'translate(-50%, -50%)', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 8, boxShadow: 'var(--shadow-lg)', minWidth: 180 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)' }}>กำหนดเวลา</div>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <input type="time" value={editStart} onChange={e => setEditStart(e.target.value)} style={{ flex: 1, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--color-border)', fontSize: 13, fontFamily: 'inherit' }} />
                            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>ถึง</span>
                            <input type="time" value={editEnd} onChange={e => setEditEnd(e.target.value)} style={{ flex: 1, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--color-border)', fontSize: 13, fontFamily: 'inherit' }} />
                          </div>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button onClick={() => handleAssign(member.id, ds)} disabled={assignShift.isPending} style={{ flex: 1, padding: '6px 0', borderRadius: 6, background: 'var(--color-primary)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none' }}>
                              บันทึก
                            </button>
                            <button onClick={() => setEditingCell(null)} style={{ padding: '6px 10px', borderRadius: 6, background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', fontSize: 12, cursor: 'pointer' }}>ยกเลิก</button>
                          </div>
                        </div>
                      ) : (
                        <div
                          onClick={() => admin && openEditor(member.id, ds)}
                          title={shift ? `${fmtTime(shift.start_time)}–${fmtTime(shift.end_time)}` : 'คลิกเพื่อตั้งกะ'}
                          style={{ padding: '6px 4px', borderRadius: 7, background: style.bg, color: style.fg, fontSize: 11, fontWeight: shift ? 700 : 400, cursor: admin ? 'pointer' : 'default', minHeight: 38, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, border: shift ? 'none' : '1px dashed var(--color-border)', transition: 'all 150ms' }}>
                          {shift ? (
                            <>
                              <span>{fmtTime(shift.start_time)}</span>
                              <span style={{ fontSize: 9, opacity: 0.75, fontWeight: 500 }}>{fmtTime(shift.end_time)}</span>
                            </>
                          ) : <Icon name="plus" size={12} color="var(--color-border)" />}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
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
    </div>
  );
}
