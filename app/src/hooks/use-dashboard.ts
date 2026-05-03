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
  bucket: string; // "2026-05-03T08:00" for hourly granularity
  order_count: number;
  revenue: string | number;
}

interface SalesReportRead {
  buckets: SalesBucket[];
  total_revenue: string | number;
  total_orders: number;
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

export interface HourlySales {
  hours: string[];
  today: number[];
  lastWeek: number[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const STORE_HOURS = Array.from({ length: 13 }, (_, i) => String(i + 8).padStart(2, '0'));

function buildHourly(buckets: SalesBucket[]): number[] {
  const map = new Map<string, number>();
  for (const b of buckets) {
    // bucket format: "2026-05-03T08:00" — extract the "HH" part
    const hour = b.bucket.length >= 13 ? b.bucket.slice(11, 13) : b.bucket.slice(0, 2);
    map.set(hour, Number(b.revenue));
  }
  return STORE_HOURS.map(h => map.get(h) ?? 0);
}

function todayRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const end   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return { from: start.toISOString(), to: end.toISOString() };
}

function prevWeekRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7, 0, 0, 0, 0);
  const end   = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7, 23, 59, 59, 999);
  return { from: start.toISOString(), to: end.toISOString() };
}

// ── Hooks ─────────────────────────────────────────────────────────────────────
export function useDashboardToday() {
  const dateStr = new Date().toISOString().slice(0, 10);
  return useQuery<DashboardTodayRead>({
    queryKey: ['dashboard-today', dateStr],
    queryFn: () => api.get<DashboardTodayRead>('/api/v1/dashboard/today'),
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 1,
  });
}

export function useSalesHourly() {
  const dateStr = new Date().toISOString().slice(0, 10);

  const todayQ = useQuery<SalesReportRead>({
    queryKey: ['sales-hourly-today', dateStr],
    queryFn: () => {
      const r = todayRange();
      return api.get<SalesReportRead>(
        `/api/v1/reports/sales?from=${encodeURIComponent(r.from)}&to=${encodeURIComponent(r.to)}&granularity=hour`
      );
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 1,
  });

  const prevQ = useQuery<SalesReportRead>({
    queryKey: ['sales-hourly-prev', dateStr],
    queryFn: () => {
      const r = prevWeekRange();
      return api.get<SalesReportRead>(
        `/api/v1/reports/sales?from=${encodeURIComponent(r.from)}&to=${encodeURIComponent(r.to)}&granularity=hour`
      );
    },
    staleTime: 3_600_000, // last-week data won't change; cache 1 hour
    retry: 1,
  });

  return {
    hours: STORE_HOURS,
    today:    todayQ.data   ? buildHourly(todayQ.data.buckets)   : null,
    lastWeek: prevQ.data    ? buildHourly(prevQ.data.buckets)    : null,
    isLoading: todayQ.isLoading,
  };
}

export function useDashboardTopItems(): TopItemFE[] | null {
  const { data } = useDashboardToday();
  if (!data?.top_items?.length) return null;
  return data.top_items.map(it => ({
    name: it.product_name,
    qty:  it.quantity,
    rev:  Number(it.revenue),
  }));
}
