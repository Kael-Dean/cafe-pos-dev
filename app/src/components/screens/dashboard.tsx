'use client';

import Icon from '../icons';
import { KPICard, Tag, baht } from '../app-common';
import { DASHBOARD } from '../data/mock-data';
import { useKDSOrders, type KDSTicket } from '@/hooks/use-orders';
import { useInventory, type InventoryItem } from '@/hooks/use-inventory';
import { useDashboardToday, useSalesHourly } from '@/hooks/use-dashboard';

function elapsedLabel(placedAt: number): string {
  const mins = Math.floor((Date.now() - placedAt) / 60000);
  if (mins < 1) return 'เพิ่งสั่ง';
  if (mins < 60) return `${mins} นาทีที่แล้ว`;
  return `${Math.floor(mins / 60)} ชั่วโมงที่แล้ว`;
}

export default function Dashboard() {
  const d = DASHBOARD;
  const { data: liveTickets } = useKDSOrders();
  const { data: inventoryItems } = useInventory();
  const { data: todayData } = useDashboardToday();
  const hourly = useSalesHourly();

  const liveOrders = (liveTickets ?? [])
    .slice()
    .sort((a, b) => b.placedAt - a.placedAt)
    .slice(0, 5);

  const lowStockItems = (inventoryItems ?? [])
    .filter(inv => inv.parLevel > 0 && inv.stock < inv.parLevel)
    .sort((a, b) => (a.stock / a.parLevel) - (b.stock / b.parLevel))
    .slice(0, 5);

  // Merge real KPI values over mock defaults (GP% kept as mock — no backend source yet)
  const kpis = d.kpis.map(k => {
    if (!todayData) return k;
    if (k.id === 'revenue') return { ...k, value: Number(todayData.revenue) };
    if (k.id === 'orders')  return { ...k, value: todayData.order_count };
    if (k.id === 'atv')     return { ...k, value: Number(todayData.avg_ticket) };
    return k;
  });

  // Top items from real data; fall back to mock when API hasn't responded
  const topItems = todayData?.top_items?.length
    ? todayData.top_items.map(it => ({ name: it.product_name, qty: it.quantity, rev: Number(it.revenue) }))
    : d.topItems;

  // Hourly chart: use real data when available, otherwise mock
  const chartHours   = hourly.hours;
  const chartToday   = hourly.today    ?? d.today;
  const chartLastWk  = hourly.lastWeek ?? d.lastWeek;

  return (
    <div className="scroll" style={{height: '100%', overflow: 'auto', padding: 24, background: 'var(--color-bg)'}}>
      <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20}}>
        <div>
          <div style={{fontSize: 12, color: 'var(--color-text-secondary)', fontWeight: 500, marginBottom: 2}}>ภาพรวม</div>
          <h1 style={{margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: '-0.01em'}}>Dashboard</h1>
        </div>
        <div style={{display: 'flex', gap: 8}}>
          <button className="btn btn-ghost"><Icon name="refresh" size={14}/> รีเฟรช</button>
          <button className="btn btn-ghost">วันนี้ <Icon name="chevronDown" size={14}/></button>
          <button className="btn btn-primary"><Icon name="reports" size={14}/> สร้างรายงาน</button>
        </div>
      </div>

      <div style={{display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 16}}>
        {kpis.map((k) => <KPICard key={k.id} {...k} />)}
      </div>

      <div style={{display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 16, marginBottom: 16}}>
        <Card>
          <CardHeader title="ยอดขายรายชั่วโมง" sub="วันนี้ vs สัปดาห์ก่อน">
            <div style={{display: 'flex', gap: 12, fontSize: 12}}>
              <Legend color="var(--color-primary)" label="วันนี้" />
              <Legend color="var(--color-accent)" label="สัปดาห์ก่อน" dashed />
            </div>
          </CardHeader>
          <LineChart hours={chartHours} today={chartToday} prev={chartLastWk} />
        </Card>
        <Card>
          <CardHeader title="เมนูขายดี Top 10" sub="วันนี้ • เรียงตามจำนวน" />
          <BarList items={topItems} />
        </Card>
      </div>

      <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16}}>
        <Card>
          <CardHeader title="ออเดอร์สด" sub="อัปเดต real-time">
            <span style={{fontSize: 11, color: 'var(--color-success)', display: 'inline-flex', alignItems: 'center', gap: 4}}>
              <span style={{width: 6, height: 6, borderRadius: 999, background: 'var(--color-success)'}}/> Live
            </span>
          </CardHeader>
          <div style={{padding: '0 4px 4px'}}>
            {liveOrders.length > 0
              ? liveOrders.map(t => <LiveOrderFromKDS key={t.orderId} ticket={t} />)
              : d.liveOrders.map((o) => <LiveOrderRow key={o.id} order={o} />)
            }
          </div>
        </Card>
        <Card>
          <CardHeader title="สต็อกใกล้หมด" sub="ต่ำกว่า par level" />
          <div style={{padding: '0 4px 4px'}}>
            {lowStockItems.length > 0
              ? lowStockItems.map(inv => <LowStockFromInventory key={inv.id} inv={inv} />)
              : d.lowStock.map((s, i) => <LowStockRow key={i} item={s} />)
            }
            <button className="btn btn-ghost btn-block" style={{marginTop: 8}}>
              <Icon name="inv" size={14}/> สั่งซื้ออัตโนมัติ
            </button>
          </div>
        </Card>
        <Card>
          <CardHeader title="พนักงาน" sub="กะปัจจุบัน • Active" />
          <div style={{padding: '0 4px 4px'}}>
            {d.staff.map((s, i) => <StaffRow key={i} staff={s} />)}
          </div>
        </Card>
      </div>
    </div>
  );
}

