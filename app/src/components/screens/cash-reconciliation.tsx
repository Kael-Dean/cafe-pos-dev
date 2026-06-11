'use client';

import { useState } from 'react';
import Icon from '../icons';
import { useToast, Tag, baht } from '../app-common';
import { useCurrentUser, isAdmin } from '@/hooks/use-current-user';
import { useCountUp, useFadeRise } from '@/lib/motion';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useCurrentCashSession, useOpenCashSession, useCloseCashSession,
  type CashSession,
} from '@/hooks/use-cash';

/** ฿ amount, optionally signed (+/-), counting up on mount (dashboard idiom). */
function bahtFmt(n: number, signed: boolean): string {
  const r = Math.round(n);
  const sign = signed ? (r >= 0 ? '+' : '-') : (r < 0 ? '-' : '');
  return `${sign}฿${Math.abs(r).toLocaleString('en-US')}`;
}
function StatValue({ value, signed = false, color }: { value: number; signed?: boolean; color?: string }) {
  const ref = useCountUp(value, { format: (n) => bahtFmt(n, signed) });
  return (
    <span ref={ref} className="num" style={{ fontSize: 20, fontWeight: 700, color: color ?? 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}>
      {bahtFmt(value, signed)}
    </span>
  );
}

function diffColor(diff: number) {
  if (diff > 0) return 'var(--color-success)';
  if (diff < 0) return 'var(--color-danger)';
  return 'var(--color-text-secondary)';
}

function isOpen(session: CashSession): boolean {
  return session.closed_at === null;
}

function formatDt(dt: string): string {
  return new Date(dt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
}

export default function CashReconciliation() {
  const toast = useToast();
  const { data: me } = useCurrentUser();
  const admin = isAdmin(me?.role);

  const { data: session, isLoading } = useCurrentCashSession();
  const openSession = useOpenCashSession();
  const closeSession = useCloseCashSession();

  const [openAmount, setOpenAmount] = useState('');
  const [openNotes, setOpenNotes] = useState('');
  const [closeAmount, setCloseAmount] = useState('');
  const [closeNotes, setCloseNotes] = useState('');

  const handleOpen = async () => {
    const amt = parseFloat(openAmount);
    if (isNaN(amt) || amt < 0) { toast({ kind: 'warning', title: 'กรอกยอดเงินเปิด' }); return; }
    try {
      await openSession.mutateAsync({ cash_open: amt, notes: openNotes || undefined });
      toast({ kind: 'success', title: 'เปิดลิ้นชักเงินสดแล้ว', msg: `เงินเปิด ${baht(amt)}` });
      setOpenAmount(''); setOpenNotes('');
    } catch (e: unknown) { toast({ kind: 'danger', title: String(e instanceof Error ? e.message : e) }); }
  };

  const handleClose = async () => {
    if (!session) return;
    const amt = parseFloat(closeAmount);
    if (isNaN(amt) || amt < 0) { toast({ kind: 'warning', title: 'กรอกยอดปิด' }); return; }
    try {
      await closeSession.mutateAsync({ sessionId: session.id, cash_close: amt, notes: closeNotes || undefined });
      toast({ kind: 'success', title: 'ปิดกะเสร็จแล้ว' });
      setCloseAmount(''); setCloseNotes('');
    } catch (e: unknown) { toast({ kind: 'danger', title: String(e instanceof Error ? e.message : e) }); }
  };

  const cashOpen   = session ? Number(session.cash_open) : 0;
  const cashClose  = session?.cash_close != null ? Number(session.cash_close) : null;
  const diff       = cashClose != null ? cashClose - cashOpen : null;
  const sessionOpen = session ? isOpen(session) : false;

  const contentRef = useFadeRise();

  if (isLoading) {
    return (
      <div style={{ padding: 'var(--space-8)', maxWidth: 860, margin: '0 auto' }} aria-busy="true">
        <span className="sr-only">กำลังโหลดข้อมูลกะเงินสด…</span>
        <Skeleton height={28} width={260} radius="var(--radius-md)" style={{ marginBottom: 'var(--space-6)' }} />
        {/* Status-summary cards placeholder — mirrors the real row */}
        <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} style={{ flex: 1, minWidth: 130, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <Skeleton height={11} width="60%" />
              <Skeleton height={20} width="80%" radius="var(--radius-sm)" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div ref={contentRef} style={{ padding: 'var(--space-8)', maxWidth: 860, margin: '0 auto' }}>
      <h1 className="text-balance" style={{ fontSize: 22, fontWeight: 700, marginBottom: 'var(--space-6)', color: 'var(--color-text)' }}>
        <Icon name="cash" size={20} style={{ marginRight: 8 }} />
        การเงิน / Cash Session
      </h1>

      {/* No open session */}
      {!session && (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: 28 }}>
          <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 'var(--space-4)' }}>เปิดกะวันนี้</div>
          {admin ? (
            <>
              <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>ยอดเงินเปิดลิ้นชัก (฿)</label>
                  <input value={openAmount} onChange={e => setOpenAmount(e.target.value)} type="number" min="0" step="0.01" placeholder="0.00"
                    style={{ width: '100%', minHeight: 44, padding: '10px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-surface-2)', color: 'var(--color-text)', fontSize: 15, boxSizing: 'border-box' }} />
                </div>
                <div style={{ flex: 2, minWidth: 200 }}>
                  <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>หมายเหตุ</label>
                  <input value={openNotes} onChange={e => setOpenNotes(e.target.value)} placeholder="เช่น Opening shift"
                    style={{ width: '100%', minHeight: 44, padding: '10px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-surface-2)', color: 'var(--color-text)', fontSize: 14, boxSizing: 'border-box' }} />
                </div>
              </div>
              <button onClick={handleOpen} disabled={openSession.isPending} className="pressable"
                style={{ minHeight: 44, padding: '10px 20px', borderRadius: 'var(--radius-md)', background: 'var(--color-accent)', color: 'var(--color-on-accent)', fontWeight: 600, fontSize: 14, cursor: 'pointer', border: 'none' }}>
                {openSession.isPending ? 'กำลังบันทึก...' : 'เปิดลิ้นชัก'}
              </button>
            </>
          ) : (
            <div style={{ color: 'var(--color-text-secondary)' }}>ยังไม่มีกะวันนี้ กรุณาแจ้งผู้จัดการ</div>
          )}
        </div>
      )}

      {/* Active / closed session */}
      {session && (
        <>
          {/* Status summary */}
          <div style={{ display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-5)', flexWrap: 'wrap' }}>
            {([
              { label: 'เปิดลิ้นชักเมื่อ', text: formatDt(session.opened_at) },
              { label: 'ยอดเปิด', money: cashOpen },
              ...(cashClose != null
                ? [
                    { label: 'ปิดเมื่อ', text: session.closed_at ? formatDt(session.closed_at) : '—' },
                    { label: 'ยอดปิด', money: cashClose },
                    { label: 'ส่วนต่าง', money: diff!, diff: true },
                  ]
                : []),
            ] as { label: string; text?: string; money?: number; diff?: boolean }[]).map(card => (
              <div key={card.label} style={{ flex: 1, minWidth: 130, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: '14px 16px' }}>
                <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginBottom: 'var(--space-1)' }}>{card.label}</div>
                {card.money != null ? (
                  <StatValue
                    value={card.money}
                    signed={card.diff}
                    color={card.diff ? diffColor(diff!) : undefined}
                  />
                ) : (
                  <div className="num" style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}>{card.text}</div>
                )}
              </div>
            ))}
            <div style={{ flex: 1, minWidth: 130, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Tag tone={sessionOpen ? 'success' : 'neutral'}>{sessionOpen ? 'เปิดอยู่' : 'ปิดแล้ว'}</Tag>
            </div>
          </div>

          {session.notes && (
            <div style={{ background: 'var(--color-surface-2)', borderRadius: 'var(--radius-md)', padding: '10px 14px', marginBottom: 'var(--space-4)', fontSize: 13, color: 'var(--color-text-secondary)' }}>
              หมายเหตุ: {session.notes}
            </div>
          )}

          {/* Close session (admin only, when still open) */}
          {admin && sessionOpen && (
            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-5)' }}>
              <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 'var(--space-4)' }}>ปิดกะ / Reconcile</div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>ยอดนับจริง (฿)</label>
                  <input value={closeAmount} onChange={e => setCloseAmount(e.target.value)} type="number" min="0" step="0.01" placeholder="0.00"
                    style={{ minHeight: 44, padding: '10px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-surface-2)', color: 'var(--color-text)', fontSize: 15, width: '100%', boxSizing: 'border-box' }} />
                </div>
                <div style={{ flex: 2, minWidth: 200 }}>
                  <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>หมายเหตุ</label>
                  <input value={closeNotes} onChange={e => setCloseNotes(e.target.value)} placeholder="เช่น End of day — ส่วนต่างบันทึกไว้"
                    style={{ minHeight: 44, padding: '10px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-surface-2)', color: 'var(--color-text)', fontSize: 14, width: '100%', boxSizing: 'border-box' }} />
                </div>
              </div>
              {closeAmount && !isNaN(parseFloat(closeAmount)) && (
                <div style={{ fontSize: 13, color: diffColor(parseFloat(closeAmount) - cashOpen), fontWeight: 600, marginTop: 10 }}>
                  ส่วนต่างจากยอดเปิด: {parseFloat(closeAmount) - cashOpen >= 0 ? '+' : ''}{baht(parseFloat(closeAmount) - cashOpen)}
                </div>
              )}
              <div style={{ marginTop: 'var(--space-4)' }}>
                <button onClick={handleClose} disabled={closeSession.isPending} className="pressable"
                  style={{ minHeight: 44, padding: '10px 20px', borderRadius: 'var(--radius-md)', background: 'var(--color-danger)', color: 'var(--color-text-inverse)', fontWeight: 600, fontSize: 14, cursor: 'pointer', border: 'none' }}>
                  {closeSession.isPending ? 'กำลังปิด...' : 'ปิดกะ'}
                </button>
              </div>
            </div>
          )}

          {/* Closed summary */}
          {!sessionOpen && cashClose != null && (
            <div style={{ background: 'var(--color-success-50)', border: '1px solid var(--color-success)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-5)' }}>
              <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--color-success)', marginBottom: 6 }}>กะปิดแล้ว</div>
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                เปิด {baht(cashOpen)} → ปิด {baht(cashClose)} · ส่วนต่าง{' '}
                <span style={{ color: diffColor(diff!), fontWeight: 700 }}>{diff! >= 0 ? '+' : ''}{baht(diff!)}</span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
