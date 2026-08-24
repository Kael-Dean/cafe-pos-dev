'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../icons';
import { Select, useToast, NumberInput } from '../app-common';
import { useModalA11y } from '@/hooks/use-modal-a11y';
import { useLookupMember } from '@/hooks/use-membership';
import { useRatePlans, type RatePlan } from '@/hooks/use-rate-plans';
import { useFloorTables, type FloorTable } from '@/hooks/use-floor';
import {
  useBillingPreview, useMoveTableSession, useOpenTableSession, useTableSessions,
  useUpdateTableSession, useVoidTableSession, type RateSnapshot, type TableSession,
} from '@/hooks/use-table-sessions';
import { bahtStr, clockTime, formatMinutes, minutesSince } from '@/lib/money';

// ── Shared modal shell ────────────────────────────────────────────────────────
/**
 * Portalled to <body> on purpose: the screen root carries a transform from the
 * entrance animation, and a transformed ancestor becomes the containing block for
 * `position: fixed`, which would trap the backdrop inside the screen.
 */
function ModalShell({ title, subtitle, icon, onClose, children, footer, busy }: {
  title: string;
  subtitle?: string;
  icon: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  busy?: boolean;
}) {
  const dialogRef = useModalA11y(onClose);
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-busy={busy || undefined}
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(520px, 94vw)', maxHeight: '90dvh', display: 'flex', flexDirection: 'column' }}
      >
        <div style={{
          padding: 'var(--space-5) var(--space-6)', borderBottom: '1px solid var(--color-border)',
          display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: 'var(--radius-md)', background: 'var(--color-surface-2)',
            color: 'var(--color-primary)', display: 'grid', placeItems: 'center',
          }}>
            <Icon name={icon} size={20} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{title}</div>
            {subtitle && <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{subtitle}</div>}
          </div>
          <button onClick={onClose} aria-label="ปิด" className="icon-btn hit-44" style={{
            width: 32, height: 32, borderRadius: 'var(--radius-md)', display: 'grid', placeItems: 'center',
            color: 'var(--color-text-secondary)',
          }}>
            <Icon name="x" size={18} />
          </button>
        </div>

        <div className="scroll" style={{ padding: 'var(--space-6)', overflow: 'auto', flex: 1 }}>
          {children}
        </div>

        {footer && (
          <div style={{
            borderTop: '1px solid var(--color-border)', padding: 'var(--space-4) var(--space-6)',
            display: 'flex', gap: 'var(--space-2)',
          }}>
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 'var(--space-5)' }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 'var(--space-2)' }}>{label}</div>
      {children}
      {hint && <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 'var(--space-2)', lineHeight: 1.5 }}>{hint}</div>}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', minHeight: 44, padding: '10px 12px', borderRadius: 'var(--radius-md)',
  border: '1px solid var(--color-border)', background: 'var(--color-surface-2)',
  color: 'var(--color-text)', fontSize: 15, boxSizing: 'border-box',
};

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Rate plan / snapshot summary — config, not a computed bill. */
function planSummary(p: Pick<RateSnapshot, 'billingMode' | 'hourlyRate' | 'graceMinutes' | 'roundingIncrementMinutes' | 'minChargeMinutes' | 'dailyCapAmount'>): string {
  const per = p.billingMode === 'PER_HEAD_HOUR' ? '/ชม./คน' : '/ชม./โต๊ะ';
  const bits = [`${bahtStr(p.hourlyRate)}${per}`];
  if (p.graceMinutes > 0) bits.push(`ผ่อนผัน ${p.graceMinutes} น.`);
  bits.push(`ปัดขึ้นทีละ ${p.roundingIncrementMinutes} น.`);
  if (p.minChargeMinutes > 0) bits.push(`ขั้นต่ำ ${formatMinutes(p.minChargeMinutes)}`);
  if (p.dailyCapAmount) bits.push(`เพดาน ${bahtStr(p.dailyCapAmount)}`);
  return bits.join(' · ');
}

