'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { ComponentType } from 'react';
import dynamic from 'next/dynamic';
import { useQueryClient } from '@tanstack/react-query';
import { Sidebar, visibleNavSections } from '@/components/app-common';
import { ToastProvider } from '@/components/ui/toast';
import { MobileNav } from '@/components/mobile-nav';
import { getToken, clearToken, subscribeAuth } from '@/lib/token-store';
import { canLeave } from '@/lib/nav-guard';
import { Skeleton } from '@/components/ui/skeleton';
import { useCurrentUser } from '@/hooks/use-current-user';
import { useFeatures } from '@/hooks/use-features';
import { useMediaQuery } from '@/hooks/use-media-query';
import { useI18n } from '@/lib/i18n';
// Login + POS stay static: login is the gate and POS is the default screen, so both
// belong in the first chunk. Every other screen is code-split below.
import LoginScreen from '@/components/screens/login';
import POSTerminal from '@/components/screens/pos';
import type { ActiveTableSession } from '@/components/screens/floor';

// Brief fallback while a screen's JS chunk downloads. Screens carry their own
// data-loading skeletons; this only covers the chunk fetch itself.
function ScreenLoading() {
  return (
    <div aria-busy="true" className="flex h-full flex-col gap-3 p-6">
      <Skeleton height={32} width="40%" radius={8} />
      <Skeleton height="60%" radius={12} />
    </div>
  );
}

// Code-split every non-default screen so the first paint (login → POS) doesn't ship
// the JS for 20 other screens. ssr:false is safe — this page is client-only and
// gates its render on `mounted` (so nothing renders server-side anyway).
const lazyScreen = (loader: () => Promise<{ default: ComponentType }>) =>
  dynamic(loader, { ssr: false, loading: ScreenLoading });

// Floor takes props, so it is declared with `dynamic` directly — `lazyScreen`
// erases prop types to the no-prop ComponentType the registry below expects.
const Floor = dynamic(() => import('@/components/screens/floor'), { ssr: false, loading: ScreenLoading });
const TableSetup = lazyScreen(() => import('@/components/screens/table-setup'));

const KDS = lazyScreen(() => import('@/components/screens/kds'));
const Dashboard = lazyScreen(() => import('@/components/screens/dashboard'));
const BOMBuilder = lazyScreen(() => import('@/components/screens/bom-builder'));
const Bakery = lazyScreen(() => import('@/components/screens/bakery'));
const Inventory = lazyScreen(() => import('@/components/screens/inventory'));
const PreOrders = lazyScreen(() => import('@/components/screens/pre-orders'));
const ShoppingListScreen = lazyScreen(() => import('@/components/screens/shopping-list'));
const CashReconciliation = lazyScreen(() => import('@/components/screens/cash-reconciliation'));
const PromotionsScreen = lazyScreen(() => import('@/components/screens/promotions'));
const ProtocolsScreen = lazyScreen(() => import('@/components/screens/protocols'));
const HRDashboard = lazyScreen(() => import('@/components/screens/hr-dashboard'));
const ShiftSchedule = lazyScreen(() => import('@/components/screens/shift-schedule'));
const Customers = lazyScreen(() => import('@/components/screens/placeholders').then((m) => ({ default: m.Customers })));
const Settings = lazyScreen(() => import('@/components/screens/settings'));
const Reports = lazyScreen(() => import('@/components/screens/reports').then((m) => ({ default: m.Reports })));
const HardwareScreen = lazyScreen(() => import('@/components/screens/hardware'));
const CatalogAdmin = lazyScreen(() => import('@/components/screens/catalog'));
const RecycleBin = lazyScreen(() => import('@/components/screens/recycle-bin'));
const StockTakeScreen = lazyScreen(() => import('@/components/screens/stock-take'));
const MembersScreen = lazyScreen(() => import('@/components/screens/members'));
const SalesScreen = lazyScreen(() => import('@/components/screens/sales'));
const ReceiptCopies = lazyScreen(() => import('@/components/screens/receipt-copies'));

const SCREENS = [
  'pos', 'kds', 'dashboard', 'bom', 'bakery', 'inventory',
  'floor', 'table-setup',
  'pre-orders', 'shopping-list', 'stock-take',
  'cash', 'receipt-copies', 'promotions', 'members', 'sales', 'protocols', 'hr', 'shifts',
  'hardware', 'customers', 'reports', 'catalog', 'recycle-bin', 'settings',
] as const;
type Screen = (typeof SCREENS)[number];

