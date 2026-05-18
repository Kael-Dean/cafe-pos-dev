import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

export interface Promotion {
  id: string;
  store_id: string;
  name: string;
  description: string | null;
  discount_type: 'PERCENT' | 'FIXED';
  discount_value: string | number;
  min_order_amount: string | number;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean;
  created_by_id: string;
  created_at: string;
  updated_at: string;
}

const KEY = ['promotions'] as const;

export function usePromotions() {
  return useQuery<Promotion[]>({
    queryKey: KEY,
    queryFn: () => api.get<Promotion[]>('/api/v1/promotions'),
  });
}

export function useCreatePromotion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      name: string;
      description?: string;
      discount_type: string;
      discount_value: number;
      min_order_amount?: number;
      start_date?: string;
      end_date?: string;
    }) => api.post<Promotion>('/api/v1/promotions', payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdatePromotion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: Partial<Promotion> & { id: string }) =>
      api.patch<Promotion>(`/api/v1/promotions/${id}`, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeletePromotion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/v1/promotions/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
