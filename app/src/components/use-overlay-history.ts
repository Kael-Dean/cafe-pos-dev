'use client';

import { useEffect, useRef } from 'react';

/**
 * Browser Back closes an open overlay instead of leaving the screen (UI-SPEC §2.5).
 *
 * While `open`, the overlay owns one history entry `{ ...current, overlay: id }`
 * (the page router in app/page.tsx ignores entries for the screen it is already
 * on). Back pops it and calls `onClose`; closing from the UI pops it again. While
 * `dismissible` is false (a save in flight) Back is swallowed by re-pushing the
 * entry.
 *
 * Same contract as the primitives' `historyAware`, with one difference: the push is
 * deferred one task and cancelled if the effect is torn down first. React StrictMode
 * (on in `next dev`) mounts → unmounts → mounts every effect; pushing synchronously
 * there leaves a queued `history.back()` from the throw-away mount that lands after
 * the real push and closes the overlay the instant it opens.
 */
export function useOverlayHistory(open: boolean, onClose: () => void, dismissible = true) {
  const latest = useRef({ onClose, dismissible });
  useEffect(() => { latest.current = { onClose, dismissible }; });

  useEffect(() => {
    if (!open) return;
    const id = Math.random().toString(36).slice(2);
    let pushed = false;
    let entry: Record<string, unknown> = {};

    const onPop = (e: PopStateEvent) => {
      const st = e.state as { overlay?: unknown } | null;
      if (st?.overlay === id) return; // a deeper overlay closed; this one is on top again
      if (!latest.current.dismissible) { window.history.pushState(entry, ''); return; }
      pushed = false; // our entry is already gone
      latest.current.onClose();
    };

    const timer = window.setTimeout(() => {
      entry = { ...((window.history.state as Record<string, unknown> | null) ?? {}), overlay: id };
      window.history.pushState(entry, '');
      pushed = true;
      window.addEventListener('popstate', onPop);
    }, 0);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('popstate', onPop);
      if (pushed && (window.history.state as { overlay?: unknown } | null)?.overlay === id) window.history.back();
    };
  }, [open]);
}
