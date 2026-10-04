'use client';

import { useEffect, useId, useRef, type Dispatch, type SetStateAction } from 'react';
import { useCountUp } from '@/lib/motion';
import { haptic } from '@/lib/haptics';
import { useI18n } from '@/lib/i18n';

/**
 * Cash tender entry for the payment dialog: an on-screen keypad (so a phone or
 * tablet never has to raise its OS keyboard) plus the amount / change ledger.
 *
 * The entered amount stays a plain numeric STRING ("200", "155.5") owned by
 * PaymentModal — never formatted text — so `parseFloat` on it is always valid.
 */

type Digit = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';
export type CashKey = Digit | '00' | '.' | 'back' | 'clear';

const MAX_INT_DIGITS = 7;   // ฿9,999,999 — far beyond any café bill
const MAX_FRAC_DIGITS = 2;  // satang
const PRESETS = [100, 200, 500, 1000] as const;
const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';

/** Pure entry reducer: previous string + one key → next string. */
export function applyCashKey(prev: string, key: CashKey, allowDecimal: boolean): string {
  if (key === 'clear') return '';
  if (key === 'back') return prev.slice(0, -1);
  if (key === '.') {
    if (!allowDecimal || prev.includes('.')) return prev;
    return `${prev || '0'}.`;
  }
  const dot = prev.indexOf('.');
  if (dot >= 0) {
    const room = MAX_FRAC_DIGITS - (prev.length - dot - 1);
    return room > 0 ? prev + key.slice(0, room) : prev;
  }
  // No leading zeros: "0" then "5" → "5"; "00" on an empty/zero entry is a no-op.
  if (prev === '' || prev === '0') return key === '00' ? prev : key;
  const room = MAX_INT_DIGITS - prev.length;
  return room > 0 ? prev + key.slice(0, room) : prev;
}

/**
 * Tender arithmetic in whole satang, so a fractional total can never be thrown
 * off by float error (0.1 + 0.2 ≠ 0.3) when deciding whether the cash covers it.
 */
export function cashMath(total: number, cashGiven: string) {
  const given = parseFloat(cashGiven);
  const diff = (Number.isFinite(given) ? Math.round(given * 100) : 0) - Math.round(total * 100);
  return {
    entered: cashGiven !== '',
    enough: diff >= 0,
    change: Math.max(0, diff) / 100,
    shortfall: Math.max(0, -diff) / 100,
  };
}

