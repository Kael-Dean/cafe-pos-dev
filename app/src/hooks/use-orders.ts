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
  channel: 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY';
  payment_method: 'CASH' | 'CARD' | 'QR_PROMPTPAY' | 'LINE_PAY';
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  paid_amount: number;
  items: {
    product_id: string;
    product_name: string;
    quantity: number;
    unit_price: number;
    modifiers: unknown;
    notes?: string;
  }[];
}

// ── Backend shapes ────────────────────────────────────────────────────────────
interface OrderRead {
  id: string;
  order_number: string;
  status: string;
  channel: string;
  total: string | number;
  created_at: string;
  items?: {
    product_name: string;
    quantity: number;
    modifiers: unknown;
  }[];
}

const CHANNEL_LABEL: Record<string, KDSTicket['type']> = {
  DINE_IN: 'Dine-in',
  TAKEAWAY: 'Takeaway',
  DELIVERY: 'Delivery',
};

const STATUS_MAP: Record<string, KDSTicket['status']> = {
  PENDING: 'new',
  IN_PROGRESS: 'progress',
  READY: 'ready',
};

function parseModifiers(raw: unknown): string[] {
  if (Array.isArray(raw)) return (raw as unknown[]).filter((m): m is string => typeof m === 'string');
  if (raw && typeof raw === 'object') {
    const sel = (raw as Record<string, unknown>).selections;
    if (Array.isArray(sel)) return (sel as unknown[]).filter((m): m is string => typeof m === 'string');
  }
  return [];
}

function mapToTicket(o: OrderRead): KDSTicket {
  const num = parseInt(o.order_number.replace(/\D/g, '') || '0', 10);
  return {
    id: o.order_number,
    orderId: o.id,
    queue: num,
    type: CHANNEL_LABEL[o.channel] ?? 'Dine-in',
    placedAt: new Date(o.created_at).getTime(),
    status: STATUS_MAP[o.status] ?? 'new',
    items: (o.items ?? []).map(it => ({
      name: it.product_name,
      qty: it.quantity,
      mods: parseModifiers(it.modifiers),
    })),
  };
}

// ── Hooks ─────────────────────────────────────────────────────────────────────
export function useKDSOrders() {
  return useQuery<KDSTicket[]>({
    queryKey: ['kds-orders'],
    queryFn: async () => {
      const data = await api.get<OrderRead[]>('/api/v1/orders?status=PENDING,IN_PROGRESS,READY');
      return data.map(mapToTicket);
    },
    refetchInterval: 15000,
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
