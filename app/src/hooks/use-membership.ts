import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

// ── Enums (from api-handoff "Enums & Constants") ──────────────────────────────
export type EarnMode = 'PER_RECEIPT' | 'PER_BAHT' | 'PER_ITEM';
export type RewardType = 'DISCOUNT_FIXED' | 'DISCOUNT_PERCENT' | 'FREE_ITEM';
export type RewardScope = 'ALL' | 'CATEGORY' | 'SPECIFIC_PRODUCTS';
export type PointTxType = 'EARN' | 'REDEEM' | 'ADJUST' | 'EXPIRE';
export type MembershipTier = 'NONE' | 'BRONZE' | 'SILVER' | 'GOLD';

// ── Read DTOs (Decimal fields arrive as strings) ──────────────────────────────
export interface ProgramRead {
  id: string;
  store_id: string;
  is_active: boolean;
  earn_mode: EarnMode;
  baht_per_point: string | null;
  points_to_redeem: number;
  reward_type: RewardType;
  reward_value: string | null;
  reward_scope: RewardScope;
  reward_category_id: string | null;
  min_order_baht: string | null;
  points_expire_after_days: number | null;
  tier_bronze_threshold: number | null;
  tier_silver_threshold: number | null;
  tier_gold_threshold: number | null;
  bronze_earn_multiplier: string;
  silver_earn_multiplier: string;
  gold_earn_multiplier: string;
  created_at: string;
  updated_at: string;
}

// Full upsert body — send all fields every time (decimals as numbers).
export interface ProgramWrite {
  is_active: boolean;
  earn_mode: EarnMode;
  baht_per_point: number | null;
  points_to_redeem: number;
  reward_type: RewardType;
  reward_value: number | null;
  reward_scope: RewardScope;
  reward_category_id: string | null;
  min_order_baht: number | null;
  points_expire_after_days: number | null;
  tier_bronze_threshold: number | null;
  tier_silver_threshold: number | null;
  tier_gold_threshold: number | null;
  bronze_earn_multiplier: number;
  silver_earn_multiplier: number;
  gold_earn_multiplier: number;
}

export interface RewardProductRead {
  id: string;
  name: string;
  price: string; // Decimal as string
}

export interface AccountRead {
  id: string; // MembershipAccount.id — use this as member_id in orders
  customer_id: string;
  customer_name: string;
  phone: string | null;
  points_balance: number;
  lifetime_points_earned: number;
  tier: MembershipTier;
  date_of_birth: string | null; // ISO date YYYY-MM-DD
  joined_at: string;
}

export interface LookupResponse {
  found: boolean;
  account: AccountRead | null;
  program: {
    points_to_redeem: number;
    reward_type: RewardType;
    reward_scope: RewardScope;
    reward_category_name: string | null;
  } | null;
  reward_redeemable: boolean;
  points_to_next_reward: number | null;
  eligible_reward_products: RewardProductRead[];
}

export interface PointTransactionRead {
  id: string;
  type: PointTxType;
  delta: number; // negative for REDEEM / EXPIRE / down-ADJUST
  balance_after: number;
  order_id: string | null;
  note: string | null;
  created_at: string;
}

export interface MemberRead extends AccountRead {
  recent_transactions: PointTransactionRead[]; // last 20
}

export interface MembersPage {
  items: AccountRead[];
  total: number;
  page: number;
  limit: number;
}

// ── Query keys ────────────────────────────────────────────────────────────────
const PROGRAM_KEY = ['membership', 'program'] as const;
const REWARD_PRODUCTS_KEY = ['membership', 'reward-products'] as const;
const MEMBERS_KEY = ['membership', 'members'] as const;

// ── Owner programme config ─────────────────────────────────────────────────────
/** GET /program — returns `null` (HTTP 200) when no programme is configured. */
export function useMembershipProgram() {
  return useQuery<ProgramRead | null>({
    queryKey: PROGRAM_KEY,
    queryFn: () => api.get<ProgramRead | null>('/api/v1/membership/program'),
  });
}

export function useSaveMembershipProgram() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: ProgramWrite) =>
      api.put<ProgramRead>('/api/v1/membership/program', payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: PROGRAM_KEY }),
  });
}

/** Only relevant when reward_scope = SPECIFIC_PRODUCTS. */
export function useRewardProducts(enabled: boolean) {
  return useQuery<RewardProductRead[]>({
    queryKey: REWARD_PRODUCTS_KEY,
    queryFn: () => api.get<RewardProductRead[]>('/api/v1/membership/program/reward-products'),
    enabled,
  });
}

export function useSaveRewardProducts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (product_ids: string[]) =>
      api.put<RewardProductRead[]>('/api/v1/membership/program/reward-products', { product_ids }),
    onSuccess: () => qc.invalidateQueries({ queryKey: REWARD_PRODUCTS_KEY }),
  });
}

// ── Checkout (lookup / register) ────────────────────────────────────────────────
/** POST /lookup — never 404s; `{ found: false }` is the not-found state. */
export function useLookupMember() {
  return useMutation({
    mutationFn: (phone: string) =>
      api.post<LookupResponse>('/api/v1/membership/lookup', { phone }),
  });
}

export interface RegisterPayload {
  name: string;
  phone: string;
  date_of_birth?: string; // optional — for birthday bonus
}

export function useRegisterMember() {
  return useMutation({
    // 409 when the phone is already a member (surfaced via ApiError.message).
    mutationFn: (payload: RegisterPayload) =>
      api.post<AccountRead>('/api/v1/membership/register', payload),
  });
}

// ── Member management (MANAGER / OWNER) ──────────────────────────────────────────
export interface MembersQuery {
  name?: string;
  phone?: string;
  page?: number;
  limit?: number;
}

export function useMembers(query: MembersQuery) {
  return useQuery<MembersPage>({
    queryKey: [...MEMBERS_KEY, query],
    queryFn: () => {
      const params = new URLSearchParams();
      if (query.name) params.set('name', query.name);
      if (query.phone) params.set('phone', query.phone);
      params.set('page', String(query.page ?? 1));
      params.set('limit', String(query.limit ?? 50));
      return api.get<MembersPage>(`/api/v1/membership/members?${params}`);
    },
  });
}

export function useMemberDetail(accountId: string | null) {
  return useQuery<MemberRead>({
    queryKey: [...MEMBERS_KEY, 'detail', accountId],
    queryFn: () => api.get<MemberRead>(`/api/v1/membership/members/${accountId}`),
    enabled: !!accountId,
  });
}

export function useAdjustPoints() {
  const qc = useQueryClient();
  return useMutation({
    // 422 INSUFFICIENT_POINTS when the adjustment would push balance below 0.
    mutationFn: ({ accountId, delta, note }: { accountId: string; delta: number; note: string }) =>
      api.post<MemberRead>(`/api/v1/membership/members/${accountId}/adjust`, { delta, note }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: MEMBERS_KEY });
      qc.invalidateQueries({ queryKey: [...MEMBERS_KEY, 'detail', vars.accountId] });
    },
  });
}
