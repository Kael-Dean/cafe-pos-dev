import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@pos/core/lib/api-client';
import { FLOOR_LIVE_KEY } from '@pos/core/hooks/use-floor-live';
import type { BillPayMethod } from '@pos/core/lib/table-ordering/bill-flow';

/**
 * Tab checkout (handoff Part B "Checkout"). Preview the bill for the whole table
 * or one guest, check a guest out, optional PromptPay QR for their exact amount,
 * pay GUEST / TABLE, close. The chaining rules live in lib/table-ordering/bill-flow.
 *
 * `lines[]` is not specified field by field in the handoff, so the mapper takes
 * the usual names and keeps whatever is missing as null.
 */

type Loose = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null);
const obj = (v: unknown): Loose | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Loose) : null);

export interface BillLine {
  key: string;
  orderId: string | null;
  receiptNo: string | null;
  name: string;
  quantity: number;
  amount: string;
  guestId: string | null;
  guestLabel: string | null;
  mods: string[];
}

export interface BillPreview {
  lines: BillLine[];
  fnbTotal: string;
  timeTotal: string;
  amount: string;
  /** Guest ids still seated (not checked out). */
  guestsPendingCheckout: string[];
}

export function mapBillLine(l: Loose, i: number): BillLine {
  const modsRaw = Array.isArray(l.modifiers) ? l.modifiers : [];
  return {
    key: `${str(l.order_id) ?? 'x'}-${str(l.id) ?? i}`,
    orderId: str(l.order_id),
    receiptNo: str(l.receipt_no),
    name: str(l.product_name) ?? str(l.name) ?? str(l.description) ?? 'รายการ',
    quantity: typeof l.quantity === 'number' ? l.quantity : 1,
    amount: str(l.line_total) ?? str(l.amount) ?? str(l.total) ?? '0.00',
    guestId: str(l.guest_id),
    guestLabel: str(l.guest_label),
    mods: modsRaw.map((m) => (typeof m === 'string' ? m : str(obj(m)?.name) ?? '')).filter(Boolean),
  };
}

export function mapBillPreview(raw: unknown): BillPreview {
  const b = obj(raw) ?? {};
  const pending = Array.isArray(b.guests_pending_checkout) ? b.guests_pending_checkout : [];
  return {
    lines: (Array.isArray(b.lines) ? b.lines : []).map(obj).filter((x): x is Loose => !!x).map(mapBillLine),
    fnbTotal: str(b.fnb_total) ?? '0.00',
    timeTotal: str(b.time_total) ?? '0.00',
    amount: str(b.amount) ?? str(b.total) ?? '0.00',
    guestsPendingCheckout: pending
      .map((g) => (typeof g === 'string' ? g : str(obj(g)?.id) ?? str(obj(g)?.guest_id)))
      .filter((x): x is string => !!x),
  };
}

export const billKey = (sessionId: string | null, guestId?: string | null) => ['table-bill', sessionId, guestId ?? 'table'] as const;

export function useTableBill(sessionId: string | null, guestId?: string | null, enabled = true) {
  return useQuery<BillPreview>({
    queryKey: billKey(sessionId, guestId),
    queryFn: async () => {
      const qs = guestId ? `?guest_id=${encodeURIComponent(guestId)}` : '';
      return mapBillPreview(await api.get<unknown>(`/api/v1/table-sessions/${sessionId}/bill${qs}`));
    },
    enabled: !!sessionId && enabled,
    refetchInterval: 15_000,
  });
}

function useInvalidateBills() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['table-bill'] });
    void qc.invalidateQueries({ queryKey: FLOOR_LIVE_KEY });
    void qc.invalidateQueries({ queryKey: ['table-sessions'] });
  };
}

/** Step 1 for a split bill: stops the guest's (฿0) clock; returns their bill. */
export function useCheckoutGuest() {
  const invalidate = useInvalidateBills();
  return useMutation({
    mutationFn: async ({ sessionId, guestId }: { sessionId: string; guestId: string }) =>
      mapBillPreview(await api.post<unknown>(`/api/v1/table-sessions/${sessionId}/guests/${guestId}/checkout`, {})),
    onSettled: invalidate,
  });
}

export interface PromptPayQr { amount: string | null; payload: string | null; pngBase64: string | null }

/** PromptPay QR for one guest's exact amount (or the whole table without a guest). */
export function useBillPromptPayQr(sessionId: string | null, guestId: string | null, enabled: boolean) {
  return useQuery<PromptPayQr>({
    queryKey: ['table-bill-qr', sessionId, guestId ?? 'table'],
    queryFn: async () => {
      const qs = guestId ? `?guest_id=${encodeURIComponent(guestId)}` : '';
      const r = obj(await api.get<unknown>(`/api/v1/table-sessions/${sessionId}/bill/promptpay-qr${qs}`)) ?? {};
      return {
        amount: str(r.amount),
        payload: str(r.payload),
        pngBase64: str(r.qr_png_base64) ?? str(r.qr_image_base64),
      };
    },
    enabled: !!sessionId && enabled,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

export type PayBillPayload =
  | { scope: 'GUEST'; guest_id: string; payment_method: BillPayMethod }
  | { scope: 'TABLE'; payment_method: BillPayMethod; force: true };

export interface BillRead { id: string | null; amount: string | null }

export function usePayBill() {
  const invalidate = useInvalidateBills();
  return useMutation({
    mutationFn: async ({ sessionId, payload }: { sessionId: string; payload: PayBillPayload }): Promise<BillRead> => {
      const r = obj(await api.post<unknown>(`/api/v1/table-sessions/${sessionId}/bill/pay`, payload)) ?? {};
      return { id: str(r.id), amount: str(r.amount) };
    },
    onSettled: invalidate,
  });
}

/** `POST /close {}` → `{settled}` (the tab-close shape; no time charge here). */
export function useCloseTab() {
  const invalidate = useInvalidateBills();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (sessionId: string) => {
      const r = obj(await api.post<unknown>(`/api/v1/table-sessions/${sessionId}/close`, {})) ?? {};
      return { settled: r.settled === true };
    },
    onSettled: () => { invalidate(); void qc.invalidateQueries({ queryKey: ['bar-orders'] }); },
  });
}
