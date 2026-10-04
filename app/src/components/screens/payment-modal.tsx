'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Banner, Button, Input, Modal, SegmentedControl, Sheet, type SegmentOption } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { useIsPhone } from '@/hooks/use-media-query';
import { useCurrentUser, isAdmin } from '@/hooks/use-current-user';
import { useOnlineStatus } from '../pwa/offline-indicator';
import Icon from '../icons';
import { CashView, baht, cashMath, exactString } from './payment-cash';
import { QrPanel } from './payment/qr-panel';
import { readPromptPayId } from './payment/promptpay';
import s from './payment/payment.module.css';

export type PayMethod = 'cash' | 'qr' | 'card' | 'line';
const METHODS: PayMethod[] = ['cash', 'qr', 'card', 'line'];

/** What the cashier actually confirmed. Callers that ignore it keep today's behaviour. */
export interface PaymentDetails {
  method: PayMethod;
  /** The amount this sheet was opened for. */
  amount: number;
  /** Cash only: tendered amount and change due. */
  cashGiven?: number;
  change?: number;
  /** Card slip approval code / LINE Pay transaction no. (D4). Maps to `payment_ref`. */
  paymentRef?: string;
  /** QR / LINE manual confirm: who verified the money arrived (D5 `paymentVerifiedBy`). */
  verifiedBy?: { id: string; name: string };
}

interface Props {
  method: string;
  total: number;
  /** Legacy local counter. No longer shown: the sheet never displays a fabricated bill number. */
  billNo?: number;
  /** Server bill label ("#47") when one exists; shown under the title. */
  billLabel?: string;
  onClose: () => void;
  /**
   * Called once per confirm. Return a promise to keep the sheet open while the
   * server records the order: resolve → success tick, reject → inline error +
   * retry with the cart untouched. Returning nothing hands control to the caller
   * at once (it usually unmounts the sheet).
   */
  onPaid: (details: PaymentDetails) => void | Promise<unknown>;
  /**
   * Enables the method tabs (Alt+1–4). The caller must use `details.method` (or
   * this callback) when recording the payment, so tabs only appear when wired.
   */
  onMethodChange?: (method: PayMethod) => void;
}

/**
 * Reject `onPaid` with this when nothing went wrong but the cashier must look
 * again (e.g. the table total moved). Shown as a warning, not a failure.
 */
export class PaymentNotice extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentNotice';
  }
}

type Phase = 'await' | 'processing' | 'paid' | 'error';

const asMethod = (m: string): PayMethod => (METHODS.includes(m as PayMethod) ? (m as PayMethod) : 'cash');

