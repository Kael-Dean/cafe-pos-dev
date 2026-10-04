'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../icons';
import { cn } from './cn';
import { Field, fieldIds } from './field';

export interface SelectOption { value: string; label: string; disabled?: boolean }

export interface SelectProps {
  value: string;
  /** Receives the option value (not an event). */
  onChange: (value: string) => void;
  options: SelectOption[];
  /** Shown (muted) when `value` matches no option. */
  placeholder?: string;
  label?: React.ReactNode;
  /** Required when there is no visible `label`. */
  ariaLabel?: string;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  disabled?: boolean;
  /** md 44 · lg 56. */
  size?: 'md' | 'lg';
  menuMaxHeight?: number;
  id?: string;
  className?: string;
}

/**
 * Styled single-select (APG "select-only combobox"). Focus stays on the trigger;
 * the portaled listbox is driven by aria-activedescendant.
 *
 * Keys — closed: ↓ ↑ Enter Space open · typing jumps to a match.
 * Open: ↑ ↓ Home End move · Enter / Space choose · Esc / Tab close · typing jumps.
 *
 * Same props as the legacy `Select` in app-common (minus the inline style escape
 * hatches), so screens can migrate by changing the import.
 */
export function Select({
  value,
  onChange,
  options,
  placeholder,
  label,
  ariaLabel,
  hint,
  error,
  disabled = false,
  size = 'md',
  menuMaxHeight = 280,
  id,
  className,
}: SelectProps) {
  const autoId = useId();
  const ids = fieldIds(id ?? autoId, hint, error);
  const listId = `${ids.controlId}-list`;
  const optId = (i: number) => `${ids.controlId}-opt-${i}`;

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const typed = useRef({ buffer: '', at: 0 });

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;
  const display = selected ? selected.label : (placeholder ?? options[0]?.label ?? '');

  const enabledFrom = (start: number, dir: 1 | -1) => {
    for (let i = start, n = 0; n < options.length; i += dir, n++) {
      const idx = (i + options.length) % options.length;
      if (!options[idx]?.disabled) return idx;
    }
    return -1;
  };

  const openMenu = (at?: number) => {
    if (disabled) return;
    setActive(at ?? (selectedIndex >= 0 ? selectedIndex : enabledFrom(0, 1)));
    setOpen(true);
  };
  const close = useCallback(() => { setOpen(false); setActive(-1); }, []);
  const choose = (i: number) => {
    const opt = options[i];
    if (!opt || opt.disabled) return;
    onChange(opt.value);
    close();
    triggerRef.current?.focus();
  };

  // Typeahead: consecutive keystrokes within 600ms build a prefix.
  const typeahead = (ch: string) => {
    const now = Date.now();
    const st = typed.current;
    st.buffer = now - st.at > 600 ? ch : st.buffer + ch;
    st.at = now;
    const q = st.buffer.toLocaleLowerCase();
    const from = open ? active : selectedIndex;
    for (let n = 1; n <= options.length; n++) {
      const i = (from + n + options.length) % options.length;
      const o = options[i];
      if (!o.disabled && o.label.toLocaleLowerCase().startsWith(q)) return i;
    }
    return -1;
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const k = e.key;
    if (!open) {
      if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Enter' || k === ' ') {
        e.preventDefault();
        openMenu();
      } else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const i = typeahead(k);
        if (i >= 0) onChange(options[i].value);
      }
      return;
    }
    switch (k) {
      case 'ArrowDown': e.preventDefault(); setActive(enabledFrom(active + 1, 1)); break;
      case 'ArrowUp': e.preventDefault(); setActive(enabledFrom(active - 1, -1)); break;
      case 'Home': e.preventDefault(); setActive(enabledFrom(0, 1)); break;
      case 'End': e.preventDefault(); setActive(enabledFrom(options.length - 1, -1)); break;
      case 'Enter':
      case ' ': e.preventDefault(); choose(active); break;
      // Stop here so an enclosing Modal does not also close on this Escape.
      case 'Escape': e.preventDefault(); e.stopPropagation(); close(); break;
      case 'Tab': close(); break;
      default:
        if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const i = typeahead(k);
          if (i >= 0) setActive(i);
        }
    }
  };

  // Position the portaled menu under (or above) the trigger. Written as CSS
  // variables on the menu node, so ui.css owns the actual layout.
  const place = useCallback(() => {
    const t = triggerRef.current;
    const m = menuRef.current;
    if (!t || !m) return;
    const r = t.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 8;
    const above = r.top - 8;
    const up = below < Math.min(menuMaxHeight, 200) && above > below;
    m.style.setProperty('--ui-menu-x', `${r.left}px`);
    m.style.setProperty('--ui-menu-w', `${r.width}px`);
    m.style.setProperty('--ui-menu-y', `${up ? window.innerHeight - r.top + 4 : r.bottom + 4}px`);
    m.style.setProperty('--ui-menu-h', `${Math.max(120, Math.min(menuMaxHeight, up ? above : below))}px`);
    m.toggleAttribute('data-up', up);
  }, [menuMaxHeight]);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onMove = () => place();
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      close();
    };
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    document.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open, place, close]);

  // Keep the active option in view while arrowing through a long list.
  useEffect(() => {
    if (!open || active < 0) return;
    document.getElementById(optId(active))?.scrollIntoView({ block: 'nearest' });
    // optId is derived from the stable controlId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active]);

  return (
    <Field ids={ids} label={label} hint={hint} error={error} className={cn('ui-select', size === 'lg' && 'ui-select--lg', className)}>
      <button
        ref={triggerRef}
        id={ids.controlId}
        type="button"
        role="combobox"
        className="ui-select__trigger"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? optId(active) : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={ids.describedBy}
        data-invalid={error ? '' : undefined}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onKeyDown}
      >
        <span className="ui-select__value" data-placeholder={selected ? undefined : ''}>{display}</span>
        <Icon name="chevronDown" size={16} className="ui-select__chevron" />
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div ref={menuRef} id={listId} role="listbox" aria-label={ariaLabel} className="ui-select__menu">
          {options.map((opt, i) => (
            <div
              key={opt.value}
              id={optId(i)}
              role="option"
              aria-selected={opt.value === value}
              aria-disabled={opt.disabled || undefined}
              data-active={i === active ? '' : undefined}
              className="ui-select__option"
              // Keep focus on the trigger (activedescendant pattern).
              onPointerDown={(e) => e.preventDefault()}
              onPointerMove={() => { if (!opt.disabled && i !== active) setActive(i); }}
              onClick={() => choose(i)}
            >
              <span>{opt.label}</span>
              {opt.value === value && <Icon name="check" size={16} strokeWidth={2} />}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </Field>
  );
}
