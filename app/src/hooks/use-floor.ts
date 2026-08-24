import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

// ── Backend shapes ────────────────────────────────────────────────────────────
interface FloorTableRead {
  id: string;
  name: string;
  zone: string | null;
  capacity: number;
  is_active: boolean;
}

// ── Frontend shapes ───────────────────────────────────────────────────────────
export interface FloorTable {
  id: string;
  name: string;
  zone: string | null;
  capacity: number;
  isActive: boolean;
}

function mapTable(t: FloorTableRead): FloorTable {
  return {
    id: t.id,
    name: t.name,
    zone: t.zone,
    capacity: t.capacity,
    isActive: t.is_active,
  };
}

// ── Read ──────────────────────────────────────────────────────────────────────
/** Tables ordered by zone then name. Gated by `vertical.boardgame` — 404 when off. */
export function useFloorTables(includeInactive = false, enabled = true) {
  return useQuery<FloorTable[]>({
    queryKey: ['floor-tables', includeInactive],
    queryFn: async () => {
      const data = await api.get<FloorTableRead[]>(
        `/api/v1/floor/tables?include_inactive=${includeInactive ? 'true' : 'false'}`,
      );
      return data.map(mapTable);
    },
    enabled,
  });
}

// ── Mutations (MANAGER / OWNER) ───────────────────────────────────────────────
export interface CreateTablePayload {
  name: string;
  zone?: string | null;
  capacity?: number;
}

export interface UpdateTablePayload {
  name?: string;
  zone?: string | null;
  capacity?: number;
}

export function useCreateTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateTablePayload) =>
      api.post<FloorTableRead>('/api/v1/floor/tables', payload).then(mapTable),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['floor-tables'] }); },
  });
}

export function useUpdateTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateTablePayload }) =>
      api.patch<FloorTableRead>(`/api/v1/floor/tables/${id}`, data).then(mapTable),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['floor-tables'] }); },
  });
}

/** Soft delete — history is kept. 409 when the table still has an open session. */
export function useDeleteTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/v1/floor/tables/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['floor-tables'] }); },
  });
}
