import './tokens.css';
import './ui.css';
import Icon from '../icons';
import { cn } from './cn';

export type BannerTone = 'neutral' | 'info' | 'warning' | 'danger' | 'accent';

export interface BannerProps {
  /**
   * Suggested mapping (spec §6): offline → danger · stale data → warning ·
   * POS table mode → accent · general notice → info.
   */
  tone?: BannerTone;
  icon?: string;
  title: React.ReactNode;
  /** Secondary text after the title ("อัปเดตล่าสุด 14:02"). */
  detail?: React.ReactNode;
  /** Trailing controls, e.g. a retry Button size="sm" or "ออกจากโหมดโต๊ะ". */
  action?: React.ReactNode;
  size?: 'md' | 'lg';
  /** `alert` for offline / blocking problems; `status` (default) for passive state. */
  live?: 'status' | 'alert' | 'off';
  className?: string;
}

const DEFAULT_ICON: Record<BannerTone, string> = {
  neutral: 'info', info: 'info', warning: 'clock', danger: 'wifiOff', accent: 'park',
};

/**
 * Full-width persistent strip for a STATE (offline, stale data, table mode).
 * Not dismissible: it goes away when the state does.
 *
 *   <Banner tone="warning" title="ข้อมูลอาจไม่ล่าสุด" detail="อัปเดต 14:02"
 *     action={<Button size="sm" variant="secondary" onClick={refetch}>ลองอีกครั้ง</Button>} />
 */
export function Banner({ tone = 'info', icon, title, detail, action, size = 'md', live = 'status', className }: BannerProps) {
  return (
    <div
      className={cn('ui-banner', tone !== 'neutral' && `ui-banner--${tone}`, size === 'lg' && 'ui-banner--lg', className)}
      role={live === 'off' ? undefined : live}
    >
      <Icon name={icon ?? DEFAULT_ICON[tone]} size={18} />
      <div className="ui-banner__text">
        <span className="ui-banner__title">{title}</span>
        {detail != null && <> <span className="ui-banner__detail">{detail}</span></>}
      </div>
      {action != null && <div className="ui-banner__action">{action}</div>}
    </div>
  );
}
