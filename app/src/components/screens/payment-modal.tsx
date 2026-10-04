'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import Icon from '../icons';
import { useFadeRise } from '@/lib/motion';
import { useModalA11y } from '@/hooks/use-modal-a11y';
import { haptic } from '@/lib/haptics';
import { useI18n } from '@/lib/i18n';
import { CashView, CashPayStyles, cashMath } from './payment-cash';

interface Props { method: string; total: number; billNo: number; onClose: () => void; onPaid: () => void; }

/**
 * A QR code must stay light-with-dark-ink in BOTH themes so a phone camera can
 * read it, so these two are intentionally NOT theme tokens. They are tinted
 * (toward the espresso brand hue) rather than pure #fff / #000 per the design
 * system's no-pure-black/white rule.
 */
const QR_PAPER = '#FBFAF7';
const QR_INK = '#1C140D';

export default function PaymentModal({ method, total, billNo, onClose, onPaid }: Props) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<'await' | 'processing' | 'paid'>('await');
  const [cashGiven, setCashGiven] = useState('');

  // Re-entrancy guard: a fast double-tap can fire this twice in the same frame
  // (before React re-renders and hides the button), which would create two
  // orders. The ref blocks every call after the first.
  const confirmed = useRef(false);
  // The success-beat timers must die with the modal: if the dialog unmounts
  // while they're pending, a stray onPaid() would create the order anyway.
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);
  const onConfirmPay = () => {
    if (confirmed.current) return;
    confirmed.current = true;
    // Brief processing beat so the cashier sees the action was registered, then
    // settle into the success state. Kept short — this fires dozens of times/hr.
    setPhase('processing');
    timers.current.push(setTimeout(() => { setPhase('paid'); haptic('success'); }, 280));
    timers.current.push(setTimeout(() => onPaid(), 1100));
  };
  // Once payment is confirmed the modal must not be dismissible — closing during
  // the processing/paid beat would look like a cancel while the order still goes
  // through. Reads confirmed.current at call time, so the mount-once a11y hook
  // stays correct.
  const safeClose = () => { if (confirmed.current) return; onClose(); };

  const dialogRef = useModalA11y(safeClose);

  useEffect(() => {
    if (method === 'qr' || method === 'line') {
      const timer = setTimeout(() => { /* user clicks */ }, 12000);
      return () => clearTimeout(timer);
    }
  }, [method]);

  const isCash = method === 'cash';
  // The cash amount field is a keypad-driven display, not an <input>. Park focus
  // on it (after useModalA11y's own first-focusable pass, which lands on "ปิด")
  // so a hardware-keyboard cashier can type and press Enter straight away.
  useEffect(() => {
    if (!isCash) return;
    dialogRef.current?.querySelector<HTMLElement>('[data-cash-entry]')?.focus({ preventScroll: true });
  }, [isCash, dialogRef]);

  const cashEnough = isCash ? cashMath(total, cashGiven).enough : true;

  const titleMap = t.touchPay.title;

  const busy = phase !== 'await';

  return (
    <div className="modal-backdrop" onClick={safeClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={titleMap[method]}
        aria-busy={busy || undefined}
        className={isCash ? 'modal-card cashpay' : 'modal-card'}
        onClick={(e) => e.stopPropagation()}
        // Cash sizes itself from the .cashpay rules (wider two-column card on
        // tablets/desktop, capped to the viewport height); other methods keep
        // the original fixed width.
        style={{ width: isCash ? undefined : 'min(440px, 92vw)', display: 'flex', flexDirection: 'column' }}
      >
        {isCash ? <CashPayStyles /> : <PayModalPhoneStyles />}
        <div className={isCash ? 'cashpay-head' : 'paymodal-head'} style={{
          padding: isCash ? undefined : 'var(--space-5) var(--space-6)', borderBottom: '1px solid var(--color-border)',
          display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flex: 'none',
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: 'var(--radius-md)', background: 'var(--color-accent-50)',
            color: 'var(--color-primary)', display: 'grid', placeItems: 'center',
          }}>
            <Icon name={method === 'cash' ? 'cash' : method === 'card' ? 'card' : method === 'line' ? 'line' : 'qr'} size={20}/>
          </div>
          <div style={{flex: 1}}>
            <div style={{fontSize: 'var(--fs-title)', fontWeight: 700, lineHeight: 'var(--lh-tight)'}}>{titleMap[method]}</div>
            <div className="num" style={{fontSize: 'var(--fs-cap)', color: 'var(--color-text-secondary)'}}>{t.touchPay.billNo('A' + String(billNo).padStart(3, '0'))}</div>
          </div>
          {/* 48×48 visible hit (TOUCH-SPEC §3.6); the negative margin keeps the header height. */}
          <button onClick={safeClose} aria-label={t.common.close} className="icon-btn tap-std tap-sq" style={{
            margin: '-8px -8px -8px 0', borderRadius: 'var(--radius-md)', color: 'var(--color-text-secondary)',
          }}>
            <Icon name="x" size={20}/>
          </button>
        </div>

        <div
          className={isCash && phase === 'await' ? 'cashpay-body scroll' : isCash ? undefined : 'paymodal-body scroll'}
          style={isCash && phase === 'await' ? undefined : {padding: 'var(--space-6)'}}
        >
          {phase === 'paid' ? (
            <SuccessView total={total} />
          ) : phase === 'processing' ? (
            <ProcessingView total={total} />
          ) : method === 'qr' ? (
            <QRView total={total} onSimulatePay={onConfirmPay} />
          ) : method === 'line' ? (
            <LineView total={total} onSimulatePay={onConfirmPay} />
          ) : method === 'card' ? (
            <CardView total={total} onSimulatePay={onConfirmPay} />
          ) : (
            <CashView total={total} cashGiven={cashGiven} setCashGiven={setCashGiven} canConfirm={cashEnough} onConfirm={onConfirmPay} />
          )}
        </div>

        {phase === 'await' && isCash && (
          <div className="cashpay-foot">
            <button type="button" onClick={safeClose} className="btn btn-ghost btn-lg tap-lg" style={{flex: 1}}>{t.common.back}</button>
            <button type="button" onClick={onConfirmPay} disabled={!cashEnough} className="btn btn-primary btn-xl" style={{flex: 2, opacity: cashEnough ? 1 : 0.5}}>
              <Icon name="check" size={20}/> {t.touchPay.confirmPayment}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Card / QR / LINE on phones (< 768px): the body scrolls inside the height-capped
 * card and the confirm button stays pinned to its bottom edge, so it is reachable
 * on short screens (360×640, landscape). Nothing here applies ≥ 768px — there
 * `.paymodal-pin` is a plain wrapper and the dialog renders exactly as before.
 * (Cash has its own layout: `.cashpay` in payment-cash.tsx.)
 */
const PAYMODAL_PHONE_CSS = `
@media (max-width: 767px) {
  .paymodal-head { padding: 12px 16px !important; }
  /* Bottom padding lives on .paymodal-pin so the pinned button keeps its gutter. */
  .paymodal-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 16px 16px 0 !important; }
  .paymodal-pin {
    position: sticky; bottom: 0;
    margin: 12px -16px 0; padding: 12px 16px 16px;
    background: var(--color-surface);
  }
  .paymodal-pin > button { margin-top: 0 !important; }
  .paymodal-qr { width: min(240px, 100%) !important; height: auto !important; aspect-ratio: 1; }
}
`;
const PayModalPhoneStyles = () => <style>{PAYMODAL_PHONE_CSS}</style>;

const QRView = ({ total, onSimulatePay }: { total: number; onSimulatePay: () => void }) => {
  const { t } = useI18n();
  // QR "generation": brief skeleton in the code slot so the matrix doesn't pop
  // in cold. PromptPay codes resolve fast, so this is a short, honest beat.
  const [generating, setGenerating] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setGenerating(false), 420);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div style={{textAlign: 'center'}}>
      <div style={{fontSize: 'var(--fs-sm)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-1)'}}>{t.touchPay.amountDue}</div>
      <div className="text-num-xl" style={{letterSpacing: '-0.02em', color: 'var(--color-primary)', marginBottom: 'var(--space-1)'}}>
        ฿{total.toLocaleString()}
      </div>
      <div style={{fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 'var(--space-4)'}}>{t.touchPay.qrMerchant}</div>
      <div aria-busy={generating || undefined} className="paymodal-qr" style={{
        width: 240, height: 240, margin: '0 auto', padding: 'var(--space-4)',
        background: QR_PAPER, borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)',
      }}>
        {generating ? (
          <div className="skeleton" aria-hidden style={{ width: '100%', height: '100%', borderRadius: 'var(--radius-md)' }} />
        ) : (
          <FakeQR seed={total} />
        )}
      </div>
      <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-4)', fontSize: 13, color: 'var(--color-text-secondary)'}}>
        {/* Static status dot: the text carries "waiting"; no endless pulse (TOUCH-SPEC §1). */}
        <span aria-hidden style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--color-warning)' }}/>
        <span>{generating ? t.touchPay.generatingQr : t.touchPay.waitingQr}</span>
      </div>
      <div className="paymodal-pin">
        <button onClick={onSimulatePay} disabled={generating} className="btn btn-primary btn-block btn-xl" style={{marginTop: 'var(--space-5)', opacity: generating ? 0.5 : 1}}>
          <Icon name="check" size={20}/> {t.touchPay.simulatePaid}
        </button>
      </div>
    </div>
  );
};

