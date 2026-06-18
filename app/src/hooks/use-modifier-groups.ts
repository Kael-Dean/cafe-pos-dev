import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

// ── Backend shapes (exact field names from schemas/catalog.py) ────────────────
export interface ModifierRead {
  id: string;
  name: string;
  price_delta: string | number;  // Decimal serialised as string by FastAPI
  sort_order: number;
  is_active: boolean;
  // NOTE: inventory_item_id / inventory_qty were removed — the single global
  // per-modifier deduction is retired. All modifier ingredient deductions now
  // go through the per-product recipe-items endpoints (see below).
}

export interface ModifierGroupRead {
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

// Keywords that mark the "normal / full" option in a single-select group when
// the labels aren't percentages (e.g. ความหวาน → ปกติ).
const NORMAL_OPTION_KEYWORDS = ['ปกติ', 'ธรรมดา', 'เต็ม', 'normal', 'standard', 'regular', 'full'];

/**
 * Pick which option in a radio group should start selected. The backend has no
 * is_default flag and options are free text, so we infer it:
 *   1. If EVERY label is percentage-like (`50`, `100`, `25%`) → the highest %
 *      (so a sweetness/strength filter opens at 100%, not the first chip).
 *   2. Else the first label containing a "normal/full" keyword (ปกติ, normal…).
 *   3. Else the first option (unchanged behaviour for groups like ขนาด S/M/L).
 */
function pickDefaultIndex(labels: string[]): number {
  const pcts = labels.map((l) => {
    const m = l.trim().match(/^(\d+)\s*%?$/);
    return m ? Number(m[1]) : null;
  });
  if (pcts.length > 0 && pcts.every((p) => p !== null)) {
    let best = 0;
    pcts.forEach((p, i) => { if ((p as number) > (pcts[best] as number)) best = i; });
    return best;
  }
  const ki = labels.findIndex((l) => {
    const low = l.trim().toLowerCase();
    return NORMAL_OPTION_KEYWORDS.some((k) => low.includes(k));
  });
  return ki >= 0 ? ki : 0;
}

function mapGroup(g: ModifierGroupRead): ModifierGroup {
  // max_select === 1 → single-select (radio); otherwise multi-select (check)
  const isRadio = g.max_select === 1;

  const sorted = g.modifiers
    .filter(m => m.is_active)
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order);

  // For radio groups, infer the default option from the labels (see helper);
  // check groups start with nothing selected so no default applies.
  const defaultIdx = isRadio ? pickDefaultIndex(sorted.map(m => m.name)) : -1;

  return {
    id: g.id,
    label: g.name,
    required: g.required,
    type: isRadio ? 'radio' : 'check',
    options: sorted.map((m, idx) => ({
      id: m.id,
      label: m.name,
      diff: Number(m.price_delta),
      ...(idx === defaultIdx ? { default: true } : {}),
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

// Raw groups for the menu builder, where editing needs the full modifier shape
// (price_delta, inventory link, sort_order) that the POS-facing mapGroup drops.
// Shares the ['modifier-groups'] key prefix so the existing add/update/delete
// mutations invalidate it too.
export function useModifierGroupsAdmin() {
  return useQuery<ModifierGroupRead[]>({
    queryKey: ['modifier-groups', 'admin'],
    queryFn: async () => {
      const data = await api.get<ModifierGroupRead[]>('/api/v1/modifier-groups');
      return data
        .filter(g => g.is_active)
        .map(g => ({
          ...g,
          modifiers: g.modifiers
            .filter(m => m.is_active)
            .slice()
            .sort((a, b) => a.sort_order - b.sort_order),
        }));
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
  sort_order?: number;
}

interface UpdateModifierPayload {
  name?: string;
  price_delta?: string;
  is_active?: boolean;
  sort_order?: number;
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

// ── Modifier recipe items (multi-ingredient override/delta) ────────────────────
// A modifier can rewrite the product's base recipe at checkout:
//   override → replaces the base quantity for that ingredient (0 = skip it)
//   delta    → adds/subtracts to the base quantity (can introduce a new one)
// Deductions are PER MENU — keyed on (product_id, modifier_id, inventory_item_id),
// so the same shared modifier can deduct different ingredients/amounts on
// different products. Endpoints live under /products/{product_id}/modifiers/...
// (they moved out from under /modifier-groups/...). Fetch per-product+modifier.

export type ModifierRecipeMode = 'override' | 'delta';

export interface ModifierRecipeItemRead {
  id?: string;
  inventory_item_id: string;
  quantity: string | number;
  mode: ModifierRecipeMode;
}

export interface ModifierRecipeItemInput {
  inventory_item_id: string;
  quantity: string;
  mode: ModifierRecipeMode;
}

export function useModifierRecipeItems(productId: string, modifierId: string, enabled: boolean) {
  return useQuery<ModifierRecipeItemRead[]>({
    queryKey: ['modifier-recipe-items', productId, modifierId],
    queryFn: () =>
      api.get<ModifierRecipeItemRead[]>(
        `/api/v1/products/${productId}/modifiers/${modifierId}/recipe-items`,
      ),
    enabled,
  });
}

// Full bulk-replace: send the complete desired set every call; [] clears all.
export function useReplaceModifierRecipeItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ productId, modifierId, items }: { productId: string; modifierId: string; items: ModifierRecipeItemInput[] }) =>
      api.put<ModifierRecipeItemRead[]>(
        `/api/v1/products/${productId}/modifiers/${modifierId}/recipe-items`,
        { items },
      ),
    onSuccess: (_data, { productId, modifierId }) =>
      qc.invalidateQueries({ queryKey: ['modifier-recipe-items', productId, modifierId] }),
  });
}
