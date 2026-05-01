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
        <Sidebar current={screen} onNavigate={(s) => setScreen(s as Screen)} />
        <main style={{ flex: 1, minWidth: 0, position: 'relative', overflow: 'hidden' }}>
          {screens[screen]}
        </main>
        <button
          onClick={handleLogout}
          title="ออกจากระบบ"
          style={{
            position: 'fixed', bottom: 20, right: 20, zIndex: 999,
            padding: '8px 14px', fontSize: 12, fontWeight: 600,
            background: 'var(--color-surface)', color: 'var(--color-text-secondary)',
            border: '1px solid var(--color-border)', borderRadius: 8,
            cursor: 'pointer', fontFamily: 'inherit',
            boxShadow: 'var(--shadow-sm)',
            transition: 'all 150ms var(--ease-out)',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-danger-50)'; e.currentTarget.style.color = 'var(--color-danger)'; e.currentTarget.style.borderColor = 'var(--color-danger)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'var(--color-surface)'; e.currentTarget.style.color = 'var(--color-text-secondary)'; e.currentTarget.style.borderColor = 'var(--color-border)'; }}
        >
          ออกจากระบบ
        </button>
      </div>
    </ToastProvider>
  );
}
