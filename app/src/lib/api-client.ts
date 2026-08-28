import { getToken } from './token-store';
import { AUTH_LOGIN_PATH, AUTH_REFRESH_PATH, forceLogout, refreshAccessToken } from './auth';

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

/** Extras carried off the error envelope and the response headers. */
export interface ApiErrorMeta {
  /** `error.code` from the envelope (e.g. 'TOO_MANY_REQUESTS'). null when absent. */
  code?: string | null;
  /** `Retry-After` in whole seconds. null when the header is absent or unparseable. */
  retryAfter?: number | null;
}

/**
 * RFC-7231 allows either a number of seconds or an HTTP-date. slowapi sends
 * seconds, but a proxy in front of us may rewrite it, so handle both.
 */
export function parseRetryAfter(res: Response): number | null {
  const raw = res.headers.get('Retry-After');
  if (!raw) return null;
  const secs = Number(raw);
  if (Number.isFinite(secs) && secs >= 0) return Math.ceil(secs);
  const when = Date.parse(raw);
  return Number.isNaN(when) ? null : Math.max(0, Math.ceil((when - Date.now()) / 1000));
}

class ApiError extends Error {
  readonly code: string | null;
  readonly retryAfter: number | null;

  // `meta` is an optional bag so the (status, message) positional signature —
  // and every existing `err.status === …` call site — stays untouched.
  constructor(public status: number, message: string, meta?: ApiErrorMeta) {
    super(message);
    this.code = meta?.code ?? null;
    this.retryAfter = meta?.retryAfter ?? null;
  }
}

class SessionExpiredError extends ApiError {
  constructor(message = 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่') {
    super(401, message);
    this.name = 'SessionExpiredError';
  }
}

function isAuthPath(path: string): boolean {
  return path.startsWith(AUTH_LOGIN_PATH) || path.startsWith(AUTH_REFRESH_PATH);
}

async function doFetch(path: string, options?: RequestInit, tokenOverride?: string | null): Promise<Response> {
  const token = tokenOverride !== undefined ? tokenOverride : getToken();
  return fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  let res = await doFetch(path, options);

  // 401 handling — refresh once, retry once, else force logout. Skip for auth endpoints.
  if (res.status === 401 && !isAuthPath(path)) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      res = await doFetch(path, options, newToken);
      if (res.status === 401) {
        forceLogout('expired');
        throw new SessionExpiredError();
      }
    } else {
      forceLogout('expired');
      throw new SessionExpiredError();
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    // Backend uses {"error": {"message": "...", "details": [...]}} envelope; FastAPI default uses "detail"
    const raw = body?.error?.message ?? body?.detail ?? `HTTP ${res.status}`;
    const msg = typeof raw === 'string' ? raw : JSON.stringify(raw);
    const code = body?.error?.code;
    throw new ApiError(res.status, msg, {
      code: typeof code === 'string' ? code : null,
      retryAfter: parseRetryAfter(res),
    });
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// --- Double-submit guard ---------------------------------------------------
// When the network is slow and a user taps a button several times before the
// first request finishes, each tap fires an identical write and the backend
// ends up creating duplicate orders/items. We collapse writes that are
// identical (same method + path + body) AND still in-flight into a single
// request: the second caller awaits the same promise instead of hitting the
// network again. The key is freed as soon as the request settles, so genuine
// sequential edits (fired after the first completes) are never blocked.
const inFlightWrites = new Map<string, Promise<unknown>>();

function dedupeWrite<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inFlightWrites.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const p = run().finally(() => { inFlightWrites.delete(key); });
  inFlightWrites.set(key, p);
  return p;
}

export const api = {
  get:    <T>(path: string)                        => apiFetch<T>(path),
  post:   <T>(path: string, body: unknown)         => dedupeWrite<T>(`POST ${path} ${JSON.stringify(body)}`,  () => apiFetch<T>(path, { method: 'POST',   body: JSON.stringify(body) })),
  patch:  <T>(path: string, body: unknown)         => dedupeWrite<T>(`PATCH ${path} ${JSON.stringify(body)}`, () => apiFetch<T>(path, { method: 'PATCH',  body: JSON.stringify(body) })),
  put:    <T>(path: string, body: unknown)         => dedupeWrite<T>(`PUT ${path} ${JSON.stringify(body)}`,   () => apiFetch<T>(path, { method: 'PUT',    body: JSON.stringify(body) })),
  delete: <T>(path: string)                        => dedupeWrite<T>(`DELETE ${path}`,                        () => apiFetch<T>(path, { method: 'DELETE' })),
};

export { ApiError, SessionExpiredError };