const isScreen = (v: unknown): v is Screen => typeof v === 'string' && (SCREENS as readonly string[]).includes(v);

// ── URL ↔ screen (UI-SPEC §2.5) ──────────────────────────────────────────────
// The app stays a single-page switcher; the URL only mirrors it as `?screen=`, so
// Back / Forward / refresh / deep links all land on the right screen.
const screenFromUrl = (): Screen => {
  const s = new URLSearchParams(window.location.search).get('screen');
  return isScreen(s) ? s : 'pos';
};
const urlFor = (s: Screen) => {
  const u = new URL(window.location.href);
  u.searchParams.set('screen', s);
  return `${u.pathname}${u.search}${u.hash}`;
};
type HistoryEntry = { screen?: unknown; overlay?: unknown } | null;
const currentEntry = () => window.history.state as HistoryEntry;

/**
 * A closing history-aware overlay (Modal / Sheet `historyAware`) pops its own entry
 * with `history.back()` once its exit fade ends. Pushing a new screen before that pop
 * lands would race it, so wait for the pop (bounded, in case nothing pops).
 */
function settleOverlayEntry(): Promise<void> {
  if (!currentEntry()?.overlay) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { window.removeEventListener('popstate', done); clearTimeout(timer); resolve(); };
    const timer = setTimeout(done, 600);
    window.addEventListener('popstate', done);
  });
}

// ── Sidebar: auto rail on the busy screens below 1280px (UI-SPEC §3) ──────────
// The user's own toggle wins and is remembered per breakpoint class.
const SB_COLLAPSE_KEY = 'cafe_pos_sidebar_collapsed';
const RAIL_SCREENS: ReadonlySet<Screen> = new Set<Screen>(['pos', 'floor', 'kds']);
type CollapsePrefs = { wide?: boolean; narrow?: boolean };
const readCollapsePrefs = (): CollapsePrefs => {
  try {
    const raw = window.localStorage.getItem(SB_COLLAPSE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return {};
    const p = parsed as Record<string, unknown>;
    return {
      wide: typeof p.wide === 'boolean' ? p.wide : undefined,
      narrow: typeof p.narrow === 'boolean' ? p.narrow : undefined,
    };
  } catch {
    return {};
  }
};

export default function POS() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [mounted, setMounted] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    setIsLoggedIn(!!getToken());
    setMounted(true);
    // React to mid-session token changes (expiry, cross-tab logout, manual clear).
    const unsub = subscribeAuth(() => {
      setIsLoggedIn(!!getToken());
    });
    return unsub;
  }, []);

  if (!mounted) return null;

  if (!isLoggedIn) {
    // The URL (?screen=…) is left alone here, so a deep link survives the login.
    return <LoginScreen onLogin={() => {
      // Drop any cache left over from a previous session so /me (and all other
      // user/store-scoped queries) refetch for whoever just logged in.
      queryClient.clear();
      setIsLoggedIn(true);
    }} />;
  }

  return <AppShell onLoggedOut={() => setIsLoggedIn(false)} />;
}

