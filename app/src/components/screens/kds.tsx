'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import Icon from '../icons';
import { useToast, ModalShell } from '../app-common';
import { haptic } from '@/lib/haptics';
import { Skeleton } from '@/components/ui/skeleton';
import { useI18n } from '@/lib/i18n';
import { useKDSOrders, useUpdateOrderStatus, useVoidOrder, type KDSTicket } from '@/hooks/use-orders';
import { ApiError } from '@/lib/api-client';
import { useAllProducts } from '@/hooks/use-products';
import { useModifierGroups } from '@/hooks/use-modifier-groups';
import { useCookingSteps } from '@/hooks/use-cooking-steps';
import { UndoBar, useUndo, type UndoEntry } from '@/components/ui/undo-bar';
import CancelOrderModal from './cancel-order-modal';

const STATUS_RANK: Record<KDSTicket['status'], number> = { new: 0, progress: 1, ready: 2 };
const ACTION_COOLDOWN_MS = 600;

export default function KDS() {
  const toast = useToast();
  const { t } = useI18n();
  const { data: serverTickets, isLoading } = useKDSOrders();
  const updateStatus = useUpdateOrderStatus();
  const voidOrder = useVoidOrder();
  const [cancelTarget, setCancelTarget] = useState<KDSTicket | null>(null);
  const [localTickets, setLocalTickets] = useState<KDSTicket[]>([]);
  const [tick, setTick] = useState(0);
  const [stepsModal, setStepsModal] = useState<{ productId: string; productName: string } | null>(null);
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

  // Recent local actions: stale poll results must not revert a status we already
  // advanced (or resurrect a ticket we already delivered) while the PATCH is in flight
  const recentActions = useRef(new Map<string, { status: 'progress' | 'ready' | 'done'; at: number }>());
  // Bump with undo (TOUCH-SPEC §3.5). The API has no reverse transition
  // (PAID → IN_PROGRESS is one-way), so the IN_PROGRESS request is HELD while the
  // undo bar shows and sent when the bar goes away (timeout, X, replaced by the
  // next bump, the ticket's next action, or leaving the screen). Undo then never
  // touches the server: it just drops the held request and restores the card.
  const undo = useUndo();
  const pendingBump = useRef<{ ticket: KDSTicket; entry: UndoEntry | null } | null>(null);
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const leaveTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => { leaveTimers.current.forEach(clearTimeout); }, []);

  // Merge a fresh server list with in-flight local actions: optimistic status bumps
  // the server hasn't caught up to, and tickets we just delivered (filtered out).
  const mergeServer = (tickets: KDSTicket[]) => {
    const now = Date.now();
    const recent = recentActions.current;
    // (a held bump keeps its entry however long the bar is held open)
    for (const [id, a] of recent) if (now - a.at > 30000 && id !== pendingBump.current?.ticket.orderId) recent.delete(id);
    return tickets
      .filter(t => recent.get(t.orderId)?.status !== 'done')
      .map(t => {
        const a = recent.get(t.orderId);
        return a && a.status !== 'done' && STATUS_RANK[a.status] > STATUS_RANK[t.status]
          ? { ...t, status: a.status }
          : t;
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

  // Entrance policy: only orders that arrive AFTER the board first showed real data
  // slide in. The baseline is taken from the first server list, not the first
  // render: on a cold open the first render has no data yet, and seeding the
  // baseline then (empty) made every ticket of the first list "new", so the whole
  // board rose in whenever that list landed after the ~400ms screen-switch
  // suppression. Until the first list arrives knownIds stays null (= nothing is new).
  const knownIds = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!serverTickets) return;
    knownIds.current = new Set(localTickets.map(t => t.orderId));
  });
  const isNew = (orderId: string) => knownIds.current !== null && !knownIds.current.has(orderId);

  // Re-render every 30s so elapsed times update
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 30000);
    return () => clearInterval(t);
  }, []);
  void tick;

  const elapsed = (placedAt: number) => Math.floor((Date.now() - placedAt) / 60000);

  // Ignore repeat taps on the same ticket within the cooldown — prevents a double-tap
  // from skipping a status (เริ่มทำ → เสร็จแล้ว in one go)
  const tooSoon = (orderId: string) => {
    const a = recentActions.current.get(orderId);
    return !!a && Date.now() - a.at < ACTION_COOLDOWN_MS;
  };

  // Send the held bump now (resolves false if the request failed).
  const commitBump = (): Promise<boolean> => {
    const p = pendingBump.current;
    if (!p) return Promise.resolve(true);
    pendingBump.current = null;
    const { orderId } = p.ticket;
    recentActions.current.set(orderId, { status: 'progress', at: Date.now() });
    return updateStatus.mutateAsync({ orderId, status: 'IN_PROGRESS' })
      .then(() => true, () => {
        recentActions.current.delete(orderId);
        toast({ kind: 'danger', title: t.kds.statusUpdateFailed });
        return false;
      });
  };
  // A ticket is about to take its next action: send its held bump first (in order)
  // and clear the bar, since undoing would now contradict that action.
  const settleBumpFor = (orderId: string): Promise<boolean> => {
    if (pendingBump.current?.ticket.orderId !== orderId) return Promise.resolve(true);
    undo.dismiss();
    return commitBump();
  };

  // The bar went away without "เลิกทำ" (timeout / X) → send the held bump.
  useEffect(() => {
    const p = pendingBump.current;
    if (!p) return;
    if (p.entry === null) { p.entry = undo.entry; return; }
    if (undo.entry !== p.entry) void commitBump();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undo.entry]);
  // Leaving the screen with a bump still held → send it (never lose a bump).
  const commitOnLeave = useRef(commitBump);
  useEffect(() => { commitOnLeave.current = commitBump; });
  useEffect(() => () => { void commitOnLeave.current(); }, []);

  const onBump = (ticket: KDSTicket) => {
    if (tooSoon(ticket.orderId)) return;
    haptic();
    // One bar at a time: a newer bump sends the previous held one.
    void commitBump();
    recentActions.current.set(ticket.orderId, { status: 'progress', at: Date.now() });
    setLocalTickets(cur => cur.map(t => t.orderId === ticket.orderId ? { ...t, status: 'progress' as const } : t));
    pendingBump.current = { ticket, entry: null };
    undo.push(t.kds.orderStarted(ticket.id), () => {
      if (pendingBump.current?.ticket.orderId !== ticket.orderId) return;
      pendingBump.current = null;
      recentActions.current.delete(ticket.orderId);
      setLocalTickets(cur => cur.map(x => x.orderId === ticket.orderId && x.status === 'progress' ? { ...x, status: 'new' as const } : x));
    });
  };

  const onDone = (ticket: KDSTicket) => {
    if (tooSoon(ticket.orderId)) return;
    haptic();
    if (ticket.status === 'progress') {
      const bumped = settleBumpFor(ticket.orderId);
      recentActions.current.set(ticket.orderId, { status: 'ready', at: Date.now() });
      setLocalTickets(cur => cur.map(t => t.orderId === ticket.orderId ? { ...t, status: 'ready' as const } : t));
      bumped.then(ok => {
        if (!ok) return; // bump failed (already toasted); the next poll restores the card
        return updateStatus.mutateAsync({ orderId: ticket.orderId, status: 'READY' })
          .catch(() => {
            recentActions.current.delete(ticket.orderId);
            toast({ kind: 'danger', title: t.kds.statusUpdateFailed });
          });
      });
    } else {
      recentActions.current.set(ticket.orderId, { status: 'done', at: Date.now() });
      // Card holds its grid slot (faded, unclickable) briefly before removal so a
      // rapid second tap can't land on the card that slides into its place
      setLeaving(cur => new Set(cur).add(ticket.orderId));
      leaveTimers.current.push(setTimeout(() => {
        setLocalTickets(cur => cur.filter(t => t.orderId !== ticket.orderId));
        setLeaving(cur => { const n = new Set(cur); n.delete(ticket.orderId); return n; });
      }, 220));
      updateStatus.mutateAsync({ orderId: ticket.orderId, status: 'COMPLETED' })
        .then(() => toast({ kind: 'success', title: t.kds.orderDone(ticket.id), msg: t.kds.deliver, duration: 1800 }))
        .catch(() => {
          recentActions.current.delete(ticket.orderId);
          setLeaving(cur => { const n = new Set(cur); n.delete(ticket.orderId); return n; });
          toast({ kind: 'danger', title: t.kds.statusUpdateFailed });
        });
    }
  };

  // Cancel ("ยกเลิก"): mirrors onDone's deliver/done removal path — the card
  // fades out of its slot, the ticket is dropped locally, and the VOID call
  // reverts stock/money server-side (excluded from the next poll). On failure we
  // restore the ticket; a 409 means it was already canceled, so we keep it gone.
  const handleCancel = async (reason: string, restock: boolean) => {
    const ticket = cancelTarget;
    if (!ticket) return;
    const { orderId } = ticket;
    // A held bump for this ticket is simply dropped: the order is still PAID on the
    // server, which VOID accepts, and sending IN_PROGRESS after the void would 409.
    if (pendingBump.current?.ticket.orderId === orderId) {
      pendingBump.current = null;
      undo.dismiss();
    }
    recentActions.current.set(orderId, { status: 'done', at: Date.now() });
    setLeaving(cur => new Set(cur).add(orderId));
    leaveTimers.current.push(setTimeout(() => {
      setLocalTickets(cur => cur.filter(t => t.orderId !== orderId));
      setLeaving(cur => { const n = new Set(cur); n.delete(orderId); return n; });
    }, 220));
    setCancelTarget(null);
    try {
      await voidOrder.mutateAsync({ orderId, reason, restock });
      toast({ kind: 'success', title: t.kds.cancelDone(ticket.id), duration: 1800 });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // already canceled — keep it removed, let invalidate run, soft info toast
        toast({ kind: 'info', title: t.kds.cancelAlready, duration: 1800 });
      } else {
        // restore the ticket (the 220ms timer may have already removed it)
        recentActions.current.delete(orderId);
        setLeaving(cur => { const n = new Set(cur); n.delete(orderId); return n; });
        setLocalTickets(cur => cur.some(t => t.orderId === orderId) ? cur : [...cur, ticket]);
        toast({ kind: 'danger', title: t.kds.cancelFailed });
      }
    }
  };

  // FIFO by order time — positions stay put when a status changes, so rapid taps
  // never land on a different card that jumped into the slot
  const sorted = [...localTickets].sort((a, b) => a.placedAt - b.placedAt);

  const counts = {
    new:      localTickets.filter(t => t.status === 'new').length,
    progress: localTickets.filter(t => t.status === 'progress').length,
    ready:    localTickets.filter(t => t.status === 'ready').length,
  };

  return (
    <>
    <div className="surface-inverse" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <style>{KDS_CSS}</style>
      <div className="kds-head" style={{ padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 24, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="kds-head-title">
          <h1 className="kds-title" style={{ margin: 0, fontSize: 'var(--fs-h2)', fontWeight: 700, letterSpacing: '-0.01em' }}>{t.kds.title}</h1>
          {/* 0.78 white on espresso ≥ 7:1 (TOUCH-SPEC §3.7; was 0.55). */}
          <div className="kds-sub" style={{ fontSize: 'var(--fs-sm)', color: KDS_SUB_INK }}>Sukhumvit 49 • {t.kds.station}</div>
        </div>
        <div className="kds-head-stats" style={{ flex: 1, display: 'flex', gap: 12 }}>
          <KDSStatChip label={t.kds.statNew} count={counts.new} color="var(--color-warning)" />
          <KDSStatChip label={t.kds.statProgress} count={counts.progress} color="var(--color-accent)" />
          <KDSStatChip label={t.kds.statReady} count={counts.ready} color="var(--color-success)" />
        </div>
        <div style={{ fontSize: 'var(--fs-title)', fontWeight: 600, color: KDS_SUB_INK }} className="num">
          <Clock />
        </div>
      </div>

      <div className="scroll screen-pad" style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 24 }}>
        {isLoading && localTickets.length === 0 ? (
          /* Skeleton ticket grid mirrors the real card layout (no layout shift when
             orders arrive). Built with white-on-dark fills because the KDS root is
             .surface-inverse — pinned dark in BOTH themes, so the global light
             skeleton sweep would be invisible here. */
          <div className={KDS_GRID} aria-busy="true">
            <span className="sr-only">{t.kds.loadingOrders}</span>
            {Array.from({ length: 6 }).map((_, i) => <TicketSkeleton key={i} />)}
          </div>
        ) : sorted.length === 0 ? (
          <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 300, color: KDS_SUB_INK, fontSize: 'var(--fs-body)', textAlign: 'center' }}>
            <div style={{
              width: 80, height: 80, borderRadius: 'var(--radius-pill)',
              background: 'rgba(92,138,90,0.18)', color: 'var(--color-success)',
              display: 'grid', placeItems: 'center', marginBottom: 'var(--space-4)',
            }}>
              <Icon name="check" size={40} />
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 4, color: 'rgba(255,255,255,0.85)' }}>{t.kds.allClear}</div>
            <div>{t.kds.allClearHint}</div>
          </div>
        ) : (
          <div className={KDS_GRID}>
            {sorted.map(t => (
              <OrderTicket
                key={t.orderId}
                ticket={t}
                leaving={leaving.has(t.orderId)}
                animateIn={isNew(t.orderId)}
                mins={elapsed(t.placedAt)}
                nameToId={nameToId}
                modGroup={modGroup}
                onBump={() => onBump(t)}
                onDone={() => onDone(t)}
                onCancel={() => setCancelTarget(t)}
                onStepsClick={(productId, productName) => setStepsModal({ productId, productName })}
              />
            ))}
          </div>
        )}
      </div>
      {/* Undo bar in its own footer row under the board (in flow, not overlaid), so
          it never sits on top of a ticket's bump/cancel buttons; the tickets above
          keep their positions, only the scroll viewport gets shorter. */}
      {/* Host stays mounted (padding only while a bar shows) so UndoBar's live
          region exists before the first bump and the announcement is not dropped. */}
      <div className="kds-undo" style={{ padding: undo.entry ? '0 24px 16px' : 0, display: 'flex', justifyContent: 'center' }}>
        <UndoBar undo={undo} duration={5000} inline style={{ width: '100%', maxWidth: 560 }} />
      </div>
    </div>
    {stepsModal && (
      <CookingStepsModal
        productId={stepsModal.productId}
        productName={stepsModal.productName}
        onClose={() => setStepsModal(null)}
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
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!now) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return <span>{pad(now.getHours())}:{pad(now.getMinutes())}:{pad(now.getSeconds())}</span>;
};

