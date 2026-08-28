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
  billing_address: string | null;
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

/**
 * PATCH body. Every field is optional and the two absences mean different
 * things: an omitted key leaves the value alone, an explicit `null` clears it.
 * `slug` is immutable and `package_key` moves via PUT .../package — sending
 * either here is a 422.
 */
export interface TenantUpdatePayload {
  name?: string;                    // 1..120, never null
  legal_name?: string | null;
  tax_id?: string | null;
  billing_email?: string | null;
  billing_address?: string | null;
}

/** The five editable fields as the form holds them — all strings, '' = empty. */
export interface TenantUpdateFields {
  name: string;
  legal_name: string;
  tax_id: string;
  billing_email: string;
  billing_address: string;
}

/**
 * Diff the form against the loaded tenant so the request carries only what
 * actually changed — which is also what keeps the audit row honest, since the
 * backend records before/after for the submitted keys only.
 */
export function toTenantUpdatePayload(v: TenantUpdateFields, cur: TenantRead): TenantUpdatePayload {
  const out: TenantUpdatePayload = {};

  const name = v.name.trim();
  if (name !== cur.name) out.name = name;

  const optional = (
    key: 'legal_name' | 'tax_id' | 'billing_email' | 'billing_address',
    next: string,
  ) => {
    const trimmed = next.trim();
    const value = trimmed.length > 0 ? trimmed : null;
    // `?? null` matters: an older deploy omits billing_address entirely, and an
    // untouched empty field must stay omitted rather than send a pointless null.
    if (value !== (cur[key] ?? null)) out[key] = value;
  };

  optional('legal_name', v.legal_name);
  optional('tax_id', v.tax_id);
  optional('billing_email', v.billing_email);
  optional('billing_address', v.billing_address);

  return out;
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
 * Correct a tenant's legal/billing details. Billing fields don't feed
 * entitlements, so unlike the package mutations this deliberately does NOT
 * invalidate the store list.
 */
export function useUpdateTenant(tenantId: string) {
  const writeBack = useTenantWriteBack();
  return useMutation({
    mutationFn: (payload: TenantUpdatePayload) =>
      api.patch<TenantRead>(`/api/v1/admin/tenants/${tenantId}`, payload),
    onSuccess: writeBack,
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
