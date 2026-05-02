'use client';

import { useState } from 'react';
import { ToastProvider, Sidebar } from '@/components/app-common';
import { getToken, clearToken } from '@/lib/token-store';
import LoginScreen from '@/components/screens/login';
import POSTerminal from '@/components/screens/pos';
import KDS from '@/components/screens/kds';
import Dashboard from '@/components/screens/dashboard';
import BOMBuilder from '@/components/screens/bom-builder';
import Inventory from '@/components/screens/inventory';
import CashReconciliation from '@/components/screens/cash-reconciliation';
import PromotionsScreen from '@/components/screens/promotions';
import ProtocolsScreen from '@/components/screens/protocols';
import HRDashboard from '@/components/screens/hr-dashboard';
import ShiftSchedule from '@/components/screens/shift-schedule';
import { Customers, Reports, Settings } from '@/components/screens/placeholders';
import HardwareScreen from '@/components/screens/hardware';

type Screen =
  | 'pos' | 'kds' | 'dashboard' | 'bom' | 'inventory'
  | 'cash' | 'promotions' | 'protocols' | 'hr' | 'shifts'
  | 'hardware' | 'customers' | 'reports' | 'settings';

export default function POS() {
  const [isLoggedIn, setIsLoggedIn] = useState(() => !!getToken());
  const [screen, setScreen] = useState<Screen>('pos');

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
    inventory:  <Inventory />,
    cash:       <CashReconciliation />,
    promotions: <PromotionsScreen />,
    protocols:  <ProtocolsScreen />,
    hr:         <HRDashboard />,
    shifts:     <ShiftSchedule />,
    hardware:   <HardwareScreen />,
    customers:  <Customers />,
    reports:    <Reports />,
    settings:   <Settings />,
  };

  return (
    <ToastProvider>
      <div style={{ display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden' }}>
        <Sidebar current={screen} onNavigate={(s) => setScreen(s as Screen)} onLogout={handleLogout} />
        <main style={{ flex: 1, minWidth: 0, position: 'relative', overflow: 'auto' }}>
          {screens[screen]}
        </main>
      </div>
    </ToastProvider>
  );
}
