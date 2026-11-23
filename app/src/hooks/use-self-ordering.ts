import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { billPath, guestPayBody, tablePayBody, type GuestStatus, type PayMethod, type BoardOrderLike } from '@/lib/self-ordering';

// ── Backend shapes (only the fields we read) ──────────────────────────────────
export interface GuestRead {
  id: string;
  session_id: string;
  label: string;
  status: GuestStatus;
  arrived_at: string;
  checkout_requested_at: string | null;
  unpaid_total: string;
}

export interface LiveSession {
  id: string;
  party_size: number;
  opened_at: string;
  unpaid_orders: number;
  unpaid_total: string;
  guests: GuestRead[];
  checkout_requested_count: number;
}

export interface LiveTable {
  table: { id: string; name: string; zone: string | null; capacity: number; is_active: boolean };
  session: LiveSession | null;
}

interface FloorLiveRead { tables: LiveTable[] }

interface ApiOrderItem { product_name: string; quantity: number; modifiers_json: Record<string, unknown> | null }
interface ApiOrder {
  id: string;
  order_number: number;
  daily_number?: number;
  status: string;
  session_id: string | null;
  guest_id: string | null;
  created_by_id: string | null;
  customer_note: string | null;
  created_at: string;
  total: string;
  items?: ApiOrderItem[];
}

export interface BoardOrderItem { name: string; qty: number; mods: string[] }
export interface BoardOrder extends BoardOrderLike {
  displayNo: number;
  note: string | null;
  total: string;
  items: BoardOrderItem[];
}

function modNames(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object') return [];
  const mods = (raw as Record<string, unknown>).modifiers;
  if (!Array.isArray(mods)) return [];
  return mods.map((m) => (m && typeof (m as { name?: unknown }).name === 'string' ? (m as { name: string }).name : '')).filter(Boolean);
}

export function mapBoardOrder(o: ApiOrder): BoardOrder {
  return {
    id: o.id,
    status: o.status,
    sessionId: o.session_id,
    guestId: o.guest_id,
    createdById: o.created_by_id,
    createdAt: new Date(o.created_at).getTime(),
    orderNo: o.order_number,
    displayNo: o.daily_number ?? o.order_number,
    note: o.customer_note?.trim() || null,
    total: o.total,
    items: (o.items ?? []).map((it) => ({ name: it.product_name, qty: it.quantity, mods: modNames(it.modifiers_json) })),
  };
}

// ── Order board ───────────────────────────────────────────────────────────────
export const BOARD_POLL_MS = 5_000;
const NEW_TABLE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Every order of the last 24 h on table tabs — ALL statuses, because the NEW TABLE badge
 * needs to know whether a session already had an earlier (maybe served) order.
 * The board itself only shows PENDING / IN_PROGRESS / READY (decorateBoard filters).
 *
 * Real time = short polling. This app has no websocket client (the KDS polls too, and the
 * BFF is plain HTTP), so 5 s polling stands in for the Pusher `kds-store-{id}` channel.
 */
export function useBoardOrders(enabled: boolean) {
  return useQuery<BoardOrder[]>({
    queryKey: ['board-orders'],
    enabled,
    refetchInterval: BOARD_POLL_MS,
    // Keep polling when the tablet tab is in the background — a missed order is the failure mode.
    refetchIntervalInBackground: true,
    refetchOnMount: 'always',
    queryFn: async () => {
      const from = new Date(Date.now() - NEW_TABLE_WINDOW_MS).toISOString();
      const qs = ['PENDING', 'IN_PROGRESS', 'READY', 'COMPLETED', 'VOID', 'PAID']
        .map((s) => `status=${s}`)
        .join('&');
      const data = await api.get<{ items: ApiOrder[] }>(`/api/v1/orders?${qs}&from=${encodeURIComponent(from)}&limit=200`);
      return (data.items ?? []).filter((o) => o.session_id).map(mapBoardOrder);
    },
  });
}

export function useSetOrderStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, status }: { orderId: string; status: 'IN_PROGRESS' | 'READY' | 'COMPLETED' }) =>
      api.patch(`/api/v1/orders/${orderId}/status`, { status }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['board-orders'] });
      void qc.invalidateQueries({ queryKey: ['floor-live'] });
    },
  });
}

/** Reject = void with restock, so the stock goes back on the shelf. */
export function useRejectOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, reason }: { orderId: string; reason: string }) =>
      api.post(`/api/v1/orders/${orderId}/void`, { reason, restock: true }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['board-orders'] });
      void qc.invalidateQueries({ queryKey: ['floor-live'] });
    },
  });
}

// ── Tables overview ───────────────────────────────────────────────────────────
export const FLOOR_LIVE_POLL_MS = 15_000;

export function useFloorLive(enabled: boolean) {
  return useQuery<LiveTable[]>({
    queryKey: ['floor-live'],
    enabled,
    refetchInterval: FLOOR_LIVE_POLL_MS,
    refetchIntervalInBackground: true,
    queryFn: async () => (await api.get<FloorLiveRead>('/api/v1/floor/live')).tables,
  });
}

