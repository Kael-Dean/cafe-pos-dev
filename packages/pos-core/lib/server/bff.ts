/**
 * BFF (backend-for-frontend) helpers: cookie policy, CSRF origin check,
 * client-IP extraction, JWT expiry peek and an in-memory rate limiter.
 *
 * Server-only. Pure functions (no Next request globals) so they are unit-tested
 * in bff.test.ts. Security audit 2026-10, findings M1 / M4 / m3.
 */

// ── Cookie names ─────────────────────────────────────────────────────────────
//
// On HTTPS the token cookies carry a prefix the browser enforces:
//   __Host-   → Secure, Path=/, no Domain (cannot be planted by a sub-domain)
//   __Secure- → Secure (the refresh cookie needs Path=/api/auth, so no __Host-)
// On plain-HTTP localhost dev the prefixes would make the browser drop the
// cookie, so unprefixed names are used there. The access/refresh cookies are
// HttpOnly; `pos_session` is a non-secret "a session exists" flag readable by
// JS so the client can decide between the login screen and the app.

export const SESSION_FLAG_COOKIE = 'pos_session';

/** Opaque value handed to legacy callers (token-store getters, login body). Never a credential. */
export const SESSION_MARKER = 'cookie-session';

export const REFRESH_COOKIE_PATH = '/api/auth';

/** Fallbacks match the backend (ACCESS 480 min, REFRESH 30 d) when `exp` is unreadable. */
export const ACCESS_TTL_FALLBACK_S = 8 * 60 * 60;
export const REFRESH_TTL_FALLBACK_S = 30 * 24 * 60 * 60;

export interface CookieNames {
  access: string;
  refresh: string;
  flag: string;
}

export function cookieNames(secure: boolean): CookieNames {
  return secure
    ? { access: '__Host-pos_at', refresh: '__Secure-pos_rt', flag: SESSION_FLAG_COOKIE }
    : { access: 'pos_at', refresh: 'pos_rt', flag: SESSION_FLAG_COOKIE };
}

export interface CookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'strict';
  path: string;
  maxAge: number;
}

export type CookieKind = 'access' | 'refresh' | 'flag';

/** Attribute set for each cookie. maxAge 0 = delete (attributes must still match for __Host-). */
export function cookieOptions(kind: CookieKind, secure: boolean, maxAge: number): CookieOptions {
  return {
    httpOnly: kind !== 'flag',
    secure,
    sameSite: 'strict',
    path: kind === 'refresh' ? REFRESH_COOKIE_PATH : '/',
    maxAge: Math.max(0, Math.floor(maxAge)),
  };
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function hostnameOf(host: string): string {
  // "[::1]:3108" → "[::1]", "localhost:3108" → "localhost"
  if (host.startsWith('[')) return host.slice(0, host.indexOf(']') + 1);
  return host.split(':')[0];
}

/**
 * Should cookies be `Secure`? Always, except plain-HTTP loopback (local dev /
 * `next start` on the same PC). Plain HTTP on any other host keeps Secure on,
 * so the browser refuses to store tokens that would travel unencrypted on a LAN.
 */
export function isSecureContextRequest(protocol: string, host: string): boolean {
  if (protocol.replace(/:$/, '') === 'https') return true;
  return !LOOPBACK_HOSTS.has(hostnameOf(host.toLowerCase()));
}

// ── CSRF: Origin check ───────────────────────────────────────────────────────

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface OriginCheckInput {
  method: string;
  /** `Origin` request header (null when absent). */
  origin: string | null;
  /** `Sec-Fetch-Site` request header (null when absent). */
  secFetchSite: string | null;
  /** This app's own origin, e.g. https://cafe-pos-sable.vercel.app */
  selfOrigin: string;
  /** Extra trusted origins (ALLOWED_ORIGINS env), exact match. */
  allowedOrigins?: readonly string[];
}

/**
 * Defence-in-depth on top of SameSite=Strict. State-changing requests must come
 * from our own origin. Browsers always send `Origin` on cross-origin and on
 * same-origin non-GET fetches; when it is missing we fall back to
 * `Sec-Fetch-Site`, and a request with neither header (curl, scripts) is
 * rejected because it cannot be attributed to our page.
 */
export function isAllowedOrigin(input: OriginCheckInput): boolean {
  if (SAFE_METHODS.has(input.method.toUpperCase())) return true;
  const allowed = new Set([normaliseOrigin(input.selfOrigin), ...(input.allowedOrigins ?? []).map(normaliseOrigin)]);
  if (input.origin) {
    if (input.origin === 'null') return false;
    return allowed.has(normaliseOrigin(input.origin));
  }
  return input.secFetchSite === 'same-origin';
}

function normaliseOrigin(o: string): string {
  try {
    return new URL(o).origin;
  } catch {
    return o.trim().toLowerCase();
  }
}

export function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(normaliseOrigin);
}

