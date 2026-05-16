'use client';

import { useState, useEffect, useMemo } from 'react';
import Icon from '../icons';
import { useToast, Tag } from '../app-common';
import { useKDSOrders, useUpdateOrderStatus, type KDSTicket } from '@/hooks/use-orders';
import { useAllProducts } from '@/hooks/use-products';
import { useCookingSteps } from '@/hooks/use-cooking-steps';

export default function KDS() {
  const toast = useToast();
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

  // Seed local state from server on each poll
  useEffect(() => {
    if (serverTickets) setLocalTickets(serverTickets);
  }, [serverTickets]);

  // Re-render every 30s so elapsed times update
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 30000);
    return () => clearInterval(t);
  }, []);
  void tick;

  const elapsed = (placedAt: number) => Math.floor((Date.now() - placedAt) / 60000);

  const onBump = (ticket: KDSTicket) => {
    setLocalTickets(cur => cur.map(t => t.orderId === ticket.orderId ? { ...t, status: 'progress' as const } : t));
    updateStatus.mutateAsync({ orderId: ticket.orderId, status: 'IN_PROGRESS' })
      .catch(() => toast({ kind: 'danger', title: 'อัปเดตสถานะไม่สำเร็จ' }));
    toast({ kind: 'info', title: `ออเดอร์ ${ticket.id} เริ่มทำ`, duration: 1600 });
  };

  const onDone = (ticket: KDSTicket) => {
    if (ticket.status === 'progress') {
      setLocalTickets(cur => cur.map(t => t.orderId === ticket.orderId ? { ...t, status: 'ready' as const } : t));
      updateStatus.mutateAsync({ orderId: ticket.orderId, status: 'READY' })
        .catch(() => toast({ kind: 'danger', title: 'อัปเดตสถานะไม่สำเร็จ' }));
    } else {
      setLocalTickets(cur => cur.filter(t => t.orderId !== ticket.orderId));
      updateStatus.mutateAsync({ orderId: ticket.orderId, status: 'COMPLETED' })
        .then(() => toast({ kind: 'success', title: `ออเดอร์ ${ticket.id} เสร็จแล้ว`, msg: 'ส่งมอบลูกค้า', duration: 1800 }))
        .catch(() => toast({ kind: 'danger', title: 'อัปเดตสถานะไม่สำเร็จ' }));
    }
  };

  const order: Record<string, number> = { progress: 0, new: 1, ready: 2 };
  const sorted = [...localTickets].sort((a, b) => order[a.status] - order[b.status] || a.placedAt - b.placedAt);

  const counts = {
    new:      localTickets.filter(t => t.status === 'new').length,
    progress: localTickets.filter(t => t.status === 'progress').length,
    ready:    localTickets.filter(t => t.status === 'ready').length,
  };

  return (
    <>
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--color-primary-700)', color: 'white' }}>
      <div style={{ padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 24, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.01em' }}>Kitchen Display</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)' }}>Sukhumvit 49 • บาริสต้าสเตชัน 1</div>
        </div>
        <div style={{ flex: 1, display: 'flex', gap: 12 }}>
          <KDSStatChip label="ออเดอร์ใหม่" count={counts.new} color="var(--color-warning)" />
          <KDSStatChip label="กำลังทำ" count={counts.progress} color="var(--color-accent)" />
          <KDSStatChip label="พร้อมส่ง" count={counts.ready} color="var(--color-success)" />
        </div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)' }} className="num">
          <Clock />
        </div>
      </div>

      <div className="scroll" style={{ flex: 1, overflow: 'auto', padding: 24 }}>
        {isLoading && localTickets.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 80, color: 'rgba(255,255,255,0.55)' }}>
            <div style={{ marginBottom: 12, opacity: 0.4 }}><Icon name="clock" size={40} /></div>
            <div style={{ fontSize: 16 }}>กำลังโหลดออเดอร์...</div>
          </div>
        ) : sorted.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 80, color: 'rgba(255,255,255,0.55)' }}>
            <div style={{ marginBottom: 12, opacity: 0.4 }}><Icon name="check" size={56} /></div>
            <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>เคลียร์หมดแล้ว 🎉</div>
            <div>ไม่มีออเดอร์ค้างในคิว</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
            {sorted.map(t => (
              <OrderTicket
                key={t.orderId}
                ticket={t}
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

const OrderTicket = ({ ticket, mins, nameToId, onBump, onDone, onStepsClick }: {
  ticket: KDSTicket;
  mins: number;
  nameToId: Map<string, string>;
  onBump: () => void;
  onDone: () => void;
  onStepsClick: (productId: string, productName: string) => void;
}) => {
  const urgency = mins >= 10 ? 'red' : mins >= 5 ? 'yellow' : 'normal';
  const accent = urgency === 'red' ? 'var(--color-danger)' : urgency === 'yellow' ? 'var(--color-warning)' : 'var(--color-accent)';
  const typeIconMap: Record<string, string> = { 'Dine-in': 'cake', 'Takeaway': 'cart', 'Delivery': 'park' };
  const statusBadge = {
    new:      { label: 'ใหม่',     bg: 'var(--color-warning)', color: '#9C6A1F' },
    progress: { label: 'กำลังทำ',  bg: 'var(--color-accent)',  color: 'var(--color-primary-700)' },
    ready:    { label: 'พร้อมส่ง', bg: 'var(--color-success)', color: 'white' },
  }[ticket.status] || { label: '', bg: '', color: '' };

  return (
    <div style={{ background: 'white', borderRadius: 12, borderTop: `4px solid ${accent}`, color: 'var(--color-text)', display: 'flex', flexDirection: 'column', overflow: 'hidden', animation: ticket.status === 'new' ? 'newCard 400ms var(--ease-out)' : 'none' }}>
      <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid var(--color-border)' }}>
        <div className="num" style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.01em' }}>#{ticket.queue}</div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--color-text-secondary)' }}>
            <Icon name={typeIconMap[ticket.type] || 'cart'} size={12} /> {ticket.type}
          </div>
          <Tag tone={urgency === 'red' ? 'danger' : urgency === 'yellow' ? 'warning' : 'accent'}>
            <Icon name="clock" size={10} /> {mins} นาที
          </Tag>
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 8px', borderRadius: 999, background: statusBadge.bg, color: statusBadge.color }}>{statusBadge.label}</span>
      </div>

      <div style={{ padding: '12px 16px', flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {ticket.items.map((it, i) => (
          <div key={i}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.3 }}>{it.name}</div>
                {nameToId.has(it.name) && (
                  <button
                    onClick={() => onStepsClick(nameToId.get(it.name)!, it.name)}
                    title="วิธีทำ"
                    style={{ width: 20, height: 20, borderRadius: 999, border: '1px solid rgba(0,0,0,0.15)', background: 'rgba(0,0,0,0.06)', cursor: 'pointer', fontSize: 11, fontWeight: 700, color: 'var(--color-text-secondary)', display: 'grid', placeItems: 'center', flexShrink: 0, transition: 'all 150ms var(--ease-out)' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-primary)'; e.currentTarget.style.color = 'white'; e.currentTarget.style.borderColor = 'var(--color-primary)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.06)'; e.currentTarget.style.color = 'var(--color-text-secondary)'; e.currentTarget.style.borderColor = 'rgba(0,0,0,0.15)'; }}
                  >?</button>
                )}
              </div>
              <div className="num" style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-primary)' }}>×{it.qty}</div>
            </div>
            {it.mods.length > 0 && (
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 2, lineHeight: 1.5 }}>
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
          <button onClick={onBump} className="btn btn-primary" style={{ flex: 1 }}>
            <Icon name="coffee" size={14} /> เริ่มทำ
          </button>
        )}
        {ticket.status === 'progress' && (
          <button onClick={onDone} className="btn btn-accent" style={{ flex: 1 }}>
            <Icon name="check" size={14} /> เสร็จแล้ว
          </button>
        )}
        {ticket.status === 'ready' && (
          <button onClick={onDone} className="btn btn-primary" style={{ flex: 1, background: 'var(--color-success)', borderColor: 'var(--color-success)' }}>
            <Icon name="check" size={14} /> ส่งมอบลูกค้า
          </button>
        )}
      </div>
      <style>{`@keyframes newCard { from { transform: translateY(8px); opacity: 0; } to { transform: none; opacity: 1; } }`}</style>
    </div>
  );
};

const CookingStepsModal = ({ productId, productName, onClose }: {
  productId: string;
  productName: string;
  onClose: () => void;
}) => {
  const { data: steps, isLoading } = useCookingSteps(productId);

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(26, 16, 8, 0.7)', display: 'grid', placeItems: 'center', zIndex: 200, padding: 20 }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: 'var(--color-primary-700)', borderRadius: 16, width: '100%', maxWidth: 420, maxHeight: '70vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 50px rgba(0,0,0,0.5)', color: 'white' }}
      >
        <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>วิธีทำ</div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{productName}</div>
          </div>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.08)', border: 'none', cursor: 'pointer', width: 32, height: 32, borderRadius: 8, display: 'grid', placeItems: 'center', color: 'white', transition: 'background 150ms' }} onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.15)'} onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}>
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="scroll" style={{ overflow: 'auto', padding: 20, flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {isLoading ? (
            <div style={{ textAlign: 'center', padding: 32, color: 'rgba(255,255,255,0.5)', fontSize: 14 }}>กำลังโหลด...</div>
          ) : !steps || steps.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 32, color: 'rgba(255,255,255,0.5)', fontSize: 14 }}>ไม่มีขั้นตอนการทำ</div>
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
