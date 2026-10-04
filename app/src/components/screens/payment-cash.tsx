'use client';

import { useId, type Dispatch, type SetStateAction } from 'react';
import { Keypad, type KeypadKey } from '@/components/ui';
import { useCountUp } from '@/lib/motion';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/components/ui/cn';
import s from './payment/payment.module.css';

/**
 * Cash tender for the payment sheet: the shared Keypad (on-screen + physical keys
 * by e.code, so the Thai layout works) plus the amount / change ledger.
 *
 * The entered amount stays a plain numeric STRING ("200", "155.5") owned by
 * PaymentModal, never formatted text, so `parseFloat` on it is always valid.
 */

type Digit = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';
export type CashKey = Digit | '00' | '.' | 'back' | 'clear';

const MAX_INT_DIGITS = 7;   // ฿9,999,999, far beyond any café bill
const MAX_FRAC_DIGITS = 2;  // satang
/** Banknote / coin steps used for "next note up" presets. */
const NOTE_STEPS = [20, 50, 100, 500, 1000] as const;

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

/**
 * "Next note up" presets: for each note step, the smallest multiple that covers
 * the total, de-duplicated, above the exact amount. ฿155 → 160 · 200 · 500 · 1,000.
 */
export function smartPresets(total: number, max = 4): number[] {
  const out = new Set<number>();
  for (const step of NOTE_STEPS) {
    const v = Math.ceil(total / step) * step;
    if (v > total) out.add(v);
  }
  return [...out].sort((a, b) => a - b).slice(0, max);
}

/** Whole baht stays bare ("1,155"); anything with satang shows both places ("44.50"). */
const fmt = (n: number) =>
  n.toLocaleString('en-US', Number.isInteger(n) ? undefined : { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const baht = (n: number) => `฿${fmt(n)}`;

/** "1234.5" → "1,234.5" · "12." → "12." (keeps what was typed) · "" → "0" */
function formatEntry(value: string): string {
  if (value === '') return '0';
  const [int = '0', frac] = value.split('.');
  const head = Number(int || '0').toLocaleString('en-US');
  return frac === undefined ? head : `${head}.${frac}`;
}

/** The exact-amount string for "พอดี": whole baht stays "155", satang → "155.50". */
export const exactString = (total: number) =>
  Number.isInteger(total) ? String(total) : (Math.round(total * 100) / 100).toFixed(2);

interface CashViewProps {
  total: number;
  cashGiven: string;
  setCashGiven: Dispatch<SetStateAction<string>>;
  /** True when the entered cash covers the total (drives Enter-to-confirm). */
  canConfirm: boolean;
  onConfirm: () => void;
  /** Freeze input (processing, offline). */
  disabled?: boolean;
}

export function CashView({ total, cashGiven, setCashGiven, canConfirm, onConfirm, disabled = false }: CashViewProps) {
  const { t } = useI18n();
  const uid = useId();
  const labelId = `${uid}-label`;
  const hintId = `${uid}-hint`;

  // Satang only exist on the keypad when the bill itself carries them; whole-baht
  // bills (the norm here) get the faster "00" key instead of a dead "." key.
  const allowDecimal = !Number.isInteger(total);
  const { entered, change, shortfall } = cashMath(total, cashGiven);
  const short = entered && shortfall > 0;

  // GSAP count-up on the change figure (spec §8: count-up is one of the two GSAP uses).
  const changeRef = useCountUp(change, { duration: 0.35, format: (n) => baht(Number.isInteger(change) ? Math.round(n) : n) });

  const onKey = (key: KeypadKey) => {
    if (disabled) return;
    if (key === 'enter') {
      if (canConfirm) onConfirm();
      return;
    }
    setCashGiven((prev) => applyCashKey(prev, key, allowDecimal));
  };

  const presets = smartPresets(total);

  return (
    <div className={s.cash}>
      <div className={s.cashLedger}>
        <div className={s.dueRow}>
          <span className={s.dueLabel}>{t.payment.amountDue}</span>
          <span className={cn('num', s.dueValue)}>{baht(total)}</span>
        </div>

        <div className={s.entryRow}>
          {/* Not an <input>: nothing here is text-editable, so no touch device raises
              its soft keyboard. It is still a labelled, focusable field. */}
          <div className={s.entryField}>
            <span id={labelId} className={s.entryLabel}>{t.payment.cashReceived}</span>
            <div
              data-pay-autofocus
              role="textbox"
              aria-readonly="true"
              aria-labelledby={labelId}
              aria-describedby={hintId}
              tabIndex={0}
              className={cn('num', s.entryValue, !entered && s.entryEmpty)}
            >
              ฿{formatEntry(cashGiven)}
            </div>
          </div>
          <button
            type="button"
            className={s.ghostKey}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setCashGiven('')}
            disabled={!entered || disabled}
          >
            {t.payment.clear}
          </button>
        </div>
        <span id={hintId} className="sr-only">{t.payment.cashHint}</span>

        <div className={s.result} data-tone={short ? 'short' : 'ok'}>
          <span className={s.resultLabel}>{short ? t.payment.short : t.payment.change}</span>
          {short ? (
            <span key="short" className={cn('num', s.resultValue)}>{baht(shortfall)}</span>
          ) : (
            <span key="change" ref={changeRef} className={cn('num', s.resultValue)}>{baht(change)}</span>
          )}
        </div>

        <div className={s.presets} role="group" aria-label={t.payment.quickAmounts}>
          <button
            type="button"
            className={cn(s.preset, s.presetExact)}
            aria-label={t.payment.exactAria(baht(total))}
            aria-keyshortcuts="="
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setCashGiven(exactString(total))}
          >
            {t.payment.exact}
          </button>
          {presets.map((p) => (
            <button
              key={p}
              type="button"
              className={cn('num', s.preset)}
              disabled={disabled}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setCashGiven(String(p))}
            >
              {baht(p)}
            </button>
          ))}
        </div>
      </div>

      <Keypad
        variant="cash"
        onKey={onKey}
        extraKey={allowDecimal ? '.' : '00'}
        captureKeyboard={!disabled}
        disabled={disabled}
        ariaLabel={t.payment.keypad}
        className={s.cashKeys}
      />

      {/* The one live region: a single polite sentence per change. */}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {entered ? t.payment.cashLive(fmt(parseFloat(cashGiven) || 0), short, fmt(short ? shortfall : change)) : ''}
      </div>
    </div>
  );
}
