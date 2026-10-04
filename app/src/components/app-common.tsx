'use client';

import { useState, useCallback, useRef, useEffect, Fragment } from 'react';
import { createPortal } from 'react-dom';
import Icon from './icons';
import { useCurrentUser } from '@/hooks/use-current-user';
import { useFeatures, FEATURE_BOARDGAME } from '@/hooks/use-features';
import { displayNumber, parseNumberInput, clampNumber } from '@/lib/number-input';
import { useI18n } from '@/lib/i18n';
// Import the gsap-free count-up directly (not via the @/lib/motion barrel, which
// re-exports the side-effectful gsap engine). app-common is in the shell on every
// screen, so this keeps the ~71KB gsap engine attributable to the screen chunks
// that actually animate with it rather than anchoring it into the shared shell.
import { useCountUp } from '@/lib/motion/use-count-up';

// ---------- Toast ----------
// Moved to the design system: import { useToast, ToastProvider } from '@/components/ui/toast'.
// Re-exported here (same API) only so an import that was missed keeps working.
/** @deprecated import from '@/components/ui/toast' */
export { useToast, ToastProvider } from './ui/toast';

// ---------- Sidebar ----------
// Labels are resolved at render time from the active language (`t.nav[id]`); the array
// holds only structural metadata (id, icon, visibility flags).
export type NavItem = {
  id: string; icon?: string; soft?: boolean; adminOnly?: boolean; ownerOnly?: boolean;
  divider?: boolean; header?: boolean;
  /** Store entitlement required to see this item — hidden when the add-on isn't sold. */
  feature?: string;
};

// Grouped by working mode so each job (taking orders, kitchen/stock, CRM, running
// the shop, one-time setup) sits together and is quick to find. `header` rows are
// group headings (label from `t.navSection[id]`, glyph from `icon`) — rendered as a
// collapsible heading when the sidebar is expanded, as a plain divider when it's
// collapsed. Within a group, items run most-used first.
export const NAV: NavItem[] = [
  // Front-of-house — everything a cashier touches during a shift. The cash drawer
  // is opened/closed every day, so it sits above the occasional receipt reprint.
  { id: 'sec-service', header: true, icon: 'coffee' },
  { id: 'pos',       icon: 'pos' },
  { id: 'kds',       icon: 'kds' },
  { id: 'pre-orders',    icon: 'calendar' },
  { id: 'cash',      icon: 'cash',     adminOnly: true },
  { id: 'receipt-copies', icon: 'reports', adminOnly: true },

  // Board-game add-on — the whole group disappears for stores without the
  // `vertical.boardgame` entitlement (its endpoints answer 404 there).
  { id: 'sec-boardgame', header: true, icon: 'dice' },
  { id: 'floor',       icon: 'park',     feature: FEATURE_BOARDGAME },
  { id: 'table-setup', icon: 'settings', feature: FEATURE_BOARDGAME, adminOnly: true },

  // Kitchen & stock — the daily stock jobs first (check, count, buy), then the
  // menu-definition screens that are edited now and then (prep, recipes, catalog).
  { id: 'sec-kitchen', header: true, icon: 'pot' },
  { id: 'inventory', icon: 'inv',      soft: true },
  { id: 'stock-take',    icon: 'check' },
  { id: 'shopping-list', icon: 'cart' },
  { id: 'bakery',    icon: 'cake' },
  { id: 'bom',       icon: 'inv' },
  { id: 'catalog',   icon: 'inv',      ownerOnly: true },

  // Customers & marketing.
  { id: 'sec-crm', header: true, icon: 'user' },
  { id: 'promotions', icon: 'tag' },
  { id: 'members',   icon: 'customers', adminOnly: true },
  { id: 'customers', icon: 'customers', soft: true },
  { id: 'sales',     icon: 'staff',    adminOnly: true },

  // Manage & reports — the manager's overview of the shop.
  { id: 'sec-manage', header: true, icon: 'chart' },
  { id: 'dashboard', icon: 'chart' },
  { id: 'reports',   icon: 'reports',  soft: true },
  { id: 'protocols', icon: 'check' },
  { id: 'shifts',    icon: 'calendar' },
  { id: 'hr',        icon: 'staff',    adminOnly: true },

  // System setup — configured once, rarely touched day to day. General settings
  // lead; the recycle bin (rare, destructive) goes last.
  { id: 'sec-setup', header: true, icon: 'settings' },
  { id: 'settings',  icon: 'settings', soft: true },
  { id: 'hardware',  icon: 'printer' },
  { id: 'recycle-bin', icon: 'trash',  adminOnly: true },
];

