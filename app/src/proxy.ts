/**
 * Next 16 Proxy (formerly middleware). Two jobs:
 *
 * 1. CSRF guard for every state-changing /api/* request: Origin must be ours
 *    (route handlers repeat the check, so a matcher gap cannot bypass it).
 * 2. Per-request nonce Content-Security-Policy for documents, shipped as
 *    **Report-Only** first (audit M2). Next reads the nonce from the request's
 *    CSP header and stamps it on its own scripts; layout.tsx reads `x-nonce`
 *    for the inline theme script.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { CSP_REPORT_GROUP, CSP_REPORT_PATH, buildCsp, makeNonce, r2ImageOrigins } from '@/lib/server/csp';
import { originGuard } from '@/lib/server/session';

const CSP_HEADER = 'Content-Security-Policy-Report-Only';

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/api/')) {
    if (pathname === CSP_REPORT_PATH) return NextResponse.next();
    const blocked = originGuard(request);
    if (blocked) return blocked;
    return NextResponse.next();
  }

  const nonce = makeNonce();
  const csp = buildCsp({
    nonce,
    isDev: process.env.NODE_ENV === 'development',
    imageOrigins: r2ImageOrigins(),
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set(CSP_HEADER, csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(CSP_HEADER, csp);
  response.headers.set('Reporting-Endpoints', `${CSP_REPORT_GROUP}="${CSP_REPORT_PATH}"`);
  return response;
}

export const config = {
  matcher: [
    '/api/:path*',
    {
      source: '/((?!api/|_next/static|_next/image|favicon.ico|icons/|sw.js|manifest.webmanifest|offline.html|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|js|css|txt|woff2?)$).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
