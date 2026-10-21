/**
 * Navigation model shared by every edition. Pure data + pure functions (no React)
 * so editions can compose it at build time and tests can assert the result.
 *
 * Two layers decide what a user sees:
 *   1. Edition composition (build time) — which items the app ships at all:
 *      `EditionConfig.nav`, usually `CORE_NAV` plus edition items (see `insertNav`).
 *   2. Runtime gating (per store / per user) — `visibleNavSections()` drops items the
 *      role may not open or whose `feature` the store has not bought.
 *
 * The desktop Sidebar and the phone nav (mobile-nav.tsx) both render from
 * `visibleNavSections()`, so a screen can never be visible in one and unreachable in
 * the other. Add visibility rules here, nowhere else.
 */
import type { Lang } from '@pos/core/lib/i18n';

/** Store entitlement that switches on the board-game add-on (floor, rate plans, sessions). */
export const FEATURE_BOARDGAME = 'vertical.boardgame';
/**
 * Store entitlement for bar-style self ordering (mr.bar): tables + guest ordering
 * from a QR sticker, without time billing. Turns on the core floor / table setup
 * and the guest order board; the board-game-only items (lending, reservations,
 * board-game report) stay hidden — their endpoints answer 404 for these stores.
 */
export const FEATURE_SELF_ORDERING = 'self_ordering';
/** Any of these turns on the core table / session / bill system. */
export const TABLE_FEATURES = [FEATURE_BOARDGAME, FEATURE_SELF_ORDERING] as const;

export type NavLabel = Readonly<Record<Lang, string>>;

export type NavItem = {
  id: string; icon?: string; soft?: boolean; adminOnly?: boolean; ownerOnly?: boolean;
  divider?: boolean; header?: boolean;
  /**
   * Store entitlement required to see this item — hidden when the add-on isn't sold.
   * An array means "any of these".
   */
  feature?: string | readonly string[];
  /**
   * Label for ids the core dictionaries (`t.nav` / `t.navSection`) do not know —
   * edition-only screens. Core ids leave this unset and keep their i18n labels.
   */
  label?: NavLabel;
};

export interface NavSection { id: string; icon?: string; items: NavItem[] }

// Grouped by working mode so each job (taking orders, kitchen/stock, CRM, running
// the shop, one-time setup) sits together and is quick to find. `header` rows are
// group headings (label from `t.navSection[id]`, glyph from `icon`) — rendered as a
// collapsible heading when the sidebar is expanded, as a plain divider when it's
// collapsed. Within a group, items run most-used first.
export const CORE_NAV: readonly NavItem[] = [
  // Front-of-house — everything a cashier touches during a shift. The cash drawer
  // is opened/closed every day, so it sits above the occasional receipt reprint.
  { id: 'sec-service', header: true, icon: 'coffee' },
  { id: 'pos',       icon: 'pos' },
  // Bar order board for QR self-ordering stores — the owner's main screen there.
  { id: 'guest-orders', icon: 'bell', feature: FEATURE_SELF_ORDERING },
  { id: 'kds',       icon: 'kds' },
  { id: 'pre-orders',    icon: 'calendar' },
  { id: 'cash',      icon: 'cash',     adminOnly: true },
  { id: 'receipt-copies', icon: 'reports', adminOnly: true },

  // Tables — the core table / session / bill system. The whole group disappears for
  // stores with none of the table entitlements (their endpoints answer 404 there).
  // The board-game edition appends its own items to this section.
  { id: 'sec-boardgame', header: true, icon: 'dice' },
  { id: 'floor',       icon: 'park',     feature: TABLE_FEATURES },
  { id: 'table-setup', icon: 'table',    feature: TABLE_FEATURES, adminOnly: true },

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

/**
 * Returns `nav` with `items` inserted right after the item (or section header)
 * `afterId`. When `afterId` is a section header, the items go to the END of that
 * section. Throws on an unknown id so a renamed core item fails the build/test
 * instead of silently dropping edition screens.
 */
export function insertNav(nav: readonly NavItem[], afterId: string, items: readonly NavItem[]): NavItem[] {
  const at = nav.findIndex((n) => n.id === afterId);
  if (at < 0) throw new Error(`insertNav: no nav item "${afterId}"`);
  let end = at + 1;
  if (nav[at].header) {
    while (end < nav.length && !nav[end].header) end++;
  }
  return [...nav.slice(0, end), ...items, ...nav.slice(end)];
}

/** The group (header id) a screen belongs to — from the raw nav, independent of role filtering. */
export const groupOfScreen = (nav: readonly NavItem[], screen: string): string | undefined => {
  let group: string | undefined;
  for (const n of nav) {
    if (n.header) group = n.id;
    else if (n.id === screen) return group;
  }
  return undefined;
};

const hasFeature = (required: NavItem['feature'], features: readonly string[] | undefined): boolean => {
  if (!required) return true;
  if (typeof required === 'string') return !!features?.includes(required);
  return required.some((f) => features?.includes(f));
};

/** True when the store has any entitlement that enables the core table system. */
export const tablesEnabledFor = (features: readonly string[] | undefined): boolean =>
  hasFeature(TABLE_FEATURES, features);

/**
 * `nav` grouped into { header, items } sections with everything this role / store
 * cannot see removed (and any section left empty dropped).
 */
export const visibleNavSections = (
  nav: readonly NavItem[],
  role: string | undefined,
  features: readonly string[] | undefined,
): NavSection[] => {
  const isAdmin = role === 'OWNER' || role === 'MANAGER';
  const sections: NavSection[] = [];
  for (const n of nav) {
    if (n.header) { sections.push({ id: n.id, icon: n.icon, items: [] }); continue; }
    if (n.divider) continue;
    if (n.adminOnly && !isAdmin) continue;
    if (n.ownerOnly && role !== 'OWNER') continue;
    if (!hasFeature(n.feature, features)) continue;
    sections[sections.length - 1]?.items.push(n);
  }
  return sections.filter((s) => s.items.length > 0);
};

/** Screen ids a nav declares (headers / dividers excluded). */
export const navScreenIds = (nav: readonly NavItem[]): string[] =>
  nav.filter((n) => !n.header && !n.divider).map((n) => n.id);
