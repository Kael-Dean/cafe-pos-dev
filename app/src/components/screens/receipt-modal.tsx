'use client';

import { useState, useCallback } from 'react';
import Icon from '../icons';

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
  vat: number;
  total: number;
  paymentMethod: string;
  paymentLabel: string;
  cashGiven?: number;
}

export interface BuyerInfo {
  name: string;
  address: string;
  taxId: string;
  branch: string;
}

interface Props {
  data: ReceiptData;
  onClose: () => void;
  onPrint: (args: { buyerInfo?: BuyerInfo }) => Promise<void>;
}

const STORE = {
  name: 'ร้านตะวันอ้อมข้าว',
  address: '123 ถ.ราชดำเนิน ต.ในเมือง อ.เมืองสุรินทร์ จ.สุรินทร์ 32000',
  taxId: '0105544000001',
  branch: 'สาขาที่ 00001',
  phone: '044-511-234',
};

export default function ReceiptModal({ data, onClose, onPrint }: Props) {
  const [wantTax, setWantTax] = useState(false);
  const [buyer, setBuyer] = useState<BuyerInfo>({ name: '', address: '', taxId: '', branch: 'สำนักงานใหญ่' });
  const [step, setStep] = useState<'preview' | 'tax_form'>('preview');
  const [isPrinting, setIsPrinting] = useState(false);

  const now = new Date();
  const buddhistYear = now.getFullYear() + 543;
  const invoiceNo = `IV${buddhistYear}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(data.orderNumber).padStart(4, '0')}`;
  const formatDate = (d: Date) => d.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
  const formatTime = (d: Date) => d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const fmt = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const showBuyer = wantTax && buyer.name.trim().length > 0;

  const handlePrint = useCallback(async () => {
    setIsPrinting(true);
    try {
      await onPrint({ buyerInfo: showBuyer ? buyer : undefined });
    } finally {
      setIsPrinting(false);
    }
  }, [onPrint, showBuyer, buyer]);

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
            width: '100%', maxWidth: 660,
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
              <div style={{ fontSize: 14, fontWeight: 700 }}>
                {wantTax ? 'ใบเสร็จรับเงิน / ใบกำกับภาษี' : 'ใบเสร็จรับเงิน'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                ออเดอร์ #{data.orderNumber} · {formatDate(now)} {formatTime(now)}
              </div>
            </div>
            <label style={{
              display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
              padding: '6px 12px', borderRadius: 8, border: '1px solid',
              borderColor: wantTax ? 'var(--color-accent)' : 'var(--color-border)',
              background: wantTax ? 'var(--color-accent-50)' : 'transparent',
              fontSize: 13, fontWeight: wantTax ? 600 : 400,
              color: wantTax ? 'var(--color-primary)' : 'var(--color-text-secondary)',
              transition: 'all 150ms', userSelect: 'none',
            }}>
              <input
                type="checkbox" checked={wantTax}
                onChange={e => {
                  setWantTax(e.target.checked);
                  setStep(e.target.checked ? 'tax_form' : 'preview');
                }}
                style={{ accentColor: 'var(--color-accent)', cursor: 'pointer' }}
              />
              ขอใบกำกับภาษี
            </label>
            <button onClick={onClose} style={{
              width: 30, height: 30, borderRadius: 6, display: 'grid', placeItems: 'center',
              color: 'var(--color-text-secondary)',
            }}>
              <Icon name="x" size={15} />
            </button>
          </div>

          {/* ── Buyer info form ── */}
          {step === 'tax_form' && (
            <div className="receipt-no-print" style={{ padding: '20px', borderBottom: '1px solid var(--color-border)' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-primary)', marginBottom: 14 }}>
                ข้อมูลผู้ซื้อ / ผู้รับใบกำกับภาษี
              </div>
              <div style={{ display: 'grid', gap: 10 }}>
                <BuyerField label="ชื่อ / บริษัท *" value={buyer.name} onChange={v => setBuyer(p => ({ ...p, name: v }))} />
                <BuyerField label="ที่อยู่" value={buyer.address} onChange={v => setBuyer(p => ({ ...p, address: v }))} />
                <BuyerField label="เลขที่ผู้เสียภาษี 13 หลัก" value={buyer.taxId} onChange={v => setBuyer(p => ({ ...p, taxId: v }))} mono />
                <div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 6 }}>ประเภทสาขา</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {['สำนักงานใหญ่', 'สาขา'].map(b => (
                      <button key={b} onClick={() => setBuyer(p => ({ ...p, branch: b }))} style={{
                        flex: 1, padding: '8px', borderRadius: 6, fontSize: 13, border: '1px solid',
                        borderColor: buyer.branch === b ? 'var(--color-accent)' : 'var(--color-border)',
                        background: buyer.branch === b ? 'var(--color-accent-50)' : 'transparent',
                        fontWeight: buyer.branch === b ? 600 : 400,
                        color: buyer.branch === b ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                      }}>{b}</button>
                    ))}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                <button onClick={() => setStep('preview')} style={{
                  flex: 1, padding: '10px', borderRadius: 8, fontSize: 13,
                  border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)',
                }}>ข้าม</button>
                <button onClick={() => setStep('preview')} disabled={!buyer.name.trim()} style={{
                  flex: 2, padding: '10px', borderRadius: 8, fontSize: 14, fontWeight: 700,
                  background: buyer.name.trim() ? 'var(--color-primary)' : 'var(--color-border)',
                  color: 'white',
                }}>ดูตัวอย่างใบเสร็จ →</button>
              </div>
            </div>
          )}

          {/* ── Receipt preview ── */}
          {step === 'preview' && (
            <div style={{ padding: '20px', overflowY: 'auto', maxHeight: '68vh' }}>
              <ReceiptPaper
                data={data} buyer={showBuyer ? buyer : undefined}
                invoiceNo={invoiceNo} now={now}
                fmt={fmt} formatDate={formatDate} formatTime={formatTime}
              />
            </div>
          )}

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

