'use client';

import type { ReactNode } from 'react';
import { SkeletonTable } from './skeleton';
import Icon, { type IconName } from './icon';

export interface Column<T> {
  key: string;
  header: string;
  /** Right-aligns and applies tabular numerals. */
  numeric?: boolean;
  width?: string;
  render: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Announced to screen readers and used as the table's accessible name. */
  caption: string;
  loading?: boolean;
  error?: string | null;
  empty?: { icon?: IconName; title: string; body?: string; action?: ReactNode };
  onRetry?: () => void;
}

/**
 * Every list in the portal. Owns its four states — loading, error, empty and
 * populated — so no screen has to reinvent them, and so an empty result never
 * looks like a broken one.
 */
export function DataTable<T>({
  columns, rows, rowKey, caption, loading, error, empty, onRetry,
}: DataTableProps<T>) {
  if (loading) {
    return (
      <div className="card" style={{ overflow: 'hidden' }}>
        <SkeletonTable rows={6} cols={columns.length} label={`กำลังโหลด${caption}`} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="card" style={{ padding: 'var(--space-8)', textAlign: 'center' }} role="alert">
        <Icon name="warning" size={26} color="var(--color-danger-fg)" style={{ margin: '0 auto' }} />
        <p style={{ marginTop: 'var(--space-3)', fontWeight: 'var(--fw-semibold)' }}>โหลด{caption}ไม่สำเร็จ</p>
        <p style={{ marginTop: 4, color: 'var(--color-text-secondary)', fontSize: 'var(--fs-13)' }}>{error}</p>
        {onRetry && (
          <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 'var(--space-4)' }} onClick={onRetry}>
            ลองใหม่
          </button>
        )}
      </div>
    );
  }

  if (rows.length === 0 && empty) {
    return (
      <div className="card" style={{ padding: 'var(--space-10) var(--space-6)', textAlign: 'center' }}>
        {empty.icon && <Icon name={empty.icon} size={28} color="var(--color-text-muted)" style={{ margin: '0 auto' }} />}
        <p style={{ marginTop: 'var(--space-3)', fontWeight: 'var(--fw-semibold)', fontSize: 'var(--fs-16)' }}>{empty.title}</p>
        {empty.body && (
          <p style={{ marginTop: 6, color: 'var(--color-text-secondary)', maxWidth: '46ch', marginInline: 'auto', lineHeight: 1.6 }}>
            {empty.body}
          </p>
        )}
        {empty.action && <div style={{ marginTop: 'var(--space-5)' }}>{empty.action}</div>}
      </div>
    );
  }

  return (
    <div className="card scroll" style={{ overflowX: 'auto' }}>
      <table className="tbl">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" style={{ width: c.width }} className={c.numeric ? 'col-num' : undefined}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((c) => (
                <td key={c.key} className={c.numeric ? 'col-num' : undefined}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
