'use client';

import { useId } from 'react';
import { createPortal } from 'react-dom';
import { useModalA11y } from '@/hooks/use-modal-a11y';
import { cn } from './cn';
import { DialogHead, useBackdropDismiss, useHistoryOverlay, useLatest, usePresence } from './overlay';

export interface ModalProps {
  /** Controlled visibility. Keep the component mounted and flip this so the exit fade can play. */
  open: boolean;
  /** Called on Esc, backdrop press and the close button (only while `dismissible`). */
  onClose: () => void;
  title: React.ReactNode;
  /** One line under the title; becomes aria-describedby. */
  description?: React.ReactNode;
  children?: React.ReactNode;
  /** Pinned action row. Put the primary action last (rightmost). */
  footer?: React.ReactNode;
  /** `dialog` (default) or `alert` (role=alertdialog: confirms, destructive checks). */
  variant?: 'dialog' | 'alert';
  /** Width: sm 400 · md 560 · lg 640. */
  size?: 'sm' | 'md' | 'lg';
  /**
   * False blocks every way out (Esc, backdrop, close button, history Back) —
   * e.g. while a payment is processing. Default true.
   */
  dismissible?: boolean;
  /** Close when the scrim is pressed. Default: true for `dialog`, false for `alert`. */
  closeOnBackdrop?: boolean;
  /** Hide the × button (the footer then owns closing). Default: hidden for `alert`. */
  hideClose?: boolean;
  /** Back button closes the modal (spec §2.5). Opt-in until the page router handles overlay entries. */
  historyAware?: boolean;
  /** Divider under the header (long forms). */
  divided?: boolean;
  className?: string;
}

/**
 * The one centered dialog (replaces the four ModalShell copies). Focus trap, Esc,
 * focus restore come from useModalA11y; only the topmost open dialog reacts to keys.
 *
 *   <Modal open={confirming} onClose={() => setConfirming(false)} variant="alert" size="sm"
 *     title="ยกเลิกบิลนี้?" description="รายการทั้งหมดในตะกร้าจะถูกลบ"
 *     footer={<>
 *       <Button variant="secondary" onClick={() => setConfirming(false)}>กลับไป</Button>
 *       <Button variant="danger" onClick={voidCart}>ยกเลิกบิล</Button>
 *     </>} />
 */
export function Modal(props: ModalProps) {
  const { mounted, closing } = usePresence(props.open);
  if (!mounted || typeof document === 'undefined') return null;
  return createPortal(<ModalSurface {...props} closing={closing} />, document.body);
}

function ModalSurface({
  onClose,
  title,
  description,
  children,
  footer,
  variant = 'dialog',
  size = 'md',
  dismissible = true,
  closeOnBackdrop,
  hideClose,
  historyAware = false,
  divided = false,
  className,
  closing,
}: ModalProps & { closing: boolean }) {
  const titleId = useId();
  const descId = useId();
  const isAlert = variant === 'alert';
  const canClose = dismissible && !closing;
  const latest = useLatest({ onClose, dismissible: canClose });
  const dialogRef = useModalA11y(() => { if (latest.current.dismissible) latest.current.onClose(); });
  useHistoryOverlay(historyAware, latest);
  const backdrop = useBackdropDismiss(canClose && (closeOnBackdrop ?? !isAlert), onClose);

  return (
    <div className="ui-overlay" data-state={closing ? 'closing' : 'open'} {...backdrop}>
      <div
        ref={dialogRef}
        role={isAlert ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description != null ? descId : undefined}
        className={cn('ui-modal', `ui-modal--${size}`, className)}
      >
        <DialogHead
          titleId={titleId}
          descId={descId}
          title={title}
          description={description}
          showClose={!(hideClose ?? isAlert)}
          closeDisabled={!dismissible}
          onClose={onClose}
          divided={divided}
        />
        {children != null && <div className="ui-dialog__body scroll">{children}</div>}
        {footer != null && <div className="ui-dialog__foot">{footer}</div>}
      </div>
    </div>
  );
}
