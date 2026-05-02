'use client';

import { useState, useCallback, createContext, useContext } from 'react';
import Icon from './icons';
import { useCurrentUser } from '@/hooks/use-current-user';

// ---------- Toast ----------
type ToastKind = 'success' | 'warning' | 'danger' | 'info';
interface Toast { id: string; kind?: ToastKind; title: string; msg?: string; duration?: number; }
type PushToast = (t: Omit<Toast, 'id'>) => void;

const ToastCtx = createContext<PushToast | null>(null);
export const useToast = () => useContext(ToastCtx) as PushToast;

export const ToastProvider = ({ children }: { children: React.ReactNode }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((cur) => [...cur, { id, ...t }]);
    setTimeout(() => setToasts((cur) => cur.filter((x) => x.id !== id)), t.duration || 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind || ''}`}>
            <Icon name={t.kind === 'success' ? 'success' : t.kind === 'warning' ? 'warning' : t.kind === 'danger' ? 'warning' : 'info'} size={20} className="t-icon" color={
              t.kind === 'success' ? 'var(--color-success)' :
              t.kind === 'warning' ? 'var(--color-warning)' :
              t.kind === 'danger'  ? 'var(--color-danger)'  :
              'var(--color-info)'
            } />
            <div style={{flex: 1}}>
              <div className="t-title">{t.title}</div>
              {t.msg && <div className="t-msg">{t.msg}</div>}
            </div>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
};

// ---------- Sidebar ----------
export type NavItem = { id: string; label: string; icon: string; soft?: boolean; adminOnly?: boolean; };

export const NAV: NavItem[] = [
  { id: 'pos',       label: 'POS Terminal',   icon: 'pos' },
  { id: 'kds',       label: 'Kitchen (KDS)',   icon: 'kds' },
  { id: 'dashboard', label: 'Dashboard',       icon: 'chart' },
  { id: 'bom',       label: 'BOM Builder',     icon: 'inv' },
  { id: 'inventory', label: 'Inventory',       icon: 'inv',      soft: true },
  { id: 'cash',      label: 'Cash',            icon: 'cash',     adminOnly: true },
  { id: 'promotions',label: 'Promotions',      icon: 'tag' },
  { id: 'protocols', label: 'Protocols',       icon: 'check' },
  { id: 'shifts',    label: 'Shift Schedule',  icon: 'calendar' },
  { id: 'hr',        label: 'HR & Admin',      icon: 'staff',    adminOnly: true },
  { id: 'customers', label: 'Customers',       icon: 'customers', soft: true },
  { id: 'reports',   label: 'Reports',         icon: 'reports',  soft: true },
  { id: 'settings',  label: 'Settings',        icon: 'settings', soft: true },
];

interface SidebarProps { current: string; onNavigate: (id: string) => void; onLogout?: () => void; branchName?: string; }

const ROLE_LABEL: Record<string, string> = {
  OWNER: 'เจ้าของ',
  MANAGER: 'ผู้จัดการ',
  BARISTA: 'บาริสต้า',
  BAKER: 'เบเกอรี่',
};

export const Sidebar = ({ current, onNavigate, onLogout, branchName = 'Sukhumvit 49' }: SidebarProps) => {
  const { data: me } = useCurrentUser();
  const role = me?.role;
  const isAdmin = role === 'OWNER' || role === 'MANAGER';
  const initial = me?.name ? me.name.charAt(0).toUpperCase() : '?';
  const visibleNav = NAV.filter((n) => !n.adminOnly || isAdmin);

  return (
    <aside style={{
      width: 240, flexShrink: 0,
      background: 'var(--color-primary)',
      color: 'rgba(255,255,255,0.92)',
      display: 'flex', flexDirection: 'column',
      borderRight: '1px solid rgba(0,0,0,0.15)',
    }}>
      <div style={{padding: '20px 20px 16px', display: 'flex', alignItems: 'center', gap: 12}}>
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          background: 'var(--color-accent)', color: 'var(--color-primary-700)',
          display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 18,
        }}>K</div>
        <div>
          <div style={{fontWeight: 700, fontSize: 15, letterSpacing: '-0.01em'}}>Kafé OS</div>
          <div style={{fontSize: 11, color: 'rgba(255,255,255,0.55)'}}>{me?.store_name ?? branchName}</div>
        </div>
      </div>

      <nav style={{padding: '8px 12px', flex: 1, display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto'}}>
        {visibleNav.map((n) => {
          const active = current === n.id;
          return (
            <button key={n.id} onClick={() => onNavigate(n.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 12px', borderRadius: 8,
                background: active ? 'rgba(212,165,116,0.18)' : 'transparent',
                color: active ? 'var(--color-accent)' : 'rgba(255,255,255,0.78)',
                fontWeight: active ? 600 : 500, fontSize: 14,
                textAlign: 'left',
                transition: 'all 150ms var(--ease-out)',
                position: 'relative',
              }}
              onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
              onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
            >
              <Icon name={n.icon} size={18} />
              <span style={{flex: 1}}>{n.label}</span>
              {n.soft && <span style={{fontSize: 10, color: 'rgba(255,255,255,0.4)', fontWeight: 500}}>P1</span>}
            </button>
          );
        })}
      </nav>

      <div style={{ padding: '8px 12px', marginBottom: 4 }}>
        <div style={{
          padding: 12,
          background: 'rgba(255,255,255,0.05)',
          borderRadius: 10,
          display: 'flex', alignItems: 'center', gap: 10,
          marginBottom: 8,
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: 999,
            background: 'var(--color-accent)', color: 'var(--color-primary-700)',
            display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 13,
            flexShrink: 0,
          }}>{initial}</div>
          <div style={{flex: 1, minWidth: 0}}>
            <div style={{fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{me?.name ?? '...'}</div>
            <div style={{fontSize: 11, color: 'rgba(255,255,255,0.55)'}}>{role ? ROLE_LABEL[role] ?? role : ''}</div>
          </div>
        </div>
        {onLogout && (
          <button
            onClick={onLogout}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 10,
              padding: '9px 12px', borderRadius: 8,
              background: 'transparent', border: '1px solid rgba(255,255,255,0.15)',
              color: 'rgba(255,255,255,0.65)', fontSize: 13, fontWeight: 500,
              cursor: 'pointer', fontFamily: 'inherit',
              transition: 'all 150ms var(--ease-out)',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.18)'; e.currentTarget.style.color = '#fca5a5'; e.currentTarget.style.borderColor = 'rgba(239,68,68,0.4)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.65)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)'; }}
          >
            <Icon name="x" size={15} />
            ออกจากระบบ
          </button>
        )}
      </div>
    </aside>
  );
};

// ---------- Reusable bits ----------
interface KPICardProps { label: string; value: number | string; prefix?: string; suffix?: string; delta?: number; vsLabel?: string; }

export const KPICard = ({ label, value, prefix='', suffix='', delta, vsLabel }: KPICardProps) => {
  const positive = (delta ?? 0) >= 0;
  return (
    <div style={{
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: 12, padding: 20,
      display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      <div style={{fontSize: 13, color: 'var(--color-text-secondary)', fontWeight: 500}}>{label}</div>
      <div className="num" style={{fontSize: 32, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--color-text)'}}>
        {prefix}{typeof value === 'number' ? value.toLocaleString() : value}{suffix}
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
    warning: { bg: 'var(--color-warning-50)', fg: '#9C6A1F' },
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
