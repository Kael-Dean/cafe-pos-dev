'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../icons';
import { Select, useToast } from '../app-common';
import { usePayOrder } from '@/hooks/use-orders';
import {
  useCloseTableSession, type PaymentMethod, type SessionCloseResult, type TableSession,
} from '@/hooks/use-table-sessions';
import { bahtStr, clockTime, formatMinutes } from '@/lib/money';
import { ModalShell, errMsg, planSummary } from './table-session-modal';

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'CASH', label: 'เงินสด' },
  { value: 'QR_PROMPTPAY', label: 'QR พร้อมเพย์' },
  { value: 'CARD', label: 'บัตร' },
  { value: 'LINE_PAY', label: 'LINE Pay' },
  { value: 'TRUEMONEY', label: 'TrueMoney' },
  { value: 'OTHER', label: 'อื่น ๆ' },
];

/**
 * Close-out screen. Entering it calls `close` (which stops the clock and mints the
 * time-charge order), then walks the staff through paying whatever is still open.
 *
 * `close` is idempotent — every retry re-reads payment state without re-billing,
 * and calling it again after the last payment is what actually settles the session.
 * Nothing here is optimistic: the table is only shown as closed once the API says
 * `settled: true`.
 */
export default function SettleModal({ session, tableName, onClose }: {
  session: TableSession;
  tableName: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const closeSession = useCloseTableSession();
  const payOrder = usePayOrder();

  const [result, setResult] = useState<SessionCloseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [method, setMethod] = useState<Record<string, PaymentMethod>>({});

  const runClose = useCallback(async () => {
    setError(null);
    try {
      const res = await closeSession.mutateAsync(session.id);
      setResult(res);
      return res;
    } catch (e: unknown) {
      setError(errMsg(e));
      return null;
    }
    // closeSession is a stable mutation object from react-query for this component's
    // lifetime; leaving it out keeps the mount effect from re-firing on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void runClose();
  }, [runClose]);

  const pay = async (orderId: string) => {
    if (payingId) return;
    setPayingId(orderId);
    setError(null);
    try {
      await payOrder.mutateAsync({ orderId, payment_method: method[orderId] ?? 'CASH' });
      // Re-close to get the authoritative list of what is still owed. Paying the
      // last order does NOT auto-close the session — this call is what settles it.
      const res = await runClose();
      if (res?.settled) toast({ kind: 'success', title: `ปิดโต๊ะ ${tableName} แล้ว` });
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setPayingId(null);
    }
  };

  const loading = closeSession.isPending && !result;
  const settled = !!result?.settled;
  const charge = result?.timeCharge;
  const unpaid = result?.unpaidOrders ?? [];

  return (
    <ModalShell
      title={`ปิดโต๊ะ ${tableName}`}
      subtitle={result?.session.closedAt ? `หยุดเวลา ${clockTime(result.session.closedAt)}` : 'กำลังหยุดเวลา…'}
      icon="cash"
      onClose={onClose}
      busy={loading || !!payingId}
      footer={
        settled ? (
          <button onClick={onClose} className="btn btn-lg" style={{ flex: 1, minHeight: 44 }}>
            <Icon name="check" size={16} /> เสร็จสิ้น
          </button>
        ) : (
          <>
            <button onClick={onClose} className="btn btn-ghost btn-lg" style={{ flex: 1, minHeight: 44 }}>
              ไว้ก่อน
            </button>
            <button
              onClick={() => { void runClose(); }}
              disabled={closeSession.isPending || !!payingId}
              className="btn btn-lg"
              style={{ flex: 1.4, minHeight: 44 }}
            >
              {closeSession.isPending
                ? <span className="spinner" style={{ width: 16, height: 16 }} aria-hidden />
                : <><Icon name="refresh" size={16} /> เช็คสถานะอีกครั้ง</>}
            </button>
          </>
        )
      }
    >
      {loading && (
        <div aria-busy="true" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-4)' }}>
          <span className="spinner" style={{ width: 20, height: 20 }} aria-hidden />
          <span style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>กำลังสรุปค่าเวลา…</span>
        </div>
      )}

      {charge && (
        <div style={{
          padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)', background: 'var(--color-surface-2)',
          marginBottom: 'var(--space-5)',
        }}>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>ค่าเวลา</div>
          <div className="num" style={{ fontSize: 30, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {bahtStr(charge.amount)}
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 4 }}>
            เล่นจริง {formatMinutes(charge.rawMinutes)} → คิด {formatMinutes(charge.billableMinutes)} · {session.partySize} คน
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginTop: 'var(--space-3)' }}>
            {charge.withinGrace && <Pill tone="info">อยู่ในช่วงผ่อนผัน — ไม่คิดค่าเวลา</Pill>}
            {charge.capApplied && <Pill tone="success">คิดตามเพดานต่อวัน</Pill>}
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 'var(--space-3)', lineHeight: 1.5 }}>
            {planSummary(session.rateSnapshot)}
          </div>
        </div>
      )}

      {result && !settled && (
        <>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 'var(--space-3)' }}>
            บิลที่ยังไม่จ่าย ({unpaid.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {unpaid.map((o) => (
              <div key={o.id} style={{
                padding: 'var(--space-4)', borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border)', background: 'var(--color-surface)',
              }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
                  <span className="num" style={{ fontSize: 13, color: 'var(--color-text-secondary)', minWidth: 0, overflowWrap: 'anywhere' }}>#{o.receiptNo}</span>
                  <strong className="num" style={{ marginLeft: 'auto', fontSize: 18, fontVariantNumeric: 'tabular-nums' }}>{bahtStr(o.total)}</strong>
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  <Select
                    value={method[o.id] ?? 'CASH'}
                    onChange={(v) => setMethod((prev) => ({ ...prev, [o.id]: v as PaymentMethod }))}
                    ariaLabel={`วิธีจ่ายบิล ${o.receiptNo}`}
                    style={{ flex: 1, minWidth: 0 }}
                    options={METHODS}
                  />
                  <button
                    onClick={() => { void pay(o.id); }}
                    disabled={!!payingId}
                    className="btn"
                    style={{ minHeight: 44, opacity: payingId ? 0.6 : 1 }}
                  >
                    {payingId === o.id
                      ? <span className="spinner" style={{ width: 16, height: 16 }} aria-hidden />
                      : <><Icon name="check" size={16} /> รับเงิน</>}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {unpaid.length === 0 && (
            <div role="status" style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
              ไม่มีบิลค้างในระบบ แต่โต๊ะยังไม่ปิด — กด “เช็คสถานะอีกครั้ง” เพื่อยืนยันกับเซิร์ฟเวอร์
            </div>
          )}
        </>
      )}

      {settled && (
        <div role="status" style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-4)',
          borderRadius: 'var(--radius-md)', background: 'var(--color-success-50, var(--color-surface-2))',
          color: 'var(--color-success)', fontWeight: 700,
        }}>
          <Icon name="success" size={20} />
          <span>ปิดโต๊ะเรียบร้อย — จ่ายครบทุกบิลแล้ว</span>
        </div>
      )}

      {error && (
        <div role="alert" style={{
          marginTop: 'var(--space-4)', padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-md)',
          background: 'var(--color-danger-50)', color: 'var(--color-danger)', fontSize: 13, fontWeight: 600,
        }}>
          {error}
        </div>
      )}
    </ModalShell>
  );
}

function Pill({ children, tone }: { children: React.ReactNode; tone: 'info' | 'success' }) {
  const color = tone === 'success' ? 'var(--color-success)' : 'var(--color-info)';
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 999, border: `1px solid ${color}`, color }}>
      {children}
    </span>
  );
}
