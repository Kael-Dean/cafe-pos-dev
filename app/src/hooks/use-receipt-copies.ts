import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { parseModifiers, displayOrderNo } from '@/hooks/use-orders';
import type { ReceiptData } from '@/components/screens/receipt-modal';
import type { PrintReceiptArgs } from '@/hooks/use-printer';
import type { MemberRead, ProgramRead } from '@/hooks/use-membership';

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
  daily_number?: number;
  business_date?: string;
  receipt_no?: string;
  store_id: string;
  customer_id: string | null;
  member_id?: string | null;
  status: string;
  channel: string;
  payment_method: string | null;
  payment_ref: string | null;
  customer_note: string | null;
  subtotal: string | number;
  discount: string | number;
  tax: string | number;
  total: string | number;
  // ── Membership (present when a member was attached) ──
  points_earned?: number;
  reward_redeemed?: boolean;
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

// Buyer (ลูกค้า) + salesperson (เซลส์) names aren't on the order itself — they
// live on the linked customer. The receipt screen resolves them (via
// useCustomerDetail on o.customer_id) and passes them in here so reprints show
// the same buyer/sales block as the original bill.
export interface ReceiptParties {
  memberName?: string;
  salesName?: string;
}

// Points to print on a reprint. Resolved from the member's point-transaction log
// (authoritative `balance_after`, keyed by order_id) rather than recomputed, so a
// copy shows the exact remaining balance as of that bill.
export interface ReceiptPoints {
  earned?: number;
  redeemed?: number;
  balanceAfter?: number;
  rewardLabel?: string;
}

/**
 * Resolve an order's point movement + resulting balance for a reprint.
 *
 * A single order can produce BOTH an earn and a redeem transaction (e.g. earn on
 * the amount paid AND redeem a reward), so we take ALL transactions keyed by
 * `order_id`: sum the earns/redeems, and read `balance_after` off the LATEST one
 * (by `created_at`) — that is the true remaining balance once the bill settled.
 * Picking the first match would surface the pre-redeem balance.
 *
 * When the order predates the member's last-20 transaction window, falls back to
 * the order's own earn/redeem flags (with the programme's `points_to_redeem`) and
 * the member's *current* balance.
 */
export function computeOrderPoints(
  o: OrderFull | null | undefined,
  member: MemberRead | null | undefined,
  program: ProgramRead | null | undefined,
): ReceiptPoints | undefined {
  if (!o) return undefined;
  const txns = (member?.recent_transactions ?? []).filter(t => t.order_id === o.id);
  let earned = 0;
  let redeemed = 0;
  let balanceAfter: number | undefined;
  if (txns.length) {
    for (const t of txns) {
      if (t.delta > 0) earned += t.delta;
      else if (t.delta < 0) redeemed += -t.delta;
    }
    const latest = [...txns].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    )[txns.length - 1];
    balanceAfter = latest.balance_after;
  } else {
    earned = o.points_earned ?? 0;
    redeemed = o.reward_redeemed ? (program?.points_to_redeem ?? 0) : 0;
    balanceAfter = member?.points_balance;
  }
  if (!earned && !redeemed && balanceAfter == null) return undefined;
  return {
    ...(earned ? { earned } : {}),
    ...(redeemed ? { redeemed } : {}),
    ...(balanceAfter != null ? { balanceAfter } : {}),
  };
}

function pointFields(points?: ReceiptPoints) {
  if (!points) return {};
  return {
    ...(points.earned ? { pointsEarned: points.earned } : {}),
    ...(points.redeemed ? { pointsRedeemed: points.redeemed } : {}),
    ...(points.balanceAfter != null ? { pointsBalanceAfter: points.balanceAfter } : {}),
    ...(points.rewardLabel ? { rewardLabel: points.rewardLabel } : {}),
  };
}

/** Order → on-screen receipt (ReceiptModal). */
export function mapOrderToReceipt(o: OrderFull, parties?: ReceiptParties, points?: ReceiptPoints): ReceiptData {
  const discount = Number(o.discount);
  return {
    orderNumber: String(displayOrderNo(o)),
    items: mapItems(o),
    subtotal: Number(o.subtotal),
    total: Number(o.total),
    paymentMethod: o.payment_method ?? '',
    paymentLabel: paymentLabel(o.payment_method),
    ...(o.receipt_no ? { receiptNo: o.receipt_no } : {}),
    ...(discount > 0 ? { discount } : {}),
    ...(parties?.memberName ? { memberName: parties.memberName } : {}),
    ...(parties?.salesName ? { salesName: parties.salesName } : {}),
    ...pointFields(points),
  };
}

/** Order → print job (usePrinter().printReceipt). Reprints are no longer marked
 *  "สำเนา" — they reproduce the original bill exactly, keeping the original
 *  order date so the slip shows when the sale actually happened. */
export function mapOrderToPrintArgs(o: OrderFull, parties?: ReceiptParties, points?: ReceiptPoints): PrintReceiptArgs {
  const discount = Number(o.discount);
  return {
    orderNumber: String(displayOrderNo(o)),
    items: mapItems(o),
    subtotal: Number(o.subtotal),
    total: Number(o.total),
    // printReceipt looks this up in its own PAY_LABEL map, then falls through to
    // the raw string — passing the Thai label directly prints it verbatim.
    paymentMethod: paymentLabel(o.payment_method),
    issuedAt: new Date(o.created_at),
    ...(o.receipt_no ? { receiptNo: o.receipt_no } : {}),
    // Historical orders only carry the discount total (no per-promo breakdown),
    // so reprints show a single "ส่วนลด" line. Points (earn/redeem + the balance
    // after) come from the member's transaction log via computeOrderPoints().
    ...(discount > 0 ? { discount } : {}),
    ...(parties?.memberName ? { memberName: parties.memberName } : {}),
    ...(parties?.salesName ? { salesName: parties.salesName } : {}),
    ...pointFields(points),
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
