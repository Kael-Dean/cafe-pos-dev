import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@pos/core/lib/api-client';
import type { CostSource } from './use-inventory';

// ── Backend shapes (schemas/catalog.py) ───────────────────────────────────────
interface RecipeItemRead {
  id: string;
  inventory_item_id: string;
  quantity: string | number;   // Decimal
  cost_per_unit: string | number; // Decimal — cost of the lot currently being consumed
  // Enrichment — present on GET /products/{id}, but NOT on the PUT recipe response
  // (that one returns schema defaults). Always re-read the detail after a save.
  inventory_item_name?: string;
  unit?: string;
  stock_on_hand?: string | number;
  in_use_lot_id?: string | null;   // null = FIFO
  cost_source?: CostSource;
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
  servings_per_batch: number;
  recipe: RecipeItemRead[];
  modifier_groups: ModifierGroupSummary[];
  estimated_unit_cost?: string | number; // Decimal — per-unit ingredient cost (COMPONENT/PRODUCED)
  // Present on the duplicate response (ProductDetail in duplicate-product/api-handoff.md).
  product_type?: 'MADE_TO_ORDER' | 'PRODUCED' | 'COMPONENT';
  finished_goods_item_id?: string | null;
}

// ── Frontend shapes ───────────────────────────────────────────────────────────
export interface RecipeItem {
  invId: string;
  qty: number;
  costPerUnit?: number;   // populated from the API; absent on locally-added rows
  inUseLotId?: string | null;
  costSource?: CostSource;
}

export interface ProductDetail {
  id: string;
  name: string;
  nameEn: string;
  price: number;
  servingsPerBatch: number;
  hasModifiers: boolean;
  modifierGroupIds: string[];
  recipe: RecipeItem[];
  estimatedUnitCost: number;  // backend-computed per-unit ingredient cost
}

function mapDetail(p: ProductDetailRead): ProductDetail {
  const groups = p.modifier_groups ?? [];
  return {
    id: p.id,
    name: p.name,
    nameEn: p.name,
    price: Number(p.price),
    servingsPerBatch: p.servings_per_batch ?? 1,
    hasModifiers: groups.length > 0,
    modifierGroupIds: groups.map(g => g.id),
    recipe: (p.recipe ?? []).map(r => ({
      invId: r.inventory_item_id,
      qty: Number(r.quantity),   // "quantity" in backend, "qty" in frontend
      costPerUnit: Number(r.cost_per_unit ?? 0),
      inUseLotId: r.in_use_lot_id ?? null,
      costSource: r.cost_source,
    })),
    estimatedUnitCost: Number(p.estimated_unit_cost ?? 0),
  };
}

// ── Hooks ─────────────────────────────────────────────────────────────────────
/** Query key + fetcher for one product's detail — shared by useProductDetail and
 *  the POS, which prefetches / reads it imperatively (queryClient) for instant adds. */
export const productDetailQuery = (productId: string) => ({
  queryKey: ['product-detail', productId] as const,
  queryFn: async (): Promise<ProductDetail> => {
    const data = await api.get<ProductDetailRead>(`/api/v1/products/${productId}`);
    return mapDetail(data);
  },
});

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

/**
 * POST /api/v1/products/{id}/duplicate — server-side atomic clone (handoff
 * duplicate-product/api-handoff.md): all fields, recipe items, modifier-group links and
 * cooking steps; name "Copy of {original}" (≤ 120 chars); is_active copied; a PRODUCED
 * clone gets its own finished-goods inventory item. MANAGER / OWNER only (BARISTA 403);
 * unknown or other-store id 404. Not idempotent — N calls make N copies.
 */
export function useDuplicateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (productId: string) =>
      api.post<ProductDetailRead>(`/api/v1/products/${encodeURIComponent(productId)}/duplicate`, undefined),
    onSuccess: (created) => {
      // The response is the full ProductDetail — seed the editor's cache so opening the
      // copy needs no extra round trip, then refresh every product list.
      qc.setQueryData(['product-detail', created.id], mapDetail(created));
      qc.invalidateQueries({ queryKey: ['products'] });
      // A PRODUCED clone adds a finished-goods inventory item.
      if (created.product_type === 'PRODUCED' || created.finished_goods_item_id) {
        qc.invalidateQueries({ queryKey: ['inventory'] });
      }
    },
  });
}
