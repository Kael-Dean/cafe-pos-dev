import { beforeEach, describe, expect, it, vi } from 'vitest';

// The store persists through `localStorage`; node has none, so install an in-memory one
// BEFORE the store module is evaluated.
const mem = vi.hoisted(() => {
  const m = new Map<string, string>();
  // vi.hoisted runs before the (hoisted) imports below, so the store sees storage at creation.
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => m.clear(),
  };
  return m;
});

import { useCartStore, lineKeyOf, EMPTY_BILL, type NewCartLine } from './cart-store';

const latte: NewCartLine = {
  menuId: 'p-latte', name: 'ลาเต้', basePrice: 60, unitPrice: 60, qty: 1,
  mods: [], modIds: [], modKey: '', note: '',
};
const mocha: NewCartLine = { ...latte, menuId: 'p-mocha', name: 'มอคค่า', basePrice: 70, unitPrice: 70 };

const s = () => useCartStore.getState();
const bill = () => s().byScope[s().scope]?.bill ?? EMPTY_BILL;
const lines = () => bill().lines;

beforeEach(() => {
  mem.clear();
  useCartStore.setState({ scope: 'default', byScope: {} });
});

describe('addLine / merge identity', () => {
  it('adds a new line and returns its key', () => {
    const key = s().addLine(latte);
    expect(key).toBe(lineKeyOf(latte));
    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toMatchObject({ menuId: 'p-latte', qty: 1, key });
  });

  it('merges the same product + modifiers + note into one line (qty adds up)', () => {
    s().addLine(latte);
    s().addLine({ ...latte, qty: 2 });
    expect(lines()).toHaveLength(1);
    expect(lines()[0].qty).toBe(3);
  });

  it('keeps separate lines when the modifier set or note differs', () => {
    s().addLine(latte);
    s().addLine({ ...latte, modKey: 'size:L', modIds: ['m1'], mods: ['ขนาด L'] });
    s().addLine({ ...latte, note: 'หวานน้อย' });
    expect(lines()).toHaveLength(3);
  });

  it('treats a note that differs only by whitespace as the same line', () => {
    s().addLine({ ...latte, note: ' หวานน้อย ' });
    s().addLine({ ...latte, note: 'หวานน้อย' });
    expect(lines()).toHaveLength(1);
    expect(lines()[0].qty).toBe(2);
    expect(lines()[0].note).toBe('หวานน้อย');
  });
});

describe('setQty', () => {
  it('sets, floors fractional input and clamps negatives to removal', () => {
    const key = s().addLine(latte);
    s().setQty(key, 4.9);
    expect(lines()[0].qty).toBe(4);
    s().setQty(key, -3);
    expect(lines()).toHaveLength(0);
  });

  it('qty 0 removes the line; unknown key is a no-op', () => {
    const key = s().addLine(latte);
    s().setQty('nope', 9);
    expect(lines()[0].qty).toBe(1);
    s().setQty(key, 0);
    expect(lines()).toEqual([]);
  });
});

describe('removeLine / insertLine (undo)', () => {
  it('returns the removed line with its index and undo restores the position', () => {
    const a = s().addLine(latte);
    s().addLine(mocha);
    const c = s().addLine({ ...latte, menuId: 'p-tea', name: 'ชา' });
    const removed = s().removeLine(a);
    expect(removed?.index).toBe(0);
    expect(lines().map((l) => l.menuId)).toEqual(['p-mocha', 'p-tea']);
    s().insertLine(removed!.line, removed!.index);
    expect(lines().map((l) => l.menuId)).toEqual(['p-latte', 'p-mocha', 'p-tea']);
    expect(lines().find((l) => l.key === c)).toBeTruthy();
  });

  it('removeLine on an unknown key returns null and changes nothing', () => {
    s().addLine(latte);
    expect(s().removeLine('ghost')).toBeNull();
    expect(lines()).toHaveLength(1);
  });

  it('undo after the same product was re-added merges quantity instead of duplicating', () => {
    const key = s().addLine({ ...latte, qty: 2 });
    const removed = s().removeLine(key)!;
    s().addLine(latte); // cashier tapped the tile again before undoing
    s().insertLine(removed.line, removed.index);
    expect(lines()).toHaveLength(1);
    expect(lines()[0].qty).toBe(3);
  });

  it('clamps an out-of-range undo index', () => {
    s().addLine(latte);
    s().insertLine({ ...mocha, key: lineKeyOf(mocha), touchedAt: 0 }, 99);
    expect(lines().map((l) => l.menuId)).toEqual(['p-latte', 'p-mocha']);
  });
});

