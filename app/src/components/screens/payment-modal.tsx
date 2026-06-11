'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import Icon from '../icons';
import { useFadeRise, useCountUp } from '@/lib/motion';

interface Props { method: string; total: number; billNo: number; onClose: () => void; onPaid: () => void; }

/**
 * A QR code must stay light-with-dark-ink in BOTH themes so a phone camera can
 * read it, so these two are intentionally NOT theme tokens. They are tinted
 * (toward the espresso brand hue) rather than pure #fff / #000 per the design
 * system's no-pure-black/white rule.
 */
const QR_PAPER = '#FBFAF7';
const QR_INK = '#1C140D';

/**
 * Modal a11y: trap focus inside the dialog, close on Esc, restore focus to the
 * element that opened it. Mirrors the role="dialog"/aria-modal convention used
 * elsewhere in the app. The visual open/close stays on the CSS .modal-in /
 * .backdrop-in classes — this only wires keyboard + focus behaviour.
 */
function useModalA11y(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const node = ref.current;

    // Move focus into the dialog on open (first focusable, else the shell).
    const focusables = () =>
      Array.from(
        node?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => el.offsetParent !== null);

    focusables()[0]?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
    // onClose identity is stable for the modal's lifetime in practice; we only
    // want this to run once on mount/unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return ref;
}

