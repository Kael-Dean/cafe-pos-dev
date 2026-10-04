import { cn } from './cn';

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent';

export interface BadgeProps {
  children: React.ReactNode;
  /** Colour role. Text always uses the AA-safe `*-fg` token on the `*-50` tint. */
  tone?: BadgeTone;
  /** `status` = tinted pill · `count` = solid numeric bubble (tabular). */
  kind?: 'status' | 'count';
  size?: 'md' | 'lg';
  className?: string;
}

/**
 * Small non-interactive label: status ("พร้อมเสิร์ฟ"), count (3), bestseller tag.
 * Never carry meaning by colour alone — the text (or an icon child) says it.
 * For a hotkey hint use `<Kbd>`.
 */
export function Badge({ children, tone = 'neutral', kind = 'status', size = 'md', className }: BadgeProps) {
  return (
    <span
      className={cn(
        'ui-badge',
        tone !== 'neutral' && `ui-badge--${tone}`,
        kind === 'count' && 'ui-badge--count',
        size === 'lg' && 'ui-badge--lg',
        className,
      )}
    >
      {children}
    </span>
  );
}