// ── Client IP ────────────────────────────────────────────────────────────────

/**
 * Real client IP for rate limiting. On Vercel `x-real-ip` / the first
 * `x-forwarded-for` hop are set by the platform edge and cannot be spoofed by
 * the client. When self-hosted without a trusted proxy these headers are
 * client-controlled, so the limiter is best-effort there (documented).
 */
export function clientIpFrom(headers: { get(name: string): string | null }): string {
  const real = headers.get('x-real-ip')?.trim();
  if (real) return real;
  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return 'unknown';
}

// ── JWT expiry (read-only peek, NOT verification) ────────────────────────────

/**
 * Seconds until the JWT's `exp`, used only to size cookie Max-Age. The backend
 * remains the sole verifier of the signature. Returns `fallback` when the
 * token is not a readable JWT, and clamps to [0, cap].
 */
export function secondsUntilExp(jwt: string, fallback: number, cap: number, nowMs = Date.now()): number {
  try {
    const part = jwt.split('.')[1];
    if (!part) return Math.min(fallback, cap);
    const json = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as { exp?: unknown };
    if (typeof json.exp !== 'number' || !Number.isFinite(json.exp)) return Math.min(fallback, cap);
    const secs = Math.floor(json.exp - nowMs / 1000);
    return Math.max(0, Math.min(secs, cap));
  } catch {
    return Math.min(fallback, cap);
  }
}

// ── In-memory rate limiter ───────────────────────────────────────────────────

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the window frees up (0 when allowed). */
  retryAfter: number;
  remaining: number;
}

/**
 * Fixed-window counter keyed by string. In-memory by owner decision (no
 * Upstash): each server instance keeps its own counts, so on Vercel the
 * effective limit is per warm instance. It still stops a single client
 * hammering the PIN form; the backend's per-user lockout is the real fix
 * (audit M4, backend follow-up).
 */
export class MemoryRateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys = 10_000,
  ) {}

  /** Read-only: would one more hit be allowed? */
  check(key: string, now = Date.now()): RateLimitResult {
    const e = this.live(key, now);
    if (!e) return { allowed: true, retryAfter: 0, remaining: this.limit };
    if (e.count >= this.limit) {
      return { allowed: false, retryAfter: Math.max(1, Math.ceil((e.resetAt - now) / 1000)), remaining: 0 };
    }
    return { allowed: true, retryAfter: 0, remaining: this.limit - e.count };
  }

  /** Record one hit and report the state after it. */
  hit(key: string, now = Date.now()): RateLimitResult {
    let e = this.live(key, now);
    if (!e) {
      if (this.hits.size >= this.maxKeys) this.sweep(now);
      if (this.hits.size >= this.maxKeys) {
        // Still full after dropping expired windows: evict the oldest key so
        // memory stays bounded under a key-spraying flood.
        const oldest = this.hits.keys().next().value;
        if (oldest !== undefined) this.hits.delete(oldest);
      }
      e = { count: 0, resetAt: now + this.windowMs };
      this.hits.set(key, e);
    }
    e.count += 1;
    const allowed = e.count <= this.limit;
    return {
      allowed,
      retryAfter: allowed ? 0 : Math.max(1, Math.ceil((e.resetAt - now) / 1000)),
      remaining: Math.max(0, this.limit - e.count),
    };
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  private live(key: string, now: number) {
    const e = this.hits.get(key);
    if (!e) return undefined;
    if (e.resetAt <= now) {
      this.hits.delete(key);
      return undefined;
    }
    return e;
  }

  private sweep(now: number): void {
    for (const [k, e] of this.hits) if (e.resetAt <= now) this.hits.delete(k);
  }
}

// ── Upstream path validation (SSRF / traversal guard) ────────────────────────

/**
 * Turn the part of the URL after `/api/v1/` into a safe, re-encoded upstream
 * path. Each segment is percent-decoded, rejected if it is empty, `.`/`..`,
 * or contains a slash, backslash or control character, then encoded again.
 * The upstream base URL is fixed from env, so a valid path can never change
 * the host. Returns null when the path is rejected.
 */
export function sanitizeUpstreamPath(rawTail: string): string | null {
  if (!rawTail || rawTail.length > 2048) return null;
  const segments = rawTail.replace(/\/+$/, '').split('/');
  const out: string[] = [];
  for (const raw of segments) {
    let seg: string;
    try {
      seg = decodeURIComponent(raw);
    } catch {
      return null;
    }
    if (!seg || seg === '.' || seg === '..') return null;
    if (/[\\/\u0000-\u001f\u007f]/.test(seg)) return null;
    out.push(encodeURIComponent(seg));
  }
  const trailingSlash = rawTail.endsWith('/') ? '/' : '';
  return out.join('/') + trailingSlash;
}
