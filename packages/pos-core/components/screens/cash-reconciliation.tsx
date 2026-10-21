'use client';

import { useState } from 'react';
import Icon from '../icons';
import { useToast, Tag, baht, ModalShell } from '../app-common';
import { useCurrentUser, isAdmin } from '@pos/core/hooks/use-current-user';
import { useCountUp, useFadeRise } from '@pos/core/lib/motion';
import { Skeleton } from '@pos/core/components/ui/skeleton';
import { ApiError } from '@pos/core/lib/api-client';
import { bahtStr, moneySign, signedBahtStr, subMoney, sumMoney } from '@pos/core/lib/money';
import {
  buildClosePayload, buildCloseRows, checkActualAmount, closeTotals, variance,
  NOTES_MAX, PAYMENT_METHOD_LABEL,
  type CloseDraftRow, type CloseRow, type SessionPaymentEntryRead, type VarianceTone,
} from '@pos/core/lib/cash-reconciliation';
import {
  useCurrentCashSession, useOpenCashSession, useCloseCashSession, usePaymentGroups, useCashSessionSummary,
  type CashSession, type CashSessionDetail,
} from '@pos/core/hooks/use-cash';
import type { ScreenProps } from '@pos/core/edition/types';

// Reconciliation table: 5 columns on tablet / desktop; on phones each group becomes a
// stacked card (name + system total, then the two inputs, then the variance).
const REC_CSS = `
.rec-grid { display: grid; grid-template-columns: minmax(150px, 1.3fr) minmax(96px, 0.8fr) minmax(130px, 1fr) minmax(96px, 0.8fr) minmax(160px, 1.6fr); column-gap: 12px; align-items: start; }
.rec-head { padding: 10px 16px; font-size: 12px; font-weight: 600; color: var(--color-text-secondary); background: var(--color-surface-2); border-bottom: 1px solid var(--color-border); }
.rec-row { padding: 12px 16px; border-bottom: 1px solid var(--color-border); transition: background-color 150ms var(--ease-out); }
.rec-row[data-tone='short'] { background: var(--color-danger-50); }
.rec-row[data-tone='over'] { background: var(--color-warning-50); }
.rec-num { text-align: right; font-variant-numeric: tabular-nums; }
.rec-input { width: 100%; min-height: 44px; padding: 10px 12px; border-radius: var(--radius-md); border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-text); box-sizing: border-box; font-family: inherit; font-size: 15px; }
.rec-input.num { text-align: right; font-variant-numeric: tabular-nums; }
.rec-input[aria-invalid='true'] { border-color: var(--color-danger); }
.rec-err { margin-top: 4px; font-size: 12px; color: var(--color-danger); }
.rec-var { font-weight: 700; padding-top: 11px; }
.rec-var[data-tone='short'] { color: var(--color-danger); }
.rec-var[data-tone='over'] { color: var(--color-warning-fg); }
.rec-var[data-tone='even'] { color: var(--color-text-secondary); font-weight: 600; }
.rec-sys { padding-top: 11px; font-weight: 600; }
.rec-name { padding-top: 6px; min-width: 0; }
.rec-name > div:first-child { font-size: 15px; font-weight: 700; overflow-wrap: anywhere; }
.rec-methods { margin-top: 2px; font-size: 12px; color: var(--color-text-secondary); line-height: 1.4; }
.rec-label { display: none; }
.rec-foot { padding: 14px 16px; display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.rec-totals { display: flex; gap: 24px; flex-wrap: wrap; }
.rec-totals > div > div:first-child { font-size: 12px; color: var(--color-text-secondary); }
.rec-totals > div > div:last-child { font-size: 17px; font-weight: 700; font-variant-numeric: tabular-nums; }
@media (max-width: 767px) {
  .rec-head { display: none; }
  .rec-grid.rec-row { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); grid-template-areas: 'name sys' 'actual var' 'notes notes'; row-gap: 8px; }
  .rec-row > .rec-name { grid-area: name; padding-top: 0; }
  .rec-row > .rec-sys { grid-area: sys; padding-top: 0; }
  .rec-row > .rec-actual { grid-area: actual; }
  .rec-row > .rec-var { grid-area: var; padding-top: 0; align-self: end; padding-bottom: 12px; }
  .rec-row > .rec-notes { grid-area: notes; }
  .rec-label { display: block; font-size: 12px; font-weight: 500; color: var(--color-text-secondary); margin-bottom: 4px; text-align: left; font-family: inherit; }
  .rec-sys .rec-label, .rec-var .rec-label { text-align: right; }
  .rec-input { font-size: 16px; }
  .rec-foot { flex-direction: column; align-items: stretch; }
  .rec-totals { justify-content: space-between; gap: 12px; }
  .rec-foot > button { width: 100%; }
}
`;

