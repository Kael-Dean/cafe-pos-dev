'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import Icon from '../icons';
import { useI18n } from '@/lib/i18n';

function subscribe(notify: () => void): () => void {
  window.addEventListener('online', notify);
  window.addEventListener('offline', notify);
  return () => {
    window.removeEventListener('online', notify);
    window.removeEventListener('offline', notify);
  };
}

/**
 * `navigator.onLine` only knows whether the device has a network interface up —
 * it cannot see a dead router or a backend outage, so `true` is not a guarantee.
 * `false` is reliable, which is the case this banner exists for.
 */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true, // server render: assume online so the banner never flashes on load
  );
}

/**
 * Offline banner (product decision D8: the POS is online-only, so staff must see
 * at a glance why nothing saves). Rendered inside <SystemBar>, which shrinks the
 * app shell by the banner's height — it sits above the UI rather than over it.
 *
 * The live region stays mounted while empty so screen readers announce the
 * message when it appears.
 */
/** How long the screen-reader-only "back online" message stays in the live region. */
const RESTORED_MS = 5000;

export function OfflineIndicator() {
  const { t } = useI18n();
  const online = useOnlineStatus();
  // Sighted staff see the banner disappear; a screen-reader user would otherwise
  // never learn the connection is back. Set only by a real offline → online
  // transition (never on first load), and cleared again after a few seconds.
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    let timer: number | undefined;
    const onOnline = () => {
      setRestored(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setRestored(false), RESTORED_MS);
    };
    const onOffline = () => {
      window.clearTimeout(timer);
      setRestored(false);
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  return (
    <div role="status" aria-live="polite">
      {!online && (
        <div className="sys-bar">
          <Icon name="wifiOff" size={16} color="var(--color-warning)" style={{ flexShrink: 0 }} />
          <span>
            <strong style={{ fontWeight: 700 }}>{t.pwa.offlineTitle}</strong>
            {' '}
            <span className="sys-bar-detail">{t.pwa.offlineDetail}</span>
          </span>
        </div>
      )}
      {online && restored && <span className="sr-only">{t.pwa.backOnline}</span>}
    </div>
  );
}
