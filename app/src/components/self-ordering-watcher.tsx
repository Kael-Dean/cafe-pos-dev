'use client';

import { useEffect, useMemo, useRef } from 'react';
import Icon from './icons';
import { useBoardOrders } from '@/hooks/use-self-ordering';
import { decideChime, isGuestOrder } from '@/lib/self-ordering';
import { useSelfOrderingEnabled } from '@/hooks/use-features';
import { enableAlerts, disableAlerts, playOrderChime, useAlertState } from '@/lib/alert-sound';

/** Renders the watcher only for stores that have the `self_ordering` entitlement. */
export function SelfOrderingMount(props: { current: string; onOpenBoard: () => void }) {
  const { enabled } = useSelfOrderingEnabled();
  return enabled ? <SelfOrderingWatcher {...props} /> : null;
}

/**
 * Mounted ONCE in the app shell (outside the per-screen frame) for stores with
 * `self_ordering`, so a customer's order rings no matter which screen the owner is on —
 * he is usually behind the bar on the POS or the floor plan, not staring at the board.
 *
 * Polling, the chime and the title flash live here; the board screen only renders cards.
 */
export default function SelfOrderingWatcher({ current, onOpenBoard }: { current: string; onOpenBoard: () => void }) {
  const { data } = useBoardOrders(true);
  const alerts = useAlertState();

  const pending = useMemo(
    () => (data ?? []).filter((o) => o.status === 'PENDING' && isGuestOrder(o)),
    [data],
  );
  const pendingIds = useMemo(() => pending.map((o) => o.id), [pending]);

  const announced = useRef<Set<string> | null>(null);
  const lastChimeAt = useRef<number | null>(null);
  const idsRef = useRef<string[]>([]);
  const loaded = !!data;

  useEffect(() => { idsRef.current = pendingIds; }, [pendingIds]);

  // Evaluate when the list changes, and every 5 s so the reminder fires with no new data.
  useEffect(() => {
    if (!loaded) return;
    const evaluate = () => {
      const r = decideChime({
        pendingGuestIds: idsRef.current,
        announced: announced.current,
        now: Date.now(),
        lastChimeAt: lastChimeAt.current,
      });
      announced.current = r.announced;
      if (r.chime) {
        lastChimeAt.current = Date.now();
        void playOrderChime();
      }
    };
    evaluate();
    const id = setInterval(evaluate, 5_000);
    return () => clearInterval(id);
    // pendingIds changes re-run so a new order rings immediately instead of on the next tick.
  }, [loaded, pendingIds]);

  // Flash the tab title: visible from across the bar and in a tab strip.
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\) ออเดอร์ใหม่ · /, '');
    if (pending.length === 0) { document.title = base; return; }
    document.title = `(${pending.length}) ออเดอร์ใหม่ · ${base}`;
    return () => { document.title = base; };
  }, [pending.length]);

  const onBoard = current === 'order-board';
  const showPending = pending.length > 0 && !onBoard;
  const showSoundPrompt = !alerts.armed && !onBoard;

  if (!showPending && !showSoundPrompt) return null;

  return (
    <div className="so-watch" role="region" aria-label="แจ้งเตือนออเดอร์จากลูกค้า">
      <style>{WATCH_CSS}</style>
      {showPending && (
        <button onClick={onOpenBoard} className="so-watch-pending tap-lg">
          <Icon name="bell" size={22} />
          <span>มีออเดอร์ใหม่ <strong className="num">{pending.length}</strong> รายการ — แตะเพื่อดูบอร์ด</span>
        </button>
      )}
      {showSoundPrompt && (
        <button onClick={() => { void enableAlerts(); }} className="so-watch-sound tap-std">
          <Icon name="bell" size={18} />
          <span>{alerts.needsTap ? 'เสียงหยุดทำงาน — แตะเพื่อเปิดใหม่' : 'เปิดเสียงแจ้งเตือนออเดอร์'}</span>
        </button>
      )}
    </div>
  );
}

const WATCH_CSS = `
.so-watch { position: fixed; z-index: 48; /* above the screen (45), below dialogs (50): never covers a payment */ bottom: calc(var(--tabbar-h, 0px) + 16px); left: 50%; transform: translateX(-50%);
  display: flex; flex-direction: column-reverse; gap: 8px; align-items: center; width: max-content; max-width: calc(100vw - 24px); }
.so-watch button { display: inline-flex; align-items: center; gap: 10px; border-radius: 999px; font-weight: 700; font-size: 16px;
  padding: 0 22px; border: 0; cursor: pointer; box-shadow: 0 6px 18px rgba(0,0,0,.28); text-align: left; }
.so-watch-pending { background: var(--color-danger-strong); color: #fff; }
.so-watch-sound { background: var(--color-warning-fg, #7a4b00); color: #fff; }
@media (prefers-reduced-motion: no-preference) {
  .so-watch-pending { animation: so-ring 1.1s ease-in-out infinite; }
}
@keyframes so-ring { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.04); } }
`;

/** Sound + wake-lock control used in the board header. */
export function AlertToggle() {
  const alerts = useAlertState();
  const on = alerts.armed && !alerts.needsTap;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
      <button
        onClick={() => { if (on) disableAlerts(); else void enableAlerts(); }}
        aria-pressed={on}
        className={`btn tap-lg ${on ? 'btn-ghost' : 'btn-primary'}`}
        style={{ fontSize: 'var(--fs-lg, 16px)', fontWeight: 700 }}
      >
        <Icon name="bell" size={20} />
        {on ? 'เสียงแจ้งเตือน: เปิดอยู่' : alerts.needsTap ? 'เสียงหยุด — แตะเพื่อเปิดใหม่' : 'เปิดเสียงแจ้งเตือน'}
      </button>
      <span style={{ fontSize: 'var(--fs-cap)', color: 'var(--color-text-secondary)' }}>
        {alerts.wakeLock === 'on' && 'จอจะไม่ดับขณะเปิดหน้านี้'}
        {alerts.wakeLock === 'unsupported' && alerts.armed && 'จอจะดับเองได้ — เบราว์เซอร์นี้ไม่รองรับการค้างจอ (ต้องใช้ https) ตั้งเวลาปิดจอของแท็บเล็ตให้นานขึ้น'}
        {!alerts.armed && (alerts.wasEnabled ? 'เปิดหน้านี้ใหม่ ต้องแตะอีกครั้งเพื่อให้เสียงดัง' : 'แตะครั้งเดียว เสียงจะดังเมื่อมีออเดอร์ใหม่แม้ไม่ได้แตะจอ')}
      </span>
    </div>
  );
}
