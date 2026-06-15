'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import Icon from '../icons';
import { bahtText } from '@/lib/baht-text';
import { makeInvoiceNo } from '@/lib/receipt-number';

/**
 * The preview reproduces a physical 80mm thermal slip, which is light paper
 * with dark ink in BOTH themes (it is a representation of a real printout, not
 * app chrome). These are intentionally NOT theme tokens — they stay constant so
 * the preview always reads as paper. They are tinted toward the espresso brand
 * hue rather than pure #fff / #000, per the no-pure-black/white design rule.
 */
const PAPER = '#FFFEFB';
const PAPER_TRAY = '#EFE9E0';
const PAPER_BORDER = '#E5E0D5';
const INK = '#1C140D';
const INK_MUTED = '#7A6E60';
const INK_SOFT = '#4A3B2C';
const DASH = '#B6A992';

export interface ReceiptItem {
  name: string;
  qty: number;
  unitPrice: number;
  mods?: string[];
}

export interface ReceiptData {
  orderNumber: string;
  /** Backend-generated receipt number ("เลขที่:"), printed verbatim. Falls back
   *  to a client-computed IV string only when the backend didn't supply one. */
  receiptNo?: string;
  items: ReceiptItem[];
  subtotal: number;
  total: number;
  paymentMethod: string;
  paymentLabel: string;
  cashGiven?: number;
  // ── Membership (server-computed; present when a member was attached) ──
  discount?: number;
  memberName?: string;
  salesName?: string;
  pointsEarned?: number;
  rewardRedeemed?: boolean;
}

export interface StoreInfo {
  name: string;
  address?: string;
  taxId?: string;
  branch?: string;
  phone?: string;
}

interface Props {
  data: ReceiptData;
  onClose: () => void;
  onPrint: () => Promise<void>;
  /** Original order date/time for reprinted copies; defaults to now. */
  issuedAt?: Date;
  /** Render as a duplicate ("สำเนา") instead of the original. */
  copy?: boolean;
}

export const DEFAULT_STORE: StoreInfo = {
  name: 'ร้านตะวันอ้อมข้าว',
  address: '126 หมู่ 4 ตำบลตาอ็อง อำเภอเมืองสุรินทร์ จังหวัดสุรินทร์ 32000',
  taxId: '0105544000001',
  branch: 'สาขาที่ 00001',
  phone: '044-511-234',
};

/**
 * Modal a11y: trap focus inside the dialog, close on Esc, restore focus to the
 * opener on unmount. The visual open/close stays on the existing modal-in CSS
 * animation — this only wires keyboard + focus behaviour.
 */
function useModalA11y(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const node = ref.current;

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
    // Runs once for the modal's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return ref;
}

