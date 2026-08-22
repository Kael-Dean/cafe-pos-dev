'use client';

import { useRef, useState, type ReactNode } from 'react';
import { Modal } from './modal';
import { Button } from './button';
import { TextAreaField } from './field';

interface ReasonConfig {
  label: string;
  /** A required reason is written to the audit log — treat it as a real field. */
  required: boolean;
  hint?: ReactNode;
  placeholder?: string;
}

interface ConfirmDialogProps {
  title: string;
  /** What this actually does, in the reader's terms. Not a "are you sure?". */
  body: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  reason?: ReasonConfig;
  busy?: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}

export function ConfirmDialog({
  title, body, confirmLabel, cancelLabel = 'ยกเลิก', tone = 'primary',
  reason, busy = false, onClose, onConfirm,
}: ConfirmDialogProps) {
  const [text, setText] = useState('');
  const [touched, setTouched] = useState(false);
  // A double-tap in the same frame must not fire two writes into the audit log.
  const submitting = useRef(false);

  const blank = reason?.required === true && text.trim().length === 0;
  const tooLong = text.length > 500;
  const error = touched && blank
    ? 'ต้องระบุเหตุผล ไม่ใช่เว้นว่าง'
    : tooLong
      ? 'ยาวได้ไม่เกิน 500 ตัวอักษร'
      : undefined;

  const submit = () => {
    setTouched(true);
    if (blank || tooLong || busy || submitting.current) return;
    submitting.current = true;
    onConfirm(text.trim());
    // Released on unmount; the parent closes the dialog once the write settles.
    setTimeout(() => { submitting.current = false; }, 0);
  };

  return (
    <Modal
      title={title}
      onClose={onClose}
      busy={busy}
      width={reason ? 520 : 460}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{cancelLabel}</Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={submit} loading={busy} disabled={tooLong}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <div style={{ color: 'var(--color-text-secondary)', lineHeight: 1.65 }}>{body}</div>

        {reason && (
          <TextAreaField
            label={reason.label}
            required={reason.required}
            hint={reason.hint}
            error={error}
            counterMax={500}
            placeholder={reason.placeholder}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => setTouched(true)}
            disabled={busy}
          />
        )}
      </div>
    </Modal>
  );
}