/** Whole baht stays bare ("1,155"); anything with satang shows both places ("44.50"). */
const fmt = (n: number) =>
  n.toLocaleString('en-US', Number.isInteger(n) ? undefined : { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const baht = (n: number) => `฿${fmt(n)}`;

/** "1234.5" → "1,234.5" · "12." → "12." (keeps what was typed) · "" → "0" */
function formatEntry(value: string): string {
  if (value === '') return '0';
  const [int = '0', frac] = value.split('.');
  const head = Number(int || '0').toLocaleString('en-US');
  return frac === undefined ? head : `${head}.${frac}`;
}

/** The exact-amount string for "พอดี": whole baht stays "155", satang → "155.50". */
const exactString = (total: number) =>
  Number.isInteger(total) ? String(total) : (Math.round(total * 100) / 100).toFixed(2);

interface CashViewProps {
  total: number;
  cashGiven: string;
  setCashGiven: Dispatch<SetStateAction<string>>;
  /** True when the entered cash covers the total (drives Enter-to-confirm). */
  canConfirm: boolean;
  onConfirm: () => void;
}

export function CashView({ total, cashGiven, setCashGiven, canConfirm, onConfirm }: CashViewProps) {
  const { t } = useI18n();
  const uid = useId();
  const labelId = `${uid}-label`;
  const hintId = `${uid}-hint`;
  const entryRef = useRef<HTMLDivElement>(null);

  // Satang only exist on the keypad when the bill itself carries them; whole-baht
  // bills (the norm here) get the faster "00" key instead of a dead "." key.
  const allowDecimal = !Number.isInteger(total);
  const { entered, change, shortfall } = cashMath(total, cashGiven);
  const short = entered && shortfall > 0;

  // Change count-up: the cashier glances here to read what to hand back. The
  // tween makes a changing figure legible instead of flickering between values.
  // In-between frames are rounded to whole baht unless the target itself has satang.
  const changeRef = useCountUp(change, { duration: 0.35, format: (n) => baht(Number.isInteger(change) ? Math.round(n) : n) });

  const press = (key: CashKey) => setCashGiven((prev) => applyCashKey(prev, key, allowDecimal));

  // ── Hardware keyboard (desktop cashier with a numpad) ──────────────────────
  // Document-level so it works wherever focus sits inside the trapped dialog.
  // Escape and Tab are left entirely to useModalA11y.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;

      let key: CashKey | null = null;
      if (/^[0-9]$/.test(e.key)) key = e.key as Digit;
      else if (e.key.length === 1 && THAI_DIGITS.includes(e.key)) key = String(THAI_DIGITS.indexOf(e.key)) as Digit;
      // Thai (Kedmanee) layout: the unshifted top row types Thai letters, not
      // digits. Fall back to the physical key so the cashier need not switch layout.
      else if (!e.shiftKey && /^Digit[0-9]$/.test(e.code)) key = e.code.slice(5) as Digit;
      else if (e.key === 'Backspace') key = 'back';
      else if (e.key === 'Delete' || e.key === 'Clear') key = 'clear';
      else if (e.key === '.' || e.key === ',' || e.code === 'NumpadDecimal') key = '.';

      if (key) {
        e.preventDefault();
        setCashGiven((prev) => applyCashKey(prev, key, allowDecimal));
        return;
      }
      if (e.key === 'Enter') {
        // A focused button/link owns its own Enter (native click) — confirming
        // here as well would double-fire.
        if (target?.closest('button, a, [role="button"]')) return;
        e.preventDefault();
        if (canConfirm && !e.repeat) onConfirm();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [allowDecimal, canConfirm, onConfirm, setCashGiven]);

  // ── On-screen keys ────────────────────────────────────────────────────────
  // Keys act on pointerdown, like a physical key: two-thumb entry overlaps
  // touches, and browsers drop the `click` of an overlapped tap. `click` is kept
  // for keyboard / assistive-tech activation; the marker stops the click that
  // follows a handled pointerdown from entering the digit twice.
  const pointerHandled = useRef<{ key: CashKey; seq: number } | null>(null);
  const seq = useRef(0);
  const keyProps = (key: CashKey) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      pointerHandled.current = { key, seq: ++seq.current };
      press(key);
      haptic();
    },
    onPointerUp: () => {
      // If no click follows (finger slid off), drop the marker so a later
      // assistive-tech click on this key is not swallowed.
      const mine = pointerHandled.current?.seq;
      window.setTimeout(() => { if (pointerHandled.current?.seq === mine) pointerHandled.current = null; }, 500);
    },
    onClick: (e: React.MouseEvent) => {
      if (e.detail > 0 && pointerHandled.current?.key === key) { pointerHandled.current = null; return; }
      press(key);
    },
    onMouseDown: keepFocus,
  });

  const clear = () => {
    setCashGiven('');
    // The clear button disables itself once empty; don't strand keyboard focus on it.
    if (document.activeElement instanceof HTMLButtonElement) entryRef.current?.focus({ preventScroll: true });
  };

  const keys: CashKey[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', allowDecimal ? '.' : '00', '0', 'back'];

  return (
    <div className="cashpad" onTouchStart={noop /* lets iOS Safari apply :active on tap */}>
      <div className="cashpad-summary">
        <div className="cashpad-total">
          <span className="cashpad-total-label">{t.touchPay.amountDue}</span>
          <span className="num cashpad-total-value">{baht(total)}</span>
        </div>

        <div className="cashpad-entry-row">
          <div className="cashpad-field">
            <span id={labelId} className="cashpad-field-label">{t.touchPay.cashReceived}</span>
            {/* Not an <input>: nothing here is text-editable, so no touch device can
                raise its soft keyboard. It is still a focusable, labelled field for
                keyboard and screen-reader users. */}
            <div
              ref={entryRef}
              data-cash-entry
              role="textbox"
              aria-readonly="true"
              aria-labelledby={labelId}
              aria-describedby={hintId}
              tabIndex={0}
              className={`num cashpad-value${entered ? '' : ' is-empty'}`}
            >
              ฿{formatEntry(cashGiven)}
            </div>
          </div>
          <button type="button" className="cashpad-clear pressable" onClick={clear} onMouseDown={keepFocus} disabled={!entered}>
            {t.ui.keyClear}
          </button>
        </div>
        <span id={hintId} className="sr-only">{t.touchPay.cashEntryHint}</span>

        <div className="cashpad-result" data-tone={short ? 'short' : 'ok'}>
          <span className="cashpad-result-label">{short ? t.touchPay.cashShort : t.touchPay.cashChange}</span>
          {short ? (
            <span key="short" className="num cashpad-result-value">{baht(shortfall)}</span>
          ) : (
            <span key="change" ref={changeRef} className="num cashpad-result-value">{baht(change)}</span>
          )}
        </div>

        <div className="cashpad-presets" role="group" aria-label={t.touchPay.quickAmounts}>
          {PRESETS.map((p) => (
            <button key={p} type="button" className="num pressable cashpad-preset" onClick={() => setCashGiven(String(p))} onMouseDown={keepFocus}>
              ฿{fmt(p)}
            </button>
          ))}
          <button
            type="button"
            className="pressable cashpad-preset cashpad-preset-exact"
            aria-label={t.touchPay.exactAria(baht(total))}
            onClick={() => setCashGiven(exactString(total))}
            onMouseDown={keepFocus}
          >
            {t.touchPay.exact}<span className="num cashpad-exact-amount"> {baht(total)}</span>
          </button>
        </div>
      </div>

      <div className="cashpad-keys" role="group" aria-label={t.touchPay.keypad}>
        {keys.map((key) => key === 'back' ? (
          <button key={key} type="button" className="cashpad-key cashpad-key-fn" aria-label={t.ui.keyBackspace} {...keyProps(key)}>
            <BackspaceGlyph />
          </button>
        ) : (
          <button key={key} type="button" className="num cashpad-key" aria-label={key === '.' ? t.ui.keyDecimal : undefined} {...keyProps(key)}>
            {key}
          </button>
        ))}
      </div>

      {/* The one live region: a single polite sentence per change, instead of the
          amount and the change box each announcing themselves. */}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {entered ? t.touchPay.cashLive(fmt(parseFloat(cashGiven) || 0), short, fmt(short ? shortfall : change)) : ''}
      </div>
    </div>
  );
}

