import { api } from '@/lib/api-client';

// ── Backend shapes (GET /api/v1/reports/wastage) ───────────────────────────────
// Single call returns everything. by_day/by_item/events are additive — older
// backends (pre-handoff deploy) omit them, so the transform treats them as empty.
// See 2026-06-12-wastage-report-backend-handoff.md
interface WastageByReasonRead {
  reason_code: string;
  event_count: number;
  total_quantity: string | number;
  estimated_cost: string | number;
}
interface WastageByDayRead {
  bucket: string; // "YYYY-MM-DD"
  event_count: number;
  total_quantity: string | number;
  estimated_cost: string | number;
}
interface WastageByItemRead {
  item_id: string;
  item_name: string;
  unit: string;
  event_count: number;
  total_quantity: string | number;
  estimated_cost: string | number;
}
interface WastageEventRead {
  id: string;
  created_at: string;
  item_name: string;
  unit: string;
  quantity: string | number;
  reason_code: string;
  note: string | null;
  created_by_name: string;
  estimated_cost: string | number;
}
interface WastageReportRead {
  from_?: string;
  to?: string;
  total_quantity: string | number;
  total_cost: string | number;
  event_count?: number;
  by_reason: WastageByReasonRead[];
  by_day?: WastageByDayRead[];
  by_item?: WastageByItemRead[];
  events?: WastageEventRead[];
}

export type ReportMode = 'daily' | 'range';

// ── Frontend shapes ─────────────────────────────────────────────────────────────
export interface WasteReasonRow {
  reasonCode: string;
  label: string;     // Thai label
  eventCount: number;
  quantity: number;
  cost: number;
}
export interface WasteDayRow {
  date: string;      // "YYYY-MM-DD"
  eventCount: number;
  quantity: number;
  cost: number;
}
export interface WasteItemRow {
  itemId: string;
  itemName: string;
  unit: string;
  eventCount: number;
  quantity: number;
  cost: number;
}
export interface WasteEventLine {
  no: number;
  id: string;
  date: string;      // short Thai date "5 มิ.ย."
  time: string;      // "HH:mm"
  itemName: string;
  unit: string;
  quantity: number;
  reasonCode: string;
  reasonLabel: string;
  note: string;
  createdBy: string;
  cost: number;
}
export interface WastageReportData {
  mode: ReportMode;
  from: string; // 'YYYY-MM-DD'
  to: string;   // 'YYYY-MM-DD' (equals `from` in daily mode)
  totalQuantity: number;
  totalCost: number;
  eventCount: number;
  dayCount: number;
  avgCostPerDay: number;
  byReason: WasteReasonRow[];
  byDay: WasteDayRow[];   // populated only in range mode (when backend supplies it)
  byItem: WasteItemRow[];
  events: WasteEventLine[];
}

// ── Wastage reason → Thai label ────────────────────────────────────────────────
const REASON_LABEL: Record<string, string> = {
  EXPIRED: 'หมดอายุ',
  SPILLED: 'หก / เสียระหว่างทำ',
  TRIAL: 'ชิม / ทดลอง',
  DAMAGED: 'ชำรุด / เสียหาย',
  OTHER: 'อื่น ๆ',
};
export function reasonLabel(code: string): string {
  return REASON_LABEL[(code ?? '').toUpperCase()] ?? code ?? '—';
}

// ── Date helpers (mirror use-sales-report.ts) ───────────────────────────────────
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
function fetchWastage(fromIso: string, toIso: string) {
  return api.get<WastageReportRead>(
    `/api/v1/reports/wastage?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`,
  );
}

export async function loadWastageReport(opts: {
  mode: ReportMode;
  from: string;
  to: string;
}): Promise<WastageReportData> {
  const { mode } = opts;
  const from = opts.from;
  const to = mode === 'daily' ? opts.from : opts.to;
  const bounds = mode === 'daily' ? dayBounds(from) : rangeBounds(from, to);

  const rep = await fetchWastage(bounds.from, bounds.to);

  const byReason: WasteReasonRow[] = (rep.by_reason ?? []).map((r) => ({
    reasonCode: r.reason_code,
    label: reasonLabel(r.reason_code),
    eventCount: r.event_count,
    quantity: Number(r.total_quantity),
    cost: Number(r.estimated_cost),
  }));

  const byDay: WasteDayRow[] = (rep.by_day ?? []).map((r) => ({
    date: r.bucket,
    eventCount: r.event_count,
    quantity: Number(r.total_quantity),
    cost: Number(r.estimated_cost),
  })).sort((a, b) => a.date.localeCompare(b.date));

  const byItem: WasteItemRow[] = (rep.by_item ?? []).map((r) => ({
    itemId: r.item_id,
    itemName: r.item_name,
    unit: r.unit,
    eventCount: r.event_count,
    quantity: Number(r.total_quantity),
    cost: Number(r.estimated_cost),
  })).sort((a, b) => b.cost - a.cost);

  const events: WasteEventLine[] = (rep.events ?? []).map((e, i) => {
    const dt = new Date(e.created_at);
    return {
      no: i + 1,
      id: e.id,
      date: dt.toLocaleDateString('th-TH-u-ca-buddhist', { day: 'numeric', month: 'short' }),
      time: dt.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }),
      itemName: e.item_name,
      unit: e.unit,
      quantity: Number(e.quantity),
      reasonCode: e.reason_code,
      reasonLabel: reasonLabel(e.reason_code),
      note: e.note ?? '',
      createdBy: e.created_by_name,
      cost: Number(e.estimated_cost),
    };
  });

  const totalQuantity = Number(rep.total_quantity);
  const totalCost = Number(rep.total_cost);
  const eventCount = rep.event_count ?? byReason.reduce((s, r) => s + r.eventCount, 0);
  const dayCount = mode === 'range' ? countDays(from, to) : 1;
  const avgCostPerDay = dayCount > 0 ? totalCost / dayCount : 0;

  return {
    mode, from, to,
    totalQuantity, totalCost, eventCount, dayCount, avgCostPerDay,
    byReason, byDay, byItem, events,
  };
}
