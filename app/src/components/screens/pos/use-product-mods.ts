'use client';

import { useQuery, type QueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

/**
 * Which modifier groups a product has — the only thing the POS needs to decide
 * "add instantly" vs "open the modifier sheet". Fetched from the same
 * /products/{id} endpoint as useProductDetail, but cached under its own key
 * with a long staleTime and prefetched for the visible menu, so a tap on a
 * cached product adds the line with no network wait (spec §9: ≤100ms).
 */
export interface ProductMods {
  hasModifiers: boolean;
  groupIds: string[];
}

interface ProductModsRead { modifier_groups?: { id: string }[] | null }

const STALE = 10 * 60_000;
const GC = 30 * 60_000;

export const productModsKey = (id: string | null) => ['pos-product-mods', id] as const;

async function fetchProductMods(id: string): Promise<ProductMods> {
  const p = await api.get<ProductModsRead>(`/api/v1/products/${id}`);
  const groupIds = (p.modifier_groups ?? []).map((g) => g.id);
  return { hasModifiers: groupIds.length > 0, groupIds };
}

export function useProductMods(id: string | null) {
  return useQuery({
    queryKey: productModsKey(id),
    queryFn: () => fetchProductMods(id as string),
    enabled: !!id,
    staleTime: STALE,
    gcTime: GC,
  });
}

/** Cached value (even if stale), or undefined. */
export function peekProductMods(qc: QueryClient, id: string): ProductMods | undefined {
  return qc.getQueryData<ProductMods>(productModsKey(id));
}

export function loadProductMods(qc: QueryClient, id: string): Promise<ProductMods> {
  return qc.fetchQuery({ queryKey: productModsKey(id), queryFn: () => fetchProductMods(id), staleTime: STALE, gcTime: GC });
}

/** Warm the cache for a list of products, a few requests at a time. */
export async function prefetchProductMods(qc: QueryClient, ids: string[], signal: { cancelled: boolean }, concurrency = 4): Promise<void> {
  const todo = ids.filter((id) => {
    const state = qc.getQueryState(productModsKey(id));
    return !state?.data || (Date.now() - state.dataUpdatedAt > STALE);
  });
  let next = 0;
  const worker = async () => {
    while (!signal.cancelled && next < todo.length) {
      const id = todo[next++];
      try { await qc.prefetchQuery({ queryKey: productModsKey(id), queryFn: () => fetchProductMods(id), staleTime: STALE, gcTime: GC }); }
      catch { /* a miss just means that tap waits for the network */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
}
