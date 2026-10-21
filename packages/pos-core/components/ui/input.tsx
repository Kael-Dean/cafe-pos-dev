'use client';

import { useId } from 'react';
import './tokens.css';
import './ui.css';
import { cn } from './cn';
import { Field, fieldIds } from './field';

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** md 44 · lg 56 (POS). */
  size?: 'md' | 'lg';
  /** Visible label. Without it, pass `aria-label`. */
  label?: React.ReactNode;
  hint?: React.ReactNode;
  /** Error message — sets aria-invalid and replaces the hint. */
  error?: React.ReactNode;
  /** Leading icon node. */
  leading?: React.ReactNode;
  /** Trailing slot (unit "฿", inline action). */
  trailing?: React.ReactNode;
  /** Class for the outer field column. */
  className?: string;
  ref?: React.Ref<HTMLInputElement>;
}

/**
 *   <Input label="Store ID" value={slug} onChange={e => setSlug(e.target.value)} error={err} />
 *
 * 16px text on phones (no iOS zoom). Focus ring sits on the box, not the bare input.
 */
export function Input({
  size = 'md',
  label,
  hint,
  error,
  leading,
  trailing,
  className,
  id,
  disabled,
  type,
  ref,
  'aria-describedby': describedBy,
  ...rest
}: InputProps) {
  const autoId = useId();
  const ids = fieldIds(id ?? autoId, hint, error);

  return (
    <Field ids={ids} label={label} hint={hint} error={error} className={className}>
      <div
        className={cn('ui-input', size === 'lg' && 'ui-input--lg')}
        data-invalid={error ? '' : undefined}
        data-disabled={disabled ? '' : undefined}
      >
        {leading && (
          <span className="ui-input__icon" aria-hidden="true">{leading}</span>
        )}
        <input
          {...rest}
          ref={ref}
          id={ids.controlId}
          type={type ?? 'text'}
          disabled={disabled}
          className="ui-input__control"
          aria-invalid={error ? true : undefined}
          aria-describedby={cn(describedBy, ids.describedBy) || undefined}
        />
        {trailing && <span className="ui-input__trail">{trailing}</span>}
      </div>
    </Field>
  );
}
