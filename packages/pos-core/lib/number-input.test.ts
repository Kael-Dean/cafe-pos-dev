import { describe, it, expect } from 'vitest';
import { displayNumber, parseNumberInput, clampNumber } from './number-input';

describe('displayNumber', () => {
  it('shows an EMPTY box for the empty value (this is the bug fix — no stuck "0")', () => {
    expect(displayNumber(0)).toBe('');
    expect(displayNumber(0, 0)).toBe('');
  });

  it('shows real values as text', () => {
    expect(displayNumber(234)).toBe('234');
    expect(displayNumber(2.5)).toBe('2.5');
  });

  it('honours a custom empty value', () => {
    expect(displayNumber(1, 1)).toBe(''); // 1 is "empty" here
    expect(displayNumber(0, 1)).toBe('0'); // 0 is a real value here
  });

  it('never renders NaN/Infinity', () => {
    expect(displayNumber(NaN)).toBe('');
    expect(displayNumber(Infinity)).toBe('');
  });
});

describe('parseNumberInput', () => {
  it('maps an empty / intermediate field to the empty value, not a stuck 0-prefix', () => {
    expect(parseNumberInput('')).toBe(0);
    expect(parseNumberInput('   ')).toBe(0);
    expect(parseNumberInput('-')).toBe(0);
    expect(parseNumberInput('.')).toBe(0);
  });

  it('parses plain numbers', () => {
    expect(parseNumberInput('100')).toBe(100);
    expect(parseNumberInput('2.5')).toBe(2.5);
  });

  it('truncates when integer is requested', () => {
    expect(parseNumberInput('2.9', { integer: true })).toBe(2);
  });

  it('rejects garbage to the empty value', () => {
    expect(parseNumberInput('abc')).toBe(0);
  });
});

describe('the "0100" regression is impossible with the draft model', () => {
  // Old code: state is a number; clearing -> Number('') -> 0 -> box shows "0" ->
  // typing "100" appended -> "0100". With the draft model the box holds the raw
  // string the user typed, so the displayed sequence is "" -> "1" -> "10" -> "100".
  it('clearing then typing never reintroduces a leading zero', () => {
    const keystrokes = ['', '1', '10', '100'];
    const displayed = keystrokes; // draft is shown verbatim
    expect(displayed).toEqual(['', '1', '10', '100']);
    expect(displayed.some((d) => /^0\d/.test(d))).toBe(false);
    expect(parseNumberInput(displayed[displayed.length - 1])).toBe(100);
  });
});

describe('clampNumber (applied on blur)', () => {
  it('enforces a minimum so cleared "must be >= 1" fields snap back', () => {
    expect(clampNumber(0, { min: 1 })).toBe(1);
    expect(clampNumber(5, { min: 1 })).toBe(5);
  });

  it('enforces a maximum', () => {
    expect(clampNumber(50, { max: 10 })).toBe(10);
  });

  it('rounds integers', () => {
    expect(clampNumber(2.9, { integer: true })).toBe(2);
  });

  it('falls back to 0 for non-finite input', () => {
    expect(clampNumber(NaN)).toBe(0);
  });
});
