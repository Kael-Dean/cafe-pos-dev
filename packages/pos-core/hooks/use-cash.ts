import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@pos/core/lib/api-client';
import type {
  CashSessionClosePayload, PaymentGroupConfig, SessionPaymentEntryRead, SessionSummaryRead,
} from '@pos/core/lib/cash-reconciliation';

// Shape from GET /hr/cash-sessions/current and /hr/cash-sessions/{id}
export interface CashSession {
  id: string;
  store_id: string;
  opened_by_id: string;
  closed_by_id: string | null;
  cash_open: string;         // Decimal string, 2dp — opening float
  cash_close: string | null; // legacy single-number close; always null for the per-group flow
  opened_at: string;         // ISO 8601
  closed_at: string | null;  // null until session is closed
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const KEY = ['cash-current'] as const;

// Returns current open session or null if none is open (HTTP 200, body null)
export function useCurrentCashSession() {
  return useQuery<CashSession | null>({
    queryKey: KEY,
    queryFn: () => api.get<CashSession | null>('/api/v1/hr/cash-sessions/current'),
    // Do not cache — stale state causes UX issues (handoff note)
    staleTime: 0,
  });
}

export function useCashSessionHistory() {
  return useQuery<CashSession[]>({
    queryKey: ['cash-history'],
    queryFn: () => api.get<CashSession[]>('/api/v1/hr/cash-sessions'),
  });
}

export function useOpenCashSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { cash_open: number; notes?: string }) =>
      api.post<CashSession>('/api/v1/hr/cash-sessions', payload),
    // Always confirm server response before updating state (handoff note)
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/**
 * Close with per-payment-group reconciliation (handoff session-reconciliation) —
 * replaces the old single `cash_close` number. One entry per configured group, matched
 * by exact name. Not idempotent: a second close is 409; a group mismatch is 422.
 */
export function useCloseCashSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, payload }: { sessionId: string; payload: CashSessionClosePayload }) =>
      api.patch<CashSessionDetail>(`/api/v1/hr/cash-sessions/${sessionId}/close`, payload),
    // Wait for the 200 before showing "closed" (no optimistic UI — 409 / 422 are possible).
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ['cash-history'] });
    },
  });
}

/** Close response: the session plus the stored entries (only present on this response). */
export interface CashSessionDetail extends CashSession {
  entries: SessionPaymentEntryRead[];
}

// ── Payment groups (GET any user · PATCH manager/owner) ─────────────────────

export const PAYMENT_GROUPS_KEY = ['payment-groups'] as const;

/** The store's payment groups, or the backend's 2-bucket default. Fetched fresh before a close. */
export function usePaymentGroups(opts: { enabled?: boolean } = {}) {
  return useQuery<PaymentGroupConfig[]>({
    queryKey: PAYMENT_GROUPS_KEY,
    queryFn: () => api.get<PaymentGroupConfig[]>('/api/v1/hr/payment-groups'),
    staleTime: 0,
    enabled: opts.enabled ?? true,
  });
}

/** Replace the whole config. Every PaymentMethod in exactly one group, else 422. */
export function useUpdatePaymentGroups() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (groups: PaymentGroupConfig[]) => api.patch<PaymentGroupConfig[]>('/api/v1/hr/payment-groups', groups),
    onSuccess: (saved) => {
      qc.setQueryData(PAYMENT_GROUPS_KEY, saved);
      // Totals on an open session's close form are grouped by the config.
      qc.invalidateQueries({ queryKey: ['cash-summary'] });
    },
  });
}

/** System-computed totals per group for the session window (manager/owner). Safe to call repeatedly. */
export function useCashSessionSummary(sessionId: string | null | undefined) {
  return useQuery<SessionSummaryRead>({
    queryKey: ['cash-summary', sessionId],
    queryFn: () => api.get<SessionSummaryRead>(`/api/v1/hr/cash-sessions/${sessionId}/summary`),
    enabled: !!sessionId,
    staleTime: 0,
  });
}
