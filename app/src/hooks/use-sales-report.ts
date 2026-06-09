import { api } from '@/lib/api-client';

// ── Backend shapes (GET /api/v1/reports/sales) ─────────────────────────────────
// Returns the SAME totals regardless of `granularity`; only the bucket grouping
// changes. See caf-pos-repo-dev/api/app/api/v1/reports.py
interface SalesBucketRead {
  bucket: string; // date "2026-06-01", product/category name, or payment-method enum
  order_count: number;
  revenue: string | number;
}
interface SalesReportRead {
  buckets: SalesBucketRead[];
  total_revenue: string | number;
  total_orders: number;
}

export type ReportGranularity = 'day' | 'hour' | 'product' | 'category' | 'payment_method';
export type ReportMode = 'daily' | 'range';

// ── Frontend shapes ─────────────────────────────────────────────────────────────
export interface ReportRow {
  label: string;
  orderCount: number;
  revenue: number;
}

export interface SalesReportData {
  mode: ReportMode;
  from: string; // 'YYYY-MM-DD'
  to: string;   // 'YYYY-MM-DD' (equals `from` in daily mode)
  totalRevenue: number;
  totalOrders: number;
  avgTicket: number;
  dayCount: number;  // distinct calendar days in the range (1 for daily)
  avgPerDay: number;
  byDay: ReportRow[];      // populated only for range mode
  byProduct: ReportRow[];
  byCategory: ReportRow[];
  byPayment: ReportRow[];
}

// ── Payment-method enum → Thai label ────────────────────────────────────────────
const PAYMENT_LABEL: Record<string, string> = {
  CASH: 'เงินสด',
  CARD: 'บัตร',
  TRANSFER: 'โอน / พร้อมเพย์',
  QR: 'QR / พร้อมเพย์',
  PROMPTPAY: 'พร้อมเพย์',
};
function paymentLabel(code: string): string {
  const key = (code ?? '').toUpperCase();
  return PAYMENT_LABEL[key] ?? code ?? '—';
}

// ── Date helpers ─────────────────────────────────────────────────────────────────
// Build ISO bounds for a local calendar day — mirrors todayRange() in use-dashboard.ts
// so timezone behaviour stays consistent with the dashboard.
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
function countDays(fromStr: string, toStr: string): number {
  const [fy, fm, fd] = fromStr.split('-').map(Number);
  const [ty, tm, td] = toStr.split('-').map(Number);
  const a = Date.UTC(fy, fm - 1, fd);
  const b = Date.UTC(ty, tm - 1, td);
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

// ── Fetch + transform ──────────────────────────────────────────────────────────
function fetchSales(fromIso: string, toIso: string, granularity: ReportGranularity) {
  return api.get<SalesReportRead>(
    `/api/v1/reports/sales?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}&granularity=${granularity}`,
  );
}

function toRows(rep: SalesReportRead, labelFn?: (bucket: string) => string): ReportRow[] {
  return rep.buckets.map((b) => ({
    label: labelFn ? labelFn(b.bucket) : b.bucket,
    orderCount: b.order_count,
    revenue: Number(b.revenue),
  }));
}

/**
 * Load a sales report for a single day (`mode: 'daily'`) or a date range
 * (`mode: 'range'`). Fires the breakdown queries in parallel — `product`,
 * `category`, `payment_method` always, plus `day` for range mode.
 */
export async function loadSalesReport(opts: {
  mode: ReportMode;
  from: string;
  to: string;
}): Promise<SalesReportData> {
  const { mode } = opts;
  const from = opts.from;
  const to = mode === 'daily' ? opts.from : opts.to;
  const bounds = mode === 'daily' ? dayBounds(from) : rangeBounds(from, to);

  const granularities: ReportGranularity[] =
    mode === 'range'
      ? ['day', 'product', 'category', 'payment_method']
      : ['product', 'category', 'payment_method'];

  const results = await Promise.all(
    granularities.map((g) => fetchSales(bounds.from, bounds.to, g)),
  );
  const byGran = Object.fromEntries(
    granularities.map((g, i) => [g, results[i]]),
  ) as Record<ReportGranularity, SalesReportRead>;

  // Totals are identical across granularities — read from the first response.
  const first = results[0];
  const totalRevenue = Number(first.total_revenue);
  const totalOrders = first.total_orders;
  const avgTicket = totalOrders > 0 ? totalRevenue / totalOrders : 0;
  const dayCount = mode === 'range' ? countDays(from, to) : 1;
  const avgPerDay = dayCount > 0 ? totalRevenue / dayCount : 0;

  const byProduct = toRows(byGran.product).sort((a, b) => b.revenue - a.revenue);
  const byCategory = toRows(byGran.category).sort((a, b) => b.revenue - a.revenue);
  const byPayment = toRows(byGran.payment_method, paymentLabel).sort((a, b) => b.revenue - a.revenue);
  const byDay = mode === 'range' ? toRows(byGran.day).sort((a, b) => a.label.localeCompare(b.label)) : [];

  return {
    mode, from, to,
    totalRevenue, totalOrders, avgTicket, dayCount, avgPerDay,
    byDay, byProduct, byCategory, byPayment,
  };
}
