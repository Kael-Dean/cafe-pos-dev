'use client';

import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { useI18n } from '@/lib/i18n';
import { canLeave } from '@/lib/nav-guard';

const SW_URL = '/sw.js';
/** Counter tablets stay open for days without a page load, so poll for a new build. */
const UPDATE_CHECK_MS = 60 * 60 * 1000;
/** After "Later", stay quiet for this long before offering the update again. */
const REOFFER_MS = 4 * 60 * 60 * 1000;
/** If the new worker never takes control after SKIP_WAITING, reload anyway. */
const TAKEOVER_TIMEOUT_MS = 4000;

/**
 * Registers the service worker (production only) and surfaces the
 * "new version — reload" prompt.
 *
 * The worker never calls skipWaiting() on its own: a new build installs in the
 * background and waits, because swapping the app under a cashier mid-order would
 * lose the open cart. Only when someone presses "Reload now" do we tell it to
 * take over, then reload this tab exactly once.
 *
 * Mounted at the root (inside <SystemBar>), so it also works on the login screen,
 * where the logged-in-only ToastProvider does not exist.
 */
export function ServiceWorkerRegister() {
  const { t } = useI18n();
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [reloading, setReloading] = useState(false);
  const dismissedAt = useRef(0);
  const reloadRequested = useRef(false);
  const hasReloaded = useRef(false);
  const barRef = useRef<HTMLDivElement>(null);
  const lastFocusOutside = useRef<HTMLElement | null>(null);

  const visible = waiting !== null && !dismissed;

  // While the prompt is up, remember the last element focused outside it, so
  // dismissing the strip from the keyboard can return focus there (see postpone).
  useEffect(() => {
    if (!visible) return;
    const remember = (target: EventTarget | null) => {
      if (target instanceof HTMLElement && target !== document.body && !barRef.current?.contains(target)) {
        lastFocusOutside.current = target;
      }
    };
    remember(document.activeElement);
    const onFocusIn = (event: FocusEvent) => remember(event.target);
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, [visible]);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    if (process.env.NODE_ENV !== 'production') {
      // Dev never registers. If a production build was run on this origin earlier,
      // its worker would keep serving stale chunks to `next dev` — remove it.
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => registrations.forEach((r) => void r.unregister()))
        .catch(() => undefined);
      return;
    }

    let cancelled = false;
    let registration: ServiceWorkerRegistration | undefined;
    // No controller at load = first ever install (nothing to "update" from).
    const firstInstall = !navigator.serviceWorker.controller;

    // A worker that reaches `installed` while another one controls the page is an
    // update waiting for permission. Without a controller it is the first install
    // and activates by itself, so it is not reported.
    const track = (worker: ServiceWorker | null) => {
      if (!worker) return;
      const onState = () => {
        if (cancelled) return;
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          setWaiting(worker);
        } else if (worker.state === 'activated' || worker.state === 'redundant') {
          // Taken over (possibly from another tab) or replaced — nothing to offer.
          setWaiting((current) => (current === worker ? null : current));
        }
      };
      onState();
      worker.addEventListener('statechange', onState);
    };

    const onControllerChange = () => {
      // Also fires on first install (clients.claim) and when another tab applies
      // the update; reload only if THIS tab asked for it, and only once.
      if (!reloadRequested.current || hasReloaded.current) return;
      hasReloaded.current = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    navigator.serviceWorker
      .register(SW_URL, { scope: '/', updateViaCache: 'none' })
      .then((reg) => {
        if (cancelled) return;
        registration = reg;
        track(reg.waiting);
        reg.addEventListener('updatefound', () => track(reg.installing));

        if (firstInstall) {
          // This page loaded before the worker existed, so its HTML and JS never
          // passed through the fetch handler. Hand the worker the list so the
          // shell can open offline without a second visit.
          void navigator.serviceWorker.ready.then((ready) => {
            if (cancelled) return;
            const urls = performance
              .getEntriesByType('resource')
              .map((entry) => entry.name)
              .filter((name) => {
                try {
                  const url = new URL(name);
                  return url.origin === window.location.origin && url.pathname.startsWith('/_next/static/');
                } catch {
                  return false;
                }
              });
            ready.active?.postMessage({ type: 'WARM_CACHE', urls: ['/', ...urls] });
          });
        }
      })
      .catch(() => {
        // Registration can fail (private mode, blocked storage, plain http on a LAN
        // IP). The app then simply runs as a normal website — nothing to report.
      });

    const checkForUpdate = () => {
      if (document.visibilityState !== 'visible') return;
      if (navigator.onLine) registration?.update().catch(() => undefined);
      if (dismissedAt.current && Date.now() - dismissedAt.current > REOFFER_MS) {
        dismissedAt.current = 0;
        setDismissed(false);
      }
    };
    const interval = window.setInterval(checkForUpdate, UPDATE_CHECK_MS);
    document.addEventListener('visibilitychange', checkForUpdate);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', checkForUpdate);
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, []);

  const applyUpdate = async () => {
    if (reloading) return;
    // Same veto the app shell uses before leaving a screen (e.g. unsaved BOM edits).
    if (!(await canLeave())) return;
    setReloading(true);
    reloadRequested.current = true;

    const reloadOnce = () => {
      if (hasReloaded.current) return;
      hasReloaded.current = true;
      window.location.reload();
    };

    if (waiting && waiting.state === 'installed') {
      waiting.postMessage({ type: 'SKIP_WAITING' });
      window.setTimeout(reloadOnce, TAKEOVER_TIMEOUT_MS);
    } else {
      reloadOnce();
    }
  };

  const postpone = (event: MouseEvent<HTMLButtonElement>) => {
    dismissedAt.current = Date.now();
    setDismissed(true);
    // "Later" unmounts with the strip, which would drop keyboard focus to <body>.
    // Hand it back to whatever was focused before the user came up here. Keyboard
    // activation only (click.detail === 0): after a tap, refocusing a text field
    // would pop the on-screen keyboard open on the counter tablet.
    const back = lastFocusOutside.current;
    if (event.detail === 0 && back?.isConnected) back.focus({ preventScroll: true });
  };

  return (
    <div ref={barRef} className={visible ? 'sys-bar sys-bar-action' : undefined}>
      {/* Only the message is a live region, and it stays mounted while empty so the
          prompt is announced when it appears. The buttons sit outside it: controls
          inside a (role=status, atomic) region make the whole strip get re-read
          every time a label changes or a button is removed. */}
      <span role="status" aria-live="polite">
        {visible && (
          <>
            <strong style={{ fontWeight: 700 }}>{t.pwa.updateTitle}</strong>
            {' '}
            <span className="sys-bar-detail">{t.pwa.updateDetail}</span>
          </>
        )}
      </span>
      {visible && (
        <span className="sys-bar-buttons">
          <button
            type="button"
            className="btn btn-accent sys-bar-btn"
            onClick={() => { void applyUpdate(); }}
            disabled={reloading}
            aria-busy={reloading || undefined}
          >
            {reloading && <span className="spinner" aria-hidden style={{ width: 14, height: 14 }} />}
            {reloading ? t.pwa.updateReloading : t.pwa.updateReload}
          </button>
          {!reloading && (
            <button type="button" className="btn sys-bar-btn sys-bar-btn-quiet" onClick={postpone}>
              {t.pwa.updateLater}
            </button>
          )}
        </span>
      )}
    </div>
  );
}
