import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

export interface CashPayout {
  id: string;
  cash_session_id: string;
  amount: string | number;
  payout_type: 'PAYOUT' | 'PETTY_CASH' | 'WITHDRAWAL';
  description: string;
  created_by_id: string;
  created_at: string;
}

export interface CashSession {
  id: string;
  store_id: string;
  session_date: string;
  opening_balance: string | number;
  closing_balance: string | number | null;
  status: 'OPEN' | 'CLOSED';
  opened_by_id: string;
  closed_by_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  payouts: CashPayout[];
}

const KEY = ['cash-today'] as const;

export function useTodayCashSession() {
  return useQuery<CashSession | null>({
    queryKey: KEY,
    queryFn: () => api.get<CashSession | null>('/api/v1/cash/sessions/today'),
  });
}

export function useOpenCashSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { session_date: string; opening_balance: number; notes?: string }) =>
      api.post<CashSession>('/api/v1/cash/sessions', payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useCloseCashSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, ...payload }: { sessionId: string; closing_balance: number; notes?: string }) =>
      api.post<CashSession>(`/api/v1/cash/sessions/${sessionId}/close`, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useAddPayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, ...payload }: { sessionId: string; amount: number; payout_type: string; description: string }) =>
      api.post<CashSession>(`/api/v1/cash/sessions/${sessionId}/payouts`, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