/** Secondary text on the espresso KDS surface: ≥ 7:1, readable from the pass. */
const KDS_SUB_INK = 'rgba(255,255,255,0.78)';
/** 1 col phone · 2 tablet · 3 at ≥1280 · 4 at ≥1700 (TOUCH-SPEC §3.7). */
const KDS_GRID = 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 min-[1700px]:grid-cols-4 gap-4';

const KDSStatChip = ({ label, count, color }: { label: string; count: number; color: string }) => (
  <div className="kds-stat" style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 8, padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
    <span aria-hidden style={{ width: 8, height: 8, borderRadius: 999, background: color }} />
    <span style={{ fontSize: 'var(--fs-sm)', color: KDS_SUB_INK }}>{label}</span>
    <span className="num" style={{ fontSize: 'var(--fs-h2)', lineHeight: 'var(--lh-tight)', fontWeight: 700, color }}>{count}</span>
  </div>
);

/* A single shimmer block tuned for the dark KDS surface. The global .skeleton's
   dark variant keys off [data-theme='dark']; KDS is .surface-inverse (dark in
   BOTH themes), so the placeholder fills are spelled out here in white-on-dark. */
const DarkBar = ({ w, h = 12, r = 'var(--radius-sm)' }: { w: number | string; h?: number; r?: string }) => (
  <div className="skeleton" aria-hidden style={{
    width: typeof w === 'number' ? `${w}px` : w, height: h, borderRadius: r,
    background: 'rgba(255,255,255,0.08)',
  }} />
);

