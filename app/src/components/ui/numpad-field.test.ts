import { describe, expect, it } from 'vitest';
import { applyNumpadKey, type NumpadRules } from './numpad-field';

const type = (keys: string[], rules: NumpadRules, start = '') =>
  keys.reduce((v, k) => applyNumpadKey(v, k as Parameters<typeof applyNumpadKey>[1], rules), start);

describe('applyNumpadKey', () => {
  const money: NumpadRules = { mode: 'money' };
  const satang: NumpadRules = { mode: 'money', allowDecimal: true };

  it('money: drops leading zeros and treats 00 on empty as a no-op', () => {
    expect(type(['0', '5'], money)).toBe('5');
    expect(type(['00'], money)).toBe('');
    expect(type(['1', '00'], money)).toBe('100');
  });

  it('money: caps integer digits (default 7)', () => {
    expect(type(['9', '9', '9', '9', '9', '9', '9', '9'], money)).toBe('9999999');
    expect(type(['9', '9', '9', '9', '9', '9', '00'], money)).toBe('9999990');
  });

  it('money: decimal only when allowed, max 2 satang digits', () => {
    expect(type(['1', '.'], money)).toBe('1');
    expect(type(['.', '5'], satang)).toBe('0.5');
    expect(type(['1', '.', '2', '5', '9'], satang)).toBe('1.25');
    expect(type(['1', '.', '.'], satang)).toBe('1.');
  });

  it('qty: whole numbers, max 3 digits, no decimal', () => {
    const qty: NumpadRules = { mode: 'qty' };
    expect(type(['0', '1', '2', '3', '4'], qty)).toBe('123');
    expect(type(['2', '.'], qty)).toBe('2');
  });

  it('digits: keeps leading zeros and caps total length', () => {
    const phone: NumpadRules = { mode: 'digits' };
    expect(type(['0', '8', '1', '2', '3', '4', '5', '6', '7', '8', '9'], phone)).toBe('0812345678');
    expect(type(['0', '.'], phone)).toBe('0');
  });

  it('back and clear', () => {
    expect(applyNumpadKey('123', 'back', money)).toBe('12');
    expect(applyNumpadKey('', 'back', money)).toBe('');
    expect(applyNumpadKey('123', 'clear', money)).toBe('');
  });
});
