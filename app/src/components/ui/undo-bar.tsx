'use client';

/**
 * Undo snackbar (TOUCH-SPEC §3.5) for reversible removals: a cart line removed, a
 * KDS ticket bumped. Legacy app look (--color-* / --tap-* tokens). Import by path,
 * never from the `@/components/ui` barrel (that one pulls in the --ds-* login CSS).
 *
 *   import { UndoBar, useUndo } from '@/components/ui/undo-bar';
 *
 *   const undo = useUndo();
 *   undo.push(`ลบ ${line.name} แล้ว`, () => restore(line));   // replaces any bar showing
 *   …
 *   <div style={{ position: 'relative' }}>             // the column the bar belongs to
 *     …list…
 *     <UndoBar undo={undo} />                          // pinned to that column's bottom
 *   </div>
 *
 * Behaviour: one bar at a time (a new push replaces the old one, the old action is
 * simply dropped), 5s by default, the timer pauses while a finger / mouse is down on
 * the bar or focus is inside it. The "เลิกทำ" button is 48px; the close X is 44px.
 * `undo.dismiss()` clears it early (e.g. the bill was paid, so there is nothing to
 * restore into). The bar announces itself politely (role="status").
 *
 * Placement: absolutely positioned at the bottom of the nearest positioned ancestor,
 * 8px inset, so it never shifts the list under the user's finger. Pass `inline` to
 * render it in normal flow instead.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../icons';
import { useI18n } from '@/lib/i18n';

export interface UndoEntry {
  /** Changes on every push, so a repeated message still restarts the timer. */
  id: number;
  message: string;
  onUndo: () => void;
}

export interface UndoController {
  entry: UndoEntry | null;
  /** Show the bar (replacing any current one). `onUndo` runs once if the user taps "เลิกทำ". */
  push: (message: string, onUndo: () => void) => void;
  dismiss: () => void;
}

export function useUndo(): UndoController {
  const [entry, setEntry] = useState<UndoEntry | null>(null);
  const seq = useRef(0);
  const push = useCallback((message: string, onUndo: () => void) => {
    seq.current += 1;
    setEntry({ id: seq.current, message, onUndo });
  }, []);
  const dismiss = useCallback(() => setEntry(null), []);
  return { entry, push, dismiss };
}

interface UndoBarProps {
  undo: UndoController;
  /** Auto-dismiss after this many ms. Default 5000. */
  duration?: number;
  /** Render in normal flow instead of pinned to the bottom of the positioned ancestor. */
  inline?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function UndoBar({ undo, duration = 5000, inline = false, className, style }: UndoBarProps) {
  const { entry, dismiss } = undo;
  if (!entry) return null;
  // Keyed by entry id: a new push remounts the bar, which restarts its timer.
  return <UndoBarItem key={entry.id} entry={entry} onDismiss={dismiss} duration={duration} inline={inline} className={className} style={style} />;
}

function UndoBarItem({ entry, onDismiss, duration, inline, className, style }: {
  entry: UndoEntry; onDismiss: () => void; duration: number; inline: boolean;
  className?: string; style?: React.CSSProperties;
}) {
  const { t } = useI18n();
  const [held, setHeld] = useState(false);
  const remaining = useRef(duration);

  useEffect(() => {
    if (held) return;
    const started = Date.now();
    const timer = window.setTimeout(onDismiss, remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(800, remaining.current - (Date.now() - started));
    };
  }, [held, onDismiss]);

  return (
    <div
      role="status"
      className={`undo-bar${className ? ` ${className}` : ''}`}
      onPointerDown={() => setHeld(true)}
      onPointerUp={() => setHeld(false)}
      onPointerCancel={() => setHeld(false)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHeld(false); }}
      style={{
        ...(inline ? {} : { position: 'absolute', left: 8, right: 8, bottom: 8, zIndex: 5 }),
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '4px 4px 4px 16px',
        background: 'var(--color-primary)', color: 'var(--color-text-inverse)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-md)',
        animation: 'fade-in var(--dur-base) var(--ease-out) both',
        ...style,
      }}
    >
      <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--fs-body)', fontWeight: 500, lineHeight: 'var(--lh-tight)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {entry.message}
      </span>
      <button
        type="button"
        className="tap"
        onClick={() => { entry.onUndo(); onDismiss(); }}
        style={{
          minHeight: 'var(--tap-std)', padding: '0 16px', flexShrink: 0,
          borderRadius: 'var(--radius-md)',
          color: 'var(--color-text-inverse)',
          fontSize: 'var(--fs-body)', fontWeight: 700,
          textDecoration: 'underline', textUnderlineOffset: 3,
        }}
      >
        {t.ui.undo}
      </button>
      <button
        type="button"
        className="tap"
        aria-label={t.ui.dismiss}
        onClick={onDismiss}
        style={{
          width: 'var(--tap-min)', height: 'var(--tap-min)', minHeight: 'var(--tap-min)', flexShrink: 0,
          display: 'grid', placeItems: 'center',
          borderRadius: 'var(--radius-md)',
          color: 'var(--color-text-inverse)', opacity: 0.85,
        }}
      >
        <Icon name="x" size={18} />
      </button>
    </div>
  );
}