export default function PaymentModal({ method: methodProp, total, billLabel, onClose, onPaid, onMethodChange }: Props) {
  const { t } = useI18n();
  const isPhone = useIsPhone();
  const online = useOnlineStatus();
  const { data: me } = useCurrentUser();

  // Follows the prop when the caller changes it (derived during render, no effect).
  const [method, setMethod] = useState<PayMethod>(() => asMethod(methodProp));
  const [seenProp, setSeenProp] = useState(methodProp);
  if (seenProp !== methodProp) {
    setSeenProp(methodProp);
    setMethod(asMethod(methodProp));
  }

  const [phase, setPhase] = useState<Phase>('await');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState(false);
  const [cashGiven, setCashGiven] = useState('');
  const [ref, setRef] = useState('');

  // Re-entrancy guard: a fast double-tap can fire twice in one frame, before React
  // re-renders the button as busy. The ref blocks every call after the first.
  const inFlight = useRef(false);
  const alive = useRef(true);
  // Re-armed on mount: StrictMode runs mount → cleanup → mount in development.
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const busy = phase === 'processing' || phase === 'paid';
  const isCash = method === 'cash';
  const cash = cashMath(total, cashGiven);
  const [ppId, setPpId] = useState(readPromptPayId);
  const qrReady = method !== 'qr' || ppId !== '';
  const canConfirm = online && !busy && (isCash ? cash.enough : qrReady);

  const switchMethod = useCallback((m: PayMethod) => {
    if (busy || !onMethodChange) return;
    setMethod(m);
    setError(null);
    setPhase('await');
    setRef('');
    onMethodChange(m);
  }, [busy, onMethodChange]);

  const confirm = useCallback(() => {
    if (inFlight.current || !canConfirm) return;
    inFlight.current = true;
    setError(null);
    setPhase('processing');
    const details: PaymentDetails = {
      method,
      amount: total,
      ...(isCash ? { cashGiven: parseFloat(cashGiven) || 0, change: cash.change } : {}),
      ...(!isCash && ref.trim() ? { paymentRef: ref.trim() } : {}),
      ...((method === 'qr' || method === 'line') && me ? { verifiedBy: { id: me.id, name: me.name } } : {}),
    };
    let result: void | Promise<unknown>;
    try {
      result = onPaid(details);
    } catch (e) {
      result = Promise.reject(e);
    }
    if (!result || typeof (result as Promise<unknown>).then !== 'function') return; // caller took over
    (result as Promise<unknown>).then(
      () => { if (alive.current) setPhase('paid'); },
      (e: unknown) => {
        inFlight.current = false;
        if (!alive.current) return;
        setPhase('error');
        setNotice(e instanceof PaymentNotice);
        setError(e instanceof Error && e.message ? e.message : t.payment.failedBody);
      },
    );
  }, [canConfirm, method, total, isCash, cashGiven, cash.change, ref, me, onPaid, t]);

  // Sheet-scoped keys (spec §4.1 "payment"): Alt+1–4 method · = exact · Enter confirm (non-cash;
  // the cash Keypad owns Enter). Matched on e.code so the Thai layout works.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const target = e.target instanceof Element ? e.target : null;
      const typing = !!target?.closest('input, textarea, select, [contenteditable="true"]');
      if (e.altKey && /^(Digit|Numpad)[1-4]$/.test(e.code)) {
        e.preventDefault();
        switchMethod(METHODS[Number(e.code.slice(-1)) - 1]);
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isCash && !typing && !busy && (e.code === 'Equal' || e.code === 'NumpadEqual' || e.key === '=')) {
        e.preventDefault();
        setCashGiven(exactString(total));
        return;
      }
      if (!isCash && e.key === 'Enter' && !e.repeat && !target?.closest('button, a, [role="button"], textarea')) {
        e.preventDefault();
        confirm();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isCash, busy, total, switchMethod, confirm]);

  // Initial focus: the Modal focuses its first control (×), where a hardware
  // Enter would close the sheet. Park it on the cash amount (Keypad owns Enter)
  // or on the confirm button (Enter = confirm). Runs after the Modal's own pass.
  useEffect(() => {
    document.querySelector<HTMLElement>('[data-pay-autofocus]')?.focus({ preventScroll: true });
  }, [method]);

  const amountText = baht(total);
  const confirmLabel = phase === 'error' ? t.payment.retry
    : isCash ? t.payment.confirmCash
    : method === 'card' ? t.payment.cardDone
    : method === 'qr' ? t.payment.qrReceived
    : t.payment.lineDone;
  const disabledReason = !online ? t.payment.offline
    : isCash && cash.entered && !cash.enough ? t.payment.needMore(baht(cash.shortfall))
    : undefined;

  const methodOptions: SegmentOption<PayMethod>[] = METHODS.map((m, i) => ({
    value: m,
    // Phones: four segments in ~330px, so no icons and the short brand term "QR".
    label: isPhone && m === 'qr' ? 'QR' : t.payment.method[m],
    icon: isPhone ? undefined : <Icon name={m} size={18} />,
    keyShortcuts: `Alt+${i + 1}`,
    disabled: busy,
  }));

  const body = phase === 'paid' ? (
    <SuccessView amountText={amountText} change={isCash && cash.change > 0 ? baht(cash.change) : null} />
  ) : (
    <>
      {onMethodChange && (
        <SegmentedControl
          value={method}
          onChange={switchMethod}
          options={methodOptions}
          ariaLabel={t.payment.methodGroup}
          size="lg"
          fullWidth
        />
      )}
      {!online && <Banner tone="danger" title={t.payment.offline} detail={t.payment.offlineBody} />}
      {phase === 'error' && error && (notice ? (
        <Banner tone="warning" icon="info" live="alert" title={error} />
      ) : (
        <Banner tone="danger" icon="warning" live="alert" title={t.payment.failedTitle} detail={error} />
      ))}
      {isCash ? (
        <CashView
          total={total}
          cashGiven={cashGiven}
          setCashGiven={setCashGiven}
          canConfirm={canConfirm}
          onConfirm={confirm}
          disabled={busy}
        />
      ) : method === 'qr' ? (
        <>
          <QrPanel id={ppId} onIdChange={setPpId} total={total} amountText={amountText} canConfigure={isAdmin(me?.role)} />
          {me && qrReady && <p className={s.verifier}>{t.payment.verifiedBy(me.name)}</p>}
        </>
      ) : (
        <ManualView
          method={method}
          amountText={amountText}
          refValue={ref}
          onRef={setRef}
          onSubmit={confirm}
          disabled={busy}
          verifier={method === 'line' && me ? t.payment.verifiedBy(me.name) : null}
        />
      )}
    </>
  );

  const footer = phase === 'paid' ? undefined : (
    <div className={s.payFoot}>
      <Button variant="secondary" size="xl" onClick={onClose} disabled={busy} className={s.payCancel}>
        {t.payment.cancel}
      </Button>
      <Button
        variant="primary"
        size="xl"
        onClick={confirm}
        loading={phase === 'processing'}
        disabled={!canConfirm}
        disabledReason={!canConfirm && !busy ? disabledReason : undefined}
        kbd="Enter"
        data-pay-autofocus={isCash ? undefined : ''}
        icon={<Icon name={phase === 'error' ? 'refresh' : 'check'} size={20} />}
        className={s.payConfirm}
      >
        {phase === 'processing' ? t.payment.processing : confirmLabel}
      </Button>
    </div>
  );

  const shared = {
    open: true,
    onClose,
    title: t.payment.title[method],
    description: billLabel,
    dismissible: !busy,
    closeOnBackdrop: false,
    footer,
    className: s.payDialog,
  };

  return isPhone ? (
    <Sheet {...shared} size="full">{body}</Sheet>
  ) : (
    <Modal {...shared} size="lg" hideClose={busy}>{body}</Modal>
  );
}

