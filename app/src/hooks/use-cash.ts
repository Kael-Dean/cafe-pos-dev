import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

// Shape from GET /hr/cash-sessions/current and /hr/cash-sessions/{id}
export interface CashSession {
  id: string;
  store_id: string;
  opened_by_id: string;
  closed_by_id: string | null;
  cash_open: string;         // Decimal string, 2dp — opening float
  cash_close: string | null; // null until session is closed
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

export function useCloseCashSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, ...payload }: { sessionId: string; cash_close: number; notes?: string }) =>
      api.patch<CashSession>(`/api/v1/hr/cash-sessions/${sessionId}/close`, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
