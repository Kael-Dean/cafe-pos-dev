'use client';

/**
 * NumpadField: a money / quantity / digit-string field with its own on-screen
 * keypad, for the touch core flow (payment, membership phone lookup, qty edits).
 * It never renders an <input>, so no tablet or phone raises its soft keyboard.
 *
 * Built on the cash-tender pattern (screens/payment-cash.tsx): keys act on
 * pointerdown (two-thumb entry overlaps touches and browsers drop the click of
 * an overlapped tap), the trailing click is swallowed, and keyboard / assistive
 * tech clicks still work. Each key press gives an 8ms haptic tick.
 *
 * Styling is the legacy app look (globals.css "NumpadField", --color-* and --tap-*
 * tokens), not the login primitives' --ds-* look.
 *
 * The value is a plain numeric STRING owned by the caller ("" · "155" · "155.5" ·
 * "0812345678"), never formatted text, so `parseFloat(value)` is always safe.
 *
 *   const [cash, setCash] = useState('');
 *   <NumpadField label="เงินที่รับมา" value={cash} onChange={setCash} mode="money"
 *     presets={[{ label: '฿100', value: '100' }, { label: '฿500', value: '500' }]}
 *     onEnter={confirm} />
 */

import { useEffect, useId, useRef } from 'react';
import Icon from '../icons';
import { useI18n } from '@/lib/i18n';
import { haptic } from '@/lib/haptics';
import { mapKey, type KeypadKey } from './keypad-keys';
import { cn } from './cn';

export type NumpadMode = 'money' | 'qty' | 'digits';
type EntryKey = Exclude<KeypadKey, 'enter'>;

export interface NumpadRules {
  mode: NumpadMode;
  /** money only: allow up to 2 satang digits ('.' key replaces '00'). */
  allowDecimal?: boolean;
  /** Max integer digits (money 7, qty 3) or total digits (digits 10). */
  maxLength?: number;
}

const DEFAULT_MAX: Record<NumpadMode, number> = { money: 7, qty: 3, digits: 10 };
const MAX_FRAC = 2;

/** Pure entry reducer: previous string + one key → next string. */
export function applyNumpadKey(prev: string, key: EntryKey, rules: NumpadRules): string {
  const { mode, allowDecimal = false } = rules;
  const max = rules.maxLength ?? DEFAULT_MAX[mode];
  if (key === 'clear') return '';
  if (key === 'back') return prev.slice(0, -1);

  // Phone numbers, PINs, codes: leading zeros are data.
  if (mode === 'digits') {
    if (key === '.') return prev;
    const room = max - prev.length;
    return room > 0 ? prev + key.slice(0, room) : prev;
  }

  if (key === '.') {
    if (mode !== 'money' || !allowDecimal || prev.includes('.')) return prev;
    return `${prev || '0'}.`;
  }
  const dot = prev.indexOf('.');
  if (dot >= 0) {
    const room = MAX_FRAC - (prev.length - dot - 1);
    return room > 0 ? prev + key.slice(0, room) : prev;
  }
  // No leading zeros: "0" then "5" → "5"; "00" on an empty/zero entry is a no-op.
  if (prev === '' || prev === '0') return key === '00' ? prev : key;
  const room = max - prev.length;
  return room > 0 ? prev + key.slice(0, room) : prev;
}

/** "1234.5" → "1,234.5" · "12." → "12." (keeps what was typed). */
function groupThousands(value: string): string {
  const [int = '0', frac] = value.split('.');
  const head = Number(int || '0').toLocaleString('en-US');
  return frac === undefined ? head : `${head}.${frac}`;
}

export interface NumpadPreset { label: string; value: string; }

