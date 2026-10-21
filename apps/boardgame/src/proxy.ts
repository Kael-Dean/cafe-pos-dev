// Next 16 Proxy. Logic lives in @pos/core (shared by every edition); Next needs the
// function declared and `config` written literally in this file — keep the matcher
// identical to PROXY_CONFIG in core (src/proxy-matcher.test.ts enforces it).
import type { NextRequest } from 'next/server';
import { proxy as posProxy } from '@pos/core/lib/server/proxy';

export function proxy(request: NextRequest) {
  return posProxy(request);
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
