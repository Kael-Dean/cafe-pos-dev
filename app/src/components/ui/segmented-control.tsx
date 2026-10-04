'use client';

import { useRef } from 'react';
import { cn } from './cn';

export interface SegmentOption<V extends string = string> {
  value: V;
  label: React.ReactNode;
  icon?: React.ReactNode;
  disabled?: boolean;
  /** ARIA keyshortcuts for this option, e.g. "Alt+1". */
  keyShortcuts?: string;
}

export interface SegmentedControlProps<V extends string = string> {
  value: V;
  onChange: (value: V) => void;
  options: SegmentOption<V>[];
  /** Accessible name of the group ("วิธีชำระเงิน"). */
  ariaLabel: string;
  /** md 44 · lg 56 (payment method tabs). */
  size?: 'md' | 'lg';
  /** `onInverse` for the always-dark KDS surface. */
  variant?: 'default' | 'onInverse';
  /** Stretch to the container width, segments share it equally. */
  fullWidth?: boolean;
  className?: string;
}

/**
 * One-of-N switch: payment method, density (รูป / กะทัดรัด), KDS filter.
 * A radiogroup with a roving tab stop: Tab enters on the checked segment,
 * ← → ↑ ↓ Home End move AND select (like native radios).
 */
export function SegmentedControl<V extends string = string>({
  value,
  onChange,
  options,
  ariaLabel,
  size = 'md',
  variant = 'default',
  fullWidth = false,
  className,
}: SegmentedControlProps<V>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);
  const current = options.findIndex((o) => o.value === value);
  const tabStop = current >= 0 && !options[current].disabled ? current : enabled[0];

  const move = (from: number, dir: 1 | -1 | 'first' | 'last') => {
    if (enabled.length === 0) return;
    let target: number;
    if (dir === 'first') target = enabled[0];
    else if (dir === 'last') target = enabled[enabled.length - 1];
    else {
      const pos = enabled.indexOf(from);
      target = enabled[(pos + dir + enabled.length) % enabled.length];
    }
    onChange(options[target].value);
    refs.current[target]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn('ui-seg', size === 'lg' && 'ui-seg--lg', variant === 'onInverse' && 'ui-seg--onInverse', fullWidth && 'ui-seg--block', className)}
    >
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => { refs.current[i] = el; }}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          aria-keyshortcuts={o.keyShortcuts}
          tabIndex={i === tabStop ? 0 : -1}
          disabled={o.disabled}
          className="ui-seg__item"
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            const k = e.key;
            if (k === 'ArrowRight' || k === 'ArrowDown') { e.preventDefault(); move(i, 1); }
            else if (k === 'ArrowLeft' || k === 'ArrowUp') { e.preventDefault(); move(i, -1); }
            else if (k === 'Home') { e.preventDefault(); move(i, 'first'); }
            else if (k === 'End') { e.preventDefault(); move(i, 'last'); }
          }}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}