/* ─── Sub-components ─────────────────────────────────────────────── */

function BuyerField({ label, value, onChange, mono }: {
  label: string; value: string; onChange: (v: string) => void; mono?: boolean;
}) {
  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 4 }}>{label}</div>
      <input
        value={value} onChange={e => onChange(e.target.value)}
        style={{
          width: '100%', padding: '9px 12px', borderRadius: 6, fontSize: 13,
          border: '1px solid var(--color-border)', background: 'var(--color-surface-2)',
          fontFamily: mono ? '"Courier New", monospace' : 'inherit',
          outline: 'none', letterSpacing: mono ? '0.05em' : undefined,
        }}
        onFocus={e => (e.currentTarget.style.borderColor = 'var(--color-accent)')}
        onBlur={e => (e.currentTarget.style.borderColor = 'var(--color-border)')}
      />
    </div>
  );
}

function ReceiptPaper({ data, buyer, invoiceNo, now, fmt, formatDate, formatTime }: {
  data: ReceiptData; buyer?: BuyerInfo; invoiceNo: string; now: Date;
  fmt: (n: number) => string;
  formatDate: (d: Date) => string; formatTime: (d: Date) => string;
}) {
  const mono: React.CSSProperties = { fontFamily: '"Courier New", monospace' };
  const label: React.CSSProperties = { fontSize: 10, color: '#8A7B6E', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 };
  const val: React.CSSProperties = { fontSize: 12, fontWeight: 500, color: '#1A1A1A' };

  return (
    <div className="receipt-paper" style={{
      background: '#FFFFFF',
      border: '1px solid #DDD5C8',
      borderRadius: 10,
      overflow: 'hidden',
      fontFamily: '"IBM Plex Sans Thai", "Sarabun", sans-serif',
      boxShadow: '0 4px 16px rgba(61,40,23,0.08)',
    }}>
      {/* ─── Dark header band ─── */}
      <div style={{
        background: 'linear-gradient(135deg, #3D2817 0%, #5A3A22 100%)',
        padding: '18px 20px 14px',
        textAlign: 'center', position: 'relative',
      }}>
        <div style={{ color: '#D4A574', fontSize: 10, letterSpacing: '0.2em', marginBottom: 6 }}>ต้นฉบับ · ORIGINAL</div>
        <div style={{ color: '#FFFFFF', fontSize: 18, fontWeight: 800, letterSpacing: '0.01em' }}>{STORE.name}</div>
        <div style={{
          display: 'inline-block', marginTop: 6,
          background: 'rgba(255,255,255,0.12)',
          color: '#F0E4D4', fontSize: 11, fontWeight: 500,
          padding: '3px 12px', borderRadius: 4, letterSpacing: '0.04em',
        }}>
          {buyer ? 'ใบเสร็จรับเงิน / ใบกำกับภาษี' : 'ใบเสร็จรับเงิน'}
        </div>
      </div>

      {/* ─── Parties: Seller | Buyer ─── */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1px 1fr',
        borderBottom: '2px solid #3D2817',
      }}>
        {/* Seller */}
        <div style={{ padding: '14px 16px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#3D2817', letterSpacing: '0.1em', marginBottom: 8 }}>ผู้ขาย (SELLER)</div>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4, color: '#1A1A1A' }}>{STORE.name}</div>
          <div style={{ fontSize: 11, color: '#5A5249', lineHeight: 1.65 }}>{STORE.address}</div>
          <div style={{ fontSize: 11, color: '#5A5249', marginTop: 6 }}>
            <span style={{ color: '#8A7B6E' }}>เลขที่ผู้เสียภาษี:</span>{' '}
            <span style={{ ...mono, fontSize: 11 }}>{STORE.taxId}</span>
          </div>
          <div style={{ fontSize: 11, color: '#5A5249' }}>{STORE.branch}</div>
          {STORE.phone && <div style={{ fontSize: 11, color: '#5A5249' }}>โทร. {STORE.phone}</div>}
        </div>

        {/* Vertical divider */}
        <div style={{ background: '#DDD5C8' }} />

        {/* Buyer */}
        <div style={{ padding: '14px 16px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#3D2817', letterSpacing: '0.1em', marginBottom: 8 }}>ผู้ซื้อ (BUYER)</div>
          {buyer ? (
            <>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4, color: '#1A1A1A' }}>{buyer.name}</div>
              {buyer.address && <div style={{ fontSize: 11, color: '#5A5249', lineHeight: 1.65 }}>{buyer.address}</div>}
              {buyer.taxId && (
                <div style={{ fontSize: 11, color: '#5A5249', marginTop: 6 }}>
                  <span style={{ color: '#8A7B6E' }}>เลขที่ผู้เสียภาษี:</span>{' '}
                  <span style={{ ...mono, fontSize: 11 }}>{buyer.taxId}</span>
                </div>
              )}
              <div style={{ fontSize: 11, color: '#5A5249' }}>{buyer.branch}</div>
            </>
          ) : (
            <div style={{ fontSize: 12, color: '#B0A499', fontStyle: 'italic', marginTop: 4 }}>ลูกค้าทั่วไป</div>
          )}
        </div>
      </div>

      {/* ─── Meta row ─── */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
        background: '#FAF7F2', borderBottom: '1px solid #DDD5C8',
        padding: '10px 16px', gap: 8,
      }}>
        <div>
          <div style={label}>เลขที่ใบเสร็จ</div>
          <div style={{ ...val, ...mono, fontSize: 11 }}>{invoiceNo}</div>
        </div>
        <div>
          <div style={label}>วันที่ออกใบเสร็จ</div>
          <div style={val}>{formatDate(now)}</div>
        </div>
        <div>
          <div style={label}>เวลา / ออเดอร์</div>
          <div style={val}>{formatTime(now)} · #{data.orderNumber}</div>
        </div>
      </div>

      {/* ─── Items table ─── */}
      <div style={{ padding: '0 16px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #3D2817' }}>
              {['รายการสินค้า', 'จำนวน', 'ราคา/หน่วย', 'จำนวนเงิน'].map((h, i) => (
                <th key={h} style={{
                  padding: '9px 0', fontSize: 10, fontWeight: 700,
                  color: '#3D2817', letterSpacing: '0.05em',
                  textAlign: i === 0 ? 'left' : 'right',
                  width: i === 0 ? 'auto' : i === 1 ? 44 : 88,
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.items.map((item, i) => (
              <ItemRows key={i} item={item} fmt={fmt} isLast={i === data.items.length - 1} />
            ))}
          </tbody>
        </table>
      </div>

      {/* ─── Summary ─── */}
      <div style={{ margin: '0 16px', borderTop: '2px solid #3D2817', padding: '12px 0 10px' }}>
        <SumRow label="มูลค่าก่อนภาษีมูลค่าเพิ่ม" value={fmt(data.subtotal)} fmt={fmt} />
        <SumRow label={`ภาษีมูลค่าเพิ่ม 7%`} value={fmt(data.vat)} fmt={fmt} />
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          borderTop: '1px solid #DDD5C8', marginTop: 6, paddingTop: 8,
        }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#3D2817' }}>รวมเป็นเงิน (บาท)</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#3D2817', fontFamily: '"Courier New", monospace' }}>
            ฿{fmt(data.total)}
          </div>
        </div>
        <div style={{
          marginTop: 8, fontSize: 12,
          display: 'flex', justifyContent: 'space-between',
        }}>
          <span style={{ color: '#8A7B6E' }}>ชำระโดย</span>
          <span style={{ fontWeight: 600, color: '#3D2817' }}>{data.paymentLabel}</span>
        </div>
        {data.paymentMethod === 'cash' && data.cashGiven != null && (
          <>
            <SumRow label="รับเงินสด" value={fmt(data.cashGiven)} fmt={fmt} small />
            <SumRow label="เงินทอน" value={fmt(data.cashGiven - data.total)} fmt={fmt} small accent />
          </>
        )}
      </div>

      {/* ─── Signature footer ─── */}
      <div style={{
        background: '#FAF7F2', borderTop: '1px solid #DDD5C8',
        display: 'grid', gridTemplateColumns: '1fr 1px 1fr', padding: '0 16px',
      }}>
        <SignBox label="ลงชื่อผู้รับเงิน" sublabel="(Cashier)" />
        <div style={{ background: '#DDD5C8' }} />
        <SignBox label="ลงชื่อผู้จ่ายเงิน" sublabel="(Customer)" />
      </div>

      <div style={{
        padding: '10px 16px', textAlign: 'center',
        fontSize: 11, color: '#B0A499', borderTop: '1px solid #DDD5C8',
        background: '#FCFAF7',
      }}>
        ขอบคุณที่ใช้บริการ 🙏 &nbsp;·&nbsp; วันที่พิมพ์ {formatDate(now)} เวลา {formatTime(now)}
      </div>
    </div>
  );
}

function ItemRows({ item, fmt, isLast }: {
  item: ReceiptItem; fmt: (n: number) => string; isLast: boolean;
}) {
  const mono: React.CSSProperties = { fontFamily: '"Courier New", monospace' };
  return (
    <>
      <tr style={{ borderBottom: isLast ? 'none' : '1px solid #F0EBE4' }}>
        <td style={{ padding: '9px 0', fontSize: 13 }}>{item.name}</td>
        <td style={{ padding: '9px 0', textAlign: 'right', ...mono }}>{item.qty}</td>
        <td style={{ padding: '9px 0', textAlign: 'right', ...mono, color: '#5A5249' }}>{fmt(item.unitPrice)}</td>
        <td style={{ padding: '9px 0', textAlign: 'right', ...mono, fontWeight: 600 }}>{fmt(item.qty * item.unitPrice)}</td>
      </tr>
      {item.mods?.map((mod, j) => (
        <tr key={j}>
          <td colSpan={4} style={{ padding: '2px 0 5px 12px', fontSize: 11, color: '#8A7B6E' }}>+ {mod}</td>
        </tr>
      ))}
    </>
  );
}

function SumRow({ label, value, small, accent }: {
  label: string; value: string; fmt: (n: number) => string; small?: boolean; accent?: boolean;
}) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: `${small ? 2 : 4}px 0`,
    }}>
      <div style={{ fontSize: small ? 12 : 13, color: '#5A5249' }}>{label}</div>
      <div style={{
        fontSize: small ? 12 : 13, fontFamily: '"Courier New", monospace',
        color: accent ? 'var(--color-success)' : '#1A1A1A', fontWeight: accent ? 600 : 400,
      }}>{value}</div>
    </div>
  );
}

function SignBox({ label, sublabel }: { label: string; sublabel: string }) {
  return (
    <div style={{ padding: '14px 8px 12px' }}>
      <div style={{ fontSize: 10, color: '#8A7B6E', marginBottom: 28 }}>{label}</div>
      <div style={{ borderTop: '1px solid #CCC', paddingTop: 4, textAlign: 'center', fontSize: 10, color: '#B0A499' }}>{sublabel}</div>
    </div>
  );
}