/* Placeholder ticket — mirrors OrderTicket's three bands (header / items / action). */
const TicketSkeleton = () => (
  <div aria-hidden style={{
    minHeight: 120, borderRadius: 'var(--radius-lg)',
    background: 'rgba(255,255,255,0.04)',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
  }}>
    <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(255,255,255,0.04)' }}>
      <DarkBar w={56} h={36} r="var(--radius-md)" />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <DarkBar w="45%" h={14} />
        <DarkBar w={72} h={18} />
      </div>
      <DarkBar w={64} h={28} r="var(--radius-pill)" />
    </div>
    <div style={{ padding: '14px 16px', flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <DarkBar w="80%" h={20} />
      <DarkBar w="60%" h={16} />
    </div>
    <div style={{ padding: 12, display: 'flex', gap: 16, background: 'rgba(255,255,255,0.03)' }}>
      <DarkBar w={120} h={48} r="var(--radius-md)" />
      <div style={{ flex: 1 }}><DarkBar w="100%" h={64} r="var(--radius-md)" /></div>
    </div>
  </div>
);

/* Urgency lives in a tinted header band (TOUCH-SPEC §3.7), never a thick stripe.
   The timer carries the tone in its ink, and red adds a warning glyph so the
   state does not rest on colour alone. */
const URGENCY_BAND = {
  normal: { bg: 'var(--color-surface-2)', ink: 'var(--color-text-secondary)', icon: 'clock' },
  yellow: { bg: 'var(--color-warning-50)', ink: 'var(--color-warning-fg)', icon: 'clock' },
  red:    { bg: 'var(--color-danger-50)', ink: 'var(--color-danger-fg)', icon: 'warning' },
} as const;

const OrderTicket = ({ ticket, leaving, animateIn, mins, nameToId, modGroup, onBump, onDone, onCancel, onStepsClick }: {
  ticket: KDSTicket;
  leaving: boolean;
  animateIn: boolean;
  mins: number;
  nameToId: Map<string, string>;
  modGroup: Map<string, string>;
  onBump: () => void;
  onDone: () => void;
  onCancel: () => void;
  onStepsClick: (productId: string, productName: string) => void;
}) => {
  const { t } = useI18n();
  const urgency = mins >= 10 ? 'red' : mins >= 5 ? 'yellow' : 'normal';
  const band = URGENCY_BAND[urgency];
  const typeIconMap: Record<string, string> = { 'Dine-in': 'cake', 'Takeaway': 'cart', 'Delivery': 'park' };
  const statusStyle = {
    new:      { bg: 'var(--color-warning)', color: 'var(--color-on-accent)' },
    progress: { bg: 'var(--color-accent)',  color: 'var(--color-on-accent)' },
    ready:    { bg: 'var(--color-success)', color: 'var(--color-on-accent)' },
  }[ticket.status] || { bg: '', color: '' };
  const statusLabel = t.kds.badge[ticket.status];
  const typeLabel = (t.kds.orderType as Record<string, string>)[ticket.type] ?? ticket.type;

  return (
    /* .rise-in only for tickets that arrive after open (initial cards fade with the
       screen — no replay blink); .card-out holds the slot (faded) while delivering */
    <div className={`surface-paper kds-ticket min-h-[120px]${animateIn ? ' rise-in' : ''}${leaving ? ' card-out' : ''}`} data-urgency={urgency} style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', color: 'var(--color-text)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div className="kds-ticket-head" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, background: band.bg }}>
        <div className="num" style={{ fontSize: 36, lineHeight: 1.1, fontWeight: 700, letterSpacing: '-0.01em' }}>#{ticket.queue}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Secondary grey nudged toward the ink: plain grey drops under AA on the tinted bands. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-sm)', color: 'color-mix(in srgb, var(--color-text-secondary) 70%, var(--color-text))' }}>
            <Icon name={typeIconMap[ticket.type] || 'cart'} size={16} /> {typeLabel}
          </div>
          <div className="num" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 18, fontWeight: 700, lineHeight: 1.3, color: band.ink }}>
            <Icon name={band.icon} size={18} /> {t.kds.minutes(mins)}
          </div>
        </div>
        <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, minHeight: 28, padding: '0 12px', display: 'inline-flex', alignItems: 'center', borderRadius: 999, background: statusStyle.bg, color: statusStyle.color, flexShrink: 0 }}>{statusLabel}</span>
      </div>

      <div style={{ padding: '14px 16px', flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {ticket.items.map((it, i) => (
          <div key={i}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0, fontSize: 20, fontWeight: 600, lineHeight: 1.3 }}>{it.name}</div>
              {nameToId.has(it.name) && (
                <button
                  type="button"
                  onClick={() => onStepsClick(nameToId.get(it.name)!, it.name)}
                  aria-label={t.kds.howToAria(it.name)}
                  className="help-badge kds-help tap"
                >
                  <Icon name="list" size={20} />
                  <span className="kds-help-label" aria-hidden>{t.kds.howTo}</span>
                </button>
              )}
              <div className="num" style={{ fontSize: 22, fontWeight: 700, minWidth: 40, textAlign: 'right', color: 'var(--color-primary)' }}>×{it.qty}</div>
            </div>
            {it.mods.length > 0 && (
              <div style={{ fontSize: 16, color: 'var(--color-text-secondary)', marginTop: 2, lineHeight: 1.5 }}>
                {it.mods.map((m, k) => {
                  const isSpecial = m.name.startsWith('+') || m.name.includes('นมโอ๊ต') || m.name.includes('นมอัลมอนด์');
                  const group = modGroup.get(m.id);
                  return (
                    <span key={k} style={{ fontWeight: isSpecial ? 700 : 400, color: isSpecial ? 'var(--color-primary)' : 'inherit' }}>
                      {group && <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>{group} </span>}
                      {m.name}{k < it.mods.length - 1 ? ' • ' : ''}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Action bar: cancel (48px ghost) on the LEFT, bump (64px) on the RIGHT, 16px
          apart — a mis-tap aimed at the bump can't land on cancel, and cancel only
          opens a confirm dialog (no direct void). TOUCH-SPEC §3.7 / §4. */}
      <div className="kds-actions" style={{ padding: 12, background: 'var(--color-surface-2)', display: 'flex', alignItems: 'center', gap: 16 }}>
        <button
          type="button"
          onClick={onCancel}
          className="btn btn-ghost tap-std kds-cancel"
          style={{ flexShrink: 0, fontSize: 'var(--fs-body)', color: 'var(--color-danger-fg)' }}
        >
          <Icon name="trash" size={18} /> {t.kds.cancel}
        </button>
        {ticket.status === 'new' && (
          <button type="button" onClick={onBump} className="btn btn-primary btn-xl kds-bump" style={BUMP}>
            <Icon name="coffee" size={22} /> {t.kds.start}
          </button>
        )}
        {ticket.status === 'progress' && (
          <button type="button" onClick={onDone} className="btn btn-accent btn-xl kds-bump" style={BUMP}>
            <Icon name="check" size={22} /> {t.kds.done}
          </button>
        )}
        {ticket.status === 'ready' && (
          // Espresso ink on the sage fill (as the "พร้อมเสิร์ฟ" status tag): white
          // would be ~4.1:1 at 17px, under AA for non-large text.
          <button type="button" onClick={onDone} className="btn btn-xl kds-bump" style={{ ...BUMP, background: 'var(--color-success)', color: 'var(--color-on-accent)' }}>
            <Icon name="check" size={22} /> {t.kds.deliver}
          </button>
        )}
      </div>
    </div>
  );
};

const CookingStepsModal = ({ productId, productName, onClose }: {
  productId: string;
  productName: string;
  onClose: () => void;
}) => {
  const { t } = useI18n();
  const { data: steps, isLoading } = useCookingSteps(productId);

  // Shared ModalShell: capped to the visible screen, body scrolls, Escape / focus
  // trap / focus restore built in, portaled above the phone tab bar.
  return (
    <ModalShell title={productName} subtitle={t.kds.howTo} onClose={onClose} width={420}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {isLoading ? (
          /* Step placeholders mirror the numbered-step rows below so the modal
             body doesn't jump when the real steps land. */
          <div aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <span className="sr-only">{t.common.loading}</span>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                <Skeleton width={28} height={28} radius="var(--radius-pill)" />
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 4 }}>
                  <Skeleton width="92%" height={13} />
                  <Skeleton width="64%" height={13} />
                </div>
              </div>
            ))}
          </div>
        ) : !steps || steps.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 32, color: 'var(--color-text-secondary)', fontSize: 14 }}>{t.kds.noSteps}</div>
        ) : steps.map((step, idx) => (
          <div key={step.id} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <div className="num" style={{ width: 28, height: 28, borderRadius: 999, background: 'var(--color-accent)', color: 'var(--color-on-accent)', display: 'grid', placeItems: 'center', fontSize: 'var(--fs-cap)', fontWeight: 800, flexShrink: 0 }}>{idx + 1}</div>
            <div style={{ fontSize: 'var(--fs-lg)', lineHeight: 1.6, paddingTop: 2 }}>{step.instruction}</div>
          </div>
        ))}
      </div>
    </ModalShell>
  );
};

