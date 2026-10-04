import type { MenuItem } from '@/hooks/use-products';
import type { ProgramRead } from '@/hooks/use-membership';
import type { MemberInfo } from '../membership-modal';
import type { ManualDiscount } from '@/stores/cart-store';

export interface POSTableSession {
  sessionId: string;
  tableName: string;
}

export type PayMethod = 'cash' | 'card' | 'qr' | 'line';

export const PAY_METHOD_API: Record<PayMethod, 'CASH' | 'CARD' | 'QR_PROMPTPAY' | 'LINE_PAY'> = {
  cash: 'CASH', card: 'CARD', qr: 'QR_PROMPTPAY', line: 'LINE_PAY',
};

/** Menu density: compact text tiles (default ≥1024, owner decision) or photo cards. */
export type Density = 'compact' | 'photo';

/** Owner decision: a manual bill discount above EITHER limit needs a manager PIN. */
export const MANUAL_DISCOUNT_PIN_PERCENT = 10;
export const MANUAL_DISCOUNT_PIN_BAHT = 50;

/**
 * The order API (CreateOrderRequest) has no manual-discount field yet, so a
 * manual discount cannot reach the server and would make the charged total
 * differ from the recorded one. The UI is built and gated behind this flag; turn
 * it on (NEXT_PUBLIC_POS_MANUAL_DISCOUNT=1) only once the backend accepts
 * `manual_discount` + `discount_approved_by` on POST /orders.
 */
export const MANUAL_DISCOUNT_ENABLED = process.env.NEXT_PUBLIC_POS_MANUAL_DISCOUNT === '1';

/** Cashier-facing ESTIMATE only — the server is authoritative for the final discount. */
export function estimateMemberDiscount(member: MemberInfo | null, program: ProgramRead | null | undefined, subtotal: number): number {
  if (!member?.redeemReward) return 0;
  const rt = member.program?.reward_type;
  if (rt === 'FREE_ITEM') return Math.min(member.rewardProduct ? Math.round(Number(member.rewardProduct.price)) : 0, subtotal);
  const rv = Number(program?.reward_value ?? 0);
  if (rt === 'DISCOUNT_FIXED') return Math.min(Math.round(rv), subtotal);
  if (rt === 'DISCOUNT_PERCENT') return Math.min(Math.round((subtotal * rv) / 100), subtotal);
  return 0;
}

/** Baht value of a manual discount against the amount it applies to. */
export function manualDiscountAmount(d: Pick<ManualDiscount, 'kind' | 'value'> | null, base: number): number {
  if (!d || !(d.value > 0) || base <= 0) return 0;
  const raw = d.kind === 'percent' ? (base * Math.min(100, d.value)) / 100 : d.value;
  return Math.min(base, Math.round(raw));
}

/** Does this manual discount need a manager PIN? (>10% of the bill OR >฿50) */
export function needsManagerPin(amount: number, base: number): boolean {
  if (amount <= 0) return false;
  if (amount > MANUAL_DISCOUNT_PIN_BAHT) return true;
  return base > 0 && (amount / base) * 100 > MANUAL_DISCOUNT_PIN_PERCENT;
}

/** Products the cashier may sell from the POS. */
export function isSellable(m: MenuItem, tableTimeName: string): boolean {
  // COMPONENT = in-house ingredient (never sold) · table time = system product
  // the backend bills itself when a table closes.
  return m.productType !== 'COMPONENT' && m.name !== tableTimeName;
}
