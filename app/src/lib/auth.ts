import { clearToken, getRefreshToken, setTokens } from './token-store';

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';
const LOGOUT_REASON_KEY = 'cafe_pos_logout_reason';

interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

// De-duplicate concurrent refresh attempts.
let inflightRefresh: Promise<string | null> | null = null;

async function doRefresh(): Promise<string | null> {
  const refresh = getRefreshToken();
  if (!refresh) return null;
  try {
    const res = await fetch(`${BASE_URL}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refresh }),
    });
    if (!res.ok) return null;
    const data: TokenPair = await res.json();
    if (!data?.access_token) return null;
    setTokens({ access: data.access_token, refresh: data.refresh_token });
    return data.access_token;
  } catch {
    return null;
  }
}

/**
 * Returns a fresh access token, or null on failure / no refresh token.
 * Concurrent calls share the same in-flight request.
 */
export function refreshAccessToken(): Promise<string | null> {
  if (inflightRefresh) return inflightRefresh;
  inflightRefresh = doRefresh().finally(() => { inflightRefresh = null; });
  return inflightRefresh;
}

/**
 * Clear tokens and (for 'expired') leave a marker the login screen reads.
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

export const AUTH_LOGIN_PATH = '/api/v1/auth/login';
export const AUTH_REFRESH_PATH = '/api/v1/auth/refresh';
