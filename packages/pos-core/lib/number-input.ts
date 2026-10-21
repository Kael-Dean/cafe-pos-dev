/**
 * Shared logic for controlled number inputs.
 *
 * The bug this fixes (reported on iPad/tablets, but present anywhere):
 * binding a numeric state straight to `<input value>` and coercing onChange with
 * `Number(e.target.value)` turns an empty field into `0`. The box can therefore
 * never be cleared — it shows a stuck "0" that new digits append to, so typing
 * 100 after clearing produces "0100".
 *
 * These helpers let the field hold an empty *draft* string while still reporting
 * a plain `number` to the parent, so clearing the box really leaves it empty and
 * waits for fresh input.
 */

export interface NumberInputOptions {
  /** Round the parsed value to an integer. */
  integer?: boolean;
  /** Number reported to the parent when the field is empty. Default 0. */
  emptyValue?: number;
}

export interface ClampOptions {
  min?: number;
  max?: number;
  integer?: boolean;
}

/** What to show in the box for a numeric value when the user is NOT editing. */
export function displayNumber(value: number, emptyValue = 0): string {
  if (!Number.isFinite(value)) return '';
  if (value === emptyValue) return ''; // empty box instead of a stuck "0"
  return String(value);
}

/** Convert the raw text the user typed into the number to report to the parent. */
export function parseNumberInput(raw: string, opts: NumberInputOptions = {}): number {
  const { integer = false, emptyValue = 0 } = opts;
  const trimmed = raw.trim();
  // Empty / intermediate states report emptyValue but leave the visible draft alone.
  if (trimmed === '' || trimmed === '-' || trimmed === '.' || trimmed === '-.') return emptyValue;
  const n = Number(trimmed);
  if (Number.isNaN(n)) return emptyValue;
  return integer ? Math.trunc(n) : n;
}

/** Normalise on blur: round then clamp to bounds. */
export function clampNumber(n: number, opts: ClampOptions = {}): number {
  const { min, max, integer = false } = opts;
  let v = Number.isFinite(n) ? n : 0;
  if (integer) v = Math.trunc(v);
  if (typeof min === 'number') v = Math.max(min, v);
  if (typeof max === 'number') v = Math.min(max, v);
  return v;
}