// ── Table QR (OWNER / MANAGER) ────────────────────────────────────────────────
export interface TableQr {
  table_id: string;
  table_name: string;
  code: string;
  url: string | null;
  qr_png_base64: string | null;
}

export function useTableQr(tableId: string, enabled: boolean) {
  return useQuery<TableQr>({
    queryKey: ['table-qr', tableId],
    enabled,
    staleTime: 60_000,
    retry: false,
    queryFn: () => api.get<TableQr>(`/api/v1/floor/tables/${tableId}/qr`),
  });
}

/** One query per table (same keys as useTableQr, so reissue updates both) — feeds the print-all sheet. */
export function useTableQrs(tableIds: readonly string[], enabled: boolean) {
  return useQueries({
    queries: tableIds.map((id) => ({
      queryKey: ['table-qr', id],
      enabled,
      staleTime: 60_000,
      retry: false,
      queryFn: () => api.get<TableQr>(`/api/v1/floor/tables/${id}/qr`),
    })),
  });
}

export function useReissueTableQr() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tableId: string) => api.post<TableQr>(`/api/v1/floor/tables/${tableId}/qr/reissue`, {}),
    onSuccess: (qr) => { qc.setQueryData(['table-qr', qr.table_id], qr); },
  });
}

// ── Bills / checkout ──────────────────────────────────────────────────────────
export interface BillLine {
  order_id: string;
  receipt_no: string;
  guest_label: string | null;
  total: string;
  is_time_charge: boolean;
}

export interface BillPreview {
  scope: 'GUEST' | 'TABLE';
  session_id: string;
  guest_id: string | null;
  lines: BillLine[];
  fnb_total: string;
  /** Always "0" at a table-QR bar — the UI must not show time. */
  time_total: string;
  amount: string;
  guests_pending_checkout: string[];
}

export interface PromptPayQr { payload: string; qr_png_base64: string; amount: string }
export interface PaidBill { id: string; amount: string; scope: 'GUEST' | 'TABLE'; payment_method: PayMethod }

export function useBillPreview(sessionId: string | null, guestId: string | null, enabled = true) {
  return useQuery<BillPreview>({
    queryKey: ['bill', sessionId, guestId],
    enabled: !!sessionId && enabled,
    queryFn: () => api.get<BillPreview>(billPath(sessionId!, guestId)),
  });
}

function useBillInvalidate() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['bill'] });
    void qc.invalidateQueries({ queryKey: ['floor-live'] });
    void qc.invalidateQueries({ queryKey: ['board-orders'] });
  };
}

/** Step 1 of paying one person: stops their tab and returns their bill. */
export function useCheckoutGuest() {
  const inval = useBillInvalidate();
  return useMutation({
    mutationFn: ({ sessionId, guestId }: { sessionId: string; guestId: string }) =>
      api.post<BillPreview>(`/api/v1/table-sessions/${sessionId}/guests/${guestId}/checkout`, {}),
    onSettled: inval,
  });
}

/** Step 2 (QR only): PromptPay payload + PNG for the exact amount. */
export function useGuestPromptPayQr() {
  return useMutation({
    mutationFn: ({ sessionId, guestId }: { sessionId: string; guestId: string }) =>
      api.get<PromptPayQr>(`/api/v1/table-sessions/${sessionId}/bill/promptpay-qr?guest_id=${encodeURIComponent(guestId)}`),
  });
}

export function usePayGuestBill() {
  const inval = useBillInvalidate();
  return useMutation({
    mutationFn: ({ sessionId, guestId, method }: { sessionId: string; guestId: string; method: PayMethod }) =>
      api.post<PaidBill>(`/api/v1/table-sessions/${sessionId}/bill/pay`, guestPayBody(guestId, method)),
    onSettled: inval,
  });
}

/** Pay everything left on the table (force = check out whoever is still seated). */
export function usePayTableBill() {
  const inval = useBillInvalidate();
  return useMutation({
    mutationFn: ({ sessionId, method }: { sessionId: string; method: PayMethod }) =>
      api.post<PaidBill>(`/api/v1/table-sessions/${sessionId}/bill/pay`, tablePayBody(method)),
    onSettled: inval,
  });
}

/** Close once nothing is unpaid → `{ settled: true }`. Existing useCloseTableSession also works; this one is typed for the bar flow. */
export function useCloseBarTable() {
  const inval = useBillInvalidate();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      api.post<{ settled: boolean }>(`/api/v1/table-sessions/${sessionId}/close`, {}),
    onSettled: () => {
      inval();
      void qc.invalidateQueries({ queryKey: ['table-sessions'] });
    },
  });
}

/** Put a walk-up (guest-less) order on a person's tab. */
export function useReassignOrder() {
  const inval = useBillInvalidate();
  return useMutation({
    mutationFn: ({ sessionId, orderId, guestId }: { sessionId: string; orderId: string; guestId: string }) =>
      api.post(`/api/v1/table-sessions/${sessionId}/orders/${orderId}/reassign`, { guest_id: guestId }),
    onSettled: inval,
  });
}