export default function ReceiptModal({ data, onClose, onPrint, issuedAt, copy }: Props) {
  const [isPrinting, setIsPrinting] = useState(false);
  const dialogRef = useModalA11y(onClose);

  const now = issuedAt ?? new Date();
  const [invoiceNo, setInvoiceNo] = useState(
    () => data.receiptNo ?? makeInvoiceNo(String(data.orderNumber), now),
  );
  const formatDate = (d: Date) => d.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
  const formatTime = (d: Date) => d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const fmt = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const handlePrint = useCallback(async () => {
    setIsPrinting(true);
    try {
      await onPrint();
    } finally {
      setIsPrinting(false);
    }
  }, [onPrint]);

  const handleBrowserPrint = () => window.print();

  return (
    <>
      <style>{`
        @media print {
          body > *:not(.receipt-print-root) { display: none !important; }
          .receipt-print-root { position: fixed; inset: 0; display: block !important; overflow: visible; background: white; }
          .receipt-print-root .receipt-modal-shell { all: unset; display: block; }
          .receipt-print-root .receipt-no-print { display: none !important; }
          .receipt-print-root .receipt-scroll { max-height: none !important; overflow: visible !important; padding: 0 !important; background: white !important; }
          .receipt-print-root .receipt-paper { box-shadow: none !important; border: none !important; margin: 0 !important; border-radius: 0 !important; max-height: none !important; overflow: visible !important; }
          .receipt-print-root .receipt-invoice-input { border: none !important; padding: 0 !important; background: transparent !important; }
        }
      `}</style>

      <div
        className="receipt-print-root"
        style={{
          position: 'fixed', inset: 0, zIndex: 300,
          background: 'var(--color-scrim, rgba(26, 16, 8, 0.55))',
          backdropFilter: 'blur(6px)',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
          padding: 'var(--space-5) var(--space-4) var(--space-10)',
          overflowY: 'auto',
        }}
        onClick={onClose}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={copy ? 'สำเนาใบเสร็จรับเงิน' : 'ใบเสร็จรับเงิน'}
          aria-busy={isPrinting || undefined}
          className="receipt-modal-shell"
          onClick={e => e.stopPropagation()}
          style={{
            width: '100%', maxWidth: 460,
            maxHeight: 'calc(100dvh - var(--space-5) - var(--space-10))',
            background: 'var(--color-surface)',
            borderRadius: 'var(--radius-xl)',
            boxShadow: 'var(--shadow-lg)',
            display: 'flex', flexDirection: 'column', minHeight: 0,
            animation: 'modal-in var(--dur-slow) var(--ease-out)',
          }}
        >
          {/* ── Toolbar ── */}
          <div className="receipt-no-print" style={{
            padding: '14px 20px',
            display: 'flex', alignItems: 'center', gap: 10,
            borderBottom: '1px solid var(--color-border)',
          }}>
            <div style={{
              width: 34, height: 34, borderRadius: 8, flexShrink: 0,
              background: 'var(--color-primary-50)', color: 'var(--color-primary)',
              display: 'grid', placeItems: 'center',
            }}>
              <Icon name="printer" size={17} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>ใบเสร็จรับเงิน</div>
              <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                ออเดอร์ #{data.orderNumber} · {formatDate(now)} {formatTime(now)}
              </div>
            </div>
            <button onClick={onClose} aria-label="ปิด" className="icon-btn hit-44" style={{
              width: 30, height: 30, borderRadius: 6, display: 'grid', placeItems: 'center',
              color: 'var(--color-text-secondary)',
            }}>
              <Icon name="x" size={15} />
            </button>
          </div>

          {/* ── Receipt preview (tinted paper tray; stays light in both themes) ── */}
          <div className="receipt-scroll" style={{ padding: 'var(--space-5)', overflowY: 'auto', flex: 1, minHeight: 0, background: PAPER_TRAY }}>
            <ReceiptPaper
              data={data}
              invoiceNo={invoiceNo} now={now} copy={copy}
              editable={copy} onInvoiceNoChange={setInvoiceNo}
              fmt={fmt} formatDate={formatDate} formatTime={formatTime}
              storeInfo={DEFAULT_STORE}
            />
          </div>

          {/* ── Footer actions ── */}
          <div className="receipt-no-print" style={{
            padding: 'var(--space-3) var(--space-5)', borderTop: '1px solid var(--color-border)',
            display: 'flex', gap: 'var(--space-2)', alignItems: 'center',
          }}>
            <button onClick={handleBrowserPrint} disabled={isPrinting} className="icon-btn pressable" style={{
              padding: 'var(--space-2) var(--space-4)', borderRadius: 'var(--radius-md)', fontSize: 13, minHeight: 44,
              border: '1px solid var(--color-border)',
              display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
              color: 'var(--color-text-secondary)',
              opacity: isPrinting ? 0.5 : 1,
            }}>
              <Icon name="print" size={14} /> บันทึก PDF
            </button>
            <div style={{ flex: 1 }} />
            <button onClick={onClose} className="icon-btn" style={{
              padding: 'var(--space-2) var(--space-4)', borderRadius: 'var(--radius-md)', fontSize: 13, minHeight: 44,
              color: 'var(--color-text-secondary)',
            }}>ปิด</button>
            <button onClick={handlePrint} disabled={isPrinting} aria-busy={isPrinting || undefined} className="pressable" style={{
              padding: '9px 22px', borderRadius: 'var(--radius-md)', fontSize: 14, fontWeight: 700, minHeight: 44,
              background: isPrinting ? 'var(--color-surface-2)' : 'var(--color-primary)',
              color: isPrinting ? 'var(--color-text-secondary)' : 'var(--color-text-inverse)',
              display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
              opacity: isPrinting ? 0.85 : 1,
              cursor: isPrinting ? 'wait' : 'pointer',
            }}>
              {isPrinting ? <span className="spinner" aria-hidden /> : <Icon name="printer" size={16} />}
              {isPrinting ? 'กำลังพิมพ์...' : 'พิมพ์ใบเสร็จ'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/* ─── Faithful thermal-receipt preview ──────────────────────────────
   Mirrors bridge/server.mjs buildESCPOS() line-for-line so the on-screen
   preview matches the actual 80mm printout: centered header, dashed
   dividers, left-aligned info, right-aligned amounts, Thai baht text. */

const MONO: React.CSSProperties = {
  fontFamily: '"Courier New", ui-monospace, monospace',
  fontVariantNumeric: 'tabular-nums',
};

function Dash() {
  return <div aria-hidden style={{ borderTop: `1px dashed ${DASH}`, margin: '8px 0' }} />;
}

/** Paper-red for the "สำเนา" copy mark; fixed so it reads on the light slip in both themes. */
const PAPER_COPY = '#B83A3A';

function TRow({ l, r, bold, muted, indent }: {
  l: React.ReactNode; r?: React.ReactNode; bold?: boolean; muted?: boolean; indent?: boolean;
}) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline',
      padding: '1px 0',
      paddingLeft: indent ? 16 : 0,
      fontWeight: bold ? 700 : 400,
      color: muted ? INK_MUTED : INK,
    }}>
      <span style={{ wordBreak: 'break-word' }}>{l}</span>
      {r != null && <span style={{ ...MONO, flexShrink: 0, fontWeight: bold ? 700 : 400 }}>{r}</span>}
    </div>
  );
}

