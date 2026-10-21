/**
 * Checkout chaining for a table tab (handoff Part B "Checkout — exact sequence").
 *
 *   one person:  POST guests/{gid}/checkout → (optional PromptPay QR) → POST bill/pay {scope: GUEST}
 *   the rest:    POST bill/pay {scope: TABLE, force: true} → POST close → {settled: true}
 *
 * Paying a GUEST bill without the checkout step answers 409, so the reducer below
 * makes "pay" unreachable until checkout succeeded, and a failed payment goes back
 * to the checked-out state (no second checkout — the guest is already checked out).
 *
 * Pure: the screen dispatches events around its API calls.
 */

export type BillPayMethod = 'CASH' | 'QR_PROMPTPAY';

export type GuestPayState =
  | { kind: 'idle' }
  | { kind: 'checking-out' }
  /** Checked out on the server: `amount` is their exact bill. */
  | { kind: 'ready'; amount: string; showQr: boolean }
  | { kind: 'paying'; amount: string; method: BillPayMethod; showQr: boolean }
  | { kind: 'paid'; amount: string; method: BillPayMethod }
  /** `amount` is set when the failure happened AFTER checkout (retry skips it). */
  | { kind: 'failed'; message: string; amount: string | null };

export type GuestPayEvent =
  | { type: 'checkout' }
  | { type: 'checkout-ok'; amount: string }
  | { type: 'checkout-failed'; message: string }
  | { type: 'show-qr' }
  | { type: 'hide-qr' }
  | { type: 'pay'; method: BillPayMethod }
  | { type: 'pay-ok'; amount?: string }
  | { type: 'pay-failed'; message: string }
  | { type: 'retry' };

export const GUEST_PAY_IDLE: GuestPayState = { kind: 'idle' };

export function guestPayReducer(s: GuestPayState, e: GuestPayEvent): GuestPayState {
  switch (e.type) {
    case 'checkout':
      return s.kind === 'idle' ? { kind: 'checking-out' } : s;
    case 'checkout-ok':
      return s.kind === 'checking-out' ? { kind: 'ready', amount: e.amount, showQr: false } : s;
    case 'checkout-failed':
      return s.kind === 'checking-out' ? { kind: 'failed', message: e.message, amount: null } : s;
    case 'show-qr':
      return s.kind === 'ready' ? { ...s, showQr: true } : s;
    case 'hide-qr':
      return s.kind === 'ready' ? { ...s, showQr: false } : s;
    case 'pay':
      // The 409 guard: only a checked-out guest can be paid.
      return s.kind === 'ready' ? { kind: 'paying', amount: s.amount, method: e.method, showQr: s.showQr } : s;
    case 'pay-ok':
      return s.kind === 'paying' ? { kind: 'paid', amount: e.amount ?? s.amount, method: s.method } : s;
    case 'pay-failed':
      return s.kind === 'paying' ? { kind: 'failed', message: e.message, amount: s.amount } : s;
    case 'retry':
      if (s.kind !== 'failed') return s;
      return s.amount === null ? { kind: 'checking-out' } : { kind: 'ready', amount: s.amount, showQr: false };
  }
}

/** True when the next API call may be `bill/pay {scope: GUEST}`. */
export const canPayGuest = (s: GuestPayState): boolean => s.kind === 'ready';

/** True when the next API call must be `guests/{gid}/checkout`. */
export const needsCheckout = (s: GuestPayState): boolean => s.kind === 'checking-out';

// ── Rest of the table ─────────────────────────────────────────────────────────

export interface TableSettleDeps {
  /** POST bill/pay {scope: TABLE, payment_method, force: true}. */
  payTable: (method: BillPayMethod) => Promise<unknown>;
  /** POST close → `{settled}`. */
  close: () => Promise<{ settled: boolean }>;
}

export type TableSettleResult =
  | { ok: true; settled: boolean; paid: boolean }
  | { ok: false; stage: 'pay' | 'close'; error: unknown };

/** Money string → is there anything left to pay? (string compare, no float math). */
export function hasAmountDue(amount: string | null | undefined): boolean {
  if (!amount) return false;
  const t = amount.trim();
  return /[1-9]/.test(t.replace(/^-/, '')) && !t.startsWith('-');
}

/**
 * Pays whatever is left on the table (when anything is) and then closes. Paying
 * zero would be a pointless TABLE bill, so with nothing due it goes straight to
 * close. A failed pay never attempts close.
 */
export async function settleTable(deps: TableSettleDeps, remaining: string | null, method: BillPayMethod): Promise<TableSettleResult> {
  let paid = false;
  if (hasAmountDue(remaining)) {
    try {
      await deps.payTable(method);
      paid = true;
    } catch (error) {
      return { ok: false, stage: 'pay', error };
    }
  }
  try {
    const r = await deps.close();
    return { ok: true, settled: r.settled, paid };
  } catch (error) {
    return { ok: false, stage: 'close', error };
  }
}
