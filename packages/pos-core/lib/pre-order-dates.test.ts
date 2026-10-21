import { describe, expect, it } from 'vitest';
import {
  addDaysIso, buildPreOrderListQuery, groupByDueDate, isIsoDate, localIsoDate, mondayOf,
  monthRange, normalizePreOrderFilters, preOrderCustomerLabel, weekDays, weekRange, weekdayMon0,
} from './pre-order-dates';

describe('isIsoDate', () => {
  it.each(['2026-06-01', '2028-02-29', '2026-12-31'])('accepts %s', (s) => expect(isIsoDate(s)).toBe(true));
  it.each(['2026-02-29', '2026-13-01', '2026-06-00', '2026-6-1', '06/01/2026', '', null, undefined, 20260601])(
    'rejects %s', (s) => expect(isIsoDate(s)).toBe(false));
});

describe('buildPreOrderListQuery', () => {
  it('defaults to page 1 / limit 50 and no filters (backwards compatible)', () => {
    expect(buildPreOrderListQuery()).toBe('page=1&limit=50');
  });

  it('sends due_date_from / due_date_to with status, page and limit (calendar month pattern)', () => {
    const q = new URLSearchParams(buildPreOrderListQuery({
      status: 'PENDING', dueDateFrom: '2026-06-01', dueDateTo: '2026-06-30', limit: 200,
    }));
    expect(q.get('status')).toBe('PENDING');
    expect(q.get('due_date_from')).toBe('2026-06-01');
    expect(q.get('due_date_to')).toBe('2026-06-30');
    expect(q.get('page')).toBe('1');
    expect(q.get('limit')).toBe('200');
  });

  it('allows an open-ended range (only one bound)', () => {
    const q = new URLSearchParams(buildPreOrderListQuery({ dueDateFrom: '2026-06-15' }));
    expect(q.get('due_date_from')).toBe('2026-06-15');
    expect(q.has('due_date_to')).toBe(false);
  });

  it('drops invalid dates instead of sending them (the API would 422)', () => {
    const q = new URLSearchParams(buildPreOrderListQuery({ dueDateFrom: '2026-02-30', dueDateTo: 'tomorrow' }));
    expect(q.has('due_date_from')).toBe(false);
    expect(q.has('due_date_to')).toBe(false);
  });

  it('swaps a reversed range so from ≤ to', () => {
    const q = new URLSearchParams(buildPreOrderListQuery({ dueDateFrom: '2026-06-30', dueDateTo: '2026-06-01' }));
    expect(q.get('due_date_from')).toBe('2026-06-01');
    expect(q.get('due_date_to')).toBe('2026-06-30');
  });

  it('clamps limit to 1–200 and page to ≥ 1', () => {
    expect(normalizePreOrderFilters({ limit: 500, page: 0 })).toMatchObject({ limit: 200, page: 1 });
    expect(normalizePreOrderFilters({ limit: 0, page: -3 })).toMatchObject({ limit: 1, page: 1 });
    expect(normalizePreOrderFilters({ limit: Number.NaN })).toMatchObject({ limit: 50 });
  });

  it('equivalent filters normalise to the same object (one cache entry)', () => {
    expect(normalizePreOrderFilters({ dueDateFrom: '2026-06-30', dueDateTo: '2026-06-01', status: undefined }))
      .toEqual(normalizePreOrderFilters({ dueDateFrom: '2026-06-01', dueDateTo: '2026-06-30' }));
  });
});

describe('calendar date arithmetic', () => {
  it('addDaysIso crosses month and year boundaries', () => {
    expect(addDaysIso('2026-06-30', 1)).toBe('2026-07-01');
    expect(addDaysIso('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDaysIso('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('weekdayMon0 / mondayOf', () => {
    expect(weekdayMon0('2026-06-01')).toBe(0); // Monday
    expect(weekdayMon0('2026-06-07')).toBe(6); // Sunday
    expect(mondayOf('2026-06-07')).toBe('2026-06-01');
    expect(mondayOf('2026-06-03')).toBe('2026-06-01');
    expect(mondayOf('2026-06-01')).toBe('2026-06-01');
  });

  it('weekRange is inclusive Monday → Sunday; weekDays lists all 7', () => {
    expect(weekRange('2026-06-29')).toEqual({ dueDateFrom: '2026-06-29', dueDateTo: '2026-07-05' });
    expect(weekDays('2026-06-29')).toEqual(['2026-06-29', '2026-06-30', '2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05']);
  });

  it('monthRange covers the whole month (leap years too)', () => {
    expect(monthRange('2026-06-15')).toEqual({ dueDateFrom: '2026-06-01', dueDateTo: '2026-06-30' });
    expect(monthRange('2028-02-03')).toEqual({ dueDateFrom: '2028-02-01', dueDateTo: '2028-02-29' });
  });

  it('localIsoDate uses the local calendar date, not UTC', () => {
    // 00:30 local on 1 June is still 31 May in UTC east of Greenwich — must read 1 June.
    expect(localIsoDate(new Date(2026, 5, 1, 0, 30))).toBe('2026-06-01');
  });
});

describe('groupByDueDate', () => {
  const items = [
    { id: 'a', dueDate: '2026-06-15', status: 'PENDING' as const },
    { id: 'b', dueDate: '2026-06-15', status: 'IN_PROGRESS' as const },
    { id: 'c', dueDate: '2026-06-16', status: 'CANCELLED' as const },
  ];

  it('groups several orders on the same day, keeping API order', () => {
    expect(groupByDueDate(items)['2026-06-15'].map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('hides cancelled by default, shows them on request', () => {
    expect(groupByDueDate(items)['2026-06-16']).toBeUndefined();
    expect(groupByDueDate(items, true)['2026-06-16'].map((x) => x.id)).toEqual(['c']);
  });

  it('empty month → empty map', () => expect(groupByDueDate([])).toEqual({}));
});

describe('preOrderCustomerLabel', () => {
  it('name → phone → unknown', () => {
    expect(preOrderCustomerLabel({ customerName: 'Alice', customerPhone: '081' })).toBe('Alice');
    expect(preOrderCustomerLabel({ customerName: null, customerPhone: '0812345678' })).toBe('0812345678');
    expect(preOrderCustomerLabel({ customerName: '  ', customerPhone: null })).toBe('ลูกค้าไม่ระบุชื่อ');
  });
});
