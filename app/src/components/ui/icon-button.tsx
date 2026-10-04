'use client';

import { cn } from './cn';
import { Badge } from './badge';
import { Spinner } from './spinner';

export type IconButtonVariant = 'ghost' | 'outline' | 'danger' | 'onInverse';
/** sm = 36 visual + 44 hit area · md 44 · lg 56. */
export type IconButtonSize = 'sm' | 'md' | 'lg';

export interface IconButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'> {
  /** The icon node, e.g. `<Icon name="x" size={18} />`. Must be decorative (Icon is aria-hidden by default). */
  icon: React.ReactNode;
  /** REQUIRED accessible name — an icon alone is not a label. Also used as the tooltip unless `title` is given. */
  label: string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  /** Small count bubble (cart items, parked bills). 0 / undefined hides it. */
  badge?: number;
  loading?: boolean;
  ref?: React.Ref<HTMLButtonElement>;
}

/**
 *   <IconButton icon={<Icon name="refresh" size={18} />} label="รีเฟรช" onClick={refetch} />
 */
export function IconButton({
  icon,
  label,
  variant = 'ghost',
  size = 'md',
  badge,
  loading = false,
  type = 'button',
  title,
  className,
  onClick,
  disabled,
  ref,
  ...rest
}: IconButtonProps) {
  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      aria-label={badge ? `${label} (${badge})` : label}
      title={title ?? label}
      disabled={disabled}
      aria-busy={loading || undefined}
      className={cn('ui-iconbtn', `ui-iconbtn--${variant}`, size !== 'md' && `ui-iconbtn--${size}`, size === 'sm' && 'hit-44', className)}
      onClick={(e) => {
        if (loading) { e.preventDefault(); return; }
        onClick?.(e);
      }}
    >
      {loading ? <Spinner /> : icon}
      {badge ? (
        <span className="ui-iconbtn__badge" aria-hidden="true">
          <Badge kind="count" tone="danger">{badge > 99 ? '99+' : badge}</Badge>
        </span>
      ) : null}
    </button>
  );
}
