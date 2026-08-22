/**
 * Admin access-token storage.
 *
 * DELIBERATELY a different storage key from the POS (`cafe_pos_token`): admin
 * and cafe-staff tokens are minted by different endpoints, carry a different
 * realm claim, and each is rejected with 401 by the other side's routes. The
 * two apps are also on different hostnames — so they cannot see each other's
 * localStorage at all — but the distinct key keeps that true even if someone
 * ever runs both on one origin.
 *
 * There is NO refresh token for admins. The access token lasts ~8h; when it
 * expires the only recovery is logging in again.
 */
const KEY = 'frd_admin_token';
const LOGOUT_REASON_KEY = 'frd_admin_logout_reason';

type AuthListener = () => void;
const listeners: Set<AuthListener> = new Set();
let storageWired = false;

function notify(): void {
  listeners.forEach((cb) => {
    try { cb(); } catch { /* swallow listener errors */ }
  });
}

function wireStorageEvent(): void {
  if (storageWired || typeof window === 'undefined') return;
  storageWired = true;
  // Cross-tab sync: the storage event fires only in OTHER tabs by spec.
  window.addEventListener('storage', (e) => {
    if (e.key === KEY || e.key === null) notify();
  });
}

export const getAdminToken = (): string | null => {
  if (typeof window === 'undefined') return null;
  try { return localStorage.getItem(KEY); } catch { return null; }
};

export const setAdminToken = (token: string): void => {
  try { localStorage.setItem(KEY, token); } catch { /* private mode */ }
  notify();
};

export const clearAdminToken = (): void => {
  try { localStorage.removeItem(KEY); } catch { /* private mode */ }
  notify();
};

/** Mark the next visit to /login as "your session expired" rather than a plain sign-in. */
export const setLogoutReason = (reason: 'expired'): void => {
  try { sessionStorage.setItem(LOGOUT_REASON_KEY, reason); } catch { /* noop */ }
};

/** Read the reason once — reading clears it, so a refresh doesn't re-show the banner. */
export const readAndClearLogoutReason = (): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    const v = sessionStorage.getItem(LOGOUT_REASON_KEY);
    if (v) sessionStorage.removeItem(LOGOUT_REASON_KEY);
    return v;
  } catch {
    return null;
  }
};

/** Log out locally. There is no server-side revoke endpoint in Phase 1. */
export const forceAdminLogout = (reason?: 'expired'): void => {
  if (reason === 'expired') setLogoutReason('expired');
  clearAdminToken();
};

/**
 * Subscribe to token changes (set/clear, including cross-tab via the storage
 * event). Returns an unsubscribe function.
 */
export const subscribeAdminAuth = (cb: AuthListener): (() => void) => {
  wireStorageEvent();
  listeners.add(cb);
  return () => { listeners.delete(cb); };
};
