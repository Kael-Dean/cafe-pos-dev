'use client';

import { useState } from 'react';
import Icon from '../icons';
import { useToast, Tag, baht } from '../app-common';
import { useCurrentUser, isAdmin } from '@/hooks/use-current-user';
import {
  useTodayCashSession, useOpenCashSession, useCloseCashSession, useAddPayout,
  type CashSession,
} from '@/hooks/use-cash';

const PAYOUT_LABELS: Record<string, string> = {
  PAYOUT: 'จ่ายออก',
  PETTY_CASH: 'เงินสดย่อย',
  WITHDRAWAL: 'ถอนเงิน',
};

const today = () => new Date().toISOString().split('T')[0];

function totalPayouts(session: CashSession) {
  return session.payouts.reduce((s, p) => s + Number(p.amount), 0);
}

function diffColor(diff: number) {
  if (diff > 0) return 'var(--color-success)';
  if (diff < 0) return 'var(--color-danger)';
  return 'var(--color-text-secondary)';
}

export default function CashReconciliation() {
  const toast = useToast();
  const { data: me } = useCurrentUser();
  const admin = isAdmin(me?.role);

  const { data: session, isLoading } = useTodayCashSession();
  const openSession = useOpenCashSession();
  const closeSession = useCloseCashSession();
  const addPayout = useAddPayout();

  const [openBalance, setOpenBalance] = useState('');
  const [closeBalance, setCloseBalance] = useState('');
  const [openNotes, setOpenNotes] = useState('');
  const [payoutAmount, setPayoutAmount] = useState('');
  const [payoutType, setPayoutType] = useState('PAYOUT');
  const [payoutDesc, setPayoutDesc] = useState('');
  const [showPayoutForm, setShowPayoutForm] = useState(false);

  const handleOpen = async () => {
    const bal = parseFloat(openBalance);
    if (isNaN(bal) || bal < 0) { toast({ kind: 'warning', title: 'กรอกยอดเงินเปิด' }); return; }
    try {
      await openSession.mutateAsync({ session_date: today(), opening_balance: bal, notes: openNotes || undefined });
      toast({ kind: 'success', title: 'เปิดลิ้นชักเงินสดแล้ว' });
      setOpenBalance(''); setOpenNotes('');
    } catch (e: unknown) { toast({ kind: 'danger', title: String(e instanceof Error ? e.message : e) }); }
  };

  const handleClose = async () => {
    if (!session) return;
    const bal = parseFloat(closeBalance);
    if (isNaN(bal) || bal < 0) { toast({ kind: 'warning', title: 'กรอกยอดปิด' }); return; }
    try {
      await closeSession.mutateAsync({ sessionId: session.id, closing_balance: bal });
      toast({ kind: 'success', title: 'ปิดกะเสร็จแล้ว' });
      setCloseBalance('');
    } catch (e: unknown) { toast({ kind: 'danger', title: String(e instanceof Error ? e.message : e) }); }
  };

  const handlePayout = async () => {
    if (!session) return;
    const amt = parseFloat(payoutAmount);
    if (isNaN(amt) || amt <= 0) { toast({ kind: 'warning', title: 'กรอกจำนวนเงิน' }); return; }
    if (!payoutDesc.trim()) { toast({ kind: 'warning', title: 'กรอกคำอธิบาย' }); return; }
    try {
      await addPayout.mutateAsync({ sessionId: session.id, amount: amt, payout_type: payoutType, description: payoutDesc });
      toast({ kind: 'success', title: 'บันทึกรายจ่ายแล้ว' });
      setPayoutAmount(''); setPayoutDesc(''); setShowPayoutForm(false);
    } catch (e: unknown) { toast({ kind: 'danger', title: String(e instanceof Error ? e.message : e) }); }
  };

  const totalOut = session ? totalPayouts(session) : 0;
  const openBal = session ? Number(session.opening_balance) : 0;
  const closeBal = session?.closing_balance != null ? Number(session.closing_balance) : null;
  const expected = openBal - totalOut;
  const diff = closeBal != null ? closeBal - expected : null;

  if (isLoading) return <div style={{ padding: 40, color: 'var(--color-text-secondary)' }}>กำลังโหลด...</div>;

  return (
    <div style={{ padding: 32, maxWidth: 860, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 24, color: 'var(--color-text)' }}>
        <Icon name="cash" size={20} style={{ marginRight: 8 }} />
        การเงิน / Cash Reconciliation
      </h1>

      {/* No session today */}
      {!session && (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 28 }}>
          <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 16 }}>เปิดกะวันนี้</div>
          {admin ? (
            <>
              <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>ยอดเงินเปิดลิ้นชัก (฿)</label>
                  <input value={openBalance} onChange={e => setOpenBalance(e.target.value)} type="number" min="0" placeholder="0.00"
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface-2)', color: 'var(--color-text)', fontSize: 15 }} />
                </div>
                <div style={{ flex: 2, minWidth: 200 }}>
                  <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>หมายเหตุ</label>
                  <input value={openNotes} onChange={e => setOpenNotes(e.target.value)} placeholder="ไม่บังคับ"
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface-2)', color: 'var(--color-text)', fontSize: 14 }} />
                </div>
              </div>
              <button onClick={handleOpen} disabled={openSession.isPending}
                style={{ padding: '10px 20px', borderRadius: 8, background: 'var(--color-accent)', color: 'var(--color-primary-700)', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                {openSession.isPending ? 'กำลังบันทึก...' : 'เปิดลิ้นชัก'}
              </button>
            </>
          ) : (
            <div style={{ color: 'var(--color-text-secondary)' }}>ยังไม่มีกะวันนี้ กรุณาแจ้งผู้จัดการ</div>
          )}
        </div>
      )}

      {/* Active session */}
      {session && (
        <>
          {/* Status banner */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
            {[
              { label: 'ยอดเปิด', val: baht(openBal) },
              { label: 'รายจ่ายรวม', val: baht(totalOut) },
              { label: 'ยอดคาดหวัง', val: baht(expected) },
              ...(closeBal != null ? [{ label: 'ยอดปิดจริง', val: baht(closeBal) }, { label: 'ส่วนต่าง', val: `${diff! >= 0 ? '+' : ''}${baht(diff!)}` }] : []),
            ].map(card => (
              <div key={card.label} style={{ flex: 1, minWidth: 130, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 10, padding: '14px 16px' }}>
                <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginBottom: 4 }}>{card.label}</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: card.label === 'ส่วนต่าง' ? diffColor(diff!) : 'var(--color-text)' }}>{card.val}</div>
              </div>
            ))}
            <div style={{ flex: 1, minWidth: 130, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Tag tone={session.status === 'OPEN' ? 'success' : 'neutral'}>{session.status === 'OPEN' ? 'เปิดอยู่' : 'ปิดแล้ว'}</Tag>
            </div>
          </div>

          {/* Payouts */}
          <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 20, marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>รายจ่าย ({session.payouts.length})</div>
              {session.status === 'OPEN' && (
                <button onClick={() => setShowPayoutForm(v => !v)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)', fontSize: 13, cursor: 'pointer' }}>
                  <Icon name="plus" size={15} /> บันทึกรายจ่าย
                </button>
              )}
            </div>
            {showPayoutForm && (
              <div style={{ background: 'var(--color-surface-2)', borderRadius: 8, padding: 16, marginBottom: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <select value={payoutType} onChange={e => setPayoutType(e.target.value)}
                  style={{ padding: '8px 10px', borderRadius: 7, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 13 }}>
                  {Object.entries(PAYOUT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <input value={payoutAmount} onChange={e => setPayoutAmount(e.target.value)} type="number" min="0.01" placeholder="฿ จำนวน"
                  style={{ width: 110, padding: '8px 10px', borderRadius: 7, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 13 }} />
                <input value={payoutDesc} onChange={e => setPayoutDesc(e.target.value)} placeholder="คำอธิบาย"
                  style={{ flex: 1, minWidth: 140, padding: '8px 10px', borderRadius: 7, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 13 }} />
                <button onClick={handlePayout} disabled={addPayout.isPending}
                  style={{ padding: '8px 14px', borderRadius: 7, background: 'var(--color-accent)', color: 'var(--color-primary-700)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                  บันทึก
                </button>
              </div>
            )}
            {session.payouts.length === 0 ? (
              <div style={{ color: 'var(--color-text-muted)', fontSize: 13, padding: '8px 0' }}>ยังไม่มีรายจ่าย</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {session.payouts.map(p => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--color-surface-2)', borderRadius: 8 }}>
                    <Tag tone="warning">{PAYOUT_LABELS[p.payout_type] ?? p.payout_type}</Tag>
                    <span style={{ flex: 1, fontSize: 13, color: 'var(--color-text)' }}>{p.description}</span>
                    <span style={{ fontWeight: 700, color: 'var(--color-danger)' }}>-{baht(Number(p.amount))}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Close session (admin only) */}
          {admin && session.status === 'OPEN' && (
            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 20 }}>
              <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 14 }}>ปิดกะ / Reconcile</div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>ยอดนับจริง (฿)</label>
                  <input value={closeBalance} onChange={e => setCloseBalance(e.target.value)} type="number" min="0" placeholder="0.00"
                    style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface-2)', color: 'var(--color-text)', fontSize: 15, width: 180 }} />
                </div>
                {closeBalance && !isNaN(parseFloat(closeBalance)) && (
                  <div style={{ fontSize: 13, color: diffColor(parseFloat(closeBalance) - expected), fontWeight: 600, paddingBottom: 10 }}>
                    ส่วนต่าง: {parseFloat(closeBalance) - expected >= 0 ? '+' : ''}{baht(parseFloat(closeBalance) - expected)}
                  </div>
                )}
                <button onClick={handleClose} disabled={closeSession.isPending}
                  style={{ padding: '10px 20px', borderRadius: 8, background: '#ef4444', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer', marginBottom: 1 }}>
                  {closeSession.isPending ? 'กำลังปิด...' : 'ปิดกะ'}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
