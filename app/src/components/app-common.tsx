'use client';

import { useState, useCallback, createContext, useContext, useRef, useEffect } from 'react';
import Icon from './icons';
import { useCurrentUser } from '@/hooks/use-current-user';
import { displayNumber, parseNumberInput, clampNumber } from '@/lib/number-input';

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
export type NavItem = { id: string; label: string; icon?: string; soft?: boolean; adminOnly?: boolean; ownerOnly?: boolean; divider?: boolean; };

export const NAV: NavItem[] = [
  { id: 'pos',       label: 'POS Terminal',   icon: 'pos' },
  { id: 'kds',       label: 'Kitchen (KDS)',   icon: 'kds' },
  { id: 'dashboard', label: 'Dashboard',       icon: 'chart' },
  { id: 'bom',       label: 'BOM Builder',     icon: 'inv' },
  { id: 'bakery',    label: 'เบเกอรี่ / Production', icon: 'cake' },
  { id: 'inventory', label: 'Inventory',       icon: 'inv',      soft: true },
  { id: 'pre-orders',    label: 'Pre-Orders',    icon: 'calendar' },
  { id: 'shopping-list', label: 'Shopping List',  icon: 'cart' },
  { id: 'stock-take',    label: 'Stock Take',      icon: 'check' },
  { id: 'cash',      label: 'Cash',            icon: 'cash',     adminOnly: true },
  { id: 'div1',      label: '',                divider: true },
  { id: 'promotions',label: 'Promotion / สะสมแต้ม', icon: 'tag' },
  { id: 'members',   label: 'สมาชิก / Members', icon: 'customers', adminOnly: true },
  { id: 'protocols', label: 'Protocols / SOP', icon: 'check' },
  { id: 'shifts',    label: 'ตารางกะ',          icon: 'calendar' },
  { id: 'hr',        label: 'HR & Admin',      icon: 'staff',    adminOnly: true },
  { id: 'div2',      label: '',                divider: true },
  { id: 'hardware',  label: 'Hardware',        icon: 'printer' },
  { id: 'customers', label: 'Customers',       icon: 'customers', soft: true },
  { id: 'reports',   label: 'Reports',         icon: 'reports',  soft: true },
  { id: 'catalog',   label: 'Catalog',         icon: 'inv',      ownerOnly: true },
  { id: 'settings',  label: 'Settings',        icon: 'settings', soft: true },
];

interface SidebarProps { current: string; onNavigate: (id: string) => void; onLogout?: () => void; branchName?: string; collapsed?: boolean; onToggle?: () => void; }

const ROLE_LABEL: Record<string, string> = {
  OWNER: 'เจ้าของ',
  MANAGER: 'ผู้จัดการ',
  BARISTA: 'บาริสต้า',
  BAKER: 'เบเกอรี่',
};

