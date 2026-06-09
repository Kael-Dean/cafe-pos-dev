import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { parseModifiers } from '@/hooks/use-orders';
import type { ReceiptData } from '@/components/screens/receipt-modal';
import type { PrintReceiptArgs } from '@/hooks/use-printer';

// ── Backend shapes (full order detail — superset of use-orders.ts OrderRead) ──
// Matches app/api/v1/schemas/orders.py → OrderRead / OrderItemRead.
export interface OrderItemFull {
  id: string;
  order_id: string;
  product_id: string | null;
  product_name: string;
  quantity: number;
  unit_price: string | number;
  line_total: string | number;
  modifiers_json: Record<string, unknown> | null;
}

export interface OrderFull {
  id: string;
  order_number: number;
  store_id: string;
  customer_id: string | null;
  status: string;
  channel: string;
  payment_method: string | null;
  payment_ref: string | null;
  customer_note: string | null;
  subtotal: string | number;
  discount: string | number;
  tax: string | number;
  total: string | number;
  created_by_id: string;
  items: OrderItemFull[];
  created_at: string;
  updated_at: string;
}

interface OrdersPage {
  items: OrderFull[];
  total: number;
  page: number;
  limit: number;
}

// Statuses that represent a real, paid sale (a receipt exists). PENDING orders
// were never paid; VOID orders were cancelled — both are excluded here.
const PAID_STATUSES = ['PAID', 'IN_PROGRESS', 'READY', 'COMPLETED'] as const;

const PAGE_LIMIT = 200; // backend max (Query le=200)

// Thai payment labels, keyed by the backend PaymentMethod enum.
const PAYMENT_LABEL: Record<string, string> = {
  CASH: 'เงินสด',
  CARD: 'บัตรเครดิต',
  QR_PROMPTPAY: 'QR PromptPay',
  LINE_PAY: 'LINE Pay',
  TRUEMONEY: 'TrueMoney',
  OTHER: 'อื่นๆ',
};

export function paymentLabel(method: string | null): string {
  if (!method) return '—';
  return PAYMENT_LABEL[method] ?? method;
}

// ── Mappers ───────────────────────────────────────────────────────────────────
function mapItems(o: OrderFull) {
  return o.items.map(it => ({
    name: it.product_name,
    qty: it.quantity,
    unitPrice: Number(it.unit_price),
    mods: parseModifiers(it.modifiers_json),
  }));
}

/** Order → on-screen receipt (ReceiptModal). */
export function mapOrderToReceipt(o: OrderFull): ReceiptData {
  const discount = Number(o.discount);
  return {
    orderNumber: String(o.order_number),
    items: mapItems(o),
    subtotal: Number(o.subtotal),
    total: Number(o.total),
    paymentMethod: o.payment_method ?? '',
    paymentLabel: paymentLabel(o.payment_method),
    ...(discount > 0 ? { discount } : {}),
  };
}

/** Order → print job (usePrinter().printReceipt). Marked as a copy with the
 *  original order date so the reprint shows when the sale actually happened. */
export function mapOrderToPrintArgs(o: OrderFull): PrintReceiptArgs {
  return {
    orderNumber: String(o.order_number),
    items: mapItems(o),
    subtotal: Number(o.subtotal),
    total: Number(o.total),
    // printReceipt looks this up in its own PAY_LABEL map, then falls through to
    // the raw string — passing the Thai label directly prints it verbatim.
    paymentMethod: paymentLabel(o.payment_method),
    issuedAt: new Date(o.created_at),
    copy: true,
  };
}

// ── Hook ────────────────────────────────────────────────────────────────────
// dateISO is a calendar day in local time, e.g. "2026-06-10" from <input type="date">.
function dayBounds(dateISO: string): { from: string; to: string } {
  const [y, m, d] = dateISO.split('-').map(Number);
  const from = new Date(y, m - 1, d, 0, 0, 0, 0);
  const to = new Date(y, m - 1, d, 23, 59, 59, 999);
  return { from: from.toISOString(), to: to.toISOString() };
}

async function fetchAllForDay(dateISO: string): Promise<OrderFull[]> {
  const { from, to } = dayBounds(dateISO);
  const base = new URLSearchParams();
  PAID_STATUSES.forEach(s => base.append('status', s));
  base.set('from', from);
  base.set('to', to);
  base.set('limit', String(PAGE_LIMIT));

  const collected: OrderFull[] = [];
  let page = 1;
  // Loop pages until we've pulled every order for the day (days rarely exceed
  // one page, but a busy day can — never silently truncate the daily total).
  for (;;) {
    const qs = new URLSearchParams(base);
    qs.set('page', String(page));
    const data = await api.get<OrdersPage>(`/api/v1/orders?${qs.toString()}`);
    collected.push(...(data.items ?? []));
    if (collected.length >= data.total || (data.items ?? []).length === 0) break;
    page += 1;
  }

  // Backend returns newest-first; show the day in the order it happened.
  return collected.sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
}

export function useReceiptCopies(dateISO: string) {
  return useQuery<OrderFull[]>({
    queryKey: ['receipt-copies', dateISO],
    queryFn: () => fetchAllForDay(dateISO),
    enabled: !!dateISO,
  });
}