/** The logged-in app: screen router, nav, toasts. Mounted only with a token, so its user queries never run logged out. */
function AppShell({ onLoggedOut }: { onLoggedOut: () => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [screen, setScreen] = useState<Screen>(screenFromUrl);
  const screenRef = useRef(screen);
  // The board-game tab: while set, POS puts every order it creates on this table's
  // session instead of taking payment at the counter.
  const [tableSession, setTableSession] = useState<ActiveTableSession | null>(null);

  // ── Access: a deep link to a screen this role / store cannot see falls back to POS.
  const meQ = useCurrentUser();
  const featuresQ = useFeatures();
  const accessKnown = !meQ.isLoading && !featuresQ.isLoading;
  const allowed = new Set<string>(
    visibleNavSections(meQ.data?.role, featuresQ.data).flatMap((s) => s.items.map((n) => n.id)),
  );
  const forbidden = accessKnown && screen !== 'pos' && !allowed.has(screen);
  // Bounce during render (no effect round-trip); the URL follows in the effect below.
  const [bounces, setBounces] = useState(0);
  if (forbidden) {
    setScreen('pos');
    setBounces((n) => n + 1);
  }

  const show = useCallback((s: Screen) => {
    screenRef.current = s;
    setScreen(s);
  }, []);

  useEffect(() => { screenRef.current = screen; }, [screen]);

  // Seed the current entry with the screen so Back always has something to read;
  // after a bounce, rewrite it to POS so the forbidden ?screen= is not kept.
  useEffect(() => {
    window.history.replaceState({ ...(currentEntry() ?? {}), screen: screenRef.current }, '', urlFor(screenRef.current));
  }, [bounces]);

  // Let the active screen veto leaving (e.g. BOM Builder with unsaved edits).
  // The check is async because it may show a themed confirm dialog.
  const navigate = useCallback(async (s: Screen) => {
    if (s === screenRef.current) return;
    if (!(await canLeave())) return;
    await settleOverlayEntry();
    window.history.pushState({ screen: s }, '', urlFor(s));
    show(s);
  }, [show]);

  // Back / Forward. Entries pushed by a history-aware overlay carry `overlay` and the
  // SAME screen, so they fall out at the first check: the overlay handles those.
  useEffect(() => {
    const repush = (s: Screen) => window.history.pushState({ screen: s }, '', urlFor(s));
    const onPop = async (e: PopStateEvent) => {
      const st = e.state as HistoryEntry;
      const target: Screen = isScreen(st?.screen) ? st.screen : screenFromUrl();
      const cur = screenRef.current;
      if (target === cur) return;
      // An overlay without history support is open (legacy modal, payment, phone nav
      // sheet): Back closes it instead of leaving the screen. Esc goes to the topmost
      // dialog only, and a dialog that cannot close right now (payment processing)
      // ignores it, so Back does nothing there.
      if (document.querySelector('[aria-modal="true"]')) {
        repush(cur);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
        return;
      }
      if (!(await canLeave())) { repush(cur); return; }
      show(target);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [show]);

  const handleLogout = async () => {
    if (!(await canLeave())) return;
    clearToken();
    queryClient.clear();
    setTableSession(null);
    onLoggedOut();
  };

  // "สั่งอาหาร" from a table hands the tab to POS and switches screens.
  const startTableOrder = (s: ActiveTableSession) => {
    setTableSession(s);
    void navigate('pos');
  };

  // ── Sidebar collapse ──
  const wide = useMediaQuery('(min-width: 1280px)');
  const [collapsePrefs, setCollapsePrefs] = useState<CollapsePrefs>(readCollapsePrefs);
  const bpClass = wide ? 'wide' : 'narrow';
  // Below 1280 the busy screens (POS / Floor / KDS) always open as the 64px rail:
  // the full sidebar costs POS its 4th menu column at 1024. Expanding there lasts
  // for this visit only; the remembered preference covers every other screen.
  const forcedRail = !wide && RAIL_SCREENS.has(screen);
  const [railOverride, setRailOverride] = useState<{ screen: Screen; expanded: boolean } | null>(null);
  const sidebarCollapsed = forcedRail
    ? !(railOverride?.screen === screen && railOverride.expanded)
    : collapsePrefs[bpClass] ?? false;
  const toggleSidebar = () => {
    if (forcedRail) { setRailOverride({ screen, expanded: sidebarCollapsed }); return; }
    const next = { ...collapsePrefs, [bpClass]: !sidebarCollapsed };
    setCollapsePrefs(next);
    try { window.localStorage.setItem(SB_COLLAPSE_KEY, JSON.stringify(next)); } catch { /* storage blocked: session only */ }
  };

  const go = (s: string) => { if (isScreen(s)) void navigate(s); };

  const screens: Record<Screen, React.ReactNode> = {
    pos:        <POSTerminal session={tableSession} onClearSession={() => setTableSession(null)} />,
    floor:      <Floor onOrderForSession={startTableOrder} onNavigate={go} />,
    'table-setup': <TableSetup />,
    kds:        <KDS />,
    dashboard:  <Dashboard />,
    bom:        <BOMBuilder />,
    bakery:     <Bakery />,
    inventory:  <Inventory />,
    'pre-orders':    <PreOrders />,
    'shopping-list': <ShoppingListScreen />,
    'stock-take':    <StockTakeScreen />,
    cash:       <CashReconciliation />,
    'receipt-copies': <ReceiptCopies />,
    promotions: <PromotionsScreen />,
    members:    <MembersScreen />,
    sales:      <SalesScreen />,
    protocols:  <ProtocolsScreen />,
    hr:         <HRDashboard />,
    shifts:     <ShiftSchedule />,
    hardware:   <HardwareScreen />,
    customers:  <Customers />,
    reports:    <Reports />,
    catalog:    <CatalogAdmin />,
    'recycle-bin': <RecycleBin />,
    settings:   <Settings />,
  };

  // A gated screen waits for /me + features before it renders, so a deep link never
  // flashes a screen the role is about to be bounced from.
  const pending = !accessKnown && screen !== 'pos';
  const active: Screen = forbidden ? 'pos' : screen;

  return (
    // POS keeps toasts bottom-left at ≥768px so they never cover the cart column;
    // phones always get them at the top (handled by the provider).
    <ToastProvider placement={active === 'pos' ? 'bottom-left' : 'bottom-right'}>
      {/* .app-shell (globals.css): flex row, height --app-h = 100dvh minus the system
          bar / top safe-area inset, side safe-area insets as padding. */}
      <div className="app-shell">
        {/* WCAG 2.4.1: lets keyboard users skip the sidebar tab stops. A button (not an
            #hash link) so it never touches the ?screen= history entry. */}
        <button type="button" className="skip-link" onClick={() => document.getElementById('main-content')?.focus()}>{t.common.skipToMain}</button>
        {/* ≥ 768px. Below that it is display:none and <MobileNav> is the nav. */}
        <Sidebar current={active} onNavigate={go} onLogout={() => { void handleLogout(); }} collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
        <main id="main-content" tabIndex={-1} className="app-main relative min-w-0 flex-1 overflow-auto" style={{ outline: 'none' }}>
          {/* key remounts on navigation so the screen fade (.screen-enter, opacity
              only) plays once per switch. ScreenFrame also tags itself
              .screen-switching for the duration of that fade, which suppresses the
              child entrance animations that used to stack on top and read as a
              collapse→expand flicker. */}
          {pending
            ? <ScreenLoading />
            : <ScreenFrame key={active}>{screens[active]}</ScreenFrame>}
        </main>
      </div>
      {/* Phones (< 768px): bottom tab bar + menu sheet. Renders nothing on wider
          screens. Goes through the same navigate() / handleLogout() as the sidebar,
          so the unsaved-changes guard applies. .app-main reserves its height
          (--tabbar-h) so no screen content sits behind it. */}
      <MobileNav current={active} onNavigate={go} onLogout={() => { void handleLogout(); }} />
    </ToastProvider>
  );
}

/**
 * Wraps the active screen. Remounted on every navigation (via key in the parent),
 * so it always starts mid-switch: it carries `.screen-switching` while the one-shot
 * screen fade plays, then drops it once the fade ends. That window is what
 * suppresses the child .rise-in / .fade-in entrances (see globals.css) so switching
 * screens reads as a single calm fade instead of a collapse→expand flicker. After the
 * fade, genuinely new content (e.g. an incoming KDS ticket) animates in normally.
 */
function ScreenFrame({ children }: { children: React.ReactNode }) {
  const [switching, setSwitching] = useState(true);
  const ref = useRef<HTMLDivElement>(null);

  // Safety net: onAnimationEnd clears the flag in the normal case. If that event
  // never fires (reduced motion zeroes the duration, or the element is offscreen so
  // the animation is skipped), drop the flag after the fade's worst-case duration so
  // child entrances aren't suppressed forever. The timeout is longer than the
  // 180ms screen-enter fade, so it never pre-empts the real animationend.
  useEffect(() => {
    const id = setTimeout(() => setSwitching(false), 400);
    return () => clearTimeout(id);
  }, []);

  return (
    <div
      ref={ref}
      className={`screen-enter h-full${switching ? ' screen-switching' : ''}`}
      onAnimationEnd={(e) => {
        if (e.target === ref.current) setSwitching(false);
      }}
    >
      {children}
    </div>
  );
}
