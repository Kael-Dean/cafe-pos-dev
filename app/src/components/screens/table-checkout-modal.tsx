'use client';

import { useMemo, useState } from 'react';
import Icon from '../icons';
import { ModalShell, useToast } from '../app-common';
import {
  useBillPreview, useCheckoutGuest, useCloseBarTable, useFloorLive, useGuestPromptPayQr,
  usePayGuestBill, usePayTableBill, type GuestRead, type PromptPayQr,
} from '@/hooks/use-self-ordering';
import {
  describeError, guestPayTransition, initialGuestStep, isZeroAmount, type ErrorContext,
  type GuestPayStep, type PayMethod,
} from '@/lib/self-ordering';
import { bahtStr } from '@/lib/money';

const METHODS: { value: PayMethod; label: string; icon: string }[] = [
  { value: 'CASH', label: 'เงินสด', icon: 'cash' },
  { value: 'QR_PROMPTPAY', label: 'QR พร้อมเพย์', icon: 'qr' },
];

/**
 * Settle a table, in the order the API demands:
 *   preview (/bill) → per person [checkout → (QR) → pay GUEST] → rest of table [pay TABLE, force]
 *   → close.
 * Every step only advances after the server confirmed the previous one, and a failed pay
 * leaves the guest "checked out" so a retry never repeats the checkout (which would be a 409).
 * Time is never shown: at this bar `time_total` is always 0.
 */
