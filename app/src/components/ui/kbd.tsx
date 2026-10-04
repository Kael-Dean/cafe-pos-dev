import { cn } from './cn';

export interface KbdProps {
  children: React.ReactNode;
  /** `onInverse` for the always-dark surfaces (KDS, `.surface-inverse`). */
  variant?: 'default' | 'onInverse';
  className?: string;
}

/**
 * A key cap: `F12`, `Ctrl`, `/`. Hidden on touch-only devices (no fine pointer),
 * because there is no keyboard to press. It is a hint, so it is aria-hidden when
 * it sits inside a control that already has a name; pass the shortcut to the
 * control's `aria-keyshortcuts` instead.
 */
export function Kbd({ children, variant = 'default', className }: KbdProps) {
  return <kbd className={cn('ui-kbd', variant === 'onInverse' && 'ui-kbd--onInverse', className)}>{children}</kbd>;
}
