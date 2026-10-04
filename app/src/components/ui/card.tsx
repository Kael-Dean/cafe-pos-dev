'use client';

import { cn } from './cn';

type CardBase = {
  children?: React.ReactNode;
  /** `surface` = white card with hairline · `sunken` = surface-2 panel, no border. */
  variant?: 'surface' | 'sunken';
  /** Inner padding: none · sm 12 · md 16 · lg 20. */
  padding?: 'none' | 'sm' | 'md' | 'lg';
  /** Selected ring (2px primary) — table picked, line selected. Pair with aria-pressed / aria-current. */
  selected?: boolean;
  /** Shows a 2px progress bar on the bottom edge if the wait passes 150ms (menu card tap). */
  pending?: boolean;
  className?: string;
};

export type CardProps =
  | (CardBase & { onClick?: undefined } & Omit<React.HTMLAttributes<HTMLDivElement>, 'onClick'>)
  | (CardBase & { onClick: React.MouseEventHandler<HTMLButtonElement>; disabled?: boolean } &
      Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'>);

/**
 * Surface container. With `onClick` it renders a real <button> (pressable: hover
 * lift on pointer devices, scale .97 on press, focus ring) — build menu cards and
 * floor table cards on this so they share one interaction model.
 *
 *   <Card padding="md">…</Card>
 *   <Card onClick={() => add(item)} pending={adding === item.id} aria-label={`${item.name} ${baht(item.price)}`}>…</Card>
 *
 * Do not nest cards; use spacing or a divider inside one card instead.
 */
export function Card(props: CardProps) {
  const { children, variant = 'surface', padding = 'md', selected, pending, className } = props;
  const classes = cn(
    'ui-card',
    variant === 'sunken' && 'ui-card--sunken',
    padding !== 'none' && `ui-card--pad-${padding}`,
    props.onClick && 'ui-card--interactive',
    className,
  );
  const extra = (
    <>
      {children}
      {pending && <span className="ui-card__pending" aria-hidden="true" />}
    </>
  );

  if (props.onClick) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { children: _c, variant: _v, padding: _p, selected: _s, pending: _pe, className: _cl, type, ...rest } = props;
    return (
      <button
        {...rest}
        type={type ?? 'button'}
        className={classes}
        data-selected={selected ? '' : undefined}
        aria-busy={pending || undefined}
      >
        {extra}
      </button>
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { children: _c, variant: _v, padding: _p, selected: _s, pending: _pe, className: _cl, onClick: _o, ...rest } = props;
  return (
    <div {...rest} className={classes} data-selected={selected ? '' : undefined} aria-busy={pending || undefined}>
      {extra}
    </div>
  );
}
