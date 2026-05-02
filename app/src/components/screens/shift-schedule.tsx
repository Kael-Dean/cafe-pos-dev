'use client';

import { useState } from 'react';
import Icon from '../icons';
import { useToast } from '../app-common';
import { useCurrentUser, isAdmin } from '@/hooks/use-current-user';
import { useStaffList, useWeeklySchedule, useAssignShift, type ShiftAssignment } from '@/hooks/use-hr';

const SHIFT_CONFIG: Record<string, { label: string; short: string; bg: string; fg: string; time: string }> = {
  MORNING:   { label: 'กะเช้า',  short: 'เช้า',  bg: '#fef9c3', fg: '#854d0e', time: '07:00–15:00' },
  AFTERNOON: { label: 'กะบ่าย',  short: 'บ่าย',  bg: '#dbeafe', fg: '#1e40af', time: '11:00–19:00' },
  EVENING:   { label: 'กะเย็น',  short: 'เย็น',  bg: '#ede9fe', fg: '#5b21b6', time: '15:00–23:00' },
  FULL_DAY:  { label: 'เต็มวัน', short: 'เต็ม',  bg: '#d1fae5', fg: '#065f46', time: '07:00–23:00' },
  OFF:       { label: 'วันหยุด', short: 'หยุด',  bg: '#f1f5f9', fg: '#94a3b8', time: '—' },
};

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

