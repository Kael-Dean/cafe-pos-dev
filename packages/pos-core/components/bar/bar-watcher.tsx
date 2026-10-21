'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import Icon from '../icons';
import { useToast } from '../app-common';
import { useHasFeature, FEATURE_SELF_ORDERING } from '@pos/core/hooks/use-features';
import { useCurrentUser } from '@pos/core/hooks/use-current-user';
import { BAR_ORDERS_KEY, useBarOrders, type BoardOrder } from '@pos/core/hooks/use-guest-orders';
import { FLOOR_LIVE_KEY, indexGuests, indexSessions, useFloorLive, type LiveTable } from '@pos/core/hooks/use-floor-live';
import { useBarAlerts } from '@pos/core/hooks/use-bar-alerts';
import { newPendingGuestOrders, olderOrdersFromFloor, pruneFirstOrders, rememberFirstOrders } from '@pos/core/lib/table-ordering/new-table';
import {
  installAudioUnlock, isAudioUnlocked, onAudioUnlockChange, playOrderAlert, requestWakeLock,
} from '@pos/core/lib/table-ordering/alert-sound';
import { pusherConfig, subscribeChannel } from '@pos/core/lib/realtime/pusher-socket';

/** Screen id of the order board (registered in CORE_SCREENS / CORE_NAV). */
export const GUEST_ORDERS_SCREEN = 'guest-orders';

/** Replay the alert while a guest order still waits to be accepted. */
const REMIND_AFTER_MS = 90_000;

/**
 * Mounted once by the shell for every logged-in screen. For `self_ordering` stores
 * it keeps the order board query polling (5 s, 20 s while the Pusher socket is
 * live), plays the loud alert for every new PENDING guest order wherever the owner
 * is in the app, holds the screen wake lock, and shows a banner with a jump to the
 * board when he is on another screen. Renders nothing for other stores.
 */
export function BarWatcher({ screen, navigate }: { screen: string; navigate: (s: string) => void }) {
  const { enabled } = useHasFeature(FEATURE_SELF_ORDERING);
  if (!enabled) return null;
  return <BarWatcherOn screen={screen} navigate={navigate} />;
}