/** Card (EDC) and LINE Pay: manual confirm with an optional reference (D4). */
function ManualView({ method, amountText, refValue, onRef, onSubmit, disabled, verifier }: {
  method: 'card' | 'line';
  amountText: string;
  refValue: string;
  onRef: (v: string) => void;
  onSubmit: () => void;
  disabled: boolean;
  verifier: string | null;
}) {
  const { t } = useI18n();
  const isCard = method === 'card';
  return (
    <div className={s.manual}>
      <div className={s.manualAmount}>
        <span className={s.dueLabel}>{t.payment.amountDue}</span>
        <span className={`num ${s.bigAmount}`}>{amountText}</span>
      </div>
      <div className={s.manualStep}>
        <Icon name={isCard ? 'card' : 'line'} size={28} />
        <div>
          <p className={s.manualTitle}>{isCard ? t.payment.cardInstruction(amountText) : t.payment.lineInstruction}</p>
          {isCard && <p className={s.manualSub}>{t.payment.cardSub}</p>}
        </div>
      </div>
      <Input
        label={isCard ? t.payment.cardRefLabel : t.payment.lineRefLabel}
        hint={isCard ? t.payment.cardRefHint : undefined}
        value={refValue}
        maxLength={120}
        autoComplete="off"
        inputMode={isCard ? 'numeric' : 'text'}
        size="lg"
        disabled={disabled}
        onChange={(e) => onRef(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.repeat) { e.preventDefault(); onSubmit(); } }}
      />
      {verifier && <p className={s.verifier}>{verifier}</p>}
    </div>
  );
}

/** 240ms stroke-draw tick (spec §8). The receipt replaces this as soon as the caller is ready. */
function SuccessView({ amountText, change }: { amountText: string; change: string | null }) {
  const { t } = useI18n();
  return (
    <div className={s.success} role="status">
      <svg className={s.tick} viewBox="0 0 52 52" aria-hidden="true">
        <circle className={s.tickRing} cx="26" cy="26" r="24" />
        <path className={s.tickMark} d="M15 27l7 7 15-16" />
      </svg>
      <p className={s.successTitle}>{t.payment.success}</p>
      <p className={`num ${s.bigAmount}`}>{amountText}</p>
      {change && (
        <p className={s.successChange}>
          {t.payment.change} <span className="num">{change}</span>
        </p>
      )}
    </div>
  );
}