export default function PaymentModal({ method, total, billNo, onClose, onPaid }: Props) {
  const [phase, setPhase] = useState<'await' | 'processing' | 'paid'>('await');
  const [cashGiven, setCashGiven] = useState('');
  const dialogRef = useModalA11y(onClose);

  useEffect(() => {
    if (method === 'qr' || method === 'line') {
      const t = setTimeout(() => { /* user clicks */ }, 12000);
      return () => clearTimeout(t);
    }
  }, [method]);

  const change = method === 'cash' && cashGiven ? Math.max(0, parseFloat(cashGiven) - total) : 0;
  const cashEnough = method === 'cash' ? parseFloat(cashGiven || '0') >= total : true;

  const titleMap: Record<string, string> = { cash: 'รับเงินสด', card: 'รูดบัตร', qr: 'QR PromptPay', line: 'LINE Pay' };

  // Re-entrancy guard: a fast double-tap can fire this twice in the same frame
  // (before React re-renders and hides the button), which would create two
  // orders. The ref blocks every call after the first.
  const confirmed = useRef(false);
  const onConfirmPay = () => {
    if (confirmed.current) return;
    confirmed.current = true;
    // Brief processing beat so the cashier sees the action was registered, then
    // settle into the success state. Kept short — this fires dozens of times/hr.
    setPhase('processing');
    setTimeout(() => setPhase('paid'), 280);
    setTimeout(() => onPaid(), 1100);
  };

  const busy = phase !== 'await';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={titleMap[method]}
        aria-busy={busy || undefined}
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(440px, 92vw)', display: 'flex', flexDirection: 'column' }}
      >
        <div style={{
          padding: 'var(--space-5) var(--space-6)', borderBottom: '1px solid var(--color-border)',
          display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: 'var(--radius-md)', background: 'var(--color-accent-50)',
            color: 'var(--color-primary)', display: 'grid', placeItems: 'center',
          }}>
            <Icon name={method === 'cash' ? 'cash' : method === 'card' ? 'card' : method === 'line' ? 'line' : 'qr'} size={20}/>
          </div>
          <div style={{flex: 1}}>
            <div style={{fontSize: 16, fontWeight: 700}}>{titleMap[method]}</div>
            <div style={{fontSize: 12, color: 'var(--color-text-secondary)'}}>บิล A0{billNo}</div>
          </div>
          <button onClick={onClose} aria-label="ปิด" className="icon-btn hit-44" style={{
            width: 32, height: 32, borderRadius: 'var(--radius-md)', display: 'grid', placeItems: 'center',
            color: 'var(--color-text-secondary)',
          }}>
            <Icon name="x" size={18}/>
          </button>
        </div>

        <div style={{padding: 'var(--space-6)'}}>
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
            <CashView total={total} cashGiven={cashGiven} setCashGiven={setCashGiven} change={change} />
          )}
        </div>

        {phase === 'await' && method === 'cash' && (
          <div style={{padding: '0 var(--space-6) var(--space-5)', display: 'flex', gap: 'var(--space-2)'}}>
            <button onClick={onClose} className="btn btn-ghost btn-lg" style={{flex: 1, minHeight: 44}}>ยกเลิก</button>
            <button onClick={onConfirmPay} disabled={!cashEnough} className="btn btn-primary btn-lg" style={{flex: 2, minHeight: 44, opacity: cashEnough ? 1 : 0.5}}>
              <Icon name="check" size={16}/> ยืนยันรับเงิน
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const QRView = ({ total, onSimulatePay }: { total: number; onSimulatePay: () => void }) => {
  // QR "generation": brief skeleton in the code slot so the matrix doesn't pop
  // in cold. PromptPay codes resolve fast, so this is a short, honest beat.
  const [generating, setGenerating] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setGenerating(false), 420);
    return () => clearTimeout(t);
  }, []);

  return (
    <div style={{textAlign: 'center'}}>
      <div style={{fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 'var(--space-1)'}}>ยอดที่ต้องชำระ</div>
      <div className="num" style={{fontSize: 36, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--color-primary)', marginBottom: 'var(--space-1)'}}>
        ฿{total.toLocaleString()}
      </div>
      <div style={{fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 'var(--space-4)'}}>คาเฟ่ Kafé OS • PromptPay</div>
      <div aria-busy={generating || undefined} style={{
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
        <span style={{
          width: 8, height: 8, borderRadius: 999, background: 'var(--color-warning)',
          animation: 'pulse 1.5s ease-in-out infinite',
        }}/>
        <span>{generating ? 'กำลังสร้าง QR...' : 'กำลังรอการชำระเงิน...'}</span>
      </div>
      <button onClick={onSimulatePay} disabled={generating} className="btn btn-primary btn-block btn-lg" style={{marginTop: 'var(--space-5)', minHeight: 44, opacity: generating ? 0.5 : 1}}>
        <Icon name="check" size={16}/> จำลอง: ลูกค้าชำระแล้ว
      </button>
      <button className="btn btn-ghost btn-block" style={{marginTop: 'var(--space-2)', minHeight: 44}}>
        <Icon name="print" size={14}/> พิมพ์ใบเสร็จ
      </button>
      <style>{`@keyframes pulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.5; transform: scale(1.4); } }`}</style>
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

const CashView = ({ total, cashGiven, setCashGiven, change }: { total: number; cashGiven: string; setCashGiven: (v: string) => void; change: number }) => {
  const presets = [100, 200, 500, 1000];
  // Change count-up: the cashier glances here to read what to hand back. The
  // tween makes a changing figure legible instead of flickering between values.
  const changeRef = useCountUp(change, { duration: 0.35, format: (n) => `฿${Math.round(n).toLocaleString()}` });
  return (
    <div>
      <div style={{textAlign: 'center', marginBottom: 'var(--space-4)'}}>
        <div style={{fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 'var(--space-1)'}}>ยอดที่ต้องรับ</div>
        <div className="num" style={{fontSize: 36, fontWeight: 700, color: 'var(--color-primary)'}}>฿{total.toLocaleString()}</div>
      </div>
      <div style={{fontSize: 13, fontWeight: 600, marginBottom: 'var(--space-2)'}}>เงินที่รับมา</div>
      <input
        type="number" placeholder="0"
        value={cashGiven} onChange={(e) => setCashGiven(e.target.value)}
        className="num input-std"
        style={{
          width: '100%', padding: 'var(--space-4)',
          fontSize: 24, fontWeight: 700, textAlign: 'right',
          background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)', outline: 'none',
        }}
      />
      <div style={{display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--space-2)', marginTop: 'var(--space-2)'}}>
        {presets.map((p) => (
          <button key={p} onClick={() => setCashGiven(String(p))}
            className="num pressable"
            style={{
              padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)', fontSize: 13, fontWeight: 600, minHeight: 44,
              background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
            }}
          >฿{p}</button>
        ))}
        <button onClick={() => setCashGiven(String(total))}
          className="pressable"
          style={{
            padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)', fontSize: 13, fontWeight: 600, minHeight: 44,
            background: 'var(--color-accent-50)', border: '1px solid var(--color-accent)', color: 'var(--color-primary-700)',
            gridColumn: 'span 4',
          }}
        >พอดี ฿{total.toLocaleString()}</button>
      </div>
      <div style={{
        marginTop: 'var(--space-4)', padding: 'var(--space-4)',
        background: 'var(--color-success-50)', borderRadius: 'var(--radius-md)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div style={{fontSize: 13, color: 'var(--color-success)', fontWeight: 600}}>เงินทอน</div>
        <span ref={changeRef} className="num" style={{fontSize: 22, fontWeight: 700, color: 'var(--color-success)'}}>฿{change.toLocaleString()}</span>
      </div>
    </div>
  );
};

const CardView = ({ total, onSimulatePay }: { total: number; onSimulatePay: () => void }) => (
  <div style={{textAlign: 'center'}}>
    <div style={{fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 'var(--space-1)'}}>ยอดที่ต้องชำระ</div>
    <div className="num" style={{fontSize: 36, fontWeight: 700, color: 'var(--color-primary)', marginBottom: 'var(--space-6)'}}>฿{total.toLocaleString()}</div>
    <div style={{
      padding: 'var(--space-8)', background: 'var(--color-surface-2)', borderRadius: 'var(--radius-lg)',
      border: '2px dashed var(--color-border-strong)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3)',
    }}>
      <div style={{
        width: 60, height: 60, borderRadius: 999,
        background: 'var(--color-info-50)', color: 'var(--color-info)',
        display: 'grid', placeItems: 'center',
        animation: 'wiggle 1.4s ease-in-out infinite',
      }}>
        <Icon name="card" size={28}/>
      </div>
      <div style={{fontSize: 14, fontWeight: 600}}>กรุณาเสียบ / แตะบัตรที่เครื่อง EDC</div>
      <div style={{fontSize: 12, color: 'var(--color-text-secondary)'}}>เครื่อง EDC: SCB-A1 • พร้อมใช้งาน</div>
    </div>
    <button onClick={onSimulatePay} className="btn btn-primary btn-block btn-lg" style={{marginTop: 'var(--space-4)', minHeight: 44}}>
      <Icon name="check" size={16}/> จำลอง: รูดสำเร็จ
    </button>
    <style>{`@keyframes wiggle { 0%,100% { transform: rotate(-2deg); } 50% { transform: rotate(2deg); } }`}</style>
  </div>
);

const LineView = ({ total, onSimulatePay }: { total: number; onSimulatePay: () => void }) => {
  const [generating, setGenerating] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setGenerating(false), 420);
    return () => clearTimeout(t);
  }, []);
  return (
    <div style={{textAlign: 'center'}}>
      <div style={{fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 'var(--space-1)'}}>ยอดที่ต้องชำระ</div>
      <div className="num" style={{fontSize: 36, fontWeight: 700, color: 'var(--color-primary)', marginBottom: 'var(--space-6)'}}>฿{total.toLocaleString()}</div>
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
        {generating ? 'กำลังสร้าง QR...' : 'สแกนเพื่อชำระผ่าน LINE Pay'}
      </div>
      <button onClick={onSimulatePay} disabled={generating} className="btn btn-primary btn-block btn-lg" style={{marginTop: 'var(--space-4)', minHeight: 44, opacity: generating ? 0.5 : 1}}>
        <Icon name="check" size={16}/> จำลอง: ชำระสำเร็จ
      </button>
    </div>
  );
};

/**
 * Processing beat between "confirm" and the success state. Short, calm, and
 * announced via aria-busy on the dialog. No bouncy motion — the cashier is
 * mid-flow and just needs confirmation the tap registered.
 */
const ProcessingView = ({ total }: { total: number }) => (
  <div style={{textAlign: 'center', padding: 'var(--space-5) 0'}}>
    <div style={{
      width: 72, height: 72, margin: '0 auto var(--space-4)', borderRadius: 999,
      background: 'var(--color-surface-2)', color: 'var(--color-primary)',
      display: 'grid', placeItems: 'center',
    }}>
      <span className="spinner" style={{width: 26, height: 26, borderWidth: 3}} aria-hidden />
    </div>
    <div style={{fontSize: 18, fontWeight: 700, marginBottom: 'var(--space-1)'}}>กำลังดำเนินการ...</div>
    <div className="num" style={{fontSize: 32, fontWeight: 700, color: 'var(--color-primary)'}}>฿{total.toLocaleString()}</div>
  </div>
);

const SuccessView = ({ total }: { total: number }) => {
  // Rare, satisfying moment → a gentle fade-rise on the whole panel + an
  // ease-out scale on the checkmark. No infinite/bouncy loops.
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
      <div style={{fontSize: 20, fontWeight: 700, marginBottom: 'var(--space-1)'}}>ชำระเงินสำเร็จ</div>
      <div className="num" style={{fontSize: 32, fontWeight: 700, color: 'var(--color-primary)', marginBottom: 'var(--space-2)'}}>฿{total.toLocaleString()}</div>
      <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)', fontSize: 13, color: 'var(--color-text-secondary)'}}>
        <span className="spinner" style={{width: 14, height: 14}} aria-hidden />
        กำลังพิมพ์ใบเสร็จ และส่งไปยังครัว...
      </div>
      <style>{`@keyframes pay-pop { 0% { transform: scale(0.9); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }`}</style>
    </div>
  );
};
