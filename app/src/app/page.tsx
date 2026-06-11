'use client';

import { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ToastProvider, Sidebar, BottomTabBar } from '@/components/app-common';
import { getToken, clearToken, subscribeAuth } from '@/lib/token-store';
import { canLeave } from '@/lib/nav-guard';
import LoginScreen from '@/components/screens/login';
import POSTerminal from '@/components/screens/pos';
import KDS from '@/components/screens/kds';
import Dashboard from '@/components/screens/dashboard';
import BOMBuilder from '@/components/screens/bom-builder';
import Bakery from '@/components/screens/bakery';
import Inventory from '@/components/screens/inventory';
import PreOrders from '@/components/screens/pre-orders';
import ShoppingListScreen from '@/components/screens/shopping-list';
import CashReconciliation from '@/components/screens/cash-reconciliation';
import PromotionsScreen from '@/components/screens/promotions';
import ProtocolsScreen from '@/components/screens/protocols';
import HRDashboard from '@/components/screens/hr-dashboard';
import ShiftSchedule from '@/components/screens/shift-schedule';
import { Customers } from '@/components/screens/placeholders';
import Settings from '@/components/screens/settings';
import { Reports } from '@/components/screens/reports';
import HardwareScreen from '@/components/screens/hardware';
import CatalogAdmin from '@/components/screens/catalog';
import StockTakeScreen from '@/components/screens/stock-take';
import MembersScreen from '@/components/screens/members';
import ReceiptCopies from '@/components/screens/receipt-copies';

type Screen =
  | 'pos' | 'kds' | 'dashboard' | 'bom' | 'bakery' | 'inventory'
  | 'pre-orders' | 'shopping-list' | 'stock-take'
  | 'cash' | 'receipt-copies' | 'promotions' | 'members' | 'protocols' | 'hr' | 'shifts'
  | 'hardware' | 'customers' | 'reports' | 'catalog' | 'settings';

export default function POS() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [screen, setScreen] = useState<Screen>('pos');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
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
    return <LoginScreen onLogin={() => {
      // Drop any cache left over from a previous session so /me (and all other
      // user/store-scoped queries) refetch for whoever just logged in.
      queryClient.clear();
      setIsLoggedIn(true);
    }} />;
  }

  // Let the active screen veto leaving (e.g. BOM Builder with unsaved edits).
  // The check is async because it may show a themed confirm dialog.
  const navigate = async (s: Screen) => {
    if (s === screen) return;
    if (await canLeave()) setScreen(s);
  };

  const handleLogout = async () => {
    if (!(await canLeave())) return;
    clearToken();
    queryClient.clear();
    setIsLoggedIn(false);
  };

  const screens: Record<Screen, React.ReactNode> = {
    pos:        <POSTerminal />,
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
    protocols:  <ProtocolsScreen />,
    hr:         <HRDashboard />,
    shifts:     <ShiftSchedule />,
    hardware:   <HardwareScreen />,
    customers:  <Customers />,
    reports:    <Reports />,
    catalog:    <CatalogAdmin />,
    settings:   <Settings />,
  };

  return (
    <ToastProvider>
      <div style={{ display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden' }}>
        <Sidebar current={screen} onNavigate={(s) => { void navigate(s as Screen); }} onLogout={() => { void handleLogout(); }} collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(v => !v)} />
        <main style={{ flex: 1, minWidth: 0, position: 'relative', overflow: 'auto' }}>
          {/* key={screen} remounts on navigation so the screen fade (.screen-enter,
              opacity only) plays once per switch. ScreenFrame also tags itself
              .screen-switching for the duration of that fade, which suppresses the
              child entrance animations that used to stack on top and read as a
              collapse→expand flicker. */}
          <ScreenFrame key={screen}>{screens[screen]}</ScreenFrame>
        </main>
      </div>
    </ToastProvider>
  );
}

/**
 * Wraps the active screen. Remounted on every navigation (via key={screen} in the
 * parent), so it always starts mid-switch: it carries `.screen-switching` while the
 * one-shot screen fade plays, then drops it once the fade ends. That window is what
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
      className={`screen-enter${switching ? ' screen-switching' : ''}`}
      style={{ height: '100%' }}
      onAnimationEnd={(e) => {
        if (e.target === ref.current) setSwitching(false);
      }}
    >
      {children}
    </div>
  );
}