describe('replaceLine (edit modifiers)', () => {
  it('replaces in place and returns the new key', () => {
    const key = s().addLine(latte);
    const next = { ...latte, modKey: 'size:L', modIds: ['m1'], mods: ['ขนาด L'], unitPrice: 70 };
    const nk = s().replaceLine(key, next);
    expect(nk).toBe(lineKeyOf(next));
    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toMatchObject({ key: nk, unitPrice: 70 });
  });

  it('merges into an existing line when the new identity collides', () => {
    const plain = s().addLine(latte);
    const large = s().addLine({ ...latte, modKey: 'size:L', modIds: ['m1'], mods: ['L'], qty: 2 });
    s().replaceLine(large, { ...latte, qty: 2 }); // edit L back to plain
    expect(lines()).toHaveLength(1);
    expect(lines()[0].key).toBe(plain);
    expect(lines()[0].qty).toBe(3);
  });

  it('qty <= 0 removes; unknown key leaves the bill alone', () => {
    const key = s().addLine(latte);
    s().replaceLine('ghost', mocha);
    expect(lines()).toHaveLength(1);
    s().replaceLine(key, { ...latte, qty: 0 });
    expect(lines()).toHaveLength(0);
  });
});

describe('bill-level fields', () => {
  it('setPromoIds accepts a value or an updater', () => {
    s().setPromoIds(['a']);
    s().setPromoIds((p) => [...p, 'b']);
    expect(bill().promoIds).toEqual(['a', 'b']);
  });

  it('manual discount round-trips', () => {
    const d = { kind: 'percent' as const, value: 10, approvedBy: null };
    s().setManualDiscount(d);
    expect(bill().manualDiscount).toEqual(d);
    s().setManualDiscount(null);
    expect(bill().manualDiscount).toBeNull();
  });

  it('clearBill empties lines, promo and discount but keeps parked bills', () => {
    s().addLine(latte);
    s().setPromoIds(['a']);
    s().setManualDiscount({ kind: 'amount', value: 5, approvedBy: null });
    s().park();
    s().addLine(mocha);
    s().clearBill();
    expect(bill()).toEqual(EMPTY_BILL);
    expect(s().byScope.default.parked).toHaveLength(1);
  });

  it('never mutates the shared frozen EMPTY_BILL', () => {
    s().addLine(latte);
    s().clearBill();
    expect(EMPTY_BILL.lines).toHaveLength(0);
    expect(Object.isFrozen(EMPTY_BILL)).toBe(true);
  });

  it('setLastOrderNo is stored per scope', () => {
    s().setLastOrderNo('42');
    expect(s().byScope.default.lastOrderNo).toBe('42');
  });
});

describe('park / resume', () => {
  it('park returns false and parks nothing for an empty cart', () => {
    expect(s().park()).toBe(false);
    expect(s().byScope.default?.parked ?? []).toHaveLength(0);
  });

  it('park moves the bill aside and empties the cart', () => {
    s().addLine(latte);
    expect(s().park()).toBe(true);
    expect(lines()).toHaveLength(0);
    expect(s().byScope.default.parked).toHaveLength(1);
    expect(s().byScope.default.parked[0].bill.lines[0].menuId).toBe('p-latte');
  });

  it('resume into an empty cart restores the bill and drops it from the parked list', () => {
    s().addLine(latte);
    s().park();
    const id = s().byScope.default.parked[0].id;
    s().resume(id);
    expect(lines().map((l) => l.menuId)).toEqual(['p-latte']);
    expect(s().byScope.default.parked).toHaveLength(0);
  });

  it('resume with a non-empty cart swaps: the current bill is parked in its place (nothing lost)', () => {
    s().addLine(latte);
    s().park();
    s().addLine(mocha);
    s().resume(s().byScope.default.parked[0].id);
    expect(lines().map((l) => l.menuId)).toEqual(['p-latte']);
    const parked = s().byScope.default.parked;
    expect(parked).toHaveLength(1);
    expect(parked[0].bill.lines[0].menuId).toBe('p-mocha');
  });

  it('resume of an unknown id changes nothing', () => {
    s().addLine(latte);
    s().resume('ghost');
    expect(lines()).toHaveLength(1);
  });

  it('dropParked removes only that bill', () => {
    s().addLine(latte); s().park();
    s().addLine(mocha); s().park();
    const [first, second] = s().byScope.default.parked;
    s().dropParked(first.id);
    expect(s().byScope.default.parked.map((p) => p.id)).toEqual([second.id]);
  });

  it('restoreBill puts a whole bill back (failed table-tab save)', () => {
    s().addLine(latte);
    const snap = bill();
    s().clearBill();
    s().restoreBill(snap);
    expect(lines()).toHaveLength(1);
  });
});

