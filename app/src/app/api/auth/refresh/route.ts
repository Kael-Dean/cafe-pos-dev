import type { NextRequest } from 'next/server';
import { handleRefresh } from '@/lib/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST (no body) → exchanges the refresh cookie for a new access cookie. */
export function POST(request: NextRequest) {
  return handleRefresh(request);
}
