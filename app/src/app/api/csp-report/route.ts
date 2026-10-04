import type { NextRequest } from 'next/server';
import { MemoryRateLimiter, clientIpFrom } from '@/lib/server/bff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 8 * 1024;
const limiter = new MemoryRateLimiter(30, 60_000);

const noContent = () => new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });

function clip(v: unknown, n = 200): string | undefined {
  return typeof v === 'string' ? v.slice(0, n) : undefined;
}

/**
 * CSP violation sink for the Report-Only rollout (audit M2). Accepts both the
 * legacy `report-uri` body (`{"csp-report": {...}}`) and Reporting API batches
 * (`[{type:"csp-violation", body:{...}}]`). Logs a trimmed summary only, never
 * echoes input, caps body size and rate-limits per IP.
 */
export async function POST(request: NextRequest) {
  if (!limiter.hit(clientIpFrom(request.headers)).allowed) return noContent();
  const len = Number(request.headers.get('content-length') ?? '0');
  if (len > MAX_BYTES) return noContent();
  const text = await request.text().catch(() => '');
  if (!text || text.length > MAX_BYTES) return noContent();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return noContent();
  }

  const items: Record<string, unknown>[] = [];
  if (Array.isArray(parsed)) {
    for (const r of parsed.slice(0, 10)) {
      const body = (r as { body?: unknown })?.body;
      if (body && typeof body === 'object') items.push(body as Record<string, unknown>);
    }
  } else if (parsed && typeof parsed === 'object' && 'csp-report' in parsed) {
    const body = (parsed as Record<string, unknown>)['csp-report'];
    if (body && typeof body === 'object') items.push(body as Record<string, unknown>);
  }

  for (const b of items) {
    console.warn('[csp-report]', JSON.stringify({
      directive: clip(b['effectiveDirective'] ?? b['effective-directive'] ?? b['violated-directive']),
      blocked: clip(b['blockedURL'] ?? b['blocked-uri']),
      document: clip(b['documentURL'] ?? b['document-uri']),
      source: clip(b['sourceFile'] ?? b['source-file']),
      line: typeof (b['lineNumber'] ?? b['line-number']) === 'number' ? (b['lineNumber'] ?? b['line-number']) : undefined,
      sample: clip(b['sample'] ?? b['script-sample'], 80),
      disposition: clip(b['disposition']),
    }));
  }
  return noContent();
}
