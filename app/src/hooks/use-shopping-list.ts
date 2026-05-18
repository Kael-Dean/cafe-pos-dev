import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

// ── Backend shapes ────────────────────────────────────────────────────────────
interface ShoppingListItemRead {
  id: string;
  inventory_item_id: string;
  inventory_item_name: string;
  unit: string;
  note: string | null;
  added_by_id: string;
  created_at: string;
}

// ── Frontend shapes ───────────────────────────────────────────────────────────
export interface ShoppingListItem {
  id: string;
  inventoryItemId: string;
  inventoryItemName: string;
  unit: string;
  note: string | null;
  addedById: string;
  createdAt: string;
}

// ── Mapper ────────────────────────────────────────────────────────────────────
function mapItem(i: ShoppingListItemRead): ShoppingListItem {
  return {
    id: i.id,
    inventoryItemId: i.inventory_item_id,
    inventoryItemName: i.inventory_item_name,
    unit: i.unit,
    note: i.note,
    addedById: i.added_by_id,
    createdAt: i.created_at,
  };
}

// ── Hooks ─────────────────────────────────────────────────────────────────────
export function useShoppingList() {
  return useQuery<ShoppingListItem[]>({
    queryKey: ['shopping-list'],
    queryFn: async () => {
      const data = await api.get<ShoppingListItemRead[]>('/api/v1/shopping-list');
      return data.map(mapItem);
    },
  });
}

interface AddPayload {
  inventory_item_id: string;
  note?: string;
}

export function useAddToShoppingList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: AddPayload) =>
      api.post<ShoppingListItemRead>('/api/v1/shopping-list', p),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shopping-list'] });
      qc.invalidateQueries({ queryKey: ['pre-order-ingredients'] });
    },
  });
}

export function useRemoveFromShoppingList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) =>
      api.delete<void>(`/api/v1/shopping-list/${itemId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shopping-list'] });
      qc.invalidateQueries({ queryKey: ['pre-order-ingredients'] });
    },
  });
}
