import { describe, expect, it } from 'vitest';
import {
  BAR_TAB_PLAN, billPath, boardColumnOf, canReject, decideChime, decorateBoard, describeError,
  firstOrderIdBySession, guestPayBody, guestPayTransition, hasDefaultPlan, initialGuestStep,
  isGuestOrder, isRateValid, nextActionFor, nextGuestCall, normalizeTags, tablePayBody,
  type BoardOrderLike,
} from './self-ordering';

const order = (o: Partial<BoardOrderLike> & { id: string }): BoardOrderLike => ({
  status: 'PENDING', sessionId: 's1', guestId: 'g1', createdById: null, createdAt: 1000, orderNo: 1, ...o,
});

describe('status conversion', () => {
  it('maps API statuses to board columns', () => {
    expect(boardColumnOf('PENDING')).toBe('new');
    expect(boardColumnOf('IN_PROGRESS')).toBe('making');
    expect(boardColumnOf('READY')).toBe('ready');
  });
  it('keeps finished / counter statuses off the board', () => {
    for (const s of ['COMPLETED', 'VOID', 'PAID', 'nonsense']) expect(boardColumnOf(s)).toBeNull();
  });
  it('walks PENDING → IN_PROGRESS → READY → COMPLETED', () => {
    expect(nextActionFor('PENDING')).toEqual({ to: 'IN_PROGRESS', label: 'รับออเดอร์' });
    expect(nextActionFor('IN_PROGRESS')?.to).toBe('READY');
    expect(nextActionFor('READY')?.to).toBe('COMPLETED');
    expect(nextActionFor('COMPLETED')).toBeNull();
    expect(nextActionFor('VOID')).toBeNull();
  });
  it('only lets PENDING be rejected', () => {
    expect(canReject('PENDING')).toBe(true);
    expect(canReject('IN_PROGRESS')).toBe(false);
  });
});

describe('guest vs walk-up orders', () => {
  it('guest id means customer order', () => {
    expect(isGuestOrder({ guestId: 'g', sessionId: 's', createdById: null })).toBe(true);
  });
  it('tab order with no cashier is a customer order', () => {
    expect(isGuestOrder({ guestId: null, sessionId: 's', createdById: null })).toBe(true);
  });
  it('owner-rung walk-up is not', () => {
    expect(isGuestOrder({ guestId: null, sessionId: 's', createdById: 'u1' })).toBe(false);
  });
  it('counter order without session is not', () => {
    expect(isGuestOrder({ guestId: null, sessionId: null, createdById: null })).toBe(false);
  });
});

