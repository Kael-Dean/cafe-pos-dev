import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

// ── Enums ─────────────────────────────────────────────────────────────────────
export type BillingMode = 'PER_HEAD_HOUR' | 'PER_TABLE_HOUR';

// ── Backend shape ─────────────────────────────────────────────────────────────
export interface RatePlanRead {
  id: string;
  name: string;
  billing_mode: BillingMode;
  hourly_rate: string;              // decimal string — never parsed for arithmetic
  grace_minutes: number;
  rounding_increment_minutes: number;
  min_charge_minutes: number;
  daily_cap_amount: string | null;  // null = no cap
  max_open_minutes: number;
  is_default: boolean;
  is_active: boolean;
}

// ── Frontend shape ────────────────────────────────────────────────────────────
export interface RatePlan {
  id: string;
  name: string;
  billingMode: BillingMode;
  hourlyRate: string;
  graceMinutes: number;
  roundingIncrementMinutes: number;
  minChargeMinutes: number;
  dailyCapAmount: string | null;
  maxOpenMinutes: number;
  isDefault: boolean;
  isActive: boolean;
}

export function mapRatePlan(p: RatePlanRead): RatePlan {
  return {
    id: p.id,
    name: p.name,
    billingMode: p.billing_mode,
    hourlyRate: p.hourly_rate,
    graceMinutes: p.grace_minutes,
    roundingIncrementMinutes: p.rounding_increment_minutes,
    minChargeMinutes: p.min_charge_minutes,
    dailyCapAmount: p.daily_cap_amount,
    maxOpenMinutes: p.max_open_minutes,
    isDefault: p.is_default,
    isActive: p.is_active,
  };
}

// ── Read ──────────────────────────────────────────────────────────────────────
/** Active plans, default first. */
export function useRatePlans(enabled = true) {
  return useQuery<RatePlan[]>({
    queryKey: ['rate-plans'],
    queryFn: async () => {
      const data = await api.get<RatePlanRead[]>('/api/v1/rate-plans');
      return data.map(mapRatePlan);
    },
    enabled,
  });
}

// ── Mutations (MANAGER / OWNER) ───────────────────────────────────────────────
export interface CreateRatePlanPayload {
  name: string;
  billing_mode: BillingMode;
  hourly_rate: string;
  grace_minutes?: number;
  rounding_increment_minutes?: number;
  min_charge_minutes?: number;
  daily_cap_amount?: string | null;
  max_open_minutes?: number;
  is_default?: boolean;
}

/** `billing_mode` is intentionally absent — it cannot change after creation. */
export interface UpdateRatePlanPayload {
  name?: string;
  hourly_rate?: string;
  grace_minutes?: number;
  rounding_increment_minutes?: number;
  min_charge_minutes?: number;
  daily_cap_amount?: string | null;
  max_open_minutes?: number;
  is_default?: boolean;
  is_active?: boolean;
}

export function useCreateRatePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateRatePlanPayload) =>
      api.post<RatePlanRead>('/api/v1/rate-plans', payload).then(mapRatePlan),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rate-plans'] }); },
  });
}

/**
 * Edits never touch sessions that are already open — each session froze a
 * `rate_snapshot` of the plan when it opened.
 */
export function useUpdateRatePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateRatePlanPayload }) =>
      api.patch<RatePlanRead>(`/api/v1/rate-plans/${id}`, data).then(mapRatePlan),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rate-plans'] }); },
  });
}
