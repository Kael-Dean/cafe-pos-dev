import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

// ── Category types ────────────────────────────────────────────────────────────

export interface CategoryRead {
  id: string;
  store_id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ── Modifier types ────────────────────────────────────────────────────────────

export interface ModifierReadAdmin {
  id: string;
  name: string;
  price_delta: string;
  inventory_item_id: string | null;
  inventory_qty: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface ModifierGroupReadAdmin {
  id: string;
  store_id: string;
  name: string;
  required: boolean;
  min_select: number;
  max_select: number | null;
  is_active: boolean;
  modifiers: ModifierReadAdmin[];
}

// ── ModifierCreate payload (used in create + bulk-replace) ────────────────────

export interface ModifierCreatePayload {
  name: string;
  price_delta?: string;
  inventory_item_id?: string | null;
  inventory_qty?: string | null;
  sort_order?: number;
}

// ── Category hooks ─────────────────────────────────────────────────────────────

export function useCategoriesAdmin() {
  return useQuery<CategoryRead[]>({
    queryKey: ['categories', 'admin'],
    queryFn: async () => {
      const data = await api.get<CategoryRead[]>('/api/v1/categories');
      return data
        .filter(c => c.is_active)
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    },
  });
}

export function useCreateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { name: string; sort_order?: number }) =>
      api.post<CategoryRead>('/api/v1/categories', payload),
    // Invalidate the whole 'categories' prefix so both the admin list (['categories','admin'])
    // and the POS dropdown (['categories']) refetch — the latter now has a 5-min staleTime.
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }),
  });
}

export function useUpdateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: { id: string; name?: string; sort_order?: number }) =>
      api.patch<CategoryRead>(`/api/v1/categories/${id}`, payload),
    // Invalidate the whole 'categories' prefix so both the admin list (['categories','admin'])
    // and the POS dropdown (['categories']) refetch — the latter now has a 5-min staleTime.
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }),
  });
}

export function useDeleteCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/v1/categories/${id}`),
    // Invalidate the whole 'categories' prefix so both the admin list (['categories','admin'])
    // and the POS dropdown (['categories']) refetch — the latter now has a 5-min staleTime.
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }),
  });
}

// ── Modifier Group hooks ───────────────────────────────────────────────────────

export function useModifierGroupsAdmin() {
  return useQuery<ModifierGroupReadAdmin[]>({
    queryKey: ['modifier-groups', 'admin'],
    queryFn: () =>
      api.get<ModifierGroupReadAdmin[]>('/api/v1/modifier-groups?is_active=true'),
  });
}

interface ModifierGroupCreatePayload {
  name: string;
  required?: boolean;
  min_select?: number;
  max_select?: number | null;
  modifiers?: ModifierCreatePayload[];
}

interface ModifierGroupUpdatePayload {
  name?: string;
  required?: boolean;
  min_select?: number;
  max_select?: number | null;
  modifiers?: ModifierCreatePayload[];
}

export function useCreateModifierGroupAdmin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: ModifierGroupCreatePayload) =>
      api.post<ModifierGroupReadAdmin>('/api/v1/modifier-groups', payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['modifier-groups'] }),
  });
}

export function useUpdateModifierGroupAdmin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: { id: string } & ModifierGroupUpdatePayload) =>
      api.patch<ModifierGroupReadAdmin>(`/api/v1/modifier-groups/${id}`, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['modifier-groups'] }),
  });
}

export function useDeleteModifierGroupAdmin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/v1/modifier-groups/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['modifier-groups'] }),
  });
}