/** The group (header id) a screen belongs to — from the raw NAV, independent of role filtering. */
export const groupOfScreen = (screen: string): string | undefined => {
  let group: string | undefined;
  for (const n of NAV) {
    if (n.header) group = n.id;
    else if (n.id === screen) return group;
  }
  return undefined;
};

export interface NavSection { id: string; icon?: string; items: NavItem[] }

/**
 * NAV grouped into { header, items } sections with everything this role / store
 * cannot see removed (and any section left empty dropped).
 *
 * THE single source of nav visibility: the desktop Sidebar and the phone nav
 * (mobile-nav.tsx) both render from this, so a screen can never be visible in one
 * and unreachable in the other. Add new visibility rules here, nowhere else.
 */
export const visibleNavSections = (role: string | undefined, features: readonly string[] | undefined): NavSection[] => {
  const isAdmin = role === 'OWNER' || role === 'MANAGER';
  const sections: NavSection[] = [];
  for (const n of NAV) {
    if (n.header) { sections.push({ id: n.id, icon: n.icon, items: [] }); continue; }
    if (n.divider) continue;
    if (n.adminOnly && !isAdmin) continue;
    if (n.ownerOnly && role !== 'OWNER') continue;
    if (n.feature && !features?.includes(n.feature)) continue;
    sections[sections.length - 1]?.items.push(n);
  }
  return sections.filter((s) => s.items.length > 0);
};

/** The current user's visible nav + the bits of identity both navs display. */
export const useVisibleNav = () => {
  const { t } = useI18n();
  const { data: me } = useCurrentUser();
  const { data: features } = useFeatures();
  const role = me?.role;
  return {
    sections: visibleNavSections(role, features),
    me,
    role,
    isAdmin: role === 'OWNER' || role === 'MANAGER',
    initial: me?.name ? me.name.charAt(0).toUpperCase() : '?',
    roleLabel: role ? (t.roles as Record<string, string>)[role] ?? role : '',
    navLabel: (id: string) => (t.nav as Record<string, string>)[id] ?? id,
    sectionLabel: (id: string) => (t.navSection as Record<string, string>)[id] ?? id,
  };
};

// Which sidebar groups are open, remembered per device. Storage can be blocked
// (private mode, quota) — the sidebar then just falls back to its default.
const SB_GROUPS_KEY = 'cafe_pos_sidebar_groups';
const readStoredGroups = (): Record<string, boolean> | null => {
  try {
    const raw = window.localStorage.getItem(SB_GROUPS_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(parsed)) if (typeof v === 'boolean') out[k] = v;
    return out;
  } catch {
    return null;
  }
};

interface SidebarProps { current: string; onNavigate: (id: string) => void; onLogout?: () => void; branchName?: string; collapsed?: boolean; onToggle?: () => void; }

