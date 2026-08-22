'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './icon';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  /** Muted second line — e.g. why a retired package can't be picked. */
  note?: string;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  /** Shown (muted) when the value matches no option. */
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  id?: string;
  describedBy?: string;
  menuMaxHeight?: number;
}

/**
 * The app's only dropdown. Never a native <select>: the OS draws that popup and
 * it cannot be styled, so it looks foreign next to everything else — and it
 * can't carry the "เลิกขายแล้ว" note a retired package needs.
 *
 * The menu is portaled to <body> so it escapes any clipped ancestor, and its
 * position is measured from the trigger on open, scroll and resize (flipping
 * upward when there is no room below).
 */
export function Select({
  value, onChange, options, placeholder, disabled = false,
  ariaLabel, id, describedBy, menuMaxHeight = 300,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; maxHeight: number; up: boolean } | null>(null);

  const selected = options.find((o) => o.value === value);
  const displayLabel = selected ? selected.label : (placeholder ?? '— เลือก —');
  const isPlaceholder = !selected;

  /** Measure the trigger and decide where the menu goes. Pure — returns, never sets. */
  const measure = useCallback((): typeof pos => {
    const el = ref.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const gap = 4;
    const spaceBelow = window.innerHeight - r.bottom - 8;
    const spaceAbove = r.top - 8;
    const up = spaceBelow < Math.min(menuMaxHeight, 200) && spaceAbove > spaceBelow;
    return {
      left: r.left,
      width: r.width,
      top: up ? r.top - gap : r.bottom + gap,
      maxHeight: Math.max(120, Math.min(menuMaxHeight, up ? spaceAbove : spaceBelow)),
      up,
    };
  }, [menuMaxHeight]);

  // Opening is an event, so the measurement happens here rather than in an
  // effect — one render instead of two, and no layout flash.
  const openMenu = useCallback(() => {
    setPos(measure());
    setActiveIndex(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  }, [measure, options, value]);

  const closeMenu = useCallback(() => {
    setOpen(false);
    setPos(null);
    setActiveIndex(-1);
  }, []);

  const commit = useCallback((v: string) => {
    onChange(v);
    closeMenu();
    ref.current?.querySelector('button')?.focus();
  }, [onChange, closeMenu]);

  // While open, follow the trigger and dismiss on an outside click. Every
  // setState below runs from a listener callback, not the effect body.
  useEffect(() => {
    if (!open) return;
    const onMove = () => setPos(measure());
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || menuRef.current?.contains(t)) return;
      closeMenu();
    };
    document.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open, measure, closeMenu]);

  const step = (dir: 1 | -1) => {
    setActiveIndex((cur) => {
      const n = options.length;
      for (let i = 1; i <= n; i++) {
        const next = (cur + dir * i + n * 2) % n;
        if (!options[next]?.disabled) return next;
      }
      return cur;
    });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); step(1); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); step(-1); return; }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const opt = options[activeIndex];
      if (opt && !opt.disabled) commit(opt.value);
    }
  };

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        onClick={() => { if (disabled) return; if (open) closeMenu(); else openMenu(); }}
        onKeyDown={onKeyDown}
        className="input-std"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
          textAlign: 'left',
          cursor: disabled ? 'not-allowed' : 'pointer',
          borderColor: open ? 'var(--color-accent)' : undefined,
          boxShadow: open ? 'var(--shadow-focus)' : undefined,
          color: isPlaceholder ? 'var(--color-text-muted)' : 'var(--color-text)',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayLabel}</span>
        <Icon
          name="chevronDown"
          size={14}
          style={{ color: 'var(--color-text-secondary)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms', flexShrink: 0 }}
        />
      </button>

      {open && pos && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          role="listbox"
          aria-label={ariaLabel}
          className="scroll"
          style={{
            position: 'fixed', left: pos.left, width: pos.width,
            top: pos.up ? undefined : pos.top,
            bottom: pos.up ? window.innerHeight - pos.top : undefined,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-md)',
            zIndex: 2000,
            overflowY: 'auto', maxHeight: pos.maxHeight, padding: 4,
          }}
        >
          {options.length === 0 && (
            <p style={{ padding: '10px 12px', fontSize: 'var(--fs-13)', color: 'var(--color-text-muted)' }}>
              ไม่มีตัวเลือก
            </p>
          )}
          {options.map((opt, i) => {
            const isSel = opt.value === value;
            const isActive = i === activeIndex;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isSel}
                disabled={opt.disabled}
                onMouseEnter={() => !opt.disabled && setActiveIndex(i)}
                onClick={() => { if (!opt.disabled) commit(opt.value); }}
                style={{
                  width: '100%', display: 'block', textAlign: 'left',
                  padding: '9px 10px', borderRadius: 'var(--radius-sm)',
                  fontSize: 'var(--fs-14)', fontFamily: 'inherit',
                  cursor: opt.disabled ? 'not-allowed' : 'pointer',
                  background: isSel
                    ? 'var(--color-accent-50)'
                    : isActive && !opt.disabled
                      ? 'var(--color-surface-2)'
                      : 'transparent',
                  color: opt.disabled
                    ? 'var(--color-text-muted)'
                    : isSel ? 'var(--color-primary-700)' : 'var(--color-text)',
                  fontWeight: isSel ? 'var(--fw-semibold)' : 'var(--fw-regular)',
                }}
              >
                {opt.label}
                {opt.note && (
                  <span style={{ display: 'block', fontSize: 'var(--fs-12)', color: 'var(--color-text-muted)', fontWeight: 400, marginTop: 1 }}>
                    {opt.note}
                  </span>
                )}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}
