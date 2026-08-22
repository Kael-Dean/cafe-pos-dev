'use client';

import type { ReactNode } from 'react';
import Icon, { type IconName } from './icon';

/** Top of every page: what this screen is, plus its primary action. */
export function PageHeader({ title, lede, actions }: { title: string; lede?: ReactNode; actions?: ReactNode }) {
  return (
    <header
      style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: 'var(--space-6)', flexWrap: 'wrap',
        marginBottom: 'var(--space-6)',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <h1 style={{ fontSize: 'var(--fs-24)', fontWeight: 'var(--fw-bold)', letterSpacing: '-0.02em' }}>{title}</h1>
        {lede && (
          <p style={{ marginTop: 6, color: 'var(--color-text-secondary)', maxWidth: '68ch', lineHeight: 1.6 }}>{lede}</p>
        )}
      </div>
      {actions && <div style={{ display: 'flex', gap: 'var(--space-2)', flexShrink: 0 }}>{actions}</div>}
    </header>
  );
}

/** A titled block on a detail page. */
export function Section({
  title, description, actions, children,
}: { title: string; description?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 'var(--fs-16)', fontWeight: 'var(--fw-semibold)', letterSpacing: '-0.01em' }}>{title}</h2>
          {description && (
            <p style={{ marginTop: 4, color: 'var(--color-text-secondary)', fontSize: 'var(--fs-13)', maxWidth: '72ch', lineHeight: 1.6 }}>
              {description}
            </p>
          )}
        </div>
        {actions && <div style={{ display: 'flex', gap: 'var(--space-2)' }}>{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/** Label + value row inside a read-only detail card. */
export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 180px) 1fr', gap: 'var(--space-4)', alignItems: 'baseline' }}>
      <dt style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--fs-13)' }}>{label}</dt>
      <dd style={{ margin: 0, minWidth: 0, overflowWrap: 'anywhere' }}>{children}</dd>
    </div>
  );
}

type NoteTone = 'info' | 'warning' | 'danger';

const NOTE_TONE: Record<NoteTone, { bg: string; border: string; fg: string; icon: IconName }> = {
  info:    { bg: 'var(--color-info-50)',    border: 'var(--color-info)',       fg: 'var(--color-info)',       icon: 'info' },
  warning: { bg: 'var(--color-warning-50)', border: 'var(--color-warning-fg)', fg: 'var(--color-warning-fg)', icon: 'warning' },
  danger:  { bg: 'var(--color-danger-50)',  border: 'var(--color-danger-fg)',  fg: 'var(--color-danger-fg)',  icon: 'warning' },
};

/** An inline consequence the reader needs before they act. */
export function Note({ tone = 'info', children }: { tone?: NoteTone; children: ReactNode }) {
  const t = NOTE_TONE[tone];
  return (
    <div
      style={{
        display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start',
        padding: 'var(--space-3) var(--space-4)',
        background: t.bg,
        border: `1px solid ${t.border}`,
        borderRadius: 'var(--radius-md)',
        color: 'var(--color-text)',
        fontSize: 'var(--fs-13)',
        lineHeight: 1.65,
      }}
    >
      <Icon name={t.icon} size={16} color={t.fg} style={{ flexShrink: 0, marginTop: 2 }} />
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

/** Monospaced identifier — slugs, keys, ids. */
export function Mono({ children }: { children: ReactNode }) {
  return (
    <span style={{ fontFamily: 'var(--font-num)', fontSize: '0.94em', color: 'var(--color-text-secondary)' }}>
      {children}
    </span>
  );
}
