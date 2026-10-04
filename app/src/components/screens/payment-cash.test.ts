import { describe, expect, it } from 'vitest';
import { applyCashKey, cashMath, exactString, smartPresets } from './payment-cash';

describe('applyCashKey', () => {
  const type = (keys: Parameters<typeof applyCashKey>[1][], decimal = false) =>
    keys.reduce((acc, k) => applyCashKey(acc, k, decimal), '');

  it('builds digits and has no leading zeros', () => {
    expect(type(['1', '5', '5'])).toBe('155');
    expect(type(['0', '5'])).toBe('5');
    expect(type(['0', '0'])).toBe('0');
  });
  it('"00" on an empty entry is a no-op, otherwise appends two zeros', () => {
    expect(type(['00'])).toBe('');
    expect(type(['2', '00'])).toBe('200');
  });
  it('"." only works when decimals are allowed, once, and limits satang to 2 places', () => {
    expect(type(['1', '.'], false)).toBe('1');
    expect(type(['.', '5'], true)).toBe('0.5');
    expect(type(['1', '.', '.', '2', '5', '9'], true)).toBe('1.25');
  });
  it('caps at 7 integer digits', () => {
    expect(type(['9', '9', '9', '9', '9', '9', '9', '9'])).toBe('9999999');
  });
  it('back removes one char, clear empties', () => {
    expect(applyCashKey('155', 'back', false)).toBe('15');
    expect(applyCashKey('', 'back', false)).toBe('');
    expect(applyCashKey('155', 'clear', false)).toBe('');
  });
});

describe('cashMath (whole satang, no float drift)', () => {
  it('enough / change / shortfall', () => {
    expect(cashMath(155, '200')).toMatchObject({ entered: true, enough: true, change: 45, shortfall: 0 });
    expect(cashMath(155, '100')).toMatchObject({ enough: false, change: 0, shortfall: 55 });
    expect(cashMath(155, '155')).toMatchObject({ enough: true, change: 0 });
  });
  it('nothing entered is not enough for a positive total', () => {
    expect(cashMath(50, '')).toMatchObject({ entered: false, enough: false, shortfall: 50 });
  });
  it('fractional totals do not suffer 0.1 + 0.2 error', () => {
    expect(cashMath(0.3, '0.30').enough).toBe(true);
    expect(cashMath(44.5, '50').change).toBe(5.5);
    expect(cashMath(0.1 + 0.2, '0.3').enough).toBe(true);
  });
  it('a lone "." is treated as nothing', () => {
    expect(cashMath(10, '.').enough).toBe(false);
  });
});

describe('smartPresets', () => {
  it('next note up for each step, ascending, deduped, above the total', () => {
    expect(smartPresets(155)).toEqual([160, 200, 500, 1000]);
  });
  it('an exact multiple is not offered as a preset of itself', () => {
    expect(smartPresets(100)).not.toContain(100);
    expect(smartPresets(100)).toEqual([500, 1000]);
  });
  it('respects the max', () => expect(smartPresets(155, 2)).toEqual([160, 200]));
});

describe('exactString', () => {
  it('whole baht stays bare, satang get two places', () => {
    expect(exactString(155)).toBe('155');
    expect(exactString(155.5)).toBe('155.50');
    expect(exactString(0.1 + 0.2)).toBe('0.30');
  });
});