// ── Customer lookup by phone (shared by both modals) ──────────────────────────
function CustomerPicker({ customerName, onPick, onClear }: {
  customerName: string | null;
  onPick: (customerId: string, name: string) => void;
  onClear: () => void;
}) {
  const lookup = useLookupMember();
  const [phone, setPhone] = useState('');
  const [notFound, setNotFound] = useState(false);

  const search = async () => {
    const digits = phone.trim();
    if (!digits) return;
    setNotFound(false);
    try {
      const res = await lookup.mutateAsync(digits);
      if (res.found && res.account) {
        onPick(res.account.customer_id, res.account.customer_name);
        setPhone('');
      } else {
        setNotFound(true);
      }
    } catch {
      setNotFound(true);
    }
  };

  if (customerName) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <span style={{ flex: 1, fontSize: 14 }}><Icon name="user" size={14} style={{ marginRight: 6 }} />{customerName}</span>
        <button onClick={onClear} className="btn btn-ghost" style={{ minHeight: 40 }}>เอาออก</button>
      </div>
    );
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <input
          value={phone}
          onChange={(e) => { setPhone(e.target.value); setNotFound(false); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void search(); } }}
          inputMode="tel"
          placeholder="เบอร์โทรสมาชิก"
          aria-label="เบอร์โทรสมาชิก"
          style={{ ...inputStyle, flex: 1 }}
        />
        <button onClick={() => { void search(); }} disabled={lookup.isPending || !phone.trim()} className="btn" style={{ minHeight: 44 }}>
          {lookup.isPending ? <span className="spinner" style={{ width: 16, height: 16 }} aria-hidden /> : <Icon name="search" size={16} />}
        </button>
      </div>
      {notFound && <div role="status" style={{ fontSize: 12, color: 'var(--color-warning)', marginTop: 'var(--space-2)' }}>ไม่พบสมาชิกเบอร์นี้ — เปิดโต๊ะได้โดยไม่ต้องผูกลูกค้า</div>}
    </>
  );
}