export const Sidebar = ({ current, onNavigate, onLogout, branchName = 'Sukhumvit 49', collapsed = false, onToggle }: SidebarProps) => {
  const { t } = useI18n();
  // Role / feature filtering is shared with the phone nav — see visibleNavSections.
  const { sections: visibleSections, me, initial, roleLabel, navLabel, sectionLabel } = useVisibleNav();
  const currentGroupId = groupOfScreen(current);

  // Each group is a collapsible section. The open set is explicit and remembered
  // per device: first run opens only the group holding the current screen, after
  // that every group stays exactly as the user left it — nothing closes on its own,
  // so the list never shifts under a finger mid-tap.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(
    () => readStoredGroups() ?? (currentGroupId ? { [currentGroupId]: true } : {}),
  );
  const toggleGroup = (id: string) => setOpenGroups((prev) => ({ ...prev, [id]: !prev[id] }));

  // Arriving on a screen from elsewhere (rail, in-app link, bottom tabs) reveals
  // its group. Adjusted during render, keyed on the screen, so it runs once per
  // navigation and never fights a manual close made afterwards.
  const [revealedFor, setRevealedFor] = useState(current);
  if (revealedFor !== current) {
    setRevealedFor(current);
    if (currentGroupId && !openGroups[currentGroupId]) {
      setOpenGroups({ ...openGroups, [currentGroupId]: true });
    }
  }

  useEffect(() => {
    try {
      window.localStorage.setItem(SB_GROUPS_KEY, JSON.stringify(openGroups));
    } catch {
      // Storage unavailable — the open set simply lasts for this session only.
    }
  }, [openGroups]);

  // Item row shared by both layouts (accordion when expanded, flat rail when collapsed).
  const renderItem = (n: NavItem) => {
    const active = current === n.id;
    return (
      <button key={n.id} type="button" onClick={() => onNavigate(n.id)}
        data-nav-id={n.id}
        className={`sb-item${active ? ' active' : ''}`}
        title={collapsed ? navLabel(n.id) : undefined}
        aria-current={active ? 'page' : undefined}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: collapsed ? '10px 0' : '10px 10px', borderRadius: 8,
          justifyContent: collapsed ? 'center' : 'flex-start',
          fontSize: 14, minHeight: 44,
          textAlign: 'left', width: '100%',
          position: 'relative',
        }}
      >
        {n.icon && <Icon name={n.icon} size={18} style={{flexShrink: 0}} />}
        {!collapsed && <span className="sb-fade sb-item-label">{navLabel(n.id)}</span>}
        {!collapsed && n.soft && <span className="sb-fade" style={{fontSize: 10, color: 'currentColor', opacity: 0.55, fontWeight: 500}}>P1</span>}
      </button>
    );
  };

  return (
    // Desktop/tablet only: below 768px <MobileNav> (mobile-nav.tsx — bottom tab bar
    // + menu sheet) is the nav, so the sidebar is hidden to avoid a duplicate nav
    // landmark and to free the full width for content on phones.
    <div className="hidden md:block" style={{ position: 'relative', flexShrink: 0 }}>
    {/* Collapse/expand is an INSTANT layout change (64 ↔ 240px): animating width /
        padding re-laid-out the whole POS grid every frame (impeccable
        layout-transition, UI-SPEC §8). The labels still fade in (.sb-fade, opacity
        only) and the toggle chevron rotates (transform), so the change reads as
        deliberate without moving layout per frame. */}
    <aside className="sidebar-surface" style={{
      width: collapsed ? 64 : 240,
      height: 'var(--app-h, 100dvh)',
      display: 'flex', flexDirection: 'column',
      borderRight: '1px solid var(--sb-border)',
      overflow: 'hidden',
    }}>
      <div style={{
        // Expanded: left edge lines up with the group-heading icon tiles below.
        padding: collapsed ? '16px 0 12px' : '16px 14px 12px',
        display: 'flex',
        flexDirection: collapsed ? 'column' : 'row',
        alignItems: 'center',
        gap: collapsed ? 8 : 12,
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10, flexShrink: 0,
          background: 'var(--color-accent)', color: 'var(--sb-avatar-fg)',
          display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 18,
        }}>K</div>
        {!collapsed && (
          <div className="sb-fade" style={{flex: 1, minWidth: 0}}>
            <div style={{fontWeight: 700, fontSize: 15, letterSpacing: '-0.01em', whiteSpace: 'nowrap', color: 'var(--sb-text-strong)'}}>Kafé OS</div>
            <div style={{fontSize: 11, color: 'var(--sb-text-muted)', whiteSpace: 'nowrap'}}>{me?.store_name ?? branchName}</div>
          </div>
        )}
        {onToggle && (
          <button
            onClick={onToggle}
            className="icon-btn-soft hit-44"
            title={collapsed ? t.sidebar.expand : t.sidebar.collapse}
            aria-label={collapsed ? t.sidebar.expand : t.sidebar.collapse}
            aria-expanded={!collapsed}
            style={{
              width: 28, height: 28, borderRadius: 6, flexShrink: 0,
              border: 'none', cursor: 'pointer',
              display: 'grid', placeItems: 'center',
            }}
          >
            <Icon name="chevronLeft" size={14} style={{
              transform: collapsed ? 'rotate(180deg)' : 'none',
              transition: 'transform var(--dur-slow) var(--ease-out)',
            }} />
          </button>
        )}
      </div>

      <nav aria-label={t.sidebar.navLabel} style={{padding: collapsed ? '8px 8px' : '4px 8px 8px', flex: 1, display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto', overflowX: 'hidden'}}>
        {collapsed
          ? // Icon-only rail: no room for group headings, so show every item and
            // separate the groups with a hairline divider (none before the first).
            visibleSections.map((s, si) => (
              <Fragment key={s.id}>
                {si > 0 && <div className="sb-rail-divider" />}
                {s.items.map(renderItem)}
              </Fragment>
            ))
          : // Expanded: each group is a collapsible section — the whole heading row
            // toggles it, so only the functions you need are on screen at once.
            visibleSections.map((s) => {
              const open = !!openGroups[s.id];
              const isCurrent = s.id === currentGroupId;
              const btnId = `sb-group-${s.id}`;
              const panelId = `sb-panel-${s.id}`;
              return (
                <div key={s.id} className="sb-group">
                  <button
                    type="button"
                    id={btnId}
                    onClick={() => toggleGroup(s.id)}
                    className={`sb-group-btn${open ? ' open' : ''}${isCurrent ? ' current' : ''}`}
                    aria-expanded={open}
                    aria-controls={panelId}
                  >
                    <span className="sb-group-icon"><Icon name={s.icon ?? 'list'} size={18} strokeWidth={1.75} /></span>
                    <span className="sb-fade sb-group-text">
                      <span className="sb-group-label">{sectionLabel(s.id)}</span>
                      {/* Closed group that holds the current screen: name the screen
                          under the heading so "where am I" survives collapsing it. */}
                      {isCurrent && !open && <span className="sb-group-here">{navLabel(current)}</span>}
                    </span>
                    <Icon name="chevronDown" size={18} strokeWidth={2} className="sb-group-chevron" />
                  </button>
                  {/* Always mounted so open/close can animate height; `inert` keeps a
                      closed group out of the tab order and the accessibility tree. */}
                  <div id={panelId} role="group" aria-labelledby={btnId} inert={!open}
                    className={`sb-group-panel${open ? ' open' : ''}`}>
                    <div className="sb-group-clip">
                      <div className="sb-group-items">{s.items.map(renderItem)}</div>
                    </div>
                  </div>
                </div>
              );
            })}
      </nav>

      <div style={{ padding: collapsed ? '8px 8px' : '8px 12px', marginBottom: 4 }}>
        <div style={{
          padding: collapsed ? '8px 0' : 12,
          background: 'var(--sb-card-bg)',
          borderRadius: 10,
          display: 'flex', alignItems: 'center', gap: 10,
          justifyContent: collapsed ? 'center' : 'flex-start',
          marginBottom: 8,
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: 999,
            background: 'var(--color-accent)', color: 'var(--sb-avatar-fg)',
            display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 13,
            flexShrink: 0,
          }}>{initial}</div>
          {!collapsed && (
            <div className="sb-fade" style={{flex: 1, minWidth: 0}}>
              <div style={{fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--sb-text-strong)'}}>{me?.name ?? '...'}</div>
              <div style={{fontSize: 11, color: 'var(--sb-text-muted)'}}>{roleLabel}</div>
            </div>
          )}
        </div>
        {onLogout && !collapsed && (
          <button
            onClick={onLogout}
            className="sb-logout"
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 10,
              padding: '9px 12px', borderRadius: 8, minHeight: 44,
              fontSize: 13, fontWeight: 500,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            <Icon name="x" size={15} />
            <span className="sb-fade">{t.sidebar.logout}</span>
          </button>
        )}
        {onLogout && collapsed && (
          <button
            onClick={onLogout}
            className="sb-logout"
            title={t.sidebar.logout}
            aria-label={t.sidebar.logout}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '9px 0', borderRadius: 8, minHeight: 44,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            <Icon name="x" size={15} />
          </button>
        )}
      </div>
    </aside>
    </div>
  );
};

// ---------- Reusable bits ----------
interface KPICardProps {
  label: string; value: number | string; prefix?: string; suffix?: string; delta?: number; vsLabel?: string;
  /** Animate a numeric value counting up on mount/change (dashboard headline KPIs). */
  countUp?: boolean;
}

/** Renders a KPI value, optionally tweening it up to its target with useCountUp. */
const KPIValue = ({ value, prefix, suffix, countUp }: { value: number | string; prefix: string; suffix: string; countUp?: boolean }) => {
  const isNum = typeof value === 'number';
  // Whole numbers print without decimals; floats keep one (e.g. GP% 68.4).
  const fmt = (n: number) =>
    `${prefix}${(Number.isInteger(value) ? Math.round(n) : Number(n.toFixed(1))).toLocaleString('en-US', { maximumFractionDigits: Number.isInteger(value) ? 0 : 1 })}${suffix}`;
  const ref = useCountUp(isNum && countUp ? (value as number) : 0, { format: fmt });

  if (isNum && countUp) {
    // Seed with the final text so SSR/first paint and reduced-motion show the value.
    return <span ref={ref}>{fmt(value as number)}</span>;
  }
  return <>{prefix}{isNum ? (value as number).toLocaleString() : value}{suffix}</>;
};

export const KPICard = ({ label, value, prefix='', suffix='', delta, vsLabel, countUp }: KPICardProps) => {
  const positive = (delta ?? 0) >= 0;
  return (
    // .kpi-card / .kpi-value (globals.css): same look as before on desktop, tighter
    // padding and a smaller figure on phones so two cards fit side by side.
    <div className="kpi-card">
      <div style={{fontSize: 13, color: 'var(--color-text-secondary)', fontWeight: 500}}>{label}</div>
      <div className="num kpi-value">
        <KPIValue value={value} prefix={prefix} suffix={suffix} countUp={countUp} />
      </div>
      {delta != null && (
        <div style={{display: 'flex', alignItems: 'center', gap: 6, fontSize: 12}}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 2,
            color: positive ? 'var(--color-success)' : 'var(--color-danger)',
            background: positive ? 'var(--color-success-50)' : 'var(--color-danger-50)',
            padding: '2px 6px', borderRadius: 4, fontWeight: 600,
          }}>
            <Icon name={positive ? 'arrowUp' : 'arrowDown'} size={12} />
            {Math.abs(delta).toFixed(1)}%
          </span>
          <span style={{color: 'var(--color-text-muted)'}}>{vsLabel}</span>
        </div>
      )}
    </div>
  );
};

type TagTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';
interface TagProps { children: React.ReactNode; tone?: TagTone; }

export const Tag = ({ children, tone = 'neutral' }: TagProps) => {
  const toneMap: Record<TagTone, { bg: string; fg: string }> = {
    neutral: { bg: 'var(--color-surface-2)', fg: 'var(--color-text-secondary)' },
    success: { bg: 'var(--color-success-50)', fg: 'var(--color-success)' },
    warning: { bg: 'var(--color-warning-50)', fg: 'var(--color-warning-fg)' },
    danger:  { bg: 'var(--color-danger-50)',  fg: 'var(--color-danger)' },
    info:    { bg: 'var(--color-info-50)',    fg: 'var(--color-info)' },
    accent:  { bg: 'var(--color-accent-50)',  fg: 'var(--color-primary-700)' },
  };
  const t = toneMap[tone] || toneMap.neutral;
  return <span style={{
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '2px 8px', borderRadius: 999,
    background: t.bg, color: t.fg,
    fontSize: 11, fontWeight: 600,
  }}>{children}</span>;
};

export const baht = (n: number) => `฿${(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

// ---------- Select (styled dropdown) ----------
// Shared dropdown for the whole app. ALWAYS use this instead of a native <select>
// so every dropdown shows the same decorated, custom-styled menu (native <select>
// popups are drawn by the OS and cannot be styled — they look inconsistent).
export interface SelectOption { value: string; label: string; disabled?: boolean; }

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  /** Shown (muted) when value matches no option. */
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  /** Merged into the wrapper div (e.g. width overrides). */
  style?: React.CSSProperties;
  /** Merged into the trigger button (e.g. compact padding / background). */
  triggerStyle?: React.CSSProperties;
  menuMaxHeight?: number;
}

export const Select = ({
  value, onChange, options, placeholder, disabled = false,
  ariaLabel, style, triggerStyle, menuMaxHeight = 280,
}: SelectProps) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Menu is portaled to <body> so it can escape any overflow:hidden / clipped
  // ancestor (e.g. cards). Position is measured from the trigger each time it
  // opens and on scroll/resize, and flips upward when there's no room below.
  const [pos, setPos] = useState<{ left: number; top: number; width: number; maxHeight: number; up: boolean } | null>(null);
  const selected = options.find((o) => o.value === value);
  const displayLabel = selected ? selected.label : (placeholder ?? options[0]?.label ?? '');
  const isPlaceholder = !selected;

  const updatePos = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const gap = 4;
    const spaceBelow = window.innerHeight - r.bottom - 8;
    const spaceAbove = r.top - 8;
    const up = spaceBelow < Math.min(menuMaxHeight, 200) && spaceAbove > spaceBelow;
    setPos({
      left: r.left,
      width: r.width,
      top: up ? r.top - gap : r.bottom + gap,
      maxHeight: Math.max(120, Math.min(menuMaxHeight, up ? spaceAbove : spaceBelow)),
      up,
    });
  }, [menuMaxHeight]);

  useEffect(() => {
    if (!open) { setPos(null); return; }
    updatePos();
    const onMove = () => updatePos();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, updatePos]);

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%', ...style }}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => { if (!disabled) setOpen((v) => !v); }}
        style={{
          width: '100%', boxSizing: 'border-box', padding: '10px 12px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
          background: 'var(--color-surface)', borderRadius: 8,
          border: `1px solid ${open ? 'var(--color-accent)' : 'var(--color-border)'}`,
          boxShadow: open ? 'var(--shadow-focus)' : 'none',
          fontSize: 14, fontFamily: 'inherit', textAlign: 'left',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.55 : 1,
          color: isPlaceholder ? 'var(--color-text-muted)' : 'var(--color-text)',
          transition: 'border-color 150ms, box-shadow 150ms',
          ...triggerStyle,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayLabel}</span>
        <Icon name="chevronDown" size={14} style={{ color: 'var(--color-text-secondary)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms', flexShrink: 0 }} />
      </button>
      {open && pos && createPortal(
        <div
          ref={menuRef}
          role="listbox"
          style={{
            position: 'fixed', left: pos.left, width: pos.width,
            top: pos.up ? undefined : pos.top,
            bottom: pos.up ? window.innerHeight - pos.top : undefined,
            background: 'var(--color-surface)', border: '1px solid var(--color-border)',
            borderRadius: 8, boxShadow: 'var(--shadow-md)', zIndex: 'var(--z-popover)',
            overflowY: 'auto', maxHeight: pos.maxHeight, padding: 4,
          }}
        >
          {options.map((opt) => {
            const isSel = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isSel}
                disabled={opt.disabled}
                onClick={() => { if (opt.disabled) return; onChange(opt.value); setOpen(false); }}
                style={{
                  width: '100%', display: 'block', textAlign: 'left',
                  padding: '9px 10px', borderRadius: 6, border: 'none',
                  fontSize: 14, fontFamily: 'inherit',
                  cursor: opt.disabled ? 'not-allowed' : 'pointer',
                  background: isSel ? 'var(--color-accent-50)' : 'transparent',
                  color: opt.disabled ? 'var(--color-text-muted)' : isSel ? 'var(--color-primary-700)' : 'var(--color-text)',
                  fontWeight: isSel ? 600 : 400,
                  opacity: opt.disabled ? 0.6 : 1,
                  transition: 'background 100ms',
                }}
                onMouseEnter={(e) => { if (!isSel && !opt.disabled) e.currentTarget.style.background = 'var(--color-surface-2)'; }}
                onMouseLeave={(e) => { if (!isSel && !opt.disabled) e.currentTarget.style.background = 'transparent'; }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
};

// ---------- Layout primitives ----------
// <MasterDetail> and <ModalShell> live in ./layout; re-exported so screens can keep
// importing shared UI from one place. The phone nav (bottom tab bar + menu sheet)
// is in ./mobile-nav and is mounted once, by app/page.tsx.
export { MasterDetail, ModalShell } from './layout';
export type { MasterDetailProps, ModalShellProps } from './layout';

// ---------- NumberInput ----------
// Controlled numeric <input> that can actually be CLEARED.
//
// Use this instead of `<input type="number" value={n} onChange={e => set(Number(e.target.value))} />`.
// That naive pattern turns an empty field into 0, so the box can never be emptied
// and shows a stuck "0" that new digits append to ("0" + "100" => "0100"), which is
// especially painful on iPads. NumberInput keeps an internal draft string so the box
// stays empty while editing, but still reports a plain `number` to `onChange`.
//
// `min`/`max` are clamped on blur (not while typing), so a "must be >= 1" field can be
// cleared during editing and snaps back to its minimum when focus leaves.
type NumberInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'min' | 'max' | 'type'
> & {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  /** Round to an integer. */
  integer?: boolean;
  /** Number reported (and shown as an empty box) when the field is empty. Default 0. */
  emptyValue?: number;
};

export const NumberInput = ({
  value,
  onChange,
  min,
  max,
  integer = false,
  emptyValue = 0,
  onFocus,
  onBlur,
  inputMode,
  ...rest
}: NumberInputProps) => {
  // `draft` is the raw text while the user is editing; `null` means "not editing",
  // so the box mirrors the numeric prop. Deriving the displayed value this way (no
  // effect) keeps an empty box empty while typing without cascading re-renders.
  const [draft, setDraft] = useState<string | null>(null);
  const display = draft ?? displayNumber(value, emptyValue);

  return (
    <input
      {...rest}
      type="number"
      inputMode={inputMode ?? (integer ? 'numeric' : 'decimal')}
      min={min}
      max={max}
      value={display}
      onFocus={(e) => {
        setDraft(displayNumber(value, emptyValue));
        onFocus?.(e);
      }}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        onChange(parseNumberInput(raw, { integer, emptyValue }));
      }}
      onBlur={(e) => {
        const normalised = clampNumber(parseNumberInput(draft ?? '', { integer, emptyValue }), { min, max, integer });
        setDraft(null);
        onChange(normalised);
        onBlur?.(e);
      }}
    />
  );
};