export interface NumpadFieldProps {
  /** Visible label inside the display (also its accessible name). */
  label: string;
  /** Raw numeric string. Empty string = nothing entered. */
  value: string;
  onChange: (next: string) => void;
  /** `money` (default): ฿ prefix, thousands separators, '00' or '.' key.
   *  `qty`: whole numbers, no prefix. `digits`: raw digit string (phone, code), leading zeros kept. */
  mode?: NumpadMode;
  /** money only: bill carries satang, so offer '.' instead of '00'. */
  allowDecimal?: boolean;
  /** Max integer digits (money/qty) or total digits (digits). Defaults 7 / 3 / 10. */
  maxLength?: number;
  /** Text before the value. Default '฿' for money, none otherwise. */
  prefix?: string;
  /** Custom display formatting of a non-empty value (e.g. phone "081-234-5678"). */
  format?: (value: string) => string;
  /** Shown muted while empty. Default '0' (money/qty) or '–' (digits). */
  placeholder?: string;
  /** Helper line under the display. */
  hint?: string;
  /** Error line under the display; marks the field invalid. */
  error?: string;
  /** Quick-fill buttons ("฿100", "พอดี"), each sets the whole value. */
  presets?: NumpadPreset[];
  /** Hardware Enter (when focus is not on a button). Typically "confirm". */
  onEnter?: () => void;
  /**
   * Mirror the physical keyboard (digits by e.code so the Thai layout works,
   * Numpad, '.', Backspace, Delete, Enter) while mounted. Default true; set false
   * when more than one NumpadField is on screen, or every one of them would type.
   */
  captureKeyboard?: boolean;
  /** Key height: `lg` (default) = --tap-key (72 at ≥768, 56 on phones), `md` = --tap-lg 56. */
  size?: 'md' | 'lg';
  disabled?: boolean;
  className?: string;
}

