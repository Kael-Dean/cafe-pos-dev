'use client';

import { useState } from 'react';
import Icon from '../icons';
import { useToast, ModalShell } from '../app-common';
import { useCurrentUser, isAdmin } from '@/hooks/use-current-user';
import { useCountUp } from '@/lib/motion';
import { Skeleton, SkeletonTable } from '@/components/ui/skeleton';
import { useStaffList, useWeeklySchedule, useAssignShift, type ShiftAssignment } from '@/hooks/use-hr';
import { usePreOrders, usePreOrder, type PreOrderStatus, type PreOrderListItem } from '@/hooks/use-pre-orders';
import { useIsPhone } from '@/hooks/use-media-query';

// Phone-only rules (< 768px). The 8-column week table is replaced on phones by a
// day picker + that day's list (rendered only when useIsPhone()), so most of this
// styles markup that does not exist at >= 768px; the rest restacks the header and
// the week navigation, which keep their inline desktop styles.
const SHIFT_PHONE_CSS = `
@media (max-width: 767px) {
  .shift-screen button { min-height: 44px !important; }
  .shift-head { flex-direction: column !important; align-items: stretch !important; gap: 12px; margin-bottom: 16px !important; }
  .shift-stats > div { flex: 1 1 0; min-width: 0 !important; padding: 8px 4px !important; }
  .shift-nav { flex-wrap: wrap; padding: 8px !important; gap: 8px !important; margin-bottom: 12px !important; }
  .shift-nav > button { min-width: 44px; justify-content: center; }
  .shift-nav-label { flex: 1 1 calc(100% - 120px) !important; font-size: 14px !important; }
  .shift-nav-wide { flex: 1 1 0; font-size: 13px !important; }
  .shift-unassigned > div { flex-wrap: wrap; border-radius: var(--radius-lg) !important; }
  .shift-unassigned > div > div:first-child { font-size: 11px !important; }

  .shift-seg { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding: 4px; margin-bottom: 12px; background: var(--color-surface-2); border-radius: var(--radius-lg); }
  .shift-seg > button { border-radius: var(--radius-md); font-size: 14px; font-weight: 500; color: var(--color-text-secondary); }
  .shift-seg > button[aria-pressed='true'] { background: var(--color-surface); color: var(--color-text); font-weight: 700; box-shadow: var(--shadow-xs); }

  .shift-days { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; margin-bottom: 14px; }
  .shift-days > button { display: flex; flex-direction: column; align-items: center; gap: 1px; padding: 6px 0 5px; min-height: 64px !important; border-radius: var(--radius-md); border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-text-secondary); font-variant-numeric: tabular-nums; }
  .shift-days > button[data-today] { border-color: var(--color-accent); color: var(--color-accent-600); }
  .shift-days > button[aria-pressed='true'] { background: var(--color-primary); border-color: var(--color-primary); color: var(--color-text-inverse); }
  .shift-days-w { font-size: 12px; font-weight: 500; }
  .shift-days-d { font-size: 17px; font-weight: 700; line-height: 1.2; }
  .shift-days-n { font-size: 11px; font-weight: 500; opacity: 0.85; }

  .shift-day-title { margin: 0 0 8px; font-size: 15px; font-weight: 700; }
  .shift-day-sub { font-size: 13px; font-weight: 500; color: var(--color-text-secondary); }
  .shift-list { list-style: none; margin: 0; padding: 0; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); overflow: hidden; }
  .shift-list > li + li { border-top: 1px solid var(--color-border); }
  .shift-row { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 56px !important; padding: 8px 12px; text-align: left; color: var(--color-text); }
  button.shift-row:active { background: var(--color-surface-2); }
  .shift-avatar { width: 34px; height: 34px; border-radius: var(--radius-pill); flex-shrink: 0; display: grid; place-items: center; background: var(--color-accent-50); color: var(--color-primary); font-weight: 700; font-size: 14px; }
  .shift-row-main { flex: 1; min-width: 0; }
  .shift-row-name { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .shift-row-meta { font-size: 12px; color: var(--color-text-secondary); }
  .shift-time { flex-shrink: 0; padding: 6px 10px; border-radius: var(--radius-md); font-size: 14px; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .shift-time[data-empty] { border: 1px dashed var(--color-border-strong); color: var(--color-text-secondary); font-weight: 500; font-size: 13px; display: inline-flex; align-items: center; gap: 4px; }
  .shift-section { margin: 18px 0 8px; font-size: 13px; font-weight: 600; color: var(--color-text-secondary); }
  .shift-po-tag { flex-shrink: 0; padding: 3px 10px; border-radius: var(--radius-pill); font-size: 12px; font-weight: 600; white-space: nowrap; }
  .shift-note { margin-top: 10px; font-size: 12px; color: var(--color-text-secondary); }
}
`;
// Inputs in the portaled dialogs keep >= 16px via their own inline size (17px).