const FakeQR = ({ seed }: { seed: number }) => {
  const N = 25;
  const cells = useMemo(() => {
    const arr: boolean[] = [];
    let s = (seed * 9301 + 49297) % 233280;
    for (let i = 0; i < N * N; i++) {
      s = (s * 9301 + 49297) % 233280;
      arr.push((s / 233280) > 0.52);
    }
    const setRect = (cx: number, cy: number) => {
      for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
        const inside = x >= 1 && x <= 5 && y >= 1 && y <= 5;
        const inner = x >= 2 && x <= 4 && y >= 2 && y <= 4;
        arr[(cy + y) * N + (cx + x)] = !inside || inner;
      }
    };
    setRect(0, 0); setRect(N - 7, 0); setRect(0, N - 7);
    return arr;
  }, [seed]);

  return (
    <svg viewBox={`0 0 ${N} ${N}`} width="100%" height="100%">
      {cells.map((on, i) => on && (
        <rect key={i} x={i % N} y={Math.floor(i / N)} width="1" height="1" fill={QR_INK}/>
      ))}
    </svg>
  );
};

const CardView = ({ total, onSimulatePay }: { total: number; onSimulatePay: () => void }) => {
  const { t } = useI18n();
  return (
  <div style={{textAlign: 'center'}}>
    <div style={{fontSize: 'var(--fs-sm)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-1)'}}>{t.touchPay.amountDue}</div>
    <div className="text-num-xl" style={{color: 'var(--color-primary)', marginBottom: 'var(--space-6)'}}>฿{total.toLocaleString()}</div>
    {/* Surface-2 band groups the EDC prompt; no thick dashed frame, no endless wiggle. */}
    <div style={{
      padding: 'var(--space-8)', background: 'var(--color-surface-2)', borderRadius: 'var(--radius-lg)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3)',
    }}>
      <div style={{
        width: 60, height: 60, borderRadius: 999,
        background: 'var(--color-info-50)', color: 'var(--color-info)',
        display: 'grid', placeItems: 'center',
      }}>
        <Icon name="card" size={28}/>
      </div>
      <div style={{fontSize: 'var(--fs-body)', fontWeight: 600}}>{t.touchPay.cardPrompt}</div>
      <div style={{fontSize: 'var(--fs-cap)', color: 'var(--color-text-secondary)'}}>{t.touchPay.edcStatus}</div>
    </div>
    <div className="paymodal-pin">
      <button onClick={onSimulatePay} className="btn btn-primary btn-block btn-xl" style={{marginTop: 'var(--space-4)'}}>
        <Icon name="check" size={20}/> {t.touchPay.simulatePaid}
      </button>
    </div>
  </div>
  );
};

