'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../icons';
import { useToast } from '../ui/toast';
import { useModalA11y } from '@/hooks/use-modal-a11y';
import { useLookupMember } from '@/hooks/use-membership';
import { useRatePlans, type RatePlan } from '@/hooks/use-rate-plans';
import { useFloorTables, type FloorTable } from '@/hooks/use-floor';
import {
  useBillingPreview, useMoveTableSession, useOpenTableSession, useTableSessions,
  useUpdateTableSession, useVoidTableSession, type RateSnapshot, type TableSession,
} from '@/hooks/use-table-sessions';
import { useOnlineStatus } from '@/components/pwa/offline-indicator';
import { bahtStr, clockTime, formatMinutes, minutesSince } from '@/lib/money';
import { useI18n } from '@/lib/i18n';
import {
  Badge, Banner, Button, Field as UiField, IconButton, Input, Modal, NumberField, Select, fieldIds,
} from '@/components/ui';
import { useOverlayHistory } from '../use-overlay-history';
import s from './floor.module.css';

// ── Legacy shell (still used by settle-modal.tsx and table-setup.tsx) ─────────
// The open / detail dialogs below are on the design-system <Modal>. This shell and
// its helpers stay exported unchanged until those screens move over too.
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
        className="modal-card tsm-card"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(520px, 94vw)', maxHeight: '90dvh', display: 'flex', flexDirection: 'column' }}
      >
        <style>{TSM_PHONE_CSS}</style>
        <div className="tsm-head" style={{
          padding: 'var(--space-5) var(--space-6)', borderBottom: '1px solid var(--color-border)',
          display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexShrink: 0,
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

        <div className="scroll pad-phone" style={{ padding: 'var(--space-6)', overflow: 'auto', flex: 1, minHeight: 0 }}>
          {children}
        </div>

        {footer && (
          <div className="tsm-foot" style={{
            borderTop: '1px solid var(--color-border)', padding: 'var(--space-4) var(--space-6)',
            display: 'flex', gap: 'var(--space-2)', flexShrink: 0,
          }}>
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Phones (< 768px), for every dialog built on this shell (settle + table / rate-plan
 * editors): 16px gutters, inputs at 16px so iOS does not zoom on focus, and a footer
 * whose buttons wrap onto their own rows when the labels do not fit side by side.
 */
const TSM_PHONE_CSS = `
@media (max-width: 767px) {
  .tsm-head { padding: 12px 12px 12px 16px !important; }
  .tsm-card input, .tsm-card textarea { font-size: 16px !important; }
  .tsm-foot { flex-wrap: wrap; padding: 12px 16px !important; }
  .tsm-foot > * { flex: 1 1 auto !important; min-width: 0; padding-left: 12px; padding-right: 12px; }
}
`;

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

// ── Textarea on the shared field chrome (there is no Textarea primitive yet) ──
function NoteField({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  const ids = fieldIds(useId());
  return (
    <UiField ids={ids} label={label}>
      <textarea
        id={ids.controlId}
        className={s.textarea}
        value={value}
        maxLength={500}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </UiField>
  );
}

// ── Customer lookup by phone (shared by both dialogs) ─────────────────────────
function CustomerPicker({ label, customerName, onPick, onClear }: {
  label: string;
  customerName: string | null;
  onPick: (customerId: string, name: string) => void;
  onClear: () => void;
}) {
  const { t } = useI18n();
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
      <div>
        <div className="ui-field__label">{label}</div>
        <div className={s.picked}>
          <span><Icon name="user" size={16} />{customerName}</span>
          <Button variant="ghost" onClick={onClear}>{t.floor.removeCustomer}</Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className={s.row}>
        <Input
          className={s.grow}
          label={label}
          value={phone}
          onChange={(e) => { setPhone(e.target.value); setNotFound(false); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void search(); } }}
          inputMode="tel"
          autoComplete="off"
          placeholder={t.floor.memberPhone}
        />
        <IconButton
          variant="outline"
          icon={<Icon name="search" size={18} />}
          label={t.floor.findMember}
          loading={lookup.isPending}
          disabled={!phone.trim()}
          onClick={() => { void search(); }}
        />
      </div>
      <p role="status" className={s.notFound}>{notFound ? t.floor.memberNotFound : ''}</p>
    </div>
  );
}

// ── Open a session ────────────────────────────────────────────────────────────
export default function OpenSessionModal({ open, table, onClose, onGoSetup, onOpened, canOrder }: {
  open: boolean;
  table: FloorTable;
  onClose: () => void;
  onGoSetup?: () => void;
  /** The session is open. `andOrder` = the cashier chose "open and order". */
  onOpened: (session: TableSession, andOrder: boolean) => void;
  /** Whether "open and order" is offered (POS hand-off available). */
  canOrder: boolean;
}) {
  const { t } = useI18n();
  const online = useOnlineStatus();
  const plansQ = useRatePlans();
  const openSession = useOpenTableSession();

  const [partySize, setPartySize] = useState(2);
  const [planId, setPlanId] = useState<string>('');
  const [note, setNote] = useState('');
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<'order' | 'only' | null>(null);

  const plans = useMemo(() => plansQ.data ?? [], [plansQ.data]);
  const defaultPlan: RatePlan | undefined = plans.find((p) => p.isDefault) ?? plans[0];

  // Empty state = "not chosen yet", which resolves to the store's default plan
  // once the list loads. Deriving it (instead of syncing state in an effect) keeps
  // the pre-load render correct without a cascading re-render.
  const effectivePlanId = planId || defaultPlan?.id || '';
  const selectedPlan = plans.find((p) => p.id === effectivePlanId) ?? defaultPlan;
  const noPlans = !plansQ.isLoading && plans.length === 0;
  const blockedReason = !online ? t.floor.offlineDisabled : noPlans ? t.floor.noPlans : undefined;

  const submit = async (andOrder: boolean) => {
    if (openSession.isPending || blockedReason || partySize < 1) return;
    setError(null);
    setSubmitting(andOrder ? 'order' : 'only');
    try {
      const session = await openSession.mutateAsync({
        table_id: table.id,
        party_size: partySize,
        rate_plan_id: effectivePlanId || null,
        customer_id: customer?.id ?? null,
        note: note.trim() || null,
      });
      // No toast: the card turning busy (or POS table mode) is the feedback.
      onOpened(session, andOrder);
    } catch (e: unknown) {
      // 409 = table already has an open session, 422 = store has no rate plan.
      setError(errMsg(e));
    } finally {
      setSubmitting(null);
    }
  };

  const busy = openSession.isPending;
  useOverlayHistory(open, onClose, !busy);
  const primaryIsOrder = canOrder;

  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissible={!busy}
      size="md"
      divided
      title={t.floor.openTitle(table.name)}
      description={t.floor.openSubtitle(table.zone?.trim() || t.floor.zoneFallback, table.capacity)}
      footer={
        <>
          {primaryIsOrder && (
            <Button
              variant="secondary"
              size="lg"
              loading={submitting === 'only'}
              disabled={busy || !!blockedReason}
              disabledReason={blockedReason}
              onClick={() => { void submit(false); }}
            >
              {t.floor.openOnly}
            </Button>
          )}
          <Button
            size="lg"
            icon={<Icon name={primaryIsOrder ? 'cart' : 'clock'} size={18} />}
            loading={submitting === (primaryIsOrder ? 'order' : 'only')}
            disabled={busy || !!blockedReason}
            disabledReason={blockedReason}
            onClick={() => { void submit(primaryIsOrder); }}
          >
            {primaryIsOrder ? t.floor.openAndOrder : t.floor.openOnly}
          </Button>
        </>
      }
    >
      <div className={s.form}>
        {noPlans && (
          <Banner
            tone="warning"
            icon="warning"
            live="alert"
            title={t.floor.noPlans}
            action={onGoSetup ? <Button size="sm" variant="secondary" onClick={onGoSetup}>{t.floor.goSetup}</Button> : undefined}
          />
        )}

        <NumberField
          label={t.floor.partySize}
          hint={t.floor.partySizeHint}
          value={partySize}
          onChange={setPartySize}
          min={1}
          max={100}
          integer
          size="lg"
        />

        <Select
          label={t.floor.ratePlan}
          hint={selectedPlan ? planSummary(selectedPlan) : undefined}
          value={effectivePlanId}
          onChange={setPlanId}
          placeholder={plansQ.isLoading ? t.floor.planLoading : t.floor.planPlaceholder}
          disabled={noPlans || plansQ.isLoading}
          options={plans.map((p) => ({ value: p.id, label: p.isDefault ? t.floor.planDefault(p.name) : p.name }))}
        />

        <CustomerPicker
          label={t.floor.customerOptional}
          customerName={customer?.name ?? null}
          onPick={(id, name) => setCustomer({ id, name })}
          onClear={() => setCustomer(null)}
        />

        <NoteField label={t.floor.noteOptional} value={note} onChange={setNote} placeholder={t.floor.notePlaceholder} />

        {error && <Banner tone="danger" icon="warning" live="alert" title={error} />}
      </div>
    </Modal>
  );
}

// ── Session detail ────────────────────────────────────────────────────────────
export function SessionDetailModal({ open, session, table, tables, canVoid, onClose, onOrder, onSettle }: {
  open: boolean;
  session: TableSession;
  table: FloorTable | null;
  tables: FloorTable[];
  canVoid: boolean;
  onClose: () => void;
  onOrder?: () => void;
  onSettle: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const online = useOnlineStatus();
  const preview = useBillingPreview(session.id, open);
  const update = useUpdateTableSession();
  const move = useMoveTableSession();
  const voidSession = useVoidTableSession();
  const openSessions = useTableSessions('OPEN', open);
  const tablesQ = useFloorTables(false, open && tables.length === 0);

  // Edits are local until saved; re-seed them whenever another session is shown.
  const [seededFor, setSeededFor] = useState(session.id);
  const [partySize, setPartySize] = useState(session.partySize);
  const [note, setNote] = useState(session.note ?? '');
  const [moveTo, setMoveTo] = useState('');
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (seededFor !== session.id) {
    setSeededFor(session.id);
    setPartySize(session.partySize);
    setNote(session.note ?? '');
    setMoveTo('');
    setConfirmVoid(false);
    setError(null);
  }

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, [open]);

  const allTables = tables.length ? tables : (tablesQ.data ?? []);
  const occupied = new Set((openSessions.data ?? []).map((x) => x.tableId));
  const freeTables = allTables.filter((tb) => tb.id !== session.tableId && !occupied.has(tb.id));

  const elapsed = minutesSince(session.openedAt, now);
  const overtime = elapsed > session.rateSnapshot.maxOpenMinutes;
  const dirty = partySize !== session.partySize || note.trim() !== (session.note ?? '');
  const shrinking = partySize < session.partySize;
  const busy = update.isPending || move.isPending || voidSession.isPending;
  useOverlayHistory(open, onClose, !busy);
  const offlineReason = online ? undefined : t.floor.offlineDisabled;

  const saveEdits = async () => {
    if (busy || !dirty) return;
    setError(null);
    try {
      await update.mutateAsync({ id: session.id, data: { party_size: partySize, note: note.trim() || null } });
    } catch (e: unknown) { setError(errMsg(e)); }
  };

  const doMove = async () => {
    if (busy || !moveTo) return;
    setError(null);
    try {
      const moved = await move.mutateAsync({ id: session.id, tableId: moveTo });
      const name = allTables.find((tb) => tb.id === moved.tableId)?.name ?? '';
      toast({ kind: 'success', title: t.floor.moved(name), msg: t.floor.movedMsg });
      setMoveTo('');
    } catch (e: unknown) { setError(errMsg(e)); }
  };

  const doVoid = async () => {
    if (busy) return;
    setError(null);
    try {
      await voidSession.mutateAsync(session.id);
      toast({ kind: 'success', title: t.floor.voided, msg: t.floor.voidedMsg });
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
    <Modal
      open={open}
      onClose={onClose}
      dismissible={!busy}
      size="md"
      divided
      title={t.floor.detailTitle(table?.name ?? '')}
      description={t.floor.detailSubtitle(clockTime(session.openedAt), session.rateSnapshot.name)}
      footer={
        <>
          <Button variant="secondary" size="lg" icon={<Icon name="cash" size={18} />} onClick={onSettle}>
            {t.floor.settle}
          </Button>
          {onOrder && (
            <Button size="lg" icon={<Icon name="cart" size={18} />} onClick={onOrder}>
              {t.floor.orderMore}
            </Button>
          )}
        </>
      }
    >
      <div className={s.form}>
        {/* Running total — server-computed, never recalculated here */}
        <div className={s.charge} aria-live="polite">
          <div className={s.chargeLabel}>{t.floor.chargeSoFar}</div>
          <div className={s.chargeValue}>
            {preview.isLoading || !preview.data ? '—' : bahtStr(preview.data.amount)}
          </div>
          <div className={s.chargeMeta}>
            {t.floor.seated(formatMinutes(elapsed))}
            {preview.data && ` · ${t.floor.billed(formatMinutes(preview.data.billableMinutes), formatMinutes(preview.data.rawMinutes))}`}
          </div>
          {(preview.data?.withinGrace || preview.data?.capApplied || overtime) && (
            <div className={s.chargeBadges}>
              {preview.data?.withinGrace && <Badge tone="info">{t.floor.graceLong}</Badge>}
              {preview.data?.capApplied && <Badge tone="neutral">{t.floor.capLong}</Badge>}
              {overtime && (
                <Badge tone="danger">
                  <Icon name="warning" size={12} strokeWidth={2} />
                  {t.floor.overtimeLong(formatMinutes(session.rateSnapshot.maxOpenMinutes))}
                </Badge>
              )}
            </div>
          )}
          <div className={s.plan}>{planSummary(session.rateSnapshot)}</div>
        </div>

        <NumberField
          label={t.floor.partySize}
          hint={shrinking ? t.floor.partyHintShrink : t.floor.partyHint}
          value={partySize}
          onChange={setPartySize}
          min={1}
          max={100}
          integer
          size="lg"
        />

        <NoteField label={t.floor.note} value={note} onChange={setNote} />

        {dirty && (
          <Button
            fullWidth
            icon={<Icon name="check" size={18} />}
            loading={update.isPending}
            disabled={busy || !online}
            disabledReason={offlineReason}
            onClick={() => { void saveEdits(); }}
          >
            {t.floor.saveEdits}
          </Button>
        )}

        <CustomerPicker
          label={t.floor.customer}
          customerName={session.customerId ? t.floor.customerLinked : null}
          onPick={(id) => { void attachCustomer(id); }}
          onClear={() => { void attachCustomer(null); }}
        />

        <div>
        <div className={s.row}>
          <Select
            className={s.grow}
            label={t.floor.moveTable}
            value={moveTo}
            onChange={setMoveTo}
            placeholder={freeTables.length ? t.floor.movePlaceholder : t.floor.noFreeTables}
            disabled={!freeTables.length}
            options={freeTables.map((tb) => ({ value: tb.id, label: `${tb.name}${tb.zone ? ` · ${tb.zone}` : ''}` }))}
          />
          <Button
            variant="secondary"
            loading={move.isPending}
            disabled={busy || !moveTo || !online}
            disabledReason={offlineReason}
            onClick={() => { void doMove(); }}
          >
            {t.floor.move}
          </Button>
        </div>
        <div className={`ui-field__hint ${s.rowHint}`}>{t.floor.moveHint}</div>
        </div>

        {canVoid && (
          <>
            <hr className={s.divider} />
            <div>
              <div className="ui-field__label">{t.floor.voidTitle}</div>
              {confirmVoid ? (
                <div className={s.row}>
                  <Button variant="secondary" className={s.grow} onClick={() => setConfirmVoid(false)}>{t.floor.voidKeep}</Button>
                  <Button variant="danger" className={s.grow} loading={voidSession.isPending} disabled={busy} onClick={() => { void doVoid(); }}>
                    {t.floor.voidConfirm}
                  </Button>
                </div>
              ) : (
                <Button variant="ghost" fullWidth className={s.danger} icon={<Icon name="void" size={18} />} onClick={() => setConfirmVoid(true)}>
                  {t.floor.voidAction}
                </Button>
              )}
              <div className="ui-field__hint">{t.floor.voidHint}</div>
            </div>
          </>
        )}

        {error && <Banner tone="danger" icon="warning" live="alert" title={error} />}
      </div>
    </Modal>
  );
}

export { ModalShell, Field, inputStyle, errMsg, planSummary };
