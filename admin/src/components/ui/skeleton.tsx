'use client';

import type { CSSProperties } from 'react';

type Sizeable = number | string;
const px = (v: Sizeable | undefined, fallback: string) => (v === undefined ? fallback : typeof v === 'number' ? `${v}px` : v);

export function Skeleton({ width, height, radius, style }: { width?: Sizeable; height?: Sizeable; radius?: Sizeable; style?: CSSProperties }) {
  return (
    <span
      className="skeleton"
      style={{
        display: 'block',
        width: px(width, '100%'),
        height: px(height, '14px'),
        borderRadius: px(radius, 'var(--radius-sm)'),
        ...style,
      }}
    />
  );
}

/**
 * Table placeholder. Column widths are a fixed pattern rather than random so
 * the server and client renders agree.
 */
const COL_WIDTHS = ['70%', '45%', '55%', '35%', '60%', '40%'];

export function SkeletonTable({ rows = 6, cols = 5, label = 'กำลังโหลดข้อมูล' }: { rows?: number; cols?: number; label?: string }) {
  return (
    <div aria-busy="true" style={{ padding: 'var(--space-2) 0' }}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gap: 'var(--space-4)',
            padding: '13px 14px',
            borderBottom: r === rows - 1 ? 'none' : '1px solid var(--color-border)',
          }}
        >
          {Array.from({ length: cols }).map((__, c) => (
            <Skeleton key={c} width={COL_WIDTHS[(r + c) % COL_WIDTHS.length]} height={12} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonCard({ lines = 3, label = 'กำลังโหลด' }: { lines?: number; label?: string }) {
  return (
    <div className="card" aria-busy="true" style={{ padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <span className="sr-only">{label}</span>
      <Skeleton width="40%" height={16} />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} width={COL_WIDTHS[i % COL_WIDTHS.length]} height={12} />
      ))}
    </div>
  );
}
