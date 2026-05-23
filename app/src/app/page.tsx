'use client';

import { useState, useEffect } from 'react';
import { ToastProvider, Sidebar, BottomTabBar } from '@/components/app-common';
import { getToken, clearToken } from '@/lib/token-store';
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
import { Customers, Reports, Settings } from '@/components/screens/placeholders';
import HardwareScreen from '@/components/screens/hardware';
import CatalogAdmin from '@/components/screens/catalog';
import StockTakeScreen from '@/components/screens/stock-take';

type Screen =
  | 'pos' | 'kds' | 'dashboard' | 'bom' | 'bakery' | 'inventory'
  | 'pre-orders' | 'shopping-list' | 'stock-take'
  | 'cash' | 'promotions' | 'protocols' | 'hr' | 'shifts'
  | 'hardware' | 'customers' | 'reports' | 'catalog' | 'settings';

export default function POS() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [screen, setScreen] = useState<Screen>('pos');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    setIsLoggedIn(!!getToken());
    setMounted(true);
  }, []);

  if (!mounted) return null;

  if (!isLoggedIn) {
    return <LoginScreen onLogin={() => setIsLoggedIn(true)} />;
  }

  const handleLogout = () => {
    clearToken();
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
    promotions: <PromotionsScreen />,
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
        <Sidebar current={screen} onNavigate={(s) => setScreen(s as Screen)} onLogout={handleLogout} collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(v => !v)} />
        <main style={{ flex: 1, minWidth: 0, position: 'relative', overflow: 'auto' }}>
          {screens[screen]}
        </main>
      </div>
    </ToastProvider>
  );
}
