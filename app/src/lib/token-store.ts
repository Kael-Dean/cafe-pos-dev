const KEY = 'cafe_pos_token';
const REFRESH_KEY = 'cafe_pos_refresh_token';

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
  // Cross-tab sync: storage event fires only in OTHER tabs by spec.
  window.addEventListener('storage', (e) => {
    if (e.key === KEY || e.key === REFRESH_KEY || e.key === null) notify();
  });
}

export const getToken = (): string | null => {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(KEY);
};

export const getRefreshToken = (): string | null => {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(REFRESH_KEY);
};

export const setToken = (token: string): void => {
  localStorage.setItem(KEY, token);
  notify();
};

export const setTokens = (pair: { access: string; refresh?: string | null }): void => {
  localStorage.setItem(KEY, pair.access);
  if (pair.refresh) localStorage.setItem(REFRESH_KEY, pair.refresh);
  notify();
};

export const clearToken = (): void => {
  localStorage.removeItem(KEY);
  localStorage.removeItem(REFRESH_KEY);
  notify();
};

/**
 * Subscribe to auth-token changes (set/clear, including cross-tab via storage event).
 * Returns an unsubscribe function.
 */
export const subscribeAuth = (cb: AuthListener): (() => void) => {
  wireStorageEvent();
  listeners.add(cb);
  return () => { listeners.delete(cb); };
};