const noop = () => {};
/** Keep focus where it is on mouse/touch press, the way a virtual keyboard does:
 *  the amount field stays focused, so Enter still means "confirm". */
const keepFocus = (e: React.MouseEvent) => e.preventDefault();

/** Drawn in the app icon set's style (24 grid, 1.5 round stroke). */
const BackspaceGlyph = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
    <path d="M9 5h10.5A1.5 1.5 0 0 1 21 6.5v11a1.5 1.5 0 0 1-1.5 1.5H9l-6-7z" />
    <path d="M12 9.5l5 5M17 9.5l-5 5" />
  </svg>
);

/**
 * Layout + key styling for the cash method only (card / QR / LINE keep the
 * dialog's original inline styles). Lives here rather than in globals.css
 * because it needs :active and media queries but belongs to this one dialog.
 *
 * Fit strategy:
 *  - < 640px wide: single column, compact ledger rows, keypad at the bottom.
 *  - ≥ 640px wide: two columns (ledger + presets | keypad) in a wider card.
 *  - Key height flexes with the viewport height (48px floor), and if even that
 *    cannot fit, the body scrolls while header and footer stay pinned.
 */
const CASH_CSS = `
.cashpay {
  width: min(440px, 92vw);
  max-height: calc(var(--app-h, 100dvh) - 16px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));
  touch-action: manipulation;
}
.cashpay-head { padding: var(--space-3) var(--space-4); }
.cashpay-body {
  flex: 1 1 auto; min-height: 0;
  overflow-y: auto; overscroll-behavior: contain;
  padding: var(--space-3) var(--space-4);
}
.cashpay-foot {
  flex: none; display: flex; gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border-top: 1px solid var(--color-border);
}

.cashpad {
  --cashpad-key-h: clamp(var(--tap-std), calc((var(--app-h, 100dvh) - 420px) / 4), var(--tap-xl));
  display: grid; gap: var(--space-3);
}
.cashpad-summary { display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; }

.cashpad-total { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-3); padding: 0 var(--space-1); }
.cashpad-total-label { font-size: var(--fs-cap); color: var(--color-text-secondary); }
.cashpad-total-value { font-size: var(--fs-h1); line-height: 1.2; font-weight: 700; color: var(--color-primary); }

.cashpad-entry-row { display: flex; gap: var(--tap-gap); }
.cashpad-field {
  flex: 1; min-width: 0; min-height: var(--tap-lg);
  display: flex; align-items: center; gap: var(--space-2);
  padding: 0 var(--space-3);
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  transition: border-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out);
}
/* Active (the field holds focus whenever the dialog is open): a 1px caramel hairline
   and an accent-50 tint, no ring (owner: no thick lines). The focus ring is drawn
   only for keyboard focus, on the whole field box. */
.cashpad-field:focus-within { border-color: var(--color-accent); background: var(--color-accent-50); }
.cashpad-field:has(.cashpad-value:focus-visible) { outline: 2px solid var(--color-focus-ring); outline-offset: 1px; }
.cashpad-value:focus-visible { outline: none; box-shadow: none; }
.cashpad-field-label { flex: none; font-size: var(--fs-sm); font-weight: 600; }
.cashpad-value {
  flex: 1; min-width: 0;
  font-size: 26px; line-height: 1.2; font-weight: 700; text-align: right;
  white-space: nowrap; overflow: hidden;
  outline: none; cursor: default;
}
.cashpad-value.is-empty { color: var(--color-text-muted); }
.cashpad-clear {
  flex: none; min-width: var(--tap-lg); min-height: var(--tap-std); padding: 0 var(--space-3);
  border: var(--hairline); border-radius: var(--radius-md);
  font-size: var(--fs-sm); font-weight: 600; color: var(--color-text);
}
.cashpad-clear:disabled { opacity: 0.4; cursor: default; }

.cashpad-result {
  display: flex; align-items: center; justify-content: space-between; gap: var(--space-3);
  min-height: var(--tap-std); padding: 0 var(--space-3);
  border-radius: var(--radius-md);
  background: var(--color-success-50);
  /* Plain --color-success is ~3.6:1 on its own tint; nudge toward the text colour for AA. */
  color: color-mix(in srgb, var(--color-success) 68%, var(--color-text));
}
.cashpad-result[data-tone='short'] { background: var(--color-warning-50); color: var(--color-warning-fg); }
.cashpad-result-label { font-size: var(--fs-sm); font-weight: 600; }
.cashpad-result-value { font-size: 22px; line-height: 1.2; font-weight: 700; }

.cashpad-presets { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: var(--tap-gap); }
.cashpad-preset {
  min-height: var(--tap-std); padding: 0 var(--space-1);
  border-radius: var(--radius-sm);
  font-size: var(--fs-sm); font-weight: 600; white-space: nowrap;
  background: var(--color-surface-2); border: var(--hairline);
}
.cashpad-preset-exact { background: var(--color-accent-50); border-color: var(--color-accent); color: var(--color-primary-700); }
.cashpad-exact-amount { display: none; }

.cashpad-keys {
  display: grid; grid-template-columns: repeat(3, minmax(0, 1fr));
  grid-auto-rows: minmax(var(--cashpad-key-h), 1fr);
  gap: var(--tap-gap);
  user-select: none; -webkit-user-select: none;
}
.cashpad-key {
  display: grid; place-items: center;
  font-size: 24px; line-height: 1; font-weight: 600;
  color: var(--color-text);
  background: var(--color-surface-2);
  /* Hairline only (TOUCH-SPEC §1); the surface-2 fill carries the key shape. */
  border: var(--hairline);
  border-radius: var(--radius-md);
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  /* Release eases back; the press itself is instant (see :active). */
  transition: background 100ms var(--ease-out), transform 100ms var(--ease-out);
}
.cashpad-key-fn { background: var(--color-accent-50); color: var(--color-primary-700); } /* tint only; same hairline as the digit keys */
@media (hover: hover) and (pointer: fine) {
  .cashpad-key:hover { border-color: var(--color-border-strong); }
  .cashpad-key-fn:hover { border-color: var(--color-border-strong); }
  .cashpad-preset:hover, .cashpad-clear:not(:disabled):hover { border-color: var(--color-border-strong); }
  .cashpad-preset-exact:hover { border-color: var(--color-accent-600); }
}
.cashpad-key:active { transform: scale(var(--press-scale)); background: var(--color-border); transition-duration: 0s; }
.cashpad-key-fn:active { background: var(--color-accent); color: var(--color-on-accent); }

@media (min-width: 640px) {
  .cashpay { width: min(720px, 92vw); }
  .cashpad {
    --cashpad-key-h: clamp(var(--tap-std), calc((var(--app-h, 100dvh) - 176px) / 4), var(--tap-key));
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr);
    gap: var(--space-5);
  }
}
/* Wide AND tall enough: the original roomy rhythm (centred total, two preset rows). */
@media (min-width: 640px) and (min-height: 560px) {
  .cashpay-head { padding: var(--space-5) var(--space-6); }
  .cashpay-body { padding: var(--space-5) var(--space-6); }
  .cashpay-foot { padding: var(--space-4) var(--space-6); }
  .cashpad-summary { gap: var(--space-3); }
  .cashpad-total { flex-direction: column; align-items: center; gap: var(--space-1); }
  .cashpad-total-label { font-size: var(--fs-sm); }
  .cashpad-total-value { font-size: var(--fs-num-xl); }
  .cashpad-field { min-height: var(--tap-xl); padding: 0 var(--space-4); }
  .cashpad-value { font-size: var(--fs-num-lg); }
  .cashpad-clear { min-width: var(--tap-xl); }
  .cashpad-result { min-height: var(--tap-lg); padding: 0 var(--space-4); }
  .cashpad-presets { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .cashpad-preset-exact { grid-column: span 4; }
  .cashpad-exact-amount { display: inline; }
}
`;

/** Rendered by PaymentModal for the cash method (kept mounted through the
 *  processing / paid beat so the card width does not jump). */
export const CashPayStyles = () => <style>{CASH_CSS}</style>;