export function NumpadField({
  label,
  value,
  onChange,
  mode = 'money',
  allowDecimal = false,
  maxLength,
  prefix,
  format,
  placeholder,
  hint,
  error,
  presets,
  onEnter,
  captureKeyboard = true,
  size = 'lg',
  disabled = false,
  className,
}: NumpadFieldProps) {
  const { t } = useI18n();
  const uid = useId();
  const labelId = `${uid}-label`;
  const msgId = `${uid}-msg`;
  const displayRef = useRef<HTMLDivElement>(null);
  const padRef = useRef<HTMLDivElement>(null);

  const rules: NumpadRules = { mode, allowDecimal, maxLength };
  // Read the latest props from listeners without re-subscribing every render.
  const latest = useRef({ value, onChange, onEnter, rules, disabled });
  useEffect(() => { latest.current = { value, onChange, onEnter, rules, disabled }; });

  const press = (key: EntryKey) => {
    const cur = latest.current;
    if (cur.disabled) return;
    const next = applyNumpadKey(cur.value, key, cur.rules);
    if (next !== cur.value) cur.onChange(next);
  };

  // Brief pressed look on the on-screen key a physical key maps to.
  const flash = (key: EntryKey) => {
    const el = padRef.current?.querySelector<HTMLElement>(`[data-key="${key}"]`);
    if (!el) return;
    el.setAttribute('data-pressed', '');
    window.setTimeout(() => el.removeAttribute('data-pressed'), 100);
  };

  // ── Hardware keyboard ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!captureKeyboard) return;
    const onKey = (e: KeyboardEvent) => {
      if (latest.current.disabled || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const key = mapKey(e);
      if (!key) return;
      if (key === 'enter') {
        // A focused button / link owns its own Enter (native click).
        if (target?.closest('button, a, [role="button"]')) return;
        if (!latest.current.onEnter) return;
        e.preventDefault();
        if (!e.repeat) latest.current.onEnter();
        return;
      }
      if (key === '00') return; // no physical "00" key
      e.preventDefault();
      press(key);
      flash(key);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [captureKeyboard]); // press/flash read refs only

  // ── On-screen keys: act on pointerdown, swallow the trailing click ──────────
  const handled = useRef<{ key: EntryKey; seq: number } | null>(null);
  const seq = useRef(0);
  const keyProps = (key: EntryKey) => ({
    onMouseDown: keepFocus,
    onPointerDown: (e: React.PointerEvent) => {
      if (disabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
      handled.current = { key, seq: ++seq.current };
      press(key);
      haptic();
    },
    onPointerUp: () => {
      // No click followed (finger slid off): drop the marker so a later
      // assistive-tech click on this key is not swallowed.
      const mine = handled.current?.seq;
      window.setTimeout(() => { if (handled.current?.seq === mine) handled.current = null; }, 500);
    },
    onClick: (e: React.MouseEvent) => {
      if (e.detail > 0 && handled.current?.key === key) { handled.current = null; return; }
      press(key);
    },
  });

  const clear = () => {
    onChange('');
    // The clear button disables itself once empty; don't strand keyboard focus on it.
    if (document.activeElement instanceof HTMLButtonElement) displayRef.current?.focus({ preventScroll: true });
  };

  const empty = value === '';
  const shownPrefix = prefix ?? (mode === 'money' ? '฿' : '');
  const shown = empty
    ? (placeholder ?? (mode === 'digits' ? '–' : '0'))
    : format ? format(value) : mode === 'digits' ? value : groupThousands(value);

  const bottomLeft: EntryKey | null = mode === 'money' ? (allowDecimal ? '.' : '00') : null;
  const keys: Array<EntryKey | null> = ['1', '2', '3', '4', '5', '6', '7', '8', '9', bottomLeft, '0', 'back'];
  const keyName: Partial<Record<EntryKey, string>> = {
    back: t.ui.keyBackspace, '.': t.ui.keyDecimal, '00': t.ui.keyDoubleZero,
  };
  const message = error || hint;

  return (
    <div className={cn('numpad', size === 'md' && 'numpad--md', className)} data-disabled={disabled || undefined}>
      <div className="numpad-display-row">
        {/* Not an <input>: nothing is text-editable, so no soft keyboard. Still a
            focusable, labelled field for keyboard and screen-reader users. */}
        <div
          ref={displayRef}
          className="numpad-display"
          role="textbox"
          aria-readonly="true"
          aria-labelledby={labelId}
          aria-describedby={message ? msgId : undefined}
          aria-invalid={error ? true : undefined}
          aria-disabled={disabled || undefined}
          tabIndex={disabled ? -1 : 0}
        >
          <span id={labelId} className="numpad-label">{label}</span>
          <span className={cn('num numpad-value', empty && 'is-empty')}>{shownPrefix}{shown}</span>
        </div>
        <button
          type="button"
          className="numpad-clear tap"
          onClick={clear}
          onMouseDown={keepFocus}
          disabled={disabled || empty}
        >
          {t.ui.keyClear}
        </button>
      </div>

      {message && (
        <div id={msgId} className={cn('numpad-msg', error && 'is-error')} role={error ? 'alert' : undefined}>
          {message}
        </div>
      )}

      {presets && presets.length > 0 && (
        <div className="numpad-presets">
          {presets.map((p) => (
            <button
              key={`${p.label}-${p.value}`}
              type="button"
              className="num numpad-preset tap"
              disabled={disabled}
              aria-pressed={p.value === value}
              onClick={() => { onChange(p.value); haptic(); }}
              onMouseDown={keepFocus}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      <div ref={padRef} className="numpad-keys" role="group" aria-label={label}>
        {keys.map((key, i) => key == null ? <span key={`gap-${i}`} aria-hidden="true" /> : (
          <button
            key={key}
            type="button"
            data-key={key}
            disabled={disabled}
            aria-label={keyName[key]}
            className={cn('numpad-key', key === 'back' && 'numpad-key--fn')}
            {...keyProps(key)}
          >
            {key === 'back' ? <Icon name="chevronLeft" size={24} strokeWidth={2} /> : <span className="num">{key}</span>}
          </button>
        ))}
      </div>

      {/* One polite sentence per change (the readonly textbox itself is silent). */}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {empty ? '' : `${label} ${shownPrefix}${shown}`}
      </div>
    </div>
  );
}

/** Keep focus where it is on mouse/touch press, the way a hardware pad does. */
const keepFocus = (e: React.MouseEvent) => e.preventDefault();
