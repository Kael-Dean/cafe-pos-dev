import { describe, expect, it, vi } from 'vitest';
import { NO_FIRST_ORDER, newPendingGuestOrders, newTableOrderIds, olderOrdersFromFloor, pruneFirstOrders, rememberFirstOrders, toSatang, type OrderOnSession } from './new-table';
import { MAX_TAGS, addTag, normalizeTags, splitTagInput, tagsPatch } from './tags';
import { GUEST_PAY_IDLE, canPayGuest, guestPayReducer, hasAmountDue, needsCheckout, settleTable, type GuestPayEvent, type GuestPayState } from './bill-flow';

const o = (id: string, sessionId: string | null, min: number, n = 0): OrderOnSession => ({
  id, sessionId, createdAt: new Date(Date.UTC(2026, 9, 18, 14, min)).toISOString(), orderNumber: n,
});

describe('NEW TABLE badge', () => {
  it('marks only the earliest order of each session on a cold start', () => {
    const ids = newTableOrderIds({}, [o('b', 's1', 5), o('a', 's1', 2), o('c', 's2', 9), o('walk', null, 1)]);
    expect([...ids].sort()).toEqual(['a', 'c']);
  });

  it('breaks timestamp ties by order number', () => {
    expect([...newTableOrderIds({}, [o('x', 's1', 3, 12), o('y', 's1', 3, 11)])]).toEqual(['y']);
  });

  it('remembers the first order after it leaves the board (served)', () => {
    let mem = rememberFirstOrders({}, [o('first', 's1', 1)]);
    // first was served: only the second order is still active
    const ids = newTableOrderIds(mem, [o('second', 's1', 7)]);
    expect(ids.has('second')).toBe(false);
    mem = rememberFirstOrders(mem, [o('second', 's1', 7)]);
    expect(mem).toEqual({ s1: 'first' });
  });

  it('returns the same memory object when nothing is new', () => {
    const mem = { s1: 'a' };
    expect(rememberFirstOrders(mem, [o('a', 's1', 1), o('b', 's1', 2)])).toBe(mem);
  });

  it('cold start: a table whose first order was already served gets no badge', () => {
    const older = olderOrdersFromFloor(new Map([['s1', '640.00'], ['s2', '360.00']]));
    const orders = [{ ...o('a', 's1', 2), total: '240.00' }, { ...o('b', 's1', 5), total: '220.00' }, { ...o('c', 's2', 9), total: '360.00' }];
    expect([...newTableOrderIds({}, orders, older)]).toEqual(['c']);
    expect(rememberFirstOrders({}, orders, older)).toEqual({ s1: NO_FIRST_ORDER, s2: 'c' });
  });

  it('a session opened after the last floor poll counts as new', () => {
    const older = olderOrdersFromFloor(new Map());
    expect([...newTableOrderIds({}, [{ ...o('x', 's9', 1), total: '100.00' }], older)]).toEqual(['x']);
  });

  it('decides nothing while the floor is unknown', () => {
    expect(rememberFirstOrders({}, [o('a', 's1', 1)], null)).toEqual({});
    expect(newTableOrderIds({}, [o('a', 's1', 1)], null).size).toBe(0);
  });

  it('satang conversion is exact', () => {
    expect(toSatang('180.00') + toSatang('0.1') + toSatang('0.2')).toBe(18030);
    expect(toSatang('-5.5')).toBe(-550);
    expect(toSatang('junk')).toBe(0);
  });

  it('prunes closed sessions, keeps everything while the floor is unknown', () => {
    const mem = { s1: 'a', s2: 'b' };
    expect(pruneFirstOrders(mem, null)).toBe(mem);
    expect(pruneFirstOrders(mem, new Set(['s2']))).toEqual({ s2: 'b' });
    expect(pruneFirstOrders(mem, new Set(['s1', 's2']))).toBe(mem);
  });
});

describe('new PENDING guest order alert', () => {
  const ord = (id: string, status: string, guestId: string | null) => ({ id, status, guestId });
  it('never alerts on the first load', () => {
    expect(newPendingGuestOrders(null, [ord('1', 'PENDING', 'g')])).toEqual([]);
  });
  it('alerts only for unseen PENDING orders that came from a guest', () => {
    const prev = new Set(['1']);
    const got = newPendingGuestOrders(prev, [
      ord('1', 'PENDING', 'g'), ord('2', 'PENDING', 'g'), ord('3', 'PENDING', null), ord('4', 'IN_PROGRESS', 'g'),
    ]);
    expect(got.map((x) => x.id)).toEqual(['2']);
  });
});

