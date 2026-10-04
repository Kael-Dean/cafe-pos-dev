'use client';

/**
 * POS cart — one persisted store per DEVICE (owner decision: the bill belongs to
 * the till, not to the cashier). It survives screen switches (page.tsx remounts
 * screens with key={screen}), a page refresh, a PWA restart and a cashier
 * lock/switch. It is cleared only by a successful payment, a void, or "next order".
 *
 * Bills are partitioned by store id (`scope`) so a device that logs into another
 * branch never shows the first branch's open bill.
 *
 * Hydration is manual (`skipHydration`): the POS calls `rehydrateCart()` on mount
 * so the server render and the first client render agree.
 */

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { MemberInfo } from '@/components/screens/membership-modal';

export interface CartLine {
  /** Identity: product + modifier set + note. Adding the same triple merges qty. */
  key: string;
  menuId: string;
  name: string;
  basePrice: number;
  unitPrice: number;
  qty: number;
  /** Human labels printed under the line ("ขนาด L", "+ เพิ่มช็อต"). */
  mods: string[];
  /** Server modifier ids sent with the order. */
  modIds: string[];
  /** Stable signature of the selected modifiers (group:option;…). */
  modKey: string;
  /** Free-text kitchen note for this line ("" = none). */
  note: string;
  /** Last time this line was added to / bumped — drives the 160ms highlight. */
  touchedAt: number;
}

export type NewCartLine = Omit<CartLine, 'key' | 'touchedAt'>;

export type ManualDiscountKind = 'amount' | 'percent';

export interface ManualDiscount {
  kind: ManualDiscountKind;
  /** Baht when kind = amount, 0–100 when kind = percent. */
  value: number;
  /** Server-verified approver (manager PIN), null when under the threshold. */
  approvedBy: { id: string; name: string } | null;
}

export interface Bill {
  lines: CartLine[];
  member: MemberInfo | null;
  promoIds: string[];
  manualDiscount: ManualDiscount | null;
}

export interface ParkedBill {
  id: string;
  parkedAt: number;
  bill: Bill;
}

interface ScopeState {
  bill: Bill;
  parked: ParkedBill[];
  /** Server daily number of the last completed order on this device (display only). */
  lastOrderNo: string | null;
}

export const EMPTY_BILL: Bill = Object.freeze({
  lines: [],
  member: null,
  promoIds: [],
  manualDiscount: null,
}) as Bill;

const EMPTY_SCOPE: ScopeState = Object.freeze({ bill: EMPTY_BILL, parked: [], lastOrderNo: null }) as ScopeState;
const EMPTY_PARKED: ParkedBill[] = [];

export const lineKeyOf = (l: Pick<CartLine, 'menuId' | 'modKey' | 'note'>) =>
  `${l.menuId}|${l.modKey}|${l.note.trim()}`;

/**
 * The cart is written to localStorage and outlives logout, so member PII
 * (phone, date of birth) must not be persisted — only what the POS needs to
 * keep showing the member and to build the order.
 */
const redactMember = (m: MemberInfo | null): MemberInfo | null =>
  m ? { ...m, account: { ...m.account, phone: null, date_of_birth: null } } : null;

const redactBill = (b: Bill): Bill => (b.member ? { ...b, member: redactMember(b.member) } : b);

const redactScopes = (byScope: Record<string, ScopeState>): Record<string, ScopeState> =>
  Object.fromEntries(
    Object.entries(byScope).map(([k, s]) => [
      k,
      { ...s, bill: redactBill(s.bill), parked: s.parked.map((p) => ({ ...p, bill: redactBill(p.bill) })) },
    ]),
  );

interface CartStore {
  scope: string;
  byScope: Record<string, ScopeState>;

  setScope: (scope: string) => void;
  /** Adds (or merges into) a line. Returns the key of the line that changed. */
  addLine: (line: NewCartLine) => string;
  setQty: (key: string, qty: number) => void;
  /** Removes a line and returns it with its index (for undo). */
  removeLine: (key: string) => { line: CartLine; index: number } | null;
  /** Puts a removed line back at its old position (undo). */
  insertLine: (line: CartLine, index: number) => void;
  /** Replaces a line after an edit. Merges into an existing line if the new identity collides. Returns the resulting key. */
  replaceLine: (key: string, next: NewCartLine) => string;
  setMember: (member: MemberInfo | null | ((m: MemberInfo | null) => MemberInfo | null)) => void;
  setPromoIds: (ids: string[] | ((ids: string[]) => string[])) => void;
  setManualDiscount: (d: ManualDiscount | null) => void;
  clearBill: () => void;
  /** Restores a whole bill (failed table-tab save, resume parked). */
  restoreBill: (bill: Bill) => void;
  /** Parks the current bill. Returns false when the cart is empty. */
  park: () => boolean;
  /** Resumes a parked bill; a non-empty current bill is parked in its place. */
  resume: (id: string) => void;
  dropParked: (id: string) => void;
  setLastOrderNo: (no: string | null) => void;
}

