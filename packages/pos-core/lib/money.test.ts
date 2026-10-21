import { describe, expect, it } from 'vitest';
import {
  bahtStr, clockTime, formatMinutes, minutesSince,
  moneySign, moneyToSatang, satangToMoney, signedBahtStr, subMoney, sumMoney,
} from './money';

describe('bahtStr (string in, string out, never float math)', () => {
  it.each([
    ['240.00', '฿240'],
    ['1234.50', '฿1,234.50'],
    ['1234567.00', '฿1,234,567'],
    ['0.05', '฿0.05'],
    ['10.10', '฿10.10'], // a real fraction keeps satang places
    ['100', '฿100'],
    ['999.999', '฿999.999'],
    ['0', '฿0'],
  ])('%s -> %s', (input, out) => expect(bahtStr(input)).toBe(out));

  it('null / undefined / empty -> ฿0', () => {
    expect(bahtStr(null)).toBe('฿0');
    expect(bahtStr(undefined)).toBe('฿0');
    expect(bahtStr('')).toBe('฿0');
  });

  it('keeps the sign, accepts +, trims whitespace', () => {
    expect(bahtStr('-1500.00')).toBe('-฿1,500');
    expect(bahtStr('-0.50')).toBe('-฿0.50');
    expect(bahtStr('+25.00')).toBe('฿25');
    expect(bahtStr('  240.00 ')).toBe('฿240');
  });

  it('does not lose precision on values a float cannot hold', () => {
    expect(bahtStr('9007199254740993.10')).toBe('฿9,007,199,254,740,993.10');
  });

  it('".50" (no integer part) still prints a zero', () => {
    expect(bahtStr('.50')).toBe('฿0.50');
  });
});

describe('formatMinutes', () => {
  it.each([
    [0, '0 น.'], [45, '45 น.'], [60, '1 ชม.'], [120, '2 ชม.'], [125, '2 ชม. 5 น.'],
    [-5, '0 น.'], [59.6, '1 ชม.'],
  ])('%s -> %s', (n, out) => expect(formatMinutes(n)).toBe(out));
});

describe('minutesSince', () => {
  const now = Date.parse('2026-01-01T12:00:00Z');
  it('floors whole minutes', () => {
    expect(minutesSince('2026-01-01T11:00:30Z', now)).toBe(59);
    expect(minutesSince('2026-01-01T10:00:00Z', now)).toBe(120);
  });
  it('clamps future timestamps and invalid input to 0', () => {
    expect(minutesSince('2026-01-01T13:00:00Z', now)).toBe(0);
    expect(minutesSince('not-a-date', now)).toBe(0);
  });
});

describe('clockTime', () => {
  it('returns an em dash for an invalid date', () => {
    expect(clockTime('garbage')).toBe('—');
  });
  it('formats a valid ISO as HH:mm digits', () => {
    expect(clockTime('2026-01-01T11:02:00')).toMatch(/\d{2}[:.]\d{2}/);
  });
});

describe('decimal-string arithmetic (BigInt satang, never float)', () => {
  it('moneyToSatang parses 0–2 decimals, sign, separators', () => {
    expect(moneyToSatang('4100.50')).toBe(BigInt(410050));
    expect(moneyToSatang('4100.5')).toBe(BigInt(410050));
    expect(moneyToSatang('4100')).toBe(BigInt(410000));
    expect(moneyToSatang('.05')).toBe(BigInt(5));
    expect(moneyToSatang('-150.00')).toBe(BigInt(-15000));
    expect(moneyToSatang('1,234.50')).toBe(BigInt(123450));
    expect(moneyToSatang(' 12.30 ')).toBe(BigInt(1230));
  });

  it.each(['', '.', '-', '1.234', 'abc', '1e3', '12..3', null, undefined])('moneyToSatang rejects %s', (v) => {
    expect(moneyToSatang(v as string)).toBeNull();
  });

  it('satangToMoney always prints 2 decimals', () => {
    expect(satangToMoney(BigInt(410050))).toBe('4100.50');
    expect(satangToMoney(BigInt(-15000))).toBe('-150.00');
    expect(satangToMoney(BigInt(5))).toBe('0.05');
    expect(satangToMoney(BigInt(-5))).toBe('-0.05');
    expect(satangToMoney(BigInt(0))).toBe('0.00');
  });

  it('subMoney is exact where floats drift', () => {
    expect(subMoney('4100.00', '4250.00')).toBe('-150.00');
    expect(subMoney('12800.50', '12800.50')).toBe('0.00');
    expect(subMoney('0.30', '0.10')).toBe('0.20'); // 0.3 - 0.1 = 0.19999999999999998 in float
    expect(subMoney('9007199254740993.10', '0.10')).toBe('9007199254740993.00');
    expect(subMoney('abc', '1')).toBeNull();
  });

  it('sumMoney adds exactly and skips invalid', () => {
    expect(sumMoney(['0.10', '0.20'])).toBe('0.30');
    expect(sumMoney(['4250.00', '12800.50', null, 'x'])).toBe('17050.50');
    expect(sumMoney([])).toBe('0.00');
  });

  it('moneySign / signedBahtStr', () => {
    expect(moneySign('-0.01')).toBe(-1);
    expect(moneySign('0.00')).toBe(0);
    expect(moneySign('5')).toBe(1);
    expect(moneySign('x')).toBeNull();
    expect(signedBahtStr('-150.00')).toBe('-฿150');
    expect(signedBahtStr('25.50')).toBe('+฿25.50');
    expect(signedBahtStr('0.00')).toBe('฿0');
    expect(signedBahtStr('bad')).toBe('—');
  });
});
