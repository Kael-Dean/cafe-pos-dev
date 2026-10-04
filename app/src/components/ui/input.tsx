'use client';

import { useId, useRef } from 'react';
import Icon from '../icons';
import { useI18n } from '@/lib/i18n';
import { cn } from './cn';
import { Field, fieldIds } from './field';
import { IconButton } from './icon-button';

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** `search` adds a leading magnifier + a 44px clear button; `inverse` is for dark surfaces. */
  variant?: 'default' | 'search' | 'inverse';
  /** md 44 · lg 56 (POS). */
  size?: 'md' | 'lg';
  /** Visible label. Without it, pass `aria-label`. */
  label?: React.ReactNode;
  hint?: React.ReactNode;
  /** Error message — sets aria-invalid and replaces the hint. */
  error?: React.ReactNode;
  /** Leading icon node (search variant supplies its own). */
  leading?: React.ReactNode;
  /** Trailing slot (unit "฿", inline action). */
  trailing?: React.ReactNode;
  /** Search variant: called by the clear button. Shown only while `value` is non-empty. */
  onClear?: () => void;
  /** Class for the outer field column. */
  className?: string;
  ref?: React.Ref<HTMLInputElement>;
}

/**
 *   <Input label="ชื่อสินค้า" value={name} onChange={e => setName(e.target.value)} error={err} />
 *   <Input variant="search" aria-label="ค้นหาเมนู" value={q} onChange={…} onClear={() => setQ('')} />
 *
 * 16px text on phones (no iOS zoom). Focus ring sits on the box, not the bare input.
 */
export function Input({
  variant = 'default',
  size = 'md',
  label,
  hint,
  error,
  leading,
  trailing,
  onClear,
  className,
  id,
  disabled,
  type,
  ref,
  'aria-describedby': describedBy,
  ...rest
}: InputProps) {
  const { t } = useI18n();
  const autoId = useId();
  const ids = fieldIds(id ?? autoId, hint, error);
  const innerRef = useRef<HTMLInputElement | null>(null);
  const isSearch = variant === 'search';
  const showClear = isSearch && !!onClear && rest.value != null && String(rest.value) !== '';

  const setRefs = (node: HTMLInputElement | null) => {
    innerRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) (ref as React.RefObject<HTMLInputElement | null>).current = node;
  };

  return (
    <Field ids={ids} label={label} hint={hint} error={error} className={className}>
      <div
        className={cn('ui-input', size === 'lg' && 'ui-input--lg', variant === 'inverse' && 'ui-input--inverse')}
        data-invalid={error ? '' : undefined}
        data-disabled={disabled ? '' : undefined}
      >
        {(isSearch || leading) && (
          <span className="ui-input__icon" aria-hidden="true">
            {leading ?? <Icon name="search" size={18} />}
          </span>
        )}
        <input
          {...rest}
          ref={setRefs}
          id={ids.controlId}
          type={type ?? (isSearch ? 'search' : 'text')}
          disabled={disabled}
          className="ui-input__control"
          aria-invalid={error ? true : undefined}
          aria-describedby={cn(describedBy, ids.describedBy) || undefined}
        />
        {(showClear || trailing) && (
          <span className="ui-input__trail">
            {trailing}
            {showClear && (
              <IconButton
                size="sm"
                icon={<Icon name="x" size={16} />}
                label={t.ui.clearSearch}
                onClick={() => { onClear?.(); innerRef.current?.focus(); }}
              />
            )}
          </span>
        )}
      </div>
    </Field>
  );
}
