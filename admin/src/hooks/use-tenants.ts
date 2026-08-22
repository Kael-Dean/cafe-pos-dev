'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/admin-api';
import { STORES_KEY } from './use-stores';

export interface TenantRead {
  id: string;
  name: string;
  slug: string;
  legal_name: string | null;
  tax_id: string | null;
  billing_email: string | null;
  package_key: string | null;   // null = no package = no features
  is_active: boolean;           // false = switched to read-only
  suspended_at: string | null;
  suspension_reason: string | null;
  /** ACTIVE stores only — a client with a suspended branch reports fewer. */
  store_count: number;
}

export interface TenantCreatePayload {
  name: string;
  slug: string;
  legal_name?: string;
  tax_id?: string;
  billing_email?: string;
  billing_address?: string;
}

export const TENANTS_KEY = ['tenants'] as const;
export const tenantKey = (id: string) => ['tenants', id] as const;

/** Every client company. No pagination or server-side search — the list is small. */
export function useTenants() {
  return useQuery<TenantRead[]>({
    queryKey: TENANTS_KEY,
    queryFn: () => api.get<TenantRead[]>('/api/v1/admin/tenants'),
  });
}

export function useTenant(id: string) {
  return useQuery<TenantRead>({
    queryKey: tenantKey(id),
    queryFn: () => api.get<TenantRead>(`/api/v1/admin/tenants/${id}`),
    enabled: Boolean(id),
  });
}

/**
 * Write the server's response into both the detail cache and the row inside the
 * list. Every mutating endpoint returns the full updated object, so this is the
 * new truth — no refetch needed, and no optimistic guess to roll back.
 */
function useTenantWriteBack() {
  const qc = useQueryClient();
  return (tenant: TenantRead) => {
    qc.setQueryData(tenantKey(tenant.id), tenant);
    qc.setQueryData<TenantRead[]>(TENANTS_KEY, (cur) =>
      cur ? cur.map((t) => (t.id === tenant.id ? tenant : t)) : cur,
    );
  };
}

export function useCreateTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: TenantCreatePayload) => api.post<TenantRead>('/api/v1/admin/tenants', payload),
    onSuccess: (tenant) => {
      qc.setQueryData(tenantKey(tenant.id), tenant);
      qc.invalidateQueries({ queryKey: TENANTS_KEY });
    },
  });
}

/**
 * Assign, change, or clear a package. Applies to ALL of the tenant's stores at
 * once — there is no per-store package — so every store's derived `features`
 * changes with it.
 */
export function useAssignPackage(tenantId: string) {
  const qc = useQueryClient();
  const writeBack = useTenantWriteBack();
  return useMutation({
    mutationFn: (packageKey: string | null) =>
      api.put<TenantRead>(`/api/v1/admin/tenants/${tenantId}/package`, { package_key: packageKey }),
    onSuccess: (tenant) => {
      writeBack(tenant);
      // Entitlements were re-derived for every store — refetch them.
      qc.invalidateQueries({ queryKey: STORES_KEY(tenantId) });
    },
  });
}

/** Switch a client to read-only. Cascades to every store. Reason is required. */
export function useSuspendTenant(tenantId: string) {
  const qc = useQueryClient();
  const writeBack = useTenantWriteBack();
  return useMutation({
    mutationFn: (reason: string) =>
      api.post<TenantRead>(`/api/v1/admin/tenants/${tenantId}/suspend`, { reason }),
    onSuccess: (tenant) => {
      writeBack(tenant);
      qc.invalidateQueries({ queryKey: STORES_KEY(tenantId) });
    },
  });
}

/**
 * Restore a suspended client. Only reactivates the stores that THIS suspension
 * froze — a branch suspended separately stays suspended — so the store list has
 * to be refetched rather than assumed all-active.
 */
export function useResumeTenant(tenantId: string) {
  const qc = useQueryClient();
  const writeBack = useTenantWriteBack();
  return useMutation({
    mutationFn: (reason: string) =>
      api.post<TenantRead>(`/api/v1/admin/tenants/${tenantId}/resume`, reason ? { reason } : {}),
    onSuccess: (tenant) => {
      writeBack(tenant);
      qc.invalidateQueries({ queryKey: STORES_KEY(tenantId) });
    },
  });
}
