'use client';

import { useState, useCallback, createContext, useContext, useRef, useEffect, Fragment } from 'react';
import { createPortal } from 'react-dom';
import Icon from './icons';
import { useCurrentUser } from '@/hooks/use-current-user';
import { useFeatures, FEATURE_BOARDGAME } from '@/hooks/use-features';
import { displayNumber, parseNumberInput, clampNumber } from '@/lib/number-input';
import { useI18n } from '@/lib/i18n';
import { useMediaQuery } from '@/hooks/use-media-query';
// Import the gsap-free count-up directly (not via the @/lib/motion barrel, which
// re-exports the side-effectful gsap engine). app-common is in the shell on every
// screen, so this keeps the ~71KB gsap engine attributable to the screen chunks
// that actually animate with it rather than anchoring it into the shared shell.
import { useCountUp } from '@/lib/motion/use-count-up';

// ---------- Toast ----------
// Top-center stack (globals.css .toast-stack). Every toast has a 44px close button.
// `danger` toasts stay until dismissed; the rest auto-dismiss after `duration`
// (default 3s), and the timer pauses while a finger / mouse is down on the toast
// or keyboard focus is inside it. Optional `action` renders one text button
// (e.g. retry) that runs and then dismisses the toast.
//
//   const toast = useToast();
//   toast({ kind: 'danger', title: 'เพิ่ม ลาเต้ ไม่สำเร็จ', msg: 'ลองอีกครั้ง',
//           action: { label: 'ลองอีกครั้ง', onAction: retry } });
//
// Routine success (item added to the cart) is not a toast: show it in place.
type ToastKind = 'success' | 'warning' | 'danger' | 'info';
interface ToastAction { label: string; onAction: () => void; }
interface Toast { id: string; kind?: ToastKind; title: string; msg?: string; duration?: number; action?: ToastAction; }
type PushToast = (t: Omit<Toast, 'id'>) => void;

const TOAST_DEFAULT_MS = 3000;
const TOAST_MAX = 4; // oldest non-error toasts drop off first

const ToastCtx = createContext<PushToast | null>(null);
export const useToast = () => useContext(ToastCtx) as PushToast;

export const ToastProvider = ({ children }: { children: React.ReactNode }) => {
  const { t: tr } = useI18n();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: string) => setToasts((cur) => cur.filter((x) => x.id !== id)), []);
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((cur) => {
      const next = [...cur, { id, ...t }];
      while (next.length > TOAST_MAX) {
        const i = next.findIndex((x) => x.kind !== 'danger');
        next.splice(i >= 0 ? i : 0, 1);
      }
      return next;
    });
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      {/* Persistent live region: it exists before any toast mounts, so screen
          readers announce children added to it. Polite for the common case;
          danger toasts opt into role="alert" (assertive) for errors. */}
      <div className="toast-stack" role="region" aria-label={tr.ui.notifications} aria-live="polite" aria-relevant="additions">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={dismiss} dismissLabel={tr.ui.dismiss} />
        ))}
      </div>
    </ToastCtx.Provider>
  );
};

const TOAST_ICON: Record<ToastKind, string> = { success: 'success', warning: 'warning', danger: 'warning', info: 'info' };

function ToastItem({ toast: t, onDismiss, dismissLabel }: { toast: Toast; onDismiss: (id: string) => void; dismissLabel: string }) {
  const kind = t.kind ?? 'info';
  const persistent = kind === 'danger';
  const [held, setHeld] = useState(false);
  const remaining = useRef(t.duration || TOAST_DEFAULT_MS);

  // Auto-dismiss: runs only while not held; holding stores the time left.
  useEffect(() => {
    if (persistent || held) return;
    const started = Date.now();
    const timer = window.setTimeout(() => onDismiss(t.id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(800, remaining.current - (Date.now() - started));
    };
  }, [persistent, held, onDismiss, t.id]);

  return (
    <div
      className={`toast ${kind}`}
      role={persistent ? 'alert' : 'status'}
      onPointerDown={() => setHeld(true)}
      onPointerUp={() => setHeld(false)}
      onPointerCancel={() => setHeld(false)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHeld(false); }}
    >
      <Icon name={TOAST_ICON[kind]} size={20} className="t-icon" />
      <div className="t-body">
        <div className="t-title">{t.title}</div>
        {t.msg && <div className="t-msg">{t.msg}</div>}
      </div>
      {t.action && (
        <button type="button" className="t-action" onClick={() => { t.action?.onAction(); onDismiss(t.id); }}>
          {t.action.label}
        </button>
      )}
      <button type="button" className="t-close" aria-label={dismissLabel} onClick={() => onDismiss(t.id)}>
        <Icon name="x" size={20} />
      </button>
    </div>
  );
}

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
  { id: 'table-setup', icon: 'table',    feature: FEATURE_BOARDGAME, adminOnly: true },

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