const LineView = ({ total, onSimulatePay }: { total: number; onSimulatePay: () => void }) => {
  const { t } = useI18n();
  const [generating, setGenerating] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setGenerating(false), 420);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div style={{textAlign: 'center'}}>
      <div style={{fontSize: 'var(--fs-sm)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-1)'}}>{t.touchPay.amountDue}</div>
      <div className="text-num-xl" style={{color: 'var(--color-primary)', marginBottom: 'var(--space-6)'}}>฿{total.toLocaleString()}</div>
      <div aria-busy={generating || undefined} style={{
        width: 200, height: 200, margin: '0 auto', padding: 'var(--space-3)',
        background: QR_PAPER, borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)',
      }}>
        {generating ? (
          <div className="skeleton" aria-hidden style={{ width: '100%', height: '100%', borderRadius: 'var(--radius-md)' }} />
        ) : (
          <FakeQR seed={total + 7} />
        )}
      </div>
      <div style={{fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 'var(--space-3)'}}>
        {generating ? t.touchPay.generatingQr : t.touchPay.lineScan}
      </div>
      <div className="paymodal-pin">
        <button onClick={onSimulatePay} disabled={generating} className="btn btn-primary btn-block btn-xl" style={{marginTop: 'var(--space-4)', opacity: generating ? 0.5 : 1}}>
          <Icon name="check" size={20}/> {t.touchPay.simulatePaid}
        </button>
      </div>
    </div>
  );
};

