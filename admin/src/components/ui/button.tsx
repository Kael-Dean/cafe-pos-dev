'use client';

import type { ButtonHTMLAttributes } from 'react';
import Icon, { type IconName } from './icon';

type Variant = 'primary' | 'accent' | 'ghost' | 'danger' | 'quiet';
type Size = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Shows a spinner and blocks the click. Keep the label — a bare spinner loses the action's name. */
  loading?: boolean;
  block?: boolean;
  icon?: IconName;
}

export function Button({
  variant = 'ghost',
  size = 'md',
  loading = false,
  block = false,
  icon,
  disabled,
  className = '',
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  const classes = [
    'btn',
    `btn-${variant}`,
    size === 'sm' ? 'btn-sm' : size === 'lg' ? 'btn-lg' : '',
    block ? 'btn-block' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="spinner" /> : icon ? <Icon name={icon} size={size === 'sm' ? 14 : 16} /> : null}
      {children}
    </button>
  );
}
