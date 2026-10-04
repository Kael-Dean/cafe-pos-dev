'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import Icon from '../icons';
import { useToast } from '../ui/toast';
import { useI18n } from '@/lib/i18n';
import { useKDSOrders, useUpdateOrderStatus, useVoidOrder, type KDSTicket } from '@/hooks/use-orders';
import { ApiError } from '@/lib/api-client';
import { useAllProducts } from '@/hooks/use-products';
import { useModifierGroups } from '@/hooks/use-modifier-groups';
import { useCookingSteps } from '@/hooks/use-cooking-steps';
import { useCurrentUser } from '@/hooks/use-current-user';
import { useOnlineStatus } from '@/components/pwa/offline-indicator';
import { Banner, Button, IconButton, Modal, Skeleton, Snackbar, Timer, cn } from '@/components/ui';
import CancelOrderModal from './cancel-order-modal';
import { useOverlayHistory } from '../use-overlay-history';
import s from './kds.module.css';

type Status = KDSTicket['status'];
type Next = 'progress' | 'ready' | 'done';

const STATUS_RANK: Record<Status, number> = { new: 0, progress: 1, ready: 2 };
const NEXT: Record<Status, Next> = { new: 'progress', progress: 'ready', ready: 'done' };
const API_STATUS: Record<Next, string> = { progress: 'IN_PROGRESS', ready: 'READY', done: 'COMPLETED' };
/** A double tap on the same ticket inside this window is ignored (never skips a status). */
const ACTION_COOLDOWN_MS = 600;
/** Undo window (UI-SPEC §2.4). The status change is only sent to the server after it. */
const UNDO_MS = 5000;
/** Grid slot is held (faded) this long after "served" so a second tap can't land on the next card. */
const LEAVE_MS = 180;
/** Last good poll older than this → the stale bar (polling is every 15s). */
const STALE_MS = 25_000;
const WARN_MIN = 5;
const LATE_MIN = 10;

type Recent = { status: Next; at: number; pending?: boolean };
type Pending = { ticket: KDSTicket; to: Next; prevRecent?: Recent; timer: ReturnType<typeof setTimeout> };
type UndoState = { orderId: string; queue: string; to: Next; key: number };

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const isTyping = () => {
  const el = document.activeElement;
  return el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
};

