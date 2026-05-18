// Shared UI: Sidebar, AppShell, Toast system, helpers

const { useState, useEffect, useRef, useCallback, useMemo, createContext, useContext } = React;

// ---------- Toast ----------
const ToastCtx = createContext(null);
const useToast = () => useContext(ToastCtx);

const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((t) => {
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
const NAV = [
  { id: 'pos',       label: 'POS Terminal', icon: 'pos' },
  { id: 'kds',       label: 'Kitchen (KDS)', icon: 'kds' },
  { id: 'dashboard', label: 'Dashboard',     icon: 'chart' },
  { id: 'bom',       label: 'BOM Builder',   icon: 'inv' },
  { id: 'inventory', label: 'Inventory',     icon: 'inv', soft: true },
  { id: 'customers', label: 'Customers',     icon: 'customers', soft: true },
  { id: 'reports',   label: 'Reports',       icon: 'reports', soft: true },
  { id: 'settings',  label: 'Settings',      icon: 'settings', soft: true },
];

const Sidebar = ({ current, onNavigate, branchName = 'Sukhumvit 49' }) => {
  return (
    <aside style={{
      width: 240, flexShrink: 0,
      background: 'var(--color-primary)',
      color: 'rgba(255,255,255,0.92)',
      display: 'flex', flexDirection: 'column',
      borderRight: '1px solid rgba(0,0,0,0.15)',
    }}>
      {/* Brand */}
      <div style={{padding: '20px 20px 16px', display: 'flex', alignItems: 'center', gap: 12}}>
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          background: 'var(--color-accent)', color: 'var(--color-primary-700)',
          display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 18,
        }}>K</div>
        <div>
          <div style={{fontWeight: 700, fontSize: 15, letterSpacing: '-0.01em'}}>Kafé OS</div>
          <div style={{fontSize: 11, color: 'rgba(255,255,255,0.55)'}}>{branchName}</div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{padding: '8px 12px', flex: 1, display: 'flex', flexDirection: 'column', gap: 2}}>
        {NAV.map((n) => {
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

      {/* User card */}
      <div style={{
        padding: 12, margin: 12,
        background: 'rgba(255,255,255,0.05)',
        borderRadius: 10,
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: 999,
          background: 'var(--color-accent)', color: 'var(--color-primary-700)',
          display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 13,
        }}>พ</div>
        <div style={{flex: 1, minWidth: 0}}>
          <div style={{fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>แพรว ส.</div>
          <div style={{fontSize: 11, color: 'rgba(255,255,255,0.55)'}}>บาริสต้า • กะเช้า</div>
        </div>
        <Icon name="settings" size={16} color="rgba(255,255,255,0.5)" />
      </div>
    </aside>
  );
};

// ---------- Reusable bits ----------
const KPICard = ({ label, value, prefix='', suffix='', delta, vsLabel }) => {
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

const Tag = ({ children, tone = 'neutral' }) => {
  const toneMap = {
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

// formatter helpers
const baht = (n) => `฿${(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

window.AppCommon = { ToastProvider, useToast, Sidebar, KPICard, Tag, NAV, baht };
