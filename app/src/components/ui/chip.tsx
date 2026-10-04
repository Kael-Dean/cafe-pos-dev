'use client';

import Icon from '../icons';
import { useI18n } from '@/lib/i18n';
import { cn } from './cn';

type ChipTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent';

interface ChipCommon {
  children: React.ReactNode;
  /** md = 32 visual + 44 hit area · lg = 44 visual (POS category chips). */
  size?: 'md' | 'lg';
  icon?: React.ReactNode;
  className?: string;
}

export type ChipProps =
  /** Toggle filter (category). Exposes aria-pressed. */
  | (ChipCommon & { kind: 'filter'; pressed: boolean; onClick: () => void; disabled?: boolean })
  /** Read-only status pill. */
  | (ChipCommon & { kind: 'status'; tone?: ChipTone })
  /** Value with a remove (×) button — selected member, applied promo. */
  | (ChipCommon & { kind: 'removable'; onRemove: () => void; removeLabel?: string; tone?: ChipTone });

/**
 *   <Chip kind="filter" size="lg" pressed={cat === c.id} onClick={() => setCat(c.id)}>{c.name}</Chip>
 *   <Chip kind="status" tone="success">ว่าง</Chip>
 *   <Chip kind="removable" onRemove={clearMember}>คุณเอ · สมาชิก</Chip>
 */
export function Chip(props: ChipProps) {
  const { t } = useI18n();
  const { children, size = 'md', icon, className } = props;
  const sizeCls = size === 'lg' && 'ui-chip--lg';

  if (props.kind === 'filter') {
    return (
      <button
        type="button"
        className={cn('ui-chip', 'ui-chip--filter', sizeCls, size === 'md' && 'hit-44', className)}
        aria-pressed={props.pressed}
        disabled={props.disabled}
        onClick={props.onClick}
      >
        {icon}
        {children}
      </button>
    );
  }

  const tone = props.tone ?? 'neutral';
  if (props.kind === 'status') {
    return (
      <span className={cn('ui-chip', 'ui-chip--status', `ui-chip--${tone}`, sizeCls, className)}>
        {icon}
        {children}
      </span>
    );
  }

  return (
    <span className={cn('ui-chip', 'ui-chip--removable', tone !== 'neutral' && `ui-chip--${tone}`, sizeCls, className)}>
      {icon}
      {children}
      <button
        type="button"
        className="ui-chip__remove hit-44"
        aria-label={props.removeLabel ?? `${t.ui.remove} ${typeof children === 'string' ? children : ''}`.trim()}
        onClick={props.onRemove}
      >
        <Icon name="x" size={14} strokeWidth={2} />
      </button>
    </span>
  );
}
