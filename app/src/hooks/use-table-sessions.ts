import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import type { BillingMode } from './use-rate-plans';

// ── Enums ─────────────────────────────────────────────────────────────────────
export type SessionStatus = 'OPEN' | 'CLOSED' | 'VOID';

/** Full PaymentMethod enum — the settle screen can pay each order its own way. */
export type PaymentMethod = 'CASH' | 'CARD' | 'QR_PROMPTPAY' | 'LINE_PAY' | 'TRUEMONEY' | 'OTHER';

// ── Backend shapes ────────────────────────────────────────────────────────────
interface RateSnapshotRead {
  name: string;
  billing_mode: BillingMode;
  hourly_rate: string;
  grace_minutes: number;
  rounding_increment_minutes: number;
  min_charge_minutes: number;
  daily_cap_amount: string | null;
  max_open_minutes: number;
}

interface SessionRead {
  id: string;
  table_id: string;
  status: SessionStatus;
  party_size: number;
  customer_id: string | null;
  opened_at: string;
  closed_at: string | null;
  rate_plan_id: string;
  rate_snapshot: RateSnapshotRead;
  time_charge_amount: string | null;
  time_charge_order_id: string | null;
  note: string | null;
}

interface TimeChargeRead {
  amount: string;
  billable_minutes: number;
  raw_minutes: number;
  within_grace: boolean;
  cap_applied: boolean;
}

interface UnpaidOrderRead {
  id: string;
  receipt_no: string;
  total: string;
  status: string;
}

interface SessionCloseResultRead {
  session: SessionRead;
  time_charge: TimeChargeRead;
  unpaid_orders: UnpaidOrderRead[];
  settled: boolean;
}

// ── Frontend shapes ───────────────────────────────────────────────────────────
export interface RateSnapshot {
  name: string;
  billingMode: BillingMode;
  hourlyRate: string;
  graceMinutes: number;
  roundingIncrementMinutes: number;
  minChargeMinutes: number;
  dailyCapAmount: string | null;
  maxOpenMinutes: number;
}

export interface TableSession {
  id: string;
  tableId: string;
  status: SessionStatus;
  partySize: number;
  customerId: string | null;
  openedAt: string;
  closedAt: string | null;
  ratePlanId: string;
  rateSnapshot: RateSnapshot;
  timeChargeAmount: string | null;
  timeChargeOrderId: string | null;
  note: string | null;
}

/** Shape shared by `billing-preview` and the `time_charge` block of `close`. */
export interface TimeCharge {
  amount: string;
  billableMinutes: number;
  rawMinutes: number;
  withinGrace: boolean;
  capApplied: boolean;
}

export interface UnpaidOrder {
  id: string;
  receiptNo: string;
  total: string;
  status: string;
}

export interface SessionCloseResult {
  session: TableSession;
  timeCharge: TimeCharge;
  unpaidOrders: UnpaidOrder[];
  settled: boolean;
}

// ── Mappers ───────────────────────────────────────────────────────────────────
function mapSnapshot(s: RateSnapshotRead): RateSnapshot {
  return {
    name: s.name,
    billingMode: s.billing_mode,
    hourlyRate: s.hourly_rate,
    graceMinutes: s.grace_minutes,
    roundingIncrementMinutes: s.rounding_increment_minutes,
    minChargeMinutes: s.min_charge_minutes,
    dailyCapAmount: s.daily_cap_amount,
    maxOpenMinutes: s.max_open_minutes,
  };
}

function mapSession(s: SessionRead): TableSession {
  return {
    id: s.id,
    tableId: s.table_id,
    status: s.status,
    partySize: s.party_size,
    customerId: s.customer_id,
    openedAt: s.opened_at,
    closedAt: s.closed_at,
    ratePlanId: s.rate_plan_id,
    rateSnapshot: mapSnapshot(s.rate_snapshot),
    timeChargeAmount: s.time_charge_amount,
    timeChargeOrderId: s.time_charge_order_id,
    note: s.note,
  };
}

function mapTimeCharge(t: TimeChargeRead): TimeCharge {
  return {
    amount: t.amount,
    billableMinutes: t.billable_minutes,
    rawMinutes: t.raw_minutes,
    withinGrace: t.within_grace,
    capApplied: t.cap_applied,
  };
}

