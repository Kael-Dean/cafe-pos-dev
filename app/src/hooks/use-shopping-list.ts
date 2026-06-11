import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

// ── Backend shapes ────────────────────────────────────────────────────────────
interface ShoppingListItemRead {
  id: string;
  inventory_item_id: string;
  inventory_item_name: string;
  unit: string;
  // Decimals are serialized as JSON strings — parse before arithmetic.
  suggested_qty: string;       // computed amount still to buy: max(0, pending demand − stock_on_hand)
  quantity: string | null;     // user override; null = use the suggestion
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
  suggestedQty: number;        // parsed suggested_qty
  quantity: number | null;     // parsed override; null = follow the suggestion
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
    suggestedQty: Number(i.suggested_qty ?? 0),
    quantity: i.quantity == null ? null : Number(i.quantity),
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
  quantity?: string;   // optional override at add time (decimal string)
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

/** Set a manual buy-amount override, or pass `null` to revert to the live suggestion. */
export function usePatchShoppingListItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, quantity }: { itemId: string; quantity: number | null }) =>
      api.patch<ShoppingListItemRead>(`/api/v1/shopping-list/${itemId}`, {
        quantity: quantity == null ? null : String(quantity),
      }),
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
