'use client';

// Shared responsive layout primitives. Styles live in globals.css
// (".md-split" / ".modal-shell" sections); usage is documented in AGENTS.md
// under "Responsive conventions". Re-exported from app-common for convenience.

import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import Icon from './icons';
import { useIsPhone } from '@/hooks/use-media-query';
import { useModalA11y } from '@/hooks/use-modal-a11y';
import { useI18n } from '@/lib/i18n';

// ---------- MasterDetail ----------
export interface MasterDetailProps {
  /** The list pane (left on desktop). Its root element is stretched to fill the pane. */
  list: React.ReactNode;
  /** The detail pane. On desktop it is always rendered (show your own empty state when nothing is selected). */
  detail: React.ReactNode;
  /** Whether an item is selected. On phones this decides which pane is on screen. */
  hasSelection: boolean;
  /** Phones: the back button was pressed — clear the selection. */
  onBack: () => void;
  /** Desktop width of the list pane in px. Default 320. */
  listWidth?: number;
  /** Phones: back button text. Default: the shared "back" label. */
  backLabel?: string;
  /** Phones: optional title shown next to the back button (e.g. the selected item's name). */
  detailTitle?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Master–detail split. Desktop/tablet: a plain flex row (fixed-width list + flexible
 * detail), identical to hand-written `display:flex`. Phones: the list fills the
 * screen; selecting an item swaps in the detail, full width, under a back bar.
 *
 * The list stays mounted while the detail is open on a phone, so its scroll
 * position, search text and other local state are still there on the way back.
 */
export function MasterDetail({
  list, detail, hasSelection, onBack, listWidth = 320, backLabel, detailTitle, className, style,
}: MasterDetailProps) {
  const { t } = useI18n();
  const isPhone = useIsPhone();
  const showDetailOnly = isPhone && hasSelection;
  const backRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const wasDetail = useRef(false);

  // Phones: the pane swap replaces what is on screen, so move focus with it —
  // onto the back button going in, back onto the list coming out. Without this a
  // keyboard / screen-reader user is left on a control that is no longer visible.
  useEffect(() => {
    // (.md-split-list opts out of transitions in globals.css, so the list is
    // focusable the instant it is un-hidden — see the note there.)
    if (showDetailOnly) backRef.current?.focus({ preventScroll: true });
    else if (wasDetail.current && isPhone) listRef.current?.focus({ preventScroll: true });
    wasDetail.current = showDetailOnly;
  }, [showDetailOnly, isPhone]);

  return (
    <div
      className={`md-split${className ? ` ${className}` : ''}`}
      style={{ '--md-list-w': `${listWidth}px`, ...style } as React.CSSProperties}
    >
      <div
        ref={listRef}
        tabIndex={-1}
        className="md-split-list"
        data-covered={showDetailOnly ? '' : undefined}
        inert={showDetailOnly}
        style={{ outline: 'none' }}
      >
        {list}
      </div>
      {(!isPhone || hasSelection) && (
        <div className="md-split-detail">
          {showDetailOnly && (
            <div className="md-back-bar">
              <button ref={backRef} type="button" className="md-back" onClick={onBack}>
                <Icon name="chevronLeft" size={20} strokeWidth={2} />
                {backLabel ?? t.common.back}
              </button>
              {detailTitle != null && <div className="md-back-title">{detailTitle}</div>}
            </div>
          )}
          {detail}
        </div>
      )}
    </div>
  );
}

// ---------- ModalShell ----------
export interface ModalShellProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Called on Escape, backdrop tap and the close button. */
  onClose: () => void;
  /** Scrollable body. */
  children: React.ReactNode;
  /** Pinned action row (buttons). On phones the buttons share the row equally. */
  footer?: React.ReactNode;
  /** Desktop width in px — rendered as `min(width, 94vw)`. Default 520. */
  width?: number;
  /** Set false while a save is in flight or the form is dirty. Default true. */
  closeOnBackdrop?: boolean;
  /** Marks the dialog busy and disables the close button (e.g. while saving). */
  busy?: boolean;
  /** Only for a dialog opened on top of another overlay. Default: --z-modal. */
  zIndex?: number;
  /** Merged into the scrollable body (e.g. `{ padding: 0 }` for an edge-to-edge list). */
  bodyStyle?: React.CSSProperties;
}

/**
 * Standard dialog: header + scrollable body + pinned footer on the shared
 * `.modal-backdrop` / `.modal-card` surface. It can never be taller than the
 * visible screen (`--app-h`) — the body scrolls — and it is portaled to <body> so a
 * transformed ancestor (screen entrance animation) cannot trap it.
 *
 * Mount it only while open (`{open && <ModalShell …/>}`): the focus trap, Escape
 * handling and focus restore from useModalA11y run on mount / unmount.
 */
export function ModalShell({
  title, subtitle, onClose, children, footer, width = 520,
  closeOnBackdrop = true, busy = false, zIndex, bodyStyle,
}: ModalShellProps) {
  const { t } = useI18n();
  const titleId = useId();
  // useModalA11y binds its Escape handler once, on mount — read the latest
  // busy / onClose through a ref so a save that started later still blocks Escape.
  const latest = useRef({ busy, onClose });
  useEffect(() => { latest.current = { busy, onClose }; });
  const dialogRef = useModalA11y(() => { if (!latest.current.busy) latest.current.onClose(); });
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="modal-backdrop"
      style={zIndex != null ? { zIndex } : undefined}
      onClick={(e) => { if (closeOnBackdrop && !busy && e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy || undefined}
        className="modal-card modal-shell"
        style={{ '--modal-w': `${width}px` } as React.CSSProperties}
      >
        <div className="modal-shell-head">
          <div className="modal-shell-titles">
            <h2 id={titleId} className="modal-shell-title">{title}</h2>
            {subtitle != null && <div className="modal-shell-sub">{subtitle}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label={t.common.close}
            className="icon-btn hit-44 modal-shell-close"
          >
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="modal-shell-body scroll" style={bodyStyle}>{children}</div>
        {footer != null && <div className="modal-shell-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
