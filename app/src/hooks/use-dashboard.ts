import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

// ── Backend shapes ────────────────────────────────────────────────────────────
interface TopItemRead {
  product_name: string;
  quantity: number;
  revenue: string | number;
}

interface DashboardTodayRead {
  revenue: string | number;
  order_count: number;
  avg_ticket: string | number;
  top_items: TopItemRead[];
}

interface SalesBucket {
  bucket: string; // "2026-05-03T08:00" for hourly granularity, "2026-05-03" for day, product name for product
  order_count: number;
  revenue: string | number;
}

interface SalesReportRead {
  buckets: SalesBucket[];
  total_revenue: string | number;
  total_orders: number;
}

// ── Date-range presets ─────────────────────────────────────────────────────────
export type DashboardPreset = 'today' | 'yesterday' | 'last7' | 'last30';

export interface ResolvedRange {
  preset: DashboardPreset;
  from: string;       // 'YYYY-MM-DD' (local calendar day)
  to: string;         // 'YYYY-MM-DD'
  isSingleDay: boolean;
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

/** Resolve a preset to from/to calendar-day strings (local time). */
export function resolveRange(preset: DashboardPreset): ResolvedRange {
  const today = new Date();
  switch (preset) {
    case 'yesterday': {
      const y = addDays(today, -1);
      return { preset, from: ymd(y), to: ymd(y), isSingleDay: true };
    }
    case 'last7':
      return { preset, from: ymd(addDays(today, -6)), to: ymd(today), isSingleDay: false };
    case 'last30':
      return { preset, from: ymd(addDays(today, -29)), to: ymd(today), isSingleDay: false };
    case 'today':
    default:
      return { preset, from: ymd(today), to: ymd(today), isSingleDay: true };
  }
}

// ── Frontend types ────────────────────────────────────────────────────────────
export interface DashboardKPIs {
  revenue: number;
  orderCount: number;
  avgTicket: number;
}

export interface TopItemFE {
  name: string;
  qty: number;
  rev: number;
}

/** Trend chart payload — generalized over hourly OR per-day points. */
export interface TrendChart {
  labels: string[];       // x-axis tick labels (hours "08" or short day "5 มิ.ย.")
  series: number[];       // primary revenue line
  compare: number[] | null; // dotted comparison line (single-day only; null for multi-day)
  total: number;          // headline figure (sum of series)
  isLoading: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const STORE_HOURS = Array.from({ length: 13 }, (_, i) => String(i + 8).padStart(2, '0'));

function dayBounds(dateStr: string): { from: string; to: string } {
  const [y, m, d] = dateStr.split('-').map(Number);
  const start = new Date(y, m - 1, d, 0, 0, 0, 0);
  const end = new Date(y, m - 1, d, 23, 59, 59, 999);
  return { from: start.toISOString(), to: end.toISOString() };
}

function rangeBounds(fromStr: string, toStr: string): { from: string; to: string } {
  const [fy, fm, fd] = fromStr.split('-').map(Number);
  const [ty, tm, td] = toStr.split('-').map(Number);
  const start = new Date(fy, fm - 1, fd, 0, 0, 0, 0);
  const end = new Date(ty, tm - 1, td, 23, 59, 59, 999);
  return { from: start.toISOString(), to: end.toISOString() };
}

/** Previous-week sibling of a single calendar day (selected day − 7). */
function prevWeekDay(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return ymd(new Date(y, m - 1, d - 7));
}

function buildHourly(buckets: SalesBucket[]): number[] {
  const map = new Map<string, number>();
  for (const b of buckets) {
    // bucket format: "2026-05-03T08:00" — extract the "HH" part
    const hour = b.bucket.length >= 13 ? b.bucket.slice(11, 13) : b.bucket.slice(0, 2);
    map.set(hour, (map.get(hour) ?? 0) + Number(b.revenue));
  }
  return STORE_HOURS.map(h => map.get(h) ?? 0);
}

/** Short Thai day/month label from a "YYYY-MM-DD" bucket (Buddhist-era short month). */
function shortDayLabel(dateStr: string): string {
  const iso = dateStr.length >= 10 ? dateStr.slice(0, 10) : dateStr;
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString('th-TH-u-ca-buddhist', { day: 'numeric', month: 'short' });
}

function getSales(fromIso: string, toIso: string, granularity: 'hour' | 'day' | 'product') {
  return api.get<SalesReportRead>(
    `/api/v1/reports/sales?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}&granularity=${granularity}`,
  );
}

const HOUR_MS = 3_600_000;

// ── Hooks ─────────────────────────────────────────────────────────────────────
/**
 * Live "today" snapshot — richer payload (top_items) + realtime refetch. Only
 * meaningful for the `today` preset; callers pass `enabled` to skip it otherwise.
 */
export function useDashboardToday(enabled = true) {
  const dateStr = ymd(new Date());
  return useQuery<DashboardTodayRead>({
    queryKey: ['dashboard-today', dateStr],
    queryFn: () => api.get<DashboardTodayRead>('/api/v1/dashboard/today'),
    enabled,
    refetchInterval: enabled ? 60_000 : false,
    staleTime: 30_000,
    retry: 1,
  });
}

/**
 * KPI totals for any range, derived from /reports/sales (granularity=day gives
 * the same totals as any other grouping). Used for non-today presets.
 */
export function useRangeKpis(range: ResolvedRange, enabled = true) {
  return useQuery<DashboardKPIs>({
    queryKey: ['dashboard-range-kpis', range.from, range.to],
    enabled,
    staleTime: HOUR_MS,
    retry: 1,
    queryFn: async () => {
      const b = rangeBounds(range.from, range.to);
      const rep = await getSales(b.from, b.to, 'day');
      const revenue = Number(rep.total_revenue);
      const orderCount = rep.total_orders;
      return { revenue, orderCount, avgTicket: orderCount > 0 ? revenue / orderCount : 0 };
    },
  });
}

/**
 * Top-selling items for non-today presets, from granularity=product. qty is
 * order_count (a proxy — the product endpoint has no per-line quantity).
 */
export function useRangeTopItems(range: ResolvedRange, enabled = true) {
  return useQuery<TopItemFE[]>({
    queryKey: ['dashboard-range-top', range.from, range.to],
    enabled,
    staleTime: HOUR_MS,
    retry: 1,
    queryFn: async () => {
      const b = rangeBounds(range.from, range.to);
      const rep = await getSales(b.from, b.to, 'product');
      return rep.buckets
        .map(bk => ({ name: bk.bucket, qty: bk.order_count, rev: Number(bk.revenue) }))
        .sort((a, b2) => b2.rev - a.rev)
        .slice(0, 10);
    },
  });
}

/**
 * Trend chart series. Single-day presets → hourly line (08–20) + previous-week
 * comparison. Multi-day presets → per-day revenue line, no comparison.
 */
export function useTrendChart(range: ResolvedRange): TrendChart {
  const single = range.isSingleDay;

  // Single-day: hourly for the selected day.
  const hourlyQ = useQuery<SalesReportRead>({
    queryKey: ['dashboard-trend-hourly', range.from],
    enabled: single,
    queryFn: () => {
      const b = dayBounds(range.from);
      return getSales(b.from, b.to, 'hour');
    },
    refetchInterval: range.preset === 'today' ? 60_000 : false,
    staleTime: range.preset === 'today' ? 30_000 : HOUR_MS,
    retry: 1,
  });

  // Single-day: same weekday previous week (dotted comparison).
  const prevDayStr = single ? prevWeekDay(range.from) : range.from;
  const prevQ = useQuery<SalesReportRead>({
    queryKey: ['dashboard-trend-hourly-prev', prevDayStr],
    enabled: single,
    queryFn: () => {
      const b = dayBounds(prevDayStr);
      return getSales(b.from, b.to, 'hour');
    },
    staleTime: HOUR_MS,
    retry: 1,
  });

  // Multi-day: per-day revenue across the range.
  const dailyQ = useQuery<SalesReportRead>({
    queryKey: ['dashboard-trend-daily', range.from, range.to],
    enabled: !single,
    queryFn: () => {
      const b = rangeBounds(range.from, range.to);
      return getSales(b.from, b.to, 'day');
    },
    staleTime: HOUR_MS,
    retry: 1,
  });

  if (single) {
    const series = hourlyQ.data ? buildHourly(hourlyQ.data.buckets) : STORE_HOURS.map(() => 0);
    const compare = prevQ.data ? buildHourly(prevQ.data.buckets) : null;
    return {
      labels: STORE_HOURS,
      series,
      compare,
      total: series.reduce((s, v) => s + v, 0),
      isLoading: hourlyQ.isLoading,
    };
  }

  // Multi-day: one point per calendar day, ordered oldest → newest.
  const sorted = (dailyQ.data?.buckets ?? [])
    .slice()
    .sort((a, b) => a.bucket.localeCompare(b.bucket));
  const labels = sorted.map(b => shortDayLabel(b.bucket));
  const series = sorted.map(b => Number(b.revenue));
  return {
    labels,
    series,
    compare: null,
    total: series.reduce((s, v) => s + v, 0),
    isLoading: dailyQ.isLoading,
  };
}

// ── Cashier shifts (staff panel) ──────────────────────────────────────────────
interface CashierShiftRead {
  user_id: string;
  user_name: string;
  order_count: number;
  revenue: string | number;
  void_count: number;
}

interface CashierShiftsReportRead {
  from_: string;
  to: string;
  cashiers: CashierShiftRead[];
}

export interface StaffShiftFE {
  userId: string;
  name: string;
  initials: string;
  orderCount: number;
  revenue: number;
}

/** Cashier shifts over the selected range (live refetch only for the today preset). */
export function useCashierShifts(range: ResolvedRange) {
  return useQuery<StaffShiftFE[]>({
    queryKey: ['cashier-shifts', range.from, range.to],
    queryFn: async () => {
      const b = rangeBounds(range.from, range.to);
      const data = await api.get<CashierShiftsReportRead>(
        `/api/v1/reports/cashier-shifts?from=${encodeURIComponent(b.from)}&to=${encodeURIComponent(b.to)}`,
      );
      return (data.cashiers ?? []).map(c => ({
        userId:     c.user_id,
        name:       c.user_name,
        initials:   c.user_name.charAt(0),
        orderCount: c.order_count,
        revenue:    Number(c.revenue),
      }));
    },
    refetchInterval: range.preset === 'today' ? 120_000 : false,
    staleTime: range.preset === 'today' ? 60_000 : HOUR_MS,
    retry: 1,
  });
}
