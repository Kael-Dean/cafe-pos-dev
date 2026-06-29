'use client';

import { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import Icon from '../icons';
import { KPICard, Tag, baht, Select } from '../app-common';
import { useI18n } from '@/lib/i18n';
import { DASHBOARD } from '../data/mock-data';
import { useKDSOrders, type KDSTicket } from '@/hooks/use-orders';
import { useInventory, type InventoryItem } from '@/hooks/use-inventory';
import {
  useDashboardToday,
  useRangeKpis,
  useRangeTopItems,
  useTrendChart,
  useCashierShifts,
  resolveRange,
  type DashboardPreset,
  type StaffShiftFE,
} from '@/hooks/use-dashboard';
import { useFadeRise, useStagger, useCountUp } from '@/lib/motion';
import { Skeleton } from '@/components/ui/skeleton';

// Preset date-range options for the header dropdown (labels inline, app convention).
const PRESET_OPTIONS: { value: DashboardPreset; label: string }[] = [
  { value: 'today',     label: 'วันนี้' },
  { value: 'yesterday', label: 'เมื่อวาน' },
  { value: 'last7',     label: '7 วันล่าสุด' },
  { value: 'last30',    label: '30 วันล่าสุด' },
];

export default function Dashboard() {
  const { t } = useI18n();
  const d = DASHBOARD;
  const qc = useQueryClient();

  const [preset, setPreset] = useState<DashboardPreset>('today');
  const range = useMemo(() => resolveRange(preset), [preset]);
  const isToday = preset === 'today';

  const { data: liveTickets } = useKDSOrders();
  const { data: inventoryItems } = useInventory();

  // KPIs + top items: the live /dashboard/today path for "today" (richer + realtime),
  // otherwise derived from /reports/sales over the selected range.
  const { data: todayData, isLoading: todayLoading } = useDashboardToday(isToday);
  const { data: rangeKpis, isLoading: rangeKpiLoading } = useRangeKpis(range, !isToday);
  const { data: rangeTop } = useRangeTopItems(range, !isToday);

  const trend = useTrendChart(range);
  const { data: staffShifts } = useCashierShifts(range);

  const kpiLoading = isToday ? todayLoading : rangeKpiLoading;

  const refresh = () => {
    // Invalidate every dashboard/report query — the active preset's keys refetch.
    qc.invalidateQueries({ queryKey: ['dashboard-today'] });
    qc.invalidateQueries({ queryKey: ['dashboard-range-kpis'] });
    qc.invalidateQueries({ queryKey: ['dashboard-range-top'] });
    qc.invalidateQueries({ queryKey: ['dashboard-trend-hourly'] });
    qc.invalidateQueries({ queryKey: ['dashboard-trend-hourly-prev'] });
    qc.invalidateQueries({ queryKey: ['dashboard-trend-daily'] });
    qc.invalidateQueries({ queryKey: ['cashier-shifts'] });
  };

  // Header fades+rises once on mount; the KPI grid + panel row stagger their
  // children in. Subtle and one-shot — the dashboard loads into a glance, not a show.
  const headerRef = useFadeRise();
  const kpiGridRef = useStagger({ each: 0.05 });
  const panelRowRef = useStagger({ each: 0.06 });

  const liveOrders = (liveTickets ?? [])
    .slice()
    .sort((a, b) => b.placedAt - a.placedAt)
    .slice(0, 5);

  const lowStockItems = (inventoryItems ?? [])
    .filter(inv => inv.parLevel > 0 && inv.stock < inv.parLevel)
    .sort((a, b) => (a.stock / a.parLevel) - (b.stock / b.parLevel))
    .slice(0, 5);

  // Resolve revenue / orders / atv from the active source (live today vs range totals).
  const revenue = isToday ? (todayData ? Number(todayData.revenue) : null) : (rangeKpis?.revenue ?? null);
  const orders  = isToday ? (todayData ? todayData.order_count : null)     : (rangeKpis?.orderCount ?? null);
  const atv     = isToday ? (todayData ? Number(todayData.avg_ticket) : null) : (rangeKpis?.avgTicket ?? null);

  // Merge real KPI values over mock defaults (GP% kept as mock — no backend source yet)
  const kpis = d.kpis.map(k => {
    if (k.id === 'revenue' && revenue !== null) return { ...k, value: revenue };
    if (k.id === 'orders'  && orders  !== null) return { ...k, value: orders };
    if (k.id === 'atv'     && atv     !== null) return { ...k, value: atv };
    return k;
  });

  // Top items: live today payload, or range product breakdown; fall back to mock.
  const topItems = isToday
    ? (todayData?.top_items?.length
        ? todayData.top_items.map(it => ({ name: it.product_name, qty: it.quantity, rev: Number(it.revenue) }))
        : d.topItems)
    : (rangeTop?.length ? rangeTop : d.topItems);

  const kpiText = t.dashboard.kpi as Record<string, { label: string; vsLabel: string; suffix: string }>;

  return (
    <div className="scroll" style={{height: '100%', overflow: 'auto', padding: 'var(--space-6)', background: 'var(--color-bg)'}}>
      <div ref={headerRef} style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-5)'}}>
        <div>
          <div style={{fontSize: 12, color: 'var(--color-text-secondary)', fontWeight: 500, marginBottom: 2}}>{t.dashboard.overline}</div>
          <h1 className="text-balance" style={{margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: '-0.01em'}}>{t.dashboard.title}</h1>
        </div>
        <div style={{display: 'flex', gap: 'var(--space-2)', alignItems: 'center'}}>
          <button className="btn btn-ghost" onClick={refresh}><Icon name="refresh" size={14}/> {t.dashboard.refresh}</button>
          <Select
            value={preset}
            onChange={(v) => setPreset(v as DashboardPreset)}
            ariaLabel="ช่วงเวลา"
            options={PRESET_OPTIONS}
            triggerStyle={{
              height: 34, padding: '0 12px', background: 'transparent',
              border: '1px solid var(--color-border)', fontWeight: 500,
            }}
          />
          <button className="btn btn-primary"><Icon name="reports" size={14}/> {t.dashboard.makeReport}</button>
        </div>
      </div>

      <div
        key={kpiLoading ? 'kpi-loading' : 'kpi-ready'}
        ref={kpiGridRef}
        style={{display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--space-4)', marginBottom: 'var(--space-4)'}}
        aria-busy={kpiLoading || undefined}
      >
        {kpiLoading ? (
          <>
            <span className="sr-only">{t.dashboard.loadingKpis}</span>
            {Array.from({ length: 4 }).map((_, i) => <KPICardSkeleton key={i} />)}
          </>
        ) : (
          kpis.map((k) => {
            const tk = kpiText[k.id];
            // Headline numbers count up on mount; GP% stays steady (it's a derived ratio).
            return <KPICard key={k.id} {...k} label={tk?.label ?? k.label} vsLabel={tk?.vsLabel ?? k.vsLabel} suffix={tk?.suffix ?? k.suffix} countUp={k.id !== 'gp'} />;
          })
        )}
      </div>

      <div style={{display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 'var(--space-4)', marginBottom: 'var(--space-4)'}}>
        <Card>
          <CardHeader
            title={range.isSingleDay ? t.dashboard.hourlyTitle : 'ยอดขายรายวัน'}
            sub={range.isSingleDay ? t.dashboard.hourlySub : 'รายวันตามช่วงที่เลือก'}
          >
            {range.isSingleDay && (
              <div style={{display: 'flex', gap: 'var(--space-3)', fontSize: 12}}>
                <Legend color="var(--color-primary)" label={preset === 'yesterday' ? 'เมื่อวาน' : t.dashboard.legendToday} />
                <Legend color="var(--color-accent)" label={t.dashboard.legendLastWeek} dashed />
              </div>
            )}
          </CardHeader>
          {trend.isLoading ? <LineChartSkeleton /> : (
            <LineChart
              labels={trend.labels}
              series={trend.series}
              compare={trend.compare}
              total={trend.total}
              totalLabel={range.isSingleDay ? t.dashboard.dayTotalApprox : 'รวมช่วง (โดยประมาณ)'}
            />
          )}
        </Card>
        <Card>
          <CardHeader
            title={t.dashboard.topTitle}
            sub={isToday ? t.dashboard.topSub : `${PRESET_OPTIONS.find(o => o.value === preset)?.label} • เรียงตามยอดขาย`}
          />
          <BarList items={topItems} />
        </Card>
      </div>

      <div ref={panelRowRef} style={{display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-4)'}}>
        <Card>
          <CardHeader title={t.dashboard.liveTitle} sub={t.dashboard.liveSub}>
            <span style={{fontSize: 11, color: 'var(--color-success)', display: 'inline-flex', alignItems: 'center', gap: 4}}>
              <span style={{width: 6, height: 6, borderRadius: 999, background: 'var(--color-success)'}}/> Live
            </span>
          </CardHeader>
          <div style={{padding: '0 4px 4px'}}>
            {liveOrders.length > 0
              ? liveOrders.map(tk => <LiveOrderFromKDS key={tk.orderId} ticket={tk} />)
              : d.liveOrders.map((o) => <LiveOrderRow key={o.id} order={o} />)
            }
          </div>
        </Card>
        <Card>
          <CardHeader title={t.dashboard.lowStockTitle} sub={t.dashboard.lowStockSub} />
          <div style={{padding: '0 4px 4px'}}>
            {lowStockItems.length > 0
              ? lowStockItems.map(inv => <LowStockFromInventory key={inv.id} inv={inv} />)
              : d.lowStock.map((s, i) => <LowStockRow key={i} item={s} />)
            }
            <button className="btn btn-ghost btn-block" style={{marginTop: 8}}>
              <Icon name="inv" size={14}/> {t.dashboard.autoOrder}
            </button>
          </div>
        </Card>
        <Card>
          <CardHeader title={t.dashboard.staffTitle} sub={t.dashboard.staffSub} />
          <div style={{padding: '0 4px 4px'}}>
            {staffShifts && staffShifts.length > 0
              ? staffShifts.map(s => <StaffRowFromShift key={s.userId} staff={s} />)
              : d.staff.map((s, i) => <StaffRow key={i} staff={s} />)
            }
          </div>
        </Card>
      </div>
    </div>
  );
}

/* Mirrors KPICard's exact box metrics so swapping skeleton → data causes no layout shift */
const KPICardSkeleton = () => (
  <div aria-hidden style={{
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-lg)', padding: 'var(--space-5)',
    display: 'flex', flexDirection: 'column', gap: 'var(--space-3)',
  }}>
    <Skeleton height={13} width="55%" />
    <Skeleton height={32} width="70%" />
    <Skeleton height={17} width="45%" />
  </div>
);

/* Mirrors LineChart's box: the day-total figure + the chart plot area, so the
   chart card holds its height while the hourly report loads (no layout shift). */
const LineChartSkeleton = () => {
  const { t } = useI18n();
  return (
    <div aria-busy="true">
      <span className="sr-only">{t.dashboard.loadingChart}</span>
      <Skeleton height={12} width="34%" />
      <div style={{ marginTop: 'var(--space-1)' }}>
        <Skeleton height={28} width="42%" radius="var(--radius-md)" />
      </div>
      <div style={{ marginTop: 'var(--space-3)' }}>
        <Skeleton height={220} radius="var(--radius-lg)" />
      </div>
    </div>
  );
};

const Card = ({ children }: { children: React.ReactNode }) => (
  <div style={{background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)'}}>
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

const LineChart = ({
  labels, series, compare, total, totalLabel,
}: {
  labels: string[];
  series: number[];
  compare: number[] | null;
  total: number;
  totalLabel: string;
}) => {
  const W = 600, H = 220, P = 28;
  const n = Math.max(1, labels.length);
  // Label every point when sparse, but thin out dense per-day axes to avoid overlap.
  const labelStep = Math.max(1, Math.ceil(n / 12));
  const max = (Math.max(0, ...series, ...(compare ?? [])) || 1) * 1.1;
  const x = (i: number) => (n > 1 ? P + (i * (W - P * 2)) / (n - 1) : W / 2);
  const y = (v: number) => H - P - (v / max) * (H - P * 2);
  const path = (data: number[]) => data.map((v, i) => `${i ? 'L' : 'M'} ${x(i)} ${y(v)}`).join(' ');
  const area = (data: number[]) =>
    data.length ? `${path(data)} L ${x(data.length - 1)} ${H - P} L ${x(0)} ${H - P} Z` : '';
  const totalRef = useCountUp(total, { format: (v) => `฿${Math.round(v).toLocaleString('en-US')}` });

  return (
    <div>
      <div style={{fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 4}}>{totalLabel}</div>
      <div className="num" style={{fontSize: 28, fontWeight: 700, letterSpacing: '-0.01em', marginBottom: 12}}>
        <span ref={totalRef}>฿{Math.round(total).toLocaleString('en-US')}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none">
        <defs>
          <linearGradient id="todayFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.18"/>
            <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0"/>
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((tick, i) => (
          <line key={i} x1={P} x2={W - P} y1={P + tick * (H - 2 * P)} y2={P + tick * (H - 2 * P)} stroke="var(--color-border)" strokeDasharray="2 4"/>
        ))}
        {labels.map((h, i) => i % labelStep === 0 && (
          <text key={`${h}-${i}`} x={x(i)} y={H - 8} fontSize="10" textAnchor="middle" fill="var(--color-text-muted)">{h}</text>
        ))}
        {compare && <path d={path(compare)} fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeDasharray="4 4"/>}
        <path d={area(series)} fill="url(#todayFill)"/>
        <path d={path(series)} fill="none" stroke="var(--color-primary)" strokeWidth="2.5"/>
        {series.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r="3" fill="var(--color-primary)"/>)}
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
  const { t } = useI18n();
  const tone = order.status === 'new' ? 'warning' : order.status === 'ready' ? 'success' : 'accent';
  return (
    <div style={{padding: '10px 8px', borderBottom: '1px solid var(--color-surface-2)', display: 'flex', alignItems: 'center', gap: 10}}>
      <div className="num" style={{fontSize: 14, fontWeight: 700, minWidth: 44}}>{order.id}</div>
      <div style={{flex: 1, minWidth: 0}}>
        <div style={{fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{order.items}</div>
        <div style={{fontSize: 11, color: 'var(--color-text-muted)'}}>{order.time}</div>
      </div>
      <div className="num" style={{fontSize: 13, fontWeight: 600}}>฿{order.total}</div>
      <Tag tone={tone as 'warning' | 'success' | 'accent'}>{t.dashboard.status[order.status as 'new' | 'ready' | 'progress']}</Tag>
    </div>
  );
};

const LowStockRow = ({ item }: { item: typeof DASHBOARD['lowStock'][0] }) => {
  const { t } = useI18n();
  const tone = item.status === 'red' ? 'danger' : 'warning';
  const pct = Math.min(100, (item.level / item.par) * 100);
  return (
    <div style={{padding: '10px 8px', borderBottom: '1px solid var(--color-surface-2)'}}>
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4}}>
        <div style={{fontSize: 13, fontWeight: 500}}>{item.name}</div>
        <Tag tone={tone}>{Math.round(pct)}%</Tag>
      </div>
      <div style={{display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4}} className="num">
        <span>{t.dashboard.remaining(item.level.toLocaleString(), item.unit)}</span>
        <span>{t.dashboard.parLevel(item.par.toLocaleString(), item.unit)}</span>
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
  const { t } = useI18n();
  const tone = ticket.status === 'new' ? 'warning' : ticket.status === 'ready' ? 'success' : 'accent';
  const summary = ticket.items.map(it => `${it.name}${it.qty > 1 ? ` ×${it.qty}` : ''}`).join(', ');
  const mins = Math.floor((Date.now() - ticket.placedAt) / 60000);
  const elapsed = mins < 1 ? t.dashboard.elapsedJust : mins < 60 ? t.dashboard.elapsedMinAgo(mins) : t.dashboard.elapsedHrAgo(Math.floor(mins / 60));
  return (
    <div style={{padding: '10px 8px', borderBottom: '1px solid var(--color-surface-2)', display: 'flex', alignItems: 'center', gap: 10}}>
      <div className="num" style={{fontSize: 14, fontWeight: 700, minWidth: 44}}>{ticket.id}</div>
      <div style={{flex: 1, minWidth: 0}}>
        <div style={{fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{summary}</div>
        <div style={{fontSize: 11, color: 'var(--color-text-muted)'}}>{elapsed}</div>
      </div>
      <Tag tone={tone as 'warning' | 'success' | 'accent'}>{t.dashboard.status[ticket.status as 'new' | 'ready' | 'progress']}</Tag>
    </div>
  );
};

const LowStockFromInventory = ({ inv }: { inv: InventoryItem }) => {
  const { t } = useI18n();
  const pct = inv.parLevel > 0 ? Math.min(100, (inv.stock / inv.parLevel) * 100) : 0;
  const tone = pct < 50 ? 'danger' : 'warning';
  return (
    <div style={{padding: '10px 8px', borderBottom: '1px solid var(--color-surface-2)'}}>
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4}}>
        <div style={{fontSize: 13, fontWeight: 500}}>{inv.name}</div>
        <Tag tone={tone}>{Math.round(pct)}%</Tag>
      </div>
      <div style={{display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4}} className="num">
        <span>{t.dashboard.remaining(inv.stock.toLocaleString(), inv.unit)}</span>
        <span>{t.dashboard.parLevel(inv.parLevel.toLocaleString(), inv.unit)}</span>
      </div>
      <div style={{height: 4, background: 'var(--color-surface-2)', borderRadius: 999}}>
        <div style={{width: `${pct}%`, height: '100%', borderRadius: 999, background: pct < 50 ? 'var(--color-danger)' : 'var(--color-warning)'}}/>
      </div>
    </div>
  );
};

const StaffRowFromShift = ({ staff }: { staff: StaffShiftFE }) => {
  const { t } = useI18n();
  return (
    <div style={{padding: '10px 8px', borderBottom: '1px solid var(--color-surface-2)', display: 'flex', alignItems: 'center', gap: 10}}>
      <div style={{
        width: 32, height: 32, borderRadius: 999,
        background: 'var(--color-accent-50)', color: 'var(--color-primary)',
        display: 'grid', placeItems: 'center', fontWeight: 700,
      }}>{staff.initials}</div>
      <div style={{flex: 1, minWidth: 0}}>
        <div style={{fontSize: 13, fontWeight: 600}}>{staff.name}</div>
        <div style={{fontSize: 11, color: 'var(--color-text-muted)'}}>{t.dashboard.bills(staff.orderCount.toLocaleString())}</div>
      </div>
      <div className="num" style={{fontSize: 13, fontWeight: 600}}>{baht(staff.revenue)}</div>
    </div>
  );
};

const StaffRow = ({ staff }: { staff: typeof DASHBOARD['staff'][0] }) => {
  const { t } = useI18n();
  return (
    <div style={{padding: '10px 8px', borderBottom: '1px solid var(--color-surface-2)', display: 'flex', alignItems: 'center', gap: 10}}>
      <div style={{
        width: 32, height: 32, borderRadius: 999,
        background: 'var(--color-accent-50)', color: 'var(--color-primary)',
        display: 'grid', placeItems: 'center', fontWeight: 700,
      }}>{staff.initials}</div>
      <div style={{flex: 1, minWidth: 0}}>
        <div style={{fontSize: 13, fontWeight: 600}}>{staff.name}</div>
        <div style={{fontSize: 11, color: 'var(--color-text-muted)'}}>{staff.role} • {t.dashboard.bills(staff.orders.toLocaleString())}</div>
      </div>
      <div className="num" style={{fontSize: 13, fontWeight: 600}}>{baht(staff.sales)}</div>
    </div>
  );
};
