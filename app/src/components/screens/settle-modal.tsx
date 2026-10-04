'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Icon from '../icons';
import { Badge, Banner, Button, EmptyState, Modal, SkeletonText } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { api, ApiError } from '@/lib/api-client';
import { usePayOrder } from '@/hooks/use-orders';
import {
  useBillingPreview, useCloseTableSession,
  type PaymentMethod, type SessionCloseResult, type TableSession,
} from '@/hooks/use-table-sessions';
import { bahtStr, clockTime, formatMinutes } from '@/lib/money';
import PaymentModal, { PaymentNotice, type PayMethod, type PaymentDetails } from './payment-modal';
import { baht } from './payment-cash';
import s from './payment/settle.module.css';

const METHOD_MAP: Record<PayMethod, PaymentMethod> = {
  cash: 'CASH', card: 'CARD', qr: 'QR_PROMPTPAY', line: 'LINE_PAY',
};

interface PreviewOrder { id: string; receiptNo: string; total: number }

const num = (v: string | number | null | undefined) => {
  const n = typeof v === 'number' ? v : parseFloat(v ?? '');
  return Number.isFinite(n) ? n : 0;
};
const sum = (xs: { total: string | number }[]) => Math.round(xs.reduce((a, o) => a + num(o.total) * 100, 0)) / 100;

function errMsg(e: unknown): string {
  if (e instanceof ApiError || e instanceof Error) return e.message;
  return String(e);
}

/**
 * Unpaid orders on this table, READ-ONLY, so opening Settle has no side effect.
 * There is no session-scoped order endpoint yet (backend gap), so this reads the
 * store's PENDING orders and keeps the ones on this session. The authoritative
 * list comes back from `close` once the cashier confirms.
 */
function useSessionUnpaidPreview(sessionId: string, enabled: boolean) {
  return useQuery<PreviewOrder[]>({
    queryKey: ['session-unpaid-preview', sessionId],
    queryFn: async () => {
      const page = await api.get<{ items: { id: string; receipt_no?: string; order_number: number; total: string | number; session_id?: string | null }[] }>(
        '/api/v1/orders?status=PENDING&limit=200',
      );
      return page.items
        .filter((o) => o.session_id === sessionId)
        .map((o) => ({ id: o.id, receiptNo: o.receipt_no ?? String(o.order_number), total: num(o.total) }));
    },
    enabled,
    staleTime: 10_000,
  });
}

/**
 * Table check-out (spec §2.3). Opening it is a PREVIEW: nothing changes on the
 * server until the cashier confirms one tender for the whole tab. There is no
 * combined settle endpoint (backend gap), so confirm runs:
 *
 *   close (stops the clock, mints the time-charge order; idempotent)
 *   → pay each unpaid order in turn with the same method
 *   → close again, which settles the session.
 *
 * Any failure stops the run, reports exactly what was paid and what is still
 * due, and a retry only pays what remains (paid orders are never charged twice).
 */
