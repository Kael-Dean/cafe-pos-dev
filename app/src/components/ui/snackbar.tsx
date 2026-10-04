'use client';

import { useEffect } from 'react';
import { useI18n } from '@/lib/i18n';
import { useLatest } from './overlay';

export interface SnackbarProps {
  open: boolean;
  /** "ลบ ลาเต้เย็น แล้ว" */
  message: React.ReactNode;
  /** Called when the action is pressed. The snackbar then closes. */
  onAction?: () => void;
  /** Defaults to the shared "เลิกทำ" (Undo). */
  actionLabel?: string;
  /** Called on timeout and after the action. */
  onClose: () => void;
  /** ms before it closes by itself. Default 5000 (spec §6). */
  duration?: number;
  /** Change this (e.g. the removed line id) to restart the timer for a new message. */
  resetKey?: string | number;
}

/**
 * Undo snackbar: one message, one action, 5s, bottom-centre above the tab bar.
 * The wrapper is a persistent polite live region, so the message is announced
 * once when it appears.
 *
 *   <Snackbar open={!!removed} message={`ลบ ${removed?.name} แล้ว`}
 *     onAction={() => restore(removed)} onClose={() => setRemoved(null)} resetKey={removed?.id} />
 */
export function Snackbar({ open, message, onAction, actionLabel, onClose, duration = 5000, resetKey }: SnackbarProps) {
  const { t } = useI18n();
  const latest = useLatest(onClose);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => latest.current(), duration);
    return () => clearTimeout(timer);
  }, [open, duration, resetKey, latest]);

  return (
    <div aria-live="polite" aria-relevant="additions text">
      {open && (
        <div className="ui-snackbar">
          <span className="ui-snackbar__msg">{message}</span>
          {onAction && (
            <button
              type="button"
              className="ui-snackbar__action"
              onClick={() => { onAction(); onClose(); }}
            >
              {actionLabel ?? t.ui.undo}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