function newId(): string {
  try { return crypto.randomUUID(); } catch { return `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
}

export const useCartStore = create<CartStore>()(
  persist(
    (set, get) => {
      const cur = (): ScopeState => get().byScope[get().scope] ?? EMPTY_SCOPE;
      const patch = (fn: (s: ScopeState) => Partial<ScopeState>) =>
        set((st) => {
          const prev = st.byScope[st.scope] ?? EMPTY_SCOPE;
          return { byScope: { ...st.byScope, [st.scope]: { ...prev, ...fn(prev) } } };
        });
      const patchBill = (fn: (b: Bill) => Partial<Bill>) => patch((s) => ({ bill: { ...s.bill, ...fn(s.bill) } }));

      return {
        scope: 'default',
        byScope: {},

        setScope: (scope) => { if (scope && scope !== get().scope) set({ scope }); },

        addLine: (line) => {
          const key = lineKeyOf(line);
          const now = Date.now();
          patchBill((b) => {
            const idx = b.lines.findIndex((l) => l.key === key);
            if (idx >= 0) {
              const lines = [...b.lines];
              lines[idx] = { ...lines[idx], qty: lines[idx].qty + line.qty, touchedAt: now };
              return { lines };
            }
            return { lines: [...b.lines, { ...line, note: line.note.trim(), key, touchedAt: now }] };
          });
          return key;
        },

        setQty: (key, qty) => patchBill((b) => {
          const q = Math.max(0, Math.floor(qty));
          if (q === 0) return { lines: b.lines.filter((l) => l.key !== key) };
          return { lines: b.lines.map((l) => (l.key === key ? { ...l, qty: q, touchedAt: Date.now() } : l)) };
        }),

        removeLine: (key) => {
          const lines = cur().bill.lines;
          const index = lines.findIndex((l) => l.key === key);
          if (index < 0) return null;
          const line = lines[index];
          patchBill((b) => ({ lines: b.lines.filter((l) => l.key !== key) }));
          return { line, index };
        },

        insertLine: (line, index) => patchBill((b) => {
          const existing = b.lines.findIndex((l) => l.key === line.key);
          if (existing >= 0) {
            const lines = [...b.lines];
            lines[existing] = { ...lines[existing], qty: lines[existing].qty + line.qty };
            return { lines };
          }
          const lines = [...b.lines];
          lines.splice(Math.min(Math.max(0, index), lines.length), 0, line);
          return { lines };
        }),

        replaceLine: (key, next) => {
          const nextKey = lineKeyOf(next);
          patchBill((b) => {
            const at = b.lines.findIndex((l) => l.key === key);
            if (at < 0) return {};
            const updated: CartLine = { ...next, note: next.note.trim(), key: nextKey, touchedAt: Date.now() };
            if (next.qty <= 0) return { lines: b.lines.filter((l) => l.key !== key) };
            const collide = nextKey !== key ? b.lines.findIndex((l) => l.key === nextKey) : -1;
            if (collide >= 0) {
              const lines = b.lines
                .map((l, i) => (i === collide ? { ...l, qty: l.qty + updated.qty, touchedAt: updated.touchedAt } : l))
                .filter((l) => l.key !== key);
              return { lines };
            }
            const lines = [...b.lines];
            lines[at] = updated;
            return { lines };
          });
          return nextKey;
        },

        setMember: (member) => patchBill((b) => ({
          member: typeof member === 'function' ? member(b.member) : member,
        })),

        setPromoIds: (ids) => patchBill((b) => ({
          promoIds: typeof ids === 'function' ? ids(b.promoIds) : ids,
        })),

        setManualDiscount: (d) => patchBill(() => ({ manualDiscount: d })),

        clearBill: () => patch(() => ({ bill: EMPTY_BILL })),

        restoreBill: (bill) => patch(() => ({ bill })),

        park: () => {
          const { bill } = cur();
          if (bill.lines.length === 0) return false;
          patch((s) => ({ bill: EMPTY_BILL, parked: [...s.parked, { id: newId(), parkedAt: Date.now(), bill }] }));
          return true;
        },

        resume: (id) => patch((s) => {
          const target = s.parked.find((p) => p.id === id);
          if (!target) return {};
          const rest = s.parked.filter((p) => p.id !== id);
          const parked = s.bill.lines.length > 0
            ? [...rest, { id: newId(), parkedAt: Date.now(), bill: s.bill }]
            : rest;
          return { bill: target.bill, parked };
        }),

        dropParked: (id) => patch((s) => ({ parked: s.parked.filter((p) => p.id !== id) })),

        setLastOrderNo: (no) => patch(() => ({ lastOrderNo: no })),
      };
    },
    {
      name: 'pos-cart-v1',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ scope: s.scope, byScope: redactScopes(s.byScope) }),
      skipHydration: true,
    },
  ),
);

/** Call once on the client (POS mount). Safe to call repeatedly. */
export function rehydrateCart(): void {
  if (useCartStore.persist.hasHydrated()) return;
  void useCartStore.persist.rehydrate();
}

// ── Selectors (stable references for zustand v5) ────────────────────────────
export const useBill = (): Bill => useCartStore((s) => s.byScope[s.scope]?.bill ?? EMPTY_BILL);
export const useParkedBills = (): ParkedBill[] => useCartStore((s) => s.byScope[s.scope]?.parked ?? EMPTY_PARKED);
export const useLastOrderNo = (): string | null => useCartStore((s) => s.byScope[s.scope]?.lastOrderNo ?? null);
