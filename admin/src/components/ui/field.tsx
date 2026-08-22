'use client';

import { useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';

interface FieldShellProps {
  label: string;
  /** Explains the rule before the user breaks it (slug charset, "shown once", …). */
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  children: (ids: { id: string; describedBy?: string; invalid: boolean }) => ReactNode;
}

/**
 * Label + control + hint + error, wired together with ids so the hint and the
 * error are actually announced with the input instead of just sitting near it.
 */
export function Field({ label, hint, error, required, children }: FieldShellProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [hintId, errId].filter(Boolean).join(' ') || undefined;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label htmlFor={id} style={{ fontSize: 'var(--fs-13)', fontWeight: 'var(--fw-semibold)', color: 'var(--color-text)' }}>
        {label}
        {required && (
          <span aria-hidden style={{ color: 'var(--color-danger-fg)', marginInlineStart: 3 }}>*</span>
        )}
      </label>

      {children({ id, describedBy, invalid: Boolean(error) })}

      {hint && (
        <p id={hintId} style={{ fontSize: 'var(--fs-12)', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} style={{ fontSize: 'var(--fs-12)', color: 'var(--color-danger-fg)', fontWeight: 'var(--fw-medium)' }}>
          {error}
        </p>
      )}
    </div>
  );
}

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> & {
  label: string;
  hint?: ReactNode;
  error?: string;
};

export function TextField({ label, hint, error, required, ...input }: TextFieldProps) {
  return (
    <Field label={label} hint={hint} error={error} required={required}>
      {({ id, describedBy, invalid }) => (
        <input
          {...input}
          id={id}
          className="input-std"
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
        />
      )}
    </Field>
  );
}

type TextAreaFieldProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> & {
  label: string;
  hint?: ReactNode;
  error?: string;
  /** Live "n/500" counter — useful where the API enforces a hard ceiling. */
  counterMax?: number;
};

export function TextAreaField({ label, hint, error, required, counterMax, value, ...area }: TextAreaFieldProps) {
  const len = typeof value === 'string' ? value.length : 0;
  const over = counterMax !== undefined && len > counterMax;

  return (
    <Field label={label} hint={hint} error={error} required={required}>
      {({ id, describedBy, invalid }) => (
        <>
          <textarea
            {...area}
            value={value}
            id={id}
            className="input-std"
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
          />
          {counterMax !== undefined && (
            <span
              className="num"
              style={{
                alignSelf: 'flex-end',
                fontSize: 'var(--fs-12)',
                color: over ? 'var(--color-danger-fg)' : 'var(--color-text-muted)',
              }}
            >
              {len}/{counterMax}
            </span>
          )}
        </>
      )}
    </Field>
  );
}
