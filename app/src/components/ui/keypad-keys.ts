// Physical-keyboard mapping shared by <Keypad> (login PIN) and <NumpadField>
// (legacy screens). Kept free of CSS imports so the legacy screens can use it
// without pulling in the login primitives' --ds-* stylesheet.

export type KeypadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '.' | '00' | 'back' | 'clear' | 'enter';

const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';

/**
 * Physical key → keypad key, or null. Digits match by `e.code` first, so the
 * Thai Kedmanee layout (whose top row types letters) still enters numbers.
 */
export function mapKey(e: KeyboardEvent): KeypadKey | null {
  if (/^Digit[0-9]$/.test(e.code) && !e.shiftKey) return e.code.slice(5) as KeypadKey;
  if (/^Numpad[0-9]$/.test(e.code)) return e.code.slice(6) as KeypadKey;
  if (/^[0-9]$/.test(e.key)) return e.key as KeypadKey;
  if (e.key.length === 1 && THAI_DIGITS.includes(e.key)) return String(THAI_DIGITS.indexOf(e.key)) as KeypadKey;
  if (e.key === '.' || e.key === ',' || e.code === 'NumpadDecimal') return '.';
  if (e.key === 'Backspace') return 'back';
  if (e.key === 'Delete' || e.key === 'Clear') return 'clear';
  if (e.key === 'Enter' || e.code === 'NumpadEnter') return 'enter';
  return null;
}
