// KDS — Kitchen Display System
// Card grid of order tickets, color-coded by elapsed time

const KDS = () => {
  const toast = AppCommon.useToast();
  const [tickets, setTickets] = useState(KDS_TICKETS);
  const [tick, setTick] = useState(0);

  // Re-render every 30s so timers update (also drives color changes)
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 30000);
    return () => clearInterval(t);
  }, []);

  const elapsed = (placedAt) => Math.floor((Date.now() - placedAt) / 60000);

  const onBump = (id) => {
    setTickets((cur) => cur.map((t) => t.id === id ? { ...t, status: 'progress' } : t));
    toast({ kind: 'info', title: `ออเดอร์ ${id} เริ่มทำ`, duration: 1600 });
  };
  const onDone = (id) => {
    setTickets((cur) => cur.filter((t) => t.id !== id));
    toast({ kind: 'success', title: `ออเดอร์ ${id} เสร็จแล้ว`, msg: 'ส่งมอบลูกค้า', duration: 1800 });
  };

  // Sort by status priority: progress > new > ready, then by oldest first
  const order = { progress: 0, new: 1, ready: 2 };
  const sorted = [...tickets].sort((a, b) => order[a.status] - order[b.status] || a.placedAt - b.placedAt);

  const counts = {
    new: tickets.filter((t) => t.status === 'new').length,
    progress: tickets.filter((t) => t.status === 'progress').length,
    ready: tickets.filter((t) => t.status === 'ready').length,
  };

  return (
    <div style={{display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--color-primary-700)', color: 'white'}}>
      {/* Header */}
      <div style={{
        padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 24,
        borderBottom: '1px solid rgba(255,255,255,0.08)',
      }}>
        <div>
          <div style={{fontSize: 20, fontWeight: 700, letterSpacing: '-0.01em'}}>Kitchen Display</div>
          <div style={{fontSize: 12, color: 'rgba(255,255,255,0.55)'}}>Sukhumvit 49 • บาริสต้าสเตชัน 1</div>
        </div>
        <div style={{flex: 1, display: 'flex', gap: 12}}>
          <KDSStatChip label="ออเดอร์ใหม่" count={counts.new} color="var(--color-warning)" />
          <KDSStatChip label="กำลังทำ" count={counts.progress} color="var(--color-accent)" />
          <KDSStatChip label="พร้อมส่ง" count={counts.ready} color="var(--color-success)" />
        </div>
        <div style={{fontSize: 12, color: 'rgba(255,255,255,0.55)'}} className="num">
          <Clock />
        </div>
      </div>

      {/* Grid */}
      <div className="scroll" style={{flex: 1, overflow: 'auto', padding: 24}}>
        {sorted.length === 0 ? (
          <div style={{textAlign: 'center', padding: 80, color: 'rgba(255,255,255,0.55)'}}>
            <div style={{marginBottom: 12, opacity: 0.4}}><Icon name="check" size={56}/></div>
            <div style={{fontSize: 20, fontWeight: 700, marginBottom: 4}}>เคลียร์หมดแล้ว 🎉</div>
            <div>ไม่มีออเดอร์ค้างในคิว</div>
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 16,
          }}>
            {sorted.map((t) => (
              <OrderTicket key={t.id} ticket={t} mins={elapsed(t.placedAt)} onBump={() => onBump(t.id)} onDone={() => onDone(t.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const Clock = () => {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const pad = (n) => String(n).padStart(2, '0');
  return <span>{pad(now.getHours())}:{pad(now.getMinutes())}:{pad(now.getSeconds())}</span>;
};

const KDSStatChip = ({ label, count, color }) => (
  <div style={{
    background: 'rgba(255,255,255,0.06)', borderRadius: 8,
    padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 10,
  }}>
    <span style={{width: 8, height: 8, borderRadius: 999, background: color}}/>
    <span style={{fontSize: 12, color: 'rgba(255,255,255,0.7)'}}>{label}</span>
    <span className="num" style={{fontSize: 16, fontWeight: 700, color}}>{count}</span>
  </div>
);

const OrderTicket = ({ ticket, mins, onBump, onDone }) => {
  // Color logic: <5 min normal, 5-10 yellow, >10 red
  const urgency = mins >= 10 ? 'red' : mins >= 5 ? 'yellow' : 'normal';
  const accent = urgency === 'red' ? 'var(--color-danger)' : urgency === 'yellow' ? 'var(--color-warning)' : 'var(--color-accent)';

  const typeIconMap = { 'Dine-in': 'cake', 'Takeaway': 'cart', 'Delivery': 'park' };

  const statusBadge = {
    new:      { label: 'ใหม่',     bg: 'var(--color-warning)', color: '#9C6A1F' },
    progress: { label: 'กำลังทำ',  bg: 'var(--color-accent)',  color: 'var(--color-primary-700)' },
    ready:    { label: 'พร้อมส่ง', bg: 'var(--color-success)', color: 'white' },
  }[ticket.status];

  return (
    <div style={{
      background: 'white',
      borderRadius: 12,
      borderTop: `4px solid ${accent}`,
      color: 'var(--color-text)',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
      animation: ticket.status === 'new' ? 'newCard 400ms var(--ease-out)' : 'none',
    }}>
      {/* Header */}
      <div style={{padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid var(--color-border)'}}>
        <div className="num" style={{fontSize: 28, fontWeight: 700, letterSpacing: '-0.01em'}}>#{ticket.queue}</div>
        <div style={{flex: 1}}>
          <div style={{display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--color-text-secondary)'}}>
            <Icon name={typeIconMap[ticket.type] || 'cart'} size={12}/> {ticket.type}
          </div>
          <AppCommon.Tag tone={urgency === 'red' ? 'danger' : urgency === 'yellow' ? 'warning' : 'accent'}>
            <Icon name="clock" size={10}/> {mins} นาที
          </AppCommon.Tag>
        </div>
        <span style={{
          fontSize: 11, fontWeight: 700, padding: '4px 8px', borderRadius: 999,
          background: statusBadge.bg, color: statusBadge.color,
        }}>{statusBadge.label}</span>
      </div>

      {/* Items */}
      <div style={{padding: '12px 16px', flex: 1, display: 'flex', flexDirection: 'column', gap: 10}}>
        {ticket.items.map((it, i) => (
          <div key={i}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8}}>
              <div style={{fontSize: 16, fontWeight: 600, lineHeight: 1.3}}>{it.name}</div>
              <div className="num" style={{fontSize: 18, fontWeight: 700, color: 'var(--color-primary)'}}>×{it.qty}</div>
            </div>
            {it.mods.length > 0 && (
              <div style={{fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 2, lineHeight: 1.5}}>
                {it.mods.map((m, k) => {
                  const isSpecial = m.startsWith('+') || m.includes('นมโอ๊ต') || m.includes('นมอัลมอนด์');
                  return (
                    <span key={k} style={{fontWeight: isSpecial ? 700 : 400, color: isSpecial ? 'var(--color-primary)' : 'inherit'}}>
                      {m}{k < it.mods.length - 1 ? ' • ' : ''}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Action */}
      <div style={{padding: 12, background: 'var(--color-surface-2)', display: 'flex', gap: 8}}>
        {ticket.status === 'new' && (
          <button onClick={onBump} className="btn btn-primary" style={{flex: 1}}>
            <Icon name="coffee" size={14}/> เริ่มทำ
          </button>
        )}
        {ticket.status === 'progress' && (
          <button onClick={onDone} className="btn btn-accent" style={{flex: 1}}>
            <Icon name="check" size={14}/> เสร็จแล้ว
          </button>
        )}
        {ticket.status === 'ready' && (
          <button onClick={onDone} className="btn btn-primary" style={{flex: 1, background: 'var(--color-success)', borderColor: 'var(--color-success)'}}>
            <Icon name="check" size={14}/> ส่งมอบลูกค้า
          </button>
        )}
      </div>
      <style>{`@keyframes newCard { from { transform: translateY(8px); opacity: 0; } to { transform: none; opacity: 1; } }`}</style>
    </div>
  );
};

window.KDS = KDS;
