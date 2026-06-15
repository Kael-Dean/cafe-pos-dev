import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

// CustomerRead from the backend (api/v1/customers). Only the fields the UI reads
// are typed here; `sales_name` is the resolved nickname of the assigned
// salesperson (เซลส์) — null when the customer has none.
export interface CustomerDetail {
  id: string;
  store_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  sales_id: string | null;
  sales_name: string | null;
}

/** GET /customers/{id} — used to surface the assigned salesperson for a member.
 *  Disabled until a customer id is known (e.g. before a member is attached). */
export function useCustomerDetail(customerId: string | null | undefined) {
  return useQuery<CustomerDetail>({
    queryKey: ['customers', 'detail', customerId],
    queryFn: () => api.get<CustomerDetail>(`/api/v1/customers/${customerId}`),
    enabled: !!customerId,
  });
}
