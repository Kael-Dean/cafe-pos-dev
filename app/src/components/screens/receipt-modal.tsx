'use client';

import { useState, useCallback } from 'react';
import Icon from '../icons';
import { bahtText } from '@/lib/baht-text';

export interface ReceiptItem {
  name: string;
  qty: number;
  unitPrice: number;
  mods?: string[];
}

export interface ReceiptData {
  orderNumber: string;
  items: ReceiptItem[];
  subtotal: number;
  total: number;
  paymentMethod: string;
  paymentLabel: string;
  cashGiven?: number;
  // ── Membership (server-computed; present when a member was attached) ──
  discount?: number;
  memberName?: string;
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
}

export const DEFAULT_STORE: StoreInfo = {
  name: 'ร้านตะวันอ้อมข้าว',
  address: '123 ถ.ราชดำเนิน ต.ในเมือง อ.เมืองสุรินทร์ จ.สุรินทร์ 32000',
  taxId: '0105544000001',
  branch: 'สาขาที่ 00001',
  phone: '044-511-234',
};

export default function ReceiptModal({ data, onClose, onPrint }: Props) {
  const [isPrinting, setIsPrinting] = useState(false);

  const now = new Date();
  const buddhistYear = now.getFullYear() + 543;
  const invoiceNo = `IV${buddhistYear}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(data.orderNumber).padStart(4, '0')}`;
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
          .receipt-print-root .receipt-paper { box-shadow: none !important; border: none !important; margin: 0 !important; border-radius: 0 !important; max-height: none !important; overflow: visible !important; }
        }
      `}</style>

      <div
        className="receipt-print-root"
        style={{
          position: 'fixed', inset: 0, zIndex: 300,
          background: 'rgba(20, 12, 6, 0.75)',
          backdropFilter: 'blur(6px)',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
          padding: '20px 16px 40px',
          overflowY: 'auto',
        }}
        onClick={onClose}
      >
        <div
          className="receipt-modal-shell"
          onClick={e => e.stopPropagation()}
          style={{
            width: '100%', maxWidth: 460,
            background: 'var(--color-surface)',
            borderRadius: 20,
            boxShadow: '0 32px 80px rgba(61,40,23,0.28), 0 8px 24px rgba(61,40,23,0.14)',
            display: 'flex', flexDirection: 'column',
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
            <button onClick={onClose} style={{
              width: 30, height: 30, borderRadius: 6, display: 'grid', placeItems: 'center',
              color: 'var(--color-text-secondary)',
            }}>
              <Icon name="x" size={15} />
            </button>
          </div>

          {/* ── Receipt preview ── */}
          <div style={{ padding: '20px', overflowY: 'auto', maxHeight: '68vh', background: '#EFE9E0' }}>
            <ReceiptPaper
              data={data}
              invoiceNo={invoiceNo} now={now}
              fmt={fmt} formatDate={formatDate} formatTime={formatTime}
              storeInfo={DEFAULT_STORE}
            />
          </div>

          {/* ── Footer actions ── */}
          <div className="receipt-no-print" style={{
            padding: '12px 20px', borderTop: '1px solid var(--color-border)',
            display: 'flex', gap: 8, alignItems: 'center',
          }}>
            <button onClick={handleBrowserPrint} style={{
              padding: '8px 14px', borderRadius: 8, fontSize: 13,
              border: '1px solid var(--color-border)',
              display: 'flex', alignItems: 'center', gap: 6,
              color: 'var(--color-text-secondary)',
            }}>
              <Icon name="print" size={14} /> บันทึก PDF
            </button>
            <div style={{ flex: 1 }} />
            <button onClick={onClose} style={{
              padding: '8px 16px', borderRadius: 8, fontSize: 13,
              color: 'var(--color-text-secondary)',
            }}>ปิด</button>
            <button onClick={handlePrint} disabled={isPrinting} style={{
              padding: '9px 22px', borderRadius: 8, fontSize: 14, fontWeight: 700,
              background: isPrinting ? 'var(--color-border)' : 'var(--color-primary)',
              color: 'white', display: 'flex', alignItems: 'center', gap: 8,
              opacity: isPrinting ? 0.7 : 1,
            }}>
              <Icon name="printer" size={16} />
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
  return <div aria-hidden style={{ borderTop: '1px dashed #B6A992', margin: '8px 0' }} />;
}

function TRow({ l, r, bold, muted, indent }: {
  l: React.ReactNode; r?: React.ReactNode; bold?: boolean; muted?: boolean; indent?: boolean;
}) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline',
      padding: '1px 0',
      paddingLeft: indent ? 16 : 0,
      fontWeight: bold ? 700 : 400,
      color: muted ? '#7A6E60' : '#1A1A1A',
    }}>
      <span style={{ wordBreak: 'break-word' }}>{l}</span>
      {r != null && <span style={{ ...MONO, flexShrink: 0, fontWeight: bold ? 700 : 400 }}>{r}</span>}
    </div>
  );
}

export function ReceiptPaper({ data, invoiceNo, now, fmt, storeInfo }: {
  data: ReceiptData; invoiceNo: string; now: Date;
  fmt: (n: number) => string;
  formatDate?: (d: Date) => string; formatTime?: (d: Date) => string;
  storeInfo?: StoreInfo;
}) {
  const S = { ...DEFAULT_STORE, ...storeInfo };
  const dateStr = now.toLocaleString('th-TH'); // matches the bridge's Date.toLocaleString('th-TH')

  return (
    <div className="receipt-paper" style={{
      background: '#FFFFFF',
      width: '100%', maxWidth: 340, margin: '0 auto',
      border: '1px solid #E5E0D5', borderRadius: 4,
      boxShadow: '0 6px 22px rgba(61,40,23,0.16)',
      padding: '20px 18px 24px',
      fontFamily: '"IBM Plex Sans Thai", "Sarabun", system-ui, sans-serif',
      fontSize: 12.5, lineHeight: 1.5, color: '#1A1A1A',
    }}>
      {/* ── Header (centered, like double-height storeName on the printer) ── */}
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: '0.01em' }}>{S.name}</div>
        <div style={{ marginTop: 3 }}>ใบเสร็จรับเงิน</div>
        <div style={{ color: '#7A6E60' }}>ต้นฉบับ</div>
      </div>

      <Dash />

      {/* ── Store info ── */}
      {S.address && <div>{S.address}</div>}
      {S.taxId && <div>ผู้เสียภาษี: <span style={MONO}>{S.taxId}</span></div>}
      {S.branch && <div>{S.branch}</div>}
      {S.phone && <div>โทร. {S.phone}</div>}

      <Dash />

      {/* ── Order meta ── */}
      <div>เลขที่: <span style={MONO}>{invoiceNo}</span></div>
      <div>ออเดอร์: <span style={MONO}>#{data.orderNumber}</span></div>
      <div style={{ color: '#7A6E60' }}>{dateStr}</div>
      {data.memberName && <div>ลูกค้า: {data.memberName}</div>}

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
      <div style={{ color: '#4A3B2C' }}>({bahtText(data.total)})</div>
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