export const Sidebar = ({ current, onNavigate, onLogout, branchName = 'Sukhumvit 49', collapsed = false, onToggle }: SidebarProps) => {
  const { data: me } = useCurrentUser();
  const role = me?.role;
  const isAdmin = role === 'OWNER' || role === 'MANAGER';
  const initial = me?.name ? me.name.charAt(0).toUpperCase() : '?';
  const visibleNav = NAV.filter((n) => {
    if (n.divider) return true;
    if (n.adminOnly && !isAdmin) return false;
    if (n.ownerOnly && role !== 'OWNER') return false;
    return true;
  });

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
    <aside style={{
      width: collapsed ? 64 : 240,
      height: '100dvh',
      background: 'var(--color-primary)',
      color: 'rgba(255,255,255,0.92)',
      display: 'flex', flexDirection: 'column',
      borderRight: '1px solid rgba(0,0,0,0.15)',
      transition: 'width 220ms cubic-bezier(0.4,0,0.2,1)',
      overflow: 'hidden',
    }}>
      <div style={{
        padding: collapsed ? '16px 0 12px' : '20px 20px 16px',
        display: 'flex',
        flexDirection: collapsed ? 'column' : 'row',
        alignItems: 'center',
        gap: collapsed ? 8 : 12,
        transition: 'padding 220ms',
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10, flexShrink: 0,
          background: 'var(--color-accent)', color: 'var(--color-primary-700)',
          display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 18,
        }}>K</div>
        {!collapsed && (
          <div style={{flex: 1, minWidth: 0}}>
            <div style={{fontWeight: 700, fontSize: 15, letterSpacing: '-0.01em', whiteSpace: 'nowrap'}}>Kafé OS</div>
            <div style={{fontSize: 11, color: 'rgba(255,255,255,0.55)', whiteSpace: 'nowrap'}}>{me?.store_name ?? branchName}</div>
          </div>
        )}
        {onToggle && (
          <button
            onClick={onToggle}
            title={collapsed ? 'ขยาย sidebar' : 'ย่อ sidebar'}
            style={{
              width: 24, height: 24, borderRadius: 6, flexShrink: 0,
              background: 'rgba(255,255,255,0.08)', border: 'none',
              color: 'rgba(255,255,255,0.6)', cursor: 'pointer',
              display: 'grid', placeItems: 'center',
              transition: 'background 150ms, color 150ms',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.16)'; e.currentTarget.style.color = '#fff'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = 'rgba(255,255,255,0.6)'; }}
          >
            <Icon name={collapsed ? 'chevronRight' : 'chevronLeft'} size={14} />
          </button>
        )}
      </div>

      <nav style={{padding: collapsed ? '8px 8px' : '8px 12px', flex: 1, display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto', overflowX: 'hidden', transition: 'padding 220ms'}}>
        {visibleNav.map((n) => {
          if (n.divider) {
            return <div key={n.id} style={{height: 1, background: 'rgba(255,255,255,0.07)', margin: '6px 2px'}} />;
          }
          const active = current === n.id;
          return (
            <button key={n.id} onClick={() => onNavigate(n.id)}
              title={collapsed ? n.label : undefined}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: collapsed ? '10px 0' : '10px 12px', borderRadius: 8,
                justifyContent: collapsed ? 'center' : 'flex-start',
                background: active ? 'rgba(212,165,116,0.18)' : 'transparent',
                color: active ? 'var(--color-accent)' : 'rgba(255,255,255,0.78)',
                fontWeight: active ? 600 : 500, fontSize: 14,
                textAlign: 'left', width: '100%',
                transition: 'all 150ms var(--ease-out)',
                position: 'relative',
              }}
              onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
              onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
            >
              {n.icon && <Icon name={n.icon} size={18} />}
              {!collapsed && <span style={{flex: 1, whiteSpace: 'nowrap'}}>{n.label}</span>}
              {!collapsed && n.soft && <span style={{fontSize: 10, color: 'rgba(255,255,255,0.4)', fontWeight: 500}}>P1</span>}
            </button>
          );
        })}
      </nav>

      <div style={{ padding: collapsed ? '8px 8px' : '8px 12px', marginBottom: 4, transition: 'padding 220ms' }}>
        <div style={{
          padding: collapsed ? '8px 0' : 12,
          background: 'rgba(255,255,255,0.05)',
          borderRadius: 10,
          display: 'flex', alignItems: 'center', gap: 10,
          justifyContent: collapsed ? 'center' : 'flex-start',
          marginBottom: 8,
          transition: 'padding 220ms',
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: 999,
            background: 'var(--color-accent)', color: 'var(--color-primary-700)',
            display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 13,
            flexShrink: 0,
          }}>{initial}</div>
          {!collapsed && (
            <div style={{flex: 1, minWidth: 0}}>
              <div style={{fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{me?.name ?? '...'}</div>
              <div style={{fontSize: 11, color: 'rgba(255,255,255,0.55)'}}>{role ? ROLE_LABEL[role] ?? role : ''}</div>
            </div>
          )}
        </div>
        {onLogout && !collapsed && (
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
        {onLogout && collapsed && (
          <button
            onClick={onLogout}
            title="ออกจากระบบ"
            style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '9px 0', borderRadius: 8,
              background: 'transparent', border: '1px solid rgba(255,255,255,0.15)',
              color: 'rgba(255,255,255,0.65)',
              cursor: 'pointer', fontFamily: 'inherit',
              transition: 'all 150ms var(--ease-out)',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.18)'; e.currentTarget.style.color = '#fca5a5'; e.currentTarget.style.borderColor = 'rgba(239,68,68,0.4)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.65)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)'; }}
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
  const selected = options.find((o) => o.value === value);
  const displayLabel = selected ? selected.label : (placeholder ?? options[0]?.label ?? '');
  const isPlaceholder = !selected;

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey); };
  }, [open]);

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
      {open && (
        <div
          role="listbox"
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
            background: 'var(--color-surface)', border: '1px solid var(--color-border)',
            borderRadius: 8, boxShadow: 'var(--shadow-md)', zIndex: 200,
            overflowY: 'auto', maxHeight: menuMaxHeight, padding: 4,
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
        </div>
      )}
    </div>
  );
};

// ---------- Bottom Tab Bar (mobile only) ----------
interface BottomTabBarProps {
  currentScreen: string;
  onNavigate: (screen: string) => void;
}

const MAIN_TABS = [
  { id: 'pos',       label: 'POS',       icon: 'pos' },
  { id: 'kds',       label: 'KDS',       icon: 'kds' },
  { id: 'inventory', label: 'Inventory', icon: 'inv' },
  { id: 'dashboard', label: 'Dashboard', icon: 'chart' },
] as const;

const MORE_ITEMS = [
  { id: 'bom',          label: 'BOM Builder',       icon: 'inv' },
  { id: 'pre-orders',   label: 'Pre-Orders',         icon: 'calendar' },
  { id: 'catalog',      label: 'Catalog',            icon: 'tag' },
  { id: 'hr',           label: 'HR & Admin',         icon: 'staff' },
  { id: 'promotions',   label: 'Promotion / สะสมแต้ม', icon: 'tag' },
  { id: 'protocols',    label: 'Protocols / SOP',    icon: 'check' },
  { id: 'shifts',       label: 'ตารางกะ',             icon: 'calendar' },
  { id: 'cash',         label: 'Cash',               icon: 'cash' },
  { id: 'shopping-list',label: 'Shopping List',      icon: 'cart' },
  { id: 'hardware',     label: 'Hardware',           icon: 'printer' },
] as const;

const MAIN_TAB_IDS = new Set<string>(MAIN_TABS.map((t) => t.id));

export const BottomTabBar = ({ currentScreen, onNavigate }: BottomTabBarProps) => {
  const [moreOpen, setMoreOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  // Close sheet on outside tap
  useEffect(() => {
    if (!moreOpen) return;
    const handler = (e: PointerEvent) => {
      if (sheetRef.current && !sheetRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [moreOpen]);

  const activeIsMore = !MAIN_TAB_IDS.has(currentScreen);

  return (
    <>
      {/* Sheet overlay */}
      {moreOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="More options"
          style={{
            position: 'fixed', inset: 0, zIndex: 60,
            background: 'rgba(26,16,8,0.45)',
            backdropFilter: 'blur(4px)',
          }}
        >
          <div
            ref={sheetRef}
            style={{
              position: 'absolute', left: 0, right: 0, bottom: 0,
              background: 'var(--color-surface)',
              borderRadius: '16px 16px 0 0',
              paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)',
              boxShadow: 'var(--shadow-lg)',
              animation: 'sheet-in 220ms var(--ease-out)',
            }}
          >
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '16px 20px 12px',
              borderBottom: '1px solid var(--color-border)',
            }}>
              <span style={{ fontWeight: 700, fontSize: 16 }}>เมนูเพิ่มเติม</span>
              <button
                onClick={() => setMoreOpen(false)}
                aria-label="Close more options"
                style={{
                  width: 32, height: 32, borderRadius: 999,
                  background: 'var(--color-surface-2)',
                  display: 'grid', placeItems: 'center',
                  border: 'none', cursor: 'pointer',
                }}
              >
                <Icon name="x" size={16} />
              </button>
            </div>
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
              padding: '12px 8px',
              gap: 4,
            }}>
              {MORE_ITEMS.map((item) => {
                const active = currentScreen === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => { onNavigate(item.id); setMoreOpen(false); }}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center',
                      gap: 6, padding: '12px 4px', borderRadius: 10,
                      background: active ? 'rgba(212,165,116,0.15)' : 'transparent',
                      color: active ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                      border: 'none', cursor: 'pointer', transition: 'background 150ms',
                      minHeight: 72,
                    }}
                  >
                    <Icon name={item.icon} size={22} color={active ? 'var(--color-accent)' : 'var(--color-text-secondary)'} />
                    <span style={{ fontSize: 11, fontWeight: active ? 600 : 500, textAlign: 'center', lineHeight: 1.2 }}>
                      {item.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Tab Bar */}
      <nav
        aria-label="Main navigation"
        className="md:hidden"
        style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 50,
          height: 64,
          background: 'var(--color-surface)',
          borderTop: '1px solid var(--color-border)',
          display: 'flex',
          paddingBottom: 'env(safe-area-inset-bottom)',
          boxShadow: '0 -2px 12px rgba(61,40,23,0.08)',
        }}
      >
        {MAIN_TABS.map((tab) => {
          const active = currentScreen === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onNavigate(tab.id)}
              aria-current={active ? 'page' : undefined}
              style={{
                flex: 1, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                gap: 3, border: 'none', background: 'transparent',
                color: active ? 'var(--color-accent)' : 'var(--color-text-muted)',
                cursor: 'pointer', padding: '4px 0',
                transition: 'color 150ms',
              }}
            >
              <Icon name={tab.icon} size={22} color={active ? 'var(--color-accent)' : 'var(--color-text-muted)'} />
              <span style={{ fontSize: 10, fontWeight: active ? 700 : 500, letterSpacing: '0.01em' }}>
                {tab.label}
              </span>
            </button>
          );
        })}

        {/* More tab */}
        <button
          onClick={() => setMoreOpen((v) => !v)}
          aria-current={activeIsMore ? 'page' : undefined}
          style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            gap: 3, border: 'none', background: 'transparent',
            color: activeIsMore || moreOpen ? 'var(--color-accent)' : 'var(--color-text-muted)',
            cursor: 'pointer', padding: '4px 0',
            transition: 'color 150ms',
          }}
        >
          <Icon name="dots" size={22} color={activeIsMore || moreOpen ? 'var(--color-accent)' : 'var(--color-text-muted)'} />
          <span style={{ fontSize: 10, fontWeight: activeIsMore || moreOpen ? 700 : 500, letterSpacing: '0.01em' }}>
            More
          </span>
        </button>
      </nav>

    </>
  );
};

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
