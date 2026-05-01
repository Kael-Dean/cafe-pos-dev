import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

// ── Backend shapes (exact field names from schemas/catalog.py) ────────────────
interface ModifierRead {
  id: string;
  name: string;
  price_delta: string | number;  // Decimal serialised as string by FastAPI
  inventory_item_id: string | null;
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
