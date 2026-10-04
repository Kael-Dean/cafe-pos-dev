'use client';

import { useMemo, useState } from 'react';
import { Button, Input } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/components/ui/cn';
import Icon from '../../icons';
import {
  isValidPromptPayId, maskPromptPayId, promptPayPayload, qrPath, savePromptPayId,
} from './promptpay';
import s from './payment.module.css';

/**
 * Real EMVCo PromptPay QR with the exact amount (D5). Rendered as one SVG path so
 * it stays crisp on any display and needs no network. The paper stays light with
 * dark ink in both themes (fixed tokens in the CSS module) so cameras can read it.
 *
 * When this device has no PromptPay ID yet, a manager can set it inline; a cashier
 * sees why QR is unavailable and can switch method.
 */
export function QrPanel({ id, onIdChange, total, amountText, canConfigure }: {
  /** Device PromptPay ID ('' = not set). Owned by the sheet so confirm reacts to a save. */
  id: string;
  onIdChange: (id: string) => void;
  total: number;
  amountText: string;
  /** Manager / owner: may set or change the device's PromptPay ID. */
  canConfigure: boolean;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);

  const qr = useMemo(() => {
    if (!id) return null;
    try {
      return qrPath(promptPayPayload(id, total));
    } catch {
      return null;
    }
  }, [id, total]);

  if (!id || editing || !qr) {
    return (
      <PromptPaySetup
        canConfigure={canConfigure}
        initial={editing ? id : ''}
        onSaved={(next) => { onIdChange(next); setEditing(false); }}
        onCancel={editing ? () => setEditing(false) : undefined}
      />
    );
  }

  return (
    <div className={s.qr}>
      <div className={s.qrAmount}>
        <span className={s.dueLabel}>{t.payment.amountDue}</span>
        <span className={cn('num', s.bigAmount)}>{amountText}</span>
        <span className={s.qrPayee}>{t.payment.qrPayee(maskPromptPayId(id))}</span>
      </div>
      <div className={s.qrPaper}>
        <svg
          viewBox={`-4 -4 ${qr.size + 8} ${qr.size + 8}`}
          role="img"
          aria-label={t.payment.qrAlt(amountText)}
          shapeRendering="crispEdges"
          className={s.qrSvg}
        >
          <path d={qr.d} className={s.qrInk} />
        </svg>
      </div>
      <p className={s.qrWait}>
        <span className={s.waitDot} aria-hidden="true" />
        {t.payment.qrScan} · {t.payment.qrWaiting}
      </p>
      {canConfigure && (
        <Button variant="ghost" size="md" onClick={() => setEditing(true)} className={s.qrChange}>
          {t.payment.qrIdChange}
        </Button>
      )}
    </div>
  );
}

function PromptPaySetup({ canConfigure, initial, onSaved, onCancel }: {
  canConfigure: boolean;
  initial: string;
  onSaved: (id: string) => void;
  onCancel?: () => void;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState(initial);
  const [touched, setTouched] = useState(false);
  const valid = isValidPromptPayId(value);

  if (!canConfigure) {
    return (
      <div className={s.setup} role="status">
        <Icon name="qr" size={32} />
        <p className={s.setupTitle}>{t.payment.qrNotSet}</p>
        <p className={s.setupBody}>{t.payment.qrNotSetCashier}</p>
      </div>
    );
  }

  return (
    <form
      className={s.setupForm}
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (valid) onSaved(savePromptPayId(value));
      }}
    >
      <p className={s.setupTitle}>{t.payment.qrNotSet}</p>
      <p className={s.setupBody}>{t.payment.qrNotSetBody}</p>
      <Input
        label={t.payment.qrIdLabel}
        hint={t.payment.qrIdHint}
        error={touched && !valid ? t.payment.qrIdInvalid : undefined}
        inputMode="numeric"
        autoComplete="off"
        size="lg"
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/[^\d-\s]/g, ''))}
        onBlur={() => setTouched(true)}
      />
      <div className={s.setupActions}>
        {onCancel && <Button variant="secondary" size="lg" type="button" onClick={onCancel}>{t.payment.cancel}</Button>}
        <Button variant="primary" size="lg" type="submit">{t.payment.qrIdSave}</Button>
      </div>
    </form>
  );
}