export default function ShiftSchedule() {
  const toast = useToast();
  const { data: me } = useCurrentUser();
  const admin = isAdmin(me?.role);

  const [weekStart, setWeekStart] = useState(() => dateStr(getMondayOfWeek(new Date())));
  const [editingCell, setEditingCell] = useState<{ userId: string; date: string } | null>(null);

  const { data: staff } = useStaffList();
  const { data: shifts } = useWeeklySchedule(weekStart);
  const assignShift = useAssignShift();

  const prevWeek = () => setWeekStart(dateStr(addDays(new Date(weekStart), -7)));
  const nextWeek = () => setWeekStart(dateStr(addDays(new Date(weekStart), 7)));
  const goToday = () => setWeekStart(dateStr(getMondayOfWeek(new Date())));

  const shiftMap: Record<string, ShiftAssignment> = {};
  (shifts ?? []).forEach(s => { shiftMap[`${s.user_id}:${s.assignment_date}`] = s; });

  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(new Date(weekStart), i));
  const today = dateStr(new Date());
  const staffList = staff ?? [];

  const staffOffToday = staffList.filter(s => shiftMap[`${s.id}:${today}`]?.shift_type === 'OFF').length;
  const morningToday = staffList.filter(s => shiftMap[`${s.id}:${today}`]?.shift_type === 'MORNING').length;
  const afternoonToday = staffList.filter(s => shiftMap[`${s.id}:${today}`]?.shift_type === 'AFTERNOON').length;

  const handleAssign = async (userId: string, date: string, shiftType: string) => {
    try {
      await assignShift.mutateAsync({ user_id: userId, assignment_date: date, shift_type: shiftType });
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
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>จัดการกะพนักงานรายสัปดาห์</div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {[
            { label: 'หยุดวันนี้',   val: staffOffToday,  color: 'var(--color-text-muted)', bg: 'var(--color-surface-2)' },
            { label: 'กะเช้าวันนี้',  val: morningToday,   color: '#854d0e',                 bg: '#fef9c3' },
            { label: 'กะบ่ายวันนี้', val: afternoonToday, color: '#1e40af',                 bg: '#dbeafe' },
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
                  const cfg = shift ? SHIFT_CONFIG[shift.shift_type] : null;
                  const isToday = ds === today;
                  const isEditing = editingCell?.userId === member.id && editingCell?.date === ds;

                  return (
                    <td key={ds} style={{ padding: 5, textAlign: 'center', position: 'relative', borderLeft: '1px solid var(--color-border)', background: isToday ? 'rgba(212,165,116,0.04)' : 'transparent' }}>
                      {isEditing && admin ? (
                        <div style={{ position: 'absolute', zIndex: 60, top: '50%', left: '50%', transform: 'translate(-50%, -50%)', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 10, padding: 8, display: 'flex', flexDirection: 'column', gap: 4, boxShadow: 'var(--shadow-lg)', minWidth: 140 }}>
                          {Object.entries(SHIFT_CONFIG).map(([type, conf]) => (
                            <button key={type} onClick={() => handleAssign(member.id, ds, type)}
                              style={{ padding: '6px 10px', borderRadius: 6, border: 'none', background: conf.bg, color: conf.fg, fontSize: 12, fontWeight: 600, cursor: 'pointer', textAlign: 'left', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                              <span>{conf.label}</span>
                              <span style={{ opacity: 0.65, fontWeight: 400 }}>{conf.time}</span>
                            </button>
                          ))}
                          <button onClick={() => setEditingCell(null)} style={{ padding: 4, background: 'transparent', color: 'var(--color-text-muted)', fontSize: 11, cursor: 'pointer' }}>ยกเลิก</button>
                        </div>
                      ) : (
                        <div
                          onClick={() => admin && setEditingCell({ userId: member.id, date: ds })}
                          title={cfg ? `${cfg.label} ${cfg.time}` : 'คลิกเพื่อตั้งกะ'}
                          style={{ padding: '6px 4px', borderRadius: 7, background: cfg ? cfg.bg : 'transparent', color: cfg ? cfg.fg : 'var(--color-text-muted)', fontSize: 11, fontWeight: cfg ? 700 : 400, cursor: admin ? 'pointer' : 'default', minHeight: 38, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, border: cfg ? 'none' : '1px dashed var(--color-border)', transition: 'all 150ms' }}>
                          {cfg ? (
                            <>
                              <span>{cfg.short}</span>
                              {shift?.shift_type !== 'OFF' && <span style={{ fontSize: 9, opacity: 0.75, fontWeight: 500 }}>{cfg.time.split('–')[0]}</span>}
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

      {/* Day-off summary */}
      <div style={{ marginTop: 20, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 16, boxShadow: 'var(--shadow-xs)' }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: 'var(--color-text-secondary)' }}>สรุปวันหยุดสัปดาห์นี้</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {staffList.map(s => {
            const offDays = weekDates.filter(d => shiftMap[`${s.id}:${dateStr(d)}`]?.shift_type === 'OFF');
            if (!offDays.length) return null;
            return (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 12px', background: '#F1F5F9', borderRadius: 99 }}>
                <div style={{ width: 22, height: 22, borderRadius: 99, background: 'var(--color-accent-50)', color: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 10 }}>{s.name.charAt(0)}</div>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text)' }}>{s.name.split(' ')[0]}</span>
                <span style={{ fontSize: 11, color: '#94A3B8' }}>หยุด {offDays.map(d => { const day = d.getDay(); return DAY_SHORT[day === 0 ? 6 : day - 1]; }).join(', ')}</span>
              </div>
            );
          })}
          {staffList.length > 0 && staffList.every(s => !weekDates.some(d => shiftMap[`${s.id}:${dateStr(d)}`]?.shift_type === 'OFF')) && (
            <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>ไม่มีพนักงานหยุดสัปดาห์นี้</div>
          )}
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
        {Object.entries(SHIFT_CONFIG).map(([type, conf]) => (
          <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 20, background: conf.bg, color: conf.fg, fontSize: 12, fontWeight: 600 }}>
            {conf.label}
            {type !== 'OFF' && <span style={{ opacity: 0.65, fontWeight: 400, fontSize: 11 }}>{conf.time}</span>}
          </div>
        ))}
      </div>
      {admin && <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 8 }}>คลิกที่ช่องเพื่อแก้ไขกะ</div>}
    </div>
  );
}
