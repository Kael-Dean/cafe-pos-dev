import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

// ── Backend shapes (schemas/catalog.py) ───────────────────────────────────────
interface RecipeItemRead {
  id: string;
  inventory_item_id: string;
  quantity: string | number;   // Decimal
}

interface ModifierGroupSummary {
  id: string;
  name: string;
  required: boolean;
  min_select: number;
  max_select: number | null;
}

interface ProductDetailRead {
  id: string;
  store_id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  price: string | number;
  is_active: boolean;
  recipe: RecipeItemRead[];
  modifier_groups: ModifierGroupSummary[];
}

// ── Frontend shapes ───────────────────────────────────────────────────────────
export interface RecipeItem {
  invId: string;
  qty: number;
}

export interface ProductDetail {
  id: string;
  name: string;
  nameEn: string;
  price: number;
  hasModifiers: boolean;
  modifierGroupIds: string[];
  recipe: RecipeItem[];
}

function mapDetail(p: ProductDetailRead): ProductDetail {
  const groups = p.modifier_groups ?? [];
  return {
    id: p.id,
    name: p.name,
    nameEn: p.name,
    price: Number(p.price),
    hasModifiers: groups.length > 0,
    modifierGroupIds: groups.map(g => g.id),
    recipe: (p.recipe ?? []).map(r => ({
      invId: r.inventory_item_id,
      qty: Number(r.quantity),   // "quantity" in backend, "qty" in frontend
    })),
  };
}

// ── Hooks ─────────────────────────────────────────────────────────────────────
export function useProductDetail(productId: string | null) {
  return useQuery<ProductDetail>({
    queryKey: ['product-detail', productId],
    queryFn: async () => {
      const data = await api.get<ProductDetailRead>(`/api/v1/products/${productId}`);
      return mapDetail(data);
    },
    enabled: !!productId,
  });
}

interface UpdateRecipePayload {
  productId: string;
  items: RecipeItem[];
}

export function useUpdateRecipe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ productId, items }: UpdateRecipePayload) =>
      api.put(`/api/v1/products/${productId}/recipe`, {
        // Backend expects RecipeBulkReplace: { items: [{ inventory_item_id, quantity }] }
        items: items.map(r => ({
          inventory_item_id: r.invId,
          quantity: r.qty,           // "quantity" not "qty"
        })),
      }),
    onSuccess: (_data, { productId }) => {
      qc.invalidateQueries({ queryKey: ['product-detail', productId] });
    },
  });
}

export function useLinkModifierGroups() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ productId, groupIds }: { productId: string; groupIds: string[] }) =>
      api.put<void>(`/api/v1/products/${productId}/modifier-groups`, {
        modifier_group_ids: groupIds,
      }),
    onSuccess: (_data, { productId }) => {
      qc.invalidateQueries({ queryKey: ['product-detail', productId] });
    },
  });
}
