/**
 * Same-origin proxy to the FastAPI backend (replaces the old next.config
 * rewrite). Attaches `Authorization: Bearer <access cookie>` server-side so
 * the browser never holds the token (audit M1, m3).
 *
 * - Upstream origin is fixed from RAILWAY_API_URL; the path is decoded,
 *   validated and re-encoded segment by segment (SSRF / traversal guard).
 * - Client `Authorization` / `Cookie` headers are never forwarded.
 * - State-changing methods require our own Origin (CSRF, with SameSite=Strict).
 * - No access cookie → 401 without calling upstream; the client then calls
 *   /api/auth/refresh once and retries.
 * - /auth/login and /auth/logout are served by the cookie BFF handlers so the
 *   legacy login screen keeps working; /auth/refresh moved to /api/auth/refresh.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { sanitizeUpstreamPath } from '@/lib/server/bff';
import { handleLegacyLogin, handleLogout, jsonError, originGuard, requestCtx, upstreamBase } from '@/lib/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 10 * 1024 * 1024;

const FORWARD_REQUEST_HEADERS = ['accept', 'accept-language', 'content-type', 'if-none-match', 'if-modified-since'];

// Hop-by-hop and headers we must not relay from upstream.
const DROP_RESPONSE_HEADERS = new Set([
  'set-cookie',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'content-encoding', // fetch() already decoded the body
  'content-length',
  'server',
  'via',
  'alt-svc',
  'strict-transport-security',
  'access-control-allow-origin',
  'access-control-allow-credentials',
  'access-control-allow-headers',
  'access-control-allow-methods',
  'access-control-expose-headers',
  'access-control-max-age',
  'vary',
]);

async function proxy(request: NextRequest): Promise<Response> {
  const ctx = requestCtx(request);
  const blocked = originGuard(request, ctx);
  if (blocked) return blocked;

  const tail = request.nextUrl.pathname.replace(/^\/api\/v1\/?/i, '');
  const safePath = sanitizeUpstreamPath(tail);
  if (!safePath) return jsonError(400, 'BAD_PATH', 'เส้นทางไม่ถูกต้อง');

  const lower = safePath.replace(/\/$/, '').toLowerCase();
  const method = request.method.toUpperCase();
  if (lower === 'auth/login' && method === 'POST') return handleLegacyLogin(request);
  if (lower === 'auth/logout' && method === 'POST') return handleLogout(request);
  if (lower === 'auth/refresh') {
    // Refresh tokens never travel through JS anymore. Old clients get a 401
    // here and fall back to the login screen (one-time re-login, accepted).
    return jsonError(401, 'SESSION_EXPIRED', 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
  }

  const access = request.cookies.get(ctx.names.access)?.value;
  if (!access) return jsonError(401, 'UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบ');

  const headers = new Headers();
  for (const name of FORWARD_REQUEST_HEADERS) {
    const v = request.headers.get(name);
    if (v) headers.set(name, v);
  }
  headers.set('Authorization', `Bearer ${access}`);
  headers.set('X-Forwarded-For', ctx.ip);

  let body: ArrayBuffer | undefined;
  if (method !== 'GET' && method !== 'HEAD') {
    const len = Number(request.headers.get('content-length') ?? '0');
    if (len > MAX_BODY_BYTES) return jsonError(413, 'PAYLOAD_TOO_LARGE', 'ข้อมูลใหญ่เกินไป');
    body = await request.arrayBuffer();
    if (body.byteLength > MAX_BODY_BYTES) return jsonError(413, 'PAYLOAD_TOO_LARGE', 'ข้อมูลใหญ่เกินไป');
  }

  const base = upstreamBase();
  const target = `${base}/api/v1/${safePath}${request.nextUrl.search}`;

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method,
      headers,
      body,
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return jsonError(502, 'UPSTREAM_UNAVAILABLE', 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่');
  }

  const out = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!DROP_RESPONSE_HEADERS.has(key.toLowerCase())) out.set(key, value);
  });

  // Upstream redirects (e.g. FastAPI trailing-slash 307) must stay on our
  // origin: rewrite an upstream /api/v1 Location to a relative path, drop any
  // other target instead of bouncing the browser to a foreign host.
  const location = upstream.headers.get('location');
  if (location) {
    out.delete('location');
    try {
      const loc = new URL(location, target);
      if (loc.origin === base && loc.pathname.startsWith('/api/v1/')) out.set('Location', loc.pathname + loc.search);
    } catch {
      /* drop malformed Location */
    }
  }

  out.set('Cache-Control', 'no-store');
  // Any document rendered from an API response (e.g. the plain-text shopping
  // list opened in a new tab) runs sandboxed with no script or framing.
  out.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; sandbox");
  out.set('X-Content-Type-Options', 'nosniff');

  const noBody = method === 'HEAD' || upstream.status === 204 || upstream.status === 304;
  return new NextResponse(noBody ? null : upstream.body, { status: upstream.status, headers: out });
}

export const GET = proxy;
export const HEAD = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
