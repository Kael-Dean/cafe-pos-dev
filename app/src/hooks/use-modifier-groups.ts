import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

// ── Backend shapes (exact field names from schemas/catalog.py) ────────────────
export interface ModifierRead {
  id: string;
  name: string;
  price_delta: string | number;  // Decimal serialised as string by FastAPI
  inventory_item_id: string | null;
  inventory_qty: string | null;
  sort_order: number;
  is_active: boolean;
}

interface ModifierGroupRead {
  id: string;
  store_id: string;
  name: string;
  required: boolean;       // NOT is_required
  min_select: number;
  max_select: number | null; // null = unlimited; 1 = radio; >1 = check
  is_active: boolean;
  modifiers: ModifierRead[];
}

// ── Frontend shapes (what modifier-modal.tsx expects) ─────────────────────────
export interface ModifierOption {
  id: string;
  label: string;
  diff: number;
  default?: boolean;
}

export interface ModifierGroup {
  id: string;
  label: string;
  required: boolean;
  type: 'radio' | 'check';
  options: ModifierOption[];
}

function mapGroup(g: ModifierGroupRead): ModifierGroup {
  // max_select === 1 → single-select (radio); otherwise multi-select (check)
  const isRadio = g.max_select === 1;

  const sorted = g.modifiers
    .filter(m => m.is_active)
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order);

  return {
    id: g.id,
    label: g.name,
    required: g.required,
    type: isRadio ? 'radio' : 'check',
    options: sorted.map((m, idx) => ({
      id: m.id,
      label: m.name,
      diff: Number(m.price_delta),
      // No is_default in backend — first option defaults for radio groups
      ...(isRadio && idx === 0 ? { default: true } : {}),
    })),
  };
}

export function useModifierGroups() {
  return useQuery<ModifierGroup[]>({
    queryKey: ['modifier-groups'],
    queryFn: async () => {
      const data = await api.get<ModifierGroupRead[]>('/api/v1/modifier-groups');
      return data
        .filter(g => g.is_active)
        .map(mapGroup);
    },
  });
}

// Default groups auto-created the first time a "เครื่องดื่ม" product is saved
export const DEFAULT_DRINK_MODIFIER_GROUPS = [
  {
    name: 'ขนาด', required: true, min_select: 1, max_select: 1, is_active: true,
    modifiers: [
      { name: 'S', price_delta: -5, sort_order: 1, is_active: true },
      { name: 'M', price_delta: 0,  sort_order: 2, is_active: true },
      { name: 'L', price_delta: 10, sort_order: 3, is_active: true },
    ],
  },
  {
    name: 'ความหวาน', required: false, min_select: 0, max_select: 1, is_active: true,
    modifiers: [
      { name: 'ไม่หวาน', price_delta: 0, sort_order: 1, is_active: true },
      { name: 'น้อย',    price_delta: 0, sort_order: 2, is_active: true },
      { name: 'ปกติ',    price_delta: 0, sort_order: 3, is_active: true },
      { name: 'มาก',     price_delta: 0, sort_order: 4, is_active: true },
    ],
  },
];

export function useCreateModifierGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (group: typeof DEFAULT_DRINK_MODIFIER_GROUPS[number]) =>
      api.post<ModifierGroupRead>('/api/v1/modifier-groups', group),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['modifier-groups'] });
    },
  });
}

// ── Individual modifier CRUD ───────────────────────────────────────────────────

interface AddModifierPayload {
  name: string;
  price_delta: string;
  inventory_item_id?: string | null;
  inventory_qty?: string | null;
  sort_order?: number;
}

interface UpdateModifierPayload {
  name?: string;
  price_delta?: string;
  is_active?: boolean;
  sort_order?: number;
  inventory_item_id?: string | null;
  inventory_qty?: string | null;
}

export function useAddModifier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ groupId, ...payload }: { groupId: string } & AddModifierPayload) =>
      api.post<ModifierRead>(`/api/v1/modifier-groups/${groupId}/modifiers`, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['modifier-groups'] }),
  });
}

export function useUpdateModifier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ groupId, modifierId, ...payload }: { groupId: string; modifierId: string } & UpdateModifierPayload) =>
      api.patch<ModifierRead>(`/api/v1/modifier-groups/${groupId}/modifiers/${modifierId}`, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['modifier-groups'] }),
  });
}

export function useDeleteModifier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ groupId, modifierId }: { groupId: string; modifierId: string }) =>
      api.delete<void>(`/api/v1/modifier-groups/${groupId}/modifiers/${modifierId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['modifier-groups'] }),
  });
}
