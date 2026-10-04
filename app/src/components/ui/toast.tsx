'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import Icon from '../icons';
import { useI18n } from '@/lib/i18n';
import { IconButton } from './icon-button';

// ---------- Toast ----------
// Extracted from components/app-common.tsx with the same public API:
//   const toast = useToast();
//   toast({ kind: 'danger', title: 'บันทึกไม่สำเร็จ', msg: 'ลองอีกครั้ง', duration: 5000 });
//
// Spec §6: errors and async results only — never for routine success (a cart
// line appearing IS the feedback). At most 2 visible; older ones drop off.

export type ToastKind = 'success' | 'warning' | 'danger' | 'info';
export interface Toast { id: string; kind?: ToastKind; title: string; msg?: string; duration?: number }
export type PushToast = (t: Omit<Toast, 'id'>) => void;
/** `bottom-left` keeps toasts clear of the POS cart column at ≥768px. Phones always show them at the top. */
export type ToastPlacement = 'bottom-right' | 'bottom-left';

const MAX_VISIBLE = 2;
const DEFAULT_MS = 3200;
const DANGER_MS = 6000; // errors stay long enough to read the recovery hint

const ToastCtx = createContext<PushToast | null>(null);
export const useToast = () => useContext(ToastCtx) as PushToast;

const ICON: Record<ToastKind, string> = { success: 'success', warning: 'warning', danger: 'warning', info: 'info' };

export const ToastProvider = ({ children, placement = 'bottom-right' }: { children: React.ReactNode; placement?: ToastPlacement }) => {
  const { t } = useI18n();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    const tm = timers.current.get(id);
    if (tm) clearTimeout(tm);
    timers.current.delete(id);
    setToasts((cur) => cur.filter((x) => x.id !== id));
  }, []);

  const push = useCallback<PushToast>((toast) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((cur) => [...cur, { id, ...toast }].slice(-MAX_VISIBLE));
    const ms = toast.duration || (toast.kind === 'danger' ? DANGER_MS : DEFAULT_MS);
    timers.current.set(id, setTimeout(() => dismiss(id), ms));
  }, [dismiss]);

  useEffect(() => {
    const map = timers.current;
    return () => { map.forEach(clearTimeout); map.clear(); };
  }, []);

  const render = (x: Toast) => (
    <div key={x.id} className="ui-toast" data-kind={x.kind ?? 'info'}>
      <Icon name={ICON[x.kind ?? 'info']} size={20} className="ui-toast__icon" />
      <div className="ui-toast__text">
        <div className="ui-toast__title">{x.title}</div>
        {x.msg && <div className="ui-toast__msg">{x.msg}</div>}
      </div>
      <IconButton
        size="sm"
        className="ui-toast__close"
        icon={<Icon name="x" size={16} />}
        label={t.ui.dismiss}
        onClick={() => dismiss(x.id)}
      />
    </div>
  );

  return (
    <ToastCtx.Provider value={push}>
      {children}
      {/* Two persistent live regions (they exist before any toast mounts, so
          additions are announced). Toasts carry no role of their own — the old
          region-plus-role=status markup announced every toast twice. Danger
          toasts go to the assertive region. */}
      <div className="ui-toast-stack" data-placement={placement} role="region" aria-label={t.ui.notifications}>
        <div className="ui-toast-region" aria-live="assertive" aria-relevant="additions text">
          {toasts.filter((x) => x.kind === 'danger').map(render)}
        </div>
        <div className="ui-toast-region" aria-live="polite" aria-relevant="additions text">
          {toasts.filter((x) => x.kind !== 'danger').map(render)}
        </div>
      </div>
    </ToastCtx.Provider>
  );
};
