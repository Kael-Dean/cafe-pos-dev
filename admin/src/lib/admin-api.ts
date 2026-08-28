import { forceAdminLogout, getAdminToken } from './admin-token';

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

export const ADMIN_LOGIN_PATH = '/api/v1/admin/auth/login';

/** A field-level validation error as FastAPI/Pydantic reports it inside a 422. */
export interface ApiFieldError {
  loc?: (string | number)[];
  msg?: string;
  type?: string;
}

/** Extras carried off the error envelope and the response headers. */
export interface ApiErrorMeta {
  /** `error.code` from the envelope (e.g. 'TOO_MANY_REQUESTS'). null when absent. */
  code?: string | null;
  /** `Retry-After` in whole seconds. null when the header is absent or unparseable. */
  retryAfter?: number | null;
}

/**
 * RFC-7231 allows either a number of seconds or an HTTP-date. slowapi sends
 * seconds, but the Next rewrite in front of the API may rewrite it, so handle both.
 */
export function parseRetryAfter(res: Response): number | null {
  const raw = res.headers.get('Retry-After');
  if (!raw) return null;
  const secs = Number(raw);
  if (Number.isFinite(secs) && secs >= 0) return Math.ceil(secs);
  const when = Date.parse(raw);
  return Number.isNaN(when) ? null : Math.max(0, Math.ceil((when - Date.now()) / 1000));
}

export class ApiError extends Error {
  readonly code: string | null;
  readonly retryAfter: number | null;

  constructor(
    public status: number,
    message: string,
    /** Present on 422 — Pydantic's per-field errors, for mapping back onto the form. */
    public details?: ApiFieldError[],
    // Fourth, not third: `details` is already passed positionally below.
    meta?: ApiErrorMeta,
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = meta?.code ?? null;
    this.retryAfter = meta?.retryAfter ?? null;
  }
}

export class SessionExpiredError extends ApiError {
  constructor(message = 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่') {
    super(401, message);
    this.name = 'SessionExpiredError';
  }
}

async function doFetch(path: string, options?: RequestInit): Promise<Response> {
  const token = getAdminToken();
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
  const res = await doFetch(path, options);

  // 401 on any non-login route means the ~8h access token is gone or was minted
  // for the wrong realm. Admins have NO refresh token, so there is nothing to
  // retry — drop the token and let the route guard bounce to /login.
  if (res.status === 401 && !path.startsWith(ADMIN_LOGIN_PATH)) {
    forceAdminLogout('expired');
    throw new SessionExpiredError();
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    // Every error from this API is {"error": {"code", "message", "details"?}};
    // FastAPI's own guards can still surface a bare {"detail": ...}.
    const raw = body?.error?.message ?? body?.detail ?? `HTTP ${res.status}`;
    const msg = typeof raw === 'string' ? raw : JSON.stringify(raw);
    const details = Array.isArray(body?.error?.details) ? (body.error.details as ApiFieldError[]) : undefined;
    const code = body?.error?.code;
    throw new ApiError(res.status, msg, details, {
      code: typeof code === 'string' ? code : null,
      retryAfter: parseRetryAfter(res),
    });
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// --- Double-submit guard ---------------------------------------------------
// A slow network plus an impatient double-click otherwise creates two tenants,
// two stores (two PINs, one of them orphaned), or fires a suspend twice into
// the audit log. Identical in-flight writes collapse into one request; the key
// is freed as soon as it settles, so genuine sequential edits still go through.
const inFlightWrites = new Map<string, Promise<unknown>>();

function dedupeWrite<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inFlightWrites.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const p = run().finally(() => { inFlightWrites.delete(key); });
  inFlightWrites.set(key, p);
  return p;
}

export const api = {
  get:   <T>(path: string)                => apiFetch<T>(path),
  post:  <T>(path: string, body: unknown) => dedupeWrite<T>(`POST ${path} ${JSON.stringify(body)}`,  () => apiFetch<T>(path, { method: 'POST',  body: JSON.stringify(body) })),
  patch: <T>(path: string, body: unknown) => dedupeWrite<T>(`PATCH ${path} ${JSON.stringify(body)}`, () => apiFetch<T>(path, { method: 'PATCH', body: JSON.stringify(body) })),
  put:   <T>(path: string, body: unknown) => dedupeWrite<T>(`PUT ${path} ${JSON.stringify(body)}`,   () => apiFetch<T>(path, { method: 'PUT',   body: JSON.stringify(body) })),
};
