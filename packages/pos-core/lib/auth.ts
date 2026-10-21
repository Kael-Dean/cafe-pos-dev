import { clearToken, getToken } from './token-store';

const LOGOUT_REASON_KEY = 'cafe_pos_logout_reason';

/** Cookie-session BFF endpoints (same origin). Tokens never reach JS. */
export const AUTH_LOGIN_PATH = '/api/auth/login';
export const AUTH_REFRESH_PATH = '/api/auth/refresh';
export const AUTH_LOGOUT_PATH = '/api/auth/logout';

/**
 * Pre-BFF paths. `/api/v1/auth/login` is still served by the BFF (sets the
 * cookies, returns an opaque marker) so older screens keep working;
 * `/api/v1/auth/refresh` always answers 401.
 */
export const LEGACY_AUTH_PATHS = ['/api/v1/auth/login', '/api/v1/auth/refresh'] as const;

// De-duplicate concurrent refresh attempts.
let inflightRefresh: Promise<string | null> | null = null;

async function doRefresh(): Promise<string | null> {
  try {
    const res = await fetch(AUTH_REFRESH_PATH, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    // Server rotated the HttpOnly access cookie and re-set the session flag.
    return getToken();
  } catch {
    return null;
  }
}

/**
 * Asks the BFF to refresh the HttpOnly access cookie. Resolves to an opaque
 * session marker on success (NOT a token), or null on failure / no session.
 * Concurrent calls share the same in-flight request.
 */
export function refreshAccessToken(): Promise<string | null> {
  if (inflightRefresh) return inflightRefresh;
  inflightRefresh = doRefresh().finally(() => { inflightRefresh = null; });
  return inflightRefresh;
}

/**
 * Clear the session (server cookies + local flag) and, for 'expired', leave a
 * marker the login screen reads.
 */
export function forceLogout(reason: 'expired' | 'manual'): void {
  if (reason === 'expired' && typeof window !== 'undefined') {
    try { sessionStorage.setItem(LOGOUT_REASON_KEY, 'expired'); } catch { /* ignore */ }
  }
  clearToken();
}

export function readAndClearLogoutReason(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = sessionStorage.getItem(LOGOUT_REASON_KEY);
    if (v) sessionStorage.removeItem(LOGOUT_REASON_KEY);
    return v;
  } catch {
    return null;
  }
}
