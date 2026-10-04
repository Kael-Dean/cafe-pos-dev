/**
 * Cookie-session BFF handlers shared by /api/auth/* and the legacy
 * /api/v1/auth/* paths. Tokens from the FastAPI backend are stored in
 * HttpOnly cookies and never returned to browser JavaScript (audit M1).
 *
 * Server-only: imported by route handlers and src/proxy.ts.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import {
  ACCESS_TTL_FALLBACK_S,
  MemoryRateLimiter,
  REFRESH_TTL_FALLBACK_S,
  SESSION_MARKER,
  clientIpFrom,
  cookieNames,
  cookieOptions,
  isAllowedOrigin,
  isSecureContextRequest,
  parseAllowedOrigins,
  secondsUntilExp,
  type CookieNames,
} from './bff';

const DEFAULT_UPSTREAM = 'https://caf-pos-repo-production.up.railway.app';

/** Fixed upstream origin from env. Never derived from request input (SSRF guard). */
export function upstreamBase(): string {
  const raw = process.env.RAILWAY_API_URL || DEFAULT_UPSTREAM;
  const u = new URL(raw);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname))) {
    throw new Error('RAILWAY_API_URL must be https (or http://localhost for dev)');
  }
  return u.origin;
}

export interface RequestCtx {
  secure: boolean;
  names: CookieNames;
  selfOrigin: string;
  ip: string;
}

export function requestCtx(request: NextRequest): RequestCtx {
  const proto = (request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || request.nextUrl.protocol).replace(/:$/, '');
  const host = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || request.headers.get('host') || request.nextUrl.host;
  const secure = isSecureContextRequest(proto, host);
  return {
    secure,
    names: cookieNames(secure),
    selfOrigin: `${proto}://${host}`,
    ip: clientIpFrom(request.headers),
  };
}

/** Uniform error envelope, same shape as the backend: {"error": {"code", "message"}}. */
export function jsonError(status: number, code: string, message: string, extraHeaders?: Record<string, string>): NextResponse {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store', ...extraHeaders } },
  );
}

/** Returns a 403 response when a state-changing request is not from our origin, else null. */
export function originGuard(request: NextRequest, ctx = requestCtx(request)): NextResponse | null {
  const ok = isAllowedOrigin({
    method: request.method,
    origin: request.headers.get('origin'),
    secFetchSite: request.headers.get('sec-fetch-site'),
    selfOrigin: ctx.selfOrigin,
    allowedOrigins: parseAllowedOrigins(process.env.ALLOWED_ORIGINS),
  });
  return ok ? null : jsonError(403, 'FORBIDDEN_ORIGIN', 'คำขอไม่ได้มาจากแอปนี้');
}

export function setAccessCookie(res: NextResponse, ctx: RequestCtx, accessToken: string): void {
  const maxAge = secondsUntilExp(accessToken, ACCESS_TTL_FALLBACK_S, ACCESS_TTL_FALLBACK_S);
  res.cookies.set(ctx.names.access, accessToken, cookieOptions('access', ctx.secure, maxAge));
}

export function setRefreshCookies(res: NextResponse, ctx: RequestCtx, refreshToken: string): void {
  const maxAge = secondsUntilExp(refreshToken, REFRESH_TTL_FALLBACK_S, REFRESH_TTL_FALLBACK_S);
  res.cookies.set(ctx.names.refresh, refreshToken, cookieOptions('refresh', ctx.secure, maxAge));
  // The flag lives exactly as long as the refresh token: while it exists the
  // client shows the app and a 401 triggers a silent refresh.
  res.cookies.set(ctx.names.flag, '1', cookieOptions('flag', ctx.secure, maxAge));
}

export function clearSessionCookies(res: NextResponse, ctx: RequestCtx): void {
  res.cookies.set(ctx.names.access, '', cookieOptions('access', ctx.secure, 0));
  res.cookies.set(ctx.names.refresh, '', cookieOptions('refresh', ctx.secure, 0));
  res.cookies.set(ctx.names.flag, '', cookieOptions('flag', ctx.secure, 0));
}

