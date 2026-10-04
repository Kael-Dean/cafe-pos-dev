'use client';

import Icon from '../icons';
import { cn } from './cn';

export interface FieldIds {
  controlId: string;
  hintId?: string;
  errorId?: string;
  /** Join of hintId + errorId for aria-describedby. */
  describedBy?: string;
}

/** Derive the ids a Field needs from one base id. */
export function fieldIds(base: string, hint?: React.ReactNode, error?: React.ReactNode): FieldIds {
  // The hint is replaced by the error while one shows, so only reference what is rendered.
  const hintId = hint && !error ? `${base}-hint` : undefined;
  const errorId = error ? `${base}-error` : undefined;
  return { controlId: base, hintId, errorId, describedBy: cn(hintId, errorId) || undefined };
}

export interface FieldProps {
  ids: FieldIds;
  label?: React.ReactNode;
  hint?: React.ReactNode;
  /** Error message. Rendered under the control with role="alert" so it is announced once when it appears. */
  error?: React.ReactNode;
  /** Shows the shared "จำเป็น" marker text after the label. */
  requiredMark?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

/**
 * Label + control + hint/error column used by Input, NumberField and Select.
 * Errors name the problem and the fix ("กรอกจำนวนอย่างน้อย 1"), never just "ไม่ถูกต้อง".
 */
export function Field({ ids, label, hint, error, requiredMark, className, children }: FieldProps) {
  return (
    <div className={cn('ui-field', className)}>
      {label != null && (
        <label className="ui-field__label" htmlFor={ids.controlId}>
          {label}
          {requiredMark ? <span className="ui-field__hint"> · {requiredMark}</span> : null}
        </label>
      )}
      {children}
      {hint != null && !error && <div id={ids.hintId} className="ui-field__hint">{hint}</div>}
      {error != null && error !== false && (
        <div id={ids.errorId} className="ui-field__error" role="alert">
          <Icon name="warning" size={16} />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