/** Small whole-number stat that counts up on mount (header KPI chips). */
function StatNum({ value, color }: { value: number; color: string }) {
  const ref = useCountUp(value);
  return (
    <span ref={ref} style={{ fontSize: 22, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
  );
}

const DAY_SHORT = ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'];
const DAY_FULL = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์'];

const PREORDER_STATUS_LABELS: Record<PreOrderStatus, string> = {
  PENDING: 'รอเริ่ม',
  IN_PROGRESS: 'กำลังทำ',
  COMPLETED: 'เสร็จแล้ว',
  CANCELLED: 'ยกเลิก',
};

const PREORDER_STATUS_COLORS: Record<PreOrderStatus, { fg: string; bg: string }> = {
  PENDING:     { fg: 'var(--color-warning-fg)',                     bg: 'var(--color-warning-50)' },
  IN_PROGRESS: { fg: 'var(--color-info)',           bg: 'var(--color-info-50)' },
  COMPLETED:   { fg: 'var(--color-success)',        bg: 'var(--color-success-50)' },
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

// Weekday (Monday = 0) and day-of-month read from the "YYYY-MM-DD" string itself, so
// the phone day picker labels each date with its real weekday in every timezone.
function dowOf(ds: string): number {
  return (new Date(`${ds}T00:00:00Z`).getUTCDay() + 6) % 7;
}
function domOf(ds: string): number {
  return Number(ds.slice(8, 10));
}

// Format "HH:MM:SS" → "HH:MM"
function fmtTime(t: string): string {
  return t.slice(0, 5);
}

// Derive a background colour from start hour so cells remain visually distinct.
// Tinted token backgrounds (-50 roles) + matching foregrounds so the grid stays
// readable and adapts in dark mode.
function shiftCellStyle(shift: ShiftAssignment | undefined): { bg: string; fg: string } {
  if (!shift) return { bg: 'transparent', fg: 'var(--color-text-muted)' };
  const h = parseInt(shift.start_time.slice(0, 2), 10);
  if (h < 10) return { bg: 'var(--color-warning-50)', fg: 'var(--color-warning-fg)' };          // early morning
  if (h < 14) return { bg: 'var(--color-info-50)',    fg: 'var(--color-info)' };    // midday
  return { bg: 'var(--color-accent-50)', fg: 'var(--color-accent-600)' };          // afternoon/evening
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
  // Phones: one day at a time (team) or my own week, instead of the week table.
  const isPhone = useIsPhone();
  const [phoneDay, setPhoneDay] = useState<string | null>(null);
  const [phoneView, setPhoneView] = useState<'team' | 'mine'>('team');

  const { data: staff, isLoading: staffLoading } = useStaffList();
  const { data: shifts, isLoading: shiftsLoading, refetch: refetchShifts } = useWeeklySchedule(weekStart);
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

  // Phone day picker: the tapped day while it is in the visible week, else today, else Monday.
  const weekStrs = weekDates.map(dateStr);
  const selDay = phoneDay && weekStrs.includes(phoneDay) ? phoneDay : weekStrs.includes(today) ? today : weekStrs[0];

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
      // useAssignShift invalidates by a week key it derives itself; east of UTC that key
      // differs from this screen's `weekStart`, so the saved shift would not appear
      // until a reload. Refetch the week on screen explicitly.
      void refetchShifts();
      toast({ kind: 'success', title: 'บันทึกกะแล้ว' });
    } catch (e: unknown) { toast({ kind: 'danger', title: String(e instanceof Error ? e.message : e) }); }
  };

  if (staffLoading || shiftsLoading) {
    return (
      <div className="screen-pad-lg shift-screen" style={{ height: '100%', overflowY: 'auto', padding: 'var(--space-8)' }} aria-busy="true">
        <style>{SHIFT_PHONE_CSS}</style>
        <span className="sr-only">กำลังโหลดตารางกะ…</span>
        <div className="shift-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-6)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <Skeleton height={26} width={260} radius="var(--radius-md)" style={{ maxWidth: '100%' }} />
            <Skeleton height={14} width={320} style={{ maxWidth: '100%' }} />
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} height={56} width={88} radius="var(--radius-lg)" />)}
          </div>
        </div>
        <Skeleton height={56} radius="var(--radius-lg)" style={{ marginBottom: 'var(--space-5)' }} />
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)' }}>
          <SkeletonTable rows={6} cols={8} />
        </div>
      </div>
    );
  }

  return (
    <div className="screen-pad-lg shift-screen" style={{ height: '100%', overflowY: 'auto', padding: 'var(--space-8)' }}>
      <style>{SHIFT_PHONE_CSS}</style>
      {/* Header */}
      <div className="shift-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-6)' }}>
        <div>
          <h1 className="text-balance" style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em', marginBottom: 'var(--space-1)' }}>ตารางกะ / Shift Schedule</h1>
          <div className="text-pretty" style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>จัดการกะพนักงานรายสัปดาห์ ระบุเวลาเริ่ม/สิ้นสุด</div>
        </div>
        <div className="shift-stats" style={{ display: 'flex', gap: 'var(--space-3)' }}>
          {[
            { label: 'มีกะวันนี้',    val: shiftsToday,       color: 'var(--color-success)',        bg: 'var(--color-success-50)' },
            { label: 'ไม่มีกะวันนี้', val: noShiftToday,      color: 'var(--color-text-muted)',     bg: 'var(--color-surface-2)' },
            { label: 'พรีออเดอร์',    val: weekPreOrderCount, color: 'var(--color-warning-fg)',                     bg: 'var(--color-warning-50)' },
          ].map(st => (
            <div key={st.label} style={{ background: st.bg, borderRadius: 'var(--radius-lg)', padding: '10px 16px', textAlign: 'center', minWidth: 80 }}>
              <StatNum value={st.val} color={st.color} />
              <div style={{ fontSize: 11, color: st.color, fontWeight: 500 }}>{st.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Week navigation */}
      <div className="shift-nav" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 10, padding: '10px 14px', boxShadow: 'var(--shadow-xs)' }}>
        <button onClick={prevWeek} aria-label="สัปดาห์ก่อนหน้า" className="hit-44 pressable" style={{ minHeight: 38, padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', background: 'var(--color-surface-2)', display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
          <Icon name="chevronRight" size={15} style={{ transform: 'rotate(180deg)' }} />
        </button>
        <div className="shift-nav-label" style={{ flex: 1, textAlign: 'center', fontWeight: 600, fontSize: 15 }}>
          {new Date(weekStart).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })} – {addDays(new Date(weekStart), 6).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })}
        </div>
        <button onClick={nextWeek} aria-label="สัปดาห์ถัดไป" className="hit-44 pressable" style={{ minHeight: 38, padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', background: 'var(--color-surface-2)', display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
          <Icon name="chevronRight" size={15} />
        </button>
        <button onClick={goToday} className="pressable shift-nav-wide" style={{ minHeight: 38, padding: '6px 14px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', background: 'var(--color-surface-2)', fontSize: 13, color: 'var(--color-text-secondary)', fontWeight: 500, cursor: 'pointer' }}>สัปดาห์นี้</button>
        <button onClick={() => setShowCancelled(v => !v)} aria-pressed={showCancelled} title="แสดง/ซ่อนพรีออเดอร์ที่ยกเลิก" className="shift-nav-wide" style={{ padding: '6px 12px', borderRadius: 7, border: '1px solid var(--color-border)', background: showCancelled ? 'var(--color-surface-2)' : 'transparent', fontSize: 12, color: 'var(--color-text-secondary)', fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, border: '1px solid var(--color-border-strong)', background: showCancelled ? 'var(--color-accent)' : 'transparent', display: 'inline-block', flexShrink: 0 }} />
          แสดงที่ยกเลิก
        </button>
      </div>

      {/* Phones: day picker + that day's shifts (or my own week) — same data and handlers as the table */}
      {isPhone && (() => {
        const timePill = (shift: ShiftAssignment | undefined, emptyLabel: React.ReactNode) => {
          const c = shiftCellStyle(shift);
          return shift
            ? <span className="shift-time" style={{ background: c.bg, color: c.fg }}>{fmtTime(shift.start_time)}–{fmtTime(shift.end_time)}</span>
            : <span className="shift-time" data-empty="">{emptyLabel}</span>;
        };
        const emptyLabel = admin ? <><Icon name="plus" size={13} /> ตั้งกะ</> : 'ไม่มีกะ';
        const dayStaff = [...staffList].sort((a, b) => {
          const sa = shiftMap[`${a.id}:${selDay}`]?.start_time ?? '99';
          const sb = shiftMap[`${b.id}:${selDay}`]?.start_time ?? '99';
          return sa.localeCompare(sb);
        });
        const onShift = dayStaff.filter(s => !!shiftMap[`${s.id}:${selDay}`]).length;
        const dayPreOrders = preOrdersByDate[selDay] ?? [];
        const mine = staffList.find(s => s.id === me?.id);
        const myShifts = mine ? weekStrs.map(ds => shiftMap[`${mine.id}:${ds}`]) : [];
        const myCount = myShifts.filter(Boolean).length;
        const myHours = myShifts.reduce((sum, sh) => {
          if (!sh) return sum;
          const mins = (t: string) => parseInt(t.slice(0, 2), 10) * 60 + parseInt(t.slice(3, 5), 10);
          return sum + Math.max(0, mins(sh.end_time) - mins(sh.start_time)) / 60;
        }, 0);
        return (
          <div>
            <div className="shift-seg" role="group" aria-label="มุมมองตารางกะ">
              <button type="button" aria-pressed={phoneView === 'team'} onClick={() => setPhoneView('team')}>ทั้งทีม</button>
              <button type="button" aria-pressed={phoneView === 'mine'} onClick={() => setPhoneView('mine')}>กะของฉัน</button>
            </div>

            {phoneView === 'team' ? (
              <>
                <div className="shift-days" role="group" aria-label="เลือกวัน">
                  {weekStrs.map(ds => {
                    const n = staffList.filter(s => !!shiftMap[`${s.id}:${ds}`]).length;
                    return (
                      <button key={ds} type="button" aria-pressed={ds === selDay} data-today={ds === today ? '' : undefined}
                        aria-label={`วัน${DAY_FULL[dowOf(ds)]}ที่ ${domOf(ds)} มีกะ ${n} คน`} onClick={() => setPhoneDay(ds)}>
                        <span className="shift-days-w">{DAY_SHORT[dowOf(ds)]}</span>
                        <span className="shift-days-d">{domOf(ds)}</span>
                        <span className="shift-days-n">{n} คน</span>
                      </button>
                    );
                  })}
                </div>

                <h2 className="shift-day-title">
                  วัน{DAY_FULL[dowOf(selDay)]}ที่ {fmtDateTh(selDay)}{selDay === today ? ' (วันนี้)' : ''}
                  <span className="shift-day-sub"> · มีกะ {onShift}/{staffList.length} คน</span>
                </h2>
                {staffList.length === 0 ? (
                  <div className="shift-note">ยังไม่มีพนักงาน</div>
                ) : (
                  <ul className="shift-list">
                    {dayStaff.map(member => {
                      const shift = shiftMap[`${member.id}:${selDay}`];
                      const body = (
                        <>
                          <span className="shift-avatar" aria-hidden="true">{member.name.charAt(0)}</span>
                          <span className="shift-row-main">
                            <span className="shift-row-name" style={{ display: 'block' }}>{member.name}</span>
                            <span className="shift-row-meta">{member.role}</span>
                          </span>
                          {timePill(shift, emptyLabel)}
                        </>
                      );
                      return (
                        <li key={member.id}>
                          {admin
                            ? <button type="button" className="shift-row" onClick={() => openEditor(member.id, selDay)}>{body}</button>
                            : <div className="shift-row">{body}</div>}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {admin && <div className="shift-note">แตะชื่อพนักงานเพื่อกำหนดเวลาเข้า–ออกงาน</div>}

                <h3 className="shift-section">พรีออเดอร์ที่ต้องส่ง ({dayPreOrders.length})</h3>
                {dayPreOrders.length === 0 ? (
                  <div className="shift-note" style={{ marginTop: 0 }}>ไม่มีพรีออเดอร์ในวันนี้</div>
                ) : (
                  <ul className="shift-list">
                    {dayPreOrders.map(po => {
                      const c = PREORDER_STATUS_COLORS[po.status];
                      return (
                        <li key={po.id}>
                          <button type="button" className="shift-row" onClick={() => setSelectedPreOrderId(po.id)}>
                            <span className="shift-row-main">
                              <span className="shift-row-name" style={{ display: 'block', textDecoration: po.status === 'CANCELLED' ? 'line-through' : 'none' }}>{preOrderLabel(po)}</span>
                              <span className="shift-row-meta">{po.itemCount > 0 ? `${po.itemCount} รายการ` : 'ยังไม่มีรายการ'}</span>
                            </span>
                            <span className="shift-po-tag" style={{ background: c.bg, color: c.fg }}>{PREORDER_STATUS_LABELS[po.status]}</span>
                            <Icon name="chevronRight" size={16} color="var(--color-text-muted)" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            ) : !mine ? (
              <div className="shift-note">ไม่พบชื่อของคุณในรายชื่อพนักงานของสาขานี้</div>
            ) : (
              <>
                <h2 className="shift-day-title">
                  {mine.name}
                  <span className="shift-day-sub"> · สัปดาห์นี้ {myCount} กะ{myCount > 0 ? ` · ${Number.isInteger(myHours) ? myHours : myHours.toFixed(1)} ชม.` : ''}</span>
                </h2>
                <ul className="shift-list">
                  {weekStrs.map((ds, i) => {
                    const shift = myShifts[i];
                    const body = (
                      <>
                        <span className="shift-row-main">
                          <span className="shift-row-name" style={{ display: 'block', color: ds === today ? 'var(--color-accent-600)' : undefined }}>
                            วัน{DAY_FULL[dowOf(ds)]}{ds === today ? ' (วันนี้)' : ''}
                          </span>
                          <span className="shift-row-meta">{fmtDateTh(ds)}</span>
                        </span>
                        {timePill(shift, emptyLabel)}
                      </>
                    );
                    return (
                      <li key={ds}>
                        {admin
                          ? <button type="button" className="shift-row" onClick={() => openEditor(mine.id, ds)}>{body}</button>
                          : <div className="shift-row">{body}</div>}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        );
      })()}

      {/* Grid */}
      {!isPhone && (
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}>
        <div style={{ overflowX: 'auto' }}>
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
                    <td key={ds} style={{ padding: 'var(--space-1)', textAlign: 'center', position: 'relative', borderLeft: '1px solid var(--color-border)', background: isToday ? 'var(--color-accent-50)' : 'transparent' }}>
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
                  <td key={ds} style={{ padding: 'var(--space-1)', verticalAlign: 'top', borderLeft: '1px solid var(--color-border)', background: isToday ? 'var(--color-accent-50)' : 'transparent' }}>
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
      </div>
      )}

      {/* Shift notes by day */}
      <div style={{ marginTop: 20, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 16, boxShadow: 'var(--shadow-xs)' }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: 'var(--color-text-secondary)' }}>พนักงานที่ยังไม่มีกะสัปดาห์นี้</div>
        <div className="shift-unassigned" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {staffList.map(s => {
            const unassigned = weekDates.filter(d => !shiftMap[`${s.id}:${dateStr(d)}`]);
            if (unassigned.length === 0) return null;
            return (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 12px', background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-pill)' }}>
                <div style={{ width: 22, height: 22, borderRadius: 'var(--radius-pill)', background: 'var(--color-accent-50)', color: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 10 }}>{s.name.charAt(0)}</div>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text)' }}>{s.name.split(' ')[0]}</span>
                <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>ไม่มีกะ {unassigned.map(d => { const day = d.getDay(); return DAY_SHORT[day === 0 ? 6 : day - 1]; }).join(', ')}</span>
              </div>
            );
          })}
          {staffList.length > 0 && staffList.every(s => weekDates.every(d => !!shiftMap[`${s.id}:${dateStr(d)}`])) && (
            <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>พนักงานทุกคนมีกะครบสัปดาห์นี้</div>
          )}
        </div>
      </div>

      {admin && <div className="hide-phone" style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 8 }}>คลิกที่ช่องเพื่อกำหนดเวลาเข้า-ออกงาน</div>}

      {editingCell && admin && (() => {
        const member = staffList.find(s => s.id === editingCell.userId);
        const d = new Date(editingCell.date);
        const dayIdx = (d.getDay() + 6) % 7;          // Monday = 0
        const timeInput: React.CSSProperties = { width: '100%', minHeight: 48, padding: '11px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-surface-2)', color: 'var(--color-text)', fontSize: 17, fontFamily: 'inherit', boxSizing: 'border-box' };
        return (
          <ModalShell
            title={member?.name ?? 'พนักงาน'}
            subtitle={`วัน${DAY_FULL[dayIdx]}ที่ ${fmtDateTh(editingCell.date)} · กำหนดเวลาเข้า–ออกงาน`}
            onClose={() => setEditingCell(null)}
            width={460}
            busy={assignShift.isPending}
            footer={<>
              <button onClick={() => setEditingCell(null)} className="pressable" style={{ minHeight: 44, padding: '10px 22px', borderRadius: 'var(--radius-md)', background: 'var(--color-surface-2)', color: 'var(--color-text)', border: '1px solid var(--color-border)', fontSize: 14, cursor: 'pointer' }}>ยกเลิก</button>
              <button onClick={() => handleAssign(editingCell.userId, editingCell.date)} disabled={assignShift.isPending} className="pressable" style={{ minHeight: 44, padding: '10px 28px', borderRadius: 'var(--radius-md)', background: 'var(--color-primary)', color: 'var(--color-text-inverse)', fontSize: 14, fontWeight: 600, cursor: 'pointer', border: 'none' }}>
                {assignShift.isPending ? 'กำลังบันทึก…' : 'บันทึก'}
              </button>
            </>}
          >
            <div className="form-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label htmlFor="shift-edit-start" style={{ display: 'block', fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 6 }}>เวลาเริ่ม</label>
                <input id="shift-edit-start" type="time" value={editStart} onChange={e => setEditStart(e.target.value)} style={timeInput} />
              </div>
              <div>
                <label htmlFor="shift-edit-end" style={{ display: 'block', fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 6 }}>เวลาสิ้นสุด</label>
                <input id="shift-edit-end" type="time" value={editEnd} onChange={e => setEditEnd(e.target.value)} style={timeInput} />
              </div>
            </div>
          </ModalShell>
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
  const ready = !isLoading && !!po;

  return (
    <ModalShell
      title={ready ? preOrderLabel(po) : 'รายละเอียดพรีออเดอร์'}
      subtitle={ready && po.customerPhone ? <span style={{ fontFamily: 'var(--font-num)' }}>{po.customerPhone}</span> : undefined}
      onClose={onClose}
      width={560}
      footer={<button onClick={onClose} className="pressable" style={{ minHeight: 44, padding: '10px 22px', borderRadius: 'var(--radius-md)', background: 'var(--color-surface-2)', color: 'var(--color-text)', border: '1px solid var(--color-border)', fontSize: 14, cursor: 'pointer' }}>ปิด</button>}
    >
        {isLoading || !po ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }} aria-busy="true">
            <span className="sr-only">กำลังโหลดรายละเอียดพรีออเดอร์…</span>
            <Skeleton height={20} width="50%" radius="var(--radius-md)" />
            <Skeleton height={14} width="35%" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={32} radius="var(--radius-sm)" />)}
            </div>
            <SkeletonTable rows={3} cols={4} />
          </div>
        ) : (
          <div>
            <div style={{ marginBottom: 14 }}>
              <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', color: PREORDER_STATUS_COLORS[po.status].fg, background: PREORDER_STATUS_COLORS[po.status].bg }}>
                {PREORDER_STATUS_LABELS[po.status]}
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 12, marginBottom: 18 }}>
              {[
                { label: 'วันที่สั่ง', value: fmtDateTh(po.orderDate), wide: false },
                { label: 'วันส่งของ', value: fmtDateTh(po.dueDate), wide: false },
                { label: 'มัดจำ', value: po.depositAmount ? `${fmtMoney(po.depositAmount)}${po.depositPaid ? ' (ชำระแล้ว)' : ' (ยังไม่ชำระ)'}` : '—', wide: true },
                { label: 'หมายเหตุ', value: po.notes || '—', wide: true },
              ].map(m => (
                <div key={m.label} style={{ gridColumn: m.wide ? '1 / -1' : undefined }}>
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 2 }}>{m.label}</div>
                  <div style={{ fontSize: 14, fontWeight: 500, overflowWrap: 'anywhere' }}>{m.value}</div>
                </div>
              ))}
            </div>

            <div style={{ border: '1px solid var(--color-border)', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'var(--color-surface-2)' }}>
                    <th style={thStyle}>รายการ</th>
                    <th style={{ ...thStyle, textAlign: 'center', width: 50 }}>จำนวน</th>
                    <th className="hide-phone" style={{ ...thStyle, textAlign: 'right', width: 90 }}>ราคา</th>
                    <th style={{ ...thStyle, textAlign: 'right', width: 100 }}>รวม</th>
                  </tr>
                </thead>
                <tbody>
                  {po.items.map(it => (
                    <tr key={it.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                      <td style={{ padding: '8px 12px' }}>{it.productName}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'center', fontFamily: 'var(--font-num)' }}>{it.quantity}</td>
                      <td className="hide-phone" style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-num)' }}>{fmtMoney(it.unitPrice)}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-num)', fontWeight: 600 }}>{fmtMoney(it.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: '2px solid var(--color-border)', background: 'var(--color-surface-2)' }}>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>รวมทั้งหมด</td>
                    <td />
                    <td className="hide-phone" />
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, fontFamily: 'var(--font-num)', whiteSpace: 'nowrap' }}>
                      {fmtMoney(String(po.items.reduce((s, it) => s + Number(it.lineTotal), 0)))}
                    </td>
                  </tr>
                </tfoot>
              </table>
              </div>
            </div>
          </div>
        )}
    </ModalShell>
  );
}