/** Bump / done / deliver: 64px money-weight action, 17px/700 (TOUCH-SPEC §3.7). */
const BUMP: React.CSSProperties = { flex: 1, minWidth: 0, fontSize: 17, fontWeight: 700 };

/**
 * KDS styles that need selectors (container query, hover gating, phone layout).
 *
 * Help button ("วิธีทำ"): a 44×44 icon button; the visible label shows on tickets
 * at least 320px wide (container query on .kds-ticket), so a narrow phone ticket
 * keeps the icon only. Its ink is lifted to --color-text (the shared .help-badge
 * secondary grey sits just under AA on its tinted fill); hover keeps the shared
 * espresso fill with white ink.
 *
 * Phone layout (< 768px): the header wraps to title + clock over a row of three
 * equal stat chips (it was one ~540px row that pushed the page sideways).
 */
const KDS_CSS = `
.kds-ticket { container-type: inline-size; }
.kds-help {
  flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  min-width: var(--tap-min); min-height: var(--tap-min); padding: 0 10px;
  border-radius: var(--radius-md); cursor: pointer;
  font-size: var(--fs-cap); font-weight: 600; color: var(--color-text);
}
@container (max-width: 319px) {
  .kds-help { padding: 0; }
  .kds-help-label { display: none; }
}
@media (hover: hover) and (pointer: fine) {
  .kds-help:hover { color: #fff; }
}
/* The undo bar is an espresso fill with --color-text-inverse ink. The KDS board is
   dark in both themes but .surface-inverse doesn't pin that token, so in dark mode it
   would flip to near-black on espresso; pin it to its light-theme white here. */
.kds-undo { --color-text-inverse: #FFFFFF; }
@media (max-width: 767px) {
  .kds-head { flex-wrap: wrap; padding: 10px 12px !important; gap: 8px 12px !important; }
  .kds-head-title { flex: 1; min-width: 0; }
  .kds-title { font-size: 17px !important; }
  .kds-sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .kds-head-stats { order: 3; flex: 1 0 100% !important; gap: 6px !important; }
  .kds-stat { flex: 1 1 0; min-width: 0; justify-content: center; padding: 6px 8px !important; gap: 6px !important; }
  .kds-stat > span:first-child { flex-shrink: 0; }
  .kds-stat > span:nth-child(2) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .kds-cancel { padding-left: 12px; padding-right: 12px; }
  .kds-undo:has(.undo-bar) { padding: 0 12px 12px !important; }
}
`;