// ── Open a session ────────────────────────────────────────────────────────────
export default function OpenSessionModal({ table, onClose, onGoSetup }: {
  table: FloorTable;
  onClose: () => void;
  onGoSetup?: () => void;
}) {
  const toast = useToast();
  const plansQ = useRatePlans();
  const openSession = useOpenTableSession();

  const [partySize, setPartySize] = useState(2);
  const [planId, setPlanId] = useState<string>('');
  const [note, setNote] = useState('');
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const plans = useMemo(() => plansQ.data ?? [], [plansQ.data]);
  const defaultPlan: RatePlan | undefined = plans.find((p) => p.isDefault) ?? plans[0];

  // Empty state = "not chosen yet", which resolves to the store's default plan
  // once the list loads. Deriving it (instead of syncing state in an effect) keeps
  // the pre-load render correct without a cascading re-render.
  const effectivePlanId = planId || defaultPlan?.id || '';
  const selectedPlan = plans.find((p) => p.id === effectivePlanId) ?? defaultPlan;
  const noPlans = !plansQ.isLoading && plans.length === 0;

  const submit = async () => {
    if (openSession.isPending) return;
    setError(null);
    try {
      await openSession.mutateAsync({
        table_id: table.id,
        party_size: partySize,
        rate_plan_id: effectivePlanId || null,
        customer_id: customer?.id ?? null,
        note: note.trim() || null,
      });
      toast({ kind: 'success', title: `เปิดโต๊ะ ${table.name} แล้ว`, msg: `${partySize} คน` });
      onClose();
    } catch (e: unknown) {
      // 409 = table already has an open session, 422 = store has no rate plan.
      setError(errMsg(e));
    }
  };

  return (
    <ModalShell
      title={`เปิดโต๊ะ ${table.name}`}
      subtitle={`${table.zone?.trim() || 'ไม่ระบุโซน'} · ${table.capacity} ที่นั่ง`}
      icon="park"
      onClose={onClose}
      busy={openSession.isPending}
      footer={
        <>
          <button onClick={onClose} className="btn btn-ghost btn-lg" style={{ flex: 1, minHeight: 44 }}>ยกเลิก</button>
          <button
            onClick={() => { void submit(); }}
            disabled={openSession.isPending || noPlans || partySize < 1}
            className="btn btn-lg"
            style={{ flex: 2, minHeight: 44, opacity: openSession.isPending || noPlans ? 0.5 : 1 }}
          >
            {openSession.isPending
              ? <span className="spinner" style={{ width: 16, height: 16 }} aria-hidden />
              : <><Icon name="clock" size={16} /> เริ่มจับเวลา</>}
          </button>
        </>
      }
    >
      {noPlans && (
        <div role="alert" style={{
          display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)', marginBottom: 'var(--space-5)',
          padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-md)',
          background: 'var(--color-warning-50, var(--color-surface-2))', color: 'var(--color-warning)', fontSize: 13, lineHeight: 1.5,
        }}>
          <Icon name="warning" size={18} />
          <div style={{ flex: 1 }}>
            ร้านนี้ยังไม่มีแพ็กเกจเวลา — ต้องสร้างก่อนถึงจะเปิดโต๊ะได้
            {onGoSetup && <div><button onClick={onGoSetup} className="btn btn-ghost" style={{ marginTop: 'var(--space-2)', minHeight: 40 }}>ไปตั้งค่าโต๊ะ</button></div>}
          </div>
        </div>
      )}

      <Field label="จำนวนคน" hint="ใช้คิดค่าเวลาแบบต่อหัว และมีผลกับทั้งช่วงเวลาที่นั่ง">
        <NumberInput value={partySize} onChange={setPartySize} min={1} max={100} integer style={inputStyle} aria-label="จำนวนคน" />
      </Field>

      <Field
        label="แพ็กเกจเวลา"
        hint={selectedPlan ? planSummary(selectedPlan) : undefined}
      >
        <Select
          value={effectivePlanId}
          onChange={setPlanId}
          ariaLabel="แพ็กเกจเวลา"
          placeholder={plansQ.isLoading ? 'กำลังโหลด…' : '— เลือก —'}
          disabled={noPlans}
          options={plans.map((p) => ({ value: p.id, label: p.isDefault ? `${p.name} (ค่าเริ่มต้น)` : p.name }))}
        />
      </Field>

      <Field label="ลูกค้า (ไม่บังคับ)">
        <CustomerPicker
          customerName={customer?.name ?? null}
          onPick={(id, name) => setCustomer({ id, name })}
          onClear={() => setCustomer(null)}
        />
      </Field>

      <Field label="โน้ต (ไม่บังคับ)">
        <textarea
          className="input-std"
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
          placeholder="เช่น กลุ่มวันเกิด"
          style={{ width: '100%', minHeight: 72, boxSizing: 'border-box', resize: 'vertical' }}
        />
      </Field>

      {error && (
        <div role="alert" style={{
          padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-md)',
          background: 'var(--color-danger-50)', color: 'var(--color-danger)', fontSize: 13, fontWeight: 600,
        }}>
          {error}
        </div>
      )}
    </ModalShell>
  );
}

