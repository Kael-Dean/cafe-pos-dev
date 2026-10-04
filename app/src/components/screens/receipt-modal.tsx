'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../icons';
import { Banner, Button, IconButton, Input, Modal } from '@/components/ui';
import { bahtText } from '@/lib/baht-text';
import { makeInvoiceNo } from '@/lib/receipt-number';
import { useI18n } from '@/lib/i18n';
import { useCurrentUser, isAdmin } from '@/hooks/use-current-user';
import { useAutoPrintPref, printerPaired, shouldAutoPrint } from './payment/auto-print';
import s from './payment/receipt.module.css';

/**
 * The preview reproduces a physical 80mm thermal slip, which is light paper
 * with dark ink in BOTH themes (it is a representation of a real printout, not
 * app chrome). These are intentionally NOT theme tokens — they stay constant so
 * the preview always reads as paper. They are tinted toward the espresso brand
 * hue rather than pure #fff / #000, per the no-pure-black/white design rule.
 */
const PAPER = '#FFFEFB';
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
  /** Per-line discount breakdown (promotions + member reward), shown above the
   *  total. Amounts are the cashier-side estimate; the total uses the server's
   *  authoritative `discount`. Normally they agree. */
  discountLines?: { label: string; amount: number }[];
  memberName?: string;
  salesName?: string;
  pointsEarned?: number;
  /** Points spent on a redemption this bill (= program.points_to_redeem). Earn
   *  and redeem are mutually exclusive per order, so at most one of
   *  pointsEarned / pointsRedeemed is non-zero. */
  pointsRedeemed?: number;
  /** What was redeemed (e.g. free-item product name), shown next to the spend. */
  rewardLabel?: string;
  /** Member's point balance AFTER this bill posted (client-computed:
   *  balanceBefore + earned − redeemed). */
  pointsBalanceAfter?: number;
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
  /** Reverts the sale (stock + money) via the order-cancel flow. Shown to managers only. */
  onCancel?: () => void;
  /** Backdates the order on the server ("YYYY-MM-DD"; resolves once persisted). Managers only. */
  onSaveDate?: (businessDateISO: string) => Promise<void>;
  /**
   * `sale` (just paid): primary is "ออเดอร์ถัดไป" and the device auto-print setting
   * applies. `reprint` (receipt copies): primary is "ปิด", never auto-prints.
   * Default: `reprint` when `copy` or `onCancel` is given (the receipt-copies
   * screen), otherwise `sale` (the POS after payment).
   */
  context?: 'sale' | 'reprint';
}

type PrintState = { kind: 'idle' } | { kind: 'printing' } | { kind: 'printed' } | { kind: 'failed'; msg: string };

/** Local calendar day as "YYYY-MM-DD" (matches <input type="date">). */
function toYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Combine a "YYYY-MM-DD" day with the time-of-day from another Date. */
function combineDateTime(ymd: string, timeFrom: Date): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d, timeFrom.getHours(), timeFrom.getMinutes(), timeFrom.getSeconds());
}

export const DEFAULT_STORE: StoreInfo = {
  name: 'ร้านตะวันอ้อมข้าว',
  address: '126 หมู่ 4 ตำบลตาอ็อง อำเภอเมืองสุรินทร์ จังหวัดสุรินทร์ 32000',
  taxId: '0993000134281',
  branch: 'สาขาที่ 00001',
  phone: '062-334-5526',
};

