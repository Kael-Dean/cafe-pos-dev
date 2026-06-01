import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

// ── Enums (from api-handoff "Enums & Constants") ──────────────────────────────
export type PromotionType = 'PERCENT_OFF' | 'COMBO_BUNDLE' | 'COMBO_QUANTITY' | 'HAPPY_HOUR';
export type PromotionScope = 'ORDER' | 'CATEGORY' | 'PRODUCT';

// ── Read DTO (decimals arrive as strings) ─────────────────────────────────────
export interface PromotionRead {
  id: string;
  store_id: string;
  name: string;                          // max 120 chars
  type: PromotionType;
  is_active: boolean;
  is_exclusive: boolean;                 // cannot stack with any other promo if true
  discount_pct: string | null;          // decimal string e.g. "15.00"
  scope: PromotionScope;
  product_ids_json: string[] | null;     // PERCENT_OFF/HAPPY_HOUR scope=PRODUCT, or COMBO_QUANTITY scope=PRODUCT
  category_id: string | null;            // scope=CATEGORY
  min_quantity: number | null;           // COMBO_QUANTITY
  bundle_product_ids_json: string[] | null; // COMBO_BUNDLE
  time_start: string | null;             // "HH:MM:SS" — HAPPY_HOUR only
  time_end: string | null;               // "HH:MM:SS" — HAPPY_HOUR only
  days_of_week_json: number[] | null;    // 0=Mon … 6=Sun — HAPPY_HOUR only
  valid_from: string | null;             // "YYYY-MM-DD"
  valid_until: string | null;            // "YYYY-MM-DD"
  created_at: string;
  updated_at: string;
}

// ── Write payloads ────────────────────────────────────────────────────────────
export interface PromotionCreate {
  name: string;
  type: PromotionType;
  is_exclusive?: boolean;
  discount_pct: number | string;         // > 0 and <= 100
  scope?: PromotionScope;                // defaults to ORDER server-side
  product_ids_json?: string[] | null;
  category_id?: string | null;
  min_quantity?: number | null;
  bundle_product_ids_json?: string[] | null;
  time_start?: string | null;            // "HH:MM" / "HH:MM:SS"
  time_end?: string | null;
  days_of_week_json?: number[] | null;
  valid_from?: string | null;
  valid_until?: string | null;
}

// All fields optional — send only what changes (e.g. { is_active: false } to toggle).
export type PromotionUpdate = Partial<Omit<PromotionCreate, 'type'>> & {
  is_active?: boolean;
};

export interface PromotionListResponse {
  items: PromotionRead[];
  total: number;
}

// ── Evaluate (checkout) ─────────────────────────────────────────────────────────
export interface EvaluateItem {
  product_id: string;
  quantity: number;
}

export interface EligiblePromotion {
  promotion_id: string;
  name: string;
  type: PromotionType;
  discount_amount: string;               // decimal string e.g. "45.00"
  is_exclusive: boolean;
}

export interface EvaluateResponse {
  eligible: EligiblePromotion[];
}

// ── Calculator baseline (Phase 1) ─────────────────────────────────────────────
export interface PromotionBaseline {
  product_id: string;
  sales_window_days: number;
  units_sold_in_window: string;          // decimal string
  avg_units_per_week: string;            // decimal string
}

// ── Query keys ────────────────────────────────────────────────────────────────
const KEY = ['promotions'] as const;

/** List promotions. `active` omitted = all, true = active only, false = inactive only (server-side filter). */
export function usePromotions(active?: boolean) {
  return useQuery<PromotionRead[]>({
    queryKey: [...KEY, { active: active ?? 'all' }],
    queryFn: async () => {
      const qs = active === undefined ? '' : `?active=${active}`;
      const data = await api.get<PromotionListResponse>(`/api/v1/promotions${qs}`);
      return data.items;
    },
  });
}

export function usePromotion(id: string | null) {
  return useQuery<PromotionRead>({
    queryKey: [...KEY, 'detail', id],
    queryFn: () => api.get<PromotionRead>(`/api/v1/promotions/${id}`),
    enabled: !!id,
  });
}

export function useCreatePromotion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: PromotionCreate) =>
      api.post<PromotionRead>('/api/v1/promotions', payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdatePromotion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: PromotionUpdate & { id: string }) =>
      api.patch<PromotionRead>(`/api/v1/promotions/${id}`, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeletePromotion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/v1/promotions/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** Evaluate the current cart for eligible promotions (any authenticated user). */
export function useEvaluatePromotions() {
  return useMutation({
    mutationFn: (items: EvaluateItem[]) =>
      api.post<EvaluateResponse>('/api/v1/promotions/evaluate', { items }),
  });
}

/** Sales baseline for the break-even calculator (MANAGER / OWNER). */
export function usePromotionBaseline(productId: string | null, days: number) {
  return useQuery<PromotionBaseline>({
    queryKey: [...KEY, 'baseline', productId, days],
    queryFn: () =>
      api.get<PromotionBaseline>(
        `/api/v1/promotions/calculator/baseline?product_id=${productId}&days=${days}`,
      ),
    enabled: !!productId,
  });
}
