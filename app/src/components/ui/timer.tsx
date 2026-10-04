'use client';

import { useEffect, useState } from 'react';
import Icon from '../icons';
import { useI18n } from '@/lib/i18n';
import { cn } from './cn';

export interface TimerProps {
  /** When the clock started (ticket created, table opened). Date, ISO string or epoch ms. */
  since: Date | string | number;
  /** Minutes at which the chip turns warning. Default 5. */
  warnAfter?: number;
  /** Minutes at which the chip turns danger. Default 10. */
  dangerAfter?: number;
  /** Re-render interval in ms. Default 15000 (spec §6). */
  tickMs?: number;
  /** `mm:ss`-free minute display ("12 นาที") or clock ("1:05" h:mm for long sessions). */
  format?: 'minutes' | 'clock';
  className?: string;
}

const toMs = (v: Date | string | number) => (v instanceof Date ? v.getTime() : typeof v === 'string' ? Date.parse(v) : v);

/**
 * Elapsed-time chip for KDS tickets and floor tables. Urgency is shown three
 * ways, never hue alone: tint, icon (clock → warning) and the number itself.
 *
 *   <Timer since={ticket.createdAt} />   // neutral <5 · warning 5–10 · danger >10 min
 */
export function Timer({ since, warnAfter = 5, dangerAfter = 10, tickMs = 15000, format = 'minutes', className }: TimerProps) {
  const { t } = useI18n();
  // The clock lives in state and advances on an interval, so rendering stays pure.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(id);
  }, [tickMs]);

  const mins = Math.max(0, Math.floor((now - toMs(since)) / 60000));
  const tone = mins >= dangerAfter ? 'danger' : mins >= warnAfter ? 'warning' : 'neutral';
  const label = format === 'clock' ? `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}` : t.ui.elapsedMinutes(mins);

  return (
    <span className={cn('ui-timer', tone !== 'neutral' && `ui-timer--${tone}`, className)}>
      <Icon name={tone === 'neutral' ? 'clock' : 'warning'} size={14} strokeWidth={2} />
      {/* Server and client clocks differ by the render gap; the next tick corrects it. */}
      <span suppressHydrationWarning>{label}</span>
    </span>
  );
}