/**
 * Processing beat between "confirm" and the success state. Short, calm, and
 * announced via aria-busy on the dialog. No bouncy motion — the cashier is
 * mid-flow and just needs confirmation the tap registered.
 */
const ProcessingView = ({ total }: { total: number }) => {
  const { t } = useI18n();
  return (
  <div style={{textAlign: 'center', padding: 'var(--space-5) 0'}}>
    <div style={{
      width: 72, height: 72, margin: '0 auto var(--space-4)', borderRadius: 999,
      background: 'var(--color-surface-2)', color: 'var(--color-primary)',
      display: 'grid', placeItems: 'center',
    }}>
      <span className="spinner" style={{width: 26, height: 26, borderWidth: 3}} aria-hidden />
    </div>
    <div style={{fontSize: 18, fontWeight: 700, marginBottom: 'var(--space-1)'}}>{t.touchPay.processing}</div>
    <div className="num" style={{fontSize: 32, fontWeight: 700, color: 'var(--color-primary)'}}>฿{total.toLocaleString()}</div>
  </div>
  );
};

const SuccessView = ({ total }: { total: number }) => {
  // Rare, satisfying moment → a gentle fade-rise on the whole panel + an
  // ease-out scale on the checkmark. No infinite/bouncy loops.
  const { t } = useI18n();
  const ref = useFadeRise({ y: 10, duration: 0.22 });
  return (
    <div ref={ref} role="status" style={{textAlign: 'center', padding: 'var(--space-5) 0'}}>
      <div style={{
        width: 72, height: 72, margin: '0 auto var(--space-4)', borderRadius: 999,
        background: 'var(--color-success-50)', color: 'var(--color-success)',
        display: 'grid', placeItems: 'center',
        animation: 'pay-pop 320ms var(--ease-out)',
      }}>
        <Icon name="check" size={40} strokeWidth={2}/>
      </div>
      <div style={{fontSize: 20, fontWeight: 700, marginBottom: 'var(--space-1)'}}>{t.pos.paid}</div>
      <div className="num" style={{fontSize: 32, fontWeight: 700, color: 'var(--color-primary)', marginBottom: 'var(--space-2)'}}>฿{total.toLocaleString()}</div>
      <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)', fontSize: 13, color: 'var(--color-text-secondary)'}}>
        <span className="spinner" style={{width: 14, height: 14}} aria-hidden />
        {t.pos.preparingReceiptSub}
      </div>
      <style>{`@keyframes pay-pop { 0% { transform: scale(0.9); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }`}</style>
    </div>
  );
};
