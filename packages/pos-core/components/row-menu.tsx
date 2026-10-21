'use client';

import { useState, useRef, useEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import Icon from './icons';

// ── RowMenu ("⋯" overflow menu for a table row) ──────────────────────────────
// Holds the rare and destructive actions of a row so the row itself only shows
// the one or two buttons people press every day. WAI-ARIA menu-button pattern:
// trigger is `aria-haspopup="menu"`, popup is `role="menu"` with roving focus
// (Arrow keys wrap, Home/End jump, Escape closes and returns focus to the trigger).
// Not a dialog — Tab is allowed to leave, so this deliberately does NOT use
// useModalA11y's focus trap.

export type RowMenuItem =
  | { id: string; label: string; icon?: string; tone?: 'danger'; disabled?: boolean; onSelect: () => void }
  | { id: string; separator: true };

interface RowMenuProps {
  /** Accessible name for both the trigger and the menu, e.g. "เมนูเพิ่มเติม Whole Milk". */
  label: string;
  items: RowMenuItem[];
  /** Which edge of the trigger the menu lines up with. `end` for right-most table cells. */
  align?: 'start' | 'end';
  /** Trigger box in px (square). */
  size?: number;
  /** Extra classes on the trigger (e.g. `hit-44` on touch layouts). */
  className?: string;
}

const MENU_WIDTH = 200;
const MENU_MAX_HEIGHT = 320;
type MenuPos = { left: number; top: number; maxHeight: number; up: boolean };

const isSeparator = (it: RowMenuItem): it is { id: string; separator: true } => 'separator' in it;

const ENABLED_ITEM = '[role="menuitem"]:not([disabled])';

export function RowMenu({ label, items, align = 'start', size = 30, className = '' }: RowMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  // `pos` doubles as the open flag: measured from the trigger at the moment it
  // opens, null while closed. Menu is portaled to <body> so it escapes the
  // card's overflow:hidden (a plain position:fixed would still be trapped by
  // the GSAP transform on the screen root) and flips upward when there's no
  // room below — same approach as the shared Select.
  const [pos, setPos] = useState<MenuPos | null>(null);
  const open = pos !== null;

  const measure = (): MenuPos | null => {
    const el = triggerRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const gap = 4;
    const spaceBelow = window.innerHeight - r.bottom - 8;
    const spaceAbove = r.top - 8;
    const up = spaceBelow < Math.min(MENU_MAX_HEIGHT, 200) && spaceAbove > spaceBelow;
    const rawLeft = align === 'end' ? r.right - MENU_WIDTH : r.left;
    return {
      left: Math.max(8, Math.min(rawLeft, window.innerWidth - MENU_WIDTH - 8)),
      top: up ? r.top - gap : r.bottom + gap,
      maxHeight: Math.max(120, Math.min(MENU_MAX_HEIGHT, up ? spaceAbove : spaceBelow)),
      up,
    };
  };

  const openMenu = () => setPos(measure());
  // Keyboard closes hand focus back to the trigger so the user never lands on
  // <body>; pointer closes (outside click / scroll) leave focus where it is.
  const close = (refocus: boolean) => {
    setPos(null);
    if (refocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setPos(null);
    };
    // Scrolling the table (or anything else outside the menu) closes it instead
    // of dragging the popup along; scrolling inside a tall menu is fine.
    const onScroll = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      setPos(null);
    };
    const onResize = () => setPos(null);
    document.addEventListener('mousedown', onMouseDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  // Once the menu is in the DOM, move focus into it (first enabled item).
  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>(ENABLED_ITEM)?.focus();
  }, [open]);

  const moveFocus = (to: 1 | -1 | 'first' | 'last') => {
    const els = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>(ENABLED_ITEM) ?? []);
    if (els.length === 0) return;
    if (to === 'first') { els[0].focus(); return; }
    if (to === 'last') { els[els.length - 1].focus(); return; }
    const cur = els.indexOf(document.activeElement as HTMLButtonElement);
    const next = cur === -1 ? (to > 0 ? 0 : els.length - 1) : (cur + to + els.length) % els.length;
    els[next].focus();
  };

  const onMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); moveFocus(1); break;
      case 'ArrowUp':   e.preventDefault(); moveFocus(-1); break;
      case 'Home':      e.preventDefault(); moveFocus('first'); break;
      case 'End':       e.preventDefault(); moveFocus('last'); break;
      case 'Escape':
        // Stop here so a parent dialog's document-level Escape listener
        // (useModalA11y) doesn't close the dialog underneath as well.
        e.preventDefault();
        e.stopPropagation();
        close(true);
        break;
      case 'Tab':
        // No preventDefault — focus goes back to the trigger and the browser's
        // own Tab then continues the page order from there.
        close(true);
        break;
    }
  };

  const onTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); openMenu(); }
  };

  const select = (it: Extract<RowMenuItem, { onSelect: () => void }>) => {
    if (it.disabled) return;
    close(true);
    it.onSelect();
  };

  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      className={`icon-btn ${className}`.trim()}
      aria-label={label}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={open ? menuId : undefined}
      onClick={() => (open ? close(false) : openMenu())}
      onKeyDown={onTriggerKeyDown}
      style={{
        width: size, height: size, flexShrink: 0,
        display: 'inline-grid', placeItems: 'center',
        border: '1px solid var(--color-border)', borderRadius: 6,
        color: 'var(--color-text-secondary)',
        // No inline background while closed — it would beat `.icon-btn:hover`.
        ...(open ? { background: 'var(--color-surface-2)' } : {}),
      }}
    >
      <Icon name="dots" size={14} />
    </button>
  );

  const menu = pos && createPortal(
    <div
      ref={menuRef}
      id={menuId}
      role="menu"
      aria-label={label}
      onKeyDown={onMenuKeyDown}
      style={{
        position: 'fixed', left: pos.left, width: MENU_WIDTH,
        top: pos.up ? undefined : pos.top,
        bottom: pos.up ? window.innerHeight - pos.top : undefined,
        background: 'var(--color-surface)', border: '1px solid var(--color-border)',
        borderRadius: 8, boxShadow: 'var(--shadow-md)', zIndex: 2000,
        padding: 4, maxHeight: pos.maxHeight, overflowY: 'auto', boxSizing: 'border-box',
      }}
    >
      {items.map(it => {
        if (isSeparator(it)) {
          return <div key={it.id} role="separator" style={{ height: 1, background: 'var(--color-border)', margin: '4px 6px' }} />;
        }
        const danger = it.tone === 'danger';
        const hoverBg = danger ? 'var(--color-danger-50)' : 'var(--color-surface-2)';
        return (
          <button
            key={it.id}
            type="button"
            role="menuitem"
            tabIndex={-1}
            disabled={it.disabled}
            onClick={() => select(it)}
            onMouseEnter={e => { if (!it.disabled) e.currentTarget.style.background = hoverBg; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            onFocus={e => { if (!it.disabled) e.currentTarget.style.background = hoverBg; }}
            onBlur={e => { e.currentTarget.style.background = 'transparent'; }}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left',
              padding: '8px 10px', borderRadius: 6,
              fontSize: 13, fontWeight: danger ? 600 : 500,
              color: it.disabled ? 'var(--color-text-muted)' : danger ? 'var(--color-danger-fg)' : 'var(--color-text)',
              cursor: it.disabled ? 'not-allowed' : 'pointer',
              opacity: it.disabled ? 0.6 : 1,
              transition: 'background var(--dur-fast) var(--ease-out)',
            }}
          >
            {it.icon && <Icon name={it.icon} size={14} style={{ flexShrink: 0 }} />}
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.label}</span>
          </button>
        );
      })}
    </div>,
    document.body,
  );

  // No wrapper element — the trigger sits directly in the row's flex cell.
  return <>{trigger}{menu}</>;
}
