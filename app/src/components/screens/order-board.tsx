'use client';

import { useEffect, useMemo, useState } from 'react';
import Icon from '../icons';
import { ModalShell, useToast } from '../app-common';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertToggle } from '../self-ordering-watcher';
import { NoDefaultPlanBanner } from './self-order-floor';
import { useSelfOrderingEnabled } from '@/hooks/use-features';
import {
  useBoardOrders, useFloorLive, useRejectOrder, useSetOrderStatus, type BoardOrder,
} from '@/hooks/use-self-ordering';
import {
  canReject, decorateBoard, describeError, nextActionFor, type BoardColumn, type DecoratedOrder,
} from '@/lib/self-ordering';

type Card = DecoratedOrder<BoardOrder>;

const COLUMNS: { id: BoardColumn; title: string; empty: string }[] = [
  { id: 'new', title: 'ออเดอร์ใหม่', empty: 'ไม่มีออเดอร์รอรับ' },
  { id: 'making', title: 'กำลังทำ', empty: 'ไม่มีรายการที่กำลังทำ' },
  { id: 'ready', title: 'พร้อมเสิร์ฟ', empty: 'ไม่มีรายการรอเสิร์ฟ' },
];

const REJECT_REASONS = ['ของหมด', 'บาร์ปิดรับออเดอร์', 'ลูกค้ายกเลิก', 'สั่งผิด / สั่งซ้ำ'];