describe('tag normalisation', () => {
  it('trims, drops blanks and case-insensitive duplicates (first spelling wins)', () => {
    expect(normalizeTags(['  Fresh ', '', 'fresh', 'FRESH', 'สดชื่น', ' ', 'ความแรง: กลาง'])).toEqual(['Fresh', 'สดชื่น', 'ความแรง: กลาง']);
  });
  it('drops tags over 30 characters and caps at 10', () => {
    const long = 'x'.repeat(31);
    const many = Array.from({ length: 14 }, (_, i) => `t${i}`);
    expect(normalizeTags([long, 'ok'])).toEqual(['ok']);
    expect(normalizeTags(many)).toHaveLength(MAX_TAGS);
  });
  it('counts Thai characters (incl. combining marks) like the backend', () => {
    expect(normalizeTags(['น้ำ'.repeat(10)])).toEqual(['น้ำ'.repeat(10)]); // 30 code points
    expect(normalizeTags(['น้ำ'.repeat(10) + 'ก'])).toEqual([]);
  });
  it('addTag explains every refusal', () => {
    expect(addTag([], '   ').error).toBe('blank');
    expect(addTag([], 'y'.repeat(31)).error).toBe('too-long');
    expect(addTag(['Sour'], ' sour ').error).toBe('duplicate');
    expect(addTag(Array.from({ length: 10 }, (_, i) => `t${i}`), 'new').error).toBe('too-many');
    expect(addTag(['a'], '  b ')).toEqual({ tags: ['a', 'b'], error: null });
  });
  it('splits pasted lists', () => {
    expect(splitTagInput('a, b\nc')).toEqual(['a', ' b', 'c']);
  });
  it('PATCH value: omitted when unchanged, null when cleared', () => {
    expect(tagsPatch(['a'], ['a'])).toBeUndefined();
    expect(tagsPatch(null, [])).toBeUndefined();
    expect(tagsPatch(['a'], [])).toBeNull();
    expect(tagsPatch(['a'], ['a', 'b'])).toEqual(['a', 'b']);
  });
});

describe('guest pay chaining (checkout → pay)', () => {
  const run = (events: GuestPayEvent[], from: GuestPayState = GUEST_PAY_IDLE) => events.reduce(guestPayReducer, from);

  it('cannot pay before checkout succeeded (the API would answer 409)', () => {
    expect(run([{ type: 'pay', method: 'CASH' }])).toEqual(GUEST_PAY_IDLE);
    const checking = run([{ type: 'checkout' }]);
    expect(needsCheckout(checking)).toBe(true);
    expect(canPayGuest(checking)).toBe(false);
    expect(run([{ type: 'pay', method: 'CASH' }], checking)).toBe(checking);
  });

  it('happy path with the PromptPay QR', () => {
    const s = run([
      { type: 'checkout' }, { type: 'checkout-ok', amount: '220.00' }, { type: 'show-qr' },
      { type: 'pay', method: 'QR_PROMPTPAY' }, { type: 'pay-ok' },
    ]);
    expect(s).toEqual({ kind: 'paid', amount: '220.00', method: 'QR_PROMPTPAY' });
  });

  it('a failed payment returns to checked-out (no second checkout)', () => {
    const failed = run([{ type: 'checkout' }, { type: 'checkout-ok', amount: '90.00' }, { type: 'pay', method: 'CASH' }, { type: 'pay-failed', message: 'x' }]);
    expect(failed).toEqual({ kind: 'failed', message: 'x', amount: '90.00' });
    const retried = guestPayReducer(failed, { type: 'retry' });
    expect(retried).toEqual({ kind: 'ready', amount: '90.00', showQr: false });
    expect(canPayGuest(retried)).toBe(true);
  });

  it('a failed checkout retries the checkout', () => {
    const failed = run([{ type: 'checkout' }, { type: 'checkout-failed', message: 'net' }]);
    expect(guestPayReducer(failed, { type: 'retry' })).toEqual({ kind: 'checking-out' });
  });

  it('server amount on pay wins over the preview', () => {
    const s = run([{ type: 'checkout' }, { type: 'checkout-ok', amount: '90.00' }, { type: 'pay', method: 'CASH' }, { type: 'pay-ok', amount: '95.00' }]);
    expect(s).toMatchObject({ kind: 'paid', amount: '95.00' });
  });
});

describe('settle the rest of the table', () => {
  it('amount due: string test, no float math', () => {
    expect(hasAmountDue('0.00')).toBe(false);
    expect(hasAmountDue('0')).toBe(false);
    expect(hasAmountDue(null)).toBe(false);
    expect(hasAmountDue('0.50')).toBe(true);
    expect(hasAmountDue('540.00')).toBe(true);
    expect(hasAmountDue('-10.00')).toBe(false);
  });

  it('pays TABLE then closes', async () => {
    const calls: string[] = [];
    const r = await settleTable({
      payTable: async (m) => { calls.push(`pay:${m}`); },
      close: async () => { calls.push('close'); return { settled: true }; },
    }, '310.00', 'CASH');
    expect(calls).toEqual(['pay:CASH', 'close']);
    expect(r).toEqual({ ok: true, settled: true, paid: true });
  });

  it('nothing due → close only', async () => {
    const payTable = vi.fn();
    const r = await settleTable({ payTable, close: async () => ({ settled: true }) }, '0.00', 'CASH');
    expect(payTable).not.toHaveBeenCalled();
    expect(r).toEqual({ ok: true, settled: true, paid: false });
  });

  it('a failed pay never closes', async () => {
    const close = vi.fn();
    const r = await settleTable({ payTable: async () => { throw new Error('409'); }, close }, '10.00', 'CASH');
    expect(close).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: false, stage: 'pay' });
  });

  it('reports an unsettled close', async () => {
    const r = await settleTable({ payTable: async () => {}, close: async () => ({ settled: false }) }, '10.00', 'QR_PROMPTPAY');
    expect(r).toEqual({ ok: true, settled: false, paid: true });
  });
});
