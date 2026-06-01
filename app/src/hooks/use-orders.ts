import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

// ── KDS ticket shape (frontend) ───────────────────────────────────────────────
export interface KDSTicket {
  id: string;       // order_number e.g. "A047"
  orderId: string;  // UUID for API calls
  queue: number;
  type: 'Dine-in' | 'Takeaway' | 'Delivery';
  placedAt: number; // epoch ms
  status: 'new' | 'progress' | 'ready';
  items: { name: string; qty: number; mods: string[] }[];
}

// ── Create-order payload shape ────────────────────────────────────────────────
export interface CreateOrderPayload {
  idempotency_key: string;
  channel: 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY';
  customer_id?: string;
  customer_note?: string;
  items: {
    product_id: string;
    quantity: number;
    modifier_ids: string[];
  }[];
  // ── Membership (optional; silently ignored when no/inactive programme) ──
  member_id?: string;            // MembershipAccount.id from lookup (NOT customer_id)
  redeem_reward?: boolean;       // deduct points + apply server-computed discount
  reward_product_id?: string | null; // required when reward_type = FREE_ITEM
  // ── Promotions (optional; defaults to [] server-side) ──
  promotion_ids?: string[];      // selected eligible promotion ids; re-validated at checkout
}

// ── Backend shapes ────────────────────────────────────────────────────────────
interface OrderItemRead {
  product_name: string;
  quantity: number;
  modifiers_json: Record<string, unknown> | null;
}

interface OrderRead {
  id: string;
  order_number: number;
  status: string;
  channel: string;
  total: string | number;
  created_at: string;
  items?: OrderItemRead[];
  // ── Membership (present when a member was attached) ──
  discount?: string | number;
  member_id?: string | null;
  points_earned?: number;
  reward_redeemed?: boolean;
}

interface OrdersPage {
  items: OrderRead[];
  total: number;
  page: number;
  limit: number;
}

const CHANNEL_LABEL: Record<string, KDSTicket['type']> = {
  DINE_IN: 'Dine-in',
  TAKEAWAY: 'Takeaway',
  DELIVERY: 'Delivery',
};

const STATUS_MAP: Record<string, KDSTicket['status']> = {
  PAID: 'new',
  IN_PROGRESS: 'progress',
  READY: 'ready',
};

function parseModifiers(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object') return [];
  const obj = raw as Record<string, unknown>;
  const mods = obj.modifiers;
  if (Array.isArray(mods)) {
    return (mods as Record<string, unknown>[])
      .map(m => m.name)
      .filter((n): n is string => typeof n === 'string');
  }
  return [];
}

function mapToTicket(o: OrderRead): KDSTicket {
  const num = typeof o.order_number === 'number' ? o.order_number : parseInt(String(o.order_number).replace(/\D/g, '') || '0', 10);
  return {
    id: String(o.order_number),
    orderId: o.id,
    queue: num,
    type: CHANNEL_LABEL[o.channel] ?? 'Dine-in',
    placedAt: new Date(o.created_at).getTime(),
    status: STATUS_MAP[o.status] ?? 'new',
    items: (o.items ?? []).map(it => ({
      name: it.product_name,
      qty: it.quantity,
      mods: parseModifiers(it.modifiers_json),
    })),
  };
}

// ── Hooks ─────────────────────────────────────────────────────────────────────
export function useKDSOrders() {
  return useQuery<KDSTicket[]>({
    queryKey: ['kds-orders'],
    queryFn: async () => {
      const data = await api.get<OrdersPage>('/api/v1/orders?status=PAID&status=IN_PROGRESS&status=READY&limit=200');
      return (data.items ?? []).map(mapToTicket);
    },
    refetchInterval: 15000,
    refetchOnMount: 'always',
  });
}

export function useCreateOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateOrderPayload) =>
      api.post<OrderRead>('/api/v1/orders', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['kds-orders'] });
    },
  });
}

export function usePayOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, payment_method, payment_ref }: { orderId: string; payment_method: 'CASH' | 'CARD' | 'QR_PROMPTPAY' | 'LINE_PAY'; payment_ref?: string }) =>
      api.patch<OrderRead>(`/api/v1/orders/${orderId}/pay`, { payment_method, payment_ref }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['kds-orders'] });
    },
  });
}

export function useUpdateOrderStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, status }: { orderId: string; status: string }) =>
      api.patch(`/api/v1/orders/${orderId}/status`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['kds-orders'] });
    },
  });
}
