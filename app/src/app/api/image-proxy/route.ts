import { NextRequest, NextResponse } from 'next/server';
import { hasValidSession } from '@/lib/server/session';

export const runtime = 'nodejs';

// Same-origin proxy for menu photos stored on Cloudflare R2.
//
// Re-cropping an existing photo means drawing it onto a <canvas> and re-encoding
// it. A canvas fed a cross-origin image without CORS headers becomes "tainted"
// and refuses toBlob(), so the public R2 URL can't be re-cropped directly in the
// browser. This route fetches the image server-side (no CORS in play) and streams
// the bytes back from our own origin, so the client canvas can read them freely.
//
// Security (audit m1): staff session required, SSRF guard on the host (pinned to
// R2_PUBLIC_URL once it is set; the managed `*.r2.dev` / `*.r2.cloudflarestorage.com`
// hosts are only the fallback while it is unset), redirects never followed, raster
// images only (no SVG), 10 MB cap.

const MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPE = /^image\/(png|jpe?g|webp|gif|avif)(;|$)/i;

function allowedHost(host: string): boolean {
  const h = host.toLowerCase();
  const base = process.env.R2_PUBLIC_URL || process.env.NEXT_PUBLIC_R2_PUBLIC_URL;
  if (base) {
    try {
      return new URL(base).host.toLowerCase() === h;
    } catch {
      /* malformed env — fall back to the managed hosts */
    }
  }
  return h.endsWith('.r2.dev') || h.endsWith('.r2.cloudflarestorage.com');
}

export async function GET(req: NextRequest) {
  if (!(await hasValidSession(req))) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }

  const raw = req.nextUrl.searchParams.get('url');
  if (!raw) return NextResponse.json({ error: 'missing url' }, { status: 400 });

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return NextResponse.json({ error: 'invalid url' }, { status: 400 });
  }

  if (target.protocol !== 'https:' || !allowedHost(target.host)) {
    return NextResponse.json({ error: 'host not allowed' }, { status: 403 });
  }

  let upstream: Response;
  try {
    // Never follow redirects: a 3xx could point outside the R2 allowlist (SSRF).
    // With 'manual' a redirect is not `ok`, so it is rejected just below.
    upstream = await fetch(target.toString(), { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
  } catch {
    return NextResponse.json({ error: 'fetch failed' }, { status: 502 });
  }

  const contentType = upstream.headers.get('content-type') ?? '';
  if (!upstream.ok || !IMAGE_TYPE.test(contentType)) {
    return NextResponse.json({ error: 'not an image' }, { status: 502 });
  }
  if (Number(upstream.headers.get('content-length') ?? '0') > MAX_BYTES) {
    return NextResponse.json({ error: 'too large' }, { status: 413 });
  }
  const bytes = await upstream.arrayBuffer().catch(() => null);
  if (!bytes || bytes.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: 'too large' }, { status: 413 });
  }

  return new NextResponse(bytes, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
