'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/admin-api';
import { TENANTS_KEY, tenantKey } from './use-tenants';

export interface StoreRead {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;                 // globally unique across ALL clients
  is_active: boolean;
  suspended_at: string | null;
  /** Derived from the tenant's package. Read-only — there is no endpoint to set it. */
  features: string[];
}

export interface StoreCreatedResponse extends StoreRead {
  /** 6 digits, returned ONCE and never retrievable again. Only its hash is stored. */
  owner_pin: string;
}

export interface StoreCreatePayload {
  name: string;
  slug: string;
  owner_name: string;
  vat_enabled: boolean;
}

/** Prefix for every tenant's store list — invalidate this to drop them all. */
export const STORES_ROOT = ['stores'] as const;
export const STORES_KEY = (tenantId: string) => ['stores', tenantId] as const;

/**
 * A client's branches, including suspended ones. This is the only place store
 * IDs appear after creation, so it has to load before any per-store action.
 */
export function useStores(tenantId: string) {
  return useQuery<StoreRead[]>({
    queryKey: STORES_KEY(tenantId),
    queryFn: () => api.get<StoreRead[]>(`/api/v1/admin/tenants/${tenantId}/stores`),
    enabled: Boolean(tenantId),
  });
}

function useStoreWriteBack(tenantId: string) {
  const qc = useQueryClient();
  return (store: StoreRead) => {
    qc.setQueryData<StoreRead[]>(STORES_KEY(tenantId), (cur) =>
      cur ? cur.map((s) => (s.id === store.id ? store : s)) : cur,
    );
    // store_count on the tenant counts ACTIVE stores, so suspending or resuming
    // one branch changes it.
    qc.invalidateQueries({ queryKey: tenantKey(tenantId) });
    qc.invalidateQueries({ queryKey: TENANTS_KEY });
  };
}

/**
 * Create a branch and seed its OWNER user. The response carries `owner_pin`
 * exactly once — the caller must show it and never persist it.
 */
export function useCreateStore(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: StoreCreatePayload) =>
      api.post<StoreCreatedResponse>(`/api/v1/admin/tenants/${tenantId}/stores`, payload),
    onSuccess: () => {
      // Deliberately refetch rather than pushing the response into the cache:
      // that object carries owner_pin, which must never enter the query cache.
      qc.invalidateQueries({ queryKey: STORES_KEY(tenantId) });
      qc.invalidateQueries({ queryKey: tenantKey(tenantId) });
      qc.invalidateQueries({ queryKey: TENANTS_KEY });
    },
  });
}

/** Suspend one branch without touching its siblings. Reason required. */
export function useSuspendStore(tenantId: string) {
  const writeBack = useStoreWriteBack(tenantId);
  return useMutation({
    mutationFn: ({ storeId, reason }: { storeId: string; reason: string }) =>
      api.post<StoreRead>(`/api/v1/admin/stores/${storeId}/suspend`, { reason }),
    onSuccess: writeBack,
  });
}

/**
 * Restore one branch. Fails with 409 while the tenant itself is suspended —
 * the UI disables the button in that state so the error is rare.
 */
export function useResumeStore(tenantId: string) {
  const writeBack = useStoreWriteBack(tenantId);
  return useMutation({
    mutationFn: ({ storeId, reason }: { storeId: string; reason: string }) =>
      api.post<StoreRead>(`/api/v1/admin/stores/${storeId}/resume`, reason ? { reason } : {}),
    onSuccess: writeBack,
  });
}