export function ReceiptPaper({ data, invoiceNo, now, copy, editable, onInvoiceNoChange, fmt, storeInfo }: {
  data: ReceiptData; invoiceNo: string; now: Date; copy?: boolean;
  /** When true, the "เลขที่:" line becomes an editable input (frontend-only). */
  editable?: boolean;
  onInvoiceNoChange?: (v: string) => void;
  fmt: (n: number) => string;
  formatDate?: (d: Date) => string; formatTime?: (d: Date) => string;
  storeInfo?: StoreInfo;
}) {
  const S = { ...DEFAULT_STORE, ...storeInfo };
  const dateStr = now.toLocaleString('th-TH'); // matches the bridge's Date.toLocaleString('th-TH')

  return (
    <div className="receipt-paper" style={{
      background: PAPER,
      width: '100%', maxWidth: 340, margin: '0 auto',
      border: `1px solid ${PAPER_BORDER}`, borderRadius: 4,
      boxShadow: '0 6px 22px rgba(61,40,23,0.16)',
      padding: '20px 18px 24px',
      fontFamily: '"IBM Plex Sans Thai", "Sarabun", system-ui, sans-serif',
      fontSize: 12.5, lineHeight: 1.5, color: INK,
    }}>
      {/* ── Header (centered, like double-height storeName on the printer) ── */}
      <div style={{ textAlign: 'center' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo.svg"
          alt=""
          style={{ height: 64, width: 'auto', margin: '0 auto 8px', display: 'block' }}
        />
        <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: '0.01em' }}>{S.name}</div>
        <div style={{ marginTop: 3 }}>ใบเสร็จรับเงิน</div>
        {copy && <div style={{ color: PAPER_COPY, fontWeight: 700 }}>สำเนา</div>}
      </div>

      <Dash />

      {/* ── Store info ── */}
      {S.address && <div>{S.address}</div>}
      {S.taxId && <div>ผู้เสียภาษี: <span style={MONO}>{S.taxId}</span></div>}
      {S.branch && <div>{S.branch}</div>}
      {S.phone && <div>โทร. {S.phone}</div>}

      <Dash />

      {/* ── Order meta ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span>เลขที่:</span>
        {editable ? (
          <input
            className="receipt-invoice-input"
            value={invoiceNo}
            onChange={e => onInvoiceNoChange?.(e.target.value)}
            aria-label="แก้เลขที่ใบเสร็จ"
            spellCheck={false}
            style={{
              ...MONO, flex: 1, minWidth: 0, color: INK,
              padding: '1px 5px', borderRadius: 4,
              border: `1px solid ${DASH}`, background: PAPER,
              fontSize: 'inherit', lineHeight: 'inherit',
            }}
          />
        ) : (
          <span style={MONO}>{invoiceNo}</span>
        )}
      </div>
      <div>ออเดอร์: <span style={MONO}>#{data.orderNumber}</span></div>
      <div style={{ color: INK_MUTED }}>{dateStr}</div>
      {data.memberName && <div>ลูกค้า: {data.memberName}</div>}
      {data.salesName && <div>เซลล์: {data.salesName}</div>}

      <Dash />

      {/* ── Items ── */}
      <TRow l="รายการ" r="จำนวนเงิน" muted />
      <Dash />
      {data.items.map((item, i) => (
        <div key={i} style={{ padding: '2px 0' }}>
          <TRow l={item.name} r={fmt(item.qty * item.unitPrice)} />
          <TRow indent muted l={`${item.qty} x ${fmt(item.unitPrice)}`} />
          {item.mods?.map((mod, j) => (
            <TRow key={j} indent muted l={`+ ${mod}`} />
          ))}
        </div>
      ))}

      <Dash />

      {/* ── Summary ── */}
      <TRow bold l="รวมทั้งสิ้น (บาท)" r={fmt(data.total)} />
      <div style={{ color: INK_SOFT }}>({bahtText(data.total)})</div>
      <div>ชำระ: {data.paymentLabel}</div>
      {data.cashGiven != null && (
        <>
          <TRow l="รับเงิน" r={fmt(data.cashGiven)} />
          <TRow l="เงินทอน" r={fmt(data.cashGiven - data.total)} />
        </>
      )}

      <Dash />

      {/* ── Footer (centered) ── */}
      <div style={{ textAlign: 'center', marginTop: 4 }}>ลงชื่อผู้รับเงิน ......................</div>
      <div style={{ height: 10 }} />
      <div style={{ textAlign: 'center' }}>ขอบคุณที่ใช้บริการ</div>
    </div>
  );
}
