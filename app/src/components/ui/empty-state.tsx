import Icon from '../icons';
import { cn } from './cn';

export interface EmptyStateProps {
  /** `neutral` nothing here yet · `search` no results · `danger` failed to load (pair with a retry action). */
  tone?: 'neutral' | 'search' | 'danger';
  /** Icon name from components/icons. Defaults per tone. */
  icon?: string;
  title: React.ReactNode;
  body?: React.ReactNode;
  /** Usually one Button: "ลองอีกครั้ง", "ล้างคำค้น", "ไปตั้งค่าโต๊ะ". */
  action?: React.ReactNode;
  /** Heading level for the title (default 3). */
  headingLevel?: 2 | 3 | 4;
  className?: string;
}

const DEFAULT_ICON = { neutral: 'list', search: 'search', danger: 'warning' } as const;

/**
 * Empty / no-result / load-error block. Replaces the ad-hoc versions in pos.tsx,
 * floor.tsx and kds.tsx. The danger tone is announced (role="alert").
 *
 *   <EmptyState tone="danger" title="โหลดเมนูไม่สำเร็จ" body="ตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง"
 *     action={<Button variant="secondary" onClick={() => refetch()}>ลองอีกครั้ง</Button>} />
 */
export function EmptyState({ tone = 'neutral', icon, title, body, action, headingLevel = 3, className }: EmptyStateProps) {
  const H = `h${headingLevel}` as const;
  return (
    <div className={cn('ui-empty', tone === 'danger' && 'ui-empty--danger', className)} role={tone === 'danger' ? 'alert' : undefined}>
      <span className="ui-empty__icon" aria-hidden="true">
        <Icon name={icon ?? DEFAULT_ICON[tone]} size={40} strokeWidth={1.5} />
      </span>
      <H className="ui-empty__title">{title}</H>
      {body != null && <p className="ui-empty__body">{body}</p>}
      {action != null && <div className="ui-empty__action">{action}</div>}
    </div>
  );
}