export default function OrderBoard() {
  const toast = useToast();
  const { enabled, isLoading: featureLoading } = useSelfOrderingEnabled();
  const ordersQ = useBoardOrders(enabled);
  const liveQ = useFloorLive(enabled);
  const setStatus = useSetOrderStatus();
  const reject = useRejectOrder();

  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<Card | null>(null);

  // Display clock for "รอมา n นาที" (30 s is plenty).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const cards = useMemo(() => decorateBoard(ordersQ.data ?? []), [ordersQ.data]);

  // sessionId → table name + guest labels, from the 15 s floor poll.
  const sessionInfo = useMemo(() => {
    const m = new Map<string, { table: string; guests: Map<string, string> }>();
    for (const t of liveQ.data ?? []) {
      if (!t.session) continue;
      m.set(t.session.id, { table: t.table.name, guests: new Map(t.session.guests.map((g) => [g.id, g.label])) });
    }
    return m;
  }, [liveQ.data]);

  if (featureLoading) {
    return (
      <div className="screen-pad-lg" aria-busy="true" style={{ padding: 'var(--space-8)' }}>
        <span className="sr-only">กำลังโหลดบอร์ดออเดอร์…</span>
        <Skeleton height={28} width={260} radius="var(--radius-md)" style={{ marginBottom: 'var(--space-6)' }} />
        <Skeleton height={320} radius="var(--radius-lg)" />
      </div>
    );
  }
  if (!enabled) {
    return (
      <Notice title="ร้านนี้ยังไม่ได้เปิดระบบสั่งผ่าน QR" body="ฟีเจอร์ self_ordering ยังไม่ได้เปิดให้ร้านนี้ — ติดต่อผู้ดูแลระบบ" />
    );
  }

  const advance = async (c: Card) => {
    const action = nextActionFor(c.status);
    if (!action || busyId) return;
    setBusyId(c.id);
    try {
      await setStatus.mutateAsync({ orderId: c.id, status: action.to });
    } catch (e) {
      toast({ kind: 'danger', title: 'อัปเดตออเดอร์ไม่สำเร็จ', msg: describeError(e, 'order-status') });
    } finally {
      setBusyId(null);
    }
  };

  const confirmReject = async (reason: string) => {
    if (!rejecting) return;
    const c = rejecting;
    setBusyId(c.id);
    try {
      await reject.mutateAsync({ orderId: c.id, reason });
      toast({ kind: 'success', title: `ปฏิเสธออเดอร์ #${c.displayNo} แล้ว`, msg: 'คืนสต็อกให้อัตโนมัติ' });
      setRejecting(null);
    } catch (e) {
      toast({ kind: 'danger', title: 'ปฏิเสธไม่สำเร็จ', msg: describeError(e, 'reject') });
    } finally {
      setBusyId(null);
    }
  };

  const loading = ordersQ.isLoading;
  const error = ordersQ.isError && !ordersQ.data;
  const counts: Record<BoardColumn, number> = { new: 0, making: 0, ready: 0 };
  for (const c of cards) counts[c.column] += 1;

  return (
    <div className="screen-pad-lg ob-root" style={{ padding: 'var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', minHeight: '100%' }}>
      <style>{BOARD_CSS}</style>

      <header style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h1 className="text-balance" style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>ออเดอร์จากลูกค้า</h1>
          <div role="status" style={{ fontSize: 'var(--fs-sm)', color: 'var(--color-text-secondary)', marginTop: 4 }}>
            รอรับ <strong className="num">{counts.new}</strong> · กำลังทำ <strong className="num">{counts.making}</strong> · รอเสิร์ฟ <strong className="num">{counts.ready}</strong>
            {ordersQ.isFetching && !loading ? ' · กำลังอัปเดต…' : ''}
          </div>
        </div>
        <AlertToggle />
        <button onClick={() => { void ordersQ.refetch(); void liveQ.refetch(); }} className="btn btn-ghost tap-lg">
          <Icon name="refresh" size={20} /> รีเฟรช
        </button>
      </header>

      <NoDefaultPlanBanner />

      {error && (
        <div role="alert" style={{ padding: 'var(--space-4)', borderRadius: 'var(--radius-md)', background: 'var(--color-danger-50)', color: 'var(--color-danger-fg)', fontWeight: 600 }}>
          โหลดออเดอร์ไม่สำเร็จ — {describeError(ordersQ.error, 'order-status')}
          <button onClick={() => { void ordersQ.refetch(); }} className="btn btn-ghost tap-std" style={{ marginLeft: 12 }}>ลองอีกครั้ง</button>
        </div>
      )}
      {ordersQ.isError && ordersQ.data && (
        <div role="status" style={{ fontSize: 'var(--fs-sm)', color: 'var(--color-warning-fg)', fontWeight: 600 }}>
          เชื่อมต่อไม่ได้ชั่วคราว — กำลังแสดงข้อมูลล่าสุด และจะลองใหม่อัตโนมัติ
        </div>
      )}

      {loading ? (
        <div aria-busy="true" className="ob-cols">
          <span className="sr-only">กำลังโหลดออเดอร์…</span>
          {COLUMNS.map((c) => <Skeleton key={c.id} height={260} radius="var(--radius-lg)" />)}
        </div>
      ) : (
        <div className="ob-cols">
          {COLUMNS.map((col) => {
            const list = cards.filter((c) => c.column === col.id);
            return (
              <section key={col.id} aria-label={col.title} className="ob-col">
                <h2 className="ob-col-head" data-col={col.id}>
                  {col.title} <span className="num ob-count">{list.length}</span>
                </h2>
                <div className="ob-list">
                  {list.length === 0 && <div className="ob-empty">{col.empty}</div>}
                  {list.map((c) => (
                    <OrderCard
                      key={c.id}
                      c={c}
                      now={now}
                      info={c.sessionId ? sessionInfo.get(c.sessionId) : undefined}
                      busy={busyId === c.id}
                      locked={!!busyId}
                      onAdvance={() => { void advance(c); }}
                      onReject={() => setRejecting(c)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {rejecting && (
        <RejectModal
          order={rejecting}
          busy={reject.isPending}
          onClose={() => { if (!reject.isPending) setRejecting(null); }}
          onConfirm={(r) => { void confirmReject(r); }}
        />
      )}
    </div>
  );
}

function OrderCard({ c, now, info, busy, locked, onAdvance, onReject }: {
  c: Card;
  now: number;
  info: { table: string; guests: Map<string, string> } | undefined;
  busy: boolean;
  locked: boolean;
  onAdvance: () => void;
  onReject: () => void;
}) {
  const action = nextActionFor(c.status);
  const minutes = Math.max(0, Math.floor((now - c.createdAt) / 60_000));
  const table = info?.table ?? 'โต๊ะ ?';
  const guest = c.guestId ? info?.guests.get(c.guestId) ?? 'แขก' : 'พนักงานสั่งให้';
  const isNew = c.column === 'new';

  return (
    <article className="ob-card" data-new={isNew ? '' : undefined} aria-label={`ออเดอร์ ${c.displayNo} ${table}`}>
      <div className="ob-card-head">
        <span className="ob-table">{table}</span>
        <span className="ob-guest">{guest}</span>
        {c.isNewTable && <span className="ob-badge">NEW TABLE</span>}
        <span className="num ob-meta">#{c.displayNo} · {minutes < 1 ? 'เมื่อสักครู่' : `${minutes} น.`}</span>
      </div>

      <ul className="ob-items">
        {c.items.map((it, i) => (
          <li key={i}>
            <span className="num ob-qty">{it.qty}×</span>
            <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
              {it.name}
              {it.mods.length > 0 && <span className="ob-mods"> · {it.mods.join(', ')}</span>}
            </span>
          </li>
        ))}
        {c.items.length === 0 && <li className="ob-mods">ไม่มีรายการ</li>}
      </ul>

      {c.note && (
        <div className="ob-note">
          <Icon name="info" size={16} />
          <span><strong>โน้ตลูกค้า:</strong> {c.note}</span>
        </div>
      )}

      {action && (
        <div className="ob-actions">
          {canReject(c.status) && (
            <button onClick={onReject} disabled={locked} className="btn btn-ghost tap-xl ob-reject" aria-label={`ปฏิเสธออเดอร์ ${c.displayNo} ${table}`}>
              <Icon name="x" size={20} /> ปฏิเสธ
            </button>
          )}
          <button
            onClick={onAdvance}
            disabled={locked}
            className="btn btn-primary btn-xl ob-go"
            aria-label={`${action.label} ออเดอร์ ${c.displayNo} ${table}`}
          >
            {busy ? <span className="spinner" style={{ width: 20, height: 20 }} aria-hidden /> : <><Icon name="check" size={22} /> {action.label}</>}
          </button>
        </div>
      )}
    </article>
  );
}

function RejectModal({ order, busy, onClose, onConfirm }: {
  order: Card;
  busy: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState(REJECT_REASONS[0]);
  const [custom, setCustom] = useState('');
  const final = (custom.trim() || reason).trim();

  return (
    <ModalShell
      title={`ปฏิเสธออเดอร์ #${order.displayNo}`}
      subtitle="สต็อกจะถูกคืนให้อัตโนมัติ"
      onClose={onClose}
      busy={busy}
      width={480}
      footer={
        <>
          <button onClick={onClose} disabled={busy} className="btn btn-ghost btn-lg tap-lg" style={{ flex: 1 }}>ไม่ปฏิเสธ</button>
          <button
            onClick={() => onConfirm(final)}
            disabled={busy || !final}
            className="btn btn-danger btn-lg tap-lg"
            style={{ flex: 1.5 }}
          >
            {busy ? <span className="spinner" style={{ width: 18, height: 18 }} aria-hidden /> : 'ยืนยันปฏิเสธ'}
          </button>
        </>
      }
    >
      <div role="radiogroup" aria-label="เหตุผล" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--tap-gap)', marginBottom: 'var(--space-4)' }}>
        {REJECT_REASONS.map((r) => {
          const on = !custom.trim() && reason === r;
          return (
            <button
              key={r}
              role="radio"
              aria-checked={on}
              onClick={() => { setReason(r); setCustom(''); }}
              className="tap-std"
              style={{
                padding: '0 18px', borderRadius: 999, fontSize: 'var(--fs-body)', fontWeight: 600, cursor: 'pointer',
                border: `1.5px solid ${on ? 'var(--color-primary)' : 'var(--color-border-strong)'}`,
                background: on ? 'var(--color-primary)' : 'var(--color-surface)',
                color: on ? 'var(--color-text-inverse)' : 'var(--color-text)',
              }}
            >
              {r}
            </button>
          );
        })}
      </div>
      <input
        value={custom}
        onChange={(e) => setCustom(e.target.value)}
        maxLength={200}
        placeholder="หรือพิมพ์เหตุผลเอง"
        aria-label="เหตุผลอื่น"
        className="input-std"
        style={{ width: '100%', boxSizing: 'border-box', minHeight: 'var(--tap-std)' }}
      />
    </ModalShell>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ padding: 'var(--space-8)', maxWidth: 520, margin: '0 auto', textAlign: 'center' }}>
      <div style={{ fontSize: 17, fontWeight: 700 }}>{title}</div>
      <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--color-text-secondary)' }}>{body}</p>
    </div>
  );
}

const BOARD_CSS = `
.ob-cols { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-4); align-items: start; flex: 1; }
.ob-col { min-width: 0; }
.ob-col-head { display: flex; align-items: center; justify-content: space-between; margin: 0 0 var(--space-3); padding: 10px 14px;
  border-radius: var(--radius-md); font-size: 17px; font-weight: 700; background: var(--color-surface-2); }
.ob-col-head[data-col='new'] { background: var(--color-danger-50); color: var(--color-danger-fg); }
.ob-count { min-width: 28px; text-align: center; padding: 2px 8px; border-radius: 999px; background: var(--color-surface); font-size: 15px; }
.ob-list { display: flex; flex-direction: column; gap: var(--space-3); }
.ob-empty { padding: var(--space-6) var(--space-4); text-align: center; color: var(--color-text-secondary); font-size: var(--fs-sm);
  border: 1px dashed var(--color-border-strong); border-radius: var(--radius-lg); }
.ob-card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: var(--space-4);
  display: flex; flex-direction: column; gap: var(--space-3); box-shadow: 0 1px 2px rgba(0,0,0,.06); }
.ob-card[data-new] { border: 2px solid var(--color-danger-strong); }
.ob-card-head { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 10px; }
.ob-table { font-size: 26px; font-weight: 800; line-height: 1.1; }
.ob-guest { font-size: var(--fs-body); font-weight: 600; color: var(--color-text-secondary); min-width: 0; overflow-wrap: anywhere; }
.ob-badge { font-size: 13px; font-weight: 800; letter-spacing: .04em; padding: 3px 10px; border-radius: 999px; background: var(--color-danger-strong); color: #fff; }
.ob-meta { margin-left: auto; font-size: var(--fs-sm); color: var(--color-text-secondary); white-space: nowrap; }
.ob-items { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; font-size: 18px; font-weight: 600; }
.ob-items li { display: flex; gap: 10px; align-items: baseline; }
.ob-qty { min-width: 34px; font-weight: 800; }
.ob-mods { font-weight: 500; color: var(--color-text-secondary); font-size: var(--fs-body); }
.ob-note { display: flex; gap: 8px; align-items: flex-start; padding: 10px 12px; border-radius: var(--radius-md);
  background: var(--color-warning-50); color: var(--color-warning-fg); font-size: var(--fs-body); line-height: 1.45; overflow-wrap: anywhere; }
.ob-note svg { margin-top: 3px; flex-shrink: 0; }
.ob-actions { display: flex; gap: var(--tap-gap); align-items: stretch; min-width: 0; }
.ob-go { flex: 1 1 0; min-width: 0; font-size: 19px; font-weight: 800; justify-content: center; padding-left: 12px; padding-right: 12px; }
.ob-reject { flex: 0 0 auto; padding: 0 16px; }
@media (max-width: 1023px) {
  .ob-cols { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 767px) {
  .ob-root { padding: 12px !important; }
}
`;