export default function KDS() {
  const toast = useToast();
  const { t } = useI18n();
  const online = useOnlineStatus();
  const { data: me } = useCurrentUser();
  const kdsQ = useKDSOrders();
  const { data: serverTickets, isLoading, isError, dataUpdatedAt, isFetching, refetch } = kdsQ;
  const updateStatus = useUpdateOrderStatus();
  const voidOrder = useVoidOrder();
  const [cancelTarget, setCancelTarget] = useState<KDSTicket | null>(null);
  const [localTickets, setLocalTickets] = useState<KDSTicket[]>([]);
  const [stepsFor, setStepsFor] = useState<{ productId: string; productName: string } | null>(null);
  const [stepsOpen, setStepsOpen] = useState(false);
  const [undo, setUndo] = useState<UndoState | null>(null);
  const { data: allProducts } = useAllProducts();
  const nameToId = useMemo(() => {
    const m = new Map<string, string>();
    allProducts?.forEach(p => m.set(p.name, p.id));
    return m;
  }, [allProducts]);
  // Order snapshots store only modifier id+name, not the group ("ความหวาน"), so
  // resolve each modifier's group label from the modifier-groups catalog.
  const { data: modGroupList } = useModifierGroups();
  const modGroup = useMemo(() => {
    const m = new Map<string, string>();
    modGroupList?.forEach(g => g.options.forEach(o => m.set(o.id, g.label)));
    return m;
  }, [modGroupList]);

  // Display clock: elapsed minutes (urgency frame) + staleness. Timer chips tick on their own.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  // Local actions the server has not caught up with: a stale poll must not revert a
  // status we already advanced, or resurrect a ticket we already served. Entries for
  // bumps still inside their undo window are `pending` and never expire on their own.
  const recentActions = useRef(new Map<string, Recent>());
  const pending = useRef(new Map<string, Pending>());
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const leaveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  // Merge a fresh server list with in-flight local actions.
  const mergeServer = (tickets: KDSTicket[]) => {
    const at = Date.now();
    const recent = recentActions.current;
    for (const [id, a] of recent) if (!a.pending && at - a.at > 30000) recent.delete(id);
    return tickets
      .filter(tk => recent.get(tk.orderId)?.status !== 'done')
      .map(tk => {
        const a = recent.get(tk.orderId);
        return a && a.status !== 'done' && STATUS_RANK[a.status] > STATUS_RANK[tk.status]
          ? { ...tk, status: a.status }
          : tk;
      });
  };

  // Seed local state from the server list DURING render (not in an effect) so the
  // first paint — even from react-query's cache on a revisit — already shows the real
  // tickets instead of flashing the empty state for one frame. Guarded by reference,
  // so it only re-seeds when a poll actually returns a new list (no render loop).
  const prevServer = useRef<KDSTicket[] | undefined>(undefined);
  if (serverTickets && serverTickets !== prevServer.current) {
    prevServer.current = serverTickets;
    setLocalTickets(mergeServer(serverTickets));
  }

  // Entrance policy: only tickets that appear AFTER the first render pulse once. On
  // open, the screen's own fade already covers the cards.
  const knownIds = useRef<Set<string> | null>(null);
  useEffect(() => {
    // Seeded only once real data is on screen, so the first load never pulses.
    if (serverTickets) knownIds.current = new Set(localTickets.map(tk => tk.orderId));
  });
  const isNew = (orderId: string) => knownIds.current !== null && !knownIds.current.has(orderId);

  // ── Removal / restore helpers ───────────────────────────────────────────────
  const dropLeaving = (id: string) => setLeaving(cur => { if (!cur.has(id)) return cur; const n = new Set(cur); n.delete(id); return n; });
  const scheduleRemoval = (id: string) => {
    setLeaving(cur => new Set(cur).add(id));
    const prev = leaveTimers.current.get(id);
    if (prev) clearTimeout(prev);
    leaveTimers.current.set(id, setTimeout(() => {
      leaveTimers.current.delete(id);
      setLocalTickets(cur => cur.filter(tk => tk.orderId !== id));
      dropLeaving(id);
    }, LEAVE_MS));
  };
  const restore = (ticket: KDSTicket) => {
    const id = ticket.orderId;
    const timer = leaveTimers.current.get(id);
    if (timer) { clearTimeout(timer); leaveTimers.current.delete(id); }
    dropLeaving(id);
    setLocalTickets(cur => cur.some(tk => tk.orderId === id)
      ? cur.map(tk => (tk.orderId === id ? ticket : tk))
      : [...cur, ticket]);
  };

  const restoreRef = useRef(restore);
  useEffect(() => { restoreRef.current = restore; });

  // ── Deferred commit: a bump is local for UNDO_MS, then goes to the server ──
  // The backend only moves forward (PAID→IN_PROGRESS→READY→COMPLETED), so undo works
  // by not sending the change until the undo window has passed.
  const mutateRef = useRef(updateStatus.mutateAsync);
  useEffect(() => { mutateRef.current = updateStatus.mutateAsync; });
  const failMsg = t.kds.statusUpdateFailed;
  const commit = useCallback((orderId: string) => {
    const p = pending.current.get(orderId);
    if (!p) return;
    clearTimeout(p.timer);
    pending.current.delete(orderId);
    recentActions.current.set(orderId, { status: p.to, at: Date.now() });
    mutateRef.current({ orderId, status: API_STATUS[p.to] }).catch(() => {
      recentActions.current.delete(orderId);
      restoreRef.current(p.ticket);
      toast({ kind: 'danger', title: failMsg });
    });
  }, [toast, failMsg]);
  // Leaving the screen (or the page) sends every bump still waiting out its undo window.
  useEffect(() => {
    const flush = () => { for (const id of [...pending.current.keys()]) commit(id); };
    const timers = leaveTimers.current;
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
      timers.forEach(clearTimeout);
    };
  }, [commit]);

  const tooSoon = (orderId: string) => {
    const a = recentActions.current.get(orderId);
    return !!a && Date.now() - a.at < ACTION_COOLDOWN_MS;
  };

  const bump = (ticket: KDSTicket) => {
    const id = ticket.orderId;
    if (tooSoon(id) || leaving.has(id)) return;
    // A previous step still in its undo window goes to the server now.
    if (pending.current.has(id)) commit(id);
    const to = NEXT[ticket.status];
    const prevRecent = recentActions.current.get(id);
    recentActions.current.set(id, { status: to, at: Date.now(), pending: true });
    if (to === 'done') scheduleRemoval(id);
    else setLocalTickets(cur => cur.map(tk => (tk.orderId === id ? { ...tk, status: to } : tk)));
    const timer = setTimeout(() => commit(id), UNDO_MS);
    pending.current.set(id, { ticket, to, prevRecent, timer });
    setUndo({ orderId: id, queue: String(ticket.queue), to, key: Date.now() });
  };

  const undoRef = useRef(undo);
  useEffect(() => { undoRef.current = undo; });
  const doUndo = useCallback(() => {
    const u = undoRef.current;
    if (!u) return;
    const p = pending.current.get(u.orderId);
    setUndo(null);
    if (!p) return;
    clearTimeout(p.timer);
    pending.current.delete(u.orderId);
    if (p.prevRecent) recentActions.current.set(u.orderId, p.prevRecent);
    else recentActions.current.delete(u.orderId);
    restoreRef.current(p.ticket);
  }, []);

  // Cancel ("ยกเลิก"): the card leaves its slot, the VOID call reverts stock/money
  // server-side. On failure the ticket comes back; a 409 means it was already
  // canceled, so it stays gone.
  const handleCancel = async (reason: string, restock: boolean) => {
    const ticket = cancelTarget;
    if (!ticket) return;
    const { orderId } = ticket;
    const p = pending.current.get(orderId);
    if (p) { clearTimeout(p.timer); pending.current.delete(orderId); }
    if (undoRef.current?.orderId === orderId) setUndo(null);
    recentActions.current.set(orderId, { status: 'done', at: Date.now() });
    scheduleRemoval(orderId);
    setCancelTarget(null);
    try {
      await voidOrder.mutateAsync({ orderId, reason, restock });
      toast({ kind: 'success', title: t.kds.cancelDone(ticket.id), duration: 1800 });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toast({ kind: 'info', title: t.kds.cancelAlready, duration: 1800 });
      } else {
        recentActions.current.delete(orderId);
        restore(ticket);
        toast({ kind: 'danger', title: t.kds.cancelFailed });
      }
    }
  };

  // FIFO by order time — positions stay put when a status changes, so rapid taps
  // never land on a different card that jumped into the slot.
  const sorted = [...localTickets].sort((a, b) => a.placedAt - b.placedAt);
  const counts = {
    new:      localTickets.filter(tk => tk.status === 'new').length,
    progress: localTickets.filter(tk => tk.status === 'progress').length,
    ready:    localTickets.filter(tk => tk.status === 'ready').length,
  };

  // ── Keyboard: arrows move across tickets, Space advances, U undoes (§4.1) ───
  const gridRef = useRef<HTMLDivElement>(null);
  const onGridKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const card = e.target as HTMLElement;
    if (!card.dataset.ticketId) return; // a button inside the ticket keeps its own keys
    const cards = Array.from(gridRef.current?.querySelectorAll<HTMLElement>('[data-ticket-id]') ?? []);
    const i = cards.indexOf(card);
    if (i < 0) return;
    const top = cards[0]?.offsetTop ?? 0;
    const cols = Math.max(1, cards.filter(c => c.offsetTop === top).length);
    const step: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols };
    if (e.code in step) {
      e.preventDefault();
      cards[Math.min(cards.length - 1, Math.max(0, i + step[e.code]))]?.focus();
      return;
    }
    if (e.code === 'Space') {
      e.preventDefault();
      const tk = sorted.find(x => x.orderId === card.dataset.ticketId);
      if (tk) bump(tk);
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'KeyU' || e.ctrlKey || e.metaKey || e.altKey || isTyping()) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      doUndo();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [doUndo]);

  const loadFailed = !serverTickets && isError;
  const stale = !!serverTickets && (!online || isError || now - dataUpdatedAt > STALE_MS);
  const statusLabel: Record<Next, string> = { progress: t.kds.badge.progress, ready: t.kds.badge.ready, done: t.kds.completed };
  const sub = [me?.store_name, t.kds.station].filter(Boolean).join(' · ');

  return (
    <>
    <div className={cn('surface-inverse', s.root)}>
      <header className={s.head}>
        <div className={s.titleBlock}>
          <h1 className={s.title}>{t.kds.title}</h1>
          <div className={s.sub}>{sub}</div>
        </div>
        <div className={s.stats}>
          <StatChip className={s.statNew} icon="bell" label={t.kds.statNew} count={counts.new} />
          <StatChip className={s.statProgress} icon="pot" label={t.kds.statProgress} count={counts.progress} />
          <StatChip className={s.statReady} icon="check" label={t.kds.statReady} count={counts.ready} />
        </div>
        <div className={s.clock}><Clock /></div>
      </header>

      {stale && (
        <Banner
          tone="warning"
          icon={online ? 'clock' : 'wifiOff'}
          title={online ? t.kds.staleTitle : t.kds.offlineTitle}
          detail={t.kds.updatedAt(hhmm(dataUpdatedAt))}
          action={<Button size="sm" variant="secondary" loading={isFetching} onClick={() => { void refetch(); }}>{t.kds.retry}</Button>}
        />
      )}

      <div className={cn(s.body, 'scroll')}>
        {isLoading && localTickets.length === 0 ? (
          <div className={s.grid} aria-busy="true">
            <span className="sr-only">{t.kds.loadingOrders}</span>
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className={cn(s.skel, 'skeleton')} aria-hidden />)}
          </div>
        ) : loadFailed ? (
          <div className={s.empty} role="alert">
            <div className={s.emptyIcon}><Icon name="warning" size={36} /></div>
            <h2 className={s.emptyTitle}>{t.kds.loadErrorTitle}</h2>
            <p className={s.emptyBody}>{t.kds.loadErrorBody}</p>
            <Button variant="accent" loading={isFetching} onClick={() => { void refetch(); }}>{t.kds.retry}</Button>
          </div>
        ) : sorted.length === 0 ? (
          <div className={cn(s.empty, 'fade-in')}>
            <div className={s.emptyIcon}><Icon name="check" size={36} /></div>
            <h2 className={s.emptyTitle}>{t.kds.allClear}</h2>
            <p className={s.emptyBody}>{t.kds.allClearHint}</p>
          </div>
        ) : (
          <div ref={gridRef} className={s.grid} role="list" aria-label={t.kds.boardLabel} onKeyDown={onGridKey}>
            {sorted.map(tk => (
              <OrderTicket
                key={tk.orderId}
                ticket={tk}
                leaving={leaving.has(tk.orderId)}
                arrive={isNew(tk.orderId)}
                mins={Math.max(0, Math.floor((now - tk.placedAt) / 60000))}
                nameToId={nameToId}
                modGroup={modGroup}
                onBump={() => bump(tk)}
                onCancel={() => setCancelTarget(tk)}
                onStepsClick={(productId, productName) => { setStepsFor({ productId, productName }); setStepsOpen(true); }}
              />
            ))}
          </div>
        )}
      </div>
      <p className={s.keyHint}>{t.kds.keyHint}</p>
    </div>

    <Snackbar
      open={!!undo}
      message={undo ? t.kds.bumped(undo.queue, statusLabel[undo.to]) : ''}
      onAction={doUndo}
      onClose={() => setUndo(null)}
      duration={UNDO_MS}
      resetKey={undo?.key}
    />
    {stepsFor && (
      <CookingStepsModal
        open={stepsOpen}
        productId={stepsFor.productId}
        productName={stepsFor.productName}
        onClose={() => setStepsOpen(false)}
      />
    )}
    {cancelTarget && (
      <CancelOrderModal
        orderLabel={String(cancelTarget.queue)}
        onClose={() => setCancelTarget(null)}
        onConfirm={handleCancel}
      />
    )}
    </>
  );
}

