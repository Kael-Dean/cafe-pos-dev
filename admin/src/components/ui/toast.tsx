'use client';

import { createContext, useCallback, useContext, useState } from 'react';
import Icon, { type IconName } from './icon';

type ToastKind = 'success' | 'warning' | 'danger' | 'info';
interface Toast { id: string; kind?: ToastKind; title: string; msg?: string; duration?: number }
type PushToast = (t: Omit<Toast, 'id'>) => void;

const ToastCtx = createContext<PushToast | null>(null);

export function useToast(): PushToast {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
}

const ICON: Record<ToastKind, IconName> = {
  success: 'success',
  warning: 'warning',
  danger: 'warning',
  info: 'info',
};

const ICON_COLOR: Record<ToastKind, string> = {
  success: 'var(--color-success)',
  warning: 'var(--color-warning-fg)',
  danger: 'var(--color-danger-fg)',
  info: 'var(--color-info)',
};

let seq = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = `t${++seq}`;
    setToasts((cur) => [...cur, { id, ...t }]);
    // Errors stay longer — they usually carry a recovery step to read.
    const ms = t.duration ?? (t.kind === 'danger' ? 6000 : 3600);
    setTimeout(() => setToasts((cur) => cur.filter((x) => x.id !== id)), ms);
  }, []);

  return (
    <ToastCtx.Provider value={push}>
      {children}
      {/* Persistent live region: it exists before any toast mounts, so screen
          readers announce children added to it. Polite for the common case;
          danger toasts opt into role="alert". */}
      <div
        className="toast-stack"
        role="region"
        aria-label="การแจ้งเตือน"
        aria-live="polite"
        aria-relevant="additions"
      >
        {toasts.map((t) => {
          const kind = t.kind ?? 'info';
          return (
            <div key={t.id} className={`toast ${t.kind ?? ''}`} role={t.kind === 'danger' ? 'alert' : 'status'}>
              <Icon name={ICON[kind]} size={18} color={ICON_COLOR[kind]} className="t-icon" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="t-title">{t.title}</div>
                {t.msg && <div className="t-msg">{t.msg}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}
