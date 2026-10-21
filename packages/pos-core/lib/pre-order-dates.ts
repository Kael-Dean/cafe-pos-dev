/**
 * Pure helpers for pre-order due dates (handoff pre-orders/calendar-handoff.md and the
 * 2026-06-06 date-range filter): calendar dates as "YYYY-MM-DD" strings, never Date math
 * through UTC. `due_date` / `order_date` are plain local calendar dates — the backend
 * says "no timezone conversion needed" — so everything here works on the string.
 */

export type PreOrderStatusParam = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export interface PreOrderListFilters {
  /** One status only — the backend accepts a single value (no status[] yet). */
  status?: PreOrderStatusParam;
  /** Inclusive lower bound on due_date (YYYY-MM-DD). */
  dueDateFrom?: string;
  /** Inclusive upper bound on due_date (YYYY-MM-DD). */
  dueDateTo?: string;
  /** ≥ 1, default 1. */
  page?: number;
  /** 1–200, default 50. */
  limit?: number;
}

export const PRE_ORDER_LIMIT_MAX = 200;
export const PRE_ORDER_LIMIT_DEFAULT = 50;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date in strict YYYY-MM-DD form ("2026-02-30" is not). */
export function isIsoDate(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const m = ISO_DATE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

/**
 * Normalised filters: invalid dates dropped, a reversed range swapped (from ≤ to),
 * page ≥ 1, limit clamped to 1–200. Used for both the query key and the URL so two
 * equivalent filter objects share one cache entry.
 */
export function normalizePreOrderFilters(f: PreOrderListFilters = {}): Required<Pick<PreOrderListFilters, 'page' | 'limit'>> & Omit<PreOrderListFilters, 'page' | 'limit'> {
  let from = isIsoDate(f.dueDateFrom) ? f.dueDateFrom : undefined;
  let to = isIsoDate(f.dueDateTo) ? f.dueDateTo : undefined;
  if (from && to && from > to) [from, to] = [to, from];
  const page = Number.isFinite(f.page) ? Math.max(1, Math.floor(f.page!)) : 1;
  const limit = Number.isFinite(f.limit)
    ? Math.min(PRE_ORDER_LIMIT_MAX, Math.max(1, Math.floor(f.limit!)))
    : PRE_ORDER_LIMIT_DEFAULT;
  return {
    ...(f.status ? { status: f.status } : {}),
    ...(from ? { dueDateFrom: from } : {}),
    ...(to ? { dueDateTo: to } : {}),
    page,
    limit,
  };
}

/** Query string for GET /api/v1/pre-orders (without the leading "?"). */
export function buildPreOrderListQuery(f: PreOrderListFilters = {}): string {
  const n = normalizePreOrderFilters(f);
  const params = new URLSearchParams();
  if (n.status) params.set('status', n.status);
  if (n.dueDateFrom) params.set('due_date_from', n.dueDateFrom);
  if (n.dueDateTo) params.set('due_date_to', n.dueDateTo);
  params.set('page', String(n.page));
  params.set('limit', String(n.limit));
  return params.toString();
}

// ── Calendar arithmetic on YYYY-MM-DD strings ────────────────────────────────

/** Today (or `d`) as the *local* calendar date — not `toISOString()`, which is UTC. */
export function localIsoDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const utc = (ds: string) => new Date(`${ds}T00:00:00Z`);

/** "2026-06-30" + 1 → "2026-07-01". Timezone-independent. */
export function addDaysIso(ds: string, n: number): string {
  const d = utc(ds);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Weekday with Monday = 0 … Sunday = 6. */
export function weekdayMon0(ds: string): number {
  return (utc(ds).getUTCDay() + 6) % 7;
}

/** Monday of the week that contains `ds`. */
export function mondayOf(ds: string): string {
  return addDaysIso(ds, -weekdayMon0(ds));
}

/** The 7 dates Monday … Sunday starting at `weekStart`. */
export function weekDays(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDaysIso(weekStart, i));
}

/** Inclusive due-date range for a week (Mon–Sun) — what the calendar asks the API for. */
export function weekRange(weekStart: string): { dueDateFrom: string; dueDateTo: string } {
  return { dueDateFrom: weekStart, dueDateTo: addDaysIso(weekStart, 6) };
}

/** Inclusive due-date range for the calendar month containing `ds`. */
export function monthRange(ds: string): { dueDateFrom: string; dueDateTo: string } {
  const [y, m] = [Number(ds.slice(0, 4)), Number(ds.slice(5, 7))];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return { dueDateFrom: `${y}-${mm}-01`, dueDateTo: `${y}-${mm}-${String(last).padStart(2, '0')}` };
}

/** Local Date at midnight for display formatting (toLocaleDateString) of a calendar date. */
export function isoToLocalDate(ds: string): Date {
  return new Date(Number(ds.slice(0, 4)), Number(ds.slice(5, 7)) - 1, Number(ds.slice(8, 10)));
}

// ── Grouping for the calendar ─────────────────────────────────────────────────

export interface DueDated { dueDate: string; status: PreOrderStatusParam }

/**
 * Group pre-orders by due date. The API already sorts by due_date ascending; order
 * inside a day is kept. Cancelled orders are dropped unless `includeCancelled`.
 */
export function groupByDueDate<T extends DueDated>(items: readonly T[], includeCancelled = false): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const it of items) {
    if (it.status === 'CANCELLED' && !includeCancelled) continue;
    (out[it.dueDate] ??= []).push(it);
  }
  return out;
}

/** Calendar label: customer name → phone → "ลูกค้าไม่ระบุชื่อ" (handoff: no customer_name). */
export function preOrderCustomerLabel(po: { customerName: string | null; customerPhone: string | null }): string {
  return po.customerName?.trim() || po.customerPhone?.trim() || 'ลูกค้าไม่ระบุชื่อ';
}
