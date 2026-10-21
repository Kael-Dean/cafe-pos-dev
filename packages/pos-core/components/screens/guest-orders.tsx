'use client';

import { useEffect, useMemo, useState } from 'react';
import Icon from '../icons';
import { ModalShell, useToast } from '../app-common';
import { Skeleton } from '@pos/core/components/ui/skeleton';
import { ApiError } from '@pos/core/lib/api-client';
import { useHasFeature, FEATURE_SELF_ORDERING } from '@pos/core/hooks/use-features';
import {
  NEXT_STATUS, REJECT_REASONS, useAdvanceBarOrder, useBarOrders, useRejectBarOrder,
  type BoardOrder, type BoardStatus,
} from '@pos/core/hooks/use-guest-orders';
import { indexGuests, indexSessions, useFloorLive } from '@pos/core/hooks/use-floor-live';
import { useBarAlerts } from '@pos/core/hooks/use-bar-alerts';
import { newTableOrderIds, olderOrdersFromFloor } from '@pos/core/lib/table-ordering/new-table';
import { toSessionOrder, unpaidBySession } from '../bar/bar-watcher';
import { playOrderAlert, unlockAudio, wakeLockSupported } from '@pos/core/lib/table-ordering/alert-sound';
import { bahtStr } from '@pos/core/lib/money';
import { EmptyState } from './floor';

/**
 * Bar order board (mode Operate — the owner's main screen on the bar tablet,
 * landscape). Three lanes left → right in the order a drink moves:
 * รอรับ (PENDING) → กำลังทำ (IN_PROGRESS) → พร้อมเสิร์ฟ (READY). One big action per
 * card; reject asks for a reason. Data and alerts come from the shared watcher
 * (components/bar/bar-watcher.tsx) — this screen only renders and acts.
 */

const LANES: { status: BoardStatus; title: string; empty: string }[] = [
  { status: 'PENDING', title: 'รอรับออเดอร์', empty: 'ยังไม่มีออเดอร์ใหม่ — ออเดอร์ที่ลูกค้าสั่งจาก QR จะขึ้นที่นี่พร้อมเสียงเตือน' },
  { status: 'IN_PROGRESS', title: 'กำลังทำ', empty: 'กด “รับออเดอร์” แล้วการ์ดจะย้ายมาที่นี่' },
  { status: 'READY', title: 'พร้อมเสิร์ฟ', empty: 'ทำเสร็จแล้วกด “เสร็จแล้ว” เพื่อรอเสิร์ฟ' },
];

const ACTION_LABEL: Record<BoardStatus, string> = {
  PENDING: 'รับออเดอร์',
  IN_PROGRESS: 'เสร็จแล้ว',
  READY: 'เสิร์ฟแล้ว',
};

export default function GuestOrders() {
  const { enabled, isLoading: featureLoading } = useHasFeature(FEATURE_SELF_ORDERING);
  if (featureLoading) return <BoardSkeleton />;
  if (!enabled) {
    return (
      <EmptyState
        icon="info"
        title="ร้านนี้ยังไม่ได้เปิดใช้การสั่งผ่าน QR"
        body="ฟีเจอร์ self_ordering ยังไม่ได้เปิดให้ร้านนี้ — ติดต่อผู้ดูแลระบบ FRD"
      />
    );
  }
  return <Board />;
}