function mapCloseResult(r: SessionCloseResultRead): SessionCloseResult {
  return {
    session: mapSession(r.session),
    timeCharge: mapTimeCharge(r.time_charge),
    unpaidOrders: r.unpaid_orders.map((o) => ({
      id: o.id,
      receiptNo: o.receipt_no,
      total: o.total,
      status: o.status,
    })),
    settled: r.settled,
  };
}

// ── Read hooks ────────────────────────────────────────────────────────────────
/** Sessions newest first. The floor board wants `status: 'OPEN'`. */
export function useTableSessions(status?: SessionStatus, enabled = true) {
  return useQuery<TableSession[]>({
    queryKey: ['table-sessions', status ?? 'all'],
    queryFn: async () => {
      const qs = status ? `?status=${status}` : '';
      const data = await api.get<SessionRead[]>(`/api/v1/table-sessions${qs}`);
      return data.map(mapSession);
    },
    enabled,
  });
}

/**
 * The ONLY sanctioned source of a running total. Never recompute a time charge in
 * the UI — the preview and the final close run the same server-side math, so they
 * can only agree while the UI just displays what comes back.
 *
 * Polls at the interval the handoff suggests (30–60 s per visible session).
 */
export function useBillingPreview(sessionId: string | null, enabled = true, intervalMs = 45_000) {
  return useQuery<TimeCharge>({
    queryKey: ['billing-preview', sessionId],
    queryFn: async () => {
      if (!sessionId) throw new Error('sessionId is required');
      const data = await api.get<TimeChargeRead>(`/api/v1/table-sessions/${sessionId}/billing-preview`);
      return mapTimeCharge(data);
    },
    enabled: !!sessionId && enabled,
    refetchInterval: intervalMs,
    refetchIntervalInBackground: false,
  });
}

// ── Mutation payloads ─────────────────────────────────────────────────────────
export interface OpenSessionPayload {
  table_id: string;
  party_size: number;
  rate_plan_id?: string | null;   // null/omitted → the store's default plan
  customer_id?: string | null;
  note?: string | null;
}

export interface UpdateSessionPayload {
  party_size?: number;
  customer_id?: string | null;
  note?: string | null;
}

// ── Mutation hooks ────────────────────────────────────────────────────────────
function useSessionMutation<TVars>(run: (vars: TVars) => Promise<TableSession>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: (session) => {
      qc.invalidateQueries({ queryKey: ['table-sessions'] });
      qc.invalidateQueries({ queryKey: ['billing-preview', session.id] });
    },
  });
}

export function useOpenTableSession() {
  return useSessionMutation((payload: OpenSessionPayload) =>
    api.post<SessionRead>('/api/v1/table-sessions', payload).then(mapSession),
  );
}

/** Party-size changes apply to the WHOLE session at close — no proration in M1. */
export function useUpdateTableSession() {
  return useSessionMutation(({ id, data }: { id: string; data: UpdateSessionPayload }) =>
    api.patch<SessionRead>(`/api/v1/table-sessions/${id}`, data).then(mapSession),
  );
}

/** Move the party to another table; the clock keeps running. */
export function useMoveTableSession() {
  return useSessionMutation(({ id, tableId }: { id: string; tableId: string }) =>
    api.post<SessionRead>(`/api/v1/table-sessions/${id}/move`, { table_id: tableId }).then(mapSession),
  );
}

/** Cancel with no charge (MANAGER/OWNER). 409 when non-void orders are attached. */
export function useVoidTableSession() {
  return useSessionMutation((id: string) =>
    api.post<SessionRead>(`/api/v1/table-sessions/${id}/void`, {}).then(mapSession),
  );
}

/**
 * Stops the clock, generates the time-charge order, and reports what is still
 * unpaid. Idempotent and safe to retry: calling it again never re-bills, never
 * moves `closed_at`, never creates a second time-charge order — retrying is
 * exactly how the settle flow finishes after the last payment.
 */
export function useCloseTableSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<SessionCloseResultRead>(`/api/v1/table-sessions/${id}/close`, {}).then(mapCloseResult),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['table-sessions'] });
      qc.invalidateQueries({ queryKey: ['billing-preview', result.session.id] });
      qc.invalidateQueries({ queryKey: ['kds-orders'] });
    },
  });
}