/** ฿ amount counting up on mount (dashboard idiom). Display only — the figure is the API's string. */
function StatValue({ value, color }: { value: number; color?: string }) {
  const ref = useCountUp(value, { format: (n) => `฿${Math.round(n).toLocaleString('en-US')}` });
  return (
    <span ref={ref} className="num" style={{ fontSize: 20, fontWeight: 700, color: color ?? 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}>
      {baht(value)}
    </span>
  );
}

const TONE_LABEL: Record<VarianceTone, string> = { short: 'ขาด', over: 'เกิน', even: 'ตรง' };

function isOpen(session: CashSession): boolean {
  return session.closed_at === null;
}

function formatDt(dt: string): string {
  return new Date(dt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
}

function methodsLabel(methods: readonly string[]): string {
  return methods.map(m => PAYMENT_METHOD_LABEL[m as keyof typeof PAYMENT_METHOD_LABEL] ?? m).join(' · ');
}

const errStatus = (e: unknown) => (e instanceof ApiError ? e.status : null);
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function CashReconciliation({ navigate }: Partial<ScreenProps> = {}) {
  const toast = useToast();
  const { data: me } = useCurrentUser();
  const admin = isAdmin(me?.role);

  const { data: session, isLoading } = useCurrentCashSession();
  const openSession = useOpenCashSession();

  const [openAmount, setOpenAmount] = useState('');
  const [openNotes, setOpenNotes] = useState('');
  // The close response (with its stored entries) — `current` is empty once closed, so
  // this is the only place the manager can read back what was recorded.
  const [closed, setClosed] = useState<CashSessionDetail | null>(null);

  const handleOpen = async () => {
    const amt = parseFloat(openAmount);
    if (isNaN(amt) || amt < 0) { toast({ kind: 'warning', title: 'กรอกยอดเงินเปิด' }); return; }
    try {
      await openSession.mutateAsync({ cash_open: amt, notes: openNotes || undefined });
      toast({ kind: 'success', title: 'เปิดลิ้นชักเงินสดแล้ว', msg: `เงินเปิด ${baht(amt)}` });
      setOpenAmount(''); setOpenNotes(''); setClosed(null);
    } catch (e: unknown) { toast({ kind: 'danger', title: errMsg(e) }); }
  };

  const sessionOpen = session ? isOpen(session) : false;
  const contentRef = useFadeRise();

  if (isLoading) {
    return (
      <div className="screen-pad-lg" style={{ padding: 'var(--space-8)', maxWidth: 1040, margin: '0 auto' }} aria-busy="true">
        <span className="sr-only">กำลังโหลดข้อมูลกะเงินสด…</span>
        <Skeleton height={28} width={260} radius="var(--radius-md)" style={{ marginBottom: 'var(--space-6)' }} />
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
    <div ref={contentRef} className="screen-pad-lg" style={{ padding: 'var(--space-8)', maxWidth: 1040, margin: '0 auto' }}>
      <style>{REC_CSS}</style>
      <h1 className="text-balance max-md:flex max-md:items-center" style={{ fontSize: 22, fontWeight: 700, marginBottom: 'var(--space-6)', color: 'var(--color-text)' }}>
        <Icon name="cash" size={20} style={{ marginRight: 8 }} />
        การเงิน / Cash Session
      </h1>

      {closed && <ClosedResult result={closed} onDismiss={() => setClosed(null)} />}

      {/* No open session */}
      {!session && (
        <div className="pad-phone" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: 28 }}>
          <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 'var(--space-4)' }}>เปิดกะวันนี้</div>
          {admin ? (
            <>
              <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <label htmlFor="cash-open-amount" style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>ยอดเงินเปิดลิ้นชัก (฿)</label>
                  {/* Font size is a class, not an inline style: the global 16px phone rule
                      (no iOS focus-zoom) cannot beat an inline fontSize. */}
                  <input id="cash-open-amount" value={openAmount} onChange={e => setOpenAmount(e.target.value)} type="number" inputMode="decimal" min="0" step="0.01" placeholder="0.00"
                    className="text-[15px]"
                    style={{ width: '100%', minHeight: 44, padding: '10px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-surface-2)', color: 'var(--color-text)', boxSizing: 'border-box' }} />
                </div>
                <div style={{ flex: 2, minWidth: 200 }}>
                  <label htmlFor="cash-open-notes" style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>หมายเหตุ</label>
                  <input id="cash-open-notes" value={openNotes} onChange={e => setOpenNotes(e.target.value)} placeholder="เช่น Opening shift"
                    className="text-[14px]"
                    style={{ width: '100%', minHeight: 44, padding: '10px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-surface-2)', color: 'var(--color-text)', boxSizing: 'border-box' }} />
                </div>
              </div>
              <button onClick={handleOpen} disabled={openSession.isPending} className="pressable full-phone"
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
          <div style={{ display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-5)', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 130, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: '14px 16px' }}>
              <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginBottom: 'var(--space-1)' }}>เปิดลิ้นชักเมื่อ</div>
              <div className="num" style={{ fontSize: 20, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{formatDt(session.opened_at)}</div>
            </div>
            <div style={{ flex: 1, minWidth: 130, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: '14px 16px' }}>
              <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginBottom: 'var(--space-1)' }}>ยอดเปิด (เงินทอนตั้งต้น)</div>
              <StatValue value={Number(session.cash_open)} />
            </div>
            <div style={{ flex: 1, minWidth: 130, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Tag tone={sessionOpen ? 'success' : 'neutral'}>{sessionOpen ? 'เปิดอยู่' : 'ปิดแล้ว'}</Tag>
            </div>
          </div>

          {session.notes && (
            <div style={{ background: 'var(--color-surface-2)', borderRadius: 'var(--radius-md)', padding: '10px 14px', marginBottom: 'var(--space-4)', fontSize: 13, color: 'var(--color-text-secondary)' }}>
              หมายเหตุ: {session.notes}
            </div>
          )}

          {sessionOpen && admin && (
            <ReconcileForm session={session} onClosed={setClosed} onConfigure={navigate ? () => navigate('settings') : undefined} />
          )}
          {sessionOpen && !admin && (
            <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>ปิดกะและกระทบยอดได้เฉพาะผู้จัดการหรือเจ้าของร้าน</div>
          )}

          {/* Legacy single-number close (sessions closed before per-group reconciliation) */}
          {!sessionOpen && session.cash_close != null && (
            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-5)' }}>
              <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>กะปิดแล้ว</div>
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                เปิด {bahtStr(session.cash_open)} → ปิด {bahtStr(session.cash_close)} · ส่วนต่าง{' '}
                <span style={{ fontWeight: 700 }}>{signedBahtStr(subMoney(session.cash_close, session.cash_open))}</span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Close form ────────────────────────────────────────────────────────────────

function ReconcileForm({ session, onClosed, onConfigure }: {
  session: CashSession;
  onClosed: (r: CashSessionDetail) => void;
  onConfigure?: () => void;
}) {
  const toast = useToast();
  const groupsQ = usePaymentGroups();
  const summaryQ = useCashSessionSummary(session.id);
  const closeSession = useCloseCashSession();

  const [draft, setDraft] = useState<Record<string, CloseDraftRow>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const { rows, mismatch } = buildCloseRows(groupsQ.data ?? [], summaryQ.data);
  const totals = closeTotals(rows, draft);
  const built = buildClosePayload(rows, draft);
  const setRow = (name: string, patch: Partial<CloseDraftRow>) =>
    setDraft(d => ({ ...d, [name]: { ...(d[name] ?? { actual: '', notes: '' }), ...patch } }));

  const reload = () => { void groupsQ.refetch(); void summaryQ.refetch(); };

  const review = () => {
    setSubmitted(true);
    if (!built.ok) {
      const first = rows.find(r => !built.ok && built.actual[r.name]);
      if (first) document.getElementById(`rec-actual-${rows.indexOf(first)}`)?.focus();
      return;
    }
    setConfirming(true);
  };

  const submit = async () => {
    if (!built.ok) return;
    try {
      const res = await closeSession.mutateAsync({ sessionId: session.id, payload: built.payload });
      setConfirming(false);
      onClosed(res);
      toast({ kind: 'success', title: 'ปิดกะเสร็จแล้ว', msg: totals.variance ? `ส่วนต่างรวม ${signedBahtStr(totals.variance.value)}` : undefined });
    } catch (e: unknown) {
      setConfirming(false);
      const st = errStatus(e);
      if (st === 409) toast({ kind: 'warning', title: 'กะนี้ถูกปิดไปแล้ว', msg: 'มีคนปิดกะนี้ก่อนหน้า หน้าจอแสดงสถานะล่าสุดแล้ว' });
      else if (st === 422) { reload(); toast({ kind: 'warning', title: 'กลุ่มการชำระเงินไม่ตรงกับการตั้งค่าล่าสุด', msg: 'โหลดกลุ่มและยอดใหม่แล้ว ตรวจยอดอีกครั้งแล้วกดปิดกะ' }); }
      else if (st === 403) toast({ kind: 'danger', title: 'ไม่มีสิทธิ์ปิดกะ', msg: 'เฉพาะผู้จัดการหรือเจ้าของร้าน' });
      else toast({ kind: 'danger', title: 'ปิดกะไม่สำเร็จ', msg: errMsg(e) });
    }
  };

  const loading = groupsQ.isLoading || summaryQ.isLoading;
  const loadError = groupsQ.error ?? summaryQ.error;

  return (
    <section aria-labelledby="rec-title" className="pad-phone" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '16px 16px 12px', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <h2 id="rec-title" style={{ margin: 0, fontWeight: 700, fontSize: 16 }}>ปิดกะ · กระทบยอดตามช่องทางชำระเงิน</h2>
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 2 }}>
            {summaryQ.data
              ? <>ยอดระบบจากออเดอร์ที่ชำระแล้ว {formatDt(summaryQ.data.period_from)} – {formatDt(summaryQ.data.period_to)} น. · นับเงินจริงแล้วกรอกทีละกลุ่ม</>
              : 'นับเงินจริงแล้วกรอกทีละกลุ่ม'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button type="button" onClick={reload} disabled={summaryQ.isFetching} className="pressable"
            style={{ minHeight: 40, padding: '8px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-surface-2)', color: 'var(--color-text)', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon name="refresh" size={14} /> {summaryQ.isFetching ? 'กำลังอัปเดต…' : 'อัปเดตยอด'}
          </button>
          {onConfigure && (
            <button type="button" onClick={onConfigure} className="pressable"
              style={{ minHeight: 40, padding: '8px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-secondary)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              ตั้งค่ากลุ่ม
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div aria-busy="true" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span className="sr-only">กำลังโหลดยอดระบบ…</span>
          {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} height={56} radius="var(--radius-md)" />)}
        </div>
      ) : loadError ? (
        <div role="alert" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', color: 'var(--color-danger)', fontSize: 14 }}>
          {errStatus(loadError) === 403
            ? 'ดูยอดระบบได้เฉพาะผู้จัดการหรือเจ้าของร้าน'
            : errStatus(loadError) === 404 ? 'ไม่พบกะนี้ อาจถูกปิดไปแล้ว' : `โหลดยอดระบบไม่สำเร็จ: ${errMsg(loadError)}`}
          {errStatus(loadError) !== 403 && (
            <button type="button" onClick={reload} className="pressable" style={{ minHeight: 40, padding: '8px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontWeight: 600, cursor: 'pointer' }}>ลองใหม่</button>
          )}
        </div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 16, fontSize: 14, color: 'var(--color-text-secondary)' }}>ร้านยังไม่มีกลุ่มการชำระเงิน — ตั้งค่าที่หน้าตั้งค่าก่อนปิดกะ</div>
      ) : (
        <>
          {mismatch && (
            <div role="alert" style={{ margin: '0 16px 12px', padding: '10px 12px', borderRadius: 'var(--radius-md)', background: 'var(--color-warning-50)', color: 'var(--color-warning-fg)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              กลุ่มการชำระเงินเพิ่งถูกแก้ ยอดระบบยังไม่ตรงกับกลุ่มล่าสุด
              <button type="button" onClick={reload} style={{ minHeight: 36, padding: '6px 12px', borderRadius: 'var(--radius-md)', border: '1px solid currentColor', background: 'transparent', color: 'inherit', fontWeight: 600, cursor: 'pointer' }}>โหลดยอดใหม่</button>
            </div>
          )}
          <div className="rec-grid rec-head" aria-hidden="true">
            <div>กลุ่ม</div>
            <div className="rec-num">ยอดระบบ</div>
            <div className="rec-num">ยอดนับจริง</div>
            <div className="rec-num">ส่วนต่าง</div>
            <div>หมายเหตุ</div>
          </div>
          {rows.map((r, i) => (
            <RecRow key={r.name} index={i} row={r} value={draft[r.name] ?? { actual: '', notes: '' }}
              showError={submitted || !!touched[r.name]}
              noteError={!built.ok ? built.notes[r.name] : undefined}
              onChange={patch => setRow(r.name, patch)}
              onBlur={() => setTouched(t => ({ ...t, [r.name]: true }))} />
          ))}
          <div className="rec-foot">
            <div className="rec-totals" aria-live="polite">
              <div><div>ยอดระบบรวม</div><div>{bahtStr(totals.system)}</div></div>
              <div><div>นับได้รวม</div><div>{totals.complete ? bahtStr(totals.actual) : '—'}</div></div>
              <div>
                <div>ส่วนต่างรวม</div>
                <div className="rec-var" data-tone={totals.variance?.tone} style={{ paddingTop: 0 }}>
                  {totals.variance ? `${signedBahtStr(totals.variance.value)} ${TONE_LABEL[totals.variance.tone]}` : '—'}
                </div>
              </div>
            </div>
            <button type="button" onClick={review} disabled={closeSession.isPending || mismatch} className="pressable"
              style={{ minHeight: 48, padding: '12px 24px', borderRadius: 'var(--radius-md)', background: 'var(--color-danger-strong)', color: '#fff', fontWeight: 700, fontSize: 15, cursor: mismatch ? 'not-allowed' : 'pointer', border: 'none', opacity: mismatch ? 0.5 : 1 }}>
              ตรวจทานและปิดกะ
            </button>
          </div>
        </>
      )}

      {confirming && built.ok && (
        <ModalShell
          title="ยืนยันปิดกะ"
          subtitle="ปิดแล้วแก้ไขไม่ได้ ยอดและส่วนต่างจะถูกบันทึกถาวร"
          onClose={() => setConfirming(false)}
          busy={closeSession.isPending}
          width={520}
          footer={<>
            <button type="button" onClick={() => setConfirming(false)} disabled={closeSession.isPending} className="pressable"
              style={{ minHeight: 44, padding: '10px 20px', borderRadius: 'var(--radius-md)', background: 'var(--color-surface-2)', color: 'var(--color-text)', border: '1px solid var(--color-border)', fontSize: 14, cursor: 'pointer' }}>กลับไปแก้</button>
            <button type="button" onClick={submit} disabled={closeSession.isPending} className="pressable"
              style={{ minHeight: 44, padding: '10px 22px', borderRadius: 'var(--radius-md)', background: 'var(--color-danger-strong)', color: '#fff', border: 'none', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
              {closeSession.isPending ? 'กำลังปิดกะ…' : 'ยืนยันปิดกะ'}
            </button>
          </>}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ color: 'var(--color-text-secondary)', fontSize: 12 }}>
                <th style={{ textAlign: 'left', padding: '6px 0', fontWeight: 600 }}>กลุ่ม</th>
                <th style={{ textAlign: 'right', padding: '6px 0', fontWeight: 600 }}>นับได้</th>
                <th style={{ textAlign: 'right', padding: '6px 0', fontWeight: 600 }}>ส่วนต่าง</th>
              </tr>
            </thead>
            <tbody>
              {built.payload.entries.map(e => {
                const v = variance(e.actual_amount, rows.find(r => r.name === e.group_name)?.systemTotal);
                return (
                  <tr key={e.group_name} style={{ borderTop: '1px solid var(--color-border)' }}>
                    <td style={{ padding: '8px 0', overflowWrap: 'anywhere' }}>{e.group_name}</td>
                    <td className="rec-num" style={{ padding: '8px 0' }}>{bahtStr(e.actual_amount)}</td>
                    <td className="rec-num rec-var" data-tone={v?.tone} style={{ padding: '8px 0' }}>{v ? signedBahtStr(v.value) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ModalShell>
      )}
    </section>
  );
}

function RecRow({ index, row, value, showError, noteError, onChange, onBlur }: {
  index: number;
  row: CloseRow;
  value: CloseDraftRow;
  showError: boolean;
  noteError?: string;
  onChange: (patch: Partial<CloseDraftRow>) => void;
  onBlur: () => void;
}) {
  const check = checkActualAmount(value.actual);
  const v = check.ok ? variance(check.value, row.systemTotal) : null;
  const err = showError && !check.ok ? check.error : null;
  const id = `rec-actual-${index}`;
  return (
    <div className="rec-grid rec-row" data-tone={v && v.tone !== 'even' ? v.tone : undefined} data-group={row.name}>
      <div className="rec-name">
        <div>{row.name}</div>
        <div className="rec-methods">{methodsLabel(row.methods)}</div>
      </div>
      <div className="rec-num rec-sys">
        <span className="rec-label">ยอดระบบ</span>
        {row.systemTotal != null ? bahtStr(row.systemTotal) : '—'}
      </div>
      <div className="rec-actual">
        <label htmlFor={id} className="rec-label">ยอดนับจริง</label>
        <input id={id} className="rec-input num" type="text" inputMode="decimal" autoComplete="off" placeholder="0.00"
          aria-label={`ยอดนับจริง ${row.name}`}
          aria-invalid={err ? true : undefined} aria-describedby={err ? `${id}-err` : undefined}
          value={value.actual} onChange={e => onChange({ actual: e.target.value })} onBlur={onBlur} />
        {err && <div id={`${id}-err`} className="rec-err">{err}</div>}
      </div>
      <div className="rec-num rec-var" data-tone={v?.tone}>
        <span className="rec-label">ส่วนต่าง</span>
        <span aria-label={v ? `ส่วนต่าง ${row.name} ${signedBahtStr(v.value)} ${TONE_LABEL[v.tone]}` : undefined}>
          {v ? <>{signedBahtStr(v.value)} <span style={{ fontSize: 12, fontWeight: 600 }}>{TONE_LABEL[v.tone]}</span></> : '—'}
        </span>
      </div>
      <div className="rec-notes">
        <label htmlFor={`rec-notes-${index}`} className="rec-label">หมายเหตุ</label>
        <input id={`rec-notes-${index}`} className="rec-input" type="text" maxLength={NOTES_MAX}
          aria-label={`หมายเหตุ ${row.name}`}
          placeholder={v && v.tone !== 'even' ? 'เหตุผลของส่วนต่าง' : 'ไม่บังคับ'}
          aria-invalid={noteError ? true : undefined}
          value={value.notes} onChange={e => onChange({ notes: e.target.value })} />
        {noteError && <div className="rec-err">{noteError}</div>}
      </div>
    </div>
  );
}

// ── Close result (from the PATCH response) ───────────────────────────────────

function ClosedResult({ result, onDismiss }: { result: CashSessionDetail; onDismiss: () => void }) {
  const entries: SessionPaymentEntryRead[] = result.entries ?? [];
  // Server-computed variances, summed exactly.
  const total = sumMoney(entries.map(e => e.variance));
  return (
    <section aria-labelledby="rec-done" role="status" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-success)', borderRadius: 'var(--radius-lg)', marginBottom: 'var(--space-5)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 16px', background: 'var(--color-success-50)' }}>
        <div>
          <h2 id="rec-done" style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--color-success)' }}>ปิดกะแล้ว</h2>
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
            {result.closed_at ? `ปิดเมื่อ ${formatDt(result.closed_at)} น.` : ''} · ส่วนต่างรวม <strong>{signedBahtStr(total)}</strong>
          </div>
        </div>
        <button type="button" onClick={onDismiss} aria-label="ซ่อนสรุปการปิดกะ" className="pressable"
          style={{ minHeight: 40, minWidth: 40, display: 'grid', placeItems: 'center', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-secondary)', cursor: 'pointer' }}>
          <Icon name="x" size={16} />
        </button>
      </div>
      <div className="rec-grid rec-head" aria-hidden="true">
        <div>กลุ่ม</div><div className="rec-num">ยอดระบบ</div><div className="rec-num">นับได้</div><div className="rec-num">ส่วนต่าง</div><div>หมายเหตุ</div>
      </div>
      {entries.map((e, i) => {
        const sign = moneySign(e.variance);
        const tone: VarianceTone = sign == null || sign === 0 ? 'even' : sign < 0 ? 'short' : 'over';
        return (
          <div key={e.id ?? i} className="rec-grid rec-row" data-tone={tone !== 'even' ? tone : undefined} data-group={e.group_name}>
            <div className="rec-name"><div>{e.group_name}</div><div className="rec-methods">{methodsLabel(e.methods)}</div></div>
            <div className="rec-num rec-sys"><span className="rec-label">ยอดระบบ</span>{bahtStr(e.system_total)}</div>
            <div className="rec-num rec-sys"><span className="rec-label">นับได้</span>{bahtStr(e.actual_amount)}</div>
            <div className="rec-num rec-var" data-tone={tone}><span className="rec-label">ส่วนต่าง</span>{signedBahtStr(e.variance)} <span style={{ fontSize: 12 }}>{TONE_LABEL[tone]}</span></div>
            <div className="rec-sys" style={{ fontWeight: 400, fontSize: 13, color: 'var(--color-text-secondary)', overflowWrap: 'anywhere' }}><span className="rec-label">หมายเหตุ</span>{e.notes || '—'}</div>
          </div>
        );
      })}
    </section>
  );
}
