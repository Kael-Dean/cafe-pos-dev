import { describe, expect, it } from 'vitest';
import { bahtStr, clockTime, formatMinutes, minutesSince } from './money';

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
