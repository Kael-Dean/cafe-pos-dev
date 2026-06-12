'use client';

import { useState, useRef, useEffect } from 'react';
import Icon from '../icons';
import { useI18n } from '@/lib/i18n';
import { type KDSTicket } from '@/hooks/use-orders';

interface Props {
  ticket: KDSTicket;
  onClose: () => void;
  onConfirm: (reason: string, restock: boolean) => Promise<void>;
}

/**
 * Modal a11y: trap focus inside the dialog, close on Esc, restore focus to the
 * element that opened it. Mirrors the role="dialog"/aria-modal convention used
 * elsewhere in the app. The visual open/close stays on the CSS .modal-in /
 * .backdrop-in classes — this only wires keyboard + focus behaviour.
 */
function useModalA11y(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const node = ref.current;

    // Move focus into the dialog on open (first focusable, else the shell).
    const focusables = () =>
      Array.from(
        node?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => el.offsetParent !== null);

    focusables()[0]?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
    // onClose identity is stable for the modal's lifetime in practice; we only
    // want this to run once on mount/unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return ref;
}

export default function CancelOrderModal({ ticket, onClose, onConfirm }: Props) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  const [alreadyMade, setAlreadyMade] = useState(false);
  const [loading, setLoading] = useState(false);
  const dialogRef = useModalA11y(onClose);

  // Re-entrancy guard: a fast double-tap can fire confirm twice in the same frame
  // (before React re-renders and disables the button). The ref blocks every call
  // after the first while a submission is in flight.
  const submitting = useRef(false);
  const onConfirmClick = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setLoading(true);
    try {
      await onConfirm(reason.trim(), !alreadyMade);
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  };

  const canConfirm = reason.trim() !== '' && !loading;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t.kds.cancelTitle}
        aria-busy={loading || undefined}
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(440px, 92vw)', display: 'flex', flexDirection: 'column' }}
      >
        <div style={{
          padding: 'var(--space-5) var(--space-6)', borderBottom: '1px solid var(--color-border)',
          display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: 'var(--radius-md)', background: 'var(--color-danger-50)',
            color: 'var(--color-danger)', display: 'grid', placeItems: 'center',
          }}>
            <Icon name="trash" size={20} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{t.kds.cancelTitle}</div>
            <div className="num" style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>#{ticket.queue}</div>
          </div>
          <button onClick={onClose} aria-label={t.common.close} className="icon-btn hit-44" style={{
            width: 32, height: 32, borderRadius: 'var(--radius-md)', display: 'grid', placeItems: 'center',
            color: 'var(--color-text-secondary)',
          }}>
            <Icon name="x" size={18} />
          </button>
        </div>

        <div className="scroll" style={{ padding: 'var(--space-6)', overflow: 'auto' }}>
          <div role="alert" style={{
            display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
            padding: 'var(--space-3) var(--space-4)', marginBottom: 'var(--space-5)',
            borderRadius: 'var(--radius-md)', background: 'var(--color-danger-50)',
            color: 'var(--color-danger)', fontSize: 14, fontWeight: 700,
          }}>
            <Icon name="warning" size={18} />
            <span>{t.kds.cancelWarning(String(ticket.queue))}</span>
          </div>

          <label htmlFor="cancel-reason" style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 'var(--space-2)' }}>
            {t.kds.cancelReasonLabel}
          </label>
          <textarea
            id="cancel-reason"
            className="input-std"
            placeholder={t.kds.cancelReasonPlaceholder}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            style={{ width: '100%', minHeight: 80, boxSizing: 'border-box', resize: 'vertical' }}
          />

          <div style={{ marginTop: 'var(--space-5)' }}>
            <button
              type="button"
              aria-pressed={alreadyMade}
              onClick={() => setAlreadyMade(v => !v)}
              className="pressable min-h-[44px]"
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)',
                padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-md)', fontSize: 14, fontWeight: 600,
                background: alreadyMade ? 'var(--color-primary)' : 'var(--color-surface-2)',
                color: alreadyMade ? '#fff' : 'var(--color-text)',
                border: `1px solid ${alreadyMade ? 'var(--color-primary)' : 'var(--color-border)'}`,
              }}
            >
              <span>{t.kds.cancelMadeToggle}</span>
              {alreadyMade && <Icon name="check" size={16} />}
            </button>
            <div className="text-sm" style={{ marginTop: 'var(--space-2)', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
              {t.kds.cancelMadeHint}
            </div>
          </div>
        </div>

        <div style={{
          borderTop: '1px solid var(--color-border)', padding: 'var(--space-4) var(--space-6)',
          display: 'flex', gap: 'var(--space-2)',
        }}>
          <button onClick={onClose} className="btn btn-ghost btn-lg" style={{ flex: 1, minHeight: 44 }}>
            {t.common.close}
          </button>
          <button
            onClick={onConfirmClick}
            disabled={!canConfirm}
            className="btn btn-lg"
            style={{
              flex: 2, minHeight: 44,
              background: 'var(--color-danger-strong)', borderColor: 'var(--color-danger-strong)', color: 'white',
              opacity: canConfirm ? 1 : 0.5,
            }}
          >
            {loading
              ? <span className="spinner" style={{ width: 16, height: 16 }} aria-hidden />
              : <><Icon name="trash" size={16} /> {t.kds.cancelConfirm}</>}
          </button>
        </div>
      </div>
    </div>
  );
}
