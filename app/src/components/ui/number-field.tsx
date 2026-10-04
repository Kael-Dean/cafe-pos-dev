'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Icon from '../icons';
import { useI18n } from '@/lib/i18n';
import { clampNumber, displayNumber, parseNumberInput } from '@/lib/number-input';
import { cn } from './cn';
import { Field, fieldIds } from './field';
import { IconButton } from './icon-button';

export interface NumberFieldProps {
  value: number;
  onChange: (value: number) => void;
  /** `stepper` = − value + (qty, party size) · `plain` = typed amount, right-aligned. */
  variant?: 'stepper' | 'plain';
  /** md 44 · lg 56 (POS touch rows). */
  size?: 'md' | 'lg';
  min?: number;
  max?: number;
  step?: number;
  /** Round to an integer (qty). */
  integer?: boolean;
  /** Plain variant: value reported (and shown as an empty box) when cleared. Default 0. */
  emptyValue?: number;
  label?: React.ReactNode;
  /** Required when there is no visible `label`. */
  'aria-label'?: string;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  disabled?: boolean;
  /** Trailing unit for the plain variant, e.g. "฿" or "ชิ้น". */
  unit?: React.ReactNode;
  id?: string;
  name?: string;
  className?: string;
}

const REPEAT_DELAY = 400;
const REPEAT_EVERY = 80;

/**
 * Numeric field built on lib/number-input (the box can be cleared while typing;
 * min/max clamp on blur). Stepper buttons repeat while held (long-press).
 * The input is a text box with inputMode numeric/decimal and role="spinbutton",
 * so ArrowUp / ArrowDown step and no native spinner appears.
 *
 *   <NumberField aria-label="จำนวน" value={qty} onChange={setQty} min={1} max={99} integer size="lg" />
 */
export function NumberField({
  value,
  onChange,
  variant = 'stepper',
  size = 'md',
  min,
  max,
  step = 1,
  integer = false,
  emptyValue = 0,
  label,
  'aria-label': ariaLabel,
  hint,
  error,
  disabled = false,
  unit,
  id,
  name,
  className,
}: NumberFieldProps) {
  const { t } = useI18n();
  const autoId = useId();
  const ids = fieldIds(id ?? autoId, hint, error);
  const [draft, setDraft] = useState<string | null>(null);
  const isStepper = variant === 'stepper';
  const shown = draft ?? (isStepper ? String(value) : displayNumber(value, emptyValue));

  // Hold-to-repeat. The latest value is read through a ref so a held button keeps
  // counting from the value it just produced.
  const latest = useRef({ value, onChange });
  useEffect(() => { latest.current = { value, onChange }; });
  const timers = useRef<{ delay?: ReturnType<typeof setTimeout>; every?: ReturnType<typeof setInterval> }>({});
  const stopRepeat = () => {
    const tm = timers.current;
    clearTimeout(tm.delay);
    clearInterval(tm.every);
    tm.delay = undefined;
    tm.every = undefined;
  };
  useEffect(() => {
    const tm = timers.current;
    return () => { clearTimeout(tm.delay); clearInterval(tm.every); };
  }, []);

  const bump = (dir: 1 | -1) => {
    const next = clampNumber(latest.current.value + dir * step, { min, max, integer });
    if (next === latest.current.value) { stopRepeat(); return; } // hit min/max
    latest.current.value = next;
    latest.current.onChange(next);
  };
  // A pointer press steps once immediately, then repeats while held. The click that
  // follows the pointerup is swallowed so the step is not applied twice; keyboard /
  // assistive-tech activation (no pointer) still steps through onClick.
  const pointerStepped = useRef(false);
  const startRepeat = (dir: 1 | -1) => {
    stopRepeat();
    pointerStepped.current = true;
    bump(dir);
    timers.current.delay = setTimeout(() => {
      timers.current.every = setInterval(() => bump(dir), REPEAT_EVERY);
    }, REPEAT_DELAY);
  };
  // Handlers read the direction from data-dir so the render helper below never
  // closes over refs itself.
  const dirOf = (el: HTMLElement): 1 | -1 => (el.dataset.dir === '-1' ? -1 : 1);
  const onStepPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button === 0) startRepeat(dirOf(e.currentTarget));
  };
  const onStepClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (pointerStepped.current) { pointerStepped.current = false; return; }
    bump(dirOf(e.currentTarget));
  };
  const stepButton = (dir: 1 | -1) => {
    const atLimit = dir < 0 ? min != null && value <= min : max != null && value >= max;
    return (
      <IconButton
        className="ui-numfield__step"
        data-dir={dir}
        size={size === 'lg' ? 'lg' : 'md'}
        icon={<Icon name={dir < 0 ? 'minus' : 'plus'} size={18} strokeWidth={2} />}
        label={dir < 0 ? t.ui.decrease : t.ui.increase}
        disabled={disabled || atLimit}
        tabIndex={-1}
        onPointerDown={onStepPointerDown}
        onPointerUp={stopRepeat}
        onPointerLeave={stopRepeat}
        onPointerCancel={stopRepeat}
        onClick={onStepClick}
      />
    );
  };

  const commit = () => {
    // Nothing typed since the last step / commit: the box already mirrors `value`.
    if (draft === null) return;
    const parsed = parseNumberInput(draft ?? '', { integer, emptyValue: isStepper ? (min ?? 0) : emptyValue });
    const normalised = clampNumber(parsed, { min, max, integer });
    setDraft(null);
    if (normalised !== value) onChange(normalised);
  };

  return (
    <Field ids={ids} label={label} hint={hint} error={error} className={className}>
      <div
        className={cn('ui-input', 'ui-numfield', !isStepper && 'ui-numfield--plain', size === 'lg' && 'ui-input--lg')}
        data-invalid={error ? '' : undefined}
        data-disabled={disabled ? '' : undefined}
      >
        {isStepper && stepButton(-1)}
        <input
          id={ids.controlId}
          name={name}
          className="ui-input__control"
          type="text"
          inputMode={integer ? 'numeric' : 'decimal'}
          autoComplete="off"
          role="spinbutton"
          aria-label={ariaLabel}
          aria-valuenow={Number.isFinite(value) ? value : undefined}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-invalid={error ? true : undefined}
          aria-describedby={ids.describedBy}
          disabled={disabled}
          value={shown}
          onFocus={(e) => { setDraft(shown); e.currentTarget.select(); }}
          onChange={(e) => {
            const raw = e.target.value;
            setDraft(raw);
            onChange(parseNumberInput(raw, { integer, emptyValue: isStepper ? (min ?? 0) : emptyValue }));
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              setDraft(null);
              bump(e.key === 'ArrowUp' ? 1 : -1);
            } else if (e.key === 'Enter') {
              commit();
            }
          }}
        />
        {!isStepper && unit != null && <span className="ui-input__trail ui-field__hint">{unit}&nbsp;</span>}
        {isStepper && stepButton(1)}
      </div>
    </Field>
  );
}