async function readJsonBody(request: NextRequest, maxBytes: number): Promise<unknown> {
  const len = Number(request.headers.get('content-length') ?? '0');
  if (len > maxBytes) throw new Error('too large');
  const text = await request.text();
  if (text.length > maxBytes) throw new Error('too large');
  return JSON.parse(text);
}

function passHeaders(upstream: Response): Record<string, string> {
  const h: Record<string, string> = { 'Cache-Control': 'no-store' };
  const ra = upstream.headers.get('retry-after');
  if (ra) h['Retry-After'] = ra;
  return h;
}

async function passError(upstream: Response): Promise<NextResponse> {
  const body = await upstream.json().catch(() => null);
  if (body && typeof body === 'object') {
    return NextResponse.json(body, { status: upstream.status, headers: passHeaders(upstream) });
  }
  return jsonError(upstream.status, 'UPSTREAM_ERROR', `HTTP ${upstream.status}`, passHeaders(upstream));
}

// ── Login ────────────────────────────────────────────────────────────────────

export const LoginSchema = z.object({
  store_slug: z.string().trim().min(1).max(60),
  pin: z.string().regex(/^\d{4,6}$/),
});

// Failed attempts only (a shift change with several cashiers logging in from
// one shop NAT must not trip it): 5 failures / min / IP, 20 / 15 min / store.
export const loginIpLimiter = new MemoryRateLimiter(5, 60_000);
export const loginStoreLimiter = new MemoryRateLimiter(20, 15 * 60_000);

function tooMany(retryAfter: number): NextResponse {
  return jsonError(
    429,
    'TOO_MANY_REQUESTS',
    `พยายามเข้าสู่ระบบถี่เกินไป รออีก ${retryAfter} วินาทีแล้วลองใหม่`,
    { 'Retry-After': String(retryAfter) },
  );
}