describe('totals derive from lines', () => {
  it('subtotal and count over the persisted lines (what the POS shows)', () => {
    s().addLine({ ...latte, qty: 2 });                // 120
    s().addLine({ ...mocha, unitPrice: 75, qty: 1 }); // 75 (modifier surcharge lives in unitPrice)
    const subtotal = lines().reduce((t, l) => t + l.unitPrice * l.qty, 0);
    const count = lines().reduce((t, l) => t + l.qty, 0);
    expect(subtotal).toBe(195);
    expect(count).toBe(3);
  });
});

describe('persistence per store scope', () => {
  const persisted = () => JSON.parse(mem.get('pos-cart-v1') ?? 'null');

  it('writes under pos-cart-v1 with only scope + byScope (no functions)', () => {
    s().addLine(latte);
    const p = persisted();
    expect(p.version).toBe(1);
    expect(Object.keys(p.state).sort()).toEqual(['byScope', 'scope']);
    expect(p.state.byScope.default.bill.lines[0].menuId).toBe('p-latte');
  });

  it('each store id has its own bill, parked list and last order', () => {
    s().setScope('store-A');
    s().addLine(latte);
    s().setLastOrderNo('7');
    s().setScope('store-B');
    expect(lines()).toHaveLength(0); // another branch never sees A's open bill
    s().addLine(mocha);
    s().setScope('store-A');
    expect(lines().map((l) => l.menuId)).toEqual(['p-latte']);
    expect(s().byScope['store-A'].lastOrderNo).toBe('7');
    expect(s().byScope['store-B'].lastOrderNo ?? null).toBeNull();
  });

  it('setScope ignores empty / unchanged values', () => {
    s().setScope('store-A');
    s().setScope('');
    expect(s().scope).toBe('store-A');
  });

  it('survives a reload: rehydrate restores bill + parked + scope from storage', async () => {
    s().setScope('store-A');
    s().addLine({ ...latte, qty: 3 });
    s().park();
    s().addLine(mocha);

    // "Reload": memory is lost, storage stays. (setState itself persists, so put the
    // pre-reload snapshot back the way a fresh page load would find it.)
    const snapshot = mem.get('pos-cart-v1')!;
    useCartStore.setState({ scope: 'default', byScope: {} });
    mem.set('pos-cart-v1', snapshot);
    expect(lines()).toHaveLength(0);
    await useCartStore.persist.rehydrate();

    expect(s().scope).toBe('store-A');
    expect(lines().map((l) => l.menuId)).toEqual(['p-mocha']);
    expect(s().byScope['store-A'].parked[0].bill.lines[0].qty).toBe(3);
  });

  it('never persists member phone / date of birth (open or parked bill), but keeps the in-memory member intact', () => {
    const member = {
      account: {
        id: 'acc-1', customer_id: 'c-1', customer_name: 'Somchai', phone: '0812345678',
        points_balance: 40, lifetime_points_earned: 90, tier: 'SILVER',
        date_of_birth: '1990-05-17', joined_at: '2024-01-01',
      },
      program: null, redeemReward: false, rewardProduct: null,
      rewardRedeemable: false, pointsToNextReward: null, eligibleRewardProducts: [],
    } as unknown as Parameters<ReturnType<typeof s>['setMember']>[0];

    s().addLine(latte);
    s().setMember(member);
    s().park();
    s().addLine(mocha);
    s().setMember(member);

    const raw = mem.get('pos-cart-v1')!;
    expect(raw).not.toContain('0812345678');
    expect(raw).not.toContain('1990-05-17');
    const p = persisted();
    expect(p.state.byScope.default.bill.member.account.customer_name).toBe('Somchai');
    expect(p.state.byScope.default.bill.member.account.points_balance).toBe(40);
    expect(p.state.byScope.default.parked[0].bill.member.account.phone).toBeNull();
    // memory keeps the full record for the running session
    expect(s().byScope.default.bill.member?.account.phone).toBe('0812345678');
  });

  it('clearBill (after payment) is persisted too: the next reload shows an empty cart', async () => {
    s().addLine(latte);
    s().clearBill();
    useCartStore.setState({ scope: 'default', byScope: {} });
    await useCartStore.persist.rehydrate();
    expect(lines()).toHaveLength(0);
  });
});
