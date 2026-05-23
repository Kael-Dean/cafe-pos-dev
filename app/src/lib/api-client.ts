import { getToken } from './token-store';
import { AUTH_LOGIN_PATH, AUTH_REFRESH_PATH, forceLogout, refreshAccessToken } from './auth';

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
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
    throw new ApiError(res.status, msg);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get:    <T>(path: string)                        => apiFetch<T>(path),
  post:   <T>(path: string, body: unknown)         => apiFetch<T>(path, { method: 'POST',   body: JSON.stringify(body) }),
  patch:  <T>(path: string, body: unknown)         => apiFetch<T>(path, { method: 'PATCH',  body: JSON.stringify(body) }),
  put:    <T>(path: string, body: unknown)         => apiFetch<T>(path, { method: 'PUT',    body: JSON.stringify(body) }),
  delete: <T>(path: string)                        => apiFetch<T>(path, { method: 'DELETE' }),
};

export { ApiError, SessionExpiredError };
