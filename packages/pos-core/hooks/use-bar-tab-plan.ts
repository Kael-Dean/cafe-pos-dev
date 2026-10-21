import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@pos/core/lib/api-client';

/**
 * Core-level minimum of the rate-plan API for `self_ordering` stores on the café
 * edition (which ships no rate-plan screen). A guest join answers 409 until the
 * store has a DEFAULT plan, and mr.bar charges no time, so the only thing such a
 * store needs is one ฿0 "Bar tab" default plan (handoff Part C).
 *
 * The board-game edition has the full editor (apps/boardgame/src/tables); this
 * hook keeps its own cache key under the same ['rate-plans'] prefix so either
 * side's invalidation refreshes both.
 */

interface RatePlanLite {
  id: string;
  name: string;
  hourly_rate: string;
  is_default: boolean;
  is_active: boolean;
}

/** mr.bar's default, verbatim from the handoff. */
export const BAR_TAB_PLAN = {
  name: 'Bar tab',
  billing_mode: 'PER_TABLE_HOUR',
  hourly_rate: '0',
  grace_minutes: 0,
  min_charge_minutes: 0,
  is_default: true,
} as const;

export function useDefaultRatePlan(enabled = true) {
  return useQuery<{ plans: RatePlanLite[]; defaultPlan: RatePlanLite | null }>({
    queryKey: ['rate-plans', 'core-lite'],
    queryFn: async () => {
      const plans = await api.get<RatePlanLite[]>('/api/v1/rate-plans');
      return { plans, defaultPlan: plans.find((p) => p.is_default && p.is_active !== false) ?? null };
    },
    enabled,
  });
}

export function useCreateBarTabPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<RatePlanLite>('/api/v1/rate-plans', BAR_TAB_PLAN),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['rate-plans'] }); },
  });
}

/** "0", "0.00", "0.0" → true. String test: money is never parsed for arithmetic. */
export const isZeroMoney = (s: string | null | undefined) => !!s && /^0+(\.0+)?$/.test(s.trim());
