'use client';

export type TagTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

const TONES: Record<TagTone, { bg: string; fg: string }> = {
  neutral: { bg: 'var(--color-surface-2)', fg: 'var(--color-text-secondary)' },
  success: { bg: 'var(--color-success-50)', fg: 'var(--color-success)' },
  warning: { bg: 'var(--color-warning-50)', fg: 'var(--color-warning-fg)' },
  danger:  { bg: 'var(--color-danger-50)',  fg: 'var(--color-danger-fg)' },
  info:    { bg: 'var(--color-info-50)',    fg: 'var(--color-info)' },
  accent:  { bg: 'var(--color-accent-50)',  fg: 'var(--color-primary-700)' },
};

export function Tag({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: TagTone }) {
  const t = TONES[tone] ?? TONES.neutral;
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '2px 9px', borderRadius: 'var(--radius-pill)',
        background: t.bg, color: t.fg,
        fontSize: 'var(--fs-12)', fontWeight: 'var(--fw-semibold)',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

/**
 * A feature key as it appears on a store. Always read-only: `features` is
 * derived from the tenant's package and recomputed whenever that package
 * changes, so there is nothing here to edit.
 */
export function FeatureChip({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="num"
      style={{
        display: 'inline-flex', alignItems: 'center',
        padding: '2px 8px', borderRadius: 'var(--radius-sm)',
        background: 'var(--color-surface-2)',
        border: '1px solid var(--color-border)',
        color: 'var(--color-text-secondary)',
        fontSize: 'var(--fs-12)',
        fontFamily: 'var(--font-num)',
      }}
    >
      {children}
    </span>
  );
}
