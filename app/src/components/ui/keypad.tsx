'use client';

import { useEffect, useRef } from 'react';
import './tokens.css';
import './ui.css';
import Icon from '../icons';
import { useI18n } from '@/lib/i18n';
import { haptic } from '@/lib/haptics';
import { cn } from './cn';
import { mapKey, type KeypadKey } from './keypad-keys';

export type { KeypadKey } from './keypad-keys';

/** Ref that always holds the latest value (read from listeners without re-subscribing). */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => { ref.current = value; });
  return ref;
}

export interface KeypadProps {
  /** `cash` = 64px keys in a fluid grid · `pin` = round 64/72px keys (≥768px). */
  variant?: 'cash' | 'pin';
  /** Receives one key per press (pointer, keyboard activation or physical key). */
  onKey: (key: KeypadKey) => void;
  /**
   * Bottom-left key. Cash default: '00' ('.' when the amount allows satang).
   * PIN default: 'clear'.
   */
  extraKey?: '.' | '00' | 'clear' | null;
  /** Show a primary ✓ key in place of backspace's neighbour (PIN 4–5 digits). Backspace moves to extraKey's slot when set. */
  showEnter?: boolean;
  /**
   * Mirror the physical keyboard while mounted: digits (by e.code, so the Thai
   * Kedmanee layout works), Numpad, '.', Backspace, Delete, Enter. Ignored while
   * focus is in a text field or a modifier is held.
   */
  captureKeyboard?: boolean;
  disabled?: boolean;
  /** Accessible name of the pad ("แป้นตัวเลข"). */
  ariaLabel?: string;
  className?: string;
}


/**
 * Shared numeric pad for login PIN and cash tender. Keys fire on pointerdown
 * (two-thumb entry overlaps touches and browsers drop the click of an overlapped
 * tap); the trailing click is swallowed, while keyboard / assistive-tech clicks
 * still work. The pad never focuses a text input, so no soft keyboard appears.
 *
 *   <Keypad variant="pin" onKey={handlePinKey} captureKeyboard showEnter={pin.length >= 4} />
 */
export function Keypad({
  variant = 'cash',
  onKey,
  extraKey,
  showEnter = false,
  captureKeyboard = false,
  disabled = false,
  ariaLabel,
  className,
}: KeypadProps) {
  const { t } = useI18n();
  const latest = useLatest({ onKey, disabled });
  const padRef = useRef<HTMLDivElement>(null);
  const handled = useRef<{ key: KeypadKey; seq: number } | null>(null);
  const seq = useRef(0);

  const extra = extraKey === undefined ? (variant === 'pin' ? 'clear' : '00') : extraKey;
  const bottom: Array<KeypadKey | null> = showEnter ? ['back', '0', 'enter'] : [extra, '0', 'back'];
  const keys: Array<KeypadKey | null> = ['1', '2', '3', '4', '5', '6', '7', '8', '9', ...bottom];

  const name: Partial<Record<KeypadKey, string>> = {
    back: t.ui.keyBackspace, clear: t.ui.keyClear, enter: t.ui.keyEnter, '.': t.ui.keyDecimal, '00': t.ui.keyDoubleZero,
  };

  // Brief pressed look on the on-screen key that a physical key maps to.
  const flash = (key: KeypadKey) => {
    const el = padRef.current?.querySelector<HTMLElement>(`[data-key="${key}"]`);
    if (!el) return;
    el.setAttribute('data-pressed', '');
    window.setTimeout(() => el.removeAttribute('data-pressed'), 100);
  };

  useEffect(() => {
    if (!captureKeyboard) return;
    const onDown = (e: KeyboardEvent) => {
      if (latest.current.disabled || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const key = mapKey(e);
      if (!key) return;
      // A focused button owns its own Enter / Space.
      if (key === 'enter' && target?.closest('button, a, [role="button"]')) return;
      e.preventDefault();
      if (e.repeat && key === 'enter') return;
      latest.current.onKey(key);
      flash(key);
    };
    document.addEventListener('keydown', onDown);
    return () => document.removeEventListener('keydown', onDown);
  }, [captureKeyboard, latest]);

  return (
    <div
      ref={padRef}
      role="group"
      aria-label={ariaLabel}
      className={cn('ui-keypad', variant === 'pin' && 'ui-keypad--pin', className)}
    >
      {keys.map((key, i) =>
        key == null ? <span key={`gap-${i}`} aria-hidden="true" /> : (
          <button
            key={key}
            type="button"
            data-key={key}
            disabled={disabled}
            aria-label={name[key]}
            className={cn('ui-key', (key === 'back' || key === 'clear') && 'ui-key--fn', key === 'enter' && 'ui-key--enter')}
            // Keep focus where it is (the amount display / PIN dots), like a hardware pad.
            onMouseDown={(e) => e.preventDefault()}
            onPointerDown={(e) => {
              if (disabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
              handled.current = { key, seq: ++seq.current };
              onKey(key);
              haptic();
            }}
            onPointerUp={() => {
              // No click followed (finger slid off): drop the marker so a later
              // assistive-tech click on this key is not swallowed.
              const mine = handled.current?.seq;
              window.setTimeout(() => { if (handled.current?.seq === mine) handled.current = null; }, 500);
            }}
            onClick={(e) => {
              if (e.detail > 0 && handled.current?.key === key) { handled.current = null; return; }
              onKey(key);
            }}
          >
            {key === 'back' ? <Icon name="chevronLeft" size={22} strokeWidth={2} />
              : key === 'enter' ? <Icon name="check" size={24} strokeWidth={2.25} />
              : key === 'clear' ? t.ui.keyClear
              : key}
          </button>
        ),
      )}
    </div>
  );
}
