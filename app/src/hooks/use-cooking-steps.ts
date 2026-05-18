import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

export interface CookingStepRead {
  id: string;
  sort_order: number;
  instruction: string;
}

interface CookingStepCreate {
  instruction: string;
  sort_order?: number | null;
}

export function useCookingSteps(productId: string | null) {
  return useQuery<CookingStepRead[]>({
    queryKey: ['cooking-steps', productId],
    queryFn: () => api.get<CookingStepRead[]>(`/api/v1/products/${productId}/steps`),
    enabled: !!productId,
  });
}

export function useReplaceCookingSteps() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ productId, steps }: { productId: string; steps: CookingStepCreate[] }) =>
      api.put<CookingStepRead[]>(`/api/v1/products/${productId}/steps`, { steps }),
    onSuccess: (_, { productId }) => {
      qc.invalidateQueries({ queryKey: ['cooking-steps', productId] });
    },
  });
}

export function useDeleteCookingStep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ productId, stepId }: { productId: string; stepId: string }) =>
      api.delete<void>(`/api/v1/products/${productId}/steps/${stepId}`),
    onSuccess: (_, { productId }) => {
      qc.invalidateQueries({ queryKey: ['cooking-steps', productId] });
    },
  });
}