export default function SettleModal({ session, tableName, onClose }: {
  session: TableSession;
  tableName: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const closeSession = useCloseTableSession();
  const payOrder = usePayOrder();

  // Set once the clock has been stopped by a confirm; from then on it is the truth.
  const [stopped, setStopped] = useState<SessionCloseResult | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [payMethod, setPayMethod] = useState<PayMethod>('cash');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ amount: number; change?: number } | null>(null);
  // Money actually recorded across attempts (a retry after a partial failure adds to it).
  const paidTotal = useRef(0);

  const alive = useRef(true);
  // Re-armed on mount: StrictMode runs mount → cleanup → mount in development.
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const preview = useBillingPreview(session.id, !stopped);
  const orders = useSessionUnpaidPreview(session.id, !stopped);

  const settled = !!stopped?.settled || !!done;
  const timeCharge = stopped?.timeCharge ?? preview.data ?? null;
  // After the stop, the time charge is itself one of the unpaid orders.
  const lines: PreviewOrder[] = stopped
    ? stopped.unpaidOrders.map((o) => ({ id: o.id, receiptNo: o.receiptNo, total: num(o.total) }))
    : orders.data ?? [];
  const due = stopped ? sum(lines) : Math.round((num(timeCharge?.amount) + sum(lines)) * 100) / 100;

  const loading = !stopped && (preview.isPending || orders.isPending);
  const loadError = !stopped && (preview.isError || orders.isError);

  /** Re-read the authoritative state (idempotent close) after a partial failure. */
  const refreshStopped = useCallback(async () => {
    try {
      const fresh = await closeSession.mutateAsync(session.id);
      if (alive.current) setStopped(fresh);
      return fresh;
    } catch {
      return null;
    }
    // closeSession is stable for this component's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  /** The whole tender. Throws a cashier-readable message; PaymentModal shows it inline. */
  const runSettle = useCallback(async (details: PaymentDetails | null, shownTotal: number) => {
    setWorking(true);
    setError(null);
    try {
      const res = await closeSession.mutateAsync(session.id);
      if (!alive.current) return;
      setStopped(res);
      if (res.settled) { setDone({ amount: paidTotal.current }); return; }

      const owed = sum(res.unpaidOrders);
      if (!details || Math.abs(owed - shownTotal) >= 0.01) {
        // The clock moved (or there was nothing to pay but now there is): show the
        // new figure and ask again rather than charging an amount nobody saw.
        if (!details && owed > 0) { setPayOpen(true); return; }
        throw new PaymentNotice(t.payment.settle.totalChanged(baht(owed)));
      }

      const list = res.unpaidOrders;
      let paid = 0;
      for (const o of list) {
        try {
          await payOrder.mutateAsync({
            orderId: o.id,
            payment_method: METHOD_MAP[details.method],
            ...(details.paymentRef ? { payment_ref: details.paymentRef } : {}),
          });
          paid += 1;
          paidTotal.current = Math.round((paidTotal.current + num(o.total)) * 100) / 100;
        } catch (e) {
          const fresh = await refreshStopped();
          const remaining = fresh ? sum(fresh.unpaidOrders) : owed;
          throw new Error(`${t.payment.settle.partial(paid, list.length, baht(remaining))} (${errMsg(e)})`);
        }
      }

      const final = await closeSession.mutateAsync(session.id);
      if (!alive.current) return;
      setStopped(final);
      if (!final.settled) throw new Error(t.payment.settle.notSettled);
      const amount = paidTotal.current;
      setDone({
        amount,
        ...(details.cashGiven != null ? { change: Math.max(0, Math.round((details.cashGiven - amount) * 100) / 100) } : {}),
      });
      // Let the 240ms success tick play, then reveal the summary underneath.
      window.setTimeout(() => { if (alive.current) setPayOpen(false); }, 240);
    } catch (e) {
      if (alive.current && !details) setError(errMsg(e));
      throw e;
    } finally {
      if (alive.current) setWorking(false);
    }
    // closeSession / payOrder are stable mutation objects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, refreshStopped, t]);

  const onPrimary = () => {
    if (due > 0) { setPayOpen(true); return; }
    // Nothing owed by the preview (grace period, no orders): close straight away.
    void runSettle(null, 0).catch(() => { /* shown inline via `error` */ });
  };

  const description = settled
    ? undefined
    : stopped?.session.closedAt
      ? t.payment.settle.stoppedDesc(clockTime(stopped.session.closedAt))
      : t.payment.settle.previewDesc;

  return (
    <>
      <Modal
        open
        onClose={onClose}
        size="md"
        title={t.payment.settle.title(tableName)}
        description={description}
        dismissible={!working}
        closeOnBackdrop={false}
        footer={
          settled ? (
            <Button variant="primary" size="xl" fullWidth icon={<Icon name="check" size={20} />} onClick={onClose}>
              {t.payment.settle.done}
            </Button>
          ) : (
            <div className={s.foot}>
              <Button variant="secondary" size="xl" onClick={onClose} disabled={working} className={s.later}>
                {t.payment.settle.later}
              </Button>
              <Button
                variant="primary"
                size="xl"
                onClick={onPrimary}
                loading={working && !payOpen}
                disabled={loading || loadError || working}
                icon={<Icon name="cash" size={20} />}
                className={s.primary}
              >
                {due > 0 ? <>{t.payment.settle.pay} <span className="num">{baht(due)}</span></> : t.payment.settle.closeFree}
              </Button>
            </div>
          )
        }
      >
        {settled ? (
          <div className={s.done} role="status">
            <Icon name="success" size={28} />
            <p className={s.doneTitle}>{t.payment.settle.settled(tableName)}</p>
            {done && done.amount > 0 && (
              <dl className={s.doneFigures}>
                <div><dt>{t.payment.settle.paidTotal}</dt><dd className="num">{baht(done.amount)}</dd></div>
                {done.change != null && done.change > 0 && (
                  <div><dt>{t.payment.settle.changeDue}</dt><dd className={`num ${s.change}`}>{baht(done.change)}</dd></div>
                )}
              </dl>
            )}
          </div>
        ) : loading ? (
          <div aria-busy="true" aria-label={t.payment.settle.loading} className={s.skeleton}>
            <SkeletonText lines={2} />
            <SkeletonText lines={3} />
          </div>
        ) : loadError ? (
          <EmptyState
            tone="danger"
            title={t.payment.settle.loadFailed}
            body={t.payment.settle.loadFailedBody}
            action={
              <Button variant="secondary" onClick={() => { void preview.refetch(); void orders.refetch(); }}>
                {t.payment.retry}
              </Button>
            }
          />
        ) : (
          <>
            {stopped && !stopped.settled && (
              <Banner tone="warning" icon="clock" title={t.payment.settle.stoppedUnpaid(baht(due))} />
            )}
            {error && <Banner tone="danger" icon="warning" live="alert" title={t.payment.failedTitle} detail={error} />}

            {timeCharge && !stopped && (
              <section className={s.block} aria-label={t.payment.settle.timeCharge}>
                <div className={s.row}>
                  <span className={s.rowLabel}>{t.payment.settle.timeCharge}</span>
                  <span className={`num ${s.rowValue}`}>{bahtStr(timeCharge.amount)}</span>
                </div>
                <p className={s.meta}>
                  {t.payment.settle.timeDetail(formatMinutes(timeCharge.rawMinutes), formatMinutes(timeCharge.billableMinutes), session.partySize)}
                  {' · '}{session.rateSnapshot.name}
                </p>
                {(timeCharge.withinGrace || timeCharge.capApplied) && (
                  <div className={s.badges}>
                    {timeCharge.withinGrace && <Badge tone="info">{t.payment.settle.withinGrace}</Badge>}
                    {timeCharge.capApplied && <Badge tone="success">{t.payment.settle.capApplied}</Badge>}
                  </div>
                )}
              </section>
            )}

            <section className={s.block} aria-label={t.payment.settle.orders(lines.length)}>
              <p className={s.blockTitle}>{t.payment.settle.orders(lines.length)}</p>
              {lines.length === 0 ? (
                <p className={s.meta}>{t.payment.settle.noOrders}</p>
              ) : (
                <ul className={s.list}>
                  {lines.map((o) => (
                    <li key={o.id} className={s.row}>
                      <span className={`num ${s.receiptNo}`}>#{o.receiptNo}</span>
                      <span className={`num ${s.rowValue}`}>{baht(o.total)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <div className={s.total} aria-live="polite">
              <span>{t.payment.settle.grandTotal}</span>
              <span className={`num ${s.totalValue}`}>{baht(due)}</span>
            </div>
            {!stopped && <p className={s.meta}>{t.payment.settle.estimate}</p>}
          </>
        )}
      </Modal>

      {payOpen && (
        <PaymentModal
          method={payMethod}
          total={due}
          billLabel={t.payment.settle.title(tableName)}
          onMethodChange={setPayMethod}
          onClose={() => { if (!working) setPayOpen(false); }}
          onPaid={(details) => runSettle(details, due)}
        />
      )}
    </>
  );
}