export async function handleLogin(request: NextRequest): Promise<NextResponse> {
  const ctx = requestCtx(request);
  const blocked = originGuard(request, ctx);
  if (blocked) return blocked;

  let parsed: z.infer<typeof LoginSchema>;
  try {
    const r = LoginSchema.safeParse(await readJsonBody(request, 2048));
    if (!r.success) return jsonError(422, 'VALIDATION_ERROR', 'รหัส PIN หรือ Store ID ไม่ถูกต้อง');
    parsed = r.data;
  } catch {
    return jsonError(400, 'BAD_REQUEST', 'คำขอไม่ถูกต้อง');
  }

  const ipKey = `ip:${ctx.ip}`;
  const storeKey = `store:${parsed.store_slug.toLowerCase()}`;
  for (const [lim, key] of [[loginIpLimiter, ipKey], [loginStoreLimiter, storeKey]] as const) {
    const s = lim.check(key);
    if (!s.allowed) return tooMany(s.retryAfter);
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${upstreamBase()}/api/v1/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Forwarded-For': ctx.ip,
      },
      body: JSON.stringify(parsed),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return jsonError(502, 'UPSTREAM_UNAVAILABLE', 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่');
  }

  if (!upstream.ok) {
    if (upstream.status === 401 || upstream.status === 403 || upstream.status === 404 || upstream.status === 422) {
      loginIpLimiter.hit(ipKey);
      loginStoreLimiter.hit(storeKey);
    }
    return passError(upstream);
  }

  const data = (await upstream.json().catch(() => null)) as { access_token?: unknown; refresh_token?: unknown } | null;
  if (!data || typeof data.access_token !== 'string' || typeof data.refresh_token !== 'string') {
    return jsonError(502, 'UPSTREAM_BAD_RESPONSE', 'เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง');
  }

  loginIpLimiter.reset(ipKey);
  // Body keeps the legacy shape so existing callers (login screen →
  // setTokens) keep working, but carries only an opaque marker, never a token.
  const res = NextResponse.json(
    { ok: true, access_token: SESSION_MARKER, refresh_token: null, token_type: 'cookie' },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
  setAccessCookie(res, ctx, data.access_token);
  setRefreshCookies(res, ctx, data.refresh_token);
  return res;
}

/**
 * Legacy `/api/v1/auth/login`. Same as handleLogin when nobody is signed in
 * (the login screen only shows when the `pos_session` flag is absent). When a
 * session IS active, a PIN login on this path is a second-person check (e.g.
 * manager approval) and must never replace the cashier's cookies, so it is
 * refused with 409 and pointed at /api/auth/verify-pin.
 */
export async function handleLegacyLogin(request: NextRequest): Promise<NextResponse> {
  const ctx = requestCtx(request);
  if (request.cookies.get(ctx.names.flag)?.value) {
    const blocked = originGuard(request, ctx);
    if (blocked) return blocked;
    return jsonError(409, 'SESSION_ACTIVE', 'มีผู้ใช้เข้าสู่ระบบอยู่แล้ว ใช้ /api/auth/verify-pin เพื่อยืนยัน PIN');
  }
  return handleLogin(request);
}

// ── Verify a second person's PIN (manager approval) without touching cookies ─

export interface VerifiedUser {
  id: string;
  name: string;
  role: string;
  store_id: string | null;
}

/**
 * POST {store_slug, pin} → `{ ok: true, user, same_store }`. Requires an
 * active session (the cashier). Verifies the PIN with the backend login, reads
 * that user's profile with the freshly minted token, then DISCARDS the tokens.
 * The caller's cookies are never changed. Shares the login rate limits.
 */
export async function handleVerifyPin(request: NextRequest): Promise<NextResponse> {
  const ctx = requestCtx(request);
  const blocked = originGuard(request, ctx);
  if (blocked) return blocked;

  const cashierAccess = request.cookies.get(ctx.names.access)?.value;
  if (!cashierAccess) return jsonError(401, 'UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบ');

  let parsed: z.infer<typeof LoginSchema>;
  try {
    const r = LoginSchema.safeParse(await readJsonBody(request, 2048));
    if (!r.success) return jsonError(422, 'VALIDATION_ERROR', 'รหัส PIN ไม่ถูกต้อง');
    parsed = r.data;
  } catch {
    return jsonError(400, 'BAD_REQUEST', 'คำขอไม่ถูกต้อง');
  }

  const ipKey = `ip:${ctx.ip}`;
  const storeKey = `store:${parsed.store_slug.toLowerCase()}`;
  for (const [lim, key] of [[loginIpLimiter, ipKey], [loginStoreLimiter, storeKey]] as const) {
    const s = lim.check(key);
    if (!s.allowed) return tooMany(s.retryAfter);
  }

  const base = upstreamBase();
  const common = { cache: 'no-store' as const, redirect: 'error' as const };
  try {
    const login = await fetch(`${base}/api/v1/auth/login`, {
      ...common,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Forwarded-For': ctx.ip },
      body: JSON.stringify(parsed),
      signal: AbortSignal.timeout(15_000),
    });
    if (!login.ok) {
      if ([401, 403, 404, 422].includes(login.status)) {
        loginIpLimiter.hit(ipKey);
        loginStoreLimiter.hit(storeKey);
      }
      return passError(login);
    }
    const pair = (await login.json().catch(() => null)) as { access_token?: unknown } | null;
    if (!pair || typeof pair.access_token !== 'string') {
      return jsonError(502, 'UPSTREAM_BAD_RESPONSE', 'เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง');
    }
    const meOf = (token: string) =>
      fetch(`${base}/api/v1/auth/me`, {
        ...common,
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(8_000),
      });
    const [verifiedRes, cashierRes] = await Promise.all([meOf(pair.access_token), meOf(cashierAccess)]);
    if (!verifiedRes.ok) return jsonError(502, 'UPSTREAM_BAD_RESPONSE', 'เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง');
    if (cashierRes.status === 401) return jsonError(401, 'UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบ');
    const v = (await verifiedRes.json()) as Partial<VerifiedUser>;
    const c = cashierRes.ok ? ((await cashierRes.json()) as Partial<VerifiedUser>) : null;
    const user: VerifiedUser = {
      id: String(v.id ?? ''),
      name: String(v.name ?? ''),
      role: String(v.role ?? ''),
      store_id: typeof v.store_id === 'string' ? v.store_id : null,
    };
    return NextResponse.json(
      { ok: true, user, same_store: !!c && !!user.store_id && c.store_id === user.store_id },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return jsonError(502, 'UPSTREAM_UNAVAILABLE', 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่');
  }
}

// ── Refresh ──────────────────────────────────────────────────────────────────

export const refreshIpLimiter = new MemoryRateLimiter(30, 60_000);

export async function handleRefresh(request: NextRequest): Promise<NextResponse> {
  const ctx = requestCtx(request);
  const blocked = originGuard(request, ctx);
  if (blocked) return blocked;

  const lim = refreshIpLimiter.hit(`ip:${ctx.ip}`);
  if (!lim.allowed) {
    return jsonError(429, 'TOO_MANY_REQUESTS', 'ลองใหม่อีกครั้งภายหลัง', { 'Retry-After': String(lim.retryAfter) });
  }

  const refreshToken = request.cookies.get(ctx.names.refresh)?.value;
  if (!refreshToken) {
    const res = jsonError(401, 'SESSION_EXPIRED', 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
    clearSessionCookies(res, ctx);
    return res;
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${upstreamBase()}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Forwarded-For': ctx.ip },
      body: JSON.stringify({ refresh_token: refreshToken }),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    // Transient: keep cookies so the next attempt can still succeed.
    return jsonError(502, 'UPSTREAM_UNAVAILABLE', 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่');
  }

  if (!upstream.ok) {
    if (upstream.status >= 500) return passError(upstream);
    const res = jsonError(401, 'SESSION_EXPIRED', 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
    clearSessionCookies(res, ctx);
    return res;
  }

  const data = (await upstream.json().catch(() => null)) as { access_token?: unknown; refresh_token?: unknown } | null;
  if (!data || typeof data.access_token !== 'string') {
    return jsonError(502, 'UPSTREAM_BAD_RESPONSE', 'เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง');
  }
  const res = NextResponse.json({ ok: true }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  setAccessCookie(res, ctx, data.access_token);
  // Rotate when the backend starts issuing a new refresh token; until then
  // keep the existing one (re-set so the flag cookie stays in sync).
  setRefreshCookies(res, ctx, typeof data.refresh_token === 'string' ? data.refresh_token : refreshToken);
  return res;
}

// ── Logout ───────────────────────────────────────────────────────────────────

export async function handleLogout(request: NextRequest): Promise<NextResponse> {
  const ctx = requestCtx(request);
  const blocked = originGuard(request, ctx);
  if (blocked) return blocked;

  const access = request.cookies.get(ctx.names.access)?.value;
  if (access) {
    // Best effort: the backend logout is currently a no-op (no revocation),
    // but calling it keeps us correct once token_version lands.
    try {
      await fetch(`${upstreamBase()}/api/v1/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${access}`, 'X-Forwarded-For': ctx.ip },
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(3_000),
      });
    } catch {
      /* ignore — cookies are cleared regardless */
    }
  }
  const res = NextResponse.json({ ok: true }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  clearSessionCookies(res, ctx);
  return res;
}

// ── Session check (used by routes that hand out secrets, e.g. bridge token) ─

const meCache = new Map<string, number>(); // sha256(token) → expiry ms
const ME_CACHE_MS = 60_000;

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Buffer.from(buf).toString('hex');
}

/** True when the access cookie is accepted by the backend (`GET /auth/me`), cached 60 s per token. */
export async function hasValidSession(request: NextRequest, ctx = requestCtx(request)): Promise<boolean> {
  const access = request.cookies.get(ctx.names.access)?.value;
  if (!access) return false;
  const key = await sha256(access);
  const now = Date.now();
  const cached = meCache.get(key);
  if (cached && cached > now) return true;
  try {
    const r = await fetch(`${upstreamBase()}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${access}`, Accept: 'application/json' },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(8_000),
    });
    if (!r.ok) return false;
    if (meCache.size > 5_000) meCache.clear();
    meCache.set(key, now + ME_CACHE_MS);
    return true;
  } catch {
    return false;
  }
}
