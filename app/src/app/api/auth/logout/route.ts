import type { NextRequest } from 'next/server';
import { handleLogout } from '@/lib/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST → best-effort backend logout, then clears every session cookie. */
export function POST(request: NextRequest) {
  return handleLogout(request);
}
