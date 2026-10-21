import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@pos/core/lib/api-client';
import { parseModifierEntries } from '@pos/core/hooks/use-orders';
import { FLOOR_LIVE_KEY } from '@pos/core/hooks/use-floor-live';

/**
 * The bar's order board (handoff Part B "Order board"): every PENDING /
 * IN_PROGRESS / READY order, guest orders from the QR menu included. Guest orders
 * have `guest_id` set and `created_by_id: null` (no cashier name).
 *
 *   accept      PATCH /orders/{id}/status {status: IN_PROGRESS}   (tab orders: no payment first)
 *   ready       PATCH … {status: READY}
 *   served      PATCH … {status: COMPLETED}
 *   reject      POST  /orders/{id}/void {reason, restock: true}
 *   reassign    POST  /table-sessions/{sid}/orders/{oid}/reassign {guest_id}
 */

export type BoardStatus = 'PENDING' | 'IN_PROGRESS' | 'READY';

interface OrderItemRead {
  product_name: string;
  quantity: number;
  modifiers_json: Record<string, unknown> | null;
}

interface BoardOrderRead {
  id: string;
  order_number: number;
  daily_number?: number | null;
  receipt_no?: string;
  status: string;
  channel: string;
  total: string | number;
  created_at: string;
  items?: OrderItemRead[];
  session_id?: string | null;
  guest_id?: string | null;
  customer_note?: string | null;
  created_by_id?: string | null;
  // Not in the handoff, used when present.
  guest_label?: string | null;
  table_name?: string | null;
}

interface OrdersPage { items: BoardOrderRead[] }

export interface BoardOrder {
  id: string;
  number: number;
  status: BoardStatus;
  channel: string;
  total: string;
  createdAt: string;
  sessionId: string | null;
  guestId: string | null;
  /** From the order when the backend sends it; else the board joins `/floor/live`. */
  guestLabel: string | null;
  tableName: string | null;
  note: string | null;
  /** True for orders the guest sent from the QR menu (no cashier). */
  fromGuest: boolean;
  items: { name: string; qty: number; mods: string[] }[];
}

const BOARD_STATUSES: readonly string[] = ['PENDING', 'IN_PROGRESS', 'READY'];

export function mapBoardOrder(o: BoardOrderRead): BoardOrder | null {
  if (!BOARD_STATUSES.includes(o.status)) return null;
  return {
    id: o.id,
    number: o.daily_number ?? o.order_number,
    status: o.status as BoardStatus,
    channel: o.channel,
    total: String(o.total),
    createdAt: o.created_at,
    sessionId: o.session_id ?? null,
    guestId: o.guest_id ?? null,
    guestLabel: o.guest_label ?? null,
    tableName: o.table_name ?? null,
    note: o.customer_note?.trim() ? o.customer_note.trim() : null,
    fromGuest: !!o.guest_id && !o.created_by_id,
    items: (o.items ?? []).map((it) => ({
      name: it.product_name,
      qty: it.quantity,
      mods: parseModifierEntries(it.modifiers_json).map((m) => m.name),
    })),
  };
}

export const BAR_ORDERS_KEY = ['bar-orders'] as const;

/** Polls every `intervalMs` (5 s without realtime, slower while the socket is live). */
export function useBarOrders(enabled = true, intervalMs = 5_000) {
  return useQuery<BoardOrder[]>({
    queryKey: BAR_ORDERS_KEY,
    queryFn: async () => {
      const data = await api.get<OrdersPage>('/api/v1/orders?status=PENDING&status=IN_PROGRESS&status=READY&limit=200');
      return (data.items ?? []).map(mapBoardOrder).filter((o): o is BoardOrder => o !== null);
    },
    enabled,
    refetchInterval: intervalMs,
    // Keep polling while the PWA is in the background: the alert must still fire
    // when the owner switched apps for a moment (the wake lock keeps it visible).
    refetchIntervalInBackground: true,
    refetchOnMount: 'always',
  });
}

function useInvalidateBar() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: BAR_ORDERS_KEY });
    void qc.invalidateQueries({ queryKey: ['kds-orders'] });
    void qc.invalidateQueries({ queryKey: FLOOR_LIVE_KEY });
    void qc.invalidateQueries({ queryKey: ['table-bill'] });
  };
}

export type NextStatus = 'IN_PROGRESS' | 'READY' | 'COMPLETED';

/** PENDING → IN_PROGRESS → READY → COMPLETED. */
export const NEXT_STATUS: Record<BoardStatus, NextStatus> = {
  PENDING: 'IN_PROGRESS',
  IN_PROGRESS: 'READY',
  READY: 'COMPLETED',
};

export function useAdvanceBarOrder() {
  const qc = useQueryClient();
  const invalidate = useInvalidateBar();
  return useMutation({
    mutationFn: ({ orderId, status }: { orderId: string; status: NextStatus }) =>
      api.patch<BoardOrderRead>(`/api/v1/orders/${orderId}/status`, { status }),
    // Optimistic: the card moves column at once; a failure rolls back.
    onMutate: async ({ orderId, status }) => {
      await qc.cancelQueries({ queryKey: BAR_ORDERS_KEY });
      const prev = qc.getQueryData<BoardOrder[]>(BAR_ORDERS_KEY);
      qc.setQueryData<BoardOrder[]>(BAR_ORDERS_KEY, (list) =>
        (list ?? []).flatMap((o) => (o.id !== orderId ? [o] : status === 'COMPLETED' ? [] : [{ ...o, status }])),
      );
      return { prev };
    },
    onError: (_e, _v, c) => { if (c?.prev) qc.setQueryData(BAR_ORDERS_KEY, c.prev); },
    onSettled: invalidate,
  });
}

export function useRejectBarOrder() {
  const qc = useQueryClient();
  const invalidate = useInvalidateBar();
  return useMutation({
    mutationFn: ({ orderId, reason }: { orderId: string; reason: string }) =>
      api.post<BoardOrderRead>(`/api/v1/orders/${orderId}/void`, { reason, restock: true }),
    onSuccess: (_d, { orderId }) => {
      qc.setQueryData<BoardOrder[]>(BAR_ORDERS_KEY, (list) => (list ?? []).filter((o) => o.id !== orderId));
    },
    onSettled: invalidate,
  });
}

export function useReassignOrder() {
  const invalidate = useInvalidateBar();
  return useMutation({
    mutationFn: ({ sessionId, orderId, guestId }: { sessionId: string; orderId: string; guestId: string }) =>
      api.post<unknown>(`/api/v1/table-sessions/${sessionId}/orders/${orderId}/reassign`, { guest_id: guestId }),
    onSettled: invalidate,
  });
}

/** Reasons the owner taps when rejecting (the API takes free text). */
export const REJECT_REASONS = [
  'ของหมด',
  'ร้านปิดรับออเดอร์แล้ว',
  'สั่งซ้ำ',
  'ลูกค้าขอยกเลิก',
] as const;
