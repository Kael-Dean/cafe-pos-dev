'use client';

import { useEffect, useRef } from 'react';

/**
 * Keyboard shortcut registry (UI-SPEC-core §4.1).
 *
 * Matches on `KeyboardEvent.code` (the physical key), never `key`: the Thai
 * Kedmanee layout maps the number row and most punctuation to Thai characters,
 * so `key === '1'` silently fails for a Thai-layout cashier while `code ===
 * 'Digit1'` works on every layout.
 *
 * While focus is in a text field, bindings are skipped EXCEPT Escape, Enter,
 * F-keys and Ctrl/⌘ combos (or a binding that opts in with `allowInInput`).
 * While any modal dialog is open (`[aria-modal="true"]` in the DOM) the scope
 * stands down — the top-most overlay owns input — unless `allowWithModal` is set.
 */

export type HotkeyScope = 'global' | 'pos' | 'payment' | 'receipt' | 'kds' | 'floor';

export interface HotkeyBinding {
  /** One or more `KeyboardEvent.code` values: 'F12', 'Digit1', 'Slash', 'BracketLeft', 'NumpadAdd' … */
  code: string | readonly string[];
  /** Requires Ctrl (or ⌘ on macOS). Default false = must NOT be held. */
  ctrl?: boolean;
  /** Requires Alt. Default false = must NOT be held. */
  alt?: boolean;
  /** Requires Shift (true), forbids it (false, default) or ignores it ('any'). */
  shift?: boolean | 'any';
  /** Fire even while typing in a field. Escape / Enter / F-keys / Ctrl-combos already do. */
  allowInInput?: boolean;
  /** Never fire while typing, even for a Ctrl combo (Ctrl+Backspace deletes a word in a field). */
  blockInInput?: boolean;
  /** Fire on auto-repeat while the key is held (default false; true suits +/-). */
  repeat?: boolean;
  /** Call preventDefault() when the binding fires (default true). */
  preventDefault?: boolean;
  /** Skip this binding without re-registering (default true). */
  enabled?: boolean;
  handler: (e: KeyboardEvent) => void;
}

export interface UseHotkeysOptions {
  scope: HotkeyScope;
  /** Master switch for every binding in this call (default true). */
  enabled?: boolean;
  /** Keep firing while a modal dialog is open (default false). */
  allowWithModal?: boolean;
}

const FKEY = /^F([1-9]|1[0-2])$/;

/** True when the event target is somewhere the user is typing text. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type;
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(type);
  }
  const role = target.getAttribute('role');
  return role === 'textbox' || role === 'searchbox' || role === 'combobox' || role === 'spinbutton';
}

function passesInInput(e: KeyboardEvent, b: HotkeyBinding): boolean {
  if (b.blockInInput) return false;
  if (b.allowInInput) return true;
  if (e.code === 'Escape' || e.code === 'Enter' || e.code === 'NumpadEnter') return true;
  if (FKEY.test(e.code)) return true;
  return e.ctrlKey || e.metaKey;
}

function matches(e: KeyboardEvent, b: HotkeyBinding): boolean {
  const codes = typeof b.code === 'string' ? [b.code] : b.code;
  if (!codes.includes(e.code)) return false;
  const ctrl = e.ctrlKey || e.metaKey;
  if (!!b.ctrl !== ctrl) return false;
  if (!!b.alt !== e.altKey) return false;
  const shift = b.shift ?? false;
  if (shift !== 'any' && shift !== e.shiftKey) return false;
  return true;
}

function modalOpen(): boolean {
  return typeof document !== 'undefined' && document.querySelector('[aria-modal="true"]') !== null;
}

export function useHotkeys(bindings: HotkeyBinding[], options: UseHotkeysOptions): void {
  const latest = useRef({ bindings, options });
  useEffect(() => { latest.current = { bindings, options }; });

  const enabled = options.enabled ?? true;

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
      const { bindings: list, options: opts } = latest.current;
      if (opts.enabled === false) return;
      if (!opts.allowWithModal && modalOpen()) return;
      const typing = isTypingTarget(e.target);
      for (const b of list) {
        if (b.enabled === false) continue;
        if (!matches(e, b)) continue;
        if (e.repeat && !b.repeat) continue;
        if (typing && !passesInInput(e, b)) continue;
        if (b.preventDefault !== false) e.preventDefault();
        b.handler(e);
        return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}

/** Digit row + numpad codes for 1–9, index 0 = "1". */
export const DIGIT_CODES: readonly (readonly [string, string])[] = Array.from({ length: 9 }, (_, i) => [
  `Digit${i + 1}`,
  `Numpad${i + 1}`,
] as const);
