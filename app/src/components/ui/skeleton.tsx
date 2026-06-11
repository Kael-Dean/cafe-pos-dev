'use client';

/**
 * Skeleton loading primitives.
 *
 * All variants reuse the single `.skeleton` shimmer class defined in globals.css
 * (transform-only sweep — GPU friendly on low-spec POS hardware, and it already
 * has a dark-mode override so these adapt automatically). Sizes are driven by the
 * --space-* / --radius-* design tokens so spacing stays consistent with the rest
 * of the app and tracks the theme.
 *
 * Accessibility: wrapper variants (Card/Table) are marked aria-busy="true" and
 * accept an optional `label` rendered into a visually-hidden span (the existing
 * `.sr-only` class) so screen readers announce *what* is loading, not just that
 * something is.
 */

import type { CSSProperties } from 'react';

type Sizeable = number | string;

/** Normalize a number → px, pass strings (e.g. "60%", "var(--space-8)") through. */
function dim(v: Sizeable | undefined): string | undefined {
  if (v == null) return undefined;
  return typeof v === 'number' ? `${v}px` : v;
}

export interface SkeletonProps {
  width?: Sizeable;
  height?: Sizeable;
  /** Border radius. Defaults to var(--radius-sm). */
  radius?: Sizeable;
  className?: string;
  style?: CSSProperties;
}

/** A single shimmer block. The atom every other variant is built from. */
export function Skeleton({ width, height, radius, className, style }: SkeletonProps) {
  return (
    <div
      className={`skeleton${className ? ` ${className}` : ''}`}
      aria-hidden="true"
      style={{
        width: dim(width) ?? '100%',
        height: dim(height) ?? 'var(--space-4)',
        borderRadius: dim(radius) ?? 'var(--radius-sm)',
        ...style,
      }}
    />
  );
}

export interface SkeletonTextProps {
  /** Number of lines. */
  lines?: number;
  /** Width of each full line (the last line is rendered at ~60% of this). */
  width?: Sizeable;
  /** Gap between lines. Defaults to var(--space-2). */
  gap?: Sizeable;
  className?: string;
  style?: CSSProperties;
}

/** A paragraph of shimmer bars; the last bar is shortened to read as text. */
export function SkeletonText({ lines = 3, width, gap, className, style }: SkeletonTextProps) {
  const full = dim(width) ?? '100%';
  return (
    <div
      className={className}
      aria-hidden="true"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: dim(gap) ?? 'var(--space-2)',
        ...style,
      }}
    >
      {Array.from({ length: Math.max(1, lines) }).map((_, i) => {
        const isLast = i === lines - 1 && lines > 1;
        return (
          <Skeleton
            key={i}
            height="var(--space-3)"
            width={isLast ? `calc(${full === '100%' ? '100%' : full} * 0.6)` : full}
          />
        );
      })}
    </div>
  );
}

export interface SkeletonCardProps {
  /** Body text lines below the title bar. */
  lines?: number;
  /** Apply surface padding. Set false to embed the card in an already-padded slot. */
  padded?: boolean;
  /** Visually-hidden loading label announced to screen readers. */
  label?: string;
  className?: string;
  style?: CSSProperties;
}

/** A surface card placeholder: a wider title bar + a SkeletonText body. */
export function SkeletonCard({ lines = 3, padded = true, label, className, style }: SkeletonCardProps) {
  return (
    <div
      className={className}
      aria-busy="true"
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        padding: padded ? 'var(--space-5)' : 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-4)',
        ...style,
      }}
    >
      {label ? <span className="sr-only">{label}</span> : null}
      {/* Title bar — taller and ~45% wide */}
      <Skeleton height="var(--space-5)" width="45%" radius="var(--radius-md)" />
      <SkeletonText lines={lines} />
    </div>
  );
}

export interface SkeletonTableProps {
  rows?: number;
  cols?: number;
  /** Render a slightly stronger header row. */
  header?: boolean;
  /** Visually-hidden loading label announced to screen readers. */
  label?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * A grid of shimmer cells. Cell widths are deterministically jittered (per-column)
 * so the placeholder reads as real, ragged tabular data rather than a flat block.
 */
export function SkeletonTable({ rows = 8, cols = 4, header = true, label, className, style }: SkeletonTableProps) {
  // Deterministic per-column jitter (no Math.random → stable across renders/SSR).
  const colWidth = (col: number) => {
    const widths = ['90%', '70%', '85%', '60%', '78%', '66%'];
    return widths[col % widths.length];
  };

  return (
    <div
      className={className}
      aria-busy="true"
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', ...style }}
    >
      {label ? <span className="sr-only">{label}</span> : null}
      {header ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gap: 'var(--space-3)',
            paddingBottom: 'var(--space-2)',
            borderBottom: '1px solid var(--color-border)',
            marginBottom: 'var(--space-1)',
          }}
        >
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} height="var(--space-4)" width="55%" radius="var(--radius-sm)" />
          ))}
        </div>
      ) : null}
      {Array.from({ length: Math.max(1, rows) }).map((_, r) => (
        <div
          key={r}
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gap: 'var(--space-3)',
            padding: 'var(--space-2) 0',
          }}
        >
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} height="var(--space-3)" width={colWidth((r + c) % cols)} />
          ))}
        </div>
      ))}
    </div>
  );
}
