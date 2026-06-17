import { api } from '@/lib/api-client';
import { makeInvoiceNo } from '@/lib/receipt-number';

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

/**
 * One product line of one bill — the flat sales-register row that mirrors the
 * ยอดขาย.xltx layout. Bill-level fields (discount/net/payment/note) are filled
 * only on the FIRST line of each bill (`firstOfBill`); continuation lines leave
 * them `undefined` so the register reads like the reference workbook.
 */
export interface RegisterLine {
  no: number;          // running line number across the whole period
  billNo: string;      // per-day running bill number, e.g. "#7" (matches the receipt/KDS)
  receiptNo: string;   // backend receipt number, e.g. "IV25690612-0007"
  iso: string;         // local calendar day "YYYY-MM-DD" — grouping key for per-day blocks
  date: string;        // short Thai date, e.g. "5 มิ.ย."
  time: string;        // "HH:mm"
  channel: string;     // Thai channel label
  product: string;     // product name (+ modifiers in parentheses)
  qty: number;
  unitPrice: number;
  lineTotal: number;
  firstOfBill: boolean;
  billDiscount?: number; // bill-level — first line only
  billNet?: number;      // bill total — first line only
  billPayment?: string;  // first line only
  billNote?: string;     // first line only
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
  register: RegisterLine[]; // flat per-line sales register (ยอดขาย.xltx style)
}

// ── Payment-method enum → Thai label ────────────────────────────────────────────
const PAYMENT_LABEL: Record<string, string> = {
  CASH: 'เงินสด',
  CARD: 'บัตร',
  QR_PROMPTPAY: 'QR / พร้อมเพย์',
  LINE_PAY: 'LINE Pay',
  TRUEMONEY: 'ทรูมันนี่',
  OTHER: 'อื่น ๆ',
  // legacy / alternate codes
  TRANSFER: 'โอน / พร้อมเพย์',
  QR: 'QR / พร้อมเพย์',
  PROMPTPAY: 'พร้อมเพย์',
};
function paymentLabel(code: string): string {
  const key = (code ?? '').toUpperCase();
  return PAYMENT_LABEL[key] ?? code ?? '—';
}

// ── Channel enum → Thai label ─────────────────────────────────────────────────
const CHANNEL_LABEL: Record<string, string> = {
  DINE_IN: 'ทานที่ร้าน',
  TAKEAWAY: 'กลับบ้าน',
  DELIVERY: 'เดลิเวอรี',
};

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

// ── Per-line register (GET /api/v1/orders) ─────────────────────────────────────
// The aggregate /reports/sales endpoint returns buckets, not transactions, so the
// flat register is built from the orders list. Statuses mirror reports.py's
// _REVENUE_STATUSES so register totals reconcile with the summary cards.
const REVENUE_STATUS_QS = 'status=PAID&status=IN_PROGRESS&status=READY&status=COMPLETED';
const REG_PAGE_LIMIT = 200; // backend max page size

interface RegOrderItem {
  product_name: string;
  quantity: number;
  unit_price: string | number;
  line_total: string | number;
  modifiers_json: Record<string, unknown> | null;
}
interface RegOrder {
  order_number: number;
  daily_number?: number;
  receipt_no?: string;
  channel: string;
  payment_method: string | null;
  customer_note: string | null;
  discount: string | number;
  total: string | number;
  created_at: string;
  items: RegOrderItem[];
}
interface RegOrdersPage {
  items: RegOrder[];
  total: number;
  page: number;
  limit: number;
}

function modifierNames(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object') return [];
  const mods = (raw as Record<string, unknown>).modifiers;
  if (!Array.isArray(mods)) return [];
  return mods
    .map((m) => (m as Record<string, unknown>)?.name)
    .filter((n): n is string => typeof n === 'string');
}

function fetchOrdersPage(fromIso: string, toIso: string, page: number) {
  return api.get<RegOrdersPage>(
    `/api/v1/orders?${REVENUE_STATUS_QS}` +
      `&from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}` +
      `&page=${page}&limit=${REG_PAGE_LIMIT}`,
  );
}

async function loadRegister(fromIso: string, toIso: string): Promise<RegisterLine[]> {
  const first = await fetchOrdersPage(fromIso, toIso, 1);
  let orders = first.items ?? [];
  const pageCount = Math.max(1, Math.ceil((first.total ?? orders.length) / REG_PAGE_LIMIT));
  if (pageCount > 1) {
    const rest = await Promise.all(
      Array.from({ length: pageCount - 1 }, (_, i) => fetchOrdersPage(fromIso, toIso, i + 2)),
    );
    orders = orders.concat(...rest.map((p) => p.items ?? []));
  }

  // Chronological — backend returns newest-first; the register reads oldest→newest.
  orders.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.order_number - b.order_number);

  const lines: RegisterLine[] = [];
  let no = 0;
  for (const o of orders) {
    const dt = new Date(o.created_at);
    const iso = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    const date = dt.toLocaleDateString('th-TH-u-ca-buddhist', { day: 'numeric', month: 'short' });
    const time = dt.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    const channel = CHANNEL_LABEL[o.channel] ?? o.channel;
    // Per-day running bill number (matches the receipt/KDS); falls back to the
    // global order_number for orders created before the backend shipped it.
    const billDisplay = o.daily_number ?? o.order_number;
    // Backend-owned receipt number; fall back to the client format only if absent.
    const receiptNo = o.receipt_no ?? makeInvoiceNo(String(billDisplay), dt);
    const items = o.items ?? [];
    items.forEach((it, idx) => {
      no += 1;
      const mods = modifierNames(it.modifiers_json);
      lines.push({
        no,
        billNo: `#${billDisplay}`,
        receiptNo,
        iso,
        date,
        time,
        channel,
        product: mods.length ? `${it.product_name} (${mods.join(', ')})` : it.product_name,
        qty: it.quantity,
        unitPrice: Number(it.unit_price),
        lineTotal: Number(it.line_total),
        firstOfBill: idx === 0,
        billDiscount: idx === 0 ? Number(o.discount) : undefined,
        billNet: idx === 0 ? Number(o.total) : undefined,
        billPayment: idx === 0 ? paymentLabel(o.payment_method ?? '') : undefined,
        billNote: idx === 0 ? (o.customer_note ?? '') || undefined : undefined,
      });
    });
  }
  return lines;
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

  const [results, register] = await Promise.all([
    Promise.all(granularities.map((g) => fetchSales(bounds.from, bounds.to, g))),
    loadRegister(bounds.from, bounds.to),
  ]);
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
    byDay, byProduct, byCategory, byPayment, register,
  };
}
