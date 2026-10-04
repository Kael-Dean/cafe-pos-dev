'use client';

import { useId } from 'react';
import { cn } from './cn';
import { Kbd } from './kbd';
import { Spinner } from './spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';
/** sm 36 (desktop admin only, 44 hit area) · md 44 · lg 56 · xl 64 (POS pay / confirm). */
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl';

export interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  children?: React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Stretch to the container width. */
  fullWidth?: boolean;
  /** Leading icon node, e.g. `<Icon name="cash" size={18} />`. Swapped for the spinner while loading. */
  icon?: React.ReactNode;
  /** Content after the label (e.g. the amount on a pay action). Stays visible while loading. */
  trailing?: React.ReactNode;
  /** Shows a spinner, locks the width, sets aria-busy and ignores clicks. */
  loading?: boolean;
  /**
   * Hotkey hint rendered as a `<Kbd>` at ≥1024px with a fine pointer, e.g. "F12".
   * Also exposed as aria-keyshortcuts (pass the ARIA form via `keyShortcuts` if it differs).
   */
  kbd?: string;
  /** ARIA keyshortcuts value, e.g. "F12 Control+Enter". Defaults to `kbd`. */
  keyShortcuts?: string;
  /**
   * Why the button cannot be used right now ("ออฟไลน์ — รับเงินไม่ได้"). When set
   * together with `disabled`, the button stays focusable (aria-disabled) so the
   * reason is reachable by keyboard and screen readers, and is shown as a tooltip.
   */
  disabledReason?: string;
  ref?: React.Ref<HTMLButtonElement>;
}

/**
 * The one button. Replaces `.btn*` classes and POS `PayButton`.
 *
 *   <Button variant="primary" size="xl" fullWidth kbd="F12" loading={paying}>รับเงินสด</Button>
 *
 * States: hover (pointer devices only), pressed scale(.97), focus-visible ring,
 * disabled / aria-disabled with reason, loading.
 */
export function Button({
  children,
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  icon,
  trailing,
  loading = false,
  kbd,
  keyShortcuts,
  disabled = false,
  disabledReason,
  type = 'button',
  className,
  onClick,
  title,
  ref,
  'aria-describedby': describedBy,
  ...rest
}: ButtonProps) {
  const reasonId = useId();
  // With a reason, keep the control focusable and announce why it is unavailable.
  const softDisabled = disabled && !!disabledReason;
  const blocked = disabled || loading;

  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      className={cn(
        'ui-btn',
        `ui-btn--${variant}`,
        `ui-btn--${size}`,
        size === 'sm' && 'hit-44',
        fullWidth && 'ui-btn--block',
        className,
      )}
      disabled={disabled && !softDisabled}
      aria-disabled={softDisabled || undefined}
      aria-busy={loading || undefined}
      aria-keyshortcuts={keyShortcuts ?? kbd}
      aria-describedby={cn(describedBy, softDisabled && reasonId) || undefined}
      title={softDisabled ? disabledReason : title}
      onClick={(e) => {
        if (blocked) { e.preventDefault(); return; }
        onClick?.(e);
      }}
    >
      {loading ? (icon ? <Spinner /> : null) : icon}
      <span className="ui-btn__label" data-hidden={loading && !icon ? '' : undefined}>{children}</span>
      {loading && !icon && <span className="ui-btn__spinner-overlay"><Spinner /></span>}
      {trailing}
      {kbd && <span className="ui-btn__kbd" aria-hidden="true"><Kbd>{kbd}</Kbd></span>}
      {softDisabled && <span id={reasonId} className="sr-only">{disabledReason}</span>}
    </button>
  );
}
