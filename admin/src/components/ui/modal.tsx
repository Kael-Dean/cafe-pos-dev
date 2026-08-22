'use client';

import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useModalA11y } from '@/hooks/use-modal-a11y';
import { useHydrated } from '@/hooks/use-hydrated';
import Icon from './icon';

interface ModalProps {
  /** Accessible name AND the visible heading — one source of truth. */
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Buttons row pinned to the bottom, outside the scrolling body. */
  footer?: ReactNode;
  width?: number;
  /** Blocks backdrop/Esc/✕ dismissal while a write is in flight. */
  busy?: boolean;
  /** For flows where dismissing loses something unrecoverable (a store's PIN). */
  dismissible?: boolean;
}

/**
 * One modal for the whole app: portaled to <body>, focus-trapped, Esc-closable,
 * with the heading, the scrolling body and the action row as fixed slots.
 */
export function Modal({
  title, onClose, children, footer, width = 520, busy = false, dismissible = true,
}: ModalProps) {
  const canDismiss = dismissible && !busy;
  const dialogRef = useModalA11y(() => { if (canDismiss) onClose(); });

  // Portals need the DOM; render nothing on the server pass.
  const mounted = useHydrated();

  // The page behind a modal should not scroll under it.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  if (!mounted) return null;

  return createPortal(
    <div className="modal-backdrop" onClick={() => { if (canDismiss) onClose(); }}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-busy={busy || undefined}
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{ width: `min(${width}px, 100%)` }}
      >
        <header
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-4)',
            padding: 'var(--space-5) var(--space-6) var(--space-3)',
          }}
        >
          <h2 style={{ fontSize: 'var(--fs-20)', fontWeight: 'var(--fw-semibold)', letterSpacing: '-0.01em' }}>
            {title}
          </h2>
          {dismissible && (
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              aria-label="ปิด"
              className="btn btn-quiet btn-sm"
              style={{ padding: 6, borderRadius: 'var(--radius-md)', opacity: busy ? 0.4 : 1 }}
            >
              <Icon name="x" size={18} />
            </button>
          )}
        </header>

        <div
          className="scroll"
          style={{ padding: '0 var(--space-6) var(--space-5)', overflowY: 'auto', flex: 1 }}
        >
          {children}
        </div>

        {footer && (
          <footer
            style={{
              display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)',
              padding: 'var(--space-4) var(--space-6)',
              borderTop: '1px solid var(--color-border)',
              background: 'var(--color-surface-2)',
            }}
          >
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}
