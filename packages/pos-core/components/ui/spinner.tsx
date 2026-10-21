import './tokens.css';
import './ui.css';
import { cn } from './cn';

export interface SpinnerProps {
  size?: 'md' | 'lg';
  /** Announced to screen readers. Omit when the parent already says it is busy (aria-busy). */
  label?: string;
  className?: string;
}

/**
 * Indeterminate spinner. Reuses the global `.spinner` (it keeps turning, slower,
 * under prefers-reduced-motion because it is functional, not decorative).
 * Colour = currentColor, so it takes the ink of whatever it sits in.
 */
export function Spinner({ size = 'md', label, className }: SpinnerProps) {
  return (
    <span
      className={cn('spinner', size === 'lg' && 'ui-spinner--lg', className)}
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
