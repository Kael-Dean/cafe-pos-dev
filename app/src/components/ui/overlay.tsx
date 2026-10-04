'use client';

// Internals shared by Modal and Sheet. Not exported from the barrel.

import { useEffect, useRef, useState } from 'react';
import Icon from '../icons';
import { useI18n } from '@/lib/i18n';
import { IconButton } from './icon-button';

/** Exit fade length; matches `.ui-overlay[data-state='closing']` (--dur-fast). */
export const EXIT_MS = 120;

/**
 * Keep an overlay mounted for its exit animation. Opening is immediate; closing
 * flips `closing` for EXIT_MS, then unmounts. State is adjusted during render
 * (no effect) so the open frame never lags a render behind.
 */
export function usePresence(open: boolean) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) { setMounted(true); setClosing(false); }
    else if (mounted) setClosing(true);
  }
  useEffect(() => {
    if (!closing) return;
    const t = setTimeout(() => { setMounted(false); setClosing(false); }, EXIT_MS);
    return () => clearTimeout(t);
  }, [closing]);
  return { mounted, closing };
}

/**
 * WCAG 2.1.1 (axe: scrollable-region-focusable). A dialog body that scrolls but holds
 * no focusable control (receipt preview, shortcut list) cannot be scrolled from the
 * keyboard, so it becomes a focusable labelled region while that is true.
 */
export function useScrollableBodyFocus(titleId: string) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select,textarea,[tabindex]:not([tabindex="-1"])';
    const update = () => {
      const needs = el.scrollHeight > el.clientHeight + 1 && !el.querySelector(FOCUSABLE);
      if (needs) {
        el.setAttribute('tabindex', '0');
        el.setAttribute('role', 'region');
        el.setAttribute('aria-labelledby', titleId);
      } else {
        el.removeAttribute('tabindex');
        el.removeAttribute('role');
        el.removeAttribute('aria-labelledby');
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    const mo = new MutationObserver(update);
    mo.observe(el, { childList: true, subtree: true });
    return () => { ro.disconnect(); mo.disconnect(); };
  }, [titleId]);
  return ref;
}

/** A ref that always holds the latest value — for handlers bound once on mount. */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => { ref.current = value; });
  return ref;
}

/**
 * Opt-in browser-history integration (spec §2.5): opening pushes an
 * `{ overlay }` entry, Back closes the overlay instead of leaving the screen, and
 * closing from the UI pops the entry again. While `dismissible` is false (payment
 * processing) Back is swallowed by re-pushing the entry.
 *
 * A page-level popstate handler must ignore entries whose state has `overlay`.
 */
export function useHistoryOverlay(enabled: boolean, latest: React.RefObject<{ onClose: () => void; dismissible: boolean }>) {
  useEffect(() => {
    if (!enabled) return;
    const id = Math.random().toString(36).slice(2);
    const base = (history.state ?? {}) as Record<string, unknown>;
    history.pushState({ ...base, overlay: id }, '');
    const onPop = (e: PopStateEvent) => {
      const st = e.state as { overlay?: string } | null;
      if (st?.overlay === id) return; // a deeper overlay closed; we are on top again
      if (!latest.current.dismissible) { history.pushState({ ...base, overlay: id }, ''); return; }
      latest.current.onClose();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if ((history.state as { overlay?: string } | null)?.overlay === id) history.back();
    };
  }, [enabled, latest]);
}

/**
 * Backdrop that only closes on a press that STARTS and ENDS on the scrim, so a
 * text selection dragged out of the card never dismisses it.
 */
export function useBackdropDismiss(enabled: boolean, onDismiss: () => void) {
  const downOnScrim = useRef(false);
  return {
    onPointerDown: (e: React.PointerEvent) => { downOnScrim.current = e.target === e.currentTarget; },
    onClick: (e: React.MouseEvent) => {
      if (enabled && downOnScrim.current && e.target === e.currentTarget) onDismiss();
      downOnScrim.current = false;
    },
  };
}

export interface DialogHeadProps {
  titleId: string;
  descId?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Render the close button. */
  showClose: boolean;
  closeDisabled?: boolean;
  onClose: () => void;
  divided?: boolean;
}

export function DialogHead({ titleId, descId, title, description, showClose, closeDisabled, onClose, divided }: DialogHeadProps) {
  const { t } = useI18n();
  return (
    <div className="ui-dialog__head" data-divided={divided ? '' : undefined}>
      <div className="ui-dialog__titles">
        <h2 id={titleId} className="ui-dialog__title">{title}</h2>
        {description != null && <p id={descId} className="ui-dialog__desc">{description}</p>}
      </div>
      {showClose && (
        <IconButton
          className="ui-dialog__close"
          icon={<Icon name="x" size={18} />}
          label={t.common.close}
          disabled={closeDisabled}
          onClick={onClose}
        />
      )}
    </div>
  );
}
