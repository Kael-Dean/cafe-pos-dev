'use client';

import { useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '@/lib/i18n';
import { useModalA11y } from '@/hooks/use-modal-a11y';
import { cn } from './cn';
import { DialogHead, useBackdropDismiss, useHistoryOverlay, useLatest, usePresence, useScrollableBodyFocus } from './overlay';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  /** Pinned action row (stays above the home indicator / keyboard). */
  footer?: React.ReactNode;
  /**
   * `bottom` (default): rises from the bottom edge; centred and capped at 640px on tablets.
   * `side`: a right-hand panel at ≥1024px, a bottom sheet below that.
   */
  side?: 'bottom' | 'side';
  /** `auto` hugs the content; `full` takes the whole height (phone payment / receipt). */
  size?: 'auto' | 'full';
  /** False blocks Esc, backdrop, drag, the close button and history Back (payment processing). */
  dismissible?: boolean;
  /** Default true. */
  closeOnBackdrop?: boolean;
  hideClose?: boolean;
  /** Back button closes the sheet (spec §2.5). Opt-in until the page router handles overlay entries. */
  historyAware?: boolean;
  className?: string;
}

const DISMISS_FRACTION = 0.3;   // drag past 30% of the sheet height…
const DISMISS_VELOCITY = 0.5;   // …or flick faster than 0.5px/ms
const SETTLE_MS = 180;

/**
 * Bottom / side sheet: same a11y contract as Modal (focus trap, Esc, focus
 * restore, topmost-only keys) plus drag-to-dismiss on the 44px handle.
 *
 *   <Sheet open={editing != null} onClose={() => setEditing(null)} title="แก้ไขรายการ"
 *     footer={<Button size="lg" fullWidth onClick={save}>บันทึก</Button>}>…</Sheet>
 */
export function Sheet(props: SheetProps) {
  const { mounted, closing } = usePresence(props.open);
  if (!mounted || typeof document === 'undefined') return null;
  return createPortal(<SheetSurface {...props} closing={closing} />, document.body);
}

function SheetSurface({
  onClose,
  title,
  description,
  children,
  footer,
  side = 'bottom',
  size = 'auto',
  dismissible = true,
  closeOnBackdrop = true,
  hideClose = false,
  historyAware = false,
  className,
  closing,
}: SheetProps & { closing: boolean }) {
  const { t } = useI18n();
  const titleId = useId();
  const descId = useId();
  const canClose = dismissible && !closing;
  const latest = useLatest({ onClose, dismissible: canClose });
  const bodyRef = useScrollableBodyFocus(titleId);
  const dialogRef = useModalA11y(() => { if (latest.current.dismissible) latest.current.onClose(); });
  useHistoryOverlay(historyAware, latest);
  const backdrop = useBackdropDismiss(canClose && closeOnBackdrop, onClose);

  // ── Drag to dismiss (handle only; the body keeps its own scroll) ──────────
  // The offset is written to --ui-drag-y on the sheet (transform only, no layout).
  const drag = useRef<{ startY: number; startT: number; dy: number; pointer: number } | null>(null);
  const setOffset = (px: number) => dialogRef.current?.style.setProperty('--ui-drag-y', `${px}px`);
  const onHandleDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!canClose || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startY: e.clientY, startT: e.timeStamp, dy: 0, pointer: e.pointerId };
    dialogRef.current?.setAttribute('data-dragging', '');
  };
  const onHandleMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    d.dy = Math.max(0, e.clientY - d.startY);
    setOffset(d.dy);
  };
  const onHandleUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const node = dialogRef.current;
    drag.current = null;
    if (!d || !node) return;
    node.removeAttribute('data-dragging');
    const velocity = d.dy / Math.max(1, e.timeStamp - d.startT);
    if (d.dy > node.offsetHeight * DISMISS_FRACTION || (d.dy > 24 && velocity > DISMISS_VELOCITY)) {
      onClose();
      return;
    }
    node.setAttribute('data-settling', '');
    setOffset(0);
    window.setTimeout(() => node.removeAttribute('data-settling'), SETTLE_MS);
  };

  return (
    <div className="ui-overlay ui-overlay--sheet" data-state={closing ? 'closing' : 'open'} {...backdrop}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description != null ? descId : undefined}
        className={cn('ui-sheet', side === 'side' && 'ui-sheet--side', size === 'full' && 'ui-sheet--full', className)}
      >
        {dismissible && (
          // Pointer-only affordance (44px tall). Keyboard and screen-reader users
          // close with the × button or Esc, so the handle stays out of the a11y tree.
          <div
            className="ui-sheet__handle"
            aria-hidden="true"
            title={t.ui.dragToClose}
            onPointerDown={onHandleDown}
            onPointerMove={onHandleMove}
            onPointerUp={onHandleUp}
            onPointerCancel={onHandleUp}
          />
        )}
        <DialogHead
          titleId={titleId}
          descId={descId}
          title={title}
          description={description}
          showClose={!hideClose}
          closeDisabled={!dismissible}
          onClose={onClose}
        />
        {children != null && <div ref={bodyRef} className="ui-dialog__body scroll">{children}</div>}
        {footer != null && <div className="ui-dialog__foot">{footer}</div>}
      </div>
    </div>
  );
}