describe('NEW TABLE badge', () => {
  it('flags the earliest order of each session only', () => {
    const rows = decorateBoard([
      order({ id: 'b', createdAt: 2000, orderNo: 2 }),
      order({ id: 'a', createdAt: 1000, orderNo: 1 }),
      order({ id: 'c', sessionId: 's2', createdAt: 1500, orderNo: 3 }),
    ]);
    expect(Object.fromEntries(rows.map((r) => [r.id, r.isNewTable]))).toEqual({ a: true, b: false, c: true });
  });
  it('does not flag a 2nd order when the 1st is already served (needs ALL orders passed in)', () => {
    const rows = decorateBoard([
      order({ id: 'first', status: 'COMPLETED', createdAt: 1000, orderNo: 1 }),
      order({ id: 'second', status: 'PENDING', createdAt: 5000, orderNo: 2 }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(['second']);
    expect(rows[0].isNewTable).toBe(false);
  });
  it('breaks timestamp ties by order number', () => {
    const m = firstOrderIdBySession([order({ id: 'x', orderNo: 9 }), order({ id: 'y', orderNo: 3 })]);
    expect(m.get('s1')).toBe('y');
  });
  it('never flags orders without a session', () => {
    const rows = decorateBoard([order({ id: 'z', sessionId: null, guestId: null })]);
    expect(rows[0].isNewTable).toBe(false);
  });
  it('sorts oldest first and drops non-board statuses', () => {
    const rows = decorateBoard([
      order({ id: 'late', createdAt: 9000, orderNo: 5 }),
      order({ id: 'early', status: 'READY', createdAt: 100, orderNo: 1, sessionId: 's9' }),
      order({ id: 'gone', status: 'VOID', createdAt: 50, orderNo: 0, sessionId: 's8' }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(['early', 'late']);
    expect(rows[0].column).toBe('ready');
  });
});

describe('chime decision', () => {
  it('rings for a new pending customer order', () => {
    const r = decideChime({ pendingGuestIds: ['a'], announced: new Set(), now: 0, lastChimeAt: null });
    expect(r).toMatchObject({ chime: true, reason: 'new' });
  });
  it('rings on first load when orders are already waiting (announced = null)', () => {
    expect(decideChime({ pendingGuestIds: ['a'], announced: null, now: 0, lastChimeAt: null }).chime).toBe(true);
  });
  it('is silent for an already announced order inside the repeat window', () => {
    const r = decideChime({ pendingGuestIds: ['a'], announced: new Set(['a']), now: 10_000, lastChimeAt: 0 });
    expect(r.chime).toBe(false);
  });
  it('reminds after the repeat window while still unaccepted', () => {
    const r = decideChime({ pendingGuestIds: ['a'], announced: new Set(['a']), now: 31_000, lastChimeAt: 0 });
    expect(r).toMatchObject({ chime: true, reason: 'reminder' });
  });
  it('stays silent with nothing pending and forgets accepted ids', () => {
    const r = decideChime({ pendingGuestIds: [], announced: new Set(['a']), now: 99_999, lastChimeAt: 0 });
    expect(r.chime).toBe(false);
    expect(r.announced.size).toBe(0);
  });
});

describe('checkout sequence', () => {
  it('cannot pay before checkout (would be a 409)', () => {
    expect(() => guestPayTransition('preview', 'pay', 'CASH')).toThrow();
  });
  it('cash: checkout → pay', () => {
    const s1 = guestPayTransition('preview', 'checkout', 'CASH');
    expect(s1).toBe('checked_out');
    expect(guestPayTransition(s1, 'pay', 'CASH')).toBe('paid');
  });
  it('QR: checkout → qr → pay, and pay is blocked until the QR is shown', () => {
    const s1 = guestPayTransition('preview', 'checkout', 'QR_PROMPTPAY');
    expect(() => guestPayTransition(s1, 'pay', 'QR_PROMPTPAY')).toThrow();
    const s2 = guestPayTransition(s1, 'qr', 'QR_PROMPTPAY');
    expect(guestPayTransition(s2, 'pay', 'QR_PROMPTPAY')).toBe('paid');
  });
  it('rejects QR for cash, repeat checkout and double pay', () => {
    expect(() => guestPayTransition('checked_out', 'qr', 'CASH')).toThrow();
    expect(() => guestPayTransition('checked_out', 'checkout', 'CASH')).toThrow();
    expect(() => guestPayTransition('paid', 'pay', 'CASH')).toThrow();
  });
  it('picks the next call to fire', () => {
    expect(nextGuestCall('preview', 'CASH')).toBe('checkout');
    expect(nextGuestCall('checked_out', 'QR_PROMPTPAY')).toBe('qr');
    expect(nextGuestCall('checked_out', 'CASH')).toBeNull();
    expect(nextGuestCall('qr_ready', 'QR_PROMPTPAY')).toBeNull();
  });
  it('skips checkout for someone already checked out', () => {
    expect(initialGuestStep('CHECKED_OUT')).toBe('checked_out');
    expect(initialGuestStep('CHECKOUT_REQUESTED')).toBe('preview');
    expect(initialGuestStep('ACTIVE')).toBe('preview');
  });
  it('builds the exact pay bodies', () => {
    expect(guestPayBody('g1', 'QR_PROMPTPAY')).toEqual({ scope: 'GUEST', guest_id: 'g1', payment_method: 'QR_PROMPTPAY' });
    expect(tablePayBody('CASH')).toEqual({ scope: 'TABLE', payment_method: 'CASH', force: true });
  });
  it('builds preview paths', () => {
    expect(billPath('s1')).toBe('/api/v1/table-sessions/s1/bill');
    expect(billPath('s1', 'g 1')).toBe('/api/v1/table-sessions/s1/bill?guest_id=g%201');
  });
});

describe('error copy', () => {
  it('explains 409 per context', () => {
    expect(describeError({ status: 409 }, 'pay')).toContain('เช็คเอาท์');
    expect(describeError({ status: 409 }, 'close')).toContain('บิลค้าง');
    expect(describeError({ status: 409 }, 'order-status')).toContain('เปลี่ยนสถานะ');
  });
  it('explains 410 and 429', () => {
    expect(describeError({ status: 410 }, 'checkout')).toContain('ปิดไปแล้ว');
    expect(describeError({ status: 429 }, 'order-status')).toContain('รอสักครู่');
  });
  it('treats a missing status as a network failure', () => {
    expect(describeError(new TypeError('Failed to fetch'), 'pay')).toContain('เชื่อมต่อ');
  });
  it('maps 5xx and unknown codes', () => {
    expect(describeError({ status: 502 }, 'pay')).toContain('ขัดข้อง');
    expect(describeError({ status: 418, message: 'teapot' }, 'pay')).toBe('teapot');
  });
});

describe('product tags', () => {
  it('trims, drops blanks and case-insensitive duplicates', () => {
    expect(normalizeTags(' สดชื่น , ,Gin,gin,\nGIN ,หวาน').tags).toEqual(['สดชื่น', 'Gin', 'หวาน']);
  });
  it('accepts at most 10 tags', () => {
    const ok = Array.from({ length: 10 }, (_, i) => `t${i}`);
    expect(normalizeTags(ok).error).toBeNull();
    expect(normalizeTags([...ok, 'x']).error).toContain('10');
  });
  it('rejects a tag longer than 30 characters', () => {
    expect(normalizeTags('x'.repeat(31)).error).toContain('30');
    expect(normalizeTags('x'.repeat(30)).error).toBeNull();
  });
});

describe('rate plan', () => {
  it('ships the Bar tab body from the handoff', () => {
    expect(BAR_TAB_PLAN).toMatchObject({ billing_mode: 'PER_TABLE_HOUR', hourly_rate: '0', is_default: true, grace_minutes: 0, min_charge_minutes: 0 });
  });
  it('detects a missing default plan', () => {
    expect(hasDefaultPlan([])).toBe(false);
    expect(hasDefaultPlan([{ isDefault: true, isActive: false }])).toBe(false);
    expect(hasDefaultPlan([{ isDefault: true, isActive: true }])).toBe(true);
  });
  it('accepts 0 only when allowed', () => {
    expect(isRateValid('0', true)).toBe(true);
    expect(isRateValid('0', false)).toBe(false);
    expect(isRateValid('40.5', false)).toBe(true);
    expect(isRateValid('40.555', true)).toBe(false);
    expect(isRateValid('', true)).toBe(false);
  });
});

import { isZeroAmount } from './self-ordering';
describe('isZeroAmount', () => {
  it('reads zero strings without parsing floats', () => {
    for (const z of ['0', '0.00', '', null, undefined, '000.0']) expect(isZeroAmount(z)).toBe(true);
    for (const n of ['0.01', '180.00', '10']) expect(isZeroAmount(n)).toBe(false);
  });
});
