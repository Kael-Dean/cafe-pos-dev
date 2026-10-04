'use client';

import { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../icons';
import { useI18n } from '@/lib/i18n';
import { useModalA11y } from '@/hooks/use-modal-a11y';

interface Props {
  /** Number shown in the header/warning, e.g. the KDS queue or the order no. */
  orderLabel: string;
  onClose: () => void;
  onConfirm: (reason: string, restock: boolean) => Promise<void>;
}

export default function CancelOrderModal({ orderLabel, onClose, onConfirm }: Props) {
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

  // Portaled to <body>: callers such as the receipt-copies screen animate in with a
  // transform, and a transformed ancestor becomes the containing block for
  // `position: fixed` — the dialog was then centred in the page column (off-screen
  // on phones, under the tab bar) instead of the viewport.
  if (typeof document === 'undefined') return null;

  return createPortal(
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
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 'var(--fs-title)', fontWeight: 700, lineHeight: 'var(--lh-tight)' }}>{t.kds.cancelTitle}</div>
            <div className="num" style={{ fontSize: 'var(--fs-cap)', color: 'var(--color-text-secondary)' }}>#{orderLabel}</div>
          </div>
          {/* 48×48 visible hit (TOUCH-SPEC §3.6); negative margin keeps the header height. */}
          <button onClick={onClose} aria-label={t.common.close} className="icon-btn tap-std tap-sq" style={{
            margin: '-8px -8px -8px 0', borderRadius: 'var(--radius-md)', color: 'var(--color-text-secondary)',
          }}>
            <Icon name="x" size={20} />
          </button>
        </div>

        <div className="scroll pad-phone" style={{ padding: 'var(--space-6)', overflow: 'auto', flex: '1 1 auto', minHeight: 0 }}>
          <div role="alert" style={{
            display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
            padding: 'var(--space-3) var(--space-4)', marginBottom: 'var(--space-5)',
            borderRadius: 'var(--radius-md)', background: 'var(--color-danger-50)',
            color: 'var(--color-danger-fg)', fontSize: 'var(--fs-body)', fontWeight: 700,
          }}>
            <Icon name="warning" size={20} />
            <span>{t.kds.cancelWarning(orderLabel)}</span>
          </div>

          <label htmlFor="cancel-reason" style={{ display: 'block', fontSize: 'var(--fs-sm)', fontWeight: 600, marginBottom: 'var(--space-2)' }}>
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
            {/* Whole 56px row is the target; the drawn 24px box makes it read as a checkbox. */}
            <button
              type="button"
              role="checkbox"
              aria-checked={alreadyMade}
              onClick={() => setAlreadyMade(v => !v)}
              className="tap tap-lg"
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                padding: '0 var(--space-4)', borderRadius: 'var(--radius-md)', fontSize: 'var(--fs-body)', fontWeight: 600, textAlign: 'left',
                background: alreadyMade ? 'var(--color-primary-50)' : 'var(--color-surface-2)',
                color: 'var(--color-text)',
                border: `1px solid ${alreadyMade ? 'var(--color-primary)' : 'var(--color-border)'}`,
              }}
            >
              <span aria-hidden style={{
                width: 24, height: 24, flexShrink: 0, borderRadius: 6, display: 'grid', placeItems: 'center',
                border: `1px solid ${alreadyMade ? 'var(--color-primary)' : 'var(--color-border-strong)'}`,
                background: alreadyMade ? 'var(--color-primary)' : 'var(--color-surface)',
                color: 'var(--color-text-inverse)',
              }}>
                {alreadyMade && <Icon name="check" size={16} strokeWidth={2.25} />}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>{t.kds.cancelMadeToggle}</span>
            </button>
            <div className="text-sm" style={{ marginTop: 'var(--space-2)', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
              {t.kds.cancelMadeHint}
            </div>
          </div>
        </div>

        <div className="pad-phone" style={{
          borderTop: '1px solid var(--color-border)', padding: 'var(--space-4) var(--space-6)',
          display: 'flex', gap: 'var(--space-2)', flexShrink: 0,
        }}>
          <button onClick={onClose} className="btn btn-ghost btn-lg tap-lg" style={{ flex: 1 }}>
            {t.common.close}
          </button>
          <button
            onClick={onConfirmClick}
            disabled={!canConfirm}
            className="btn btn-danger btn-lg tap-lg"
            style={{ flex: 2, opacity: canConfirm ? 1 : 0.5 }}
          >
            {loading
              ? <span className="spinner" style={{ width: 18, height: 18 }} aria-hidden />
              : <><Icon name="trash" size={20} /> {t.kds.cancelConfirm}</>}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