// Sidebar mode per tier (TOUCH-SPEC §3.1). Tablet (768–1279) defaults to the
// labelled 80px rail and expands as an overlay over the content, so the POS grid
// never reflows; that overlay is transient (a tap outside, Escape or a navigation
// closes it). POS (≥ 1280) defaults to the 240px panel and the user's choice is
// remembered for that tier.
type SbTier = 'tablet' | 'pos';
type SbMode = 'rail' | 'expanded';
const SB_MODE_KEY: Record<SbTier, string> = { tablet: 'kafe.sb.tablet', pos: 'kafe.sb.pos' };
const SB_DEFAULT: Record<SbTier, SbMode> = { tablet: 'rail', pos: 'expanded' };
const SB_POS_QUERY = '(min-width: 1280px)';
const SB_RAIL_W = 80;
const SB_PANEL_W = 240;

const readSbMode = (tier: SbTier): SbMode | null => {
  try {
    const v = window.localStorage.getItem(SB_MODE_KEY[tier]);
    return v === 'rail' || v === 'expanded' ? v : null;
  } catch {
    return null;
  }
};

function useSidebarMode() {
  const tier: SbTier = useMediaQuery(SB_POS_QUERY) ? 'pos' : 'tablet';
  const [stored, setStored] = useState<Record<SbTier, SbMode | null>>(() => ({
    tablet: readSbMode('tablet'),
    pos: readSbMode('pos'),
  }));
  const mode = stored[tier] ?? SB_DEFAULT[tier];
  const setMode = (next: SbMode) => {
    setStored((s) => ({ ...s, [tier]: next }));
    try { window.localStorage.setItem(SB_MODE_KEY[tier], next); } catch { /* session only */ }
  };
  return { tier, mode, setMode };
}

interface SidebarProps { current: string; onNavigate: (id: string) => void; onLogout?: () => void; branchName?: string; }