const Clock = () => {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!now) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return <span>{pad(now.getHours())}:{pad(now.getMinutes())}:{pad(now.getSeconds())}</span>;
};

const StatChip = ({ className, icon, label, count }: { className: string; icon: string; label: string; count: number }) => (
  <div className={cn(s.stat, className)}>
    <span className={s.statIcon}><Icon name={icon} size={14} strokeWidth={2.2} /></span>
    <span>{label}</span>
    <strong>{count}</strong>
  </div>
);

const STATUS_ICON: Record<Status, string> = { new: 'bell', progress: 'pot', ready: 'check' };
const STATUS_CLASS: Record<Status, string> = { new: s.statusNew, progress: s.statusProgress, ready: s.statusReady };
const TYPE_ICON: Record<string, string> = { 'Dine-in': 'coffee', 'Takeaway': 'cart', 'Delivery': 'park' };

const OrderTicket = ({ ticket, leaving, arrive, mins, nameToId, modGroup, onBump, onCancel, onStepsClick }: {
  ticket: KDSTicket;
  leaving: boolean;
  arrive: boolean;
  mins: number;
  nameToId: Map<string, string>;
  modGroup: Map<string, string>;
  onBump: () => void;
  onCancel: () => void;
  onStepsClick: (productId: string, productName: string) => void;
}) => {
  const { t } = useI18n();
  const urgency = mins >= LATE_MIN ? 'late' : mins >= WARN_MIN ? 'warn' : 'normal';
  const statusLabel = t.kds.badge[ticket.status];
  const typeLabel = (t.kds.orderType as Record<string, string>)[ticket.type] ?? ticket.type;
  const queue = String(ticket.queue);

  const action = {
    new:      { label: t.kds.start,   icon: 'pot',     variant: 'primary' as const },
    progress: { label: t.kds.done,    icon: 'check',   variant: 'accent' as const },
    ready:    { label: t.kds.deliver, icon: 'success', variant: 'secondary' as const },
  }[ticket.status];

  return (
    /* .card-out holds the slot (faded) while the ticket leaves. */
    <article
      role="listitem"
      tabIndex={0}
      data-ticket-id={ticket.orderId}
      aria-label={t.kds.ticketAria(queue, statusLabel, mins, urgency === 'late')}
      className={cn(
        'surface-paper', s.ticket,
        urgency === 'warn' && s.warn, urgency === 'late' && s.late,
        arrive && s.arrive, leaving && 'card-out',
      )}
    >
      <div className={s.ticketHead}>
        <div className={s.queue}>#{queue}</div>
        <div className={s.headMid}>
          <div className={s.type}><Icon name={TYPE_ICON[ticket.type] ?? 'cart'} size={14} />{typeLabel}</div>
          <div className={s.timerRow}>
            <Timer since={ticket.placedAt} warnAfter={WARN_MIN} dangerAfter={LATE_MIN} />
            {urgency === 'late' && <span className={s.lateTag}>{t.kds.late}</span>}
          </div>
        </div>
        <span className={cn(s.status, STATUS_CLASS[ticket.status])}>
          <Icon name={STATUS_ICON[ticket.status]} size={14} strokeWidth={2.2} />
          {statusLabel}
        </span>
      </div>

      <div className={s.items}>
        {ticket.items.map((it, i) => {
          const productId = nameToId.get(it.name);
          return (
            <div key={i}>
              <div className={s.itemRow}>
                <div className={s.itemName}>
                  <span>{it.name}</span>
                  {productId && (
                    <IconButton
                      size="sm"
                      icon={<Icon name="info" size={16} />}
                      label={t.kds.howToAria(it.name)}
                      onClick={() => onStepsClick(productId, it.name)}
                    />
                  )}
                </div>
                <div className={s.qty}>×{it.qty}</div>
              </div>
              {it.mods.length > 0 && (
                <div className={s.mods}>
                  {it.mods.map((m, k) => {
                    const isSpecial = m.name.startsWith('+') || m.name.includes('นมโอ๊ต') || m.name.includes('นมอัลมอนด์');
                    const group = modGroup.get(m.id);
                    return (
                      <span key={k} className={isSpecial ? s.special : undefined}>
                        {group && <span className={s.modGroup}>{group} </span>}
                        {m.name}{k < it.mods.length - 1 ? ' • ' : ''}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className={s.actions}>
        <Button
          variant={action.variant}
          size="lg"
          fullWidth
          icon={<Icon name={action.icon} size={18} />}
          onClick={onBump}
          keyShortcuts="Space"
        >
          {action.label}
        </Button>
        {/* "ยกเลิก" sits on its own row, right-aligned, so a mis-tap on the primary
            action above is much harder. It opens a confirm dialog (no direct void). */}
        <div className={s.cancelRow}>
          <Button variant="ghost" className={s.cancel} icon={<Icon name="trash" size={16} />} onClick={onCancel}>
            {t.kds.cancel}
          </Button>
        </div>
      </div>
    </article>
  );
};

const CookingStepsModal = ({ open, productId, productName, onClose }: {
  open: boolean;
  productId: string;
  productName: string;
  onClose: () => void;
}) => {
  const { t } = useI18n();
  const { data: steps, isLoading } = useCookingSteps(productId);
  useOverlayHistory(open, onClose);

  return (
    <Modal open={open} onClose={onClose} size="sm" title={productName} description={t.kds.howTo}>
      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        {isLoading ? (
          <li aria-busy="true" className="flex flex-col gap-3">
            <span className="sr-only">{t.common.loading}</span>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3">
                <Skeleton width={28} height={28} radius="var(--radius-pill)" />
                <div className="flex flex-1 flex-col gap-1.5 pt-1">
                  <Skeleton width="92%" height={13} />
                  <Skeleton width="64%" height={13} />
                </div>
              </div>
            ))}
          </li>
        ) : !steps || steps.length === 0 ? (
          <li className="p-8 text-center text-sm text-text-secondary">{t.kds.noSteps}</li>
        ) : steps.map((step, idx) => (
          <li key={step.id} className="flex items-start gap-3">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent text-xs font-extrabold text-on-accent tabular-nums">{idx + 1}</span>
            <span className="pt-0.5 text-[15px] leading-relaxed">{step.instruction}</span>
          </li>
        ))}
      </ol>
    </Modal>
  );
};