const money = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const bahtShort = (n: number) =>
  `฿${n.toLocaleString('en-US', Number.isInteger(n) ? undefined : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function ReceiptModal({ data, onClose, onPrint, issuedAt, copy, onCancel, onSaveDate, context }: Props) {
  const { t } = useI18n();
  const { data: me } = useCurrentUser();
  const manager = isAdmin(me?.role);
  const mode = context ?? (copy || onCancel ? 'reprint' : 'sale');

  const [print, setPrint] = useState<PrintState>({ kind: 'idle' });
  const [moreOpen, setMoreOpen] = useState(false);
  const [autoPref, setAutoPref] = useAutoPrintPref();
  const [paired, setPaired] = useState(false);
  const markerRef = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  // Re-armed on mount: StrictMode runs mount → cleanup → mount in development.
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  // Fallback timestamp must be stable across re-renders — a bare new Date()
  // here would regenerate the fallback invoice no. and header date every render.
  const [mountedAt] = useState(() => new Date());
  const now = issuedAt ?? mountedAt;
  const invoiceNo = data.receiptNo ?? makeInvoiceNo(String(data.orderNumber), now);

  // ── Backdating (manager only): pick a day, persist to the server ──
  const canBackdate = manager && !!onSaveDate;
  const canCancel = manager && !!onCancel;
  const originalDate = toYMD(now);
  const [pickedDate, setPickedDate] = useState(originalDate);
  const [savingDate, setSavingDate] = useState(false);
  const shownDate = canBackdate ? combineDateTime(pickedDate, now) : now;
  const dateStr = shownDate.toLocaleString('th-TH');
  const dateChanged = canBackdate && pickedDate !== originalDate;

  const handleSaveDate = useCallback(async () => {
    if (!onSaveDate || savingDate || pickedDate === originalDate) return;
    setSavingDate(true);
    try { await onSaveDate(pickedDate); }
    catch { /* the caller surfaces the error */ }
    finally { if (alive.current) setSavingDate(false); }
  }, [onSaveDate, savingDate, pickedDate, originalDate]);

  const formatDate = (d: Date) => d.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
  const formatTime = (d: Date) => d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const printing = print.kind === 'printing';
  const handlePrint = useCallback(async () => {
    if (!alive.current) return;
    setPrint({ kind: 'printing' });
    try {
      await onPrint();
      if (alive.current) setPrint({ kind: 'printed' });
    } catch (e: unknown) {
      if (alive.current) setPrint({ kind: 'failed', msg: e instanceof Error && e.message ? e.message : t.receipt.printFailed });
    }
  }, [onPrint, t]);

  const handleBrowserPrint = () => window.print();

  // ── Auto-print once for a fresh sale (per-device setting; default = printer paired) ──
  const autoStarted = useRef(false);
  useEffect(() => {
    if (mode !== 'sale' || autoStarted.current) return;
    autoStarted.current = true;
    void shouldAutoPrint().then((yes) => { if (yes) void handlePrint(); });
  }, [mode, handlePrint]);

  // The switch shows the effective value; probe the bridge only to render the default.
  useEffect(() => {
    if (autoPref !== 'default' || !moreOpen) return;
    void printerPaired().then((p) => { if (alive.current) setPaired(p); });
  }, [autoPref, moreOpen]);
  const autoOn = autoPref === 'on' || (autoPref === 'default' && paired);

  // ── Keys (spec §4.1 "receipt"): Enter / N next order · P print. e.code → Thai layout safe.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
      const dialog = markerRef.current?.closest('[aria-modal="true"]');
      const stack = document.querySelectorAll('[aria-modal="true"]');
      if (!dialog || stack[stack.length - 1] !== dialog) return; // not topmost
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.code === 'KeyP') {
        e.preventDefault();
        if (!printing) void handlePrint();
      } else if (e.code === 'KeyN' || (e.key === 'Enter' && !target?.closest('button, a, [role="button"]'))) {
        if (e.repeat) return;
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [printing, handlePrint, onClose]);

  const change = data.cashGiven != null ? Math.max(0, data.cashGiven - data.total) : 0;
  const printLabel = printing ? t.receipt.printing : print.kind === 'printed' ? t.receipt.printed : t.receipt.print;

  return (
    <>
      <style>{PRINT_CSS}</style>
      <Modal
        open
        onClose={onClose}
        size="sm"
        closeOnBackdrop={false}
        title={copy ? t.receipt.titleCopy : t.receipt.title}
        description={t.receipt.meta(data.orderNumber, `${formatDate(shownDate)} ${formatTime(shownDate)}`)}
        className={`receipt-print-root ${s.dialog}`}
        footer={
          <div className={`receipt-no-print ${s.foot}`}>
            <Button
              variant="secondary"
              size="lg"
              onClick={() => { void handlePrint(); }}
              loading={printing}
              kbd="P"
              icon={<Icon name={print.kind === 'printed' ? 'check' : 'printer'} size={18} />}
              className={s.printBtn}
            >
              {printLabel}
            </Button>
            <IconButton
              size="lg"
              variant="outline"
              icon={<Icon name="dots" size={20} />}
              label={t.receipt.more}
              aria-expanded={moreOpen}
              aria-controls="receipt-more"
              onClick={() => setMoreOpen((o) => !o)}
            />
            <Button
              variant="primary"
              size="xl"
              fullWidth
              kbd="Enter"
              onClick={onClose}
              className={s.nextBtn}
              icon={mode === 'sale' ? <Icon name="plus" size={20} /> : undefined}
            >
              {mode === 'sale' ? t.receipt.nextOrder : t.receipt.close}
            </Button>
          </div>
        }
      >
        <div ref={markerRef} className={s.marker} aria-hidden="true" />

        {moreOpen && (
          <section id="receipt-more" className={`receipt-no-print ${s.more}`} aria-label={t.receipt.more}>
            {mode === 'sale' && (
              <label className={s.switchRow}>
                <input
                  type="checkbox"
                  role="switch"
                  className={s.switch}
                  checked={autoOn}
                  onChange={(e) => setAutoPref(e.target.checked)}
                />
                <span className={s.switchText}>
                  <span className={s.switchTitle}>{t.receipt.autoPrint}</span>
                  <span className={s.switchHint}>{t.receipt.autoPrintHint}</span>
                </span>
              </label>
            )}
            <Button variant="ghost" size="md" icon={<Icon name="print" size={18} />} onClick={handleBrowserPrint}>
              {t.receipt.browserPrint}
            </Button>

            {(canBackdate || canCancel) && (
              <div className={s.manager}>
                <p className={s.managerTitle}>{t.receipt.managerSection}</p>
                {canBackdate && (
                  <div className={s.dateRow}>
                    <Input
                      type="date"
                      label={t.receipt.backdate}
                      hint={t.receipt.backdateHint}
                      value={pickedDate}
                      max={toYMD(new Date())}
                      onChange={(e) => setPickedDate(e.target.value)}
                      className={s.dateInput}
                    />
                    <Button
                      variant="secondary"
                      size="md"
                      onClick={() => { void handleSaveDate(); }}
                      loading={savingDate}
                      disabled={!dateChanged}
                      className={s.dateSave}
                    >
                      {t.receipt.saveDate}
                    </Button>
                  </div>
                )}
                {canCancel && (
                  <Button variant="danger" size="md" icon={<Icon name="trash" size={18} />} onClick={onCancel} disabled={printing}>
                    {t.receipt.cancelBill}
                  </Button>
                )}
              </div>
            )}
          </section>
        )}

        {change > 0 && (
          <div className={`receipt-no-print ${s.change}`}>
            <span className={s.changeLabel}>{t.receipt.changeDue}</span>
            <span className={`num ${s.changeValue}`}>{bahtShort(change)}</span>
          </div>
        )}

        {print.kind === 'failed' && (
          <Banner
            tone="danger"
            icon="printer"
            live="alert"
            title={t.receipt.printFailed}
            detail={print.msg}
            className="receipt-no-print"
            action={
              <span className={s.failActions}>
                <Button size="sm" variant="secondary" onClick={() => { void handlePrint(); }}>{t.receipt.printRetry}</Button>
                <Button size="sm" variant="ghost" onClick={handleBrowserPrint}>{t.receipt.browserPrint}</Button>
              </span>
            }
          />
        )}

        {/* Receipt preview (tinted paper tray; stays light in both themes) */}
        <div className={`receipt-scroll ${s.tray}`}>
          <ReceiptPaper
            data={data}
            invoiceNo={invoiceNo} now={shownDate} copy={copy}
            dateStr={dateStr}
            fmt={money} formatDate={formatDate} formatTime={formatTime}
            storeInfo={DEFAULT_STORE}
          />
        </div>
      </Modal>
    </>
  );
}

/**
 * Print isolation. The Modal portals `.ui-overlay` straight into <body>, so every
 * other body child is hidden and the overlay is flattened down to the slip.
 */
const PRINT_CSS = `
@media print {
  body > *:not(:has(.receipt-print-root)) { display: none !important; }
  body > :has(.receipt-print-root) { position: static !important; display: block !important; padding: 0 !important; background: none !important; animation: none !important; }
  .receipt-print-root { all: unset; display: block !important; }
  .receipt-print-root > .ui-dialog__head, .receipt-print-root > .ui-dialog__foot, .receipt-print-root .receipt-no-print { display: none !important; }
  .receipt-print-root .ui-dialog__body { overflow: visible !important; padding: 0 !important; max-height: none !important; display: block !important; }
  .receipt-print-root .receipt-scroll { padding: 0 !important; background: white !important; }
  .receipt-print-root .receipt-paper { box-shadow: none !important; border: none !important; margin: 0 !important; border-radius: 0 !important; }
}
`;

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

export function ReceiptPaper({ data, invoiceNo, now, copy, dateStr, editableDate, onDateChange, fmt, storeInfo }: {
  data: ReceiptData; invoiceNo: string; now: Date; copy?: boolean;
  /** Display string for the date/time line; defaults to `now` in th-TH. */
  dateStr?: string;
  /** When true, the date line becomes an editable input (frontend-only). */
  editableDate?: boolean;
  onDateChange?: (v: string) => void;
  fmt: (n: number) => string;
  formatDate?: (d: Date) => string; formatTime?: (d: Date) => string;
  storeInfo?: StoreInfo;
}) {
  const S = { ...DEFAULT_STORE, ...storeInfo };
  const dateText = dateStr ?? now.toLocaleString('th-TH'); // matches the bridge's Date.toLocaleString('th-TH')

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
      <div>เลขที่: <span style={MONO}>{invoiceNo}</span></div>
      <div>ออเดอร์: <span style={MONO}>#{data.orderNumber}</span></div>
      {editableDate ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input
            className="receipt-edit-input"
            value={dateText}
            onChange={e => onDateChange?.(e.target.value)}
            aria-label="แก้วันที่ในใบเสร็จ"
            spellCheck={false}
            style={{
              ...MONO, flex: 1, minWidth: 0, color: INK_MUTED,
              padding: '1px 5px', borderRadius: 4,
              border: `1px solid ${DASH}`, background: PAPER,
              fontSize: 'inherit', lineHeight: 'inherit',
            }}
          />
        </div>
      ) : (
        <div style={{ color: INK_MUTED }}>{dateText}</div>
      )}
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
      {data.discount != null && data.discount > 0 && (
        <>
          <TRow l="รวม" r={fmt(data.subtotal)} />
          {data.discountLines && data.discountLines.length > 0 ? (
            data.discountLines.map((d, i) => (
              <TRow key={i} indent muted l={d.label} r={`-${fmt(d.amount)}`} />
            ))
          ) : (
            <TRow muted l="ส่วนลด" r={`-${fmt(data.discount)}`} />
          )}
        </>
      )}
      <TRow bold l="รวมทั้งสิ้น (บาท)" r={fmt(data.total)} />
      <div style={{ color: INK_SOFT }}>({bahtText(data.total)})</div>
      <div style={{ color: INK_MUTED, fontSize: 11.5 }}>ราคารวมภาษีมูลค่าเพิ่ม 7% แล้ว (VAT included)</div>
      <div>ชำระ: {data.paymentLabel}</div>
      {data.cashGiven != null && (
        <>
          <TRow l="รับเงิน" r={fmt(data.cashGiven)} />
          <TRow l="เงินทอน" r={fmt(data.cashGiven - data.total)} />
        </>
      )}

      {/* ── Membership points (earn OR redeem — mutually exclusive per bill) ── */}
      {data.memberName &&
        (((data.pointsEarned ?? 0) > 0) ||
          ((data.pointsRedeemed ?? 0) > 0) ||
          data.pointsBalanceAfter != null) && (
          <>
            <Dash />
            {(data.pointsRedeemed ?? 0) > 0 && (
              <TRow
                l={`ใช้แต้มแลก${data.rewardLabel ? `: ${data.rewardLabel}` : ''}`}
                r={`-${data.pointsRedeemed!.toLocaleString('th-TH')} แต้ม`}
              />
            )}
            {(data.pointsEarned ?? 0) > 0 && (
              <TRow l="ได้รับแต้ม" r={`+${data.pointsEarned!.toLocaleString('th-TH')} แต้ม`} />
            )}
            {data.pointsBalanceAfter != null && (
              <TRow bold l="แต้มสะสมคงเหลือ" r={`${data.pointsBalanceAfter.toLocaleString('th-TH')} แต้ม`} />
            )}
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
