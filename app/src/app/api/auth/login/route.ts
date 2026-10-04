import type { NextRequest } from 'next/server';
import { handleLogin } from '@/lib/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST {store_slug, pin} → sets HttpOnly session cookies. Never returns tokens. */
export function POST(request: NextRequest) {
  return handleLogin(request);
}
