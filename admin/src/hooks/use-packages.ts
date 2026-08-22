'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/admin-api';
import { STORES_ROOT } from './use-stores';

export interface PackageRead {
  key: string;                  // immutable primary key — there is no rename
  name_th: string;
  name_en: string;
  feature_keys: string[];
  /** Decimal as a STRING. Never parseFloat it — format the string. */
  price_monthly: string;
  price_annual: string;
  is_active: boolean;           // false = retired, cannot be newly assigned
}

export interface PackageCreatePayload {
  key: string;
  name_th: string;
  name_en: string;
  feature_keys: string[];
  price_monthly: string;
  price_annual: string;
}

export type PackageUpdatePayload = Partial<Omit<PackageCreatePayload, 'key'>> & { is_active?: boolean };

export const PACKAGES_KEY = ['packages'] as const;

/** All packages, active and retired, sorted by key. */
export function usePackages() {
  return useQuery<PackageRead[]>({
    queryKey: PACKAGES_KEY,
    queryFn: () => api.get<PackageRead[]>('/api/v1/admin/packages'),
  });
}

export function useCreatePackage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: PackageCreatePayload) => api.post<PackageRead>('/api/v1/admin/packages', payload),
    onSuccess: () => { qc.invalidateQueries({ queryKey: PACKAGES_KEY }); },
  });
}

/**
 * Edit names, prices, feature list, or the active flag.
 *
 * Editing `feature_keys` immediately re-derives entitlements for every tenant on
 * this package — it is a live change to paying customers, not a draft — so every
 * cached store list is dropped afterwards.
 */
export function useUpdatePackage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, payload }: { key: string; payload: PackageUpdatePayload }) =>
      api.patch<PackageRead>(`/api/v1/admin/packages/${key}`, payload),
    onSuccess: (pkg) => {
      qc.setQueryData<PackageRead[]>(PACKAGES_KEY, (cur) =>
        cur ? cur.map((p) => (p.key === pkg.key ? pkg : p)) : cur,
      );
      // Any store under this package may have different features now, and the
      // store lists are keyed per tenant — drop the whole 'stores' branch.
      qc.invalidateQueries({ queryKey: STORES_ROOT });
    },
  });
}
