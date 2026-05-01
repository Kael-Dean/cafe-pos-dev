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
import { Customers, Reports, Settings } from '@/components/screens/placeholders';

type Screen = 'pos' | 'kds' | 'dashboard' | 'bom' | 'inventory' | 'customers' | 'reports' | 'settings';

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
    pos:       <POSTerminal />,
    kds:       <KDS />,
    dashboard: <Dashboard />,
    bom:       <BOMBuilder />,
    inventory: <Inventory />,
    customers: <Customers />,
    reports:   <Reports />,
    settings:  <Settings />,
  };

  return (
    <ToastProvider>
      <div style={{ display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden' }}>
        <Sidebar current={screen} onNavigate={(s) => setScreen(s as Screen)} onLogout={handleLogout} />
        <main style={{ flex: 1, minWidth: 0, position: 'relative', overflow: 'hidden' }}>
          {screens[screen]}
        </main>
      </div>
    </ToastProvider>
  );
}
