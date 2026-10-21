/**
 * Client auth-state store.
 *
 * Since the BFF cookie migration (security audit 2026-10, M1) the access and
 * refresh tokens live in HttpOnly cookies set by /api/auth/* and are NEVER
 * readable from JavaScript. This module keeps its historical API so callers
 * do not change, but:
 *
 *   - `getToken()` / `getRefreshToken()` return an opaque marker
 *     (`'cookie-session'`) while a session exists, else null. Use them only
 *     as "am I logged in?" checks. They are not credentials.
 *   - The signal is the non-HttpOnly `pos_session` flag cookie the server sets
 *     alongside the HttpOnly cookies (same lifetime as the refresh token).
 *   - `setToken` / `setTokens` ignore the values passed in (the server already
 *     set the cookies) and only notify subscribers.
 *   - `clearToken()` drops the flag and asks the server to clear the HttpOnly
 *     cookies (POST /api/auth/logout).
 *
 * Legacy localStorage tokens from before the migration are deleted on first
 * use, which sends that tablet to the login screen once.
 */

const LEGACY_KEY = 'cafe_pos_token';
const LEGACY_REFRESH_KEY = 'cafe_pos_refresh_token';
const FLAG_COOKIE = 'pos_session';
const SESSION_MARKER = 'cookie-session';
const LOGOUT_PATH = '/api/auth/logout';
const CHANNEL_NAME = 'cafe_pos_auth';

type AuthListener = () => void;
const listeners: Set<AuthListener> = new Set();
let wired = false;
let legacyChecked = false;
let channel: BroadcastChannel | null = null;

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

/** One-time purge of pre-migration tokens that were readable by any script. */
function purgeLegacyTokens(): void {
  if (legacyChecked || !isBrowser()) return;
  legacyChecked = true;
  try {
    if (localStorage.getItem(LEGACY_KEY) !== null || localStorage.getItem(LEGACY_REFRESH_KEY) !== null) {
      localStorage.removeItem(LEGACY_KEY);
      localStorage.removeItem(LEGACY_REFRESH_KEY);
    }
  } catch {
    /* storage disabled — nothing to purge */
  }
}

function hasSessionFlag(): boolean {
  if (!isBrowser()) return false;
  return document.cookie.split(';').some((c) => c.trim().startsWith(`${FLAG_COOKIE}=`) && c.trim() !== `${FLAG_COOKIE}=`);
}

function dropSessionFlag(): void {
  if (!isBrowser()) return;
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${FLAG_COOKIE}=; Path=/; Max-Age=0; SameSite=Strict${secure}`;
}

function notifyLocal(): void {
  listeners.forEach((cb) => {
    try { cb(); } catch { /* swallow listener errors */ }
  });
}

function notify(): void {
  notifyLocal();
  try { channel?.postMessage('changed'); } catch { /* channel closed */ }
}

function wireCrossTab(): void {
  if (wired || !isBrowser()) return;
  wired = true;
  // Cookies fire no storage event, so tabs talk over a BroadcastChannel.
  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = () => notifyLocal();
  }
  // Still react to the legacy keys (an old tab clearing them, etc.).
  window.addEventListener('storage', (e) => {
    if (e.key === LEGACY_KEY || e.key === LEGACY_REFRESH_KEY || e.key === null) notifyLocal();
  });
}

/** Opaque "session exists" marker, or null. NOT the access token. */
export const getToken = (): string | null => {
  if (!isBrowser()) return null;
  purgeLegacyTokens();
  return hasSessionFlag() ? SESSION_MARKER : null;
};

/** Opaque marker, or null. The refresh token is HttpOnly and scoped to /api/auth. */
export const getRefreshToken = (): string | null => getToken();

/** Kept for compatibility. The value is ignored: the server sets the HttpOnly cookies. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const setToken = (_token: string): void => {
  purgeLegacyTokens();
  notify();
};

/** Kept for compatibility. Values are ignored: the server sets the HttpOnly cookies. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const setTokens = (_pair: { access: string; refresh?: string | null }): void => {
  purgeLegacyTokens();
  notify();
};

/** Log out locally right away, and clear the HttpOnly cookies on the server. */
export const clearToken = (): void => {
  if (isBrowser()) {
    dropSessionFlag();
    try {
      localStorage.removeItem(LEGACY_KEY);
      localStorage.removeItem(LEGACY_REFRESH_KEY);
    } catch { /* ignore */ }
    // Fire-and-forget; keepalive lets it finish even if the page unloads.
    void fetch(LOGOUT_PATH, { method: 'POST', credentials: 'same-origin', keepalive: true }).catch(() => undefined);
  }
  notify();
};

/**
 * Subscribe to auth-state changes (login/logout in this tab or another tab).
 * Returns an unsubscribe function.
 */
export const subscribeAuth = (cb: AuthListener): (() => void) => {
  wireCrossTab();
  listeners.add(cb);
  return () => { listeners.delete(cb); };
};
