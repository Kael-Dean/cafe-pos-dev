import { NextRequest, NextResponse } from 'next/server';

// Same-origin proxy for menu photos stored on Cloudflare R2.
//
// Re-cropping an existing photo means drawing it onto a <canvas> and re-encoding
// it. A canvas fed a cross-origin image without CORS headers becomes "tainted"
// and refuses toBlob(), so the public R2 URL can't be re-cropped directly in the
// browser. This route fetches the image server-side (no CORS in play) and streams
// the bytes back from our own origin, so the client canvas can read them freely.
//
// SSRF guard: only R2 hosts are allowed — the managed `*.r2.dev` / S3
// `*.r2.cloudflarestorage.com` endpoints, plus the configured public base
// (R2_PUBLIC_URL, for custom domains). The response must itself be an image.

function allowedHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h.endsWith('.r2.dev') || h.endsWith('.r2.cloudflarestorage.com')) return true;
  const base = process.env.R2_PUBLIC_URL || process.env.NEXT_PUBLIC_R2_PUBLIC_URL;
  if (base) {
    try {
      if (new URL(base).host.toLowerCase() === h) return true;
    } catch {
      /* malformed env — ignore */
    }
  }
  return false;
}

export async function GET(req: NextRequest) {
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
    upstream = await fetch(target.toString(), { redirect: 'follow' });
  } catch {
    return NextResponse.json({ error: 'fetch failed' }, { status: 502 });
  }

  const contentType = upstream.headers.get('content-type') ?? '';
  if (!upstream.ok || !contentType.startsWith('image/')) {
    return NextResponse.json({ error: 'not an image' }, { status: 502 });
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'private, max-age=300',
    },
  });
}