const Card = ({ children }: { children: React.ReactNode }) => (
  <div style={{background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 16}}>
    {children}
  </div>
);

const CardHeader = ({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) => (
  <div style={{display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16, gap: 12}}>
    <div>
      <div style={{fontSize: 14, fontWeight: 600}}>{title}</div>
      {sub && <div style={{fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2}}>{sub}</div>}
    </div>
    {children}
  </div>
);

const Legend = ({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) => (
  <div style={{display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-text-secondary)'}}>
    <svg width="20" height="6"><line x1="0" y1="3" x2="20" y2="3" stroke={color} strokeWidth="2.5" strokeDasharray={dashed ? '3 3' : '0'}/></svg>
    {label}
  </div>
);

const LineChart = ({ hours, today, prev }: { hours: string[]; today: number[]; prev: number[] }) => {
  const W = 600, H = 220, P = 28;
  const max = Math.max(...today, ...prev) * 1.1;
  const x = (i: number) => P + (i * (W - P * 2)) / (hours.length - 1);
  const y = (v: number) => H - P - (v / max) * (H - P * 2);
  const path = (data: number[]) => data.map((v, i) => `${i ? 'L' : 'M'} ${x(i)} ${y(v)}`).join(' ');
  const area = (data: number[]) => `${path(data)} L ${x(data.length - 1)} ${H - P} L ${x(0)} ${H - P} Z`;
  const total = today.reduce((s, v) => s + v, 0);

  return (
    <div>
      <div style={{fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 4}}>รวมทั้งวัน (โดยประมาณ)</div>
      <div className="num" style={{fontSize: 28, fontWeight: 700, letterSpacing: '-0.01em', marginBottom: 12}}>฿{total.toLocaleString()}</div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none">
        <defs>
          <linearGradient id="todayFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.18"/>
            <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0"/>
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((t, i) => (
          <line key={i} x1={P} x2={W - P} y1={P + t * (H - 2 * P)} y2={P + t * (H - 2 * P)} stroke="var(--color-border)" strokeDasharray="2 4"/>
        ))}
        {hours.map((h, i) => i % 2 === 0 && (
          <text key={h} x={x(i)} y={H - 8} fontSize="10" textAnchor="middle" fill="var(--color-text-muted)">{h}</text>
        ))}
        <path d={path(prev)} fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeDasharray="4 4"/>
        <path d={area(today)} fill="url(#todayFill)"/>
        <path d={path(today)} fill="none" stroke="var(--color-primary)" strokeWidth="2.5"/>
        {today.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r="3" fill="var(--color-primary)"/>)}
      </svg>
    </div>
  );
};

const BarList = ({ items }: { items: typeof DASHBOARD['topItems'] }) => {
  const max = Math.max(...items.map((x) => x.qty));
  return (
    <div style={{display: 'flex', flexDirection: 'column', gap: 8}}>
      {items.map((it, i) => (
        <div key={i} style={{display: 'flex', alignItems: 'center', gap: 10, fontSize: 13}}>
          <div style={{width: 20, fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 600, textAlign: 'right'}}>{i + 1}</div>
          <div style={{flex: 1, minWidth: 0}}>
            <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: 4}}>
              <span style={{fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{it.name}</span>
              <span className="num" style={{fontWeight: 600, color: 'var(--color-text-secondary)'}}>{it.qty}</span>
            </div>
            <div style={{height: 6, background: 'var(--color-surface-2)', borderRadius: 999, overflow: 'hidden'}}>
              <div style={{
                width: `${(it.qty / max) * 100}%`, height: '100%',
                background: i < 3 ? 'var(--color-primary)' : 'var(--color-accent)',
                borderRadius: 999,
              }}/>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

const LiveOrderRow = ({ order }: { order: typeof DASHBOARD['liveOrders'][0] }) => {
  const tone = order.status === 'new' ? 'warning' : order.status === 'ready' ? 'success' : 'accent';
  const label = order.status === 'new' ? 'ใหม่' : order.status === 'ready' ? 'พร้อม' : 'กำลังทำ';
  return (
    <div style={{padding: '10px 8px', borderBottom: '1px solid var(--color-surface-2)', display: 'flex', alignItems: 'center', gap: 10}}>
      <div className="num" style={{fontSize: 14, fontWeight: 700, minWidth: 44}}>{order.id}</div>
      <div style={{flex: 1, minWidth: 0}}>
        <div style={{fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{order.items}</div>
        <div style={{fontSize: 11, color: 'var(--color-text-muted)'}}>{order.time}</div>
      </div>
      <div className="num" style={{fontSize: 13, fontWeight: 600}}>฿{order.total}</div>
      <Tag tone={tone as 'warning' | 'success' | 'accent'}>{label}</Tag>
    </div>
  );
};

const LowStockRow = ({ item }: { item: typeof DASHBOARD['lowStock'][0] }) => {
  const tone = item.status === 'red' ? 'danger' : 'warning';
  const pct = Math.min(100, (item.level / item.par) * 100);
  return (
    <div style={{padding: '10px 8px', borderBottom: '1px solid var(--color-surface-2)'}}>
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4}}>
        <div style={{fontSize: 13, fontWeight: 500}}>{item.name}</div>
        <Tag tone={tone}>{Math.round(pct)}%</Tag>
      </div>
      <div style={{display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4}} className="num">
        <span>เหลือ {item.level.toLocaleString()} {item.unit}</span>
        <span>par {item.par.toLocaleString()} {item.unit}</span>
      </div>
      <div style={{height: 4, background: 'var(--color-surface-2)', borderRadius: 999}}>
        <div style={{
          width: `${pct}%`, height: '100%', borderRadius: 999,
          background: item.status === 'red' ? 'var(--color-danger)' : 'var(--color-warning)',
        }}/>
      </div>
    </div>
  );
};

const LiveOrderFromKDS = ({ ticket }: { ticket: KDSTicket }) => {
  const tone = ticket.status === 'new' ? 'warning' : ticket.status === 'ready' ? 'success' : 'accent';
  const label = ticket.status === 'new' ? 'ใหม่' : ticket.status === 'ready' ? 'พร้อม' : 'กำลังทำ';
  const summary = ticket.items.map(it => `${it.name}${it.qty > 1 ? ` ×${it.qty}` : ''}`).join(', ');
  return (
    <div style={{padding: '10px 8px', borderBottom: '1px solid var(--color-surface-2)', display: 'flex', alignItems: 'center', gap: 10}}>
      <div className="num" style={{fontSize: 14, fontWeight: 700, minWidth: 44}}>{ticket.id}</div>
      <div style={{flex: 1, minWidth: 0}}>
        <div style={{fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{summary}</div>
        <div style={{fontSize: 11, color: 'var(--color-text-muted)'}}>{elapsedLabel(ticket.placedAt)}</div>
      </div>
      <Tag tone={tone as 'warning' | 'success' | 'accent'}>{label}</Tag>
    </div>
  );
};

const LowStockFromInventory = ({ inv }: { inv: InventoryItem }) => {
  const pct = inv.parLevel > 0 ? Math.min(100, (inv.stock / inv.parLevel) * 100) : 0;
  const tone = pct < 50 ? 'danger' : 'warning';
  return (
    <div style={{padding: '10px 8px', borderBottom: '1px solid var(--color-surface-2)'}}>
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4}}>
        <div style={{fontSize: 13, fontWeight: 500}}>{inv.name}</div>
        <Tag tone={tone}>{Math.round(pct)}%</Tag>
      </div>
      <div style={{display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4}} className="num">
        <span>เหลือ {inv.stock.toLocaleString()} {inv.unit}</span>
        <span>par {inv.parLevel.toLocaleString()} {inv.unit}</span>
      </div>
      <div style={{height: 4, background: 'var(--color-surface-2)', borderRadius: 999}}>
        <div style={{width: `${pct}%`, height: '100%', borderRadius: 999, background: pct < 50 ? 'var(--color-danger)' : 'var(--color-warning)'}}/>
      </div>
    </div>
  );
};

const StaffRow = ({ staff }: { staff: typeof DASHBOARD['staff'][0] }) => (
  <div style={{padding: '10px 8px', borderBottom: '1px solid var(--color-surface-2)', display: 'flex', alignItems: 'center', gap: 10}}>
    <div style={{
      width: 32, height: 32, borderRadius: 999,
      background: 'var(--color-accent-50)', color: 'var(--color-primary)',
      display: 'grid', placeItems: 'center', fontWeight: 700,
    }}>{staff.initials}</div>
    <div style={{flex: 1, minWidth: 0}}>
      <div style={{fontSize: 13, fontWeight: 600}}>{staff.name}</div>
      <div style={{fontSize: 11, color: 'var(--color-text-muted)'}}>{staff.role} • {staff.orders} บิล</div>
    </div>
    <div className="num" style={{fontSize: 13, fontWeight: 600}}>{baht(staff.sales)}</div>
  </div>
);