// ── Session detail ────────────────────────────────────────────────────────────
export function SessionDetailModal({ session, table, tables, canVoid, onClose, onOrder, onSettle }: {
  session: TableSession;
  table: FloorTable | null;
  tables: FloorTable[];
  canVoid: boolean;
  onClose: () => void;
  onOrder?: () => void;
  onSettle: () => void;
}) {
  const toast = useToast();
  const preview = useBillingPreview(session.id, true);
  const update = useUpdateTableSession();
  const move = useMoveTableSession();
  const voidSession = useVoidTableSession();
  const openSessions = useTableSessions('OPEN');
  const tablesQ = useFloorTables(false);

  const [partySize, setPartySize] = useState(session.partySize);
  const [note, setNote] = useState(session.note ?? '');
  const [moveTo, setMoveTo] = useState('');
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const allTables = tables.length ? tables : (tablesQ.data ?? []);
  const occupied = new Set((openSessions.data ?? []).map((s) => s.tableId));
  const freeTables = allTables.filter((t) => t.id !== session.tableId && !occupied.has(t.id));

  const elapsed = minutesSince(session.openedAt, now);
  const overtime = elapsed > session.rateSnapshot.maxOpenMinutes;
  const dirty = partySize !== session.partySize || note.trim() !== (session.note ?? '');
  const shrinking = partySize < session.partySize;
  const busy = update.isPending || move.isPending || voidSession.isPending;

  const saveEdits = async () => {
    if (busy || !dirty) return;
    setError(null);
    try {
      await update.mutateAsync({
        id: session.id,
        data: { party_size: partySize, note: note.trim() || null },
      });
      toast({ kind: 'success', title: 'บันทึกแล้ว' });
    } catch (e: unknown) { setError(errMsg(e)); }
  };

  const doMove = async () => {
    if (busy || !moveTo) return;
    setError(null);
    try {
      const moved = await move.mutateAsync({ id: session.id, tableId: moveTo });
      const name = allTables.find((t) => t.id === moved.tableId)?.name ?? '';
      toast({ kind: 'success', title: `ย้ายไปโต๊ะ ${name} แล้ว`, msg: 'นาฬิกาเดินต่อ ไม่รีเซ็ต' });
      setMoveTo('');
    } catch (e: unknown) { setError(errMsg(e)); }
  };

  const doVoid = async () => {
    if (busy) return;
    setError(null);
    try {
      await voidSession.mutateAsync(session.id);
      toast({ kind: 'success', title: 'ยกเลิกโต๊ะแล้ว', msg: 'ไม่มีการคิดเงิน' });
      onClose();
    } catch (e: unknown) {
      // 409 = orders are still attached; they must be paid or voided first.
      setError(errMsg(e));
      setConfirmVoid(false);
    }
  };

  const attachCustomer = async (customerId: string | null) => {
    setError(null);
    try {
      await update.mutateAsync({ id: session.id, data: { customer_id: customerId } });
    } catch (e: unknown) { setError(errMsg(e)); }
  };

  return (
    <ModalShell
      title={`โต๊ะ ${table?.name ?? ''}`}
      subtitle={`เปิด ${clockTime(session.openedAt)} · ${session.rateSnapshot.name}`}
      icon="clock"
      onClose={onClose}
      busy={busy}
      footer={
        <>
          {onOrder && (
            <button onClick={onOrder} className="btn btn-ghost btn-lg" style={{ flex: 1, minHeight: 44 }}>
              <Icon name="cart" size={16} /> สั่งอาหาร
            </button>
          )}
          <button onClick={onSettle} className="btn btn-lg" style={{ flex: 1.4, minHeight: 44 }}>
            <Icon name="cash" size={16} /> ปิดโต๊ะ / เช็คบิล
          </button>
        </>
      }
    >
      {/* Running total — server-computed, never recalculated here */}
      <div style={{
        padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)', background: 'var(--color-surface-2)',
        marginBottom: 'var(--space-5)',
      }}>
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>ค่าเวลาถึงตอนนี้</div>
        <div className="num" style={{ fontSize: 30, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
          {preview.isLoading || !preview.data ? '—' : bahtStr(preview.data.amount)}
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 4 }}>
          นั่งแล้ว {formatMinutes(elapsed)}
          {preview.data && ` · คิด ${formatMinutes(preview.data.billableMinutes)} (เล่นจริง ${formatMinutes(preview.data.rawMinutes)})`}
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginTop: 'var(--space-3)' }}>
          {preview.data?.withinGrace && <Badge tone="info">อยู่ในช่วงผ่อนผัน — ยังไม่คิดเงิน</Badge>}
          {preview.data?.capApplied && <Badge tone="success">ถึงเพดานต่อวันแล้ว</Badge>}
          {overtime && <Badge tone="warning">เกิน {formatMinutes(session.rateSnapshot.maxOpenMinutes)} ที่ตั้งไว้</Badge>}
        </div>
        <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 'var(--space-3)', lineHeight: 1.5 }}>
          {planSummary(session.rateSnapshot)}
        </div>
      </div>

      <Field
        label="จำนวนคน"
        hint={shrinking ? '⚠️ ลดจำนวนคนจะมีผลกับเวลาทั้งหมดของโต๊ะนี้ ไม่ใช่เฉพาะช่วงหลังจากนี้' : 'มีผลกับเวลาทั้งหมดของโต๊ะนี้ (ไม่มีการเฉลี่ยตามช่วง)'}
      >
        <NumberInput value={partySize} onChange={setPartySize} min={1} max={100} integer style={inputStyle} aria-label="จำนวนคน" />
      </Field>

      <Field label="โน้ต">
        <textarea
          className="input-std"
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
          style={{ width: '100%', minHeight: 64, boxSizing: 'border-box', resize: 'vertical' }}
        />
      </Field>

      {dirty && (
        <button onClick={() => { void saveEdits(); }} disabled={busy} className="btn btn-lg" style={{ width: '100%', minHeight: 44, marginBottom: 'var(--space-5)' }}>
          {update.isPending ? <span className="spinner" style={{ width: 16, height: 16 }} aria-hidden /> : <><Icon name="check" size={16} /> บันทึกการแก้ไข</>}
        </button>
      )}

      <Field label="ลูกค้า">
        <CustomerPicker
          customerName={session.customerId ? 'ผูกลูกค้าไว้แล้ว' : null}
          onPick={(id) => { void attachCustomer(id); }}
          onClear={() => { void attachCustomer(null); }}
        />
      </Field>

      <Field label="ย้ายโต๊ะ" hint="นาฬิกาเดินต่อ ไม่เริ่มนับใหม่">
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <Select
            value={moveTo}
            onChange={setMoveTo}
            ariaLabel="ย้ายไปโต๊ะ"
            placeholder={freeTables.length ? '— เลือกโต๊ะว่าง —' : 'ไม่มีโต๊ะว่าง'}
            disabled={!freeTables.length}
            style={{ flex: 1 }}
            options={freeTables.map((t) => ({ value: t.id, label: `${t.name}${t.zone ? ` · ${t.zone}` : ''}` }))}
          />
          <button onClick={() => { void doMove(); }} disabled={busy || !moveTo} className="btn" style={{ minHeight: 44 }}>ย้าย</button>
        </div>
      </Field>

      {canVoid && (
        <Field label="ยกเลิกโต๊ะ" hint="ใช้เมื่อเปิดผิด — ไม่คิดเงิน และทำได้เฉพาะเมื่อยังไม่มีบิลค้างในโต๊ะ">
          {confirmVoid ? (
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <button onClick={() => setConfirmVoid(false)} className="btn btn-ghost" style={{ flex: 1, minHeight: 44 }}>ไม่ยกเลิก</button>
              <button
                onClick={() => { void doVoid(); }}
                disabled={busy}
                className="btn"
                style={{ flex: 1, minHeight: 44, background: 'var(--color-danger-strong)', borderColor: 'var(--color-danger-strong)', color: 'white' }}
              >
                {voidSession.isPending ? <span className="spinner" style={{ width: 16, height: 16 }} aria-hidden /> : 'ยืนยันยกเลิก'}
              </button>
            </div>
          ) : (
            <button onClick={() => setConfirmVoid(true)} className="btn btn-ghost" style={{ width: '100%', minHeight: 44, color: 'var(--color-danger)' }}>
              <Icon name="void" size={16} /> ยกเลิกโต๊ะนี้ (ไม่คิดเงิน)
            </button>
          )}
        </Field>
      )}

      {error && (
        <div role="alert" style={{
          padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-md)',
          background: 'var(--color-danger-50)', color: 'var(--color-danger)', fontSize: 13, fontWeight: 600,
        }}>
          {error}
        </div>
      )}
    </ModalShell>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone: 'info' | 'success' | 'warning' }) {
  const color = tone === 'warning' ? 'var(--color-warning)' : tone === 'success' ? 'var(--color-success)' : 'var(--color-info)';
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 999, border: `1px solid ${color}`, color }}>
      {children}
    </span>
  );
}

export { ModalShell, Field, inputStyle, errMsg, planSummary };
