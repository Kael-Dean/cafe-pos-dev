'use client';

import { useState } from 'react';
import Icon from '../icons';
import { useToast, Tag } from '../app-common';
import { useCurrentUser, isAdmin } from '@/hooks/use-current-user';
import { useStaffList, useWeeklySchedule, useAssignShift, type ShiftAssignment } from '@/hooks/use-hr';

const SHIFT_CONFIG: Record<string, { label: string; short: string; bg: string; fg: string }> = {
  MORNING:   { label: 'กะเช้า',   short: 'เช้า',   bg: '#fef9c3', fg: '#854d0e' },
  AFTERNOON: { label: 'กะบ่าย',   short: 'บ่าย',   bg: '#dbeafe', fg: '#1e40af' },
  EVENING:   { label: 'กะเย็น',   short: 'เย็น',   bg: '#ede9fe', fg: '#5b21b6' },
  FULL_DAY:  { label: 'เต็มวัน',   short: 'เต็ม',   bg: '#d1fae5', fg: '#065f46' },
  OFF:       { label: 'วันหยุด',  short: 'หยุด',   bg: '#f1f5f9', fg: '#94a3b8' },
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

  const prevWeek = () => {
    const d = new Date(weekStart);
    setWeekStart(dateStr(addDays(d, -7)));
  };
  const nextWeek = () => {
    const d = new Date(weekStart);
    setWeekStart(dateStr(addDays(d, 7)));
  };

  // Map userId+date → shift
  const shiftMap: Record<string, ShiftAssignment> = {};
  (shifts ?? []).forEach(s => { shiftMap[`${s.user_id}:${s.assignment_date}`] = s; });

  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(new Date(weekStart), i));
  const today = dateStr(new Date());

  const handleAssign = async (userId: string, date: string, shiftType: string) => {
    try {
      await assignShift.mutateAsync({ user_id: userId, assignment_date: date, shift_type: shiftType });
      setEditingCell(null);
    } catch (e: unknown) { toast({ kind: 'danger', title: String(e instanceof Error ? e.message : e) }); }
  };

  return (
    <div style={{ padding: 32, maxWidth: 1000, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 20, color: 'var(--color-text)' }}>ตารางกะ / Shift Schedule</h1>

      {/* Week navigation */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <button onClick={prevWeek} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', cursor: 'pointer' }}>
          <Icon name="chevronRight" size={16} style={{ transform: 'rotate(180deg)' }} />
        </button>
        <div style={{ fontWeight: 600, fontSize: 15 }}>
          {new Date(weekStart).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })} – {addDays(new Date(weekStart), 6).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })}
        </div>
        <button onClick={nextWeek} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', cursor: 'pointer' }}>
          <Icon name="chevronRight" size={16} />
        </button>
        <button onClick={() => setWeekStart(dateStr(getMondayOfWeek(new Date())))}
          style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)', fontSize: 13, cursor: 'pointer' }}>
          สัปดาห์นี้
        </button>
      </div>

      {/* Grid */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 12, color: 'var(--color-text-secondary)', fontWeight: 600, width: 130 }}>พนักงาน</th>
              {weekDates.map((d, i) => {
                const ds = dateStr(d);
                return (
                  <th key={ds} style={{ padding: '8px 6px', fontSize: 12, color: ds === today ? 'var(--color-accent)' : 'var(--color-text-secondary)', fontWeight: ds === today ? 700 : 500, textAlign: 'center', borderBottom: ds === today ? '2px solid var(--color-accent)' : '1px solid var(--color-border)' }}>
                    <div>{DAY_SHORT[i]}</div>
                    <div style={{ fontSize: 11 }}>{d.getDate()}</div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {(staff ?? []).map(member => (
              <tr key={member.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                <td style={{ padding: '10px 12px', fontSize: 13, fontWeight: 500 }}>
                  <div>{member.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{member.role}</div>
                </td>
                {weekDates.map(d => {
                  const ds = dateStr(d);
                  const key = `${member.id}:${ds}`;
                  const shift = shiftMap[key];
                  const cfg = shift ? SHIFT_CONFIG[shift.shift_type] : null;
                  const isEditing = editingCell?.userId === member.id && editingCell?.date === ds;

                  return (
                    <td key={ds} style={{ padding: 4, textAlign: 'center', position: 'relative', background: ds === today ? 'rgba(212,165,116,0.04)' : 'transparent' }}>
                      {isEditing && admin ? (
                        <div style={{ position: 'absolute', zIndex: 10, top: '50%', left: '50%', transform: 'translate(-50%, -50%)', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, padding: 8, display: 'flex', flexDirection: 'column', gap: 4, boxShadow: '0 4px 20px rgba(0,0,0,0.3)', minWidth: 90 }}>
                          {Object.entries(SHIFT_CONFIG).map(([type, conf]) => (
                            <button key={type} onClick={() => handleAssign(member.id, ds, type)}
                              style={{ padding: '5px 8px', borderRadius: 6, border: 'none', background: conf.bg, color: conf.fg, fontSize: 12, fontWeight: 600, cursor: 'pointer', textAlign: 'left' }}>
                              {conf.label}
                            </button>
                          ))}
                          <button onClick={() => setEditingCell(null)} style={{ padding: '4px', border: 'none', background: 'transparent', color: 'var(--color-text-muted)', fontSize: 11, cursor: 'pointer' }}>ยกเลิก</button>
                        </div>
                      ) : (
                        <div
                          onClick={() => admin && setEditingCell({ userId: member.id, date: ds })}
                          style={{ padding: '6px 4px', borderRadius: 6, background: cfg ? cfg.bg : 'transparent', color: cfg ? cfg.fg : 'var(--color-text-muted)', fontSize: 11, fontWeight: cfg ? 700 : 400, cursor: admin ? 'pointer' : 'default', minHeight: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', border: cfg ? 'none' : '1px dashed var(--color-border)' }}>
                          {cfg ? cfg.short : <Icon name="plus" size={12} color="var(--color-border)" />}
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

      {/* Legend */}
      <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
        {Object.entries(SHIFT_CONFIG).map(([type, conf]) => (
          <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 20, background: conf.bg, color: conf.fg, fontSize: 12, fontWeight: 600 }}>
            {conf.label}
          </div>
        ))}
      </div>

      {admin && <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 10 }}>คลิกที่ช่องเพื่อแก้ไขกะ</div>}
    </div>
  );
}