export default function TableCheckoutModal({ sessionId, tableName, initialGuestId, onClose }: {
  sessionId: string;
  tableName: string;
  initialGuestId?: string | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const liveQ = useFloorLive(true);
  const session = useMemo(
    () => liveQ.data?.find((t) => t.session?.id === sessionId)?.session ?? null,
    [liveQ.data, sessionId],
  );

  const checkout = useCheckoutGuest();
  const getQr = useGuestPromptPayQr();
  const payGuest = usePayGuestBill();
  const payTable = usePayTableBill();
  const close = useCloseBarTable();

  const [guestId, setGuestId] = useState<string | null>(initialGuestId ?? null);
  const [method, setMethod] = useState<PayMethod>('CASH');
  const [steps, setSteps] = useState<Record<string, GuestPayStep>>({});
  const [qr, setQr] = useState<Record<string, PromptPayQr>>({});
  const [error, setError] = useState<{ text: string; ctx: ErrorContext } | null>(null);
  const [closed, setClosed] = useState(false);
  const [working, setWorking] = useState(false);

  const guests = session?.guests ?? [];
  const guest = guests.find((g) => g.id === guestId) ?? null;

  const tableBill = useBillPreview(sessionId, null, !closed);
  const guestBill = useBillPreview(sessionId, guest?.id ?? null, !!guest && !closed);

  const stepOf = (g: GuestRead): GuestPayStep => steps[g.id] ?? initialGuestStep(g.status);
  const setStep = (id: string, s: GuestPayStep) => setSteps((p) => ({ ...p, [id]: s }));

  const fail = (e: unknown, ctx: ErrorContext) => setError({ text: describeError(e, ctx), ctx });

  // ── one person ─────────────────────────────────────────────────────────────
  /** Tap 1: checkout (if still seated) → cash: pay now / QR: fetch the QR and wait for the owner. */
  const startGuest = async (g: GuestRead) => {
    if (working) return;
    setWorking(true);
    setError(null);
    try {
      let step = stepOf(g);
      if (step === 'preview') {
        await checkout.mutateAsync({ sessionId, guestId: g.id });
        step = guestPayTransition(step, 'checkout', method);
        setStep(g.id, step);
      }
      if (method === 'QR_PROMPTPAY') {
        if (step === 'checked_out') {
          let res: PromptPayQr;
          try { res = await getQr.mutateAsync({ sessionId, guestId: g.id }); }
          catch (e) { fail(e, 'qr'); return; }
          step = guestPayTransition(step, 'qr', method);
          setStep(g.id, step);
          setQr((p) => ({ ...p, [g.id]: res }));
        }
        return; // owner confirms after the customer has paid
      }
      await finishGuest(g, step);
    } catch (e) {
      fail(e, 'checkout');
    } finally {
      setWorking(false);
    }
  };

  const finishGuest = async (g: GuestRead, step: GuestPayStep) => {
    try {
      guestPayTransition(step, 'pay', method); // throws if the order of steps is wrong
      const bill = await payGuest.mutateAsync({ sessionId, guestId: g.id, method });
      setStep(g.id, 'paid');
      toast({ kind: 'success', title: `รับเงิน ${g.label} แล้ว`, msg: bahtStr(bill.amount) });
    } catch (e) {
      fail(e, 'pay');
    }
  };

  const confirmQrPaid = async (g: GuestRead) => {
    if (working) return;
    setWorking(true);
    setError(null);
    try { await finishGuest(g, stepOf(g)); } finally { setWorking(false); }
  };

  // ── rest of the table + close ──────────────────────────────────────────────
  const payRest = async () => {
    if (working) return;
    setWorking(true);
    setError(null);
    try {
      const bill = await payTable.mutateAsync({ sessionId, method });
      toast({ kind: 'success', title: `รับเงินที่เหลือทั้งโต๊ะ ${tableName}`, msg: bahtStr(bill.amount) });
    } catch (e) {
      fail(e, 'pay');
      setWorking(false);
      return;
    }
    await doClose();
    setWorking(false);
  };

  const doClose = async () => {
    try {
      const res = await close.mutateAsync(sessionId);
      if (res.settled) {
        setClosed(true);
        toast({ kind: 'success', title: `ปิดโต๊ะ ${tableName} แล้ว` });
      } else {
        setError({ text: 'ยังมีบิลค้างจ่าย — จ่ายให้ครบก่อนปิดโต๊ะ', ctx: 'close' });
      }
    } catch (e) {
      fail(e, 'close');
    }
  };

  const nothingLeft = !!tableBill.data && tableBill.data.lines.length === 0 && isZeroAmount(tableBill.data.amount);
  const sessionGone = !!liveQ.data && !session && !closed;
  const seated = tableBill.data?.guests_pending_checkout.length ?? 0;

  return (
    <ModalShell
      title={`เช็คบิล ${tableName}`}
      subtitle={closed ? 'ปิดโต๊ะแล้ว' : 'จ่ายรายคน แล้วจ่ายส่วนที่เหลือทั้งโต๊ะ'}
      onClose={onClose}
      busy={working}
      width={640}
      footer={
        closed || sessionGone
          ? <button onClick={onClose} className="btn btn-primary btn-lg tap-lg" style={{ flex: 1 }}><Icon name="check" size={20} /> เสร็จสิ้น</button>
          : <button onClick={onClose} disabled={working} className="btn btn-ghost btn-lg tap-lg" style={{ flex: 1 }}>ไว้ก่อน</button>
      }
    >
      {closed && (
        <div role="status" style={okBox}>
          <Icon name="success" size={20} /> ปิดโต๊ะเรียบร้อย — ลูกค้าที่โต๊ะนี้จะเห็นว่าการเยี่ยมชมจบแล้ว สแกนครั้งถัดไปจะเปิดบิลใหม่
        </div>
      )}
      {sessionGone && <div role="status" style={okBox}>โต๊ะนี้ปิดไปแล้ว</div>}

      {!closed && !sessionGone && (
        <>
          {/* Payment method — applies to the next money action */}
          <div role="radiogroup" aria-label="วิธีรับเงิน" style={{ display: 'flex', gap: 'var(--tap-gap)', marginBottom: 'var(--space-4)' }}>
            {METHODS.map((m) => {
              const on = method === m.value;
              return (
                <button
                  key={m.value}
                  role="radio"
                  aria-checked={on}
                  onClick={() => setMethod(m.value)}
                  disabled={working}
                  className="tap-xl"
                  style={{
                    flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    borderRadius: 'var(--radius-md)', fontSize: 18, fontWeight: 700, cursor: 'pointer',
                    border: `2px solid ${on ? 'var(--color-primary)' : 'var(--color-border-strong)'}`,
                    background: on ? 'var(--color-primary)' : 'var(--color-surface)',
                    color: on ? 'var(--color-text-inverse)' : 'var(--color-text)',
                  }}
                >
                  <Icon name={m.icon} size={22} /> {m.label}
                </button>
              );
            })}
          </div>

          <h3 style={h3}>จ่ายรายคน</h3>
          {liveQ.isLoading && <div aria-busy="true" style={{ color: 'var(--color-text-secondary)' }}>กำลังโหลด…</div>}
          {guests.length === 0 && !liveQ.isLoading && (
            <div style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--fs-sm)', marginBottom: 'var(--space-4)' }}>
              ยังไม่มีลูกค้าสแกนที่โต๊ะนี้ — ออเดอร์ที่พนักงานสั่งให้จ่ายที่ “ทั้งโต๊ะ” ด้านล่าง
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginBottom: 'var(--space-5)' }}>
            {guests.map((g) => {
              const step = stepOf(g);
              const paid = step === 'paid' || (isZeroAmount(g.unpaid_total) && step !== 'qr_ready');
              const open = guestId === g.id;
              const pic = qr[g.id];
              return (
                <div key={g.id} style={{ border: `1px solid ${open ? 'var(--color-primary)' : 'var(--color-border)'}`, borderRadius: 'var(--radius-md)', padding: 'var(--space-3) var(--space-4)', background: 'var(--color-surface)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 18, minWidth: 0, overflowWrap: 'anywhere' }}>{g.label}</strong>
                    {g.status === 'CHECKOUT_REQUESTED' && <span style={pill('danger')}>ขอเช็คบิล</span>}
                    {g.status === 'CHECKED_OUT' && <span style={pill('muted')}>เช็คเอาท์แล้ว</span>}
                    <span className="num" style={{ marginLeft: 'auto', fontSize: 20, fontWeight: 800 }}>{bahtStr(g.unpaid_total)}</span>
                  </div>

                  {!paid && !open && (
                    <button onClick={() => { setGuestId(g.id); setError(null); }} className="btn btn-ghost tap-std" style={{ marginTop: 8 }}>
                      เช็คบิลคนนี้
                    </button>
                  )}
                  {paid && <div style={{ marginTop: 6, fontSize: 'var(--fs-sm)', color: 'var(--color-text-secondary)' }}>ชำระแล้ว / ไม่มียอดค้าง</div>}

                  {open && !paid && (
                    <div style={{ marginTop: 'var(--space-3)' }}>
                      {guestBill.isLoading && <div aria-busy="true" style={{ fontSize: 'var(--fs-sm)' }}>กำลังโหลดบิล…</div>}
                      {guestBill.data && (
                        <ul style={{ listStyle: 'none', margin: '0 0 var(--space-3)', padding: 0, fontSize: 'var(--fs-body)' }}>
                          {guestBill.data.lines.filter((l) => !l.is_time_charge).map((l) => (
                            <li key={l.order_id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '2px 0' }}>
                              <span className="num" style={{ color: 'var(--color-text-secondary)' }}>#{l.receipt_no}</span>
                              <span className="num">{bahtStr(l.total)}</span>
                            </li>
                          ))}
                        </ul>
                      )}

                      {pic ? (
                        <div style={{ textAlign: 'center' }}>
                          {/* eslint-disable-next-line @next/next/no-img-element -- inline base64 QR from the API; next/image adds nothing */}
                          <img
                            src={`data:image/png;base64,${pic.qr_png_base64}`}
                            alt={`QR พร้อมเพย์ ${bahtStr(pic.amount)} สำหรับ ${g.label}`}
                            width={240}
                            height={240}
                            style={{ background: '#fff', padding: 8, borderRadius: 12, imageRendering: 'pixelated' }}
                          />
                          <div className="num" style={{ fontSize: 26, fontWeight: 800, margin: '6px 0 10px' }}>{bahtStr(pic.amount)}</div>
                          <button onClick={() => { void confirmQrPaid(g); }} disabled={working} className="btn btn-primary btn-xl" style={{ width: '100%' }}>
                            {working ? <span className="spinner" style={{ width: 20, height: 20 }} aria-hidden /> : <><Icon name="check" size={22} /> ได้รับเงินแล้ว</>}
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { void startGuest(g); }}
                          disabled={working || !guestBill.data}
                          className="btn btn-primary btn-xl"
                          style={{ width: '100%', fontSize: 19, fontWeight: 800 }}
                        >
                          {working ? <span className="spinner" style={{ width: 20, height: 20 }} aria-hidden />
                            : method === 'CASH'
                              ? <><Icon name="cash" size={22} /> รับเงินสด {guestBill.data ? bahtStr(guestBill.data.amount) : ''}</>
                              : <><Icon name="qr" size={22} /> แสดง QR {guestBill.data ? bahtStr(guestBill.data.amount) : ''}</>}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <h3 style={h3}>ที่เหลือทั้งโต๊ะ</h3>
          {tableBill.isLoading && <div aria-busy="true">กำลังโหลดบิลทั้งโต๊ะ…</div>}
          {tableBill.data && (
            <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3) var(--space-4)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                <span style={{ fontSize: 'var(--fs-body)', color: 'var(--color-text-secondary)' }}>{tableBill.data.lines.length} บิลค้าง</span>
                <strong className="num" style={{ fontSize: 26 }}>{bahtStr(tableBill.data.amount)}</strong>
              </div>
              {seated > 0 && !nothingLeft && (
                <div style={{ fontSize: 'var(--fs-cap)', color: 'var(--color-warning-fg)', marginTop: 4 }}>
                  มี {seated} คนยังไม่เช็คเอาท์ — ระบบจะเช็คเอาท์ให้ตอนรับเงินทั้งโต๊ะ
                </div>
              )}
              {nothingLeft ? (
                <button onClick={() => { void (async () => { setWorking(true); await doClose(); setWorking(false); })(); }} disabled={working} className="btn btn-primary btn-xl" style={{ width: '100%', marginTop: 'var(--space-3)', fontSize: 19, fontWeight: 800 }}>
                  {working ? <span className="spinner" style={{ width: 20, height: 20 }} aria-hidden /> : <><Icon name="check" size={22} /> ปิดโต๊ะ</>}
                </button>
              ) : (
                <>
                  <button
                    onClick={() => { void payRest(); }}
                    disabled={working || method === 'QR_PROMPTPAY'}
                    className="btn btn-primary btn-xl"
                    style={{ width: '100%', marginTop: 'var(--space-3)', fontSize: 19, fontWeight: 800 }}
                  >
                    {working ? <span className="spinner" style={{ width: 20, height: 20 }} aria-hidden />
                      : <><Icon name="cash" size={22} /> รับเงินสดที่เหลือ {bahtStr(tableBill.data.amount)} แล้วปิดโต๊ะ</>}
                  </button>
                  {method === 'QR_PROMPTPAY' && (
                    <div style={{ fontSize: 'var(--fs-cap)', color: 'var(--color-text-secondary)', marginTop: 6 }}>
                      ทั้งโต๊ะรับเป็นเงินสดเท่านั้น — เลือก “เงินสด” ด้านบน หรือให้แต่ละคนจ่าย QR ของตัวเองข้างบน
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}

      {error && (
        <div role="alert" style={{ marginTop: 'var(--space-4)', padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-md)', background: 'var(--color-danger-50)', color: 'var(--color-danger-fg)', fontWeight: 600, fontSize: 'var(--fs-body)', lineHeight: 1.5 }}>
          {error.text}
          {error.ctx === 'qr' && guest && (
            <div><button onClick={() => { setMethod('CASH'); setError(null); }} className="btn btn-ghost tap-std" style={{ marginTop: 6 }}>เปลี่ยนเป็นเงินสด</button></div>
          )}
        </div>
      )}
    </ModalShell>
  );
}

const h3: React.CSSProperties = { fontSize: 'var(--fs-body)', fontWeight: 700, margin: '0 0 var(--space-3)' };
const okBox: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-4)', borderRadius: 'var(--radius-md)',
  background: 'var(--color-success-50, var(--color-surface-2))',
  color: 'color-mix(in srgb, var(--color-success) 68%, var(--color-text))', fontWeight: 700,
};
function pill(tone: 'danger' | 'muted'): React.CSSProperties {
  return {
    fontSize: 'var(--fs-cap)', fontWeight: 700, padding: '2px 10px', borderRadius: 999,
    background: tone === 'danger' ? 'var(--color-danger-strong)' : 'var(--color-surface-2)',
    color: tone === 'danger' ? '#fff' : 'var(--color-text-secondary)',
  };
}