function BarWatcherOn({ screen, navigate }: { screen: string; navigate: (s: string) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  // The toast pusher is not guaranteed stable; the socket must not reconnect per render.
  const toastRef = useRef(toast);
  useEffect(() => { toastRef.current = toast; });
  const { data: me } = useCurrentUser();
  const realtime = useBarAlerts((s) => s.realtime);
  const soundOn = useBarAlerts((s) => s.soundOn);
  const wakeWanted = useBarAlerts((s) => s.wakeWanted);
  const unseen = useBarAlerts((s) => s.unseen);

  const ordersQ = useBarOrders(true, realtime === 'live' ? 20_000 : 5_000);
  const liveQ = useFloorLive(true, realtime === 'live' ? 30_000 : 15_000);

  // ── Audio unlock on the first gesture anywhere ─────────────────────────────
  useEffect(() => {
    const st = useBarAlerts.getState();
    st.setAudioUnlocked(isAudioUnlocked());
    const off = onAudioUnlockChange((u) => useBarAlerts.getState().setAudioUnlocked(u));
    const uninstall = installAudioUnlock();
    return () => { off(); uninstall(); useBarAlerts.getState().clearUnseen(); };
  }, []);

  // ── Realtime: invalidate on events, polling stays as the floor ─────────────
  const storeId = me?.store_id ?? null;
  useEffect(() => {
    const cfg = pusherConfig();
    if (!cfg || !storeId) { useBarAlerts.getState().setRealtime('off'); return; }
    return subscribeChannel(cfg, `kds-store-${storeId}`, {
      onStatus: (s) => useBarAlerts.getState().setRealtime(s),
      onEvent: (event, data) => {
        if (event === 'order.created' || event === 'order.status_changed' || event === 'order.voided') {
          void qc.invalidateQueries({ queryKey: BAR_ORDERS_KEY });
          void qc.invalidateQueries({ queryKey: ['kds-orders'] });
        }
        if (event === 'guest.checkout_requested') {
          void qc.invalidateQueries({ queryKey: FLOOR_LIVE_KEY });
          const label = (data as { label?: string } | null)?.label;
          toastRef.current({ kind: 'info', title: 'มีแขกขอเช็คบิล', msg: label ? `${label} — ดูที่หน้าผังโต๊ะ` : 'ดูที่หน้าผังโต๊ะ' });
        }
      },
    });
  }, [storeId, qc]);

  // ── New PENDING guest orders → alert ───────────────────────────────────────
  const sessions = useMemo(() => indexSessions(liveQ.data), [liveQ.data]);
  const guests = useMemo(() => indexGuests(liveQ.data), [liveQ.data]);
  const prevIds = useRef<Set<string> | null>(null);
  const lastAlert = useRef(0);

  useEffect(() => {
    const orders = ordersQ.data;
    if (!orders) return;
    const fresh = newPendingGuestOrders(prevIds.current, orders);
    prevIds.current = new Set(orders.map((o) => o.id));

    // NEW TABLE memory: record first orders, drop closed sessions.
    const st = useBarAlerts.getState();
    const open = liveQ.data ? new Set(liveQ.data.flatMap((t) => (t.session ? [t.session.id] : []))) : null;
    const older = olderOrdersFromFloor(unpaidBySession(liveQ.data));
    st.setFirstOrders(pruneFirstOrders(rememberFirstOrders(st.firstOrders, orders.map(toSessionOrder), older), open));

    if (!fresh.length) return;
    st.pushUnseen(fresh.map((o) => ({
      id: o.id,
      tableName: o.tableName ?? (o.sessionId ? sessions.get(o.sessionId)?.name ?? null : null),
      guestLabel: o.guestLabel ?? (o.guestId ? guests.get(o.guestId)?.guest.label ?? null : null),
      at: Date.now(),
    })));
    if (st.soundOn) { playOrderAlert(); lastAlert.current = Date.now(); }
  }, [ordersQ.data, liveQ.data, sessions, guests]);

  // Reminder while a guest order still sits in PENDING.
  useEffect(() => {
    if (!soundOn) return;
    const id = setInterval(() => {
      const orders = qc.getQueryData<BoardOrder[]>(BAR_ORDERS_KEY) ?? [];
      const now = Date.now();
      const waiting = orders.some((o) => o.status === 'PENDING' && o.guestId && now - Date.parse(o.createdAt) > REMIND_AFTER_MS);
      if (waiting && now - lastAlert.current > REMIND_AFTER_MS) { playOrderAlert(0.7); lastAlert.current = now; }
    }, 15_000);
    return () => clearInterval(id);
  }, [soundOn, qc]);

  // ── Screen wake lock (re-acquired whenever the page becomes visible) ───────
  useEffect(() => {
    if (!wakeWanted) { useBarAlerts.getState().setWakeActive(false); return; }
    let lock: { release: () => Promise<void> } | null = null;
    let cancelled = false;
    const acquire = async () => {
      if (document.visibilityState !== 'visible') return;
      const l = await requestWakeLock(() => useBarAlerts.getState().setWakeActive(false));
      if (cancelled) { void l?.release(); return; }
      lock = l;
      useBarAlerts.getState().setWakeActive(!!l);
    };
    void acquire();
    const onVis = () => { if (document.visibilityState === 'visible') void acquire(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      void lock?.release().catch(() => {});
      useBarAlerts.getState().setWakeActive(false);
    };
  }, [wakeWanted]);

  // On the board itself the cards are the notification.
  useEffect(() => {
    if (screen === GUEST_ORDERS_SCREEN) useBarAlerts.getState().clearUnseen();
  }, [screen, unseen.length]);

  if (screen === GUEST_ORDERS_SCREEN || unseen.length === 0) return null;

  const first = unseen[0];
  const where = [first.tableName && `โต๊ะ ${first.tableName}`, first.guestLabel].filter(Boolean).join(' · ');
  return (
    <div role="status" aria-live="assertive" className="bar-banner">
      <style>{BANNER_CSS}</style>
      <span className="bar-banner-dot" aria-hidden />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: 'var(--fs-lg)' }}>
          ออเดอร์ใหม่จากโต๊ะ{unseen.length > 1 ? ` ${unseen.length} รายการ` : ''}
        </div>
        {where && <div style={{ fontSize: 'var(--fs-sm)', opacity: 0.85, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{where}</div>}
      </div>
      <button className="btn btn-accent tap-lg" onClick={() => navigate(GUEST_ORDERS_SCREEN)}>
        <Icon name="bell" size={18} /> ดูออเดอร์
      </button>
      <button className="icon-btn tap-std tap-sq" aria-label="ซ่อนแจ้งเตือน" onClick={() => useBarAlerts.getState().clearUnseen()} style={{ color: 'inherit' }}>
        <Icon name="x" size={20} />
      </button>
    </div>
  );
}

export const toSessionOrder = (o: BoardOrder) => ({ id: o.id, sessionId: o.sessionId, createdAt: o.createdAt, orderNumber: o.number, total: o.total });

/** sessionId → unpaid total from `/floor/live` (null until it loaded). */
export function unpaidBySession(tables: readonly LiveTable[] | undefined): Map<string, string> | null {
  if (!tables) return null;
  const m = new Map<string, string>();
  for (const t of tables) if (t.session) m.set(t.session.id, t.unpaidTotal);
  return m;
}

const BANNER_CSS = `
.bar-banner {
  position: fixed; z-index: var(--z-toast); left: 50%; transform: translateX(-50%);
  top: calc(var(--top-inset, 0px) + 12px); width: min(560px, calc(100% - 24px));
  display: flex; align-items: center; gap: 12px; padding: 10px 10px 10px 16px;
  border-radius: var(--radius-lg); background: var(--color-primary-700); color: var(--color-text-inverse);
  box-shadow: 0 10px 30px -8px rgb(0 0 0 / 0.35);
  animation: bar-banner-in 200ms var(--ease-out, ease-out) both;
}
.bar-banner-dot { width: 10px; height: 10px; border-radius: 999px; background: var(--color-accent); flex-shrink: 0;
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-accent) 30%, transparent); }
@keyframes bar-banner-in { from { opacity: 0; transform: translate(-50%, -8px); } to { opacity: 1; transform: translate(-50%, 0); } }
@media (prefers-reduced-motion: reduce) { .bar-banner { animation: none; } }
@media (max-width: 767px) { .bar-banner { top: auto; bottom: calc(var(--tabbar-h) + 12px); } }
`;
