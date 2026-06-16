import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

// SalespersonRead from the backend (api/v1/salespeople). Salespeople are
// store-scoped. The list endpoint returns ACTIVE salespeople only (soft-deleted
// ones drop off), ordered by name. Managers/owners can create, rename,
// (de)activate, and soft-delete via the mutations below.
export interface Salesperson {
  id: string;
  name: string;
  is_active: boolean;
}

/** GET /api/v1/salespeople — active salespeople for the current store. */
export function useSalespeople() {
  return useQuery<Salesperson[]>({
    queryKey: ['salespeople'],
    queryFn: () => api.get<Salesperson[]>('/api/v1/salespeople'),
  });
}

/** POST /api/v1/salespeople — add a salesperson (manager/owner only). */
export function useCreateSalesperson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.post<Salesperson>('/api/v1/salespeople', { name }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['salespeople'] }); },
  });
}

/** PATCH /api/v1/salespeople/{id} — rename and/or (de)activate a salesperson. */
export function useUpdateSalesperson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: { id: string; name?: string; is_active?: boolean }) =>
      api.patch<Salesperson>(`/api/v1/salespeople/${id}`, payload),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['salespeople'] }); },
  });
}

/** DELETE /api/v1/salespeople/{id} — soft-delete (assigned customers keep the link). */
export function useDeleteSalesperson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/v1/salespeople/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['salespeople'] }); },
  });
}

/** PATCH /api/v1/customers/{id}/sales — assign a salesperson to the customer
 *  (pass null to clear), then refresh the customer detail so the assigned
 *  name shown in the member modal updates immediately. */
export function useAssignSales(customerId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (salesId: string | null) =>
      api.patch(`/api/v1/customers/${customerId}/sales`, { sales_id: salesId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers', 'detail', customerId] });
    },
  });
}