function Board() {
  const toast = useToast();
  const realtime = useBarAlerts((s) => s.realtime);
  const firstOrders = useBarAlerts((s) => s.firstOrders);
  const ordersQ = useBarOrders(true, realtime === 'live' ? 20_000 : 5_000);
  const liveQ = useFloorLive(true);
  const advance = useAdvanceBarOrder();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectFor, setRejectFor] = useState<BoardOrder | null>(null);

  // Ages on the cards: re-render every 30 s.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const sessions = useMemo(() => indexSessions(liveQ.data), [liveQ.data]);
  const guests = useMemo(() => indexGuests(liveQ.data), [liveQ.data]);
  const orders = useMemo(
    // Counter orders sit in PENDING only while they wait for payment at the till;
    // the bar lane is for table orders. Paid counter orders still show once made.
    () => (ordersQ.data ?? []).filter((o) => o.status !== 'PENDING' || o.sessionId),
    [ordersQ.data],
  );
  const newTable = useMemo(
    () => newTableOrderIds(firstOrders, orders.map(toSessionOrder), olderOrdersFromFloor(unpaidBySession(liveQ.data))),
    [firstOrders, orders, liveQ.data],
  );

  const byLane = useMemo(() => {
    const m: Record<BoardStatus, BoardOrder[]> = { PENDING: [], IN_PROGRESS: [], READY: [] };
    for (const o of orders) m[o.status].push(o);
    // Oldest first: the order that has waited longest is served first.
    for (const k of Object.keys(m) as BoardStatus[]) m[k].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    return m;
  }, [orders]);

  const tableOf = (o: BoardOrder) => o.tableName ?? (o.sessionId ? sessions.get(o.sessionId)?.name ?? null : null);
  const guestOf = (o: BoardOrder) => o.guestLabel ?? (o.guestId ? guests.get(o.guestId)?.guest.label ?? null : null);

  const act = async (o: BoardOrder) => {
    if (busyId) return;
    setBusyId(o.id);
    try {
      await advance.mutateAsync({ orderId: o.id, status: NEXT_STATUS[o.status] });
    } catch (e) {
      const conflict = e instanceof ApiError && (e.status === 409 || e.status === 422);
      toast({
        kind: 'danger',
        title: conflict ? 'ออเดอร์นี้เปลี่ยนสถานะไปแล้ว' : 'อัปเดตสถานะไม่สำเร็จ',
        msg: conflict ? 'รีเฟรชรายการให้แล้ว' : 'เช็คอินเทอร์เน็ตแล้วลองอีกครั้ง',
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="screen-pad gob-root">
      <style>{BOARD_CSS}</style>
      <header className="gob-head">
        <h1 className="page-title" style={{ margin: 0, fontSize: 'var(--fs-h2)', fontWeight: 700 }}>ออเดอร์จากโต๊ะ</h1>
        <AlertControls />
      </header>

      {ordersQ.isError && (
        <div role="alert" className="gob-error">
          <Icon name="wifiOff" size={18} />
          <span>โหลดออเดอร์ไม่ได้ — กำลังลองใหม่อัตโนมัติ{ordersQ.data ? ' (รายการด้านล่างอาจไม่ล่าสุด)' : ''}</span>
          <button className="btn btn-ghost tap-std" onClick={() => { void ordersQ.refetch(); }}>ลองอีกครั้ง</button>
        </div>
      )}

      <div className="gob-lanes">
        {LANES.map((lane) => {
          const list = byLane[lane.status];
          return (
            <section key={lane.status} className="gob-lane" aria-labelledby={`lane-${lane.status}`} data-status={lane.status}>
              <h2 id={`lane-${lane.status}`} className="gob-lane-title">
                {lane.title}
                <span className="gob-count num" data-has={list.length > 0 || undefined} aria-label={`${list.length} รายการ`}>{list.length}</span>
              </h2>
              <div className="gob-lane-body scroll">
                {ordersQ.isLoading && <><Skeleton height={168} radius="var(--radius-lg)" /><Skeleton height={140} radius="var(--radius-lg)" /></>}
                {!ordersQ.isLoading && list.length === 0 && <p className="gob-empty">{lane.empty}</p>}
                {list.map((o) => (
                  <OrderCard
                    key={o.id}
                    order={o}
                    table={tableOf(o)}
                    guest={guestOf(o)}
                    isNewTable={newTable.has(o.id)}
                    now={now}
                    busy={busyId === o.id}
                    disabled={!!busyId && busyId !== o.id}
                    onAction={() => { void act(o); }}
                    onReject={o.status === 'PENDING' ? () => setRejectFor(o) : undefined}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {rejectFor && (
        <RejectModal order={rejectFor} table={tableOf(rejectFor)} guest={guestOf(rejectFor)} onClose={() => setRejectFor(null)} />
      )}
    </div>
  );
}

// ── Sound / wake lock / connection ───────────────────────────────────────────
function AlertControls() {
  const { soundOn, audioUnlocked, wakeWanted, wakeActive, realtime, setSoundOn, setWakeWanted } = useBarAlerts();
  const canWake = wakeLockSupported();
  const ready = soundOn && audioUnlocked;

  return (
    <div className="gob-controls" role="group" aria-label="เสียงเตือนและหน้าจอ">
      <span className="gob-conn" data-live={realtime === 'live' || undefined}>
        <span className="gob-conn-dot" aria-hidden />
        {realtime === 'live' ? 'เรียลไทม์' : 'อัปเดตทุก 5 วินาที'}
      </span>

      {soundOn && !audioUnlocked ? (
        // Browsers keep audio locked until a gesture: this tap is that gesture.
        <button className="btn btn-accent tap-lg gob-sound-cta" onClick={() => { void unlockAudio().then((ok) => { if (ok) playOrderAlert(0.6); }); }}>
          <Icon name="bell" size={18} /> แตะเพื่อเปิดเสียงเตือน
        </button>
      ) : (
        <button
          className="btn btn-ghost tap-lg"
          aria-pressed={soundOn}
          onClick={() => { const v = !soundOn; setSoundOn(v); if (v) void unlockAudio(); }}
          data-on={ready || undefined}
        >
          <Icon name="bell" size={18} />
          {ready ? 'เสียงเตือน: เปิด' : 'เสียงเตือน: ปิด'}
        </button>
      )}

      {ready && (
        <button className="btn btn-ghost tap-lg" onClick={() => playOrderAlert()}>ทดสอบเสียง</button>
      )}

      <button
        className="btn btn-ghost tap-lg"
        aria-pressed={wakeWanted}
        disabled={!canWake}
        title={canWake ? undefined : 'เบราว์เซอร์นี้ไม่รองรับการกันจอดับ'}
        onClick={() => setWakeWanted(!wakeWanted)}
        data-on={wakeActive || undefined}
      >
        <Icon name="sun" size={18} />
        {!canWake ? 'กันจอดับ: ไม่รองรับ' : wakeActive ? 'จอไม่ดับ: เปิด' : wakeWanted ? 'จอไม่ดับ: กำลังขอ…' : 'จอไม่ดับ: ปิด'}
      </button>
    </div>
  );
}

// ── Card ─────────────────────────────────────────────────────────────────────
function OrderCard({ order, table, guest, isNewTable, now, busy, disabled, onAction, onReject }: {
  order: BoardOrder;
  table: string | null;
  guest: string | null;
  isNewTable: boolean;
  now: number;
  busy: boolean;
  disabled: boolean;
  onAction: () => void;
  onReject?: () => void;
}) {
  const mins = Math.max(0, Math.floor((now - Date.parse(order.createdAt)) / 60_000));
  const late = order.status === 'PENDING' ? mins >= 3 : mins >= 15;
  const title = table ? `โต๊ะ ${table}` : order.sessionId ? 'โต๊ะ' : `#${order.number}`;

  return (
    <article className="gob-card rise-in" data-status={order.status} aria-label={`${title}${guest ? ` ${guest}` : ''} ออเดอร์ #${order.number}`}>
      <div className="gob-card-head">
        <span className="gob-table">{title}</span>
        {guest && <span className="gob-guest">{guest}</span>}
        {!order.fromGuest && order.sessionId && <span className="gob-tag">ร้านสั่ง</span>}
        <span className="gob-age num" data-late={late || undefined}>
          <Icon name="clock" size={14} />{mins < 1 ? 'เมื่อกี้' : `${mins} นาที`}
        </span>
      </div>
      {isNewTable && (
        <div className="gob-newtable"><Icon name="star" size={14} /> โต๊ะใหม่ · ออเดอร์แรกของโต๊ะนี้</div>
      )}

      <ul className="gob-items">
        {order.items.map((it, i) => (
          <li key={i}>
            <span className="gob-qty num">{it.qty}×</span>
            <span style={{ minWidth: 0 }}>
              <span className="gob-item-name">{it.name}</span>
              {it.mods.length > 0 && <span className="gob-mods">{it.mods.join(' · ')}</span>}
            </span>
          </li>
        ))}
      </ul>

      {order.note && (
        <p className="gob-note"><Icon name="pencil" size={14} /><span>{order.note}</span></p>
      )}

      <div className="gob-card-foot">
        <span className="gob-meta num">#{order.number} · {bahtStr(order.total)}</span>
        <div className="gob-actions">
          {onReject && (
            <button className="btn btn-ghost tap-lg gob-reject" onClick={onReject} disabled={busy || disabled}>ปฏิเสธ</button>
          )}
          <button
            className={`btn tap-pay ${order.status === 'PENDING' ? 'btn-primary' : 'btn-accent'}`}
            onClick={onAction}
            disabled={busy || disabled}
            aria-busy={busy || undefined}
          >
            {busy ? <span className="spinner" style={{ width: 18, height: 18 }} aria-hidden /> : <><Icon name="check" size={20} /> {ACTION_LABEL[order.status]}</>}
          </button>
        </div>
      </div>
    </article>
  );
}

// ── Reject with a reason ─────────────────────────────────────────────────────
const OTHER = '__other__';

function RejectModal({ order, table, guest, onClose }: { order: BoardOrder; table: string | null; guest: string | null; onClose: () => void }) {
  const toast = useToast();
  const reject = useRejectBarOrder();
  const [choice, setChoice] = useState<string>(REJECT_REASONS[0]);
  const [other, setOther] = useState('');
  const [error, setError] = useState<string | null>(null);
  const reason = choice === OTHER ? other.trim() : choice;

  const submit = async () => {
    if (!reason || reject.isPending) return;
    setError(null);
    try {
      await reject.mutateAsync({ orderId: order.id, reason });
      toast({ kind: 'success', title: 'ปฏิเสธออเดอร์แล้ว', msg: 'ลูกค้าจะเห็นว่า “บาร์ยกเลิกรายการนี้”' });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ปฏิเสธไม่สำเร็จ ลองอีกครั้ง');
    }
  };

  return (
    <ModalShell
      title="ปฏิเสธออเดอร์"
      subtitle={[table && `โต๊ะ ${table}`, guest, `#${order.number}`].filter(Boolean).join(' · ')}
      onClose={onClose}
      busy={reject.isPending}
      width={520}
      footer={<>
        <button className="btn btn-ghost btn-lg tap-lg" style={{ flex: 1 }} onClick={onClose}>ไม่ปฏิเสธ</button>
        <button className="btn btn-danger btn-lg tap-lg" style={{ flex: 1.4 }} onClick={() => { void submit(); }} disabled={!reason || reject.isPending}>
          {reject.isPending ? <span className="spinner" style={{ width: 18, height: 18 }} aria-hidden /> : 'ปฏิเสธออเดอร์นี้'}
        </button>
      </>}
    >
      <p style={{ margin: '0 0 var(--space-3)', fontSize: 'var(--fs-sm)', color: 'var(--color-text-secondary)' }}>
        {order.items.map((it) => `${it.qty}× ${it.name}`).join(', ')}
      </p>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, marginBottom: 'var(--space-2)' }}>เหตุผล</legend>
        <div className="gob-reasons">
          {[...REJECT_REASONS, OTHER].map((r) => (
            <label key={r} className="gob-reason tap-lg" data-checked={choice === r || undefined}>
              <input type="radio" name="reject-reason" value={r} checked={choice === r} onChange={() => setChoice(r)} />
              {r === OTHER ? 'อื่น ๆ' : r}
            </label>
          ))}
        </div>
      </fieldset>
      {choice === OTHER && (
        <input
          className="input-std"
          aria-label="เหตุผลอื่น"
          placeholder="พิมพ์เหตุผล"
          value={other}
          maxLength={200}
          autoFocus
          onChange={(e) => setOther(e.target.value)}
          style={{ width: '100%', marginTop: 'var(--space-3)', minHeight: 'var(--tap-std)', boxSizing: 'border-box', fontSize: 'var(--fs-lg)' }}
        />
      )}
      <p style={{ margin: 'var(--space-3) 0 0', fontSize: 'var(--fs-cap)', color: 'var(--color-text-secondary)' }}>
        ของที่ตัดสต็อกไปแล้วจะคืนเข้าสต็อกให้อัตโนมัติ
      </p>
      {error && <div role="alert" className="gob-error" style={{ marginTop: 'var(--space-3)' }}>{error}</div>}
    </ModalShell>
  );
}

function BoardSkeleton() {
  return (
    <div className="screen-pad" style={{ padding: 24 }} aria-busy="true">
      <span className="sr-only">กำลังโหลดออเดอร์…</span>
      <Skeleton height={28} width={240} radius="var(--radius-md)" style={{ marginBottom: 20 }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        {[0, 1, 2].map((i) => <Skeleton key={i} height={320} radius="var(--radius-lg)" />)}
      </div>
    </div>
  );
}

const BOARD_CSS = `
.gob-root { height: 100%; display: flex; flex-direction: column; padding: 20px 24px; box-sizing: border-box; gap: 16px; background: var(--color-bg); }
.gob-head { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.gob-controls { margin-left: auto; display: flex; align-items: center; gap: var(--tap-gap); flex-wrap: wrap; }
.gob-controls .btn[data-on] { border-color: var(--color-success); color: color-mix(in srgb, var(--color-success) 68%, var(--color-text)); }
.gob-sound-cta { box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-accent) 35%, transparent); }
.gob-conn { display: inline-flex; align-items: center; gap: 8px; font-size: var(--fs-sm); color: var(--color-text-secondary); padding: 0 8px; }
.gob-conn-dot { width: 8px; height: 8px; border-radius: 999px; background: var(--color-text-muted); }
.gob-conn[data-live] .gob-conn-dot { background: var(--color-success); }
.gob-error { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-radius: var(--radius-md); background: var(--color-danger-50); color: var(--color-danger-fg); font-size: var(--fs-sm); font-weight: 600; }
.gob-error .btn { margin-left: auto; }

.gob-lanes { flex: 1; min-height: 0; display: grid; grid-template-columns: 1.15fr 1fr 1fr; gap: 16px; }
.gob-lane { min-height: 0; display: flex; flex-direction: column; background: var(--color-surface-2); border-radius: var(--radius-xl); padding: 12px; }
.gob-lane-title { display: flex; align-items: center; gap: 8px; margin: 2px 4px 12px; font-size: var(--fs-lg); font-weight: 700; color: var(--color-text); }
.gob-count { min-width: 28px; height: 28px; padding: 0 8px; border-radius: 999px; display: inline-grid; place-items: center; font-size: var(--fs-sm); background: var(--color-surface); color: var(--color-text-secondary); border: var(--hairline); }
.gob-lane[data-status='PENDING'] .gob-count[data-has] { background: var(--color-primary); color: var(--color-text-inverse); border-color: transparent; }
.gob-lane-body { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; padding: 2px; }
.gob-empty { margin: 8px 6px; font-size: var(--fs-sm); line-height: 1.6; color: var(--color-text-secondary); }

.gob-card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 14px 14px 12px; display: flex; flex-direction: column; gap: 10px; box-shadow: 0 1px 2px rgb(0 0 0 / 0.04); }
.gob-card[data-status='PENDING'] { border: 2px solid var(--color-accent); background: color-mix(in srgb, var(--color-accent-50) 60%, var(--color-surface)); padding: 13px 13px 11px; }
.gob-card-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.gob-table { font-size: 22px; font-weight: 800; line-height: 1.15; letter-spacing: -0.01em; }
.gob-guest { font-size: var(--fs-body); font-weight: 600; padding: 2px 10px; border-radius: 999px; background: var(--color-surface-2); overflow-wrap: anywhere; }
.gob-tag { font-size: var(--fs-cap); font-weight: 600; color: var(--color-text-secondary); padding: 2px 8px; border: var(--hairline); border-radius: 999px; }
.gob-age { margin-left: auto; display: inline-flex; align-items: center; gap: 4px; font-size: var(--fs-sm); color: var(--color-text-secondary); white-space: nowrap; }
.gob-age[data-late] { color: var(--color-warning-fg); font-weight: 700; }
.gob-newtable { align-self: flex-start; display: inline-flex; align-items: center; gap: 6px; font-size: var(--fs-cap); font-weight: 800; padding: 4px 10px; border-radius: 999px; background: var(--color-primary); color: var(--color-text-inverse); }
.gob-items { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.gob-items li { display: flex; gap: 10px; align-items: baseline; }
.gob-qty { font-size: var(--fs-lg); font-weight: 800; min-width: 30px; }
.gob-item-name { display: block; font-size: var(--fs-lg); font-weight: 600; line-height: 1.3; overflow-wrap: anywhere; }
.gob-mods { display: block; font-size: var(--fs-sm); color: var(--color-text-secondary); line-height: 1.4; }
.gob-note { margin: 0; display: flex; gap: 8px; align-items: flex-start; padding: 8px 10px; border-radius: var(--radius-md); background: var(--color-warning-50); color: var(--color-warning-fg); font-size: var(--fs-body); font-weight: 600; line-height: 1.45; overflow-wrap: anywhere; }
.gob-note svg { flex-shrink: 0; margin-top: 3px; }
.gob-card-foot { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding-top: 2px; }
.gob-meta { font-size: var(--fs-cap); color: var(--color-text-secondary); }
.gob-actions { margin-left: auto; display: flex; gap: var(--tap-gap); }
.gob-actions .tap-pay { min-width: 148px; font-size: var(--fs-lg); font-weight: 700; }
.gob-reject { color: var(--color-danger-fg); }

.gob-reasons { display: grid; grid-template-columns: 1fr 1fr; gap: var(--tap-gap); }
.gob-reason { display: flex; align-items: center; gap: 10px; padding: 0 14px; border-radius: var(--radius-md); border: var(--hairline); background: var(--color-surface); font-size: var(--fs-body); cursor: pointer; }
.gob-reason[data-checked] { border-color: var(--color-primary); box-shadow: inset 0 0 0 1px var(--color-primary); font-weight: 600; }
.gob-reason input { width: 18px; height: 18px; accent-color: var(--color-primary); margin: 0; }
.gob-reason:has(input:focus-visible) { outline: 2px solid var(--color-focus-ring); outline-offset: 2px; }

@media (max-width: 1100px) { .gob-lanes { grid-template-columns: 1fr 1fr; } .gob-lane[data-status='READY'] { grid-column: 1 / -1; } }
@media (max-width: 767px) {
  .gob-root { height: auto; padding: var(--screen-pad); }
  .gob-lanes { grid-template-columns: 1fr; }
  .gob-lane-body { overflow: visible; }
  .gob-controls { margin-left: 0; width: 100%; }
  .gob-actions { width: 100%; }
  .gob-actions .tap-pay { flex: 1; }
  .gob-reasons { grid-template-columns: 1fr; }
}
`;