export const Sidebar = ({ current, onNavigate, onLogout, branchName = 'Sukhumvit 49' }: SidebarProps) => {
  const { t } = useI18n();
  // Role / feature filtering is shared with the phone nav — see visibleNavSections.
  const { sections: visibleSections, me, initial, roleLabel, navLabel, sectionLabel } = useVisibleNav();
  const currentGroupId = groupOfScreen(current);
  const { tier, mode, setMode } = useSidebarMode();
  const isTablet = tier === 'tablet';
  const [overlayOpen, setOverlayOpen] = useState(false);
  // Leaving the tablet tier (rotate / resize) drops a hanging overlay.
  if (!isTablet && overlayOpen) setOverlayOpen(false);
  const expanded = isTablet ? overlayOpen : mode === 'expanded';
  // Rail and panel are separate trees, so the toggle a keyboard user just pressed
  // unmounts with them. Hand focus to the counterpart toggle after the swap
  // (WCAG 2.4.3) instead of dropping it on <body>.
  const panelRef = useRef<HTMLElement>(null);
  const panelToggleRef = useRef<HTMLButtonElement>(null);
  const railToggleRef = useRef<HTMLButtonElement>(null);
  const refocusToggle = useRef(false);
  const toggle = () => {
    refocusToggle.current = true;
    if (isTablet) setOverlayOpen((o) => !o);
    else setMode(mode === 'expanded' ? 'rail' : 'expanded');
  };
  const closeOverlay = () => { refocusToggle.current = true; setOverlayOpen(false); };
  const go = (id: string) => { if (isTablet) setOverlayOpen(false); onNavigate(id); };

  useEffect(() => {
    if (!refocusToggle.current) return;
    refocusToggle.current = false;
    (expanded ? panelToggleRef : railToggleRef).current?.focus({ preventScroll: true });
  }, [expanded]);

  // Tablet overlay behaves as a modal panel: Escape closes it (focus back on the
  // rail toggle) and Tab cycles inside it rather than walking into the dimmed
  // screen behind the backdrop.
  useEffect(() => {
    if (!overlayOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { closeOverlay(); return; }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'))
        .filter((el) => !el.closest('[inert]') && el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const inside = panelRef.current.contains(document.activeElement);
      if (!inside) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [overlayOpen]);

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

  // Expanded panel row: icon + full label.
  const renderItem = (n: NavItem) => {
    const active = current === n.id;
    return (
      <button key={n.id} type="button" onClick={() => go(n.id)}
        data-nav-id={n.id}
        className={`sb-item sb-panel-item${active ? ' active' : ''}`}
        aria-current={active ? 'page' : undefined}
      >
        {n.icon && <Icon name={n.icon} size={18} style={{flexShrink: 0}} />}
        <span className="sb-item-label">{navLabel(n.id)}</span>
        {n.soft && <span className="sb-soft">P1</span>}
      </button>
    );
  };

  // Rail cell: icon over a short visible label. The full name follows for
  // assistive tech, so the accessible name still starts with what is on screen.
  const renderRailItem = (n: NavItem) => {
    const active = current === n.id;
    const short = t.touchPos.navShort[n.id] ?? navLabel(n.id);
    return (
      <button key={n.id} type="button" onClick={() => go(n.id)}
        data-nav-id={n.id}
        className={`sb-item sb-rail-item${active ? ' active' : ''}`}
        aria-current={active ? 'page' : undefined}
      >
        {n.icon && <Icon name={n.icon} size={22} style={{flexShrink: 0}} />}
        <span className="sb-rail-label">{short}</span>
        <span className="sr-only"> · {navLabel(n.id)}</span>
      </button>
    );
  };

  const logo = (
    <div aria-hidden style={{
      width: 36, height: 36, borderRadius: 10, flexShrink: 0,
      background: 'var(--color-accent)', color: 'var(--sb-avatar-fg)',
      display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 18,
    }}>K</div>
  );
  const avatar = (
    <div aria-hidden style={{
      width: 32, height: 32, borderRadius: 999,
      background: 'var(--color-accent)', color: 'var(--sb-avatar-fg)',
      display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 'var(--fs-cap)',
      flexShrink: 0,
    }}>{initial}</div>
  );

  const panel = (
    <aside ref={panelRef} className={`sidebar-surface sb-aside sb-panel${isTablet ? ' sb-overlay' : ''}`} style={{ width: SB_PANEL_W }}>
      <div style={{ padding: '12px 10px 12px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
        {logo}
        <div style={{flex: 1, minWidth: 0}}>
          <div style={{fontWeight: 700, fontSize: 'var(--fs-body)', letterSpacing: '-0.01em', whiteSpace: 'nowrap', color: 'var(--sb-text-strong)'}}>Kafé OS</div>
          <div style={{fontSize: 'var(--fs-cap)', color: 'var(--sb-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{me?.store_name ?? branchName}</div>
        </div>
        <button ref={panelToggleRef} type="button" onClick={toggle} className="icon-btn-soft tap sb-toggle"
          aria-label={t.sidebar.collapse} aria-expanded>
          <Icon name="chevronLeft" size={20} />
        </button>
      </div>

      <nav aria-label={t.sidebar.navLabel} className="sb-panel-nav">
        {/* Each group is a collapsible section — the whole heading row toggles
            it, so only the functions you need are on screen at once. */}
        {visibleSections.map((s) => {
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
                <span className="sb-group-text">
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

      <div style={{ padding: '8px 12px 12px' }}>
        <div style={{
          padding: 12, background: 'var(--sb-card-bg)', borderRadius: 10,
          display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8,
        }}>
          {avatar}
          <div style={{flex: 1, minWidth: 0}}>
            <div style={{fontSize: 'var(--fs-sm)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--sb-text-strong)'}}>{me?.name ?? '...'}</div>
            {/* On the tinted user card (--sb-card-bg) --sb-text-muted is 4.4:1; the
                existing soft-icon ink reads 4.8:1 there (WCAG 1.4.3). */}
            <div style={{fontSize: 'var(--fs-cap)', color: 'var(--sb-icon-soft-fg)'}}>{roleLabel}</div>
          </div>
        </div>
        {onLogout && (
          <button type="button" onClick={onLogout} className="sb-logout tap" style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 10,
            padding: '0 12px', borderRadius: 8, minHeight: 'var(--tap-std)',
            fontSize: 'var(--fs-sm)', fontWeight: 500,
          }}>
            <Icon name="logout" size={16} />
            <span>{t.sidebar.logout}</span>
          </button>
        )}
      </div>
    </aside>
  );

  const rail = (
    <aside className="sidebar-surface sb-aside sb-rail" style={{ width: SB_RAIL_W }}>
      <div style={{ padding: '14px 0 10px', display: 'grid', placeItems: 'center' }}>{logo}</div>
      {/* Every item, groups separated by space (no rules). Scrolls if it overflows. */}
      <nav aria-label={t.sidebar.navLabel} className="sb-rail-nav">
        {visibleSections.map((s, si) => (
          <Fragment key={s.id}>
            {si > 0 && <div className="sb-rail-gap" aria-hidden />}
            {s.items.map(renderRailItem)}
          </Fragment>
        ))}
      </nav>
      {/* Only the expand toggle lives under the rail; the user card and logout are in
          the expanded panel (one tap away), so the scrolling list gets the height. */}
      <div className="sb-rail-foot">
        <button ref={railToggleRef} type="button" onClick={toggle} className="icon-btn-soft tap sb-toggle sb-rail-toggle"
          aria-label={t.sidebar.expand} aria-expanded={false}>
          <Icon name="chevronRight" size={20} />
        </button>
      </div>
    </aside>
  );

  return (
    // Desktop/tablet only: below 768px <MobileNav> (mobile-nav.tsx — bottom tab bar
    // + menu sheet) is the nav, so the sidebar is hidden to avoid a duplicate nav
    // landmark and to free the full width for content on phones.
    // The host holds the layout footprint: always the rail on tablet (the panel
    // overlays it), rail or panel on POS. Width changes snap; nothing tweens layout.
    <div className="hidden md:block" style={{ position: 'relative', flexShrink: 0, width: isTablet || !expanded ? SB_RAIL_W : SB_PANEL_W }}>
      <style>{SIDEBAR_CSS}</style>
      {/* Skip link (WCAG 2.4.1): the rail puts ~25 nav stops before the screen.
          Visually hidden until it takes keyboard focus. */}
      <a href="#app-main" className="skip-link" onClick={(e) => {
        const main = document.querySelector<HTMLElement>('main.app-main');
        if (!main) return;
        e.preventDefault();
        if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
        main.focus({ preventScroll: true });
      }}>{t.sidebar.skipToContent}</a>
      {expanded ? panel : rail}
      {isTablet && overlayOpen && <div className="sb-backdrop" aria-hidden onClick={closeOverlay} />}
    </div>
  );
};

const SIDEBAR_CSS = `
.skip-link {
  position: absolute; top: 8px; left: 8px; z-index: var(--z-popover);
  display: inline-flex; align-items: center; min-height: var(--tap-std); padding: 0 16px;
  border-radius: var(--radius-md); background: var(--color-surface); color: var(--color-text);
  font-size: var(--fs-body); font-weight: 600; box-shadow: var(--shadow-md);
  transform: translateY(-200%);
}
.skip-link:focus, .skip-link:focus-visible { transform: none; }
/* Skip-link target: focused programmatically, so no ring around the whole screen. */
main.app-main:focus { outline: none; }
.sb-aside {
  height: var(--app-h, 100dvh);
  display: flex; flex-direction: column;
  border-right: 1px solid var(--sb-border);
  overflow: hidden;
}
/* Tablet: the panel floats over the content; it slides in with transform only. */
.sb-overlay {
  position: absolute; top: 0; left: 0; z-index: var(--z-modal);
  box-shadow: var(--shadow-lg);
  animation: sb-slide-in var(--dur-base) var(--ease-out) both;
}
@keyframes sb-slide-in { from { transform: translateX(-24px); opacity: 0; } to { transform: none; opacity: 1; } }
.sb-backdrop {
  position: fixed; inset: 0; z-index: calc(var(--z-modal) - 1);
  background: rgba(26, 16, 8, 0.32);
  animation: backdrop-in var(--dur-base) var(--ease-out);
}
.sb-toggle {
  width: var(--tap-std); height: var(--tap-std); min-height: var(--tap-std); flex-shrink: 0;
  display: grid; place-items: center; border-radius: var(--radius-md);
}
.sb-panel-nav {
  flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain;
  padding: 4px 8px 8px; display: flex; flex-direction: column; gap: 2px;
}
.sb-panel-item {
  display: flex; align-items: center; gap: 10px;
  width: 100%; min-height: var(--tap-std); padding: 0 10px;
  border-radius: 8px; font-size: var(--fs-sm); text-align: left;
}
.sb-soft { font-size: var(--fs-cap); font-weight: 500; color: var(--sb-text-muted); }
.sb-rail-nav {
  flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain;
  scrollbar-width: none;
  padding: 4px 6px; display: flex; flex-direction: column; gap: 4px;
}
.sb-rail-nav::-webkit-scrollbar { display: none; }
.sb-rail-item {
  flex-shrink: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
  width: 100%; min-height: 64px; padding: 8px 2px;
  border-radius: 8px;
}
.sb-rail-label {
  max-width: 100%; font-size: var(--fs-cap); line-height: 1.25;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.sb-rail-gap { height: 8px; flex-shrink: 0; }
/* Hairline where the scrolling list meets the pinned toggle, so a row cut at the
   scroll edge reads as "more below", not as a clipped control. */
.sb-rail-foot { flex-shrink: 0; padding: 8px 6px 12px; border-top: 1px solid var(--sb-divider); }
.sb-rail-toggle { width: 100%; }
`;

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
    // --color-danger is ~4:1 on its own 50 tint; the -fg berry is the AA text ink.
    danger:  { bg: 'var(--color-danger-50)',  fg: 'var(--color-danger-fg)' },
    info:    { bg: 'var(--color-info-50)',    fg: 'var(--color-info)' },
    accent:  { bg: 'var(--color-accent-50)',  fg: 'var(--color-primary-700)' },
  };
  const t = toneMap[tone] || toneMap.neutral;
  return <span style={{
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '2px 8px', borderRadius: 999,
    background: t.bg, color: t.fg,
    fontSize: 'var(--fs-cap)', fontWeight: 600, // TOUCH-SPEC §2: nothing below 13px
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
                // Hover tint comes from .select-opt (hover-gated in globals.css), so
                // the unselected background is left to the class, not set inline.
                className="select-opt"
                style={{
                  width: '100%', display: 'block', textAlign: 'left',
                  padding: '9px 10px', borderRadius: 6, border: 'none',
                  fontSize: 14, fontFamily: 'inherit',
                  cursor: opt.disabled ? 'not-allowed' : 'pointer',
                  background: isSel ? 'var(--color-accent-50)' : undefined,
                  color: opt.disabled ? 'var(--color-text-muted)' : isSel ? 'var(--color-primary-700)' : 'var(--color-text)',
                  fontWeight: isSel ? 600 : 400,
                  opacity: opt.disabled ? 0.6 : 1,
                  transition: 'background 100ms',
                }}
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
