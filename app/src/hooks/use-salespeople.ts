import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

// SalespersonRead from the backend (api/v1/salespeople). Salespeople are
// store-scoped and seeded server-side (the API exposes a list only, no create),
// so this list is read-only — the UI just picks one to attach to a customer.
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
