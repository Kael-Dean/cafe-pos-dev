import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

// ── Backend shapes (schemas/production.py) ────────────────────────────────────
interface ProductionOrderRead {
  id: string;
  store_id: string;
  product_id: string;
  batches_count: number;
  units_produced: number;
  produced_by: string;
  produced_at: string;
  notes: string | null;
}

// ── Frontend shapes ───────────────────────────────────────────────────────────
export interface ProductionOrder {
  id: string;
  productId: string;
  batchesCount: number;
  unitsProduced: number;
  producedBy: string;
  producedAt: string;
  notes: string | null;
}

function mapOrder(o: ProductionOrderRead): ProductionOrder {
  return {
    id: o.id,
    productId: o.product_id,
    batchesCount: o.batches_count,
    unitsProduced: o.units_produced,
    producedBy: o.produced_by,
    producedAt: o.produced_at,
    notes: o.notes,
  };
}

export interface ProductionOrderFilters {
  productId?: string;
  from?: string; // YYYY-MM-DD
  to?: string;
}

export function useProductionOrders(filters: ProductionOrderFilters = {}) {
  return useQuery<ProductionOrder[]>({
    queryKey: ['production-orders', filters.productId ?? '', filters.from ?? '', filters.to ?? ''],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.productId) params.set('product_id', filters.productId);
      if (filters.from) params.set('from', filters.from);
      if (filters.to) params.set('to', filters.to);
      const qs = params.toString() ? `?${params}` : '';
      const data = await api.get<ProductionOrderRead[]>(`/api/v1/production-orders${qs}`);
      return data.map(mapOrder);
    },
  });
}

export function useProductionOrder(orderId: string | null) {
  return useQuery<ProductionOrder>({
    queryKey: ['production-order', orderId],
    queryFn: async () => {
      const data = await api.get<ProductionOrderRead>(`/api/v1/production-orders/${orderId}`);
      return mapOrder(data);
    },
    enabled: !!orderId,
  });
}

interface CreateProductionOrderPayload {
  product_id: string;
  batches_count: number;
  notes?: string | null;
}

export function useCreateProductionOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: CreateProductionOrderPayload) =>
      api.post<ProductionOrderRead>('/api/v1/production-orders', p),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['production-orders'] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
      qc.invalidateQueries({ queryKey: ['inventory-movements'] });
    },
  });
}
