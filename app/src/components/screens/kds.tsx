'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import Icon from '../icons';
import { useToast, Tag } from '../app-common';
import { useI18n } from '@/lib/i18n';
import { useKDSOrders, useUpdateOrderStatus, type KDSTicket } from '@/hooks/use-orders';
import { useAllProducts } from '@/hooks/use-products';
import { useCookingSteps } from '@/hooks/use-cooking-steps';

const STATUS_RANK: Record<KDSTicket['status'], number> = { new: 0, progress: 1, ready: 2 };
const ACTION_COOLDOWN_MS = 600;

export default function KDS() {
  const toast = useToast();
  const { t } = useI18n();
  const { data: serverTickets, isLoading } = useKDSOrders();
  const updateStatus = useUpdateOrderStatus();
  const [localTickets, setLocalTickets] = useState<KDSTicket[]>([]);
  const [tick, setTick] = useState(0);
  const [stepsModal, setStepsModal] = useState<{ productId: string; productName: string } | null>(null);
  const { data: allProducts } = useAllProducts();
  const nameToId = useMemo(() => {
    const m = new Map<string, string>();
    allProducts?.forEach(p => m.set(p.name, p.id));
    return m;
  }, [allProducts]);

  // Recent local actions: stale poll results must not revert a status we already
  // advanced (or resurrect a ticket we already delivered) while the PATCH is in flight
  const recentActions = useRef(new Map<string, { status: 'progress' | 'ready' | 'done'; at: number }>());
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const leaveTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => { leaveTimers.current.forEach(clearTimeout); }, []);

  // Seed local state from server on each poll, merged with recent local actions
  useEffect(() => {
    if (!serverTickets) return;
    const now = Date.now();
    const recent = recentActions.current;
    for (const [id, a] of recent) if (now - a.at > 30000) recent.delete(id);
    setLocalTickets(serverTickets
      .filter(t => recent.get(t.orderId)?.status !== 'done')
      .map(t => {
        const a = recent.get(t.orderId);
        return a && a.status !== 'done' && STATUS_RANK[a.status] > STATUS_RANK[t.status]
          ? { ...t, status: a.status }
          : t;
      }));
  }, [serverTickets]);

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

  const onBump = (ticket: KDSTicket) => {
    if (tooSoon(ticket.orderId)) return;
    recentActions.current.set(ticket.orderId, { status: 'progress', at: Date.now() });
    setLocalTickets(cur => cur.map(t => t.orderId === ticket.orderId ? { ...t, status: 'progress' as const } : t));
    updateStatus.mutateAsync({ orderId: ticket.orderId, status: 'IN_PROGRESS' })
      .catch(() => {
        recentActions.current.delete(ticket.orderId);
        toast({ kind: 'danger', title: t.kds.statusUpdateFailed });
      });
    toast({ kind: 'info', title: t.kds.orderStarted(ticket.id), duration: 1600 });
  };

  const onDone = (ticket: KDSTicket) => {
    if (tooSoon(ticket.orderId)) return;
    if (ticket.status === 'progress') {
      recentActions.current.set(ticket.orderId, { status: 'ready', at: Date.now() });
      setLocalTickets(cur => cur.map(t => t.orderId === ticket.orderId ? { ...t, status: 'ready' as const } : t));
      updateStatus.mutateAsync({ orderId: ticket.orderId, status: 'READY' })
        .catch(() => {
          recentActions.current.delete(ticket.orderId);
          toast({ kind: 'danger', title: t.kds.statusUpdateFailed });
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
      <div style={{ padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 24, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.01em' }}>{t.kds.title}</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)' }}>Sukhumvit 49 • {t.kds.station}</div>
        </div>
        <div style={{ flex: 1, display: 'flex', gap: 12 }}>
          <KDSStatChip label={t.kds.statNew} count={counts.new} color="var(--color-warning)" />
          <KDSStatChip label={t.kds.statProgress} count={counts.progress} color="var(--color-accent)" />
          <KDSStatChip label={t.kds.statReady} count={counts.ready} color="var(--color-success)" />
        </div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)' }} className="num">
          <Clock />
        </div>
      </div>

      <div className="scroll" style={{ flex: 1, overflow: 'auto', padding: 24 }}>
        {isLoading && localTickets.length === 0 ? (
          /* Skeleton ticket grid mirrors the real card layout (no layout shift when
             orders arrive). Built with white-on-dark fills because the KDS root is
             .surface-inverse — pinned dark in BOTH themes, so the global light
             skeleton sweep would be invisible here. */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" aria-busy="true">
            <span className="sr-only">{t.kds.loadingOrders}</span>
            {Array.from({ length: 6 }).map((_, i) => <TicketSkeleton key={i} />)}
          </div>
        ) : sorted.length === 0 ? (
          <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 300, color: 'rgba(255,255,255,0.55)', textAlign: 'center' }}>
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {sorted.map(t => (
              <OrderTicket
                key={t.orderId}
                ticket={t}
                leaving={leaving.has(t.orderId)}
                mins={elapsed(t.placedAt)}
                nameToId={nameToId}
                onBump={() => onBump(t)}
                onDone={() => onDone(t)}
                onStepsClick={(productId, productName) => setStepsModal({ productId, productName })}
              />
            ))}
          </div>
        )}
      </div>
    </div>
    {stepsModal && (
      <CookingStepsModal
        productId={stepsModal.productId}
        productName={stepsModal.productName}
        onClose={() => setStepsModal(null)}
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

const KDSStatChip = ({ label, count, color }: { label: string; count: number; color: string }) => (
  <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 8, padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
    <span style={{ width: 8, height: 8, borderRadius: 999, background: color }} />
    <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>{label}</span>
    <span className="num" style={{ fontSize: 16, fontWeight: 700, color }}>{count}</span>
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
    borderTop: '4px solid rgba(255,255,255,0.12)',
    background: 'rgba(255,255,255,0.04)',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
  }}>
    <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
      <DarkBar w={40} h={26} r="var(--radius-md)" />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <DarkBar w="55%" h={11} />
        <DarkBar w={64} h={18} r="var(--radius-pill)" />
      </div>
      <DarkBar w={48} h={20} r="var(--radius-pill)" />
    </div>
    <div style={{ padding: '12px 16px', flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <DarkBar w="80%" h={15} />
      <DarkBar w="60%" h={13} />
    </div>
    <div style={{ padding: 12, background: 'rgba(255,255,255,0.03)' }}>
      <DarkBar w="100%" h={36} r="var(--radius-md)" />
    </div>
  </div>
);

const OrderTicket = ({ ticket, leaving, mins, nameToId, onBump, onDone, onStepsClick }: {
  ticket: KDSTicket;
  leaving: boolean;
  mins: number;
  nameToId: Map<string, string>;
  onBump: () => void;
  onDone: () => void;
  onStepsClick: (productId: string, productName: string) => void;
}) => {
  const { t } = useI18n();
  const urgency = mins >= 10 ? 'red' : mins >= 5 ? 'yellow' : 'normal';
  const accent = urgency === 'red' ? 'var(--color-danger)' : urgency === 'yellow' ? 'var(--color-warning)' : 'var(--color-accent)';
  const typeIconMap: Record<string, string> = { 'Dine-in': 'cake', 'Takeaway': 'cart', 'Delivery': 'park' };
  const statusStyle = {
    new:      { bg: 'var(--color-warning)', color: '#9C6A1F' },
    progress: { bg: 'var(--color-accent)',  color: 'var(--color-primary-700)' },
    ready:    { bg: 'var(--color-success)', color: 'white' },
  }[ticket.status] || { bg: '', color: '' };
  const statusLabel = t.kds.badge[ticket.status];
  const typeLabel = (t.kds.orderType as Record<string, string>)[ticket.type] ?? ticket.type;

  return (
    /* .rise-in plays once per mount; .card-out holds the slot (faded, unclickable) while delivering */
    <div className={`surface-paper min-h-[120px] rise-in${leaving ? ' card-out' : ''}`} style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', borderTop: `4px solid ${accent}`, color: 'var(--color-text)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid var(--color-border)' }}>
        <div className="num" style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.01em' }}>#{ticket.queue}</div>
        <div style={{ flex: 1 }}>
          <div className="text-xs" style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--color-text-secondary)' }}>
            <Icon name={typeIconMap[ticket.type] || 'cart'} size={12} /> {typeLabel}
          </div>
          <Tag tone={urgency === 'red' ? 'danger' : urgency === 'yellow' ? 'warning' : 'accent'}>
            <Icon name="clock" size={10} /> {t.kds.minutes(mins)}
          </Tag>
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 8px', borderRadius: 999, background: statusStyle.bg, color: statusStyle.color }}>{statusLabel}</span>
      </div>

      <div style={{ padding: '12px 16px', flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {ticket.items.map((it, i) => (
          <div key={i}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div className="text-base" style={{ fontWeight: 600, lineHeight: 1.3 }}>{it.name}</div>
                {nameToId.has(it.name) && (
                  <button
                    onClick={() => onStepsClick(nameToId.get(it.name)!, it.name)}
                    title={t.kds.howTo}
                    aria-label={t.kds.howToAria(it.name)}
                    className="help-badge hit-44"
                    style={{ width: 22, height: 22, borderRadius: 999, cursor: 'pointer', fontSize: 11, fontWeight: 700, display: 'grid', placeItems: 'center', flexShrink: 0 }}
                  >?</button>
                )}
              </div>
              <div className="num" style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-primary)' }}>×{it.qty}</div>
            </div>
            {it.mods.length > 0 && (
              <div className="text-sm" style={{ color: 'var(--color-text-secondary)', marginTop: 2, lineHeight: 1.5 }}>
                {it.mods.map((m, k) => {
                  const isSpecial = m.startsWith('+') || m.includes('นมโอ๊ต') || m.includes('นมอัลมอนด์');
                  return (
                    <span key={k} style={{ fontWeight: isSpecial ? 700 : 400, color: isSpecial ? 'var(--color-primary)' : 'inherit' }}>
                      {m}{k < it.mods.length - 1 ? ' • ' : ''}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ padding: 12, background: 'var(--color-surface-2)', display: 'flex', gap: 8 }}>
        {ticket.status === 'new' && (
          <button onClick={onBump} className="btn btn-primary min-h-[44px]" style={{ flex: 1 }}>
            <Icon name="coffee" size={14} /> {t.kds.start}
          </button>
        )}
        {ticket.status === 'progress' && (
          <button onClick={onDone} className="btn btn-accent min-h-[44px]" style={{ flex: 1 }}>
            <Icon name="check" size={14} /> {t.kds.done}
          </button>
        )}
        {ticket.status === 'ready' && (
          <button onClick={onDone} className="btn btn-primary min-h-[44px]" style={{ flex: 1, background: 'var(--color-success)', borderColor: 'var(--color-success)' }}>
            <Icon name="check" size={14} /> {t.kds.deliver}
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

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(26, 16, 8, 0.7)', display: 'grid', placeItems: 'center', zIndex: 200, padding: 20, animation: 'backdrop-in var(--dur-base) var(--ease-out)' }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="surface-inverse"
        style={{ borderRadius: 16, width: '100%', maxWidth: 420, maxHeight: '70vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 50px rgba(0,0,0,0.5)', animation: 'modal-in var(--dur-slow) var(--ease-out)' }}
      >
        <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>{t.kds.howTo}</div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{productName}</div>
          </div>
          <button onClick={onClose} aria-label={t.common.close} className="icon-btn-soft hit-44" style={{ border: 'none', cursor: 'pointer', width: 32, height: 32, borderRadius: 8, display: 'grid', placeItems: 'center' }}>
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="scroll" style={{ overflow: 'auto', padding: 20, flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {isLoading ? (
            /* Step placeholders mirror the numbered-step rows below so the modal
               body doesn't jump when the real steps land. */
            <div aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <span className="sr-only">{t.common.loading}</span>
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                  <DarkBar w={28} h={28} r="var(--radius-pill)" />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 4 }}>
                    <DarkBar w="92%" h={13} />
                    <DarkBar w="64%" h={13} />
                  </div>
                </div>
              ))}
            </div>
          ) : !steps || steps.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 32, color: 'rgba(255,255,255,0.5)', fontSize: 14 }}>{t.kds.noSteps}</div>
          ) : steps.map((step, idx) => (
            <div key={step.id} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <div style={{ width: 28, height: 28, borderRadius: 999, background: 'var(--color-accent)', color: 'var(--color-primary-700)', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 800, flexShrink: 0 }}>{idx + 1}</div>
              <div style={{ fontSize: 15, lineHeight: 1.6, paddingTop: 4 }}>{step.instruction}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
